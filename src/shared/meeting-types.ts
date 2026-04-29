/**
 * Meeting 도메인 타입 — migrations/004-meetings.ts + 016-meeting-paused-and-kind.ts
 * 컬럼과 1:1 camelCase 매핑.
 */

export type MeetingOutcome = 'accepted' | 'rejected' | 'aborted';

/**
 * D-A T1+T2: 회의 트리거 종류.
 *
 * - `manual`: 사용자가 [회의 시작] 버튼을 눌러 시작한 회의 (R1~R11 default).
 * - `auto`: D-A 메시지 자동 트리거가 시작한 회의 (시스템채널 / 일반채널 메시지
 *   감지 시 자동 소집).
 *
 * lifecycle / 동작 분기는 없음 — 통계 / debug / UI 표시 (예: 회의록 헤더
 * "자동 소집") 용. DB CHECK 제약 일치.
 */
export type MeetingKind = 'manual' | 'auto';

export interface Meeting {
  id: string;
  channelId: string;
  topic: string;
  state: string;                    // SSM 상태 이름
  stateSnapshotJson: string | null;
  startedAt: number;
  endedAt: number | null;
  outcome: MeetingOutcome | null;
  /** D-A: 일시정지 시각 (ms epoch). null = 일시정지 아님. */
  pausedAt: number | null;
  /** D-A: 회의 트리거 종류 ('manual' = 사용자 클릭, 'auto' = 메시지 자동). */
  kind: MeetingKind;
}

/**
 * Active meeting summary for the R4 dashboard TasksWidget (spec §7.5).
 *
 * Joins `meetings` with `projects` / `channels` so the widget can render a
 * row without a second IPC round-trip per meeting. The `stateIndex` is
 * derived from the SSM ordered state list — see
 * `src/shared/constants.ts::SESSION_STATE_ORDER`.
 */
export interface ActiveMeetingSummary {
  id: string;
  projectId: string | null;         // DM meetings have null
  projectName: string | null;       // mirrors projectId; null for DMs
  channelId: string;
  channelName: string;
  topic: string;
  /** Ordinal position in `SESSION_STATE_ORDER` (0..11) for progress gauges. */
  stateIndex: number;
  /** Raw SSM state name (e.g. `"WORK_DISCUSSING"`). */
  stateName: string;
  startedAt: number;
  /** `Date.now() - startedAt` computed at repository read. */
  elapsedMs: number;
  /** D-A: 일시정지 시각 (ms epoch). null = active running. */
  pausedAt: number | null;
}
