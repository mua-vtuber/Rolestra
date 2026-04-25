// @vitest-environment jsdom

/**
 * ApprovalStatusBadge — Set 1 design polish.
 *
 * Coverage:
 *   - decision × themeKey label matrix (warm/tactical → 한국어, retro → ASCII bracket)
 *   - tone class wiring (success / danger / warning) per decision
 *   - badgeRadius token-driven shape (warm pill vs tactical/retro square)
 *   - compact size variant
 *   - source-level hex-literal guard (R10-Task7 규약 유지)
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ThemeProvider } from '../../../theme/theme-provider';
import {
  DEFAULT_MODE,
  DEFAULT_THEME,
  useThemeStore,
} from '../../../theme/theme-store';
import '../../../i18n';
import { i18next } from '../../../i18n';
import {
  ApprovalStatusBadge,
  type ApprovalDecision,
} from '../ApprovalStatusBadge';
import type { ThemeKey, ThemeMode } from '../../../theme/theme-tokens';

function renderBadge(
  decision: ApprovalDecision,
  themeKey: ThemeKey,
  mode: ThemeMode,
  compact = false,
): ReturnType<typeof render> {
  useThemeStore.setState({ themeKey, mode });
  return render(
    <ThemeProvider>
      <ApprovalStatusBadge decision={decision} compact={compact} />
    </ThemeProvider>,
  );
}

beforeEach(() => {
  useThemeStore.setState({ themeKey: DEFAULT_THEME, mode: DEFAULT_MODE });
  void i18next.changeLanguage('ko');
});

afterEach(() => cleanup());

describe('ApprovalStatusBadge — labels by decision × theme', () => {
  it.each([
    ['pending', 'warm', '대기'],
    ['pending', 'tactical', '대기'],
    ['pending', 'retro', '[P]'],
    ['approved', 'warm', '허가'],
    ['approved', 'tactical', '허가'],
    ['approved', 'retro', '[Y]'],
    ['rejected', 'warm', '거절'],
    ['rejected', 'tactical', '거절'],
    ['rejected', 'retro', '[N]'],
  ] as const)(
    '%s × %s → %s',
    (decision, themeKey, expected) => {
      renderBadge(decision, themeKey, 'light');
      const badge = screen.getByTestId('approval-status-badge');
      expect(badge.getAttribute('data-decision')).toBe(decision);
      expect(badge.getAttribute('data-theme-variant')).toBe(themeKey);
      expect(badge.textContent).toBe(expected);
    },
  );
});

describe('ApprovalStatusBadge — tone class wiring', () => {
  it('approved row uses success tone classes', () => {
    renderBadge('approved', 'warm', 'light');
    const badge = screen.getByTestId('approval-status-badge');
    expect(badge.className).toContain('text-success');
    expect(badge.className).toContain('border-success');
  });

  it('rejected row uses danger tone classes', () => {
    renderBadge('rejected', 'warm', 'light');
    const badge = screen.getByTestId('approval-status-badge');
    expect(badge.className).toContain('text-danger');
    expect(badge.className).toContain('border-danger');
  });

  it('pending row uses warning tone classes', () => {
    renderBadge('pending', 'warm', 'light');
    const badge = screen.getByTestId('approval-status-badge');
    expect(badge.className).toContain('text-warning');
    expect(badge.className).toContain('border-warning');
  });
});

describe('ApprovalStatusBadge — radius driven by badgeRadius token', () => {
  it('warm theme → rounded-full (pill)', () => {
    renderBadge('pending', 'warm', 'light');
    expect(screen.getByTestId('approval-status-badge').className).toContain(
      'rounded-full',
    );
  });
  it('tactical theme → rounded-none (square)', () => {
    renderBadge('pending', 'tactical', 'light');
    expect(screen.getByTestId('approval-status-badge').className).toContain(
      'rounded-none',
    );
  });
  it('retro theme → rounded-none (square)', () => {
    renderBadge('pending', 'retro', 'light');
    expect(screen.getByTestId('approval-status-badge').className).toContain(
      'rounded-none',
    );
  });
});

describe('ApprovalStatusBadge — compact variant', () => {
  it('compact attaches data-compact=true and smaller padding/text', () => {
    renderBadge('pending', 'warm', 'light', true);
    const badge = screen.getByTestId('approval-status-badge');
    expect(badge.getAttribute('data-compact')).toBe('true');
    expect(badge.className).toContain('px-2');
    expect(badge.className).toContain('py-0.5');
  });
  it('non-compact attaches data-compact=false and larger padding/text', () => {
    renderBadge('pending', 'warm', 'light', false);
    const badge = screen.getByTestId('approval-status-badge');
    expect(badge.getAttribute('data-compact')).toBe('false');
    expect(badge.className).toContain('px-2.5');
    expect(badge.className).toContain('py-1');
  });
});

describe('ApprovalStatusBadge — hex literal guard', () => {
  it('ApprovalStatusBadge.tsx contains zero hex color literals', () => {
    const source = readFileSync(
      resolve(__dirname, '..', 'ApprovalStatusBadge.tsx'),
      'utf-8',
    );
    expect(source.match(/#[0-9a-fA-F]{3,6}\b/g)).toBeNull();
  });
});
