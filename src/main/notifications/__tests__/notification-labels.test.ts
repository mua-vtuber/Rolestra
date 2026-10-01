/**
 * Notification-labels dictionary tests (R9-Task11, D8).
 *
 * C3 (2026-09): the dictionary was pruned to its one live entry (`test`)
 * after a full consumer trace found nothing else reachable from
 * production code — see the file header of `../notification-labels.ts`
 * for the trace. These tests now only pin the `test` leaves and the
 * locale-switch / missing-key-throws behaviour that
 * `resolveNotificationLabel` still needs to get right.
 *
 * No test touches {@link setNotificationLocale} without calling
 * `__resetNotificationLocaleForTests` in `afterEach` — locale state is
 * module-global, and vitest isolates files, not individual tests.
 */

import { afterEach, describe, expect, it } from 'vitest';

import {
  __resetNotificationLocaleForTests,
  resolveNotificationLabel,
  setNotificationLocale,
  type NotificationLocale,
} from '../notification-labels';
import { NotificationLabelMissingError } from '../notification-label-error';

afterEach(() => {
  __resetNotificationLocaleForTests();
});

describe('resolveNotificationLabel (ko default)', () => {
  it('resolves test.title / test.body in ko', () => {
    expect(resolveNotificationLabel('test.title')).toBe('Rolestra 테스트');
    expect(resolveNotificationLabel('test.body')).toBe('OS 알림 확인용');
  });

  // ruling R-T34 — 예전에는 못 찾은 키를 그대로 돌려줬다. 그러면 사용자
  // 화면에 `nonexistent.leaf` 가 알림 제목으로 뜨는데, 무언가 떠 있으니
  // 아무도 신고하지 않는다. 이제는 던진다.
  it('없는 키는 키 문자열을 돌려주지 않고 던진다', () => {
    expect(() =>
      resolveNotificationLabel(
        'nonexistent.leaf' as Parameters<typeof resolveNotificationLabel>[0],
      ),
    ).toThrow(NotificationLabelMissingError);
  });
});

describe('resolveNotificationLabel — en locale', () => {
  it('switches to en copy after setNotificationLocale("en")', () => {
    setNotificationLocale('en');
    expect(resolveNotificationLabel('test.title')).toBe('Rolestra test');
    expect(resolveNotificationLabel('test.body')).toBe('OS notification check');
  });

  it('unknown locale falls back to default (ko)', () => {
    setNotificationLocale('xx' as unknown as NotificationLocale);
    expect(resolveNotificationLabel('test.title')).toBe('Rolestra 테스트');
  });
});
