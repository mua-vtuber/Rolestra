/**
 * meeting:* IPC handlers.
 *
 * Exposed channels:
 *   - `meeting:abort`       — user gesture to tear down a stuck meeting.
 *   - `meeting:list-active` — R4 dashboard TasksWidget fetch (spec §7.5).
 *
 * Start flows through `channel:start-meeting`; finish happens inside the
 * meeting orchestrator engine. Abort is surfaced here so the user can exit
 * a stuck meeting without waiting for the engine to reach a terminal state.
 *
 * Both active-listing and abort share the same MeetingService accessor
 * — the service owns the repository handle and list semantics.
 *
 * R12-C2 T10b: 옛 `meeting:voting-history` 핸들러 제거 — SSM 투표 snapshot
 * 흐름이 폐기되어 voting-history 프로젝션의 데이터 소스가 사라졌다. 새 의견
 * 모델의 표결 surface 는 P3/R12-H 에서 별도 IPC 로 재정의.
 */

import type { IpcRequest, IpcResponse } from '../../../shared/ipc-types';
import type { MeetingService } from '../../meetings/meeting-service';
import { getOrchestrator } from '../../meetings/engine/meeting-orchestrator-registry';

let meetingAccessor: (() => MeetingService) | null = null;

export function setMeetingAbortServiceAccessor(
  fn: () => MeetingService,
): void {
  meetingAccessor = fn;
}

function getService(): MeetingService {
  if (!meetingAccessor) {
    throw new Error('meeting handler: service not initialized');
  }
  return meetingAccessor();
}

/** meeting:abort */
export function handleMeetingAbort(
  data: IpcRequest<'meeting:abort'>,
): IpcResponse<'meeting:abort'> {
  // R6-Task4: tear down the live orchestrator first so no in-flight
  // turn lands on top of the "aborted" DB state. `stop()` aborts the
  // provider request + freezes the session; the orchestrator's
  // terminal listener runs only on SSM terminal states (which abort
  // does NOT trigger), so the row update below is the authoritative
  // close.
  const orc = getOrchestrator(data.meetingId);
  orc?.stop();
  getService().finish(data.meetingId, 'aborted', null);
  return { success: true };
}

/** meeting:list-active — R4 dashboard TasksWidget. */
export function handleMeetingListActive(
  data: IpcRequest<'meeting:list-active'>,
): IpcResponse<'meeting:list-active'> {
  // `data` is `{ limit? } | undefined` — preserve the distinction between
  // "caller omitted the field" and "caller passed 0" (the repository
  // clamp treats 0 as "at least 1" rather than "unset default"). Passing
  // `undefined` through lets the repo's default (10) kick in.
  const meetings = getService().listActive(data?.limit);
  return { meetings };
}

// R12-C2 T10b: handleMeetingVotingHistory 제거 — IPC 채널 자체도 같은
// commit 안에서 ipc-types/ipc-schemas/router 에서 제거됨.
