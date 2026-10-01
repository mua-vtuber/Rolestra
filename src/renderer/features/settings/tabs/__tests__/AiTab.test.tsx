// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import '../../../../i18n';
import { i18next } from '../../../../i18n';
import { ThemeProvider } from '../../../../theme/theme-provider';
import { DEFAULT_MODE, DEFAULT_THEME, useThemeStore } from '../../../../theme/theme-store';
import { AiTab } from '../AiTab';
import type { MemberView, WorkStatus } from '../../../../../shared/member-profile-types';
import type { ProviderConfig, ProviderInfo } from '../../../../../shared/provider-types';

type Routes = Record<string, (data: unknown) => unknown>;

function member(providerId: string, displayName: string, workStatus: WorkStatus): MemberView {
  return {
    providerId, displayName, workStatus, characterSheet: '', avatarKind: 'default',
    avatarData: null, statusOverride: null, updatedAt: 1,
  };
}

function provider(id: string, config: ProviderConfig): ProviderInfo {
  return {
    id, type: config.type, displayName: id, model: config.model, capabilities: [],
    status: 'ready', config, roles: [], skill_overrides: null, isDepartmentHead: {},
  };
}

const CLAUDE: ProviderConfig = {
  type: 'cli', command: 'C:\\npm\\claude.cmd', args: [], inputFormat: 'stdin-json',
  outputFormat: 'stream-json', sessionStrategy: 'persistent',
  hangTimeout: { first: 1, subsequent: 1 }, model: 'unknown',
};
const LOCAL: ProviderConfig = { type: 'local', baseUrl: 'http://localhost:11434', model: 'gemma4:e4b' };

function setupArena(overrides: Routes = {}): ReturnType<typeof vi.fn> {
  const routes: Routes = {
    'member:list': () => ({ members: [
      member('cli-1', 'Ai Cli', 'online'),
      { ...member('local-1', 'Ai Local', 'offline-connection'), connectionFailure: { code: 'local-not-running', detail: 'ECONNREFUSED' } },
    ] }),
    'provider:list': () => ({ providers: [provider('cli-1', CLAUDE), provider('local-1', LOCAL)] }),
    'provider:list-inactive-cli': () => ({ inactive: [] }),
    'member:reconnect': () => ({ status: 'online' }),
    'member:get-profile': (data) => ({ profile: { ...member((data as { providerId: string }).providerId, 'x', 'online') } }),
    'member:list-avatars': () => ({ avatars: [] }),
    ...overrides,
  };
  const invoke = vi.fn((channel: string, data: unknown) => {
    const handler = routes[channel];
    if (!handler) return Promise.reject(new Error(`no mock for channel ${channel}`));
    try {
      return Promise.resolve(handler(data));
    } catch (reason) {
      return Promise.reject(reason);
    }
  });
  vi.stubGlobal('arena', { platform: 'linux', invoke, onStream: () => () => undefined });
  return invoke;
}

function renderTab(onAddAi: () => void = () => undefined) {
  return render(<ThemeProvider><AiTab onAddAi={onAddAi} /></ThemeProvider>);
}

function row(providerId: string): HTMLElement {
  const found = screen.getAllByTestId('settings-ai-row').find((r) => r.getAttribute('data-provider-id') === providerId);
  if (!found) throw new Error(`no row for ${providerId}`);
  return found;
}

beforeEach(() => {
  useThemeStore.setState({ themeKey: DEFAULT_THEME, mode: DEFAULT_MODE });
  void i18next.changeLanguage('ko');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  useThemeStore.setState({ themeKey: DEFAULT_THEME, mode: DEFAULT_MODE });
});

describe('AiTab — roster', () => {
  it('lists each AI with its name, connection line and status', async () => {
    setupArena();
    renderTab();

    await waitFor(() => expect(screen.getAllByTestId('settings-ai-row')).toHaveLength(2));
    const cliRow = within(row('cli-1'));
    expect(cliRow.getByTestId('settings-ai-name').textContent).toBe('Ai Cli');
    await waitFor(() => expect(cliRow.getByTestId('settings-ai-connection').textContent).toBe('Claude Code · CLI'));
    expect(cliRow.getByTestId('settings-ai-status').textContent).toBe('연결됨');
    expect(cliRow.queryByTestId('settings-ai-reconnect')).toBeNull();
    expect(within(row('local-1')).getByTestId('settings-ai-connection').textContent)
      .toBe('gemma4:e4b · 로컬 (localhost:11434)');
  });

  // QA Medium-1: the hint is the cause main's last check found.
  it('shows the cause and "다시 연결" for an unreachable AI, and re-reads the status after reconnecting', async () => {
    const invoke = setupArena();
    const user = userEvent.setup();
    renderTab();

    const localRow = await waitFor(() => row('local-1'));
    expect(within(localRow).getByTestId('settings-ai-status').textContent).toBe('연결 안 됨');
    await waitFor(() => expect(within(localRow).getByTestId('settings-ai-hint').textContent)
      .toBe('Ollama가 응답하지 않습니다. Ollama가 켜져 있는지 확인하세요. (ECONNREFUSED)'));

    const memberListCalls = invoke.mock.calls.filter(([c]) => c === 'member:list').length;
    await user.click(within(localRow).getByTestId('settings-ai-reconnect'));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('member:reconnect', { providerId: 'local-1' }));
    await waitFor(() => expect(invoke.mock.calls.filter(([c]) => c === 'member:list').length).toBeGreaterThan(memberListCalls));
  });

  it('shows a failed reconnect on the row', async () => {
    setupArena({ 'member:reconnect': () => { throw new Error('ECONNREFUSED'); } });
    const user = userEvent.setup();
    renderTab();

    await user.click(await waitFor(() => within(row('local-1')).getByTestId('settings-ai-reconnect')));

    expect((await screen.findByTestId('settings-ai-reconnect-error')).textContent).toContain('ECONNREFUSED');
  });

  it('draws avatars in the bubble theme and leaves them out in the retro log theme', async () => {
    setupArena();
    const { unmount } = renderTab();
    await waitFor(() => expect(screen.getAllByTestId('settings-ai-row')).toHaveLength(2));
    expect(within(row('cli-1')).getByTestId('avatar').getAttribute('data-shape')).toBe('hexagon');
    unmount();

    useThemeStore.setState({ themeKey: 'retro', mode: 'dark' });
    renderTab();
    await waitFor(() => expect(screen.getAllByTestId('settings-ai-row')).toHaveLength(2));
    expect(within(row('cli-1')).queryByTestId('avatar')).toBeNull();
    expect(within(row('cli-1')).getByTestId('settings-ai-name').className).toMatch(/text-name-[1-4]/);
  });

  it('"편집" opens that AI\'s edit dialog', async () => {
    setupArena();
    const user = userEvent.setup();
    renderTab();

    await user.click(await waitFor(() => within(row('cli-1')).getByTestId('settings-ai-edit')));

    expect(await screen.findByTestId('profile-editor-dialog')).toBeTruthy();
  });

  it('"AI 추가" asks the settings screen to open the add dialog', async () => {
    setupArena();
    const onAddAi = vi.fn();
    const user = userEvent.setup();
    renderTab(onAddAi);

    await user.click(screen.getByTestId('settings-ai-add'));

    expect(onAddAi).toHaveBeenCalledTimes(1);
  });
});

describe('AiTab — empty and failed rosters', () => {
  it('says so when no AI is registered', async () => {
    setupArena({ 'member:list': () => ({ members: [] }), 'provider:list': () => ({ providers: [] }) });
    renderTab();

    expect(await screen.findByTestId('settings-ai-empty')).toBeTruthy();
  });

  it('shows a failed member list as an error, never as an empty roster', async () => {
    setupArena({ 'member:list': () => { throw new Error('registry offline'); } });
    renderTab();

    expect((await screen.findByTestId('settings-ai-error')).textContent).toContain('registry offline');
    expect(screen.queryByTestId('settings-ai-empty')).toBeNull();
  });

  it('keeps showing stored CLIs the app no longer runs, with the reason', async () => {
    setupArena({
      'provider:list-inactive-cli': () => ({ inactive: [
        { id: 'old-gemini', displayName: 'Gemini CLI', command: 'gemini', reason: 'unsupported-command' },
        { id: 'broken', displayName: 'Broken', command: null, reason: 'corrupt-config' },
      ] }),
    });
    renderTab();

    const rows = await screen.findAllByTestId('settings-ai-inactive-row');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('gemini');
    expect(rows[1].textContent).not.toContain('null');
  });
});
