/**
 * Notification label dictionary for the main-process (R9-Task11, D8).
 *
 * The main bundle deliberately does NOT import `i18next` — doing so would
 * force SSR-style hydration and pull the entire renderer locale plumbing
 * into the Electron main process. This dictionary is main's own copy of
 * OS-notification copy, resolved without touching react-i18next.
 *
 * C3 (2026-09) — this file used to carry a much larger dictionary
 * (per-kind titles/bodies for every NotificationKind, plus system-message
 * copy for CircuitBreaker/AutonomyGate/MeetingOrchestrator/
 * PlanningDesignCheck and friends). All of those consumer classes were
 * removed in the chat-first pivot; a full trace of every
 * `resolveNotificationLabel(...)` call site and every direct property
 * access into the dictionary found exactly one live consumer:
 * `NotificationService.test(kind)` in notification-service.ts, which
 * only ever resolves `'test.title'` / `'test.body'`. The renderer
 * `notification.*` catalog keys that used to mirror this dictionary were
 * dropped from `i18next-parser.config.js` `keepRemoved` for the same
 * reason — no renderer code looks them up (renderer and main were never
 * actually reading the same source; "mirrors" was aspirational, not
 * true). Everything else here was deleted along with its dead consumer.
 *
 * Today the locale is a static module-level default (ko), switchable via
 * {@link setNotificationLocale} (still wired to the `notification:set-locale`
 * IPC handler, which also flips the renderer's own i18next instance).
 *
 * The interpolation syntax mirrors i18next's `{{name}}` in case a future
 * refactor wants to swap this dictionary for a real i18next lookup.
 */

import { NotificationLabelMissingError } from './notification-label-error';

// ── Locale registry ──────────────────────────────────────────────────

export type NotificationLocale = 'ko' | 'en';

/**
 * Default locale at process start. Consistent with `react-i18next`
 * `lng: 'ko'`. The mutator below lets a settings handler change it
 * without needing to thread a locale arg through every call-site.
 */
const DEFAULT_LOCALE: NotificationLocale = 'ko';

let currentLocale: NotificationLocale = DEFAULT_LOCALE;

/**
 * Switches the active locale for subsequent label lookups. Unknown
 * locales fall through to {@link DEFAULT_LOCALE} silently so a bad
 * settings value never crashes a notification fire.
 */
export function setNotificationLocale(locale: NotificationLocale): void {
  currentLocale = locale in DICTIONARIES ? locale : DEFAULT_LOCALE;
}

// ── Dictionary shape ─────────────────────────────────────────────────

/**
 * The only surviving entry is `test` — see the file header for the
 * consumer trace that removed the rest.
 */
interface NotificationDictionary {
  test: { title: string; body: string };
}

const KO: NotificationDictionary = {
  test: {
    title: 'Rolestra 테스트',
    body: 'OS 알림 확인용',
  },
};

const EN: NotificationDictionary = {
  test: {
    title: 'Rolestra test',
    body: 'OS notification check',
  },
};

const DICTIONARIES: Record<NotificationLocale, NotificationDictionary> = {
  ko: KO,
  en: EN,
};

// ── Public API ──────────────────────────────────────────────────────

/** Every resolvable key — see the file header for why this is just `test`. */
export const NOTIFICATION_LABEL_KEYS = [
  'test.title',
  'test.body',
] as const;

export type NotificationLabelKey = (typeof NOTIFICATION_LABEL_KEYS)[number];

/**
 * Resolves a dotted key (`'test.title'`) into a locale-specific string,
 * with `{{var}}` interpolation applied. Missing vars interpolate as
 * empty string (i18next parity). Unknown keys throw
 * {@link NotificationLabelMissingError} rather than returning the key
 * literal — ruling R-T34: a returned key literal used to show up on
 * screen as the notification title, and because *something* was
 * visible, nobody reported it as broken.
 */
export function resolveNotificationLabel(
  key: NotificationLabelKey,
  vars?: Record<string, string | number>,
  locale: NotificationLocale = currentLocale,
): string {
  const template = lookup(dictionaryFor(locale), key);
  if (template === null) {
    throw new NotificationLabelMissingError(
      key,
      locale,
      'notification-labels',
    );
  }
  return interpolate(template, vars ?? {});
}

// ── Internal ────────────────────────────────────────────────────────

function dictionaryFor(locale: NotificationLocale): NotificationDictionary {
  return DICTIONARIES[locale] ?? DICTIONARIES[DEFAULT_LOCALE];
}

function lookup(dict: NotificationDictionary, key: string): string | null {
  const segments = key.split('.');
  let node: unknown = dict;
  for (const seg of segments) {
    if (node === null || typeof node !== 'object') return null;
    node = (node as Record<string, unknown>)[seg];
  }
  return typeof node === 'string' ? node : null;
}

function interpolate(
  template: string,
  vars: Record<string, string | number>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => {
    const value = vars[name];
    return value === undefined ? '' : String(value);
  });
}

// ── Test-only hook ──────────────────────────────────────────────────

/**
 * Resets the module-level locale back to {@link DEFAULT_LOCALE}. Exposed
 * for unit tests that mutate `setNotificationLocale('en')` and need to
 * avoid bleed-through to neighbours (vitest isolates files, not tests).
 */
export function __resetNotificationLocaleForTests(): void {
  currentLocale = DEFAULT_LOCALE;
}
