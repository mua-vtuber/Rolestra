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
import { setMainLocale, type MainLocale } from '../../i18n/main-locale';
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
 * notification:set-locale (R10-Task12 + 결재 5번 2026-05-19) — switches the
 * main-process locale across *all* dictionaries so subsequent OS notifications,
 * system-message injections, planning-design-check archive markdown headers,
 * and LLM prompt bodies render in the chosen locale. Mirrors the
 * `i18n.changeLanguage(...)` call the renderer makes in LanguageTab.
 *
 * Two setters are called in lockstep:
 *   - `setNotificationLocale` (R9): notification + circuit-breaker copy.
 *   - `setMainLocale` (결재 5번): process-wide locale for newly added
 *     dictionaries (planning-design-check labels and future modules).
 *
 * Both setters silently clamp unknown locales to the default — see the
 * source modules. Keeping the two in sync here is the simplest wire that
 * avoids a circular import between notification-labels and main-locale.
 */
export function handleNotificationSetLocale(
  data: IpcRequest<'notification:set-locale'>,
): IpcResponse<'notification:set-locale'> {
  setNotificationLocale(data.locale as NotificationLocale);
  setMainLocale(data.locale as MainLocale);
  return { locale: data.locale };
}
