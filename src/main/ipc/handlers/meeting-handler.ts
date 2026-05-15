/**
 * meeting:* IPC handlers.
 *
 * Exposed channels:
 *   - `meeting:abort`                    — user gesture to tear down a stuck meeting.
 *   - `meeting:list-active`              — R4 dashboard TasksWidget fetch (spec §7.5).
 *   - `meeting:idea-finalize-selection`  — R12-C2 T15 idea-workflow USER_PICK commit.
 *   - `meeting:idea-request-more`        — R12-C2 card UX 추가 아이디어 수집.
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
 *
 * R12-C2 T15: idea-finalize-selection 핸들러 — 사용자가 카드 선택 / 자유
 * 코멘트 commit 시 OpinionService.finalizeIdeaSelection 호출 + orchestrator
 * 의 awaiting_user_pick suspend 풀어 compose_minutes 진입.
 */

import type { IpcRequest, IpcResponse } from '../../../shared/ipc-types';
import type { MeetingService } from '../../meetings/meeting-service';
import {
  IdeaPickValidationError,
  UnknownScreenIdError,
} from '../../meetings/opinion-service';
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

/**
 * R12-C2 T15: idea-workflow USER_PICK commit 핸들러. spec §5.1.
 *
 * 흐름:
 *   1. orchestrator lookup — 회의 ID 매핑
 *   2. orchestrator.submitIdeaPick(input) 호출 — 동기적으로
 *      OpinionService.finalizeIdeaSelection 실행 + ideaPending.commit
 *   3. 결과를 IPC 응답에 매핑 — 성공 / 검증 실패 / 잘못된 phase / 알 수 없는
 *      meeting / 알 수 없는 화면 ID 분기
 *
 * 본 핸들러는 OpinionService 직접 의존 X — orchestrator 가 service 를
 * 보유하므로 thin wrapper. accessor 추가 X.
 */
export function handleMeetingIdeaFinalizeSelection(
  data: IpcRequest<'meeting:idea-finalize-selection'>,
): IpcResponse<'meeting:idea-finalize-selection'> {
  const orc = getOrchestrator(data.meetingId);
  if (!orc) {
    return {
      ok: false,
      reason: 'meeting_not_found',
      message: `meeting "${data.meetingId}" has no live orchestrator`,
    };
  }
  try {
    const result = orc.submitIdeaPick({
      meetingId: data.meetingId,
      selectedScreenIds: data.selectedScreenIds,
      userComment: data.userComment,
    });
    return {
      ok: true,
      agreedIds: result.agreedIds,
      excludedIds: result.excludedIds,
      userOpinionId: result.userOpinion?.id ?? null,
    };
  } catch (err) {
    if (err instanceof IdeaPickValidationError) {
      return {
        ok: false,
        reason: 'idea_pick_validation',
        message: err.message,
      };
    }
    if (err instanceof UnknownScreenIdError) {
      return {
        ok: false,
        reason: 'unknown_screen_id',
        message: err.message,
      };
    }
    // submitIdeaPick 의 wrong-phase / not-running 분기 — Error message 안에
    // 'is not in awaiting_user_pick phase' / 'is not running' substring.
    if (err instanceof Error) {
      if (
        err.message.includes('awaiting_user_pick') ||
        err.message.includes('is not running')
      ) {
        return {
          ok: false,
          reason: 'wrong_phase',
          message: err.message,
        };
      }
    }
    // 기타 예상치 못한 에러는 propagate — IPC 라우터가 generic 500 으로
    // 매핑 (silent fallback 금지 invariant).
    throw err;
  }
}

/** R12-C2 card UX: 선택 유지 + 추가 아이디어 수집. */
export function handleMeetingIdeaRequestMore(
  data: IpcRequest<'meeting:idea-request-more'>,
): IpcResponse<'meeting:idea-request-more'> {
  const orc = getOrchestrator(data.meetingId);
  if (!orc) {
    return {
      ok: false,
      reason: 'meeting_not_found',
      message: `meeting "${data.meetingId}" has no live orchestrator`,
    };
  }
  try {
    const result = orc.requestMoreIdeas({
      meetingId: data.meetingId,
      selectedScreenIds: data.selectedScreenIds,
      userComment: data.userComment,
    });
    return {
      ok: true,
      selectedIds: result.selectedIds,
      userOpinionId: result.userOpinion?.id ?? null,
    };
  } catch (err) {
    if (err instanceof IdeaPickValidationError) {
      return {
        ok: false,
        reason: 'idea_pick_validation',
        message: err.message,
      };
    }
    if (err instanceof UnknownScreenIdError) {
      return {
        ok: false,
        reason: 'unknown_screen_id',
        message: err.message,
      };
    }
    if (err instanceof Error) {
      if (
        err.message.includes('awaiting_user_pick') ||
        err.message.includes('is not running')
      ) {
        return {
          ok: false,
          reason: 'wrong_phase',
          message: err.message,
        };
      }
    }
    throw err;
  }
}
