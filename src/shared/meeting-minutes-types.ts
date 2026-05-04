/**
 * MeetingMinutes 도메인 타입 — R12-C2 P2-3.
 *
 * step 5 모더레이터 회의록 작성의 입출력. 모더레이터 응답은 자유 markdown
 * 본문 (JSON schema 강제 X) — service 가 prompt 양식 + truncate 검출만
 * 책임진다 (spec §11.18.6 + §11.18.7).
 *
 * 저장 경로 = `<ArenaRoot>/consensus/meetings/<meetingId>/minutes.md`.
 * spec §11.18.6 의 informal 표현 (`<ArenaRoot>/<projectId>/consensus/...`)
 * 과 달리 코드베이스의 실제 invariant — `arenaRoot.consensusPath()` 안
 * `meetings/` 서브디렉터리가 boot 시점에 ensure 됨 — 를 진실원천으로 따른다.
 *
 * spec docs/superpowers/specs/2026-05-01-rolestra-channel-roles-design.md
 *   - §11.18.6 step 5 모더레이터 prompt
 *   - §11.18.7 truncate 검출 + fallback
 */

/**
 * 회의록 본문이 어떻게 만들어졌는지. caller (T10 orchestrator + 채팅창
 * 카드) 가 사용자에게 출처를 명시할 때 활용. fallback 경로도 audit 가능한
 * 명시값 — silent fallback 금지 (CLAUDE.md mock/fallback rule).
 */
export type MeetingMinutesSource =
  /** 모더레이터 1 차 응답 사용 (truncate 검출 PASS). */
  | 'moderator'
  /** 모더레이터 2 차 응답 사용 (1 차가 truncate 의심 → 재요청 후 PASS). */
  | 'moderator-retry'
  /**
   * deterministic fallback. 모더레이터 호출 실패 또는 두 번 연속 truncate
   * 의심 시. opinion + opinion_vote 통째로 재구성한 markdown.
   */
  | 'fallback';

/** compose() 입력. */
export interface MeetingMinutesComposeInput {
  meetingId: string;
}

/**
 * compose() 결과. caller 는 `body` 그대로 채팅창 카드 + 큐 트리거 입력으로
 * 사용. `minutesPath` 는 사용자가 markdown 파일 직접 열기 / 외부 도구 연동
 * 필요할 때 안내용.
 */
export interface MeetingMinutesComposeResult {
  /** 회의록 markdown 본문 (모더레이터 응답 또는 deterministic fallback). */
  body: string;
  /** 본문이 어떤 경로로 만들어졌는지. */
  source: MeetingMinutesSource;
  /** 모더레이터 응답 producer. fallback 시 null. */
  providerId: string | null;
  /** 저장된 minutes.md 절대 경로. */
  minutesPath: string;
  /**
   * truncate 검출 한 번이라도 발생했는지. true 인 경우 `source` 는
   * `'moderator-retry'` 또는 `'fallback'`. 사용자 안내 / dev tools 진단용.
   */
  truncationDetected: boolean;
}
