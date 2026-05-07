/**
 * handoff:* IPC handlers — R12-C2 P6 T28. spec §11.18.8c.
 *
 * 사용자 결재 모달 [확인 / 취소] 두 분기 entry. orchestrator 가 회의 종결 시점
 * HandoffPendingState 에 등록한 의뢰서를 take 후 dispatch (approve) 또는 폐기
 * (cancel).
 *
 *   - {@link handleHandoffApprove}  pending take + HandoffDispatchService.dispatch +
 *                                    stream:handoff-dispatched emit
 *   - {@link handleHandoffCancel}   pending take + stream:handoff-rejected emit
 *                                    (reason='user_canceled'). dispatch 호출 X
 *
 * `spawnReview` 필드 (audit→planning 인계 모달 안 *"+리뷰 부서도 시작"*
 * 체크박스) 는 본 sub-task 시점 IPC payload 보존만 — 실 review 부서 spawn 흐름
 * 은 T30 책임 (Notification + 자동 인계). 본 sub-task 는 `spawnReview` 가 true 여도
 * pending row 의 mode 분기에 영향 X (caller 가 후속 처리).
 */

import type { IpcRequest, IpcResponse } from '../../../shared/ipc-types';
import type { HandoffDispatchService } from '../../handoff/handoff-dispatch-service';
import type { HandoffPendingState } from '../../handoff/handoff-pending-state';
import type { StreamBridge } from '../../streams/stream-bridge';
import type { HandoffDispatchRow } from '../../handoff/handoff-dispatch-types';
import type { MeetingMinutesService } from '../../meetings/meeting-minutes-service';
import type { MeetingService } from '../../meetings/meeting-service';
import type { ChannelService } from '../../channels/channel-service';
import type { HandoffDispatchRowSummary } from '../../../shared/handoff/dispatch-row-summary';
import { extractNextActions } from '../../../shared/handoff/next-actions';
import {
  buildHandoffPackage,
  type HandoffPackage,
} from '../../../shared/schema/handoff-package';
import { parseMissionCardJson } from '../../../shared/schema/mission-card';
import type { Participant } from '../../../shared/engine-types';
import type { SsmContext } from '../../../shared/ssm-context-types';
import type { MeetingOrchestratorFactory } from './channel-handler';

let pendingAccessor: (() => HandoffPendingState) | null = null;
let dispatchAccessor: (() => HandoffDispatchService) | null = null;
let streamAccessor: (() => StreamBridge) | null = null;
let minutesAccessor: (() => MeetingMinutesService) | null = null;
let meetingAccessor: (() => MeetingService) | null = null;
let channelAccessor: (() => ChannelService) | null = null;
/**
 * R12-C2 T29 — handoff:start-meeting-from-package 가 호출 시 *기존*
 * MeetingOrchestratorFactory (channel-handler 와 공유) 통해 회의 boot. caller
 * 가 priorContextSystemMessage 옵션으로 보낸 부서 회의록 + 작업 list 를 session
 * 에 동봉한다 — 별 factory 신설 없음, 기존 createAndRun 재사용.
 */
let orchestratorFactory: MeetingOrchestratorFactory | null = null;

/**
 * 받는 부서 회의 boot 시 caller (handoff handler) 가 합성한 participants + ssmCtx
 * builder. main/index.ts 가 channel:start-meeting 와 동일한 helper 인라인 호출
 * 후 본 entry 로 wire — caller 본체에서 receiver channel 의 멤버 + arenaRoot
 * 의존성을 모두 안다.
 */
export interface HandoffStartMeetingResolver {
  resolveParticipants(channelId: string): Participant[];
  buildSsmCtx(input: { meetingId: string; channelId: string; projectId: string }): SsmContext;
}
let startMeetingResolver: HandoffStartMeetingResolver | null = null;

export function setHandoffPendingStateAccessor(
  fn: () => HandoffPendingState,
): void {
  pendingAccessor = fn;
}

export function setHandoffDispatchServiceAccessor(
  fn: () => HandoffDispatchService,
): void {
  dispatchAccessor = fn;
}

export function setHandoffStreamBridgeAccessor(fn: () => StreamBridge): void {
  streamAccessor = fn;
}

export function setHandoffMinutesServiceAccessor(
  fn: () => MeetingMinutesService,
): void {
  minutesAccessor = fn;
}

export function setHandoffMeetingServiceAccessor(
  fn: () => MeetingService,
): void {
  meetingAccessor = fn;
}

export function setHandoffChannelServiceAccessor(
  fn: () => ChannelService,
): void {
  channelAccessor = fn;
}

export function setHandoffMeetingOrchestratorFactory(
  factory: MeetingOrchestratorFactory,
): void {
  orchestratorFactory = factory;
}

export function setHandoffStartMeetingResolver(
  resolver: HandoffStartMeetingResolver,
): void {
  startMeetingResolver = resolver;
}

function getStartMeetingResolver(): HandoffStartMeetingResolver {
  if (startMeetingResolver === null) {
    throw new Error(
      '[handoff] start-meeting resolver not initialized — call setHandoffStartMeetingResolver',
    );
  }
  return startMeetingResolver;
}

function getPending(): HandoffPendingState {
  if (pendingAccessor === null) {
    throw new Error('[handoff] HandoffPendingState accessor not initialized');
  }
  return pendingAccessor();
}

function getDispatch(): HandoffDispatchService {
  if (dispatchAccessor === null) {
    throw new Error(
      '[handoff] HandoffDispatchService accessor not initialized',
    );
  }
  return dispatchAccessor();
}

function getStream(): StreamBridge {
  if (streamAccessor === null) {
    throw new Error('[handoff] StreamBridge accessor not initialized');
  }
  return streamAccessor();
}

function getMinutes(): MeetingMinutesService {
  if (minutesAccessor === null) {
    throw new Error('[handoff] MeetingMinutesService accessor not initialized');
  }
  return minutesAccessor();
}

function getMeeting(): MeetingService {
  if (meetingAccessor === null) {
    throw new Error('[handoff] MeetingService accessor not initialized');
  }
  return meetingAccessor();
}

function getChannel(): ChannelService {
  if (channelAccessor === null) {
    throw new Error('[handoff] ChannelService accessor not initialized');
  }
  return channelAccessor();
}

function getOrchestratorFactory(): MeetingOrchestratorFactory {
  if (orchestratorFactory === null) {
    throw new Error(
      '[handoff] orchestrator factory not initialized — call setMeetingOrchestratorFactory',
    );
  }
  return orchestratorFactory;
}

/**
 * R12-C2 T29 — handoff_dispatch row → IPC payload 변환. mission_card_json 은
 * service 가 검증된 MissionCard 로 inflate 후 buildHandoffPackage 로 통째 검증.
 *
 * caller 책임: row 가 service 의 정상 dispatch 결과 (검증 통과) 라야 함. 잘못된
 * row 입력 시 zod throw — caller (IPC handler) 가 catch 후 사용자 노출 에러.
 */
function rowToSummary(row: HandoffDispatchRow): HandoffDispatchRowSummary {
  const missionCard = parseMissionCardJson(row.missionCardJson);
  const pkg: HandoffPackage = buildHandoffPackage({
    sender: {
      meetingId: row.fromMeetingId,
      channelId: row.fromChannelId,
      // channelRole 는 row 에 없음 — handoff 시점 channel.role 가 필요하면 caller
      // 가 별 lookup. 본 helper 는 HandoffPackage schema 의 nullable 필드로 처리.
      channelRole: null,
    },
    target: {
      channelId: row.toChannelId,
      channelRole: null,
    },
    reason: row.reason,
    minutesMeetingId: row.minutesId,
    nextActions: [],
    missionCard,
    mode: row.mode,
    dispatchedAt: row.dispatchedAt,
  });
  return {
    id: row.id,
    package: pkg,
    openedAt: row.openedAt,
    createdAt: row.createdAt,
  };
}

/**
 * 'check' 분기 사용자 결재 모달 [확인]. pending state 에서 take + dispatch +
 * emit. take 결과가 null (이미 처리되었거나 미존재) 이면 throw — caller 가
 * stream 갱신 따라 재시도 안 하도록 명시 noisy fail.
 *
 * `spawnReview` 는 review 부서 spawn 후속 처리 (T30) 입력 — 본 sub-task 는
 * payload 보존만, dispatch 자체에는 영향 X.
 */
export function handleHandoffApprove(
  data: IpcRequest<'handoff:approve'>,
): IpcResponse<'handoff:approve'> {
  const pending = getPending();
  const dispatchService = getDispatch();
  const stream = getStream();

  const pkg = pending.take(data.meetingId);
  if (pkg === null) {
    throw new Error(
      `[handoff:approve] no pending package for meeting ${data.meetingId} — ` +
        'either already approved/canceled or never registered',
    );
  }

  const row = dispatchService.dispatch(pkg);

  // spawnReview 는 T30 책임 — 본 sub-task 시점은 payload 보존만 (dispatch 후
  // 후속 review 회의 boot 는 미land). 후속 sub-task 가 본 분기에서 NotificationService
  // 카테고리 + spawn 흐름 wire.
  void data.spawnReview;

  try {
    stream.emitHandoffDispatched({
      meetingId: data.meetingId,
      dispatchRowId: row.id,
      senderChannelId: pkg.sender.channelId,
      targetChannelId: pkg.target.channelId,
      mode: pkg.mode,
      dispatchedAt: row.dispatchedAt,
    });
  } catch (err) {
    console.warn(
      '[handoff:approve] emitHandoffDispatched threw',
      err instanceof Error ? err.message : String(err),
    );
  }

  return { dispatchRowId: row.id };
}

/**
 * 'check' 분기 [취소]. pending state 에서 take 후 dispatch 호출 X — 메모리
 * cleanup + stream 통지만. take 결과 null 이어도 silent OK (사용자가 두 번 취소
 * 가능 시나리오 — UI 멱등 고려).
 */
export function handleHandoffCancel(
  data: IpcRequest<'handoff:cancel'>,
): IpcResponse<'handoff:cancel'> {
  const pending = getPending();
  const stream = getStream();

  pending.take(data.meetingId);

  try {
    stream.emitHandoffRejected({
      meetingId: data.meetingId,
      reason: 'user_canceled',
    });
  } catch (err) {
    console.warn(
      '[handoff:cancel] emitHandoffRejected threw',
      err instanceof Error ? err.message : String(err),
    );
  }

  return { success: true };
}

/**
 * R12-C2 T29 — 받는 채널 의뢰서 list. unopenedOnly=true 면 미열람만 (받는 부서
 * 첫 진입 시 카드 표시 결정).
 */
export function handleHandoffListByChannel(
  data: IpcRequest<'handoff:list-by-channel'>,
): IpcResponse<'handoff:list-by-channel'> {
  const dispatchService = getDispatch();
  const rows = dispatchService.trackByChannel(data.channelId, {
    unopenedOnly: data.unopenedOnly === true,
  });
  return { items: rows.map(rowToSummary) };
}

/**
 * R12-C2 T29 — 의뢰서 열람 도장. opened_at NULL → epoch 1 회 set, 두 번째 이후
 * 호출은 기존 값 유지 (idempotent). 미존재 row → throw (caller 가 stream 갱신 따라
 * 재호출 안 함).
 */
export function handleHandoffOpen(
  data: IpcRequest<'handoff:open'>,
): IpcResponse<'handoff:open'> {
  const dispatchService = getDispatch();
  const row = dispatchService.open(data.dispatchRowId, Date.now());
  if (row === null) {
    throw new Error(
      `[handoff:open] no handoff_dispatch row for id ${data.dispatchRowId}`,
    );
  }
  return { item: rowToSummary(row) };
}

/**
 * R12-C2 T29 — 의뢰서 1 통 + 회의록 본문 + nextActions 묶음 read. H2 카드 단일
 * 진입점.
 *
 * 회의록 본문 read 실패 시 minutesBody = null (caller 가 분기 표시). nextActions
 * 는 mission card payload 에서 derive — 빈 배열 가능 (UI "(작업 list 없음)").
 */
export async function handleHandoffReadWithMinutes(
  data: IpcRequest<'handoff:read-with-minutes'>,
): Promise<IpcResponse<'handoff:read-with-minutes'>> {
  const dispatchService = getDispatch();
  const minutes = getMinutes();

  const row = dispatchService.findById(data.dispatchRowId);
  if (row === null) {
    throw new Error(
      `[handoff:read-with-minutes] no handoff_dispatch row for id ${data.dispatchRowId}`,
    );
  }
  const summary = rowToSummary(row);

  let minutesBody: string | null = null;
  if (row.minutesId !== null) {
    try {
      minutesBody = await minutes.readMinutesBody({
        meetingId: row.minutesId,
        ordinal: 1,
      });
    } catch (err) {
      console.warn(
        '[handoff:read-with-minutes] readMinutesBody threw',
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  const nextActions = extractNextActions(summary.package.missionCard.payload);

  return { item: summary, minutesBody, nextActions: [...nextActions] };
}

/**
 * R12-C2 T29 — 받는 부서 [의견 모아 회의 시작] 버튼 호출. 단일 entry — 4 단계
 * 동작:
 *   1. row read (미존재 throw)
 *   2. handoff:open mark (idempotent)
 *   3. MeetingService.start (받는 채널 + topic)
 *   4. orchestrator boot via factory (handoff context 동봉)
 *
 * 회의 시작 후 받는 부서 회의는 step 1 (gather) 부터 진행. handoff context 는
 * orchestrator 가 gather phase prompt builder 안 prepend 한다. caller (renderer)
 * 는 응답의 meeting row 받아 channel 활성 회의 surface 갱신.
 */
export async function handleHandoffStartMeetingFromPackage(
  data: IpcRequest<'handoff:start-meeting-from-package'>,
): Promise<IpcResponse<'handoff:start-meeting-from-package'>> {
  const dispatchService = getDispatch();
  const minutes = getMinutes();
  const meetingService = getMeeting();
  const channelService = getChannel();
  const factory = getOrchestratorFactory();

  // 1) row read.
  const row = dispatchService.findById(data.dispatchRowId);
  if (row === null) {
    throw new Error(
      `[handoff:start-meeting] no handoff_dispatch row for id ${data.dispatchRowId}`,
    );
  }

  // 2) opened_at mark (idempotent — 이미 set 이어도 silent OK).
  dispatchService.open(data.dispatchRowId, Date.now());

  // 3) 회의록 본문 read — 본 IPC 진입점이 단일이므로 본문 미존재면 invariant
  //    위반 (chain dispatch 시점에 회의록은 항상 land 됨). silent fallback 금지.
  if (row.minutesId === null) {
    throw new Error(
      `[handoff:start-meeting] handoff row ${row.id} has no minutesId — caller invariant violated`,
    );
  }
  const minutesBody = await minutes.readMinutesBody({
    meetingId: row.minutesId,
    ordinal: 1,
  });

  // 4) HandoffPackage inflate + nextActions extract.
  const summary = rowToSummary(row);
  const nextActions = extractNextActions(summary.package.missionCard.payload);

  // 5) 받는 채널 lookup (project_id resolve 위해).
  const receiverChannel = channelService.get(row.toChannelId);
  if (receiverChannel === null) {
    throw new Error(
      `[handoff:start-meeting] receiver channel ${row.toChannelId} not found`,
    );
  }
  if (receiverChannel.projectId === null) {
    throw new Error(
      `[handoff:start-meeting] receiver channel ${row.toChannelId} has no project — handoff target must be a project channel`,
    );
  }

  // 6) participants + ssmCtx 합성 — main/index.ts 가 wire 한 resolver 가
  //    channelService.listMembers + arenaRoot 의존성 처리.
  const resolver = getStartMeetingResolver();
  const participants = resolver.resolveParticipants(row.toChannelId);

  // 7) MeetingService.start — 받는 채널에 새 meeting row 생성.
  const meeting = meetingService.start({
    channelId: row.toChannelId,
    topic: data.topic,
  });

  const ssmCtx = resolver.buildSsmCtx({
    meetingId: meeting.id,
    channelId: row.toChannelId,
    projectId: receiverChannel.projectId,
  });

  // 8) handoff context system message 합성 — 보낸 부서 회의록 + 작업 list.
  const priorContextSystemMessage = composeHandoffContextSystemMessage({
    handoffPackage: summary.package,
    minutesBody,
    nextActions,
  });

  // 9) orchestrator factory 호출 — 기존 createAndRun 재사용 + priorContextSystemMessage
  //    옵션으로 session 안 첫 system message 직후에 prepend.
  await factory.createAndRun({
    meeting,
    projectId: receiverChannel.projectId,
    participants,
    topic: data.topic,
    ssmCtx,
    priorContextSystemMessage,
  });

  return { meeting };
}

/**
 * R12-C2 T29 — 받는 부서 회의의 첫 system message *직후* 에 prepend 되는 handoff
 * context 합성. provider history 안 두 번째 system message 로 들어가 직원이
 * 첫 turn 시 컨텍스트 잃지 않음.
 *
 * 본 helper 는 *순수* — 외부 IO X. 단위 테스트로 양식 보존.
 */
function composeHandoffContextSystemMessage(input: {
  handoffPackage: HandoffPackage;
  minutesBody: string;
  nextActions: readonly string[];
}): string {
  const lines: string[] = [];
  lines.push('[보낸 부서 인계 회의록]');
  lines.push('');
  lines.push(input.minutesBody.trim());
  lines.push('');
  lines.push('[당신이 처리할 작업]');
  if (input.nextActions.length === 0) {
    lines.push('(작업 list 없음 — 위 회의록 본문에서 자체 분배)');
  } else {
    for (const action of input.nextActions) {
      lines.push(`- ${action}`);
    }
  }
  lines.push('');
  lines.push('[인계 사유]');
  lines.push(input.handoffPackage.reason);
  lines.push('');
  lines.push(
    '위 인계 회의록 + 작업 list 보고 의견을 제시하세요. 응답 schema 는 별도 system message 안내.',
  );
  return lines.join('\n');
}
