// @vitest-environment jsdom

/**
 * LogMessageBlock — the log layout (spec 2026-10-01-messenger-redesign.md
 * R3-3/R3-4): `이름 [hh:mm]` in the seat color ("나" in brand for the
 * user), one `└ 내용` line per message, no avatars, and a whisper block
 * drawn wholly in the whisper color with its route.
 */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LogMessageBlock } from '../LogMessageBlock';
import type { MessageSpeaker } from '../Message';
import { i18next } from '../../../i18n';
import { ThemeProvider } from '../../../theme/theme-provider';
import { DEFAULT_MODE, DEFAULT_THEME, useThemeStore } from '../../../theme/theme-store';
import type { MemberView, WorkStatus } from '../../../../shared/member-profile-types';
import type { Message as ChannelMessage } from '../../../../shared/message-types';

const AT = new Date(2026, 9, 1, 21, 12).getTime();

function message(id: string, overrides: Partial<ChannelMessage> = {}): ChannelMessage {
  return {
    id, channelId: 'c-1', meetingId: null, authorId: 'prov-sora', authorKind: 'member',
    role: 'assistant', content: `line ${id}`, meta: null, createdAt: AT, ...overrides,
  };
}

function speaker(seat: number): MessageSpeaker {
  const profile: MemberView = {
    providerId: 'prov-sora', characterSheet: '', avatarKind: 'default', avatarData: null,
    statusOverride: null, updatedAt: 1, displayName: 'Sora', workStatus: 'online' as WorkStatus,
  };
  return { name: 'Sora', seat, profile };
}

function renderRetro(ui: React.ReactElement): ReturnType<typeof render> {
  useThemeStore.setState({ themeKey: 'retro', mode: 'dark' });
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

beforeEach(() => { void i18next.changeLanguage('ko'); });
afterEach(() => {
  cleanup();
  useThemeStore.setState({ themeKey: DEFAULT_THEME, mode: DEFAULT_MODE });
});

describe('LogMessageBlock', () => {
  it('shows one name line and a └ line per message, without avatars', () => {
    renderRetro(<LogMessageBlock messages={[message('a'), message('b')]} speaker={speaker(2)} />);
    const name = screen.getByTestId('message-name');
    expect(name.textContent).toBe('Sora');
    expect(name.className).toContain('text-name-3');
    expect(screen.getByTestId('message-time').textContent).toBe('[21:12]');
    const rows = screen.getAllByTestId('message');
    expect(rows.map((row) => row.textContent)).toEqual(['└line a', '└line b']);
    expect(rows.map((row) => row.getAttribute('data-compact'))).toEqual(['false', 'true']);
    expect(screen.queryByTestId('message-avatar-trigger')).toBeNull();
    expect(screen.queryByTestId('avatar')).toBeNull();
  });

  it('names the user "나" in the brand color', () => {
    renderRetro(<LogMessageBlock messages={[message('u', { authorId: 'user', authorKind: 'user', role: 'user' })]}
      speaker={null} />);
    const name = screen.getByTestId('message-name');
    expect(name.textContent).toBe('나');
    expect(name.className).toContain('text-brand');
  });

  it('draws a whisper block wholly in the whisper color with its route and kind', () => {
    renderRetro(<LogMessageBlock speaker={speaker(0)} messages={[message('w', {
      visibility: 'whisper', whisper: {
        recipientId: 'prov-luna', senderName: 'Sora', recipientName: 'Luna',
        sourceMessageId: 'user-1', replyToMessageId: null, threadSeq: 1,
      },
    })]} />);
    const block = screen.getByTestId('message-block');
    expect(block.getAttribute('data-visibility')).toBe('whisper');
    expect(block.className).toContain('text-whisper-fg');
    expect(screen.queryByTestId('message-name')).toBeNull();
    expect(screen.getByTestId('message-whisper-route').textContent).toBe('Sora → Luna');
    expect(screen.getByTestId('message-whisper-kind').textContent).toBe('귓속말');
  });
});
