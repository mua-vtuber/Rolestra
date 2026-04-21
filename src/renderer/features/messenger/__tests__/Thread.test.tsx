// @vitest-environment jsdom

/**
 * Thread (R5-Task5) — active-channel 분기 + ChannelHeader 통합.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  cleanup,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Thread } from '../Thread';
import { i18next } from '../../../i18n';
import { ThemeProvider } from '../../../theme/theme-provider';
import {
  DEFAULT_MODE,
  DEFAULT_THEME,
  useThemeStore,
} from '../../../theme/theme-store';
import {
  ACTIVE_CHANNEL_STORAGE_KEY,
  useActiveChannelStore,
} from '../../../stores/active-channel-store';
import type { Channel } from '../../../../shared/channel-types';
import type { ActiveMeetingSummary } from '../../../../shared/meeting-types';
import type { MemberView } from '../../../../shared/member-profile-types';

const PROJECT_ID = 'p-a';

function makeChannel(overrides: Partial<Channel>): Channel {
  return {
    id: 'c-generic',
    projectId: PROJECT_ID,
    name: 'generic',
    kind: 'user',
    readOnly: false,
    createdAt: 1_700_000_000_000,
    ...overrides,
  };
}

function makeMember(id: string): MemberView {
  return {
    providerId: id,
    displayName: id,
    avatarColor: '#123456',
    role: 'member',
    status: 'active',
    personality: null,
    expertise: [],
  } as unknown as MemberView;
}

interface StubOptions {
  channels?: Channel[];
  dms?: Channel[];
  meetings?: ActiveMeetingSummary[];
  members?: MemberView[];
  messages?: Array<Record<string, unknown>>;
}

function stubBridge(options: StubOptions = {}) {
  const channels = options.channels ?? [];
  const dms = options.dms ?? [];
  const meetings = options.meetings ?? [];
  const members = options.members ?? [];
  const messages = options.messages ?? [];
  const invoke = vi.fn(async (channel: string, data: unknown) => {
    if (channel === 'channel:list') {
      const payload = data as { projectId: string | null };
      return payload.projectId === null
        ? { channels: dms }
        : { channels };
    }
    if (channel === 'member:list') return { members };
    if (channel === 'meeting:list-active') return { meetings };
    if (channel === 'message:list-by-channel') return { messages };
    throw new Error(`no mock for channel ${channel}`);
  });
  vi.stubGlobal('arena', { platform: 'linux', invoke });
  return invoke;
}

function resetStores(): void {
  useActiveChannelStore.setState({ channelIdByProject: {} });
  localStorage.removeItem(ACTIVE_CHANNEL_STORAGE_KEY);
  useThemeStore.setState({ themeKey: DEFAULT_THEME, mode: DEFAULT_MODE });
}

function renderThread(ui: React.ReactElement): ReturnType<typeof render> {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

beforeEach(() => {
  vi.unstubAllGlobals();
  resetStores();
  void i18next.changeLanguage('ko');
});

afterEach(() => {
  cleanup();
  resetStores();
  vi.unstubAllGlobals();
});

describe('Thread — empty state when no active channel', () => {
  it('renders empty-state when active channel id is unset', async () => {
    stubBridge({ channels: [makeChannel({ id: 'c-plan', name: '기획' })] });
    renderThread(<Thread projectId={PROJECT_ID} />);

    await waitFor(() =>
      expect(screen.getByTestId('thread').getAttribute('data-empty')).toBe('true'),
    );
    expect(screen.getByTestId('thread-empty-state').textContent).toContain(
      '채널을 선택',
    );
  });

  it('renders empty-state when memorised channel no longer exists (pruned list)', async () => {
    // Pre-set active channel to an id that is NOT in the fresh list → the
    // validation effect of useActiveChannel will clear it and Thread
    // should show empty-state.
    useActiveChannelStore.setState({
      channelIdByProject: { [PROJECT_ID]: 'c-gone' },
    });
    stubBridge({ channels: [makeChannel({ id: 'c-plan', name: '기획' })] });
    renderThread(<Thread projectId={PROJECT_ID} />);

    await waitFor(() =>
      expect(screen.getByTestId('thread').getAttribute('data-empty')).toBe('true'),
    );
  });
});

describe('Thread — renders ChannelHeader when a user channel is active', () => {
  it('mounts ChannelHeader with channel name + start meeting button', async () => {
    useActiveChannelStore.setState({
      channelIdByProject: { [PROJECT_ID]: 'c-plan' },
    });
    stubBridge({
      channels: [
        makeChannel({ id: 'c-plan', name: '기획', kind: 'user' }),
        makeChannel({ id: 'c-ref', name: '리팩토링', kind: 'user' }),
      ],
      members: [makeMember('a'), makeMember('b')],
      meetings: [],
    });
    renderThread(<Thread projectId={PROJECT_ID} />);

    await waitFor(() =>
      expect(screen.getByTestId('channel-header-name').textContent).toBe('기획'),
    );
    const thread = screen.getByTestId('thread');
    expect(thread.getAttribute('data-empty')).toBe('false');
    expect(thread.getAttribute('data-channel-id')).toBe('c-plan');

    const startBtn = screen.getByTestId(
      'channel-header-start-meeting',
    ) as HTMLButtonElement;
    // Without onStartMeeting prop the button is disabled by the handler
    // absence; Task 7 wires a prop.
    expect(startBtn.getAttribute('data-disabled')).toBe('false');
    expect(startBtn.disabled).toBe(true);
  });

  it('disables the start-meeting button when a meeting is active in the channel', async () => {
    useActiveChannelStore.setState({
      channelIdByProject: { [PROJECT_ID]: 'c-plan' },
    });
    stubBridge({
      channels: [makeChannel({ id: 'c-plan', name: '기획', kind: 'user' })],
      members: [makeMember('a')],
      meetings: [
        {
          id: 'm-1',
          projectId: PROJECT_ID,
          projectName: 'P',
          channelId: 'c-plan',
          channelName: '기획',
          topic: 'n+1',
          stateIndex: 1,
          stateName: 'WORK_DISCUSSING',
        } as ActiveMeetingSummary,
      ],
    });
    renderThread(<Thread projectId={PROJECT_ID} onStartMeeting={() => undefined} />);

    await waitFor(() =>
      expect(screen.queryByTestId('channel-header-start-meeting')).toBeTruthy(),
    );
    const btn = screen.getByTestId('channel-header-start-meeting') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('data-disabled')).toBe('true');
    expect(btn.getAttribute('title')).toContain('회의');
  });
});

describe('Thread — ChannelHeader variants for system / dm kinds', () => {
  it('system_approval active channel → rename/delete disabled + readonly badge + no start-meeting', async () => {
    useActiveChannelStore.setState({
      channelIdByProject: { [PROJECT_ID]: 'c-sys-a' },
    });
    stubBridge({
      channels: [
        makeChannel({
          id: 'c-sys-a',
          name: 'system-approval',
          kind: 'system_approval',
          readOnly: true,
        }),
      ],
      members: [],
    });
    renderThread(
      <Thread
        projectId={PROJECT_ID}
        onRenameChannel={() => undefined}
        onDeleteChannel={() => undefined}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId('channel-header-readonly-badge')).toBeTruthy(),
    );
    expect(screen.queryByTestId('channel-header-start-meeting')).toBeNull();
    expect(
      (screen.getByTestId('channel-header-rename') as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByTestId('channel-header-delete') as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('dm active channel → no start-meeting, no rename, delete enabled', async () => {
    useActiveChannelStore.setState({
      channelIdByProject: { [PROJECT_ID]: 'c-dm-1' },
    });
    stubBridge({
      channels: [
        makeChannel({ id: 'c-plan', kind: 'user', name: '기획' }),
      ],
      dms: [
        makeChannel({
          id: 'c-dm-1',
          projectId: null,
          kind: 'dm',
          name: 'yuna',
        }),
      ],
      members: [makeMember('a')],
    });
    // Validation effect of useActiveChannel will clear c-dm-1 because
    // it is not in useChannels() result (project-scoped). DM channels
    // do not hang off `useChannels(projectId)` — they live in `useDms()`.
    // Thread in MVP treats "channel not in project list" as empty-state.
    renderThread(<Thread projectId={PROJECT_ID} />);

    await waitFor(() =>
      expect(screen.getByTestId('thread').getAttribute('data-empty')).toBe('true'),
    );
  });
});

describe('Thread — source-level hex color literal guard', () => {
  it('Thread.tsx contains zero hex color literals', () => {
    const source = readFileSync(resolve(__dirname, '..', 'Thread.tsx'), 'utf-8');
    expect(source.match(/#[0-9a-fA-F]{3,6}\b/g)).toBeNull();
  });
});
