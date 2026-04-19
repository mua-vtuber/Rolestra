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
