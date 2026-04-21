// @vitest-environment jsdom

/**
 * Message (R5-Task6) — themeKey 3-way 구조 diff + compact 모드 + hex guard.
 *
 * 3 테마 각각 DOM 차이 단언:
 * - warm    : ProfileAvatar(shape=circle) + header(name/time) + sans content
 * - tactical: ProfileAvatar(shape=diamond) + header(name/time) + sans content
 * - retro   : ProfileAvatar 미렌더, mono name prefix 64px minWidth, header 없음
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Message, type MessageAuthorInfo } from '../Message';
import { i18next } from '../../../i18n';
import { ThemeProvider } from '../../../theme/theme-provider';
import {
  DEFAULT_MODE,
  DEFAULT_THEME,
  useThemeStore,
} from '../../../theme/theme-store';
import type { ThemeKey } from '../../../theme/theme-tokens';
import type { Message as ChannelMessage } from '../../../../shared/message-types';

function makeMessage(overrides: Partial<ChannelMessage> = {}): ChannelMessage {
  return {
    id: 'm-1',
    channelId: 'c-1',
    meetingId: null,
    authorId: 'prov-alice',
    authorKind: 'member',
    role: 'assistant',
    content: '안녕하세요, 오늘 스케줄 공유드립니다.',
    meta: null,
    createdAt: 1_700_000_000_000,
    ...overrides,
  };
}

function makeAuthor(
  overrides: Partial<MessageAuthorInfo> = {},
): MessageAuthorInfo {
  return {
    id: 'prov-alice',
    name: 'Alice',
    initials: 'A',
    roleAtProject: '기획',
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

describe('Message — warm: ProfileAvatar(circle) + full header', () => {
  it('renders circle avatar, name, time, and role in header', () => {
    renderWithTheme(
      'warm',
      <Message message={makeMessage()} member={makeAuthor()} />,
    );
    const root = screen.getByTestId('message');
    expect(root.getAttribute('data-theme-variant')).toBe('warm');
    expect(root.getAttribute('data-compact')).toBe('false');

    const avatar = screen.getByTestId('profile-avatar');
    expect(avatar.getAttribute('data-shape')).toBe('circle');

    expect(screen.getByTestId('message-header')).toBeTruthy();
    expect(screen.getByTestId('message-name').textContent).toBe('Alice');
    expect(screen.getByTestId('message-time').textContent).not.toBe('');
    expect(screen.getByTestId('message-role').textContent).toBe('기획');
    expect(screen.getByTestId('message-content').textContent).toContain(
      '안녕하세요',
    );
    expect(screen.queryByTestId('message-name-prefix')).toBeNull();
  });

  it('font family is sans (not mono) on root', () => {
    renderWithTheme(
      'warm',
      <Message message={makeMessage()} member={makeAuthor()} />,
    );
    const root = screen.getByTestId('message');
    expect(root.className).toContain('font-sans');
    expect(root.className).not.toContain('font-mono');
  });
});

describe('Message — tactical: ProfileAvatar(diamond) + full header', () => {
  it('renders diamond avatar and full header', () => {
    renderWithTheme(
      'tactical',
      <Message message={makeMessage()} member={makeAuthor()} />,
    );
    const root = screen.getByTestId('message');
    expect(root.getAttribute('data-theme-variant')).toBe('tactical');
    expect(screen.getByTestId('profile-avatar').getAttribute('data-shape')).toBe(
      'diamond',
    );
    expect(screen.getByTestId('message-header')).toBeTruthy();
    expect(screen.queryByTestId('message-name-prefix')).toBeNull();
  });
});

describe('Message — retro: no avatar, mono name prefix 64px, no header row', () => {
  it('omits ProfileAvatar and message-header', () => {
    renderWithTheme(
      'retro',
      <Message message={makeMessage()} member={makeAuthor()} />,
    );
    expect(screen.queryByTestId('profile-avatar')).toBeNull();
    expect(screen.queryByTestId('message-header')).toBeNull();
    expect(screen.queryByTestId('message-time')).toBeNull();
  });

  it('mono name prefix has 64px minWidth and brand color', () => {
    renderWithTheme(
      'retro',
      <Message message={makeMessage()} member={makeAuthor()} />,
    );
    const prefix = screen.getByTestId('message-name-prefix');
    expect(prefix.textContent).toBe('Alice');
    expect(prefix.style.minWidth).toBe('64px');
    expect(prefix.className).toContain('text-brand');
  });

  it('root uses mono font', () => {
    renderWithTheme(
      'retro',
      <Message message={makeMessage()} member={makeAuthor()} />,
    );
    const root = screen.getByTestId('message');
    expect(root.className).toContain('font-mono');
    expect(root.className).not.toContain('font-sans');
    expect(root.getAttribute('data-theme-variant')).toBe('retro');
  });
});

describe('Message — compact mode omits avatar + header across themes', () => {
  it.each(['warm', 'tactical'] as const)(
    '%s: compact=true → no avatar, no header, only content',
    (themeKey) => {
      renderWithTheme(
        themeKey,
        <Message message={makeMessage()} member={makeAuthor()} compact />,
      );
      expect(screen.queryByTestId('profile-avatar')).toBeNull();
      expect(screen.queryByTestId('message-avatar-placeholder')).toBeNull();
      expect(screen.queryByTestId('message-header')).toBeNull();
      expect(screen.getByTestId('message-content').textContent).toContain(
        '안녕하세요',
      );
      expect(screen.getByTestId('message').getAttribute('data-compact')).toBe(
        'true',
      );
    },
  );

  it('retro: compact=true → no mono name prefix, only content', () => {
    renderWithTheme(
      'retro',
      <Message message={makeMessage()} member={makeAuthor()} compact />,
    );
    expect(screen.queryByTestId('message-name-prefix')).toBeNull();
    expect(screen.getByTestId('message-content').textContent).toContain(
      '안녕하세요',
    );
    expect(screen.getByTestId('message').getAttribute('data-compact')).toBe(
      'true',
    );
  });
});

describe('Message — member=null fallback', () => {
  it('warm: renders avatar placeholder + authorId as name fallback', () => {
    renderWithTheme(
      'warm',
      <Message message={makeMessage({ authorId: 'prov-unknown' })} member={null} />,
    );
    expect(screen.queryByTestId('profile-avatar')).toBeNull();
    expect(screen.getByTestId('message-avatar-placeholder')).toBeTruthy();
    expect(screen.getByTestId('message-name').textContent).toBe('prov-unknown');
    expect(screen.queryByTestId('message-role')).toBeNull();
  });

  it('retro: renders authorId in mono prefix', () => {
    renderWithTheme(
      'retro',
      <Message
        message={makeMessage({ authorId: 'prov-unknown' })}
        member={null}
      />,
    );
    expect(screen.getByTestId('message-name-prefix').textContent).toBe(
      'prov-unknown',
    );
  });
});

describe('Message — source-level hex color literal guard', () => {
  it('Message.tsx contains zero hex color literals', () => {
    const source = readFileSync(resolve(__dirname, '..', 'Message.tsx'), 'utf-8');
    expect(source.match(/#[0-9a-fA-F]{3,6}\b/g)).toBeNull();
  });
});
