/**
 * Notification label dictionary for the main-process (R9-Task11, D8).
 *
 * The main bundle deliberately does NOT import `i18next` — doing so would
 * force SSR-style hydration and pull the entire renderer locale plumbing
 * into the Electron main process. Instead, the renderer's locale files
 * mirror the copy below under the `notification.*` / `circuitBreaker.*`
 * namespaces (preserved across parser runs by `i18next-parser.config.js`
 * `keepRemoved` entries). The two sources are kept in sync by convention
 * — the test at `__tests__/notification-labels.test.ts` pins the shape
 * and guards against accidental drift.
 *
 * Today the locale is a static module-level default (ko). R10+ will wire
 * {@link setNotificationLocale} to an app-level setting or Electron
 * `app.getLocale()` reading, without forcing call-sites to thread the
 * locale through every side-effect.
 *
 * The interpolation syntax mirrors i18next's `{{name}}` for parity with
 * the mirrored renderer keys — so if a future refactor wants to swap the
 * dictionary for a real i18next lookup, the template strings port as-is.
 */

// ── Locale registry ──────────────────────────────────────────────────

export type NotificationLocale = 'ko' | 'en';

/**
 * Default locale at process start. R9 ships `ko` only (consistent with
 * `react-i18next` `lng: 'ko'`). The mutator below lets R10 change it
 * from a settings handler without needing to thread a locale arg
 * through every call-site (the v3-side-effects SSM listener does not
 * have a project/user context in scope).
 */
const DEFAULT_LOCALE: NotificationLocale = 'ko';

let currentLocale: NotificationLocale = DEFAULT_LOCALE;

/**
 * Returns the locale currently used by every {@link resolveNotificationLabel}
 * and {@link resolveBreakerCopy} call. Exposed for tests and for R10
 * settings surfaces that want to render the "current OS-notification
 * locale" badge.
 */
export function getNotificationLocale(): NotificationLocale {
  return currentLocale;
}

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
 * Structural mirror of the `notification.*` + `circuitBreaker.*` subset
 * populated in `src/renderer/i18n/locales/{ko,en}.json`. Anything added
 * here must land in both locale files (the parser keeps them alive via
 * `keepRemoved`) and in the parallel entry of the other locale below.
 */
interface NotificationDictionary {
  test: { title: string; body: string };
  newMessage: { title: string; body: string };
  approvalPending: { title: string; body: string };
  workDone: { title: string; body: string };
  error: { title: string; body: string };
  warmupFailed: { title: string; body: string };
  circuitBreaker: {
    title: string;
    body: string;
    filesPerTurn: { title: string; body: string; bodyGeneric: string };
    cumulativeCliMs: { title: string; body: string; bodyGeneric: string };
    queueStreak: { title: string; body: string; bodyGeneric: string };
    sameError: { title: string; body: string; bodyGeneric: string };
  };
  generalMeetingDone: { titled: string; untitled: string };
  /**
   * R10-Task12: main-process system message labels — extracted from
   * fixed Korean strings in approval-system-message-injector and
   * meeting-orchestrator so the locale switch reaches every surface
   * without threading t() into the side-effect path.
   */
  approvalSystemMessage: {
    rejectPrefix: string;
    conditionalPrefix: string;
  };
  meetingMinutes: {
    rejection: string;
    rejectionWithComment: string;
    /** LLM summary paragraph header — `provider` interpolation. */
    summaryPrefix: string;
  };
}

const KO: NotificationDictionary = {
  test: {
    title: 'Rolestra 테스트',
    body: 'OS 알림 확인용',
  },
  newMessage: {
    title: '새 메시지',
    body: '{{author}}: {{preview}}',
  },
  approvalPending: {
    title: '승인 요청 대기',
    body: '{{kind}} 승인이 필요합니다.',
  },
  workDone: {
    title: '작업 완료',
    body: '회의가 완료되었습니다',
  },
  error: {
    title: '작업 실패',
    body: '{{previous}} 상태에서 종료되었습니다',
  },
  warmupFailed: {
    title: '연결 실패',
    body: '{{name}} 연결을 확인해 주세요',
  },
  circuitBreaker: {
    title: 'Circuit breaker 발동',
    body: '자율 모드가 manual로 변경되었습니다.',
    filesPerTurn: {
      title: 'Circuit breaker 발동 — 파일 변경 한계',
      body: '한 턴에 파일 {{count}}개를 변경했습니다. 자율 모드가 manual로 변경되었습니다.',
      bodyGeneric:
        '파일 변경이 한계를 초과했습니다. 자율 모드가 manual로 변경되었습니다.',
    },
    cumulativeCliMs: {
      title: 'Circuit breaker 발동 — CLI 누적 시간 한계',
      body: 'CLI 누적 실행 시간이 {{minutes}}분을 넘었습니다. 자율 모드가 manual로 변경되었습니다.',
      bodyGeneric:
        'CLI 누적 실행 시간이 한계를 초과했습니다. 자율 모드가 manual로 변경되었습니다.',
    },
    queueStreak: {
      title: 'Circuit breaker 발동 — 연속 큐 실행',
      body: '연속으로 {{count}}개의 큐 항목을 실행했습니다. 자율 모드가 manual로 변경되었습니다.',
      bodyGeneric:
        '연속 큐 실행이 한계에 도달했습니다. 자율 모드가 manual로 변경되었습니다.',
    },
    sameError: {
      title: 'Circuit breaker 발동 — 같은 오류 반복',
      body: '같은 오류({{category}})가 반복해서 발생했습니다. 자율 모드가 manual로 변경되었습니다.',
      bodyGeneric:
        '같은 오류가 반복해서 발생했습니다. 자율 모드가 manual로 변경되었습니다.',
    },
  },
  generalMeetingDone: {
    titled: '회의 "{{title}}" 이(가) 완료되었습니다.',
    untitled: '회의가 완료되었습니다.',
  },
  approvalSystemMessage: {
    rejectPrefix: '[승인 거절]',
    conditionalPrefix: '[조건부 승인]',
  },
  meetingMinutes: {
    rejection: '회의 합의 거절됨',
    rejectionWithComment: '회의 합의 거절됨 — {{comment}}',
    summaryPrefix: '📝 LLM 요약 ({{provider}}):',
  },
};

const EN: NotificationDictionary = {
  test: {
    title: 'Rolestra test',
    body: 'OS notification check',
  },
  newMessage: {
    title: 'New message',
    body: '{{author}}: {{preview}}',
  },
  approvalPending: {
    title: 'Approval pending',
    body: 'A {{kind}} approval is waiting.',
  },
  workDone: {
    title: 'Work done',
    body: 'The meeting has completed',
  },
  error: {
    title: 'Work failed',
    body: 'Ended in {{previous}} state',
  },
  warmupFailed: {
    title: 'Connection failed',
    body: 'Please check {{name}} connectivity',
  },
  circuitBreaker: {
    title: 'Circuit breaker fired',
    body: 'Autonomy reverted to manual.',
    filesPerTurn: {
      title: 'Circuit breaker fired — file change limit',
      body: 'Changed {{count}} files in one turn. Autonomy reverted to manual.',
      bodyGeneric:
        'File changes exceeded the limit. Autonomy reverted to manual.',
    },
    cumulativeCliMs: {
      title: 'Circuit breaker fired — CLI time limit',
      body: 'Cumulative CLI runtime exceeded {{minutes}} minutes. Autonomy reverted to manual.',
      bodyGeneric:
        'Cumulative CLI runtime exceeded the limit. Autonomy reverted to manual.',
    },
    queueStreak: {
      title: 'Circuit breaker fired — consecutive queue runs',
      body: 'Ran {{count}} consecutive queue items. Autonomy reverted to manual.',
      bodyGeneric:
        'Consecutive queue runs hit the limit. Autonomy reverted to manual.',
    },
    sameError: {
      title: 'Circuit breaker fired — repeated error',
      body: 'Same error ({{category}}) repeated. Autonomy reverted to manual.',
      bodyGeneric: 'The same error repeated. Autonomy reverted to manual.',
    },
  },
  generalMeetingDone: {
    titled: 'Meeting "{{title}}" has completed.',
    untitled: 'The meeting has completed.',
  },
  approvalSystemMessage: {
    rejectPrefix: '[Approval rejected]',
    conditionalPrefix: '[Approval conditional]',
  },
  meetingMinutes: {
    rejection: 'Consensus rejected',
    rejectionWithComment: 'Consensus rejected — {{comment}}',
    summaryPrefix: '📝 LLM summary ({{provider}}):',
  },
};

const DICTIONARIES: Record<NotificationLocale, NotificationDictionary> = {
  ko: KO,
  en: EN,
};

// ── Public API ──────────────────────────────────────────────────────

/**
 * Union of leaf labels addressable via {@link resolveNotificationLabel}.
 * Mirrors the top-level `notification.*` i18n keys the renderer exposes
 * — anything the main-process emits as an OS notification body should be
 * addressable through one of these keys.
 */
export type NotificationLabelKey =
  | 'test.title'
  | 'test.body'
  | 'newMessage.title'
  | 'newMessage.body'
  | 'approvalPending.title'
  | 'approvalPending.body'
  | 'workDone.title'
  | 'workDone.body'
  | 'error.title'
  | 'error.body'
  | 'warmupFailed.title'
  | 'warmupFailed.body'
  | 'circuitBreaker.title'
  | 'circuitBreaker.body'
  | 'generalMeetingDone.titled'
  | 'generalMeetingDone.untitled'
  | 'approvalSystemMessage.rejectPrefix'
  | 'approvalSystemMessage.conditionalPrefix'
  | 'meetingMinutes.rejection'
  | 'meetingMinutes.rejectionWithComment'
  | 'meetingMinutes.summaryPrefix';

/**
 * Resolves a notification label for the current locale. `key` is a
 * dotted path into the dictionary (e.g. `'workDone.title'`). Missing
 * interpolation variables render as the empty string — same as i18next's
 * silent-missing default — so a bad callsite never surfaces
 * `{{name}}` to the user.
 */
export function resolveNotificationLabel(
  key: NotificationLabelKey,
  vars?: Record<string, string | number>,
  locale: NotificationLocale = currentLocale,
): string {
  const template = lookup(dictionaryFor(locale), key);
  if (template === null) return key;
  return interpolate(template, vars ?? {});
}

/**
 * Resolves the `circuitBreaker` label family for a given tripwire reason.
 * Returns `{title, body}` with interpolation applied. When a numeric
 * detail value is missing (e.g. `count=null`) the generic body is used —
 * same shape as the hand-written fallback at v3-side-effects.ts before
 * this module existed.
 *
 * Keeping the per-tripwire switch here (rather than in v3-side-effects)
 * lets the dictionary stay the single source of truth for breaker copy
 * — callers emit `reason` + `detail`, the dictionary picks the shape.
 */
export function resolveBreakerCopy(
  reason: BreakerReason,
  detail: Record<string, unknown> | null | undefined,
  locale: NotificationLocale = currentLocale,
): { title: string; body: string } {
  const dict = dictionaryFor(locale).circuitBreaker;
  switch (reason) {
    case 'files_per_turn': {
      const count = readNumber(detail, 'count');
      return {
        title: dict.filesPerTurn.title,
        body:
          count !== null
            ? interpolate(dict.filesPerTurn.body, { count })
            : dict.filesPerTurn.bodyGeneric,
      };
    }
    case 'cumulative_cli_ms': {
      const ms = readNumber(detail, 'ms');
      const minutes = ms !== null ? Math.round(ms / 60000) : null;
      return {
        title: dict.cumulativeCliMs.title,
        body:
          minutes !== null
            ? interpolate(dict.cumulativeCliMs.body, { minutes })
            : dict.cumulativeCliMs.bodyGeneric,
      };
    }
    case 'queue_streak': {
      const count = readNumber(detail, 'count');
      return {
        title: dict.queueStreak.title,
        body:
          count !== null
            ? interpolate(dict.queueStreak.body, { count })
            : dict.queueStreak.bodyGeneric,
      };
    }
    case 'same_error': {
      const category = readString(detail, 'category');
      return {
        title: dict.sameError.title,
        body:
          category !== null
            ? interpolate(dict.sameError.body, { category })
            : dict.sameError.bodyGeneric,
      };
    }
    default:
      // Exhaustive fallback for future CircuitBreakerReason additions.
      return { title: dict.title, body: dict.body };
  }
}

/**
 * Resolves the `#일반` (general) channel copy for a completed meeting.
 * Mirrors spec §8 wording. Empty/whitespace `title` falls through to the
 * untitled variant so the message never renders a stray trailing quote.
 */
export function resolveGeneralMeetingDoneBody(
  meetingTitle: string,
  locale: NotificationLocale = currentLocale,
): string {
  const trimmed = meetingTitle.trim();
  const dict = dictionaryFor(locale).generalMeetingDone;
  if (trimmed.length === 0) return dict.untitled;
  return interpolate(dict.titled, { title: trimmed });
}

/**
 * Circuit breaker reason union mirrored from the breaker module. Kept
 * here rather than re-exported so the dictionary layer has zero imports
 * from the queue module (same "electron-free" principle as the service).
 */
export type BreakerReason =
  | 'files_per_turn'
  | 'cumulative_cli_ms'
  | 'queue_streak'
  | 'same_error';

// ── Internals ───────────────────────────────────────────────────────

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

function readNumber(
  detail: Record<string, unknown> | null | undefined,
  key: string,
): number | null {
  if (!detail || typeof detail !== 'object') return null;
  const value = detail[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readString(
  detail: Record<string, unknown> | null | undefined,
  key: string,
): string | null {
  if (!detail || typeof detail !== 'object') return null;
  const value = detail[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
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
