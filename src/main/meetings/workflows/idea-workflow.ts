/**
 * idea-workflow — R12-C2 P3 T15 land. spec §5.1.
 *
 * 아이디어 부서 (channel.role === 'idea') 회의의 D-B-Light + USER_PICK
 * 흐름. 풀세트 부서 (planning / design / review / audit) 와 다음 차이:
 *
 *   풀세트:  gather → tally → quick_vote → free_discussion(반복) →
 *            compose_minutes → handoff
 *   idea:    gather → tally → awaiting_user_pick →
 *            compose_minutes → handoff
 *
 * step 2.5 (일괄 동의 투표) / step 3 (자유 토론) / step 4 (반복) 모두
 * surface X — 직원 발화는 step 1 (gather) 에서 끝나고, 의견 처리 권한은
 * 사용자 단독.
 *
 * `awaiting_user_pick` phase 는 직원 발화 X / 사용자 IPC 입력 대기. 본
 * 모듈은 *suspend promise* (`IdeaUserPickPending`) 를 통해 orchestrator
 * 의 phase loop 가 IPC 응답까지 정지하도록 한다.
 *
 * 본 모듈은 orchestrator 의 thin extension 으로 설계 — orchestrator 안 helper
 * fields (session / opinionService / 등) 에 직접 접근하지 않고, 호출자가
 * 명시적으로 deps 를 넘겨주는 함수 시그니처. 테스트 격리에도 유리.
 *
 * spec docs/superpowers/specs/2026-05-01-rolestra-channel-roles-design.md
 *  - §4   부서별 회의 흐름 매트릭스 (idea = D-B-Light + USER_PICK)
 *  - §5.1 아이디어 부서 D-B-Light + USER_PICK (T15 정식)
 *  - §11.18.7 awaiting_user_pick = 직원 응답 X / 사용자 IPC 입력만
 */

import type {
  IdeaFinalizeSelectionInput,
  IdeaFinalizeSelectionResult,
} from '../../../shared/opinion-types';

// ── Pending state — suspend promise 관리 ─────────────────────────────

/**
 * 사용자 IPC 응답까지 idea-workflow phase loop 가 정지하도록 만드는
 * promise holder. orchestrator 가 awaiting_user_pick phase 진입 시
 * `await pending.wait()` 로 IPC 응답을 기다리고, IPC 핸들러가
 * `pending.commit(input)` 호출 시 promise 가 resolve 되며 phase loop
 * 가 재개된다.
 *
 * abort 시 `pending.cancel('aborted')` → reject → orchestrator finalize.
 *
 * 단일 사용 — 한 회의 lifetime 안에서 1 회만 wait/commit. commit 후
 * 재사용 X (re-commit 은 caller 책임으로 차단).
 */
export class IdeaUserPickPending {
  private resolveFn: ((input: IdeaFinalizeSelectionInput) => void) | null = null;
  private rejectFn: ((reason: IdeaUserPickAbortReason) => void) | null = null;
  private settled = false;

  /**
   * 사용자 IPC 응답까지 정지 — orchestrator 가 awaiting_user_pick phase
   * 진입 직후 호출. 응답 시 IdeaFinalizeSelectionInput 반환.
   */
  wait(): Promise<IdeaFinalizeSelectionInput> {
    if (this.settled) {
      throw new Error(
        '[IdeaUserPickPending] wait() called on settled instance — pending state is single-use',
      );
    }
    return new Promise<IdeaFinalizeSelectionInput>((resolve, reject) => {
      this.resolveFn = resolve;
      this.rejectFn = reject;
    });
  }

  /** IPC 핸들러가 사용자 입력 받아 호출 — phase loop 재개 신호. */
  commit(input: IdeaFinalizeSelectionInput): void {
    if (this.settled) {
      throw new Error(
        '[IdeaUserPickPending] commit() called on settled instance — duplicate commit',
      );
    }
    if (!this.resolveFn) {
      throw new Error(
        '[IdeaUserPickPending] commit() called before wait() — no pending promise',
      );
    }
    this.settled = true;
    this.resolveFn(input);
    this.resolveFn = null;
    this.rejectFn = null;
  }

  /** abort / cancel — orchestrator.stop() 시 호출. */
  cancel(reason: IdeaUserPickAbortReason): void {
    if (this.settled) return;
    if (this.rejectFn) {
      this.settled = true;
      this.rejectFn(reason);
      this.resolveFn = null;
      this.rejectFn = null;
    }
  }

  get isSettled(): boolean {
    return this.settled;
  }

  get isWaiting(): boolean {
    return !this.settled && this.resolveFn !== null;
  }
}

/** abort reason — orchestrator 가 reject 시 분기. */
export type IdeaUserPickAbortReason =
  | { kind: 'aborted' }
  | { kind: 'replaced'; message: string };

// ── Snapshot — gather → tally 결과 요약 ─────────────────────────────

/**
 * tally 직후 awaiting_user_pick 진입 시 stream / SsmBox 에 push 되는
 * 카드 list 요약. UI 측은 이 snapshot 받아 카드 list + 선택 체크 +
 * 코멘트 textarea 를 surface.
 *
 * spec §11.13 idea variant SsmBox layout:
 *   - 의견 list (kind='root' 만)
 *   - 진행 상황 X (step 2 까지만, surface X)
 *   - 사용자 선택 체크 마크
 */
export interface IdeaPickSnapshot {
  meetingId: string;
  channelId: string;
  /** root 카드 list — kind='root' 만 (자식 의견은 idea 흐름에서 발생 X). */
  cards: Array<{
    /** 화면 ID (예: `ITEM_001`). UI 가 IPC 응답에서 selectedScreenIds 로 보냄. */
    screenId: string;
    /** UUID — UI 가 mapping 필요 시 reference (보통은 screenId 만 사용). */
    uuid: string;
    title: string;
    content: string;
    rationale: string;
    authorLabel: string;
    /** provider id (예: 'codex' / 'claude' / 'gemini'). UI 가 발의자 표시. */
    authorProviderId: string | null;
  }>;
}

// ── 결과 타입 ─────────────────────────────────────────────────────

/**
 * idea-workflow 진행 결과 — orchestrator 가 finalize 단계에서 outcome
 * 반환에 활용.
 */
export interface IdeaWorkflowResult {
  meetingId: string;
  outcome: 'committed' | 'aborted';
  /** outcome === 'committed' 일 때만. 사용자 commit 결과 (agreed / excluded / userOpinion). */
  finalize?: IdeaFinalizeSelectionResult;
  /** outcome === 'aborted' 일 때만. abort 사유. */
  abortReason?: IdeaUserPickAbortReason;
}
