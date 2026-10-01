/**
 * 알림 설정 시험 fixture — 공유 kind 목록에서 만든다.
 *
 * 예전에는 시험마다 여섯 종류를 손으로 적어 두었다. R12-C2 가 세 종류를
 * 더했을 때 그 목록들이 낡은 채 남았고, 화면이 없는 종류를 조용히 건너뛰는
 * 코드까지 있어 "새 종류가 화면에 나오는가" 를 아무도 검증하지 못했다.
 *
 * 여기서는 `NOTIFICATION_KINDS` 를 돌며 만든다 — 종류를 더하면 fixture 가
 * 저절로 따라오고, 화면이 그 종류를 빠뜨리면 시험이 실패한다.
 */

import { NOTIFICATION_KINDS } from '../../../../shared/notification-types';
import type { NotificationPrefs } from '../../../../shared/notification-types';

/** 모든 종류가 켜져 있는 설정 map. `overrides` 로 일부만 바꾼다. */
export function makeNotificationPrefs(
  overrides: Partial<NotificationPrefs> = {},
): NotificationPrefs {
  const prefs = {} as NotificationPrefs;
  for (const kind of NOTIFICATION_KINDS) {
    prefs[kind] = { enabled: true, soundEnabled: true };
  }
  return { ...prefs, ...overrides };
}
