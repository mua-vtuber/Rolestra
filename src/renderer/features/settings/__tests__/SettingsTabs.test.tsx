// @vitest-environment jsdom

import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import '../../../i18n';
import { i18next } from '../../../i18n';
import {
  SETTINGS_TAB_KEYS,
  SettingsTabs,
} from '../SettingsTabs';

function makeRouter(
  routes: Record<string, (data: unknown) => unknown>,
): ReturnType<typeof vi.fn> {
  return vi.fn((channel: string, data: unknown) => {
    const handler = routes[channel];
    if (!handler) {
      return Promise.reject(new Error(`no mock for channel ${channel}`));
    }
    try {
      return Promise.resolve(handler(data));
    } catch (reason) {
      return Promise.reject(reason);
    }
  });
}

function setupArena(invoke: ReturnType<typeof vi.fn>): void {
  vi.stubGlobal('arena', {
    platform: 'linux',
    invoke,
    onStream: () => () => undefined,
  });
}

function defaultRoutes(): Record<string, (data: unknown) => unknown> {
  return {
    'notification:get-prefs': () => ({
      prefs: {
        new_message: { enabled: true, soundEnabled: true },
        approval_pending: { enabled: true, soundEnabled: true },
        work_done: { enabled: true, soundEnabled: true },
        error: { enabled: true, soundEnabled: true },
        queue_progress: { enabled: true, soundEnabled: true },
        meeting_state: { enabled: true, soundEnabled: true },
      },
    }),
    'member:list': () => ({ members: [] }),
    'config:get-settings': () => ({
      settings: {
        version: 1,
        uiTheme: 'dark',
        language: 'ko',
        defaultRounds: 3,
        softTokenLimit: 3000,
        hardTokenLimit: 4000,
        maxRetries: 3,
        phaseTimeoutMs: 60_000,
        aggregatorStrategy: 'strongest',
        designatedAggregatorId: '',
        arenaGitManagementEnabled: false,
        memorySettings: {
          enabled: true,
          embeddingProviderId: null,
          reflectionProviderId: null,
          vectorSearchEnabled: false,
          graphEnabled: false,
          contextBudget: 4096,
          retrievalLimit: 10,
          reflectionThreshold: 10,
          embeddingModel: 'text-embedding-3-small',
        },
        conversationTask: {
          deepDebateTurnBudget: 30,
          aiDecisionParseRetryLimit: 2,
          twoParticipantUnanimousRequired: true,
          majorityAllowedFromParticipants: 3,
          hardBlockReasonTypes: ['security', 'data_loss'],
          softBlockReasonTypes: ['spec_conflict', 'unknown'],
          failureResolutionOptions: ['retry', 'stop', 'reassign'],
        },
        consensusFolderPath: '',
        arenaRoot: '',
      },
    }),
    'config:list-secret-keys': () => ({ keys: [] }),
    'config:update-settings': (data: unknown) => {
      const patch =
        (data as { patch?: Record<string, unknown> }).patch ?? {};
      return {
        settings: {
          version: 1,
          uiTheme: 'dark',
          language: 'ko',
          defaultRounds: 3,
          softTokenLimit: 3000,
          hardTokenLimit: 4000,
          maxRetries: 3,
          phaseTimeoutMs: 60_000,
          aggregatorStrategy: 'strongest',
          designatedAggregatorId: '',
          arenaGitManagementEnabled: false,
          memorySettings: {
            enabled: true,
            embeddingProviderId: null,
            reflectionProviderId: null,
            vectorSearchEnabled: false,
            graphEnabled: false,
            contextBudget: 4096,
            retrievalLimit: 10,
            reflectionThreshold: 10,
            embeddingModel: 'text-embedding-3-small',
          },
          conversationTask: {
            deepDebateTurnBudget: 30,
            aiDecisionParseRetryLimit: 2,
            twoParticipantUnanimousRequired: true,
            majorityAllowedFromParticipants: 3,
            hardBlockReasonTypes: ['security', 'data_loss'],
            softBlockReasonTypes: ['spec_conflict', 'unknown'],
            failureResolutionOptions: ['retry', 'stop', 'reassign'],
          },
          consensusFolderPath: '',
          arenaRoot: '',
          ...patch,
        },
      };
    },
    'arena-root:get': () => ({ path: '/home/test/arena' }),
    'provider:list': () => ({ providers: [] }),
    'permission:dry-run-flags': () => ({
      flags: ['--mode', 'hybrid'],
      rationale: ['permission.flag.reason.hybrid'],
      blocked: false,
      blockedReason: null,
    }),
  };
}

beforeEach(() => {
  vi.unstubAllGlobals();
  if (typeof window !== 'undefined') {
    window.history.replaceState(null, '', '/');
  }
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  void i18next.changeLanguage('ko');
});

describe('SettingsTabs', () => {
  it('renders one trigger per tab key (10 total)', () => {
    setupArena(makeRouter(defaultRoutes()));

    render(<SettingsTabs />);

    const triggers = screen.getAllByTestId('settings-tabs-trigger');
    expect(triggers).toHaveLength(SETTINGS_TAB_KEYS.length);
    const tabs = triggers.map((t) => t.getAttribute('data-tab'));
    expect(tabs).toEqual(Array.from(SETTINGS_TAB_KEYS));
  });

  it('defaults to the notifications tab when no hash is set', async () => {
    setupArena(makeRouter(defaultRoutes()));

    render(<SettingsTabs />);

    await waitFor(() =>
      expect(screen.getByTestId('settings-tab-notifications')).toBeTruthy(),
    );

    const notifTrigger = screen
      .getAllByTestId('settings-tabs-trigger')
      .find((t) => t.getAttribute('data-tab') === 'notifications')!;
    expect(notifTrigger.getAttribute('data-state')).toBe('active');
  });

  it('honours the initial hash deep-link (#settings/security)', async () => {
    window.history.replaceState(null, '', '#settings/security');
    setupArena(makeRouter(defaultRoutes()));

    render(<SettingsTabs />);

    await waitFor(() =>
      expect(screen.getByTestId('settings-tab-security')).toBeTruthy(),
    );

    const securityTrigger = screen
      .getAllByTestId('settings-tabs-trigger')
      .find((t) => t.getAttribute('data-tab') === 'security')!;
    expect(securityTrigger.getAttribute('data-state')).toBe('active');
  });

  it('writes the hash when the user clicks a different trigger', async () => {
    setupArena(makeRouter(defaultRoutes()));
    const user = userEvent.setup();

    render(<SettingsTabs />);

    const themeTrigger = screen
      .getAllByTestId('settings-tabs-trigger')
      .find((t) => t.getAttribute('data-tab') === 'theme')!;

    await user.click(themeTrigger);

    await waitFor(() =>
      expect(window.location.hash).toBe('#settings/theme'),
    );
    expect(themeTrigger.getAttribute('data-state')).toBe('active');
  });

  it('reacts to external hashchange events', async () => {
    setupArena(makeRouter(defaultRoutes()));

    render(<SettingsTabs />);

    await act(async () => {
      window.history.replaceState(null, '', '#settings/about');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });

    await waitFor(() => {
      const aboutTrigger = screen
        .getAllByTestId('settings-tabs-trigger')
        .find((t) => t.getAttribute('data-tab') === 'about')!;
      expect(aboutTrigger.getAttribute('data-state')).toBe('active');
    });
  });

  it('falls back to default when hash points to an unknown tab', () => {
    window.history.replaceState(null, '', '#settings/bogus');
    setupArena(makeRouter(defaultRoutes()));

    render(<SettingsTabs />);

    const notifTrigger = screen
      .getAllByTestId('settings-tabs-trigger')
      .find((t) => t.getAttribute('data-tab') === 'notifications')!;
    expect(notifTrigger.getAttribute('data-state')).toBe('active');
  });

  it('respects the initialTab prop over the hash', async () => {
    window.history.replaceState(null, '', '#settings/about');
    setupArena(makeRouter(defaultRoutes()));

    render(<SettingsTabs initialTab="theme" />);

    await waitFor(() =>
      expect(screen.getByTestId('settings-tab-theme')).toBeTruthy(),
    );
    const themeTrigger = screen
      .getAllByTestId('settings-tabs-trigger')
      .find((t) => t.getAttribute('data-tab') === 'theme')!;
    expect(themeTrigger.getAttribute('data-state')).toBe('active');
  });
});
