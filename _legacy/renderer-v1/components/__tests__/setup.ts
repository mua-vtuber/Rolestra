/**
 * Shared test setup for renderer component tests.
 *
 * Provides mock factories for window.arena, i18n, and zustand stores.
 */

// @vitest-environment jsdom

import { vi } from 'vitest';
import '@testing-library/jest-dom/vitest';

// ── jsdom polyfills ─────────────────────────────────────────────────────

// scrollIntoView is not implemented in jsdom
Element.prototype.scrollIntoView = vi.fn();

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

// ── Provider test data ──────────────────────────────────────────────────

export function makeProviderInfo(overrides?: Record<string, unknown>) {
  return {
    id: 'provider-1',
    type: 'api' as const,
    displayName: 'Test GPT',
    model: 'gpt-4o',
    capabilities: ['streaming'] as const,
    status: 'ready' as const,
    config: { type: 'api' as const, endpoint: 'https://api.test.com', apiKeyRef: 'test-key', model: 'gpt-4o' },
    ...overrides,
  };
}
