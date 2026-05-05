/**
 * channel:* IPC handlers.
 *
 * Wire the 7 channel IPC calls to {@link ChannelService} (+ {@link
 * MeetingService} for `channel:start-meeting`).
 *
 * `channel:create` branches on `kind`: `'user'` → ChannelService.create,
 * `'dm'` → ChannelService.createDm (single providerId from
 * memberProviderIds[0]), `'system_*'` is rejected — system channels are
 * only ever auto-created by ProjectService's post-create hook.
 *
 * `channel:list` returns the project's channels when `projectId` is
 * non-null, and the DM list when `projectId === null`. This matches the
 * renderer sidebar which asks for "this project" vs. "my DMs".
 */

import type { IpcRequest, IpcResponse } from '../../../shared/ipc-types';
import type { ChannelService } from '../../channels/channel-service';
import type { MeetingService } from '../../meetings/meeting-service';
import type { MemberProfileService } from '../../members/member-profile-service';
import type { Meeting } from '../../../shared/meeting-types';
import type { Participant } from '../../../shared/engine-types';
import type { SsmContext } from '../../../shared/ssm-context-types';
import type { Channel } from '../../../shared/channel-types';
import type { DmSummary } from '../../../shared/dm-types';
import type { MemberView } from '../../../shared/member-profile-types';
import { providerRegistry } from '../../providers/registry';

/**
 * Factory surface used by `channel:start-meeting` to kick off a
 * MeetingOrchestrator after MeetingService has created the DB row.
 * Wired in `main/index.ts`; R7+ may replace the sync factory with an
 * ApprovalService-gated variant.
 */
export interface MeetingOrchestratorFactory {
  createAndRun(input: {
    meeting: Meeting;
    projectId: string;
    participants: Participant[];
    topic: string;
    ssmCtx: SsmContext;
    /**
     * Optional cap on round count. Defaults to `'unlimited'` so the
     * historical [회의 시작] button flow keeps producing full
     * deliberation. The auto-trigger path passes `1` for system_general
     * channels — those are casual chat surfaces where one round of
     * responses is the expected affordance, not a multi-round consensus
     * meeting (dogfooding 2026-05-01).
     */
    roundSetting?: import('../../../shared/engine-types').RoundSetting;
  }): Promise<void> | void;
}

let channelAccessor: (() => ChannelService) | null = null;
let meetingAccessor: (() => MeetingService) | null = null;
let memberAccessor: (() => MemberProfileService) | null = null;
let orchestratorFactory: MeetingOrchestratorFactory | null = null;

export function setChannelServiceAccessor(fn: () => ChannelService): void {
  channelAccessor = fn;
}

export function setMeetingServiceAccessor(fn: () => MeetingService): void {
  meetingAccessor = fn;
}

/**
 * R12-C dogfooding round 1 (2026-05-03) — `channel:list-members` IPC 가
 * channel_members 테이블의 providerId 들을 MemberProfileService.getView 로
 * fuse 해 MemberView[] 를 반환하기 위해 별도 accessor 를 갖는다. member-handler
 * 와 cross-handler dependency 를 만들지 않으려고 main/index.ts boot 에서
 * 같은 service 인스턴스를 두 곳에 wire 한다.
 */
export function setChannelMemberServiceAccessor(
  fn: () => MemberProfileService,
): void {
  memberAccessor = fn;
}

export function setMeetingOrchestratorFactory(
  factory: MeetingOrchestratorFactory,
): void {
  orchestratorFactory = factory;
}

function getChannel(): ChannelService {
  if (!channelAccessor) {
    throw new Error('channel handler: service not initialized');
  }
  return channelAccessor();
}

function getMeeting(): MeetingService {
  if (!meetingAccessor) {
    throw new Error('channel handler: meeting service not initialized');
  }
  return meetingAccessor();
}

function getMemberSvc(): MemberProfileService {
  if (!memberAccessor) {
    throw new Error('channel handler: member service not initialized');
  }
  return memberAccessor();
}

/** channel:list — R12-C: projectId=null 은 DM 만 (전역 일반 채널은 별도 IPC). */
export function handleChannelList(
  data: IpcRequest<'channel:list'>,
): IpcResponse<'channel:list'> {
  const svc = getChannel();
  const channels =
    data.projectId === null ? svc.listDms() : svc.listByProject(data.projectId);
  return { channels };
}

/**
 * R12-C dogfooding round 1 (2026-05-03) — channel:list-members.
 *
 * `channel_members` 테이블의 providerId 들을 drag_order 순으로 가져와
 * MemberProfileService.getView 로 fuse → MemberView[] 반환. DM 채널은
 * AI 1명만 들어있고 (migration 003 주석), 자유/시스템 채널은 채널 생성
 * 시 채널-멤버 매핑된 provider 들만. project-wide member:list 와는 다른
 * surface (이전 useChannelMembers MVP 의 stale 표시 fix).
 *
 * 빈 채널 (channel_members 0행) 은 빈 배열 반환 — UI 에서 "참여자 없음"
 * 표시. ChannelNotFoundError 같은 분기는 renderer 가 channels list 와
 * 교차 검증으로 surface (use-channel-members.ts).
 */
export function handleChannelListMembers(
  data: IpcRequest<'channel:list-members'>,
): IpcResponse<'channel:list-members'> {
  const channelSvc = getChannel();
  const memberSvc = getMemberSvc();
  const channelMembers = channelSvc.listMembers(data.channelId);
  const members: MemberView[] = channelMembers.map((cm) =>
    memberSvc.getView(cm.providerId),
  );
  return { members };
}

/**
 * R12-C — channel:get-global-general — 전역 일반 채널 1개 lookup.
 * Boot 직후 ensureGlobalGeneralChannel 가 보장하므로 일반적으로 channel
 * 객체 반환. 마이그레이션/boot 비정상 시 null.
 */
export function handleChannelGetGlobalGeneral(): IpcResponse<'channel:get-global-general'> {
  const svc = getChannel();
  try {
    return { channel: svc.getGlobalGeneralChannel() };
  } catch {
    return { channel: null };
  }
}

/** channel:create */
export function handleChannelCreate(
  data: IpcRequest<'channel:create'>,
): IpcResponse<'channel:create'> {
  const svc = getChannel();
  if (data.kind === 'dm') {
    if (data.memberProviderIds.length !== 1) {
      throw new Error(
        'channel:create dm: exactly one providerId required',
      );
    }
    const channel = svc.createDm(data.memberProviderIds[0]);
    return { channel };
  }
  if (data.kind === 'user') {
    if (data.projectId === null) {
      throw new Error('channel:create user: projectId required');
    }
    const channel = svc.create({
      projectId: data.projectId,
      name: data.name,
      memberProviderIds: data.memberProviderIds,
    });
    return { channel };
  }
  throw new Error(
    `channel:create: kind "${data.kind}" is auto-created by the project lifecycle`,
  );
}

/** channel:rename */
export function handleChannelRename(
  data: IpcRequest<'channel:rename'>,
): IpcResponse<'channel:rename'> {
  const channel = getChannel().rename(data.id, data.name);
  return { channel };
}

/** channel:delete */
export function handleChannelDelete(
  data: IpcRequest<'channel:delete'>,
): IpcResponse<'channel:delete'> {
  getChannel().delete(data.id);
  return { success: true };
}

/**
 * R12-C T9 — `channel:archive-conversation` "새 대화 시작" 버튼.
 *
 * 일반 채널 (전역 system_general) 의 모든 메시지를 ArenaRoot 의
 * `conversations-archive/<timestamp>-<channelId>.json` 에 dump 한 뒤
 * channel_messages 행을 삭제한다. 일반 채널 외 channelId 는 throw — UI 에서
 * GeneralChannelControls 만 노출되므로 이론상 도달하지 않지만 백엔드 방어.
 */
export async function handleChannelArchiveConversation(
  data: IpcRequest<'channel:archive-conversation'>,
): Promise<IpcResponse<'channel:archive-conversation'>> {
  const svc = getChannel();
  const result = await svc.archiveConversation(data.channelId);
  return { archivedPath: result.archivedPath, deletedCount: result.deletedCount };
}

/** channel:add-members */
export function handleChannelAddMembers(
  data: IpcRequest<'channel:add-members'>,
): IpcResponse<'channel:add-members'> {
  const svc = getChannel();
  for (const providerId of data.providerIds) {
    svc.addMember(data.id, providerId);
  }
  return { success: true };
}

/** channel:remove-members */
export function handleChannelRemoveMembers(
  data: IpcRequest<'channel:remove-members'>,
): IpcResponse<'channel:remove-members'> {
  const svc = getChannel();
  for (const providerId of data.providerIds) {
    svc.removeMember(data.id, providerId);
  }
  return { success: true };
}

/**
 * `dm:list` — R10-Task3.
 *
 * 등록된 모든 provider 를 순회하며 DM 채널이 이미 있는지 확인한다.
 * DM 은 `channel_members` 에 정확히 1명의 provider 만 있고 channel.kind='dm'
 * + channel.project_id=NULL 이라 `listDms()` 한 번 호출 + `listMembers(channelId)`
 * 교차로 매핑한다. 응답은 모든 provider 를 포함하므로 renderer 의 "새 DM 만들기"
 * 모달이 이미 있는 provider 를 disabled 로 그대로 렌더할 수 있다.
 */
export function handleDmList(): IpcResponse<'dm:list'> {
  const svc = getChannel();
  const dms: Channel[] = svc.listDms();

  // dmChannelByProviderId 인덱스 생성 — O(N) 한 번.
  const channelByProvider = new Map<string, Channel>();
  for (const channel of dms) {
    const members = svc.listMembers(channel.id);
    if (members.length === 0) continue; // 데이터 무결성 방어.
    const providerId = members[0]!.providerId;
    channelByProvider.set(providerId, channel);
  }

  const items: DmSummary[] = [];
  for (const info of providerRegistry.listAll()) {
    const channel = channelByProvider.get(info.id) ?? null;
    items.push({
      providerId: info.id,
      providerName: info.displayName,
      channel,
      exists: channel !== null,
    });
  }
  return { items };
}

/**
 * `dm:create` — R10-Task3.
 *
 * `ChannelService.createDm` 는 `idx_dm_unique_per_provider` UNIQUE 위반 시
 * `DuplicateDmError` throw. handler 는 이를 renderer 쪽 i18n 키
 * `dm.alreadyExists` 로 매핑할 수 있도록 메시지를 그대로 propagate 한다.
 */
export function handleDmCreate(
  data: IpcRequest<'dm:create'>,
): IpcResponse<'dm:create'> {
  const channel = getChannel().createDm(data.providerId);
  return { channel };
}

/** channel:start-meeting */
export function handleChannelStartMeeting(
  data: IpcRequest<'channel:start-meeting'>,
): IpcResponse<'channel:start-meeting'> {
  // R12-C2 P1.5 — 일반 채널 (#일반, system_general) 은 회의 X.
  // spec §11.3 + 메모리 r12-meeting-system-redesign §3 결정: 일반 채널은
  // 잡담 + `[##본문]` 파싱 카드 + 동의/반대 카운터만 — 회의록 / 인계 X.
  // boundary 가드를 MeetingService.start 자체에 두려면 ChannelService 의존
  // 추가 필요 → P2 OpinionService 도입 시 structural refactor 안에서 옮긴다.
  // 그 전까지는 알려진 두 호출자 (본 핸들러 + default-meeting-starter) 측에
  // 차단 가드를 박아 신규 회의 row 생성을 막는다.
  const channel = getChannel().get(data.channelId);
  if (channel?.kind === 'system_general') {
    throw new Error(
      `channel:start-meeting: 일반 채널 (#일반) 은 회의 X — channelId=${data.channelId}`,
    );
  }

  const meeting = getMeeting().start({
    channelId: data.channelId,
    topic: data.topic,
  });

  // R6-Task4: fire-and-forget orchestrator boot. We do NOT await —
  // the IPC response goes back to the renderer immediately so the
  // MeetingBanner can render; the orchestrator drives turn + stream
  // events on its own schedule.
  const factory = orchestratorFactory;
  if (factory) {
    if (channel && channel.projectId) {
      const members = getChannel().listMembers(data.channelId);
      const participants: Participant[] = members.map((m) => ({
        id: m.providerId,
        providerId: m.providerId,
        displayName: m.providerId,
        isActive: true,
      }));
      if (participants.length >= 2) {
        const ssmCtx: SsmContext = {
          meetingId: meeting.id,
          channelId: meeting.channelId,
          projectId: channel.projectId,
          projectPath: '',
          permissionMode: 'hybrid',
          autonomyMode: 'manual',
        };
        void factory.createAndRun({
          meeting,
          projectId: channel.projectId,
          participants,
          topic: data.topic,
          ssmCtx,
        });
      }
    }
  }

  return { meeting };
}
