/**
 * Notification-labels dictionary tests (R9-Task11, D8).
 *
 * The main-process dictionary is the single source of OS notification
 * copy — i18next is deliberately not imported in the main bundle. These
 * tests pin the ko/en leaves for the four core `NotificationKind` rows
 * that `NotificationService.show` currently fires, and cover the breaker
 * + general-meeting-done helpers so a silent dictionary drift (e.g. the
 * `{{count}}` placeholder being renamed) surfaces here rather than at
 * an Electron Notification call-site.
 *
 * No test touches {@link setNotificationLocale} without calling
 * `__resetNotificationLocaleForTests` in `afterEach` — locale state is
 * module-global, and vitest isolates files, not individual tests.
 */

import { afterEach, describe, expect, it } from 'vitest';

import {
  __resetNotificationLocaleForTests,
  getNotificationLocale,
  resolveBreakerCopy,
  resolveGeneralMeetingDoneBody,
  resolveNotificationLabel,
  setNotificationLocale,
  type NotificationLocale,
} from '../notification-labels';

afterEach(() => {
  __resetNotificationLocaleForTests();
});

describe('resolveNotificationLabel (ko default)', () => {
  it('resolves the 4 core kinds × title+body in ko', () => {
    const rows: Array<{ title: string; body: string; bodyVars?: Record<string, string> }> = [
      { title: resolveNotificationLabel('newMessage.title'), body: resolveNotificationLabel('newMessage.body', { author: 'A', preview: 'P' }) },
      { title: resolveNotificationLabel('approvalPending.title'), body: resolveNotificationLabel('approvalPending.body', { kind: 'K' }) },
      { title: resolveNotificationLabel('workDone.title'), body: resolveNotificationLabel('workDone.body') },
      { title: resolveNotificationLabel('error.title'), body: resolveNotificationLabel('error.body', { previous: 'VOTING' }) },
    ];

    expect(rows[0]).toEqual({ title: '새 메시지', body: 'A: P' });
    expect(rows[1]).toEqual({ title: '승인 요청 대기', body: 'K 승인이 필요합니다.' });
    expect(rows[2]).toEqual({ title: '작업 완료', body: '회의가 완료되었습니다' });
    expect(rows[3]).toEqual({ title: '작업 실패', body: 'VOTING 상태에서 종료되었습니다' });
  });

  it('interpolates missing vars as empty string (i18next parity)', () => {
    // {{author}} + {{preview}} present but blank
    expect(resolveNotificationLabel('newMessage.body')).toBe(': ');
  });

  it('returns the key literal on a bad lookup (defensive)', () => {
    expect(
      resolveNotificationLabel(
        // Force an invalid key to exercise the lookup fallback.
        'nonexistent.leaf' as Parameters<typeof resolveNotificationLabel>[0],
      ),
    ).toBe('nonexistent.leaf');
  });
});

describe('resolveNotificationLabel — en locale', () => {
  it('switches to en copy after setNotificationLocale("en")', () => {
    setNotificationLocale('en');
    expect(getNotificationLocale()).toBe('en');
    expect(resolveNotificationLabel('newMessage.title')).toBe('New message');
    expect(
      resolveNotificationLabel('newMessage.body', { author: 'A', preview: 'P' }),
    ).toBe('A: P');
    expect(resolveNotificationLabel('workDone.title')).toBe('Work done');
    expect(resolveNotificationLabel('error.title')).toBe('Work failed');
  });

  it('unknown locale falls back to default (ko)', () => {
    setNotificationLocale('xx' as unknown as NotificationLocale);
    expect(getNotificationLocale()).toBe('ko');
    expect(resolveNotificationLabel('workDone.title')).toBe('작업 완료');
  });
});

describe('resolveBreakerCopy', () => {
  it('returns the files_per_turn copy with {{count}} interpolation', () => {
    const out = resolveBreakerCopy('files_per_turn', { count: 31 });
    expect(out.title).toContain('breaker');
    expect(out.title).toContain('파일');
    expect(out.body).toContain('31');
    expect(out.body).toContain('파일');
  });

  it('falls back to the generic body when {{count}} is absent', () => {
    const out = resolveBreakerCopy('files_per_turn', null);
    expect(out.title).toContain('파일');
    expect(out.body).not.toContain('{{');
    expect(out.body).toContain('파일 변경');
  });

  it('cumulative_cli_ms converts ms → minutes', () => {
    const out = resolveBreakerCopy('cumulative_cli_ms', { ms: 1_800_000 });
    expect(out.body).toContain('30');
  });

  it('same_error carries the category verbatim', () => {
    const out = resolveBreakerCopy('same_error', { category: 'cli_spawn_failed' });
    expect(out.body).toContain('cli_spawn_failed');
  });

  it('unknown reason falls through to the default pair', () => {
    const out = resolveBreakerCopy(
      'unknown_reason' as Parameters<typeof resolveBreakerCopy>[0],
      null,
    );
    expect(out.title).toBe('Circuit breaker 발동');
    expect(out.body).toBe('자율 모드가 manual로 변경되었습니다.');
  });

  it('respects the active locale (en)', () => {
    setNotificationLocale('en');
    const out = resolveBreakerCopy('queue_streak', { count: 11 });
    expect(out.title).toContain('queue');
    expect(out.body).toContain('11');
  });
});

describe('resolveGeneralMeetingDoneBody', () => {
  it('ko: titled variant interpolates {{title}}', () => {
    expect(resolveGeneralMeetingDoneBody('Ship v1.0')).toBe(
      '회의 "Ship v1.0" 이(가) 완료되었습니다.',
    );
  });

  it('ko: untitled variant when title is blank', () => {
    expect(resolveGeneralMeetingDoneBody('  ')).toBe('회의가 완료되었습니다.');
  });

  it('en: titled + untitled variants', () => {
    setNotificationLocale('en');
    expect(resolveGeneralMeetingDoneBody('Ship v1.0')).toBe(
      'Meeting "Ship v1.0" has completed.',
    );
    expect(resolveGeneralMeetingDoneBody('')).toBe(
      'The meeting has completed.',
    );
  });
});

describe('notification-labels dictionary parity (ko ↔ en)', () => {
  it('each ko label has an en equivalent for the 6 top-level kinds', () => {
    const keys = [
      'test.title',
      'test.body',
      'newMessage.title',
      'newMessage.body',
      'approvalPending.title',
      'approvalPending.body',
      'workDone.title',
      'workDone.body',
      'error.title',
      'error.body',
      'warmupFailed.title',
      'warmupFailed.body',
      'circuitBreaker.title',
      'circuitBreaker.body',
    ] as const;

    __resetNotificationLocaleForTests();
    const koValues = keys.map((k) => resolveNotificationLabel(k));
    setNotificationLocale('en');
    const enValues = keys.map((k) => resolveNotificationLabel(k));

    // Parity guard: every ko leaf resolves to SOME non-empty en leaf,
    // and neither side returns the key literal (which would indicate a
    // missing entry).
    for (let i = 0; i < keys.length; i += 1) {
      expect(koValues[i]).not.toBe(keys[i]);
      expect(enValues[i]).not.toBe(keys[i]);
      expect(koValues[i].length).toBeGreaterThan(0);
      expect(enValues[i].length).toBeGreaterThan(0);
    }
  });
});

// ── R11-Task11 (D9): main-process locale 이전 ─────────────────────

describe('approvalNotificationBridge labels (R11-Task11)', () => {
  it('resolves the 6 approval kinds × title+body in ko', () => {
    const kinds = [
      'cli_permission',
      'mode_transition',
      'consensus_decision',
      'review_outcome',
      'failure_report',
      'circuit_breaker',
    ] as const;
    for (const kind of kinds) {
      const title = resolveNotificationLabel(
        `approvalNotificationBridge.${kind}.title` as Parameters<
          typeof resolveNotificationLabel
        >[0],
      );
      const body = resolveNotificationLabel(
        `approvalNotificationBridge.${kind}.body` as Parameters<
          typeof resolveNotificationLabel
        >[0],
      );
      expect(title.length).toBeGreaterThan(0);
      expect(body.length).toBeGreaterThan(0);
      expect(title).not.toContain('approvalNotificationBridge');
      expect(body).not.toContain('approvalNotificationBridge');
    }
  });

  it('switches the 6 approval kinds to en after setNotificationLocale("en")', () => {
    setNotificationLocale('en');
    expect(
      resolveNotificationLabel('approvalNotificationBridge.cli_permission.title'),
    ).toBe('CLI permission request');
    expect(
      resolveNotificationLabel(
        'approvalNotificationBridge.mode_transition.title',
      ),
    ).toBe('Permission mode change request');
    expect(
      resolveNotificationLabel(
        'approvalNotificationBridge.consensus_decision.title',
      ),
    ).toBe('Consensus approval request');
    expect(
      resolveNotificationLabel('approvalNotificationBridge.review_outcome.title'),
    ).toBe('Review outcome approval');
    expect(
      resolveNotificationLabel('approvalNotificationBridge.failure_report.title'),
    ).toBe('Failure report');
    expect(
      resolveNotificationLabel('approvalNotificationBridge.circuit_breaker.title'),
    ).toBe('Autonomy downgrade');
  });
});

describe('autonomyGate labels (R11-Task11)', () => {
  it('resolves the 5 approval-kind labels in ko', () => {
    expect(
      resolveNotificationLabel('autonomyGate.label.mode_transition'),
    ).toBe('모드 전환');
    expect(
      resolveNotificationLabel('autonomyGate.label.consensus_decision'),
    ).toBe('합의 결과');
    expect(
      resolveNotificationLabel('autonomyGate.label.review_outcome'),
    ).toBe('리뷰 결과');
    expect(
      resolveNotificationLabel('autonomyGate.label.cli_permission'),
    ).toBe('CLI 권한');
    expect(
      resolveNotificationLabel('autonomyGate.label.failure_report'),
    ).toBe('실패 리포트');
  });

  it('switches the 5 approval-kind labels to en', () => {
    setNotificationLocale('en');
    expect(
      resolveNotificationLabel('autonomyGate.label.mode_transition'),
    ).toBe('Mode transition');
    expect(
      resolveNotificationLabel('autonomyGate.label.consensus_decision'),
    ).toBe('Consensus result');
    expect(resolveNotificationLabel('autonomyGate.label.review_outcome')).toBe(
      'Review outcome',
    );
    expect(resolveNotificationLabel('autonomyGate.label.cli_permission')).toBe(
      'CLI permission',
    );
    expect(resolveNotificationLabel('autonomyGate.label.failure_report')).toBe(
      'Failure report',
    );
  });

  it('trace + notify templates interpolate {{label}} in both locales', () => {
    expect(
      resolveNotificationLabel('autonomyGate.trace.autoAccepted', {
        label: '모드 전환',
      }),
    ).toBe('자율 모드: 모드 전환 자동 수락');
    expect(
      resolveNotificationLabel('autonomyGate.trace.downgraded', {
        label: 'CLI 권한',
      }),
    ).toBe('자율 모드: CLI 권한 실패 감지 → manual로 강제 전환');

    setNotificationLocale('en');
    expect(
      resolveNotificationLabel('autonomyGate.trace.autoAccepted', {
        label: 'Mode transition',
      }),
    ).toBe('Autonomy: Mode transition auto-accepted');
    expect(
      resolveNotificationLabel('autonomyGate.notify.errorBody', {
        label: 'Mode transition',
      }),
    ).toBe('Reverted to manual after Mode transition failure');
  });
});
