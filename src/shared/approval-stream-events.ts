/**
 * Approval stream event zod schemas (R7-Task1).
 *
 * The TypeScript types for `stream:approval-created` / `stream:approval-decided`
 * already live in `stream-events.ts` (R2). This module adds the **runtime
 * validation** half: zod schemas that match the payload shapes, the
 * `ApprovalPayload` discriminated union for kind-aware narrowing, and a full
 * `approvalItemSchema` for cross-process serialisation validation.
 *
 * Why a dedicated file?
 *   - `stream-events.ts` stays type-only (no runtime dep on zod) so renderer
 *     imports that file in hot render paths without pulling zod into the
 *     renderer bundle. The bridge / adapter layer imports `approval-stream-
 *     events.ts` only where validation is needed.
 *   - `ipc-schemas.ts` covers request/response IPC shapes; it does not (yet)
 *     cover stream push payloads. Keeping stream schemas close to stream
 *     types avoids circular import pressure.
 *
 * Test coverage: `src/shared/__tests__/approval-stream-events.test.ts`
 * exercises round-trip of every kind + shape rejection for malformed inputs.
 */

import { z } from 'zod';

import {
  approvalDecisionSchema,
  approvalStatusSchema,
  permissionModeSchema,
} from './ipc-schemas';

// ── Kind + payload discriminated union ──────────────────────────────

/**
 * R7 범위의 kind enum. `review_outcome` / `failure_report` 도 enum 값으로는
 * 존재하지만 R7 payload 스키마는 두 kind 만큼 정의하지 않는다 — 발사 지점이
 * 없어서 아직 shape 가 확정되지 않음. R8+ 에서 추가.
 *
 * R12-C2 T10b: `consensus_decision` 제거 — 옛 SSM DONE sign-off 흐름이 새
 * phase loop 모델로 대체되며 발사 지점이 사라짐.
 */
export const approvalKindSchema = z.enum([
  'cli_permission',
  'mode_transition',
  'review_outcome',
  'failure_report',
  // R9-Task6: CircuitBreaker downgrade receipts. Payload shape is not
  // asserted in `approvalPayloadSchema` yet (same pattern as
  // review_outcome / failure_report — emitted at runtime but kept off
  // the discriminated union until the R10 approval panel formalises
  // rendering).
  'circuit_breaker',
]);

export const cliPermissionPayloadSchema = z.object({
  kind: z.literal('cli_permission'),
  cliRequestId: z.string().min(1).max(256),
  toolName: z.string().min(1).max(128),
  target: z.string().max(4096),
  description: z.string().max(4000).nullable(),
  participantId: z.string().min(1).max(128),
  participantName: z.string().min(1).max(256),
});

export const modeTransitionPayloadSchema = z.object({
  kind: z.literal('mode_transition'),
  currentMode: permissionModeSchema,
  targetMode: permissionModeSchema,
  reason: z.string().max(2000).optional(),
});

/**
 * Discriminated union zod — R7 2 kind 후 R12-C2 T10b 에서
 * consensus_decision 제거됨. R8+ 확장 시 여기에 추가. 기존
 * `approval_items` row 가 가진 payload 는 `unknown` 이고 DB 쪽 제약이 없으니
 * round-trip 에서 항상 validation 해야 안전하다.
 */
export const approvalPayloadSchema = z.discriminatedUnion('kind', [
  cliPermissionPayloadSchema,
  modeTransitionPayloadSchema,
]);

// ── ApprovalItem ────────────────────────────────────────────────────

/**
 * `ApprovalItem` 전체 형상. `payload` 는 union 으로 좁히지 않고 `unknown` 을
 * 받는다 — 이유: (i) DB 에는 아직 R7 이전의 kind 를 가진 row 가 섞여 있을 수
 * 있고, (ii) `review_outcome` / `failure_report` 는 R7 기준 payload 가 미정의.
 * 검증이 필요한 호출자는 `approvalPayloadSchema.parse(item.payload)` 를 kind
 * 에 따라 호출한다.
 */
export const approvalItemSchema = z.object({
  id: z.string().min(1).max(128),
  kind: approvalKindSchema,
  projectId: z.string().min(1).max(128).nullable(),
  channelId: z.string().min(1).max(128).nullable(),
  meetingId: z.string().min(1).max(128).nullable(),
  requesterId: z.string().min(1).max(128).nullable(),
  payload: z.unknown(),
  status: approvalStatusSchema,
  decisionComment: z.string().max(4000).nullable(),
  createdAt: z.number().int().nonnegative(),
  decidedAt: z.number().int().nonnegative().nullable(),
});

// ── stream:approval-* 스키마 ─────────────────────────────────────────

export const streamApprovalCreatedSchema = z.object({
  item: approvalItemSchema,
});

export const streamApprovalDecidedSchema = z.object({
  item: approvalItemSchema,
  decision: approvalDecisionSchema,
  comment: z.string().max(4000).nullable(),
});
