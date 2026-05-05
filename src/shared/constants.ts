// Application constants shared between processes

import {
  MEETING_PHASE_ORDER,
  type MeetingPhase,
} from './meeting-flow-types';

export const APP_NAME = 'AI Chat Arena';
export const APP_VERSION = '0.1.0';

/**
 * Ordered list of meeting phase strings.
 *
 * R12-C2 T10b: 옛 SSM 12-state 모델 폐기 — 새 phase loop (8 phase) 로
 * 진행. 본 상수는 dashboard widgets (R4 TasksWidget), MeetingBanner,
 * 옛 SsmBox placeholder 가 stateIndex / SESSION_STATE_COUNT 로 progress
 * gauge 를 그릴 때 reference. 진실 원천은 `meeting-flow-types.ts` 의
 * {@link MEETING_PHASE_ORDER}.
 *
 * 진행: gather → tally → quick_vote → free_discussion → compose_minutes →
 *       handoff → done | aborted
 *
 * P3/R12-H 에서 SsmBox 재설계 시 본 상수를 phase 기반 progress 표현으로
 * 새로 사용한다.
 */
export const SESSION_STATE_ORDER: readonly MeetingPhase[] = MEETING_PHASE_ORDER;

/** Total phase 수 — 옛 SsmBox / TasksWidget / MeetingBanner 의 `total` prop. */
export const SESSION_STATE_COUNT: number = SESSION_STATE_ORDER.length;

/**
 * Map a phase name to its ordinal index in {@link SESSION_STATE_ORDER}.
 * Unknown state names (defensive — the column is a free-text string, not
 * a CHECK-constrained enum) fall back to `0`. The repository tolerates
 * drift between phase naming and the migration schema without crashing
 * the IPC call; the gauge will simply render at the first step.
 */
export function sessionStateToIndex(stateName: string): number {
  const idx = SESSION_STATE_ORDER.indexOf(stateName as MeetingPhase);
  return idx < 0 ? 0 : idx;
}

/**
 * Maximum excerpt length for the dashboard RecentWidget — the UI
 * truncates any longer message and appends an ellipsis. 140 characters
 * matches the spec §7.5 RecentWidget sample (one-line row).
 */
export const RECENT_MESSAGE_EXCERPT_LEN = 140;
