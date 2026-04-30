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
import type { Meeting } from '../../../shared/meeting-types';
import type { Participant } from '../../../shared/engine-types';
import type { SsmContext } from '../../../shared/ssm-context-types';
import type { Channel } from '../../../shared/channel-types';
import type { DmSummary } from '../../../shared/dm-types';
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
let orchestratorFactory: MeetingOrchestratorFactory | null = null;

export function setChannelServiceAccessor(fn: () => ChannelService): void {
  channelAccessor = fn;
}

export function setMeetingServiceAccessor(fn: () => MeetingService): void {
  meetingAccessor = fn;
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

/** channel:list */
export function handleChannelList(
  data: IpcRequest<'channel:list'>,
): IpcResponse<'channel:list'> {
  const svc = getChannel();
  const channels =
    data.projectId === null ? svc.listDms() : svc.listByProject(data.projectId);
  return { channels };
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
    const channel = getChannel().get(data.channelId);
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
