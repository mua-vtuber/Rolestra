// @vitest-environment jsdom

/**
 * Message — the bubble layout row (spec 2026-10-01-messenger-redesign.md
 * R3-2/R3-4): the user's bubble on the right, an AI bubble on the left with
 * avatar and seat-colored name on the first message of a run, the time
 * beside the bubble, and a whisper as a dashed bubble with its route.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Message, type MessageSpeaker } from '../Message';
import { i18next } from '../../../i18n';
import { ThemeProvider } from '../../../theme/theme-provider';
import {
  DEFAULT_MODE,
  DEFAULT_THEME,
  useThemeStore,
} from '../../../theme/theme-store';
import type { MemberView, WorkStatus } from '../../../../shared/member-profile-types';
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
    createdAt: new Date(2026, 9, 1, 21, 5).getTime(),
    ...overrides,
  };
}

function makeSpeaker(name = 'Alice', seat = 1): MessageSpeaker {
  const profile: MemberView = {
    providerId: 'prov-alice',
    characterSheet: '',
    avatarKind: 'default',
    avatarData: null,
    statusOverride: null,
    updatedAt: 1_700_000_000_000,
    displayName: name,
    workStatus: 'online' as WorkStatus,
  };
  return { name, seat, profile };
}

function renderTactical(ui: React.ReactElement): ReturnType<typeof render> {
  useThemeStore.setState({ themeKey: 'tactical', mode: 'light' });
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

describe('Message — AI bubble', () => {
  it('first of a run shows avatar and the name in its seat color, time beside the bubble', () => {
    renderTactical(<Message message={makeMessage()} speaker={makeSpeaker('Alice', 1)} groupStart />);
    const root = screen.getByTestId('message');
    expect(root.getAttribute('data-compact')).toBe('false');
    expect(root.getAttribute('data-author-kind')).toBe('member');
    expect(screen.getByTestId('message-avatar-trigger')).toBeTruthy();
    const name = screen.getByTestId('message-name');
    expect(name.textContent).toBe('Alice');
    expect(name.className).toContain('text-name-2');
    expect(screen.getByTestId('message-time').textContent).toBe('21:05');
    expect(screen.getByTestId('message-content').textContent).toContain('안녕하세요');
  });

  it('a following message of the same run has no name or avatar', () => {
    renderTactical(<Message message={makeMessage()} speaker={makeSpeaker()} groupStart={false} />);
    expect(screen.getByTestId('message').getAttribute('data-compact')).toBe('true');
    expect(screen.queryByTestId('message-name')).toBeNull();
    expect(screen.queryByTestId('message-avatar-trigger')).toBeNull();
    expect(screen.getByTestId('message-time')).toBeTruthy();
  });

  it('an author missing from the member list shows a placeholder and the unknown name, not the raw id', () => {
    renderTactical(<Message message={makeMessage({ authorId: 'prov-unknown' })} speaker={null} groupStart />);
    expect(screen.getByTestId('message-avatar-placeholder')).toBeTruthy();
    expect(screen.getByTestId('message-name').textContent).not.toContain('prov-unknown');
    expect(screen.getByTestId('message-name').textContent).toBe(i18next.t('messenger.activity.unknownName'));
  });
});

describe('Message — the user bubble', () => {
  it('sits on the right in the my-bubble colors without name or avatar', () => {
    renderTactical(<Message message={makeMessage({ authorId: 'user', authorKind: 'user', role: 'user' })}
      speaker={null} groupStart />);
    const root = screen.getByTestId('message');
    expect(root.className).toContain('justify-end');
    expect(root.querySelector('.bg-bubble-mine-bg')).not.toBeNull();
    expect(screen.queryByTestId('message-name')).toBeNull();
    expect(screen.queryByTestId('message-avatar-trigger')).toBeNull();
    expect(screen.queryByTestId('message-avatar-placeholder')).toBeNull();
  });
});

describe('Message — observer whisper history', () => {
  const whisper = {
    recipientId: 'prov-bob', senderName: 'Alex', recipientName: 'Alex',
    sourceMessageId: 'user-1', replyToMessageId: null, threadSeq: 1,
  };

  it('keeps the persisted sender and recipient visible even mid-run, in a dashed bubble', () => {
    renderTactical(<Message message={makeMessage({ visibility: 'whisper', whisper })}
      speaker={makeSpeaker('Renamed author')} groupStart={false} />);
    const root = screen.getByTestId('message');
    expect(root.getAttribute('data-visibility')).toBe('whisper');
    expect(root.getAttribute('data-sender-id')).toBe('prov-alice');
    expect(root.getAttribute('data-recipient-id')).toBe('prov-bob');
    expect(root.querySelector('.border-dashed')).not.toBeNull();
    expect(screen.getByTestId('message-avatar-trigger')).toBeTruthy();
    expect(screen.getByTestId('message-whisper-route').textContent).toBe('Alex → Alex');
    expect(screen.getByTestId('message-whisper-route').getAttribute('title')).toContain('prov-alice');
    expect(screen.getByTestId('message-whisper-route').getAttribute('title')).toContain('prov-bob');
    expect(screen.getByTestId('message-whisper-kind').textContent).toBe('귓속말');
  });

  it('marks a private reply separately from its original whisper, with its thread position (F2-8)', () => {
    renderTactical(<Message message={makeMessage({
      authorId: 'prov-bob', visibility: 'whisper',
      whisper: { ...whisper, recipientId: 'prov-alice', senderName: 'Bob', recipientName: 'Alice',
        replyToMessageId: 'root-1', threadSeq: 3 },
    })} speaker={makeSpeaker('Bob')} groupStart />);
    expect(screen.getByTestId('message-whisper-kind').textContent).toBe('답장 3/4');
    expect(screen.getByTestId('message').getAttribute('data-thread-seq')).toBe('3');
    expect(screen.getByTestId('message-whisper-route').textContent).toBe('Bob → Alice');
  });

  it('leaves public messages without a whisper marker', () => {
    renderTactical(<Message message={makeMessage()} speaker={makeSpeaker()} groupStart />);
    expect(screen.getByTestId('message').getAttribute('data-visibility')).toBe('public');
    expect(screen.queryByTestId('message-whisper-kind')).toBeNull();
  });
});

describe('Message — source-level hex color literal guard', () => {
  it('Message.tsx contains zero hex color literals', () => {
    const source = readFileSync(resolve(__dirname, '..', 'Message.tsx'), 'utf-8');
    expect(source.match(/#[0-9a-fA-F]{3,6}\b/g)).toBeNull();
  });
});
