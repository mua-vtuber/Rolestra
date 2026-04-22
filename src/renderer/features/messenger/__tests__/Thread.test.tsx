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
  it('mounts ChannelHeader with channel name + start meeting button enabled (Task 7 host)', async () => {
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
    // R5-Task7: Thread 가 StartMeetingModal 을 자체 호스팅하므로 onStartMeeting
    // prop 이 항상 바인딩된다. 외부 prop 없이도 버튼이 활성화된다.
    expect(startBtn.disabled).toBe(false);
    expect(startBtn.getAttribute('data-disabled')).toBe('false');
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
          startedAt: 1_700_000_000_000,
          elapsedMs: 60_000,
        } as ActiveMeetingSummary,
      ],
    });
    renderThread(<Thread projectId={PROJECT_ID} />);

    await waitFor(() =>
      expect(screen.queryByTestId('channel-header-start-meeting')).toBeTruthy(),
    );
    const btn = screen.getByTestId('channel-header-start-meeting') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('data-disabled')).toBe('true');
    expect(btn.getAttribute('title')).toContain('회의');
  });
});

describe('Thread — MeetingBanner wire-up (Task 7)', () => {
  it('renders MeetingBanner when an active meeting exists in the channel', async () => {
    useActiveChannelStore.setState({
      channelIdByProject: { [PROJECT_ID]: 'c-plan' },
    });
    stubBridge({
      channels: [makeChannel({ id: 'c-plan', name: '기획', kind: 'user' })],
      members: [makeMember('a'), makeMember('b')],
      meetings: [
        {
          id: 'm-1',
          projectId: PROJECT_ID,
          projectName: 'P',
          channelId: 'c-plan',
          channelName: '기획',
          topic: 'r5 task 7',
          stateIndex: 2,
          stateName: 'WORK_DISCUSSING',
          startedAt: 1_700_000_000_000,
          elapsedMs: 3 * 60_000,
        } as ActiveMeetingSummary,
      ],
    });
    renderThread(<Thread projectId={PROJECT_ID} />);

    await waitFor(() =>
      expect(screen.getByTestId('meeting-banner')).toBeTruthy(),
    );
    expect(screen.getByTestId('meeting-banner').getAttribute('data-meeting-id')).toBe(
      'm-1',
    );
    expect(screen.getByTestId('meeting-banner-topic').textContent).toBe(
      'r5 task 7',
    );
  });

  it('does not render MeetingBanner when no active meeting for this channel', async () => {
    useActiveChannelStore.setState({
      channelIdByProject: { [PROJECT_ID]: 'c-plan' },
    });
    stubBridge({
      channels: [makeChannel({ id: 'c-plan', name: '기획', kind: 'user' })],
      members: [makeMember('a')],
      meetings: [],
    });
    renderThread(<Thread projectId={PROJECT_ID} />);

    await waitFor(() =>
      expect(screen.getByTestId('channel-header')).toBeTruthy(),
    );
    expect(screen.queryByTestId('meeting-banner')).toBeNull();
  });
});

describe('Thread — ChannelHeader variants for system / dm kinds', () => {
  it('system_approval active channel → rename/delete disabled + readonly badge + no start-meeting + ApprovalInboxView branch (R7-Task7)', async () => {
    useActiveChannelStore.setState({
      channelIdByProject: { [PROJECT_ID]: 'c-sys-a' },
    });
    const inboxStub = stubBridge({
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
    // The inbox calls approval:list — extend the mock so the branch lands
    // in the empty state instead of throwing. Thread.test's stubBridge
    // default throws on unknown channels.
    (inboxStub as unknown as { mockImplementation: (fn: (...args: unknown[]) => unknown) => void }).mockImplementation(
      async (...args: unknown[]) => {
        const channel = args[0] as string;
        const data = args[1];
        if (channel === 'channel:list') {
          const payload = data as { projectId: string | null };
          return payload.projectId === null
            ? { channels: [] }
            : {
                channels: [
                  makeChannel({
                    id: 'c-sys-a',
                    name: 'system-approval',
                    kind: 'system_approval',
                    readOnly: true,
                  }),
                ],
              };
        }
        if (channel === 'member:list') return { members: [] };
        if (channel === 'meeting:list-active') return { meetings: [] };
        if (channel === 'approval:list') return { items: [] };
        if (channel === 'message:list-by-channel') return { messages: [] };
        throw new Error(`no mock for channel ${channel}`);
      },
    );

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

    // R7-Task7: #승인-대기 채널에서는 ApprovalInboxView 가 message-list 대신
    // 단독 렌더된다.
    await waitFor(() =>
      expect(screen.getByTestId('approval-inbox-view')).toBeTruthy(),
    );
    expect(screen.queryByTestId('thread-message-list')).toBeNull();
    expect(
      screen.getByTestId('approval-inbox-view').getAttribute('data-project-id'),
    ).toBe(PROJECT_ID);
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
