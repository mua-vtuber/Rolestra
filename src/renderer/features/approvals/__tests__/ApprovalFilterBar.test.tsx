// @vitest-environment jsdom

/**
 * ApprovalFilterBar — Set 1 design polish.
 *
 * Coverage:
 *   - 4 tabs render with correct labels (warm/tactical: 한국어 / retro: ASCII bracket prefix)
 *   - active prop drives data-active + visual brand classes
 *   - counts surface per tab (font-mono span)
 *   - onChange callback fires with the right filter id when a tab is clicked
 *   - onChange undefined → all tabs disabled (R10 한정 — pending 만 wired)
 *   - source-level hex-literal guard
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ThemeProvider } from '../../../theme/theme-provider';
import {
  DEFAULT_MODE,
  DEFAULT_THEME,
  useThemeStore,
} from '../../../theme/theme-store';
import '../../../i18n';
import { i18next } from '../../../i18n';
import {
  ApprovalFilterBar,
  type ApprovalFilter,
  type ApprovalFilterCounts,
} from '../ApprovalFilterBar';
import type { ThemeKey } from '../../../theme/theme-tokens';

const COUNTS: ApprovalFilterCounts = {
  pending: 5,
  approved: 12,
  rejected: 3,
  all: 20,
};

function renderBar(
  active: ApprovalFilter,
  onChange?: (next: ApprovalFilter) => void,
  themeKey: ThemeKey = DEFAULT_THEME,
): ReturnType<typeof render> {
  useThemeStore.setState({ themeKey, mode: 'light' });
  return render(
    <ThemeProvider>
      <ApprovalFilterBar active={active} counts={COUNTS} onChange={onChange} />
    </ThemeProvider>,
  );
}

beforeEach(() => {
  useThemeStore.setState({ themeKey: DEFAULT_THEME, mode: DEFAULT_MODE });
  void i18next.changeLanguage('ko');
});

afterEach(() => cleanup());

describe('ApprovalFilterBar — tab labels', () => {
  it('warm tabs use plain Korean labels (대기 / 허가 / 거절 / 전체)', () => {
    renderBar('pending', vi.fn(), 'warm');
    const tabs = screen.getAllByTestId('approval-filter-tab');
    expect(tabs.length).toBe(4);
    expect(tabs[0].textContent).toContain('대기');
    expect(tabs[1].textContent).toContain('허가');
    expect(tabs[2].textContent).toContain('거절');
    expect(tabs[3].textContent).toContain('전체');
  });

  it('retro tabs prepend ASCII bracket prefix ([P]/[A]/[R]/[*])', () => {
    renderBar('pending', vi.fn(), 'retro');
    const tabs = screen.getAllByTestId('approval-filter-tab');
    expect(tabs[0].textContent).toContain('[P] 대기');
    expect(tabs[1].textContent).toContain('[A] 허가');
    expect(tabs[2].textContent).toContain('[R] 거절');
    expect(tabs[3].textContent).toContain('[*] 전체');
  });
});

describe('ApprovalFilterBar — active state', () => {
  it('active tab has data-active=true + brand classes', () => {
    renderBar('pending', vi.fn());
    const pending = screen.getAllByTestId('approval-filter-tab')[0];
    expect(pending.getAttribute('data-filter')).toBe('pending');
    expect(pending.getAttribute('data-active')).toBe('true');
    expect(pending.className).toContain('text-brand');
    expect(pending.className).toContain('border-brand');
    expect(pending.getAttribute('aria-selected')).toBe('true');
  });

  it('inactive tabs have data-active=false + muted classes', () => {
    renderBar('pending', vi.fn());
    const others = screen.getAllByTestId('approval-filter-tab').slice(1);
    for (const tab of others) {
      expect(tab.getAttribute('data-active')).toBe('false');
      expect(tab.className).toContain('text-fg-muted');
      expect(tab.getAttribute('aria-selected')).toBe('false');
    }
  });
});

describe('ApprovalFilterBar — counts', () => {
  it('each tab surfaces its count from the counts prop', () => {
    renderBar('pending', vi.fn());
    const counts = screen.getAllByTestId('approval-filter-count');
    expect(counts.map((c) => c.textContent)).toEqual(['5', '12', '3', '20']);
  });
});

describe('ApprovalFilterBar — onChange', () => {
  it('clicking a tab fires onChange with that filter id', () => {
    const onChange = vi.fn();
    renderBar('pending', onChange);
    fireEvent.click(screen.getAllByTestId('approval-filter-tab')[1]);
    expect(onChange).toHaveBeenCalledWith('approved');
  });

  it('omitting onChange disables every tab', () => {
    renderBar('pending', undefined);
    const tabs = screen.getAllByTestId('approval-filter-tab');
    for (const tab of tabs) {
      expect((tab as HTMLButtonElement).disabled).toBe(true);
    }
  });
});

describe('ApprovalFilterBar — hex literal guard', () => {
  it('ApprovalFilterBar.tsx contains zero hex color literals', () => {
    const source = readFileSync(
      resolve(__dirname, '..', 'ApprovalFilterBar.tsx'),
      'utf-8',
    );
    expect(source.match(/#[0-9a-fA-F]{3,6}\b/g)).toBeNull();
  });
});
