/**
 * meeting:* IPC handlers.
 *
 * Exposed channels:
 *   - `meeting:abort`                    — user gesture to tear down a stuck meeting.
 *   - `meeting:list-active`              — R4 dashboard TasksWidget fetch (spec §7.5).
 *   - `meeting:idea-finalize-selection`  — R12-C2 T15 idea-workflow USER_PICK commit.
 *   - `meeting:idea-request-more`        — R12-C2 card UX 추가 아이디어 수집.
 *   - `meeting:request-stop`             — 결재 2번 (A, 2026-05-19) graceful 종료 요청.
 *   - `meeting:edit-topic`               — 결재 2번 (A, 2026-05-19) 회의 주제 inline 편집.
 *   - `meeting:pause` / `meeting:resume` — 결재 2번 (A, 2026-05-19) 일시정지 / 재개.
 *   - `meeting:llm-summarize`            — 결재 2번 (A, 2026-05-19) LLM 1단락 자동 정리.
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
 *
 * 결재 2번 (A, 2026-05-19): 죽은 IPC 5채널 (request-stop / edit-topic /
 * pause / resume / llm-summarize) 실제 wire. spec D-A T2 + R10-Task11 명세는
 * 이미 있었으나 4주간 IPC schema 만 등록되고 handler 부재 — CLAUDE.md 절대
 * 규칙 ("있는 듯 보이지만 실은 없는 기능" 금지) 위반 해소.
 */

import type { IpcRequest, IpcResponse } from '../../../shared/ipc-types';
import type { MeetingService } from '../../meetings/meeting-service';
import type { MeetingMinutesService } from '../../meetings/meeting-minutes-service';
import type { MeetingSummaryService } from '../../llm/meeting-summary-service';
import { MeetingNotFoundError } from '../../meetings/meeting-service';
import {
  IdeaPickValidationError,
  UnknownScreenIdError,
} from '../../meetings/opinion-service';
import { getOrchestrator } from '../../meetings/engine/meeting-orchestrator-registry';

let meetingAccessor: (() => MeetingService) | null = null;
let minutesAccessor: (() => MeetingMinutesService) | null = null;
let summaryAccessor: (() => MeetingSummaryService) | null = null;

export function setMeetingAbortServiceAccessor(
  fn: () => MeetingService,
): void {
  meetingAccessor = fn;
}

/**
 * 결재 2번 (A, 2026-05-19) — `meeting:llm-summarize` 가 회의록 본문 read 에
 * 필요. setup wire 위치는 src/main/index.ts (MeetingMinutesService 생성 직후).
 */
export function setMeetingMinutesAccessorForHandler(
  fn: () => MeetingMinutesService,
): void {
  minutesAccessor = fn;
}

/**
 * 결재 2번 (A, 2026-05-19) — `meeting:llm-summarize` 가 LLM 호출에 필요.
 * setup wire 위치는 src/main/index.ts (MeetingSummaryService 생성 직후).
 */
export function setMeetingSummaryAccessorForHandler(
  fn: () => MeetingSummaryService,
): void {
  summaryAccessor = fn;
}

function getService(): MeetingService {
  if (!meetingAccessor) {
    throw new Error('meeting handler: service not initialized');
  }
  return meetingAccessor();
}

function getMinutesService(): MeetingMinutesService {
  if (!minutesAccessor) {
    throw new Error('meeting handler: minutes service not initialized');
  }
  return minutesAccessor();
}

function getSummaryService(): MeetingSummaryService {
  if (!summaryAccessor) {
    throw new Error('meeting handler: summary service not initialized');
  }
  return summaryAccessor();
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

// ── 결재 2번 (A, 2026-05-19) — 5 IPC 채널 wire ─────────────────────────

/**
 * `meeting:request-stop` — graceful 종료 요청.
 *
 * spec 의도: `abort` 와 다른 점 — abort 는 즉시 강제 중단 + 회의록 미생성,
 * request-stop 은 graceful (다음 turn 경계에서 partial 회의록 생성 후 종료).
 *
 * 현재 wire 단계: outcome 은 `aborted` 로 통일 (MeetingOutcome union 에
 * `'stopped'` 추가는 migration + spec 확장이 필요 — 본 결재 항목 scope 밖).
 * orchestrator.stop() 호출로 in-flight turn 정리 + service.finish() 로
 * 마감. partial 회의록 turn-boundary 보강은 후속 단계 (spec D-A T9 wire
 * 시점) 에서 별 outcome literal 도입과 함께. 마감된 회의에 더블 클릭한
 * 경우 MeetingNotFoundError 는 silent 차단 (UI 가 이미 종료 표시).
 */
export function handleMeetingRequestStop(
  data: IpcRequest<'meeting:request-stop'>,
): IpcResponse<'meeting:request-stop'> {
  const orc = getOrchestrator(data.meetingId);
  orc?.stop();
  const stoppedAt = Date.now();
  try {
    getService().finish(data.meetingId, 'aborted', null);
  } catch (err) {
    if (err instanceof MeetingNotFoundError) {
      // 이미 종료된 회의 — race / 더블 클릭 방어.
    } else {
      throw err;
    }
  }
  return { stoppedAt };
}

/**
 * `meeting:edit-topic` — 진행 중 회의의 topic inline 편집.
 *
 * service.updateTopic 가 종료된 회의 race 차단 (MeetingNotFoundError 발생
 * 시 propagate — UI 가 inline editor 닫기). 응답에는 갱신된 topic 그대로
 * echo back 해 caller 가 optimistic state 와 비교.
 */
export function handleMeetingEditTopic(
  data: IpcRequest<'meeting:edit-topic'>,
): IpcResponse<'meeting:edit-topic'> {
  const updated = getService().updateTopic(data.meetingId, data.topic);
  return { topic: updated.topic };
}

/**
 * `meeting:pause` — 진행 중 회의 일시정지.
 *
 * 영속 측 (paused_at 컬럼) 갱신 + orchestrator in-memory flag 토글 둘 다.
 * orchestrator 가 없는 경우 (회의가 process restart 후 복원되지 않은 상태)
 * DB 만 갱신 — 다음 orchestrator boot 시 paused_at 으로 복원.
 */
export function handleMeetingPause(
  data: IpcRequest<'meeting:pause'>,
): IpcResponse<'meeting:pause'> {
  const pausedAt = getService().pause(data.meetingId);
  getOrchestrator(data.meetingId)?.pause();
  return { pausedAt };
}

/**
 * `meeting:resume` — 일시정지된 회의 재개.
 *
 * paused_at = NULL + orchestrator flag false. orchestrator 가 없는 경우
 * DB 만 갱신 (호출자가 paused 상태 회의 화면을 닫고 다시 진입한 시나리오).
 */
export function handleMeetingResume(
  data: IpcRequest<'meeting:resume'>,
): IpcResponse<'meeting:resume'> {
  const resumedAt = getService().resume(data.meetingId);
  getOrchestrator(data.meetingId)?.resume();
  return { resumedAt };
}

/**
 * `meeting:llm-summarize` — R10-Task11 + 결재 2번 (A, 2026-05-19) wire.
 *
 * 흐름:
 *   1. minutes service 로 회의록 본문 read (ordinal=1 = 첫 minutes 파일)
 *   2. summary service 로 1단락 요약 — providerId 지정 또는 summarize
 *      capability true fallback chain (D7)
 *   3. 결과 매핑:
 *      - summary 있음 → reason='ok'
 *      - summary null + providerId null → reason='no_provider'
 *      - summary null + providerId 있음 → reason='provider_error'
 *      ('disabled' reason 은 향후 settings.llmAutoCleanup off 도입 시 wire.)
 *
 * 본 handler 는 throw 하지 않음 — minutes 본문 read 실패 시도 reason 으로
 * 매핑 (silent fallback 차단 vs 노출 정직성 trade-off — minutes 본문 자체
 * 부재는 'no_provider' 와 다른 명시적 'provider_error' reason 으로 노출).
 */
export async function handleMeetingLlmSummarize(
  data: IpcRequest<'meeting:llm-summarize'>,
): Promise<IpcResponse<'meeting:llm-summarize'>> {
  let body: string;
  try {
    body = await getMinutesService().readMinutesBody({
      meetingId: data.meetingId,
      ordinal: 1,
    });
  } catch (err) {
    console.warn('[meeting:llm-summarize] minutes body read failed', {
      meetingId: data.meetingId,
      message: err instanceof Error ? err.message : String(err),
    });
    return { summary: null, providerUsed: null, reason: 'provider_error' };
  }
  const result = await getSummaryService().summarize(body, {
    preferredProviderId: data.providerId ?? null,
    meetingId: data.meetingId,
  });
  if (result.summary) {
    return {
      summary: result.summary,
      providerUsed: result.providerId,
      reason: 'ok',
    };
  }
  if (result.providerId === null) {
    return { summary: null, providerUsed: null, reason: 'no_provider' };
  }
  return {
    summary: null,
    providerUsed: result.providerId,
    reason: 'provider_error',
  };
}
