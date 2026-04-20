/**
 * SettingsView component tests.
 *
 * Tests tab switching, general settings form, secrets management,
 * and AI management tab rendering.
 */

// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { installArenaMock, makeProviderInfo, type InvokeMock } from './setup';
import { useAppStore } from '../../stores/app-store';
import { useProviderStore } from '../../stores/provider-store';

import { SettingsView } from '../SettingsView';

// ── Helpers ────────────────────────────────────────────────────────────

function resetStores(): void {
  useAppStore.setState({
    currentView: 'settings',
    appInfo: { name: 'AI Chat Arena', version: '0.1.0' },
    connected: true,
  });
  useProviderStore.setState({
    providers: [],
    loading: false,
    error: null,
  });
}

const mockSettings = {
  version: 1,
  uiTheme: 'dark' as const,
  language: 'ko',
  defaultRounds: 3,
  softTokenLimit: 3000,
  hardTokenLimit: 4000,
  maxRetries: 3,
  phaseTimeoutMs: 60000,
  designatedAggregatorId: '',
  arenaGitManagementEnabled: false,
};

// ── Tests ──────────────────────────────────────────────────────────────

describe('SettingsView', () => {
  let invoke: InvokeMock;

  beforeEach(() => {
    ({ invoke } = installArenaMock());
    resetStores();
    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'config:get-settings') return { settings: mockSettings };
      if (channel === 'config:update-settings') return { settings: mockSettings };
      if (channel === 'config:list-secret-keys') return { keys: [] };
      if (channel === 'provider:list') return { providers: [] };
      if (channel === 'provider:detect-cli') return { detected: [] };
      if (channel === 'workspace:status') return { workspace: null };
      if (channel === 'remote:get-policy') {
        return {
          policy: {
            enabled: false,
            mode: 'tailscale',
            directAccessPort: 8080,
            directAccessReadOnly: true,
            directAccessSessionTimeoutMin: 30,
            directAccessAllowedIPs: [],
            allowFileModification: false,
            allowCommandExecution: false,
          },
        };
      }
      if (channel === 'remote:get-sessions') return { sessions: [] };
      return undefined;
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  // ── Tab rendering ─────────────────────────────────────────────────

  it('renders settings tabs', async () => {
    await act(async () => {
      render(<SettingsView />);
    });

    expect(screen.getByText('settings.general')).toBeInTheDocument();
    expect(screen.getByText('settings.aiManagement')).toBeInTheDocument();
    expect(screen.getByText('settings.secrets')).toBeInTheDocument();
    expect(screen.getByText('settings.remoteAccess')).toBeInTheDocument();
    expect(screen.queryByText('settings.filePermissions')).not.toBeInTheDocument();
  });

  it('shows general tab by default', async () => {
    await act(async () => {
      render(<SettingsView />);
    });

    // General tab content: app info
    expect(screen.getByText('settings.appName')).toBeInTheDocument();
    expect(screen.getByText('settings.version')).toBeInTheDocument();
    expect(screen.getByText('settings.connection')).toBeInTheDocument();
  });

  // ── Tab switching ─────────────────────────────────────────────────

  it('switches to AI Management tab', async () => {
    await act(async () => {
      render(<SettingsView />);
    });

    await act(async () => {
      fireEvent.click(screen.getByText('settings.aiManagement'));
    });

    expect(screen.getByText('provider.type.api')).toBeInTheDocument();
    expect(screen.getByText('provider.type.cli')).toBeInTheDocument();
    expect(screen.getByText('provider.type.local')).toBeInTheDocument();
  });

  it('switches to Secrets tab', async () => {
    await act(async () => {
      render(<SettingsView />);
    });

    await act(async () => {
      fireEvent.click(screen.getByText('settings.secrets'));
    });

    expect(screen.getByText('settings.secretDescription')).toBeInTheDocument();
  });

  it('switches to Remote Access tab', async () => {
    await act(async () => {
      render(<SettingsView />);
    });

    await act(async () => {
      fireEvent.click(screen.getByText('settings.remoteAccess'));
    });

    expect(screen.getByText('remote.enable')).toBeInTheDocument();
  });

  // ── General tab: settings form ────────────────────────────────────

  it('renders settings form with loaded values', async () => {
    await act(async () => {
      render(<SettingsView />);
    });

    // Wait for settings to load
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    expect(screen.getByText('settings.theme')).toBeInTheDocument();
    expect(screen.getByText('settings.language')).toBeInTheDocument();
    expect(screen.getByText('settings.maxRetries')).toBeInTheDocument();
    expect(screen.getByText('settings.phaseTimeout')).toBeInTheDocument();
    expect(screen.getByText('settings.designatedAggregator')).toBeInTheDocument();
  });

  it('shows app info from store', async () => {
    await act(async () => {
      render(<SettingsView />);
    });

    expect(screen.getByText('AI Chat Arena')).toBeInTheDocument();
    expect(screen.getByText('0.1.0')).toBeInTheDocument();
    expect(screen.getByText('settings.connected')).toBeInTheDocument();
  });

  it('shows disconnected status', async () => {
    useAppStore.setState({ connected: false });

    await act(async () => {
      render(<SettingsView />);
    });

    expect(screen.getByText('settings.disconnected')).toBeInTheDocument();
  });

  it('calls config:update-settings on save', async () => {
    await act(async () => {
      render(<SettingsView />);
    });

    // Wait for settings to load
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    const saveBtn = screen.getByText('app.save');
    await act(async () => {
      fireEvent.click(saveBtn);
    });

    const updateCalls = invoke.mock.calls.filter(
      (c: unknown[]) => c[0] === 'config:update-settings',
    );
    expect(updateCalls.length).toBe(1);
  });

  // ── Secrets tab ───────────────────────────────────────────────────

  it('shows empty secrets state', async () => {
    await act(async () => {
      render(<SettingsView />);
    });

    await act(async () => {
      fireEvent.click(screen.getByText('settings.secrets'));
    });

    // Wait for secrets to load
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    expect(screen.getByText('settings.secretEmpty')).toBeInTheDocument();
  });

  it('renders existing secret keys', async () => {
    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'config:list-secret-keys') return { keys: ['openai-key', 'anthropic-key'] };
      if (channel === 'config:get-settings') return { settings: mockSettings };
      return undefined;
    });

    await act(async () => {
      render(<SettingsView />);
    });

    await act(async () => {
      fireEvent.click(screen.getByText('settings.secrets'));
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    expect(screen.getByText('openai-key')).toBeInTheDocument();
    expect(screen.getByText('anthropic-key')).toBeInTheDocument();
  });

  it('adds a new secret key', async () => {
    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'config:list-secret-keys') return { keys: [] };
      if (channel === 'config:set-secret') return { success: true };
      if (channel === 'config:get-settings') return { settings: mockSettings };
      return undefined;
    });

    await act(async () => {
      render(<SettingsView />);
    });

    await act(async () => {
      fireEvent.click(screen.getByText('settings.secrets'));
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    const keyInput = screen.getByPlaceholderText('settings.secretKey');
    const valueInput = screen.getByPlaceholderText('settings.secretValue');

    await act(async () => {
      await userEvent.type(keyInput, 'my-api-key');
      await userEvent.type(valueInput, 'sk-12345');
    });

    const addBtn = screen.getByText('settings.secretAdd');
    expect(addBtn).not.toBeDisabled();

    await act(async () => {
      fireEvent.click(addBtn);
    });

    const setCalls = invoke.mock.calls.filter((c: unknown[]) => c[0] === 'config:set-secret');
    expect(setCalls.length).toBe(1);
  });

  // ── AI Management tab ─────────────────────────────────────────────

  it('renders AI management with API provider dropdown', async () => {
    await act(async () => {
      render(<SettingsView />);
    });

    await act(async () => {
      fireEvent.click(screen.getByText('settings.aiManagement'));
    });

    expect(screen.getByText('provider.selectApi')).toBeInTheDocument();
    expect(screen.getByText('provider.registered')).toBeInTheDocument();
  });

  it('shows registered providers in AI management tab', async () => {
    const providers = [
      makeProviderInfo({ id: 'p1', displayName: 'My Claude' }),
    ];
    // Override invoke to return providers from provider:list
    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'provider:list') return { providers };
      if (channel === 'provider:detect-cli') return { detected: [] };
      if (channel === 'config:get-settings') return { settings: mockSettings };
      if (channel === 'config:list-secret-keys') return { keys: [] };
      if (channel === 'workspace:status') return { workspace: null };
      if (channel === 'remote:get-policy') {
        return {
          policy: {
            enabled: false, mode: 'tailscale', directAccessPort: 8080,
            directAccessReadOnly: true, directAccessSessionTimeoutMin: 30,
            directAccessAllowedIPs: [], allowFileModification: false,
            allowCommandExecution: false,
          },
        };
      }
      if (channel === 'remote:get-sessions') return { sessions: [] };
      return undefined;
    });

    await act(async () => {
      render(<SettingsView />);
    });

    await act(async () => {
      fireEvent.click(screen.getByText('settings.aiManagement'));
    });

    expect(screen.getByText('My Claude')).toBeInTheDocument();
    expect(screen.getByText('provider.status.ready')).toBeInTheDocument();
  });
});
