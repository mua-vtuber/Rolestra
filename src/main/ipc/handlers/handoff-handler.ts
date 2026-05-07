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

let pendingAccessor: (() => HandoffPendingState) | null = null;
let dispatchAccessor: (() => HandoffDispatchService) | null = null;
let streamAccessor: (() => StreamBridge) | null = null;

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
