// @vitest-environment jsdom

/**
 * ChannelHeader (R5-Task5) — kind 별 액션 활성 여부 + 읽기전용 배지 + hex guard.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChannelHeader } from '../ChannelHeader';
import { i18next } from '../../../i18n';
import { ThemeProvider } from '../../../theme/theme-provider';
import {
  DEFAULT_MODE,
  DEFAULT_THEME,
  useThemeStore,
} from '../../../theme/theme-store';
import type { ThemeKey } from '../../../theme/theme-tokens';
import type { Channel, ChannelKind } from '../../../../shared/channel-types';

function makeChannel(
  kind: ChannelKind,
  overrides: Partial<Channel> = {},
): Channel {
  return {
    id: `c-${kind}`,
    projectId: kind === 'dm' ? null : 'p-a',
    name: kind === 'user' ? '기획' : kind,
    kind,
    readOnly: kind === 'system_approval' || kind === 'system_minutes',
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

beforeEach(() => {
  useThemeStore.setState({ themeKey: DEFAULT_THEME, mode: DEFAULT_MODE });
  void i18next.changeLanguage('ko');
});

afterEach(() => {
  cleanup();
  useThemeStore.setState({ themeKey: DEFAULT_THEME, mode: DEFAULT_MODE });
});

describe('ChannelHeader — core content', () => {
  it('renders #-glyph + channel name + member count', () => {
    renderWithTheme(
      'warm',
      <ChannelHeader
        channel={makeChannel('user', { name: '기획' })}
        memberCount={3}
      />,
    );
    expect(screen.getByTestId('channel-header-glyph').textContent).toBe('#');
    expect(screen.getByTestId('channel-header-name').textContent).toBe('기획');
    expect(screen.getByTestId('channel-header-member-count').textContent).toContain(
      '3',
    );
  });

  it('member count of null renders a dash', () => {
    renderWithTheme(
      'warm',
      <ChannelHeader channel={makeChannel('user')} memberCount={null} />,
    );
    expect(screen.getByTestId('channel-header-member-count').textContent).toBe('—');
  });

  it('retro themeKey: channel name uses mono font + glyph gets brand color', () => {
    renderWithTheme(
      'retro',
      <ChannelHeader channel={makeChannel('user')} memberCount={1} />,
    );
    const name = screen.getByTestId('channel-header-name');
    expect(name.className).toContain('font-mono');
    const glyph = screen.getByTestId('channel-header-glyph');
    expect(glyph.className).toContain('text-brand');
  });
});

describe('ChannelHeader — start-meeting button by kind + meeting state', () => {
  it('user kind + no active meeting → start meeting button rendered and enabled', () => {
    const onStart = vi.fn();
    renderWithTheme(
      'warm',
      <ChannelHeader
        channel={makeChannel('user')}
        memberCount={3}
        activeMeetingCount={0}
        onStartMeeting={onStart}
      />,
    );
    const btn = screen.getByTestId('channel-header-start-meeting') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('user kind + active meeting → start meeting disabled with tooltip', () => {
    renderWithTheme(
      'warm',
      <ChannelHeader
        channel={makeChannel('user')}
        memberCount={3}
        activeMeetingCount={1}
        onStartMeeting={() => undefined}
      />,
    );
    const btn = screen.getByTestId('channel-header-start-meeting') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('data-disabled')).toBe('true');
    expect(btn.getAttribute('title')).toBe('이미 회의 중');
  });

  it('dm kind → start meeting button NOT rendered', () => {
    renderWithTheme(
      'warm',
      <ChannelHeader
        channel={makeChannel('dm', { name: 'yuna' })}
        memberCount={2}
        onStartMeeting={() => undefined}
      />,
    );
    expect(screen.queryByTestId('channel-header-start-meeting')).toBeNull();
  });

  it('system kind → start meeting button NOT rendered', () => {
    renderWithTheme(
      'warm',
      <ChannelHeader
        channel={makeChannel('system_approval')}
        memberCount={3}
        onStartMeeting={() => undefined}
      />,
    );
    expect(screen.queryByTestId('channel-header-start-meeting')).toBeNull();
  });
});

describe('ChannelHeader — rename / delete disabled for system kinds', () => {
  it('user channel → rename + delete enabled', () => {
    const onRename = vi.fn();
    const onDelete = vi.fn();
    renderWithTheme(
      'warm',
      <ChannelHeader
        channel={makeChannel('user')}
        memberCount={3}
        onRename={onRename}
        onDelete={onDelete}
      />,
    );
    const rename = screen.getByTestId('channel-header-rename') as HTMLButtonElement;
    const del = screen.getByTestId('channel-header-delete') as HTMLButtonElement;
    expect(rename.disabled).toBe(false);
    expect(del.disabled).toBe(false);
    fireEvent.click(rename);
    fireEvent.click(del);
    expect(onRename).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it.each(['system_general', 'system_approval', 'system_minutes'] as const)(
    'kind=%s → rename + delete rendered but disabled with system tooltip',
    (kind) => {
      renderWithTheme(
        'warm',
        <ChannelHeader
          channel={makeChannel(kind)}
          memberCount={3}
          onRename={() => undefined}
          onDelete={() => undefined}
        />,
      );
      const rename = screen.getByTestId('channel-header-rename') as HTMLButtonElement;
      const del = screen.getByTestId('channel-header-delete') as HTMLButtonElement;
      expect(rename.disabled).toBe(true);
      expect(del.disabled).toBe(true);
      expect(rename.getAttribute('title')).toContain('시스템 채널');
      expect(del.getAttribute('title')).toContain('시스템 채널');
    },
  );

  it('dm channel → rename NOT rendered, delete enabled', () => {
    renderWithTheme(
      'warm',
      <ChannelHeader
        channel={makeChannel('dm', { name: 'yuna' })}
        memberCount={2}
        onDelete={() => undefined}
      />,
    );
    expect(screen.queryByTestId('channel-header-rename')).toBeNull();
    const del = screen.getByTestId('channel-header-delete') as HTMLButtonElement;
    expect(del.disabled).toBe(false);
  });
});

describe('ChannelHeader — read-only badge + misc', () => {
  it('readOnly=true → badge rendered', () => {
    renderWithTheme(
      'warm',
      <ChannelHeader
        channel={makeChannel('system_approval')}
        memberCount={3}
      />,
    );
    expect(screen.getByTestId('channel-header-readonly-badge')).toBeTruthy();
  });

  it('readOnly=false → badge NOT rendered', () => {
    renderWithTheme(
      'warm',
      <ChannelHeader
        channel={makeChannel('user', { readOnly: false })}
        memberCount={3}
      />,
    );
    expect(screen.queryByTestId('channel-header-readonly-badge')).toBeNull();
  });

  it('data-theme-variant + data-channel-kind exposed on root', () => {
    renderWithTheme(
      'tactical',
      <ChannelHeader
        channel={makeChannel('user')}
        memberCount={3}
      />,
    );
    const root = screen.getByTestId('channel-header');
    expect(root.getAttribute('data-theme-variant')).toBe('tactical');
    expect(root.getAttribute('data-channel-kind')).toBe('user');
  });
});

describe('ChannelHeader — source-level hex color literal guard', () => {
  it('ChannelHeader.tsx contains zero hex color literals', () => {
    const source = readFileSync(
      resolve(__dirname, '..', 'ChannelHeader.tsx'),
      'utf-8',
    );
    expect(source.match(/#[0-9a-fA-F]{3,6}\b/g)).toBeNull();
  });
});
