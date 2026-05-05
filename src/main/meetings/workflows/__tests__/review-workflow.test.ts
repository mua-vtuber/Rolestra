/**
 * review-workflow 단위 테스트 — R12-C2 T17 land. spec §3 line 76 / §11.16 /
 * §11.22.6.
 *
 * 검증 (순수 함수 + 타입 contract):
 *   - shouldSpawnReviewFromAudit 진리표 (handoff_mode × 체크박스)
 *   - buildReviewHandoffPackageFromAudit 정상 build + invariant 위반 throw
 *   - isReviewDepartmentRole role guard
 *
 * orchestrator wire (audit handoff 시 review 채널 자동 소집) / Notification
 * 발송 (T30) 은 본 sub-task 스코프 X — 순수 helper 만 검증.
 */

import { describe, expect, it } from 'vitest';
import {
  buildReviewHandoffPackageFromAudit,
  isReviewDepartmentRole,
  ReviewHandoffPackageInvariantError,
  shouldSpawnReviewFromAudit,
} from '../review-workflow';

// ── shouldSpawnReviewFromAudit ──────────────────────────────────────

describe('shouldSpawnReviewFromAudit', () => {
  it('handoff_mode=auto → spawn (auto_notification), 체크박스 무시', () => {
    expect(
      shouldSpawnReviewFromAudit({
        auditChannelHandoffMode: 'auto',
        reviewCheckboxChecked: false,
      }),
    ).toEqual({ spawn: true, trigger: 'auto_notification' });

    // 체크박스 값과 무관해야 함 — 결재 모달 자체가 안 뜨므로
    expect(
      shouldSpawnReviewFromAudit({
        auditChannelHandoffMode: 'auto',
        reviewCheckboxChecked: true,
      }),
    ).toEqual({ spawn: true, trigger: 'auto_notification' });
  });

  it('handoff_mode=check + 체크박스 true → spawn (user_checkbox)', () => {
    expect(
      shouldSpawnReviewFromAudit({
        auditChannelHandoffMode: 'check',
        reviewCheckboxChecked: true,
      }),
    ).toEqual({ spawn: true, trigger: 'user_checkbox' });
  });

  it('handoff_mode=check + 체크박스 false → no-spawn', () => {
    expect(
      shouldSpawnReviewFromAudit({
        auditChannelHandoffMode: 'check',
        reviewCheckboxChecked: false,
      }),
    ).toEqual({ spawn: false });
  });
});

// ── buildReviewHandoffPackageFromAudit ──────────────────────────────

describe('buildReviewHandoffPackageFromAudit', () => {
  const baseInput = {
    sourceAuditMeetingId: 'audit-meeting-1',
    sourceAuditChannelId: 'audit-channel-1',
    targetReviewChannelId: 'review-channel-1',
    auditMinutesMarkdown: '## [합의]\n- 문제 1\n## [제외]\n(없음)\n',
    trigger: 'user_checkbox' as const,
    generatedAt: 1_700_000_000_000,
  };

  it('정상 input → ReviewHandoffPackage 동일 필드 그대로', () => {
    const pkg = buildReviewHandoffPackageFromAudit(baseInput);
    expect(pkg).toEqual({
      sourceAuditMeetingId: 'audit-meeting-1',
      sourceAuditChannelId: 'audit-channel-1',
      targetReviewChannelId: 'review-channel-1',
      auditMinutesMarkdown: '## [합의]\n- 문제 1\n## [제외]\n(없음)\n',
      trigger: 'user_checkbox',
      generatedAt: 1_700_000_000_000,
    });
  });

  it('trigger=auto_notification 도 그대로 보존', () => {
    const pkg = buildReviewHandoffPackageFromAudit({
      ...baseInput,
      trigger: 'auto_notification',
    });
    expect(pkg.trigger).toBe('auto_notification');
  });

  it('빈 회의록 → ReviewHandoffPackageInvariantError (compose_minutes invariant)', () => {
    expect(() =>
      buildReviewHandoffPackageFromAudit({
        ...baseInput,
        auditMinutesMarkdown: '',
      }),
    ).toThrow(ReviewHandoffPackageInvariantError);
  });

  it('whitespace-only 회의록도 빈 회의록 취급 → throw', () => {
    expect(() =>
      buildReviewHandoffPackageFromAudit({
        ...baseInput,
        auditMinutesMarkdown: '   \n\t  ',
      }),
    ).toThrow(ReviewHandoffPackageInvariantError);
  });

  it('NaN generatedAt → throw', () => {
    expect(() =>
      buildReviewHandoffPackageFromAudit({
        ...baseInput,
        generatedAt: Number.NaN,
      }),
    ).toThrow(ReviewHandoffPackageInvariantError);
  });

  it('음수 generatedAt → throw', () => {
    expect(() =>
      buildReviewHandoffPackageFromAudit({
        ...baseInput,
        generatedAt: -1,
      }),
    ).toThrow(ReviewHandoffPackageInvariantError);
  });
});

// ── isReviewDepartmentRole ──────────────────────────────────────────

describe('isReviewDepartmentRole', () => {
  it('"review" → true', () => {
    expect(isReviewDepartmentRole('review')).toBe(true);
  });

  it('다른 role → false', () => {
    expect(isReviewDepartmentRole('audit')).toBe(false);
    expect(isReviewDepartmentRole('planning')).toBe(false);
    expect(isReviewDepartmentRole('design.ui')).toBe(false);
    expect(isReviewDepartmentRole('idea')).toBe(false);
    expect(isReviewDepartmentRole('general')).toBe(false);
    expect(isReviewDepartmentRole(null)).toBe(false);
  });
});
