// @vitest-environment jsdom

/**
 * RoomHeader + RoomMenu (spec 2026-10-01-messenger-redesign.md R3-1): the
 * bubble header (avatars, name, "이름들 · AI N명"), the log header
 * (`> 이름`, "참가자: …"), the "귓속말까지 보는 중" marker where AIs whisper,
 * and the ⋯ menu that now holds the old header actions.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RoomHeader } from '../RoomHeader';
import { roomMenuItems } from '../RoomMenu';
import { i18next } from '../../../i18n';
import { ThemeProvider } from '../../../theme/theme-provider';
import { DEFAULT_MODE, DEFAULT_THEME, useThemeStore } from '../../../theme/theme-store';
import type { ThemeKey } from '../../../theme/theme-tokens';
import { chatChannelForTest } from '../../../../test-utils/channel-fixture';
import type { Channel } from '../../../../shared/channel-types';
import type { MemberView, WorkStatus } from '../../../../shared/member-profile-types';

const t = i18next.t.bind(i18next);

function member(providerId: string, displayName: string): MemberView {
  return {
    providerId, displayName, characterSheet: '', avatarKind: 'default', avatarData: null,
    statusOverride: null, updatedAt: 1, workStatus: 'online' as WorkStatus,
  };
}

const MEMBERS = [member('ai-luna', '루나'), member('ai-haerang', '해랑'), member('ai-sora', '소라')];
const room = chatChannelForTest({
  id: 'room-1', projectId: null, name: '새벽 감성 토크', kind: 'user', readOnly: false, createdAt: 1,
  isChatRoom: true, archivedAt: null,
});
const dm = chatChannelForTest({ id: 'dm-1', projectId: null, name: 'dm:ai-luna', kind: 'dm', readOnly: false, createdAt: 1 });
const general = chatChannelForTest({
  id: 'general-1', projectId: null, name: 'general', kind: 'system_general', readOnly: false, createdAt: 1,
});

function renderHeader(themeKey: ThemeKey, channel: Channel, title: string, members: MemberView[]) {
  useThemeStore.setState({ themeKey, mode: 'dark' });
  const onToggleDrawer = vi.fn();
  render(
    <ThemeProvider>
      <RoomHeader channel={channel} title={title} members={members} drawerOpen={false}
        onToggleDrawer={onToggleDrawer} onDeleteDm={vi.fn()} onNavigate={vi.fn()} />
    </ThemeProvider>,
  );
  return { onToggleDrawer };
}

beforeEach(() => {
  void i18next.changeLanguage('ko');
  vi.stubGlobal('arena', { platform: 'linux', invoke: vi.fn(async (channel: string) => {
    throw new Error(`unexpected IPC: ${channel}`);
  }), onStream: () => () => {} });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  useThemeStore.setState({ themeKey: DEFAULT_THEME, mode: DEFAULT_MODE });
});

describe('RoomHeader', () => {
  it('bubbles: stacked avatars, the room name and "이름들 · AI N명"', () => {
    renderHeader('tactical', room, room.name, MEMBERS);
    expect(screen.getByTestId('room-header-avatars').querySelectorAll('[data-testid="avatar"]')).toHaveLength(3);
    expect(screen.getByTestId('room-title').textContent).toBe('새벽 감성 토크');
    expect(screen.getByTestId('room-subtitle').textContent).toBe('루나, 해랑, 소라 · AI 3명');
    expect(screen.getByTestId('thread-whisper-observer-notice').textContent).toBe('귓속말까지 보는 중');
  });

  it('log: "> 이름", "참가자: …", the bracketed marker and no avatars', () => {
    renderHeader('retro', room, room.name, MEMBERS);
    expect(screen.queryByTestId('room-header-avatars')).toBeNull();
    expect(screen.getByTestId('room-title').textContent).toBe('> 새벽 감성 토크');
    expect(screen.getByTestId('room-subtitle').textContent).toBe('참가자: 루나, 해랑, 소라');
    expect(screen.getByTestId('thread-whisper-observer-notice').textContent).toBe('[귓속말까지 보는 중]');
  });

  it('a DM says "1:1 대화" and has no whisper marker', () => {
    renderHeader('tactical', dm, '루나', [MEMBERS[0] as MemberView]);
    expect(screen.getByTestId('room-subtitle').textContent).toBe('1:1 대화');
    expect(screen.queryByTestId('thread-whisper-observer-notice')).toBeNull();
  });

  it('toggles the room-info drawer and opens the in-room search', () => {
    const { onToggleDrawer } = renderHeader('tactical', general, '일반 채널', MEMBERS);
    fireEvent.click(screen.getByTestId('room-info-toggle'));
    expect(onToggleDrawer).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('room-search-open'));
    const dialog = screen.getByTestId('message-search-dialog');
    expect(dialog.getAttribute('data-scope')).toBe('channel');
    expect(screen.getByTestId('message-search-channel-label').textContent).toContain('일반 채널');
  });
});

describe('roomMenuItems', () => {
  const all = { onPostOpinion: vi.fn(), onArchiveRoom: vi.fn(), onDeleteRoom: vi.fn(), onDeleteDm: vi.fn() };
  const ids = (channel: Channel) => roomMenuItems(t, channel, all).map((item) => item.testId);

  it('offers 의견 게시 and 보관 in a writable room, 삭제 in an archived one', () => {
    expect(ids(room)).toEqual(['chat-post-opinion', 'room-archive-open']);
    expect(ids({ ...room, readOnly: true, archivedAt: 5 })).toEqual(['room-delete-open']);
  });

  it('offers 의견 게시 in general and only DM deletion in a DM', () => {
    expect(ids(general)).toEqual(['chat-post-opinion']);
    expect(ids(dm)).toEqual(['chat-delete-dm']);
  });

  it('leaves out actions the caller does not provide', () => {
    expect(roomMenuItems(t, dm, {}).length).toBe(0);
  });
});
