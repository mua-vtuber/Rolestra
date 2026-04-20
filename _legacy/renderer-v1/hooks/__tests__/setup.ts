/**
 * Shared test setup for renderer hook tests.
 *
 * Provides mock factories for window.arena and store mocking utilities.
 */

// @vitest-environment jsdom

import { vi } from 'vitest';

// ── jsdom polyfills ─────────────────────────────────────────────────────

// scrollIntoView is not implemented in jsdom
if (typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = vi.fn();
}

// ── Mock showError to avoid side effects ────────────────────────────────

vi.mock('../useErrorDialog', () => ({
  showError: vi.fn(),
  useErrorDialog: () => vi.fn(),
}));

// ── Mock react-i18next ──────────────────────────────────────────────────

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (params) {
        let result = key;
        for (const [k, v] of Object.entries(params)) {
          result = result.replace(`{{${k}}}`, String(v));
        }
        return result;
      }
      return key;
    },
    i18n: { changeLanguage: vi.fn().mockResolvedValue(undefined) },
  }),
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}));

// ── Mock renderer i18n module ───────────────────────────────────────────

vi.mock('../../i18n', () => ({
  default: { changeLanguage: vi.fn().mockResolvedValue(undefined) },
}));

// ── window.arena mock factory ───────────────────────────────────────────

export type InvokeMock = ReturnType<typeof vi.fn>;
export type OnMock = ReturnType<typeof vi.fn>;

/**
 * Install a mock `window.arena` with invoke/on stubs.
 * Returns the mock functions for assertion.
 */
export function installArenaMock(): { invoke: InvokeMock; on: OnMock } {
  const invoke = vi.fn().mockResolvedValue(undefined);
  const on = vi.fn().mockReturnValue(vi.fn()); // returns unsubscribe fn

  Object.defineProperty(window, 'arena', {
    value: { invoke, on, platform: 'linux' },
    writable: true,
    configurable: true,
  });

  return { invoke, on };
}

// Auto-install arena mock as a side-effect for tests that use bare `import './setup'`
installArenaMock();
