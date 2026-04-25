/**
 * Approval 상세 패널 (R11-Task7) 도메인 타입 (R11-Task5 에서 선반영).
 *
 * 기존 `ApprovalItem` 은 list 용 1-row. 사용자가 카드 한 장을 클릭하면
 * `approval:detail-fetch` 가 (a) impacted files (b) diff preview 일부
 * (c) consensus 투표 맥락을 한 번에 반환한다. 각 필드는 별 경로로 모이는데
 * 패널 진입 시 라운드트립 1번에 다 끌어오기 위한 합집합 타입이다.
 */

import type { ApprovalItem } from './approval-types';

/**
 * 단일 영향 파일의 변경 통계.
 *
 * - `addedLines` / `removedLines` — diff hunk 합산. `changeKind='deleted'`
 *   인 경우 addedLines=0, `changeKind='added'` 인 경우 removedLines=0.
 * - `changeKind` — git diff 의 status 와 동일한 3-tuple. rename 은 별도
 *   처리하지 않고 (delete + add) 로 분해해서 보고한다.
 */
export interface ApprovalImpactedFile {
  path: string;
  addedLines: number;
  removedLines: number;
  changeKind: 'modified' | 'added' | 'deleted';
}

/**
 * diff preview 한 hunk. `truncated=true` 면 첫 N줄(R11-Task7 결정 — 200줄
 * 권장)만 잘라서 보낸 상태이며 패널은 "전체 보기" CTA 를 노출한다.
 */
export interface ApprovalDiffPreview {
  path: string;
  preview: string;
  truncated: boolean;
}

/**
 * 합의 맥락 — 회의 발신 approval 일 때만 의미가 있다.
 *
 * - `meetingId` — null 이면 stand-alone approval (autonomy circuit_breaker /
 *   manual mode_transition 등). UI 는 "회의 없음" 라벨 표시.
 * - `participantVotes` — 각 참여자가 합의 turn 에서 던진 표. comment 는
 *   optional — 의견 없이 찬/반/기권만 한 경우 생략된다.
 */
export interface ApprovalConsensusContext {
  meetingId: string | null;
  participantVotes: Array<{
    providerId: string;
    vote: 'approve' | 'reject' | 'abstain';
    comment?: string;
  }>;
}

/**
 * `approval:detail-fetch` 응답.
 *
 * `approval` 은 그대로 list 의 row 를 다시 싣는다 — 패널 첫 렌더에서 list
 * 캐시 round-trip 없이 헤더를 그릴 수 있게 한다.
 *
 * `consensusContext` 가 null 인 케이스: meetingId 가 null 인 stand-alone
 * approval. 이 때 패널은 votes 섹션을 숨긴다.
 */
export interface ApprovalDetail {
  approval: ApprovalItem;
  impactedFiles: ApprovalImpactedFile[];
  diffPreviews: ApprovalDiffPreview[];
  consensusContext: ApprovalConsensusContext | null;
}

/**
 * Approvals list 필터바 상태 (R11-Task7 의 design polish 라운드 2 B 이월).
 *
 * 'all' 은 expired/superseded 까지 포함한 전 status 를 의미. service 는 이
 * 값을 받아 status WHERE 를 0건/1건/N건으로 분기한다.
 */
export interface ApprovalListFilter {
  status: 'pending' | 'approved' | 'rejected' | 'all';
}
