/**
 * Meeting 도메인 타입 — migrations/004-meetings.ts 컬럼과 1:1 camelCase 매핑.
 */

export type MeetingOutcome = 'accepted' | 'rejected' | 'aborted';

export interface Meeting {
  id: string;
  channelId: string;
  topic: string;
  state: string;                    // SSM 상태 이름
  stateSnapshotJson: string | null;
  startedAt: number;
  endedAt: number | null;
  outcome: MeetingOutcome | null;
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
}
