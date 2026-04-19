/**
 * Notification 도메인 타입 — migrations/011-notifications.ts 컬럼과 1:1 camelCase 매핑.
 */

export type NotificationKind =
  | 'new_message'
  | 'approval_pending'
  | 'work_done'
  | 'error'
  | 'queue_progress'
  | 'meeting_state';

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
