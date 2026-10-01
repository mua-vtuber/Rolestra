// @vitest-environment jsdom

/**
 * API key replacement and AI delete inside the edit dialog (spec
 * 2026-10-01-messenger-redesign.md R5-5/R5-6). Only the key's ref crosses
 * IPC; a failed switch deletes exactly the secret this attempt stored.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import '../../../i18n';
import { i18next } from '../../../i18n';
import * as errorBoundary from '../../../components/ErrorBoundary';
import * as invalidationBus from '../../../hooks/channel-invalidation-bus';
import { ProviderAccountSection } from '../ProviderAccountSection';
import type { ApiProviderConfig, ProviderConfig, ProviderInfo } from '../../../../shared/provider-types';

type Routes = Record<string, (data: unknown) => unknown>;

function provider(id: string, config: ProviderConfig): ProviderInfo {
  return {
    id, type: config.type, displayName: id, model: config.model, capabilities: [],
    status: 'ready', config, roles: [], skill_overrides: null, isDepartmentHead: {},
  };
}

const API: ApiProviderConfig = {
  type: 'api', endpoint: 'https://api.anthropic.com/v1', apiKeyRef: 'provider-old', model: 'claude-x',
};
const LOCAL: ProviderConfig = { type: 'local', baseUrl: 'http://localhost:11434', model: 'm' };

function setupArena(overrides: Routes = {}): ReturnType<typeof vi.fn> {
  const routes: Routes = {
    'provider:list': () => ({ providers: [provider('api-1', API), provider('local-1', LOCAL)] }),
    'config:set-secret': () => ({ success: true }),
    'config:delete-secret': () => ({ success: true }),
    'provider:replace-api-key': (data) => ({
      provider: provider('api-1', { ...API, apiKeyRef: (data as { apiKeyRef: string }).apiKeyRef }),
      previousKeyCleanup: { status: 'deleted' },
    }),
    'provider:remove': () => ({ success: true, apiKeyCleanup: { status: 'deleted' } }),
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

function callsOf(invoke: ReturnType<typeof vi.fn>, channel: string): unknown[] {
  return invoke.mock.calls.filter(([c]) => c === channel).map(([, data]) => data);
}

async function typeKeyAndReplace(value: string): Promise<void> {
  const user = userEvent.setup();
  await user.type(await screen.findByTestId('profile-editor-api-key-input'), value);
  await user.click(screen.getByTestId('profile-editor-api-key-replace'));
}

beforeEach(() => {
  void i18next.changeLanguage('ko');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ProviderAccountSection — API key replacement', () => {
  it('stores the new key under a fresh ref and passes only that ref to main', async () => {
    const invoke = setupArena();
    render(<ProviderAccountSection providerId="api-1" displayName="Ai Api" onDeleted={() => undefined} />);

    await typeKeyAndReplace('sk-new-secret');

    expect(await screen.findByTestId('profile-editor-api-key-replaced')).toBeTruthy();
    const [stored] = callsOf(invoke, 'config:set-secret') as Array<{ key: string; value: string }>;
    expect(stored.key).toMatch(/^provider-[0-9a-f-]+$/);
    expect(stored.value).toBe('sk-new-secret');
    expect(callsOf(invoke, 'provider:replace-api-key')).toEqual([{ id: 'api-1', apiKeyRef: stored.key }]);
    expect(JSON.stringify(callsOf(invoke, 'provider:replace-api-key'))).not.toContain('sk-new-secret');
    expect(callsOf(invoke, 'config:delete-secret')).toEqual([]);
    expect((screen.getByTestId('profile-editor-api-key-input') as HTMLInputElement).value).toBe('');
  });

  // QA Minor 4: once main switched the AI to the new key, a failed screen
  // refresh must never delete that key — it is reported instead.
  it('keeps the new key when only the screen refresh fails after the switch', async () => {
    const notify = vi.spyOn(errorBoundary, 'notifyError').mockImplementation(() => 'toast');
    vi.spyOn(invalidationBus, 'notifyChannelsChanged').mockRejectedValue(new Error('refresh failed'));
    const invoke = setupArena();
    render(<ProviderAccountSection providerId="api-1" displayName="Ai Api" onDeleted={() => undefined} />);

    await typeKeyAndReplace('sk-new');

    expect(await screen.findByTestId('profile-editor-api-key-replaced')).toBeTruthy();
    await waitFor(() => expect(notify).toHaveBeenCalledOnce());
    expect(String(notify.mock.calls[0]?.[0])).toContain('refresh failed');
    expect(callsOf(invoke, 'config:delete-secret')).toEqual([]);
  });

  it('deletes only this attempt\'s new secret when the switch fails, and says the old key is unchanged', async () => {
    const invoke = setupArena({ 'provider:replace-api-key': () => { throw new Error('SQLITE_BUSY'); } });
    render(<ProviderAccountSection providerId="api-1" displayName="Ai Api" onDeleted={() => undefined} />);

    await typeKeyAndReplace('sk-new');

    expect((await screen.findByTestId('profile-editor-api-key-error')).textContent).toContain('SQLITE_BUSY');
    const [stored] = callsOf(invoke, 'config:set-secret') as Array<{ key: string }>;
    expect(callsOf(invoke, 'config:delete-secret')).toEqual([{ key: stored.key }]);
    expect(callsOf(invoke, 'config:delete-secret')).not.toContainEqual({ key: 'provider-old' });
  });

  it('never calls the switch when storing the key failed', async () => {
    const invoke = setupArena({ 'config:set-secret': () => { throw new Error('safeStorage unavailable'); } });
    render(<ProviderAccountSection providerId="api-1" displayName="Ai Api" onDeleted={() => undefined} />);

    await typeKeyAndReplace('sk-new');

    expect((await screen.findByTestId('profile-editor-api-key-error')).textContent).toContain('safeStorage unavailable');
    expect(callsOf(invoke, 'provider:replace-api-key')).toEqual([]);
  });

  it('warns when main could not delete the old key', async () => {
    setupArena({
      'provider:replace-api-key': (data) => ({
        provider: provider('api-1', { ...API, apiKeyRef: (data as { apiKeyRef: string }).apiKeyRef }),
        previousKeyCleanup: { status: 'failed', message: 'EACCES' },
      }),
    });
    render(<ProviderAccountSection providerId="api-1" displayName="Ai Api" onDeleted={() => undefined} />);

    await typeKeyAndReplace('sk-new');

    expect((await screen.findByTestId('profile-editor-api-key-cleanup-failed')).textContent).toContain('EACCES');
  });

  it('offers no key field for a local or CLI AI', async () => {
    setupArena();
    render(<ProviderAccountSection providerId="local-1" displayName="Ai Local" onDeleted={() => undefined} />);

    expect(await screen.findByTestId('profile-editor-delete')).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId('profile-editor-api-key-input')).toBeNull());
  });
});

describe('ProviderAccountSection — delete', () => {
  it('asks once, deletes the AI and closes', async () => {
    const invoke = setupArena();
    const onDeleted = vi.fn();
    const user = userEvent.setup();
    render(<ProviderAccountSection providerId="api-1" displayName="Ai Api" onDeleted={onDeleted} />);

    await user.click(screen.getByTestId('profile-editor-delete'));
    expect(callsOf(invoke, 'provider:remove')).toEqual([]);
    await user.click(screen.getByTestId('profile-editor-delete-confirm'));

    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
    expect(callsOf(invoke, 'provider:remove')).toEqual([{ id: 'api-1' }]);
  });

  it('reports a key that could not be deleted through the error toast', async () => {
    setupArena({ 'provider:remove': () => ({ success: true, apiKeyCleanup: { status: 'failed', message: 'EACCES' } }) });
    const notify = vi.spyOn(errorBoundary, 'notifyError');
    const user = userEvent.setup();
    render(<ProviderAccountSection providerId="api-1" displayName="Ai Api" onDeleted={() => undefined} />);

    await user.click(screen.getByTestId('profile-editor-delete'));
    await user.click(screen.getByTestId('profile-editor-delete-confirm'));

    await waitFor(() => expect(notify).toHaveBeenCalledTimes(1));
    expect(notify.mock.calls[0]?.[0]).toContain('EACCES');
  });

  it('keeps the dialog open with the reason when the delete fails', async () => {
    setupArena({ 'provider:remove': () => { throw new Error('Provider not found: api-1'); } });
    const onDeleted = vi.fn();
    const user = userEvent.setup();
    render(<ProviderAccountSection providerId="api-1" displayName="Ai Api" onDeleted={onDeleted} />);

    await user.click(screen.getByTestId('profile-editor-delete'));
    await user.click(screen.getByTestId('profile-editor-delete-confirm'));

    expect((await screen.findByTestId('profile-editor-delete-error')).textContent).toContain('Provider not found');
    expect(onDeleted).not.toHaveBeenCalled();
  });
});
