/**
 * review-workflow — R12-C2 P3 T17 land. spec §3 line 76 / §4 line 144 /
 * §11.16 / §11.22.6 / §11.12.1 line 958 + 964.
 *
 * 리뷰 부서 (channel.role === 'review') 는 풀세트 5+2.5 phase loop (planning /
 * audit 와 동일 backend) 위에 얹는 *handoff routing 분기*만 다른 부서:
 *
 *   - chain 외 — 회의록 작성 직후 lock 해제, 자동 인계 X
 *   - 두 entry:
 *       (a) 사용자 명시 호출 (할 일 큐 entry 부서 라디오 = 리뷰)
 *       (b) audit (검토) 인계 결재 모달 안 *"+리뷰 부서도 시작"* 체크박스
 *           또는 audit 채널 `handoff_mode='auto'` → Notification 발송
 *
 * 본 모듈은 *types + 순수 helper* 만 land — design-workflow.ts (T16a) 와 같은
 * thin extension 설계. orchestrator wire (audit handoff 시 review 채널 자동
 * 소집) 는 T25 / T30 책임. 본 sub-task 의 스코프:
 *
 *   1. ReviewEntryKind union 정의 (a / b 두 entry)
 *   2. ReviewHandoffPackage 인터페이스 — case (b) 인계 패키지 형식
 *   3. buildReviewHandoffPackageFromAudit — 순수 builder (audit 회의록 통째 +
 *      metadata 만, T25 가 handoff_dispatch row 영속 시 호출)
 *   4. shouldSpawnReviewFromAudit — 체크박스 + handoff_mode 진리표 helper
 *
 * spec docs/superpowers/specs/2026-05-01-rolestra-channel-roles-design.md
 *  - §3 line 76      review = 주관 평가 / chain 외 / 두 entry
 *  - §4 line 144     리뷰 매트릭스 row (풀세트 — 주관 평가)
 *  - §11.12.1 line 958 + 964   리뷰 lock 해제 = 회의록 작성 직후
 *  - §11.16          handoff_mode (check | auto) 정의
 *  - §11.22.4 / .6   인계 패키지 = 회의록 본문 통째 + metadata
 */

import type { ChannelRole, HandoffMode } from '../../../shared/channel-role-types';

// ── Entry 분기 ─────────────────────────────────────────────────────

/**
 * 리뷰 부서 회의 진입 경로:
 *   - `'user_explicit'`           사용자가 할 일 큐 entry 부서 라디오에서
 *                                 명시적으로 "리뷰" 선택. 컨텍스트 비움 —
 *                                 사용자가 직접 의견 제시 (§11.22.6 (a)).
 *   - `'audit_handoff_checkbox'`  audit (검토) 인계 결재 모달 안
 *                                 *"+리뷰 부서도 시작"* 체크박스가 켜졌거나
 *                                 audit 채널 `handoff_mode='auto'` 일 때
 *                                 자동 진입 — audit 회의록 통째가 컨텍스트
 *                                 (§11.22.6 (b)).
 *
 * orchestrator 가 회의 boot 시 본 enum 으로 entry kind 받아 Notification
 * 발송 분기 + 컨텍스트 prepend 분기 (T30 wire 시).
 */
export type ReviewEntryKind = 'user_explicit' | 'audit_handoff_checkbox';

// ── 인계 패키지 (case b) ────────────────────────────────────────────

/**
 * audit → review 자동 인계 패키지. spec §11.22.4 카논 — *minutes.md 본문 통째*
 * + metadata 만. 별도 구조화 / 추출 X — 받는 부서 (review) 의 step 1 prompt 가
 * 본 markdown 을 그대로 컨텍스트로 prepend.
 *
 * T25 (handoff_dispatch row 영속) 가 본 객체 받아 DB row + 받는 부서 회의
 * 소집 + step 1 컨텍스트 wire. 본 sub-task (T17) 는 builder 정의까지만.
 */
export interface ReviewHandoffPackage {
  /** audit 회의 ID — handoff_dispatch.from_meeting_id 자리. */
  sourceAuditMeetingId: string;
  /** audit 채널 ID — handoff_dispatch.from_channel_id 자리. */
  sourceAuditChannelId: string;
  /** 받는 review 채널 ID — handoff_dispatch.to_channel_id 자리. */
  targetReviewChannelId: string;
  /** audit 회의록 markdown 본문 (§11.18.6 minutes.md 통째). truncate 금지. */
  auditMinutesMarkdown: string;
  /** Unix epoch ms — handoff_dispatch.dispatched_at 자리 (생성 시점). */
  generatedAt: number;
  /** 트리거 분기 (audit handoff_mode='check' + 체크박스 / 'auto' Notification). */
  trigger: ReviewHandoffTrigger;
}

/**
 * 리뷰 인계가 *어떤 분기로 발생했는지* — UI / Notification 메시지 + audit
 * trail 용.
 *
 *   - `'user_checkbox'`     audit handoff 결재 모달 안 *"+리뷰 부서도 시작"*
 *                           체크박스가 사용자에 의해 켜짐 (handoff_mode='check').
 *   - `'auto_notification'` audit 채널 handoff_mode='auto' — 결재 모달 없이
 *                           Notification 발송 + 자동 진입.
 */
export type ReviewHandoffTrigger = 'user_checkbox' | 'auto_notification';

// ── builder — audit 인계 → review 패키지 ────────────────────────────

/**
 * audit 회의 종결 직후 review 채널로 자동 소집 시 인계 패키지 생성. 모든 인자
 * 는 caller (T25 orchestrator wire) 가 audit 회의 finalize 결과 + 채널 lookup
 * 으로 모아 전달. 본 함수는 *순수* — DB 접근 / 시간 lookup 모두 caller 책임.
 *
 * audit 회의록은 비어 있으면 throw — audit 흐름이 minutes 작성을 항상 보장
 * (compose_minutes phase 가 fallback 으로 [합의 0 / 제외 0] 빈 plate 라도
 * 작성). 빈 markdown 으로 review 회의 컨텍스트 비우는 일은 invariant 위반.
 */
export function buildReviewHandoffPackageFromAudit(input: {
  sourceAuditMeetingId: string;
  sourceAuditChannelId: string;
  targetReviewChannelId: string;
  auditMinutesMarkdown: string;
  trigger: ReviewHandoffTrigger;
  generatedAt: number;
}): ReviewHandoffPackage {
  if (input.auditMinutesMarkdown.trim().length === 0) {
    throw new ReviewHandoffPackageInvariantError(
      'audit minutes markdown is empty — compose_minutes invariant violated',
    );
  }
  if (!Number.isFinite(input.generatedAt) || input.generatedAt < 0) {
    throw new ReviewHandoffPackageInvariantError(
      `generatedAt must be a finite non-negative epoch (got ${input.generatedAt})`,
    );
  }
  return {
    sourceAuditMeetingId: input.sourceAuditMeetingId,
    sourceAuditChannelId: input.sourceAuditChannelId,
    targetReviewChannelId: input.targetReviewChannelId,
    auditMinutesMarkdown: input.auditMinutesMarkdown,
    generatedAt: input.generatedAt,
    trigger: input.trigger,
  };
}

/**
 * `buildReviewHandoffPackageFromAudit` 의 invariant 위반 시 throw — caller
 * (orchestrator) 가 catch 후 회의 abort + 사용자 노출 에러 분기.
 */
export class ReviewHandoffPackageInvariantError extends Error {
  constructor(message: string) {
    super(`[ReviewHandoffPackage] ${message}`);
    this.name = 'ReviewHandoffPackageInvariantError';
  }
}

// ── 트리거 진리표 — 체크박스 + handoff_mode ─────────────────────────

/**
 * audit 회의 종결 시점에 review 부서 자동 소집을 *해야 하는지* 결정. spec
 * §3 line 76 / §11.16 카논:
 *
 *   handoff_mode | 체크박스 | 결과
 *   ─────────────┼─────────┼────────────────────────────
 *   'check'      | true    | spawn (trigger='user_checkbox')
 *   'check'      | false   | no-spawn
 *   'auto'       | -       | spawn (trigger='auto_notification')
 *
 * 'auto' 모드에서 체크박스 값은 *무시* — 결재 모달 자체가 안 뜨므로 사용자
 * 입력 자리가 없다. UI 가 잘못된 값을 보내도 본 함수가 무시하는 것이 정합.
 */
export function shouldSpawnReviewFromAudit(input: {
  auditChannelHandoffMode: HandoffMode;
  reviewCheckboxChecked: boolean;
}): { spawn: false } | { spawn: true; trigger: ReviewHandoffTrigger } {
  if (input.auditChannelHandoffMode === 'auto') {
    return { spawn: true, trigger: 'auto_notification' };
  }
  if (input.reviewCheckboxChecked) {
    return { spawn: true, trigger: 'user_checkbox' };
  }
  return { spawn: false };
}

// ── role guard ──────────────────────────────────────────────────────

/**
 * 채널이 리뷰 부서인지 확인. orchestrator 가 channel.role 분기 시 사용 —
 * design 부서의 `isDesignDepartmentRole` 패턴 그대로.
 *
 * 단일 RoleId 매핑이라 inline 비교로 충분하지만, *문자열 리터럴이 코드 곳곳에
 * 흩어지지 않도록* 본 helper 를 거친다 (CodingRule grep 가능성 + 향후 alias
 * 가능성 차단).
 */
export function isReviewDepartmentRole(role: ChannelRole): boolean {
  return role === 'review';
}
