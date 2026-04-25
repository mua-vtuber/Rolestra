// @vitest-environment jsdom

/**
 * QueueStatusMark — Set 2 design polish (시안 04 의 큐 status mark 분기).
 *
 * Coverage:
 *   - retro 테마 → ASCII bracket (`[✓]/[→]/[ ]/[✗]/[‖]/[/]`)
 *   - warm/tactical 테마 → status dot + label
 *   - tone 색은 status 별 (success/warning/danger/fg-muted/fg-subtle)
 *   - in_progress 는 animate-pulse class
 *   - showLabel=false 면 라벨 span 미렌더
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
import { QueueStatusMark } from '../QueueStatusMark';
import type { QueueItemStatus } from '../../../../shared/queue-types';
import type { ThemeKey } from '../../../theme/theme-tokens';

function renderMark(
  status: QueueItemStatus,
  themeKey: ThemeKey = DEFAULT_THEME,
  showLabel = true,
): ReturnType<typeof render> {
  useThemeStore.setState({ themeKey, mode: 'light' });
  return render(
    <ThemeProvider>
      <QueueStatusMark status={status} showLabel={showLabel} />
    </ThemeProvider>,
  );
}

beforeEach(() => {
  useThemeStore.setState({ themeKey: DEFAULT_THEME, mode: DEFAULT_MODE });
  void i18next.changeLanguage('ko');
});

afterEach(() => cleanup());

describe('QueueStatusMark — retro ASCII glyph', () => {
  it.each<[QueueItemStatus, string]>([
    ['done', '[✓]'],
    ['in_progress', '[→]'],
    ['pending', '[ ]'],
    ['failed', '[✗]'],
    ['paused', '[‖]'],
    ['cancelled', '[/]'],
  ])('%s → %s', (status, glyph) => {
    renderMark(status, 'retro');
    expect(screen.getByTestId('queue-status-mark-ascii').textContent).toBe(glyph);
    expect(screen.queryByTestId('queue-status-mark-dot')).toBeNull();
  });
});

describe('QueueStatusMark — non-retro dot variant', () => {
  it.each<[ThemeKey]>([['warm'], ['tactical']])(
    '%s → renders status dot, no ASCII',
    (themeKey) => {
      renderMark('in_progress', themeKey);
      expect(screen.getByTestId('queue-status-mark-dot')).toBeTruthy();
      expect(screen.queryByTestId('queue-status-mark-ascii')).toBeNull();
    },
  );

  it('warm dot uses tone classes per status', () => {
    renderMark('done', 'warm');
    expect(screen.getByTestId('queue-status-mark-dot').className).toContain(
      'bg-success',
    );
  });
});

describe('QueueStatusMark — tone color per status', () => {
  it.each<[QueueItemStatus, string]>([
    ['done', 'text-success'],
    ['in_progress', 'text-warning'],
    ['failed', 'text-danger'],
    ['paused', 'text-fg-muted'],
    ['cancelled', 'text-fg-muted'],
    ['pending', 'text-fg-subtle'],
  ])('%s → %s', (status, toneClass) => {
    renderMark(status, 'warm');
    expect(screen.getByTestId('queue-status-mark').className).toContain(
      toneClass,
    );
  });
});

describe('QueueStatusMark — in_progress pulse', () => {
  it('warm in_progress dot has animate-pulse', () => {
    renderMark('in_progress', 'warm');
    expect(screen.getByTestId('queue-status-mark-dot').className).toContain(
      'animate-pulse',
    );
  });
  it('retro in_progress ASCII has animate-pulse', () => {
    renderMark('in_progress', 'retro');
    expect(screen.getByTestId('queue-status-mark-ascii').className).toContain(
      'animate-pulse',
    );
  });
  it('warm done dot has no animate-pulse', () => {
    renderMark('done', 'warm');
    expect(screen.getByTestId('queue-status-mark-dot').className).not.toContain(
      'animate-pulse',
    );
  });
});

describe('QueueStatusMark — label visibility', () => {
  it('showLabel=true renders the label span', () => {
    renderMark('done', 'warm', true);
    expect(screen.getByTestId('queue-status-mark-label').textContent).toBe('완료');
  });
  it('showLabel=false hides the label span', () => {
    renderMark('done', 'warm', false);
    expect(screen.queryByTestId('queue-status-mark-label')).toBeNull();
  });
});

describe('QueueStatusMark — hex literal guard', () => {
  it('QueueStatusMark.tsx contains zero hex color literals', () => {
    const source = readFileSync(
      resolve(__dirname, '..', 'QueueStatusMark.tsx'),
      'utf-8',
    );
    expect(source.match(/#[0-9a-fA-F]{3,6}\b/g)).toBeNull();
  });
});
