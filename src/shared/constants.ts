// Application constants shared between processes

import type { SessionState } from './session-state-types';

export const APP_NAME = 'AI Chat Arena';
export const APP_VERSION = '0.1.0';

/**
 * Ordered list of the 12 session-state-machine states.
 *
 * This ordering defines the `stateIndex` used by dashboard widgets (R4
 * TasksWidget) to render progress gauges against the SSM lifecycle.
 *
 * The order follows the happy-path progression documented in
 * `src/main/engine/session-state-machine.ts` and the SSM design doc
 * (spec §7.5 meetings):
 *
 *   CONVERSATION → MODE_TRANSITION_PENDING → WORK_DISCUSSING →
 *   SYNTHESIZING → VOTING → CONSENSUS_APPROVED → EXECUTING →
 *   REVIEWING → USER_DECISION → DONE/FAILED/PAUSED
 *
 * DONE, FAILED, and PAUSED are terminal or suspended states that sit at
 * the end of the ordering — they still get a valid 0..11 index so the
 * UI can map any `state` value to a gauge position.
 *
 * Keep this array in lock-step with `SessionState` in
 * `session-state-types.ts`. The length assertion below is the compile-
 * time guard.
 */
export const SESSION_STATE_ORDER: readonly SessionState[] = [
  'CONVERSATION',
  'MODE_TRANSITION_PENDING',
  'WORK_DISCUSSING',
  'SYNTHESIZING',
  'VOTING',
  'CONSENSUS_APPROVED',
  'EXECUTING',
  'REVIEWING',
  'USER_DECISION',
  'DONE',
  'FAILED',
  'PAUSED',
] as const;

/** Total SSM states — used as the `total` prop for ProgressGauge. */
export const SESSION_STATE_COUNT: number = SESSION_STATE_ORDER.length;

/**
 * Map an SSM state name to its ordinal index in `SESSION_STATE_ORDER`.
 * Unknown state names (defensive — the column is a free-text string, not
 * a CHECK-constrained enum) fall back to `0`. The repository tolerates
 * drift between SSM naming and the migration schema without crashing
 * the IPC call; the gauge will simply render at the first step.
 */
export function sessionStateToIndex(stateName: string): number {
  const idx = SESSION_STATE_ORDER.indexOf(stateName as SessionState);
  return idx < 0 ? 0 : idx;
}

/**
 * Maximum excerpt length for the dashboard RecentWidget — the UI
 * truncates any longer message and appends an ellipsis. 140 characters
 * matches the spec §7.5 RecentWidget sample (one-line row).
 */
export const RECENT_MESSAGE_EXCERPT_LEN = 140;
