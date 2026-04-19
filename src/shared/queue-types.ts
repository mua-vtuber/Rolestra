/**
 * Queue 도메인 타입 — migrations/007-queue.ts 컬럼 및 서킷 브레이커 런타임 상태.
 */

export type QueueItemStatus = 'pending' | 'in_progress' | 'done' | 'failed' | 'cancelled' | 'paused';

export interface QueueItem {
  id: string;
  projectId: string;
  targetChannelId: string | null;
  orderIndex: number;
  prompt: string;
  status: QueueItemStatus;
  startedMeetingId: string | null;
  startedAt: number | null;
  finishedAt: number | null;
  lastError: string | null;
  createdAt: number;
}

export interface CircuitBreakerLimits {
  filesChangedPerTurn: number;   // 기본 20
  cumulativeCliMs: number;       // 기본 30분
  consecutiveQueueRuns: number;  // 기본 5
  sameErrorRepeats: number;      // 기본 3
}

export interface CircuitBreakerState {
  filesChangedThisTurn: number;
  cumulativeCliMs: number;
  consecutiveQueueRuns: number;
  recentErrorCategory: string | null;
  recentErrorCount: number;
}
