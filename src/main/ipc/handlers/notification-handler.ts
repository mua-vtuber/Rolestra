/**
 * notification:* IPC handlers.
 *
 * Three IPC calls:
 *   - `notification:get-prefs`    → full per-kind map (repo self-repairs
 *                                   missing rows on read).
 *   - `notification:update-prefs` → partial patch; service merges with
 *                                   existing values and returns the new
 *                                   full map.
 *   - `notification:test`         → diagnostic fire for a single kind.
 *                                   Prefs gate still applies (disabled
 *                                   kinds stay silent even in the test
 *                                   path — Session 3 decision).
 */

import type { IpcRequest, IpcResponse } from '../../../shared/ipc-types';
import type { NotificationService } from '../../notifications/notification-service';
import {
  setNotificationLocale,
  type NotificationLocale,
} from '../../notifications/notification-labels';
import type {
  NotificationKind,
  NotificationPrefs,
} from '../../../shared/notification-types';

let notificationAccessor: (() => NotificationService) | null = null;

export function setNotificationServiceAccessor(
  fn: () => NotificationService,
): void {
  notificationAccessor = fn;
}

function getService(): NotificationService {
  if (!notificationAccessor) {
    throw new Error('notification handler: service not initialized');
  }
  return notificationAccessor();
}

/**
 * Merge a partial per-kind pref patch with the current prefs so the
 * service receives a complete `NotificationPrefs` snapshot.
 *
 * Each patch entry may set `enabled` or `soundEnabled` independently;
 * missing fields keep the current value. Kinds absent from the patch
 * are forwarded unchanged.
 */
function mergePrefs(
  current: NotificationPrefs,
  patch: IpcRequest<'notification:update-prefs'>['patch'],
): Partial<NotificationPrefs> {
  const merged: Partial<NotificationPrefs> = {};
  for (const [key, value] of Object.entries(patch) as [
    NotificationKind,
    { enabled?: boolean; soundEnabled?: boolean },
  ][]) {
    if (!value) continue;
    merged[key] = {
      enabled: value.enabled ?? current[key].enabled,
      soundEnabled: value.soundEnabled ?? current[key].soundEnabled,
    };
  }
  return merged;
}

/** notification:get-prefs */
export function handleNotificationGetPrefs(): IpcResponse<'notification:get-prefs'> {
  return { prefs: getService().getPrefs() };
}

/** notification:update-prefs */
export function handleNotificationUpdatePrefs(
  data: IpcRequest<'notification:update-prefs'>,
): IpcResponse<'notification:update-prefs'> {
  const svc = getService();
  const current = svc.getPrefs();
  const prefs = svc.updatePrefs(mergePrefs(current, data.patch));
  return { prefs };
}

/** notification:test */
export function handleNotificationTest(
  data: IpcRequest<'notification:test'>,
): IpcResponse<'notification:test'> {
  getService().test(data.kind);
  return { success: true };
}

/**
 * notification:set-locale (R10-Task12) — switches the main-process label
 * dictionary so subsequent OS notifications + system-message injections
 * render in the chosen locale. Mirrors the `i18n.changeLanguage(...)`
 * call the renderer makes in LanguageTab. Unknown locales fall through
 * to the default — see `notification-labels.ts` setNotificationLocale.
 */
export function handleNotificationSetLocale(
  data: IpcRequest<'notification:set-locale'>,
): IpcResponse<'notification:set-locale'> {
  setNotificationLocale(data.locale as NotificationLocale);
  return { locale: data.locale };
}
