// @vitest-environment jsdom

/**
 * SystemMessage (R5-Task6) — themeKey 3-way shape diff + hex guard +
 * retro emoji-prefix 제거.
 *
 * 3 테마 shape:
 * - warm    : pill (rounded-full) + border-soft + bg-elev + fg-muted
 * - tactical: rounded-none + color-mix brand tint bg + brand outline
 * - retro   : "— {content} —" mono dash (이모지 prefix 제거)
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { SystemMessage } from '../SystemMessage';
import { ThemeProvider } from '../../../theme/theme-provider';
import {
  DEFAULT_MODE,
  DEFAULT_THEME,
  useThemeStore,
} from '../../../theme/theme-store';
import type { ThemeKey } from '../../../theme/theme-tokens';
import type { Message as ChannelMessage } from '../../../../shared/message-types';

function makeSystemMessage(
  overrides: Partial<ChannelMessage> = {},
): ChannelMessage {
  return {
    id: 'm-sys-1',
    channelId: 'c-sys',
    meetingId: null,
    authorId: 'system',
    authorKind: 'system',
    role: 'system',
    content: '새 프로젝트가 생성되었습니다.',
    meta: null,
    createdAt: 1_700_000_000_000,
    ...overrides,
  };
}

function renderWithTheme(
  themeKey: ThemeKey,
  ui: React.ReactElement,
): ReturnType<typeof render> {
  useThemeStore.setState({ themeKey, mode: 'light' });
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

afterEach(() => {
  cleanup();
  useThemeStore.setState({ themeKey: DEFAULT_THEME, mode: DEFAULT_MODE });
});

describe('SystemMessage — 3-way shape', () => {
  it('warm: pill (rounded-full) + border-soft + content as-is', () => {
    renderWithTheme(
      'warm',
      <SystemMessage message={makeSystemMessage()} />,
    );
    const root = screen.getByTestId('system-message');
    expect(root.getAttribute('data-theme-variant')).toBe('warm');

    const body = screen.getByTestId('system-message-body');
    expect(body.getAttribute('data-shape')).toBe('pill');
    expect(body.className).toContain('rounded-full');
    expect(body.className).toContain('border-border-soft');
    expect(body.textContent).toBe('새 프로젝트가 생성되었습니다.');
  });

  it('tactical: rounded-none + color-mix bg/border + content as-is', () => {
    renderWithTheme(
      'tactical',
      <SystemMessage message={makeSystemMessage()} />,
    );
    const root = screen.getByTestId('system-message');
    expect(root.getAttribute('data-theme-variant')).toBe('tactical');

    const body = screen.getByTestId('system-message-body');
    expect(body.getAttribute('data-shape')).toBe('tactical-outline');
    expect(body.className).toContain('rounded-none');
    // color-mix inline style 적용 확인
    expect(body.style.backgroundColor).toContain('color-mix');
    expect(body.style.border).toContain('color-mix');
    expect(body.textContent).toBe('새 프로젝트가 생성되었습니다.');
  });

  it('retro: mono dash with em-dash wrapping', () => {
    renderWithTheme(
      'retro',
      <SystemMessage message={makeSystemMessage()} />,
    );
    const root = screen.getByTestId('system-message');
    expect(root.getAttribute('data-theme-variant')).toBe('retro');
    expect(root.className).toContain('font-mono');

    const body = screen.getByTestId('system-message-body');
    expect(body.getAttribute('data-shape')).toBe('mono-dash');
    expect(body.textContent).toBe('— 새 프로젝트가 생성되었습니다. —');
  });
});

describe('SystemMessage — retro strips leading emoji prefix', () => {
  it.each([
    '📌 공지사항이 있습니다.',
    '🗳 투표가 시작되었습니다.',
    '✅ 승인이 완료되었습니다.',
  ])('strips emoji from "%s"', (content) => {
    renderWithTheme(
      'retro',
      <SystemMessage message={makeSystemMessage({ content })} />,
    );
    const body = screen.getByTestId('system-message-body');
    // retro: 이모지 + 공백 제거 후 em-dash wrap
    expect(body.textContent?.startsWith('— ')).toBe(true);
    expect(body.textContent?.endsWith(' —')).toBe(true);
    expect(body.textContent).not.toContain('📌');
    expect(body.textContent).not.toContain('🗳');
    expect(body.textContent).not.toContain('✅');
  });

  it('non-retro themes keep emoji prefix intact', () => {
    renderWithTheme(
      'warm',
      <SystemMessage
        message={makeSystemMessage({ content: '📌 공지사항' })}
      />,
    );
    expect(screen.getByTestId('system-message-body').textContent).toBe(
      '📌 공지사항',
    );
  });
});

describe('SystemMessage — source-level hex color literal guard', () => {
  it('SystemMessage.tsx contains zero hex color literals', () => {
    const source = readFileSync(
      resolve(__dirname, '..', 'SystemMessage.tsx'),
      'utf-8',
    );
    expect(source.match(/#[0-9a-fA-F]{3,6}\b/g)).toBeNull();
  });
});
