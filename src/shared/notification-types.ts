/**
 * Notification 도메인 타입 — migrations/011-notifications.ts 컬럼과 1:1 camelCase 매핑.
 */

export type NotificationKind =
  | 'new_message'
  | 'approval_pending'
  | 'work_done'
  | 'error'
  | 'queue_progress'
  | 'meeting_state'
  // R12-C2 T30 — 검토 부서가 끝나 리뷰 부서를 시작할 수 있을 때.
  | 'handoff_auto_review'
  // R12-C2 T34 — 대기열이 다음 작업을 시작했을 때.
  | 'queue_item_started'
  // R12-C2 T34 — 검토 결과 (승인 대기 / 기획 반려).
  | 'audit_result';

/** Kinds offered by the active chat notification controls. */
export type ChatNotificationKind = Extract<NotificationKind, 'new_message' | 'error'>;

/**
 * 알림 종류 전체 — migration 011 의 CHECK 목록에 029 가 세 종류를 더한 것과
 * 1:1 로 맞춘다. main 의 repository 가 빠진 pref row 를 채울 때, renderer 의
 * 설정 화면이 줄을 그릴 때 모두 이 목록 하나를 돌린다. 종류를 더하면서 이
 * 배열을 잊으면 `NotificationKind` union 과 어긋나 typecheck 가 깨진다
 * (아래 컴파일 단계 확인 참조).
 */
export const NOTIFICATION_KINDS = [
  'new_message',
  'approval_pending',
  'work_done',
  'error',
  'queue_progress',
  'meeting_state',
  // R12-C2 (migration 029)
  'handoff_auto_review',
  'queue_item_started',
  'audit_result',
] as const satisfies readonly NotificationKind[];

/**
 * 컴파일 단계 확인 — 위 배열이 `NotificationKind` 를 전부 담는지 본다.
 * 종류를 union 에만 더하고 배열에 빠뜨리면 이 줄에서 타입 오류가 난다.
 */
type _NotificationKindsAreComplete =
  Exclude<NotificationKind, (typeof NOTIFICATION_KINDS)[number]> extends never
    ? true
    : never;
const _notificationKindsAreComplete: _NotificationKindsAreComplete = true;
void _notificationKindsAreComplete;

export type NotificationPrefs = {
  [K in NotificationKind]: { enabled: boolean; soundEnabled: boolean };
};

export interface NotificationLogEntry {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  channelId: string | null;
  clicked: boolean;
  createdAt: number;
}
