// @vitest-environment jsdom

/**
 * ChannelRail (R5-Task4) — section order + section title 3-way + active click
 * wire + hex guard.
 *
 * 전략:
 * - `vi.stubGlobal('arena', ...)` 로 `channel:list` 를 두 번 다른 payload
 *   (projectId, projectId=null)로 받을 수 있도록 분기.
 * - 3 section 순서(system → user → DM)는 테스트가 DOM 순서로 단언.
 * - 테마별 section title 은 `data-theme-variant` + `i18n` ko 값으로 확인.
 * - 클릭 시 `active-channel-store` 에 set 되는지 store 상태로 확인.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChannelRail } from '../ChannelRail';
import { i18next } from '../../../i18n';
import { ThemeProvider } from '../../../theme/theme-provider';
import {
  DEFAULT_MODE,
  DEFAULT_THEME,
  useThemeStore,
} from '../../../theme/theme-store';
import type { ThemeKey } from '../../../theme/theme-tokens';
import {
  ACTIVE_CHANNEL_STORAGE_KEY,
  useActiveChannelStore,
} from '../../../stores/active-channel-store';
import type { Channel } from '../../../../shared/channel-types';

function makeChannel(overrides: Partial<Channel> = {}): Channel {
  return {
    id: 'c-generic',
    projectId: 'p-a',
    name: 'generic',
    kind: 'user',
    readOnly: false,
    createdAt: 1_700_000_000_000,
    ...overrides,
  };
}

interface StubOptions {
  channelsForProject?: Channel[];
  dms?: Channel[];
  projectId?: string;
}

function stubBridge(options: StubOptions = {}) {
  const channelsForProject = options.channelsForProject ?? [];
  const dms = options.dms ?? [];
  const invoke = vi.fn(async (channel: string, data: unknown) => {
    if (channel === 'channel:list') {
      const payload = data as { projectId: string | null };
      return payload.projectId === null
        ? { channels: dms }
        : { channels: channelsForProject };
    }
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

function renderWithTheme(
  themeKey: ThemeKey,
  ui: React.ReactElement,
): ReturnType<typeof render> {
  useThemeStore.setState({ themeKey, mode: 'light' });
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

const PROJECT_ID = 'p-a';

const SYSTEM_CHANNELS: Channel[] = [
  makeChannel({
    id: 'c-sys-g',
    kind: 'system_general',
    name: 'system-general',
    createdAt: 1,
    readOnly: false,
  }),
  makeChannel({
    id: 'c-sys-a',
    kind: 'system_approval',
    name: 'system-approval',
    createdAt: 2,
    readOnly: true,
  }),
  makeChannel({
    id: 'c-sys-m',
    kind: 'system_minutes',
    name: 'system-minutes',
    createdAt: 3,
    readOnly: true,
  }),
];

const USER_CHANNELS: Channel[] = [
  makeChannel({ id: 'c-plan', kind: 'user', name: '기획', createdAt: 4 }),
  makeChannel({ id: 'c-refactor', kind: 'user', name: '리팩토링', createdAt: 5 }),
];

const DMS: Channel[] = [
  makeChannel({
    id: 'c-dm-1',
    projectId: null,
    kind: 'dm',
    name: 'yuna',
    createdAt: 6,
  }),
];

describe('ChannelRail — section order + section filtering', () => {
  it('renders 3 sections in order: system → user → DM', async () => {
    stubBridge({
      channelsForProject: [...SYSTEM_CHANNELS, ...USER_CHANNELS],
      dms: DMS,
    });
    renderWithTheme('warm', <ChannelRail projectId={PROJECT_ID} />);

    await waitFor(() =>
      expect(screen.queryAllByTestId('channel-row')).toHaveLength(6),
    );

    const rail = screen.getByTestId('channel-rail');
    const sections = Array.from(rail.querySelectorAll<HTMLElement>('section[data-testid]'));
    expect(sections.map((s) => s.getAttribute('data-testid'))).toEqual([
      'channel-section-system',
      'channel-section-user',
      'channel-section-dm',
    ]);
  });

  it('routes system_* kinds into the system section', async () => {
    stubBridge({
      channelsForProject: [...SYSTEM_CHANNELS, ...USER_CHANNELS],
      dms: [],
    });
    renderWithTheme('warm', <ChannelRail projectId={PROJECT_ID} />);

    await waitFor(() =>
      expect(screen.queryAllByTestId('channel-row').length).toBeGreaterThan(0),
    );
    const systemSection = screen.getByTestId('channel-section-system');
    const systemRows = systemSection.querySelectorAll('[data-testid="channel-row"]');
    expect(systemRows).toHaveLength(3);
    const kinds = Array.from(systemRows).map((el) =>
      el.getAttribute('data-channel-kind'),
    );
    expect(kinds).toEqual([
      'system_general',
      'system_approval',
      'system_minutes',
    ]);

    const userSection = screen.getByTestId('channel-section-user');
    expect(userSection.querySelectorAll('[data-testid="channel-row"]')).toHaveLength(2);
  });

  it('renders DM empty hint when there are no DMs', async () => {
    stubBridge({ channelsForProject: USER_CHANNELS, dms: [] });
    renderWithTheme('warm', <ChannelRail projectId={PROJECT_ID} />);

    await waitFor(() => expect(screen.getByTestId('channel-rail-dm-empty')).toBeTruthy());
  });
});

describe('ChannelRail — themeKey 3-way section titles (D4)', () => {
  const cases: Array<{
    themeKey: ThemeKey;
    channels: string;
    dm: string;
  }> = [
    { themeKey: 'warm', channels: '채널', dm: 'DM' },
    { themeKey: 'tactical', channels: '채널', dm: 'DM' },
    { themeKey: 'retro', channels: '$ 채널', dm: '$ DM' },
  ];

  it.each(cases)(
    'themeKey=$themeKey: channels="$channels", dm="$dm"',
    async ({ themeKey, channels, dm }) => {
      stubBridge({ channelsForProject: USER_CHANNELS, dms: DMS });
      renderWithTheme(themeKey, <ChannelRail projectId={PROJECT_ID} />);

      await waitFor(() =>
        expect(screen.getByTestId('channel-section-title-user').textContent)
          .toBeTruthy(),
      );
      expect(screen.getByTestId('channel-section-title-user').textContent).toBe(
        channels,
      );
      expect(screen.getByTestId('channel-section-title-dm').textContent).toBe(dm);
      expect(screen.getByTestId('channel-rail').getAttribute('data-theme-variant'))
        .toBe(themeKey);
    },
  );
});

describe('ChannelRail — active click wiring', () => {
  it('clicking a row writes channelId into the active-channel store', async () => {
    stubBridge({
      channelsForProject: [...SYSTEM_CHANNELS, ...USER_CHANNELS],
      dms: DMS,
    });
    renderWithTheme('warm', <ChannelRail projectId={PROJECT_ID} />);

    await waitFor(() =>
      expect(screen.queryAllByTestId('channel-row')).toHaveLength(6),
    );

    const planRow = screen
      .queryAllByTestId('channel-row')
      .find((el) => el.getAttribute('data-channel-id') === 'c-plan');
    expect(planRow).toBeTruthy();

    act(() => {
      fireEvent.click(planRow!);
    });

    await waitFor(() => {
      expect(
        useActiveChannelStore.getState().channelIdByProject[PROJECT_ID],
      ).toBe('c-plan');
    });
    expect(planRow!.getAttribute('data-active')).toBe('true');
  });

  it('pre-set active channel renders with aria-current / data-active', async () => {
    useActiveChannelStore.setState({
      channelIdByProject: { [PROJECT_ID]: 'c-refactor' },
    });
    stubBridge({
      channelsForProject: [...SYSTEM_CHANNELS, ...USER_CHANNELS],
      dms: [],
    });
    renderWithTheme('tactical', <ChannelRail projectId={PROJECT_ID} />);

    await waitFor(() =>
      expect(screen.queryAllByTestId('channel-row').length).toBeGreaterThan(0),
    );
    const active = screen
      .queryAllByTestId('channel-row')
      .find((el) => el.getAttribute('data-channel-id') === 'c-refactor');
    expect(active?.getAttribute('data-active')).toBe('true');
    expect(active?.getAttribute('aria-current')).toBe('true');
  });
});

describe('ChannelRail — create-channel button', () => {
  it('invokes onCreateChannel when the + button is clicked', async () => {
    stubBridge({ channelsForProject: USER_CHANNELS, dms: [] });
    const onCreate = vi.fn();
    renderWithTheme(
      'warm',
      <ChannelRail projectId={PROJECT_ID} onCreateChannel={onCreate} />,
    );

    await waitFor(() =>
      expect(screen.getByTestId('channel-rail-create')).toBeTruthy(),
    );
    fireEvent.click(screen.getByTestId('channel-rail-create'));
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it('disables the + button when no handler is supplied', async () => {
    stubBridge({ channelsForProject: USER_CHANNELS, dms: [] });
    renderWithTheme('warm', <ChannelRail projectId={PROJECT_ID} />);
    await waitFor(() =>
      expect(screen.getByTestId('channel-rail-create')).toBeTruthy(),
    );
    expect(
      (screen.getByTestId('channel-rail-create') as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

describe('ChannelRail — error + loading surfaces', () => {
  it('renders loading slot then replaces with content', async () => {
    stubBridge({ channelsForProject: USER_CHANNELS, dms: DMS });
    renderWithTheme('warm', <ChannelRail projectId={PROJECT_ID} />);

    expect(screen.queryByTestId('channel-rail-loading')).toBeTruthy();
    await waitFor(() =>
      expect(screen.queryByTestId('channel-rail-loading')).toBeNull(),
    );
  });

  it('shows error banner when channel:list rejects', async () => {
    const invoke = vi.fn(async () => {
      throw new Error('db offline');
    });
    vi.stubGlobal('arena', { platform: 'linux', invoke });

    renderWithTheme('warm', <ChannelRail projectId={PROJECT_ID} />);

    await waitFor(() => expect(screen.getByTestId('channel-rail-error')).toBeTruthy());
  });
});

describe('ChannelRail — source-level hex color literal guard', () => {
  it('ChannelRail.tsx contains zero hex color literals', () => {
    const source = readFileSync(resolve(__dirname, '..', 'ChannelRail.tsx'), 'utf-8');
    expect(source.match(/#[0-9a-fA-F]{3,6}\b/g)).toBeNull();
  });
});
