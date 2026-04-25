// @vitest-environment jsdom

/**
 * QueueStatBar — Set 3 design polish (시안 04 의 4-stat strip).
 *
 * Coverage:
 *   - 4 cells always rendered with given counts (zero shown as 0)
 *   - retro 테마 → mono prompt `done[N] active[N] wait[N] fail[N]`
 *   - warm/tactical 테마 → grid 4-col with number on top, label bottom
 *   - tactical adds vertical separators between cells (idx > 0)
 *   - source-level hex literal guard
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
import { QueueStatBar, type QueueStatBarCounts } from '../QueueStatBar';
import type { ThemeKey } from '../../../theme/theme-tokens';

function renderBar(
  counts: QueueStatBarCounts,
  themeKey: ThemeKey = DEFAULT_THEME,
): ReturnType<typeof render> {
  useThemeStore.setState({ themeKey, mode: 'light' });
  return render(
    <ThemeProvider>
      <QueueStatBar counts={counts} />
    </ThemeProvider>,
  );
}

beforeEach(() => {
  useThemeStore.setState({ themeKey: DEFAULT_THEME, mode: DEFAULT_MODE });
  void i18next.changeLanguage('ko');
});

afterEach(() => cleanup());

describe('QueueStatBar — always-4-cells', () => {
  it.each<[ThemeKey]>([['warm'], ['tactical'], ['retro']])(
    '%s renders 4 cells regardless of zeros',
    (themeKey) => {
      renderBar(
        { pending: 0, inProgress: 0, doneToday: 0, failed: 0 },
        themeKey,
      );
      const cells = screen.getAllByTestId('queue-stat-bar-cell');
      expect(cells).toHaveLength(4);
      expect(cells.map((c) => c.getAttribute('data-stat'))).toEqual([
        'pending',
        'inProgress',
        'doneToday',
        'failed',
      ]);
    },
  );
});

describe('QueueStatBar — retro mono prompt', () => {
  it('renders `$ queue --summary` ASCII line', () => {
    renderBar({ pending: 3, inProgress: 1, doneToday: 2, failed: 1 }, 'retro');
    expect(screen.getByTestId('queue-stat-bar-ascii').textContent).toContain(
      '$ queue --summary',
    );
  });

  it('cells use `wait/active/done/fail` ASCII labels with [N]', () => {
    renderBar({ pending: 3, inProgress: 1, doneToday: 2, failed: 1 }, 'retro');
    const byStat = (s: string): HTMLElement =>
      screen
        .getAllByTestId('queue-stat-bar-cell')
        .find((c) => c.getAttribute('data-stat') === s)!;
    expect(byStat('pending').textContent).toBe('wait[3]');
    expect(byStat('inProgress').textContent).toBe('active[1]');
    expect(byStat('doneToday').textContent).toBe('done[2]');
    expect(byStat('failed').textContent).toBe('fail[1]');
  });
});

describe('QueueStatBar — warm/tactical number layout', () => {
  it.each<[ThemeKey]>([['warm'], ['tactical']])(
    '%s renders number-on-top label-bottom per cell',
    (themeKey) => {
      renderBar(
        { pending: 3, inProgress: 1, doneToday: 2, failed: 1 },
        themeKey,
      );
      const values = screen.getAllByTestId('queue-stat-bar-cell-value');
      expect(values).toHaveLength(4);
      expect(values.map((v) => v.textContent)).toEqual(['3', '1', '2', '1']);
    },
  );

  it('tactical adds left border separator on cells idx > 0', () => {
    renderBar({ pending: 3, inProgress: 1, doneToday: 2, failed: 1 }, 'tactical');
    const cells = screen.getAllByTestId('queue-stat-bar-cell');
    expect(cells[0].className).not.toContain('border-l');
    expect(cells[1].className).toContain('border-l');
    expect(cells[2].className).toContain('border-l');
    expect(cells[3].className).toContain('border-l');
  });

  it('warm has no left borders between cells', () => {
    renderBar({ pending: 3, inProgress: 1, doneToday: 2, failed: 1 }, 'warm');
    const cells = screen.getAllByTestId('queue-stat-bar-cell');
    cells.forEach((c) => expect(c.className).not.toContain('border-l'));
  });
});

describe('QueueStatBar — tone color per stat', () => {
  it.each<[string, string]>([
    ['pending', 'text-fg-subtle'],
    ['inProgress', 'text-warning'],
    ['doneToday', 'text-success'],
    ['failed', 'text-danger'],
  ])('%s → %s tone class', (stat, tone) => {
    renderBar({ pending: 3, inProgress: 1, doneToday: 2, failed: 1 }, 'warm');
    const cell = screen
      .getAllByTestId('queue-stat-bar-cell')
      .find((c) => c.getAttribute('data-stat') === stat)!;
    const value = cell.querySelector('[data-testid="queue-stat-bar-cell-value"]');
    expect(value?.className).toContain(tone);
  });
});

describe('QueueStatBar — hex literal guard', () => {
  it('QueueStatBar.tsx contains zero hex color literals', () => {
    const source = readFileSync(
      resolve(__dirname, '..', 'QueueStatBar.tsx'),
      'utf-8',
    );
    expect(source.match(/#[0-9a-fA-F]{3,6}\b/g)).toBeNull();
  });
});
