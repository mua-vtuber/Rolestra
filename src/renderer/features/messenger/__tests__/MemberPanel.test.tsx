// @vitest-environment jsdom

/**
 * MemberPanel (R5-Task9) — 2 Card(참여자 / 합의 상태) 조립 + empty/no-channel
 * 분기 + SsmBox wire.
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

import { MemberPanel } from '../MemberPanel';
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
    id: 'c-plan',
    projectId: PROJECT_ID,
    name: '기획',
    kind: 'user',
    readOnly: false,
    createdAt: 1_700_000_000_000,
    // R12-C T2 신규 필드 — legacy user 채널은 모두 null/디폴트.
    role: null,
    purpose: null,
    handoffMode: 'check',
    ...overrides,
  };
}

function makeMember(id: string): MemberView {
  return {
    providerId: id,
    role: 'member',
    personality: '',
    expertise: '',
    avatarKind: 'default',
    avatarData: null,
    statusOverride: null,
    updatedAt: 1_700_000_000_000,
    displayName: id,
    persona: '',
    workStatus: 'online',
  };
}

interface StubOptions {
  channels?: Channel[];
  members?: MemberView[];
  meetings?: ActiveMeetingSummary[];
}

function stubBridge(options: StubOptions = {}): void {
  const channels = options.channels ?? [];
  const members = options.members ?? [];
  const meetings = options.meetings ?? [];
  const invoke = vi.fn(async (channel: string, data: unknown) => {
    if (channel === 'channel:list') {
      const payload = data as { projectId: string | null };
      return payload.projectId === null
        ? { channels: [] }
        : { channels };
    }
    // R12-C dogfooding round 1: useChannelMembers 가 useMembers wrap →
    // 자체 channel:list-members 호출로 refactor. test 의 `members` 옵션이
    // 그대로 channel-scoped roster 로 사용되도록 mock 단순화.
    if (channel === 'channel:list-members') return { members };
    if (channel === 'member:list') return { members };
    if (channel === 'channel:get-global-general') return { channel: null };
    if (channel === 'meeting:list-active') return { meetings };
    throw new Error(`no mock for channel ${channel}`);
  });
  vi.stubGlobal('arena', { platform: 'linux', invoke });
}

function resetStores(): void {
  useActiveChannelStore.setState({ channelIdByProject: {} });
  localStorage.removeItem(ACTIVE_CHANNEL_STORAGE_KEY);
  useThemeStore.setState({ themeKey: DEFAULT_THEME, mode: DEFAULT_MODE });
}

function renderPanel(ui: React.ReactElement): ReturnType<typeof render> {
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

describe('MemberPanel — no active channel', () => {
  it('shows "select a channel" placeholder when no channel is active', async () => {
    stubBridge({ channels: [] });
    renderPanel(<MemberPanel projectId={PROJECT_ID} />);

    await waitFor(() =>
      expect(screen.getByTestId('member-panel')).toBeTruthy(),
    );
    expect(screen.getByTestId('member-panel-no-channel')).toBeTruthy();
    // SsmBox empty variant in consensus card.
    const ssm = screen.getByTestId('ssm-box');
    expect(ssm.getAttribute('data-has-meeting')).toBe('false');
  });
});

describe('MemberPanel — active channel with members', () => {
  it('renders member-row list with correct count title', async () => {
    useActiveChannelStore.setState({
      channelIdByProject: { [PROJECT_ID]: 'c-plan' },
    });
    stubBridge({
      channels: [makeChannel({ id: 'c-plan' })],
      members: [makeMember('alice'), makeMember('bob'), makeMember('carol')],
    });

    renderPanel(<MemberPanel projectId={PROJECT_ID} />);

    await waitFor(() =>
      expect(screen.queryAllByTestId('member-row').length).toBe(3),
    );
    const panel = screen.getByTestId('member-panel');
    expect(panel.getAttribute('data-channel-id')).toBe('c-plan');
    expect(screen.getByTestId('member-panel-list')).toBeTruthy();
    // Title count should contain "3".
    const participantsCard = screen.getByTestId('member-panel-participants');
    expect(participantsCard.textContent).toContain('3');
  });

  it('renders empty placeholder when channel has no members', async () => {
    useActiveChannelStore.setState({
      channelIdByProject: { [PROJECT_ID]: 'c-plan' },
    });
    stubBridge({
      channels: [makeChannel({ id: 'c-plan' })],
      members: [],
    });

    renderPanel(<MemberPanel projectId={PROJECT_ID} />);

    await waitFor(() =>
      expect(screen.queryByTestId('member-panel-empty')).toBeTruthy(),
    );
    expect(screen.queryAllByTestId('member-row').length).toBe(0);
  });
});

describe('MemberPanel — consensus card wires SsmBox to active meeting', () => {
  it('renders SsmBox with meeting when a meeting is active in the channel', async () => {
    useActiveChannelStore.setState({
      channelIdByProject: { [PROJECT_ID]: 'c-plan' },
    });
    stubBridge({
      channels: [makeChannel({ id: 'c-plan' })],
      members: [makeMember('alice')],
      meetings: [
        {
          id: 'm-1',
          projectId: PROJECT_ID,
          projectName: 'P',
          channelId: 'c-plan',
          channelName: '기획',
          topic: 'r5 task 9',
          stateIndex: 3,
          stateName: 'SYNTHESIZING',
          startedAt: 1_700_000_000_000,
          elapsedMs: 60_000,
          pausedAt: null,
        },
      ],
    });

    renderPanel(<MemberPanel projectId={PROJECT_ID} />);

    await waitFor(() => {
      const ssm = screen.getByTestId('ssm-box');
      expect(ssm.getAttribute('data-has-meeting')).toBe('true');
    });
    const ssm = screen.getByTestId('ssm-box');
    expect(ssm.getAttribute('data-state-index')).toBe('3');
    expect(ssm.getAttribute('data-state-name')).toBe('SYNTHESIZING');
  });

  it('SsmBox renders empty state when meeting list has no row for this channel', async () => {
    useActiveChannelStore.setState({
      channelIdByProject: { [PROJECT_ID]: 'c-plan' },
    });
    stubBridge({
      channels: [makeChannel({ id: 'c-plan' })],
      members: [makeMember('alice')],
      meetings: [],
    });

    renderPanel(<MemberPanel projectId={PROJECT_ID} />);

    await waitFor(() =>
      expect(screen.getByTestId('ssm-box').getAttribute('data-has-meeting')).toBe(
        'false',
      ),
    );
  });
});

describe('MemberPanel — source-level hex color literal guard', () => {
  it('MemberPanel.tsx contains zero hex color literals', () => {
    const source = readFileSync(
      resolve(__dirname, '..', 'MemberPanel.tsx'),
      'utf-8',
    );
    expect(source.match(/#[0-9a-fA-F]{3,6}\b/g)).toBeNull();
  });
});
