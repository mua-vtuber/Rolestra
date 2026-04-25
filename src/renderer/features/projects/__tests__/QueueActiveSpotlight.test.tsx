// @vitest-environment jsdom

/**
 * QueueActiveSpotlight — Set 3 design polish (시안 04 의 in_progress 카드).
 *
 * Coverage:
 *   - item === null → returns null (no DOM)
 *   - retro 테마 → ASCII frame `┌─ ./live` + `[LIVE]` pulse badge
 *   - warm/tactical 테마 → warning-bordered card + dot + label
 *   - prompt 텍스트 표시
 *   - startedAt timestamp 표시 (있을 때)
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
import { QueueActiveSpotlight } from '../QueueActiveSpotlight';
import type { QueueItem } from '../../../../shared/queue-types';
import type { ThemeKey } from '../../../theme/theme-tokens';

const SAMPLE_TIMESTAMP = new Date('2026-04-25T14:32:00').getTime();

function makeItem(overrides: Partial<QueueItem> = {}): QueueItem {
  return {
    id: 'q-1',
    projectId: 'p-1',
    targetChannelId: null,
    orderIndex: 0,
    prompt: '대시보드 위젯 드래그로 순서 변경',
    status: 'in_progress',
    startedMeetingId: null,
    startedAt: SAMPLE_TIMESTAMP,
    finishedAt: null,
    lastError: null,
    createdAt: SAMPLE_TIMESTAMP - 60000,
    ...overrides,
  };
}

function renderSpotlight(
  item: QueueItem | null,
  themeKey: ThemeKey = DEFAULT_THEME,
): ReturnType<typeof render> {
  useThemeStore.setState({ themeKey, mode: 'light' });
  return render(
    <ThemeProvider>
      <QueueActiveSpotlight item={item} />
    </ThemeProvider>,
  );
}

beforeEach(() => {
  useThemeStore.setState({ themeKey: DEFAULT_THEME, mode: DEFAULT_MODE });
  void i18next.changeLanguage('ko');
});

afterEach(() => cleanup());

describe('QueueActiveSpotlight — null item', () => {
  it.each<[ThemeKey]>([['warm'], ['tactical'], ['retro']])(
    '%s renders nothing when item is null',
    (themeKey) => {
      renderSpotlight(null, themeKey);
      expect(screen.queryByTestId('queue-active-spotlight')).toBeNull();
    },
  );
});

describe('QueueActiveSpotlight — retro variant', () => {
  it('renders ASCII frame `┌─ ./live` + [LIVE]', () => {
    renderSpotlight(makeItem(), 'retro');
    const root = screen.getByTestId('queue-active-spotlight');
    expect(root.getAttribute('data-theme')).toBe('retro');
    expect(root.textContent).toContain('┌─');
    expect(root.textContent).toContain('./live');
    const live = screen.getByTestId('queue-active-spotlight-live');
    expect(live.textContent).toBe('[LIVE]');
    expect(live.className).toContain('animate-pulse');
  });
});

describe('QueueActiveSpotlight — warm/tactical variant', () => {
  it.each<[ThemeKey]>([['warm'], ['tactical']])(
    '%s renders warning border + dot + no [LIVE] ASCII',
    (themeKey) => {
      renderSpotlight(makeItem(), themeKey);
      const root = screen.getByTestId('queue-active-spotlight');
      expect(root.getAttribute('data-theme')).toBe(themeKey);
      expect(root.className).toContain('border-warning');
      expect(screen.queryByTestId('queue-active-spotlight-live')).toBeNull();
    },
  );
});

describe('QueueActiveSpotlight — prompt + timestamp', () => {
  it('shows the prompt text', () => {
    renderSpotlight(makeItem({ prompt: '테스트 프롬프트' }), 'warm');
    expect(screen.getByTestId('queue-active-spotlight-prompt').textContent).toBe(
      '테스트 프롬프트',
    );
  });

  it('renders no startedAt label when null', () => {
    renderSpotlight(makeItem({ startedAt: null }), 'warm');
    const root = screen.getByTestId('queue-active-spotlight');
    expect(root.textContent).not.toMatch(/\d{2}:\d{2}/);
  });

  it('renders HH:MM startedAt label when provided', () => {
    renderSpotlight(makeItem(), 'warm');
    const root = screen.getByTestId('queue-active-spotlight');
    expect(root.textContent).toMatch(/\d{2}:\d{2}/);
  });
});

describe('QueueActiveSpotlight — hex literal guard', () => {
  it('QueueActiveSpotlight.tsx contains zero hex color literals', () => {
    const source = readFileSync(
      resolve(__dirname, '..', 'QueueActiveSpotlight.tsx'),
      'utf-8',
    );
    expect(source.match(/#[0-9a-fA-F]{3,6}\b/g)).toBeNull();
  });
});
