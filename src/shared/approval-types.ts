/**
 * Approval Inbox 도메인 타입 — migrations/006-approval-inbox.ts 컬럼과 1:1 camelCase 매핑.
 *
 * R7-Task1: kind 별 payload discriminated union (`ApprovalPayload`) 추가.
 *   - `cli_permission`      — MeetingTurnExecutor 의 CLI 권한 중재(§7.6, §7.7)
 *   - `mode_transition`     — 프로젝트 permission_mode 변경 게이팅(§7.3 CB-3)
 *   - `consensus_decision`  — SSM DONE 합의 결과 사용자 sign-off(§7.5)
 *
 * `review_outcome` / `failure_report` 는 R8+ autonomy 도입 시점에 payload 타입을
 * 정의한다. 현재는 kind enum 만 존재하고 발사 지점 0 (R7 Decision Log D5).
 *
 * `ApprovalItem.payload` 는 여전히 `unknown` 이다. 이유: repository 가 JSON 을
 * 그대로 round-trip 하고, 기존 row 와의 호환을 위해 타입 파서를 강제하지 않기 때문.
 * 사용 측에서는 kind 로 narrowing 한 뒤 `ApprovalPayload` 로 assert/parse 한다.
 */

import type { PermissionMode } from './project-types';

export type ApprovalKind =
  | 'cli_permission'
  | 'mode_transition'
  | 'consensus_decision'
  | 'review_outcome'
  | 'failure_report';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired' | 'superseded';
export type ApprovalDecision = 'approve' | 'reject' | 'conditional';

export interface ApprovalItem {
  id: string;
  kind: ApprovalKind;
  projectId: string | null;
  channelId: string | null;
  meetingId: string | null;
  requesterId: string | null;
  payload: unknown;
  status: ApprovalStatus;
  decisionComment: string | null;
  createdAt: number;
  decidedAt: number | null;
}

// ── Payload discriminated union (R7-Task1) ────────────────────────────

/**
 * CLI 권한 요청 payload — MeetingTurnExecutor 가 CLI provider 의 permission
 * prompt 를 가로챌 때 생성. spec §7.7 ApprovalCard 에 필요한 모든 필드를 싣는다.
 *
 * `cliRequestId` 는 CLI 쪽에서 발급한 요청 id. Promise resolve 시점에 CLI 가
 * 같은 id 로 응답을 기대하므로 round-trip 필수.
 */
export interface CliPermissionApprovalPayload {
  kind: 'cli_permission';
  cliRequestId: string;
  toolName: string;
  target: string;
  description: string | null;
  participantId: string;
  participantName: string;
}

/**
 * 프로젝트 `permission_mode` 변경 요청 payload. spec §7.3 CB-3 + §7.6.
 * 적용은 `ProjectService.applyPermissionModeChange(approvalId)` 가 decided
 * 이벤트를 받아 수행하며, TOCTOU 재검증(활성 회의 / external+auto)은 apply
 * 시점에 다시 한 번 돈다.
 */
export interface ModeTransitionApprovalPayload {
  kind: 'mode_transition';
  currentMode: PermissionMode;
  targetMode: PermissionMode;
  reason?: string;
}

/**
 * 합의 결과(SSM=DONE) 사용자 sign-off payload. R7 부터 MinutesComposer 포스팅
 * 직전에 이 approval 이 끼어들며, `snapshotHash` 는 SSM snapshot 의 content
 * hash 로 중복 발사 방지에 쓴다. `finalText` 는 합의본 원문(메타 헤더 제외).
 *
 * `votes` 는 참여자별 찬반 집계의 요약 — 상세 조회는 snapshot 을 통해.
 */
export interface ConsensusDecisionApprovalPayload {
  kind: 'consensus_decision';
  snapshotHash: string;
  finalText: string;
  votes: {
    yes: number;
    no: number;
    pending: number;
  };
}

/**
 * R7 범위 discriminated union. R8+ 에서 `review_outcome` / `failure_report`
 * payload 가 추가되면 이 union 에 합친다.
 */
export type ApprovalPayload =
  | CliPermissionApprovalPayload
  | ModeTransitionApprovalPayload
  | ConsensusDecisionApprovalPayload;

/**
 * `ApprovalItem` 에서 payload 를 특정 kind 로 narrowing 한 편의 타입.
 * 사용 측:
 *   const item: TypedApprovalItem<'cli_permission'> = narrowByKind(raw, 'cli_permission');
 */
export type TypedApprovalItem<K extends ApprovalPayload['kind']> = Omit<
  ApprovalItem,
  'kind' | 'payload'
> & {
  kind: K;
  payload: Extract<ApprovalPayload, { kind: K }>;
};
