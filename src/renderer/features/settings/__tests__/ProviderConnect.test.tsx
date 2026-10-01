// @vitest-environment jsdom

/**
 * The AI add dialog (spec 2026-10-01-messenger-redesign.md R6, AddAI
 * mockup): "이 컴퓨터에서 찾은 AI" (CLIs + local Ollama) / "API 키로
 * 연결" / "다시 찾기", then the added step. The API flow and its secret
 * cleanup rules (F1, A1 regressions) are unchanged.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode, useState, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as errorBoundary from '../../../components/ErrorBoundary';
import { ProviderConnect } from '../ProviderConnect';
import { i18next } from '../../../i18n';
import type { LocalAiDetection } from '../../../../shared/local-ai-types';

if (typeof globalThis.ResizeObserver === 'undefined') {
  (globalThis as { ResizeObserver: unknown }).ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
}
if (typeof Element !== 'undefined') {
  const proto = Element.prototype as unknown as {
    hasPointerCapture?: (id: number) => boolean;
    releasePointerCapture?: (id: number) => void;
    setPointerCapture?: (id: number) => void;
  };
  proto.hasPointerCapture ??= () => false;
  proto.releasePointerCapture ??= () => {};
  proto.setPointerCapture ??= () => {};
}

beforeEach(() => { void i18next.changeLanguage('ko'); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const LOCAL_ADDRESS = 'http://127.0.0.1:11434';
const RUNNING: LocalAiDetection = {
  status: 'running', endpoint: LOCAL_ADDRESS, version: '0.9.0', models: ['gemma4:e4b', 'llama3:8b'],
};

interface StubOptions {
  addFails?: boolean;
  /** The error `provider:add` / `provider:add-local` reject with (as the renderer receives it). */
  addError?: Error;
  setSecretError?: Error;
  deleteSecretError?: Error;
  detected?: Array<{ command: string; displayName: string; path: string; version?: string; wslDistro?: string }>;
  providers?: unknown[];
  detection?: LocalAiDetection;
  detectLocalFails?: boolean;
  listModelsResult?: { ok: true; models: string[] } | { ok: false; reason: 'auth' | 'network' | 'parse' };
}

function stubBridge(options: StubOptions = {}) {
  const {
    addFails = false,
    addError,
    setSecretError,
    deleteSecretError,
    detected = [{ command: 'claude', displayName: 'Claude Code', path: '/usr/bin/claude' }],
    providers = [],
    detection = RUNNING,
    detectLocalFails = false,
    listModelsResult = { ok: true, models: ['model-a', 'model-b'] },
  } = options;
  const invoke = vi.fn(async (channel: string, data?: unknown) => {
    switch (channel) {
      case 'provider:list': return { providers };
      case 'provider:detect-cli': return { detected };
      case 'provider:detect-local':
        if (detectLocalFails) throw new Error('bridge down');
        return { detection };
      case 'provider:add':
      case 'provider:add-local':
        if (addError) throw addError;
        if (addFails) throw new Error('registration failed');
        return { provider: { id: 'new-provider', displayName: (data as { displayName: string }).displayName } };
      case 'provider:list-models': return listModelsResult;
      case 'config:set-secret':
        if (setSecretError) throw setSecretError;
        return { success: true };
      case 'config:delete-secret':
        if (deleteSecretError) throw deleteSecretError;
        return { success: true };
      default: throw new Error(`unexpected IPC: ${channel}`);
    }
  });
  vi.stubGlobal('arena', { platform: 'linux', invoke });
  return invoke;
}

/** A main-side failure as the renderer receives it through Electron. */
function transported(channel: string, message: string): Error {
  return new Error(`Error invoking remote method '${channel}': IpcError: ${message}`);
}

/**
 * Same as `stubBridge`, but `provider:add` does not settle until the test
 * calls `resolveAdd` / `rejectAdd` — "user closes the dialog while
 * provider:add is still in flight".
 */
function stubBridgeWithControlledAdd() {
  let settleAdd: (() => void) | null = null;
  const addPromise = new Promise<void>((resolve) => { settleAdd = resolve; });
  let addOutcome: 'pending' | 'success' | 'failure' = 'pending';
  let failureMessage = '';
  const invoke = vi.fn(async (channel: string, data?: unknown) => {
    switch (channel) {
      case 'provider:list': return { providers: [] };
      case 'provider:detect-cli': return { detected: [] };
      case 'provider:detect-local': return { detection: RUNNING };
      case 'provider:add':
        await addPromise;
        if (addOutcome === 'failure') throw new Error(failureMessage);
        return { provider: { id: 'new-provider', displayName: (data as { displayName: string }).displayName } };
      case 'provider:list-models': return { ok: true, models: ['model-a', 'model-b'] };
      case 'config:set-secret': return { success: true };
      case 'config:delete-secret': return { success: true };
      default: throw new Error(`unexpected IPC: ${channel}`);
    }
  });
  vi.stubGlobal('arena', { platform: 'linux', invoke });
  return {
    invoke,
    resolveAdd: () => { addOutcome = 'success'; settleAdd?.(); },
    rejectAdd: (message: string) => { addOutcome = 'failure'; failureMessage = message; settleAdd?.(); },
  };
}

/**
 * Mirrors SettingsTabs' `{connectOpen ? <ProviderConnect .../> : null}` —
 * the dialog is UNMOUNTED the moment `onOpenChange(false)` fires.
 */
function ConditionalProviderConnect({ onConnected }: { onConnected: () => void }): ReactElement {
  const [open, setOpen] = useState(true);
  return open ? <ProviderConnect open onOpenChange={setOpen} onConnected={onConnected} /> : <></>;
}

function renderDialog(props: Partial<Parameters<typeof ProviderConnect>[0]> = {}) {
  return render(<ProviderConnect open onOpenChange={() => {}} onConnected={() => {}} {...props} />);
}

/** Waits until the button is drawn and enabled (the AI list has loaded). */
async function enabled(testId: string): Promise<HTMLButtonElement> {
  return waitFor(() => {
    const button = screen.getByTestId(testId) as HTMLButtonElement;
    if (button.disabled) throw new Error(`${testId} is disabled`);
    return button;
  });
}

/** API section: pick a service, enter a key and load its models. */
async function loadModelsForOfficialService(invoke: ReturnType<typeof stubBridge>, secretValue = 'private-token'): Promise<void> {
  fireEvent.click(await enabled('provider-connect-service-anthropic'));
  fireEvent.change(screen.getByTestId('provider-connect-secret'), { target: { value: secretValue } });
  fireEvent.click(screen.getByTestId('provider-connect-load-models'));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('provider:list-models', expect.any(Object)));
}

describe('found on this computer — CLIs', () => {
  it('does not offer a detected Gemini CLI', async () => {
    stubBridge({ detected: [
      { command: 'claude', displayName: 'Claude Code', path: '/usr/bin/claude' },
      { command: 'gemini', displayName: 'Gemini CLI', path: '/usr/bin/gemini' },
    ] });
    renderDialog();
    expect(await screen.findByTestId('provider-connect-cli-claude')).toBeTruthy();
    expect(screen.queryByTestId('provider-connect-cli-gemini')).toBeNull();
  });

  it('finishes CLI detection under React StrictMode', async () => {
    stubBridge();
    render(<StrictMode><ProviderConnect open onOpenChange={() => {}} onConnected={() => {}} /></StrictMode>);
    expect(await screen.findByTestId('provider-connect-cli-claude')).toBeTruthy();
  });

  it('adds a detected CLI under its product name, without project or onboarding IPC', async () => {
    const invoke = stubBridge({ detected: [{ command: 'codex', displayName: 'Codex CLI', path: '/usr/bin/codex', version: '0.42.0' }] });
    const onConnected = vi.fn();
    renderDialog({ onConnected });
    expect((await screen.findByTestId('provider-connect-found-cli')).textContent).toContain('0.42.0');
    fireEvent.click(await enabled('provider-connect-cli-codex'));
    await waitFor(() => expect(onConnected).toHaveBeenCalledOnce());
    expect(invoke).toHaveBeenCalledWith('provider:add', expect.objectContaining({
      displayName: 'Codex',
      config: expect.objectContaining({ type: 'cli', command: '/usr/bin/codex' }),
    }));
    expect(invoke.mock.calls.some(([channel]) => channel.startsWith('project:') || channel.startsWith('onboarding:'))).toBe(false);
  });

  it('shows "추가됨" for a CLI already registered at the same command path', async () => {
    const invoke = stubBridge({
      detected: [
        { command: 'claude', displayName: 'Claude Code', path: 'C:\\Tools\\Claude.CMD' },
        { command: 'codex', displayName: 'Codex CLI', path: '/usr/bin/codex' },
      ],
      providers: [{ id: 'old', type: 'cli', displayName: 'Claude Code', config: {
        type: 'cli', command: 'c:/tools/claude.cmd', args: [], inputFormat: 'stdin-json', outputFormat: 'stream-json',
        sessionStrategy: 'persistent', hangTimeout: { first: 1, subsequent: 1 }, model: 'unknown',
      } }],
    });
    renderDialog();
    const added = await screen.findByTestId('provider-connect-cli-added-claude');
    expect(added.textContent).toBe('추가됨');
    expect(screen.queryByTestId('provider-connect-cli-claude')).toBeNull();
    expect(await enabled('provider-connect-cli-codex')).toBeTruthy();
    expect(invoke.mock.calls.some(([channel]) => channel === 'provider:add')).toBe(false);
  });

  it('treats the same path inside a WSL distro as a different CLI', async () => {
    stubBridge({
      detected: [{ command: 'claude', displayName: 'Claude Code (WSL: Ubuntu)', path: '/usr/bin/claude', wslDistro: 'Ubuntu' }],
      providers: [{ id: 'old', type: 'cli', displayName: 'Claude Code', config: {
        type: 'cli', command: '/usr/bin/claude', args: [], inputFormat: 'stdin-json', outputFormat: 'stream-json',
        sessionStrategy: 'persistent', hangTimeout: { first: 1, subsequent: 1 }, model: 'unknown',
      } }],
    });
    renderDialog();
    expect(await enabled('provider-connect-cli-claude')).toBeTruthy();
    expect(screen.queryByTestId('provider-connect-cli-added-claude')).toBeNull();
  });

  it('picks a default name that no registered AI uses (case-insensitive)', async () => {
    const invoke = stubBridge({ providers: [
      { id: 'a', type: 'api', displayName: 'claude code', config: { type: 'api', endpoint: 'https://x/v1', apiKeyRef: 'provider-x', model: 'm' } },
      { id: 'b', type: 'api', displayName: 'Claude Code 2', config: { type: 'api', endpoint: 'https://x/v1', apiKeyRef: 'provider-y', model: 'm' } },
    ] });
    renderDialog();
    fireEvent.click(await enabled('provider-connect-cli-claude'));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('provider:add', expect.objectContaining({
      displayName: 'Claude Code 3',
    })));
  });

  it('says so when no supported CLI was found, and when detection failed', async () => {
    stubBridge({ detected: [] });
    const view = renderDialog();
    expect(await screen.findByTestId('provider-connect-no-cli')).toBeTruthy();
    view.unmount();
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'provider:detect-cli') throw new Error('where failed');
      if (channel === 'provider:list') return { providers: [] };
      if (channel === 'provider:detect-local') return { detection: RUNNING };
      throw new Error(`unexpected IPC: ${channel}`);
    });
    vi.stubGlobal('arena', { platform: 'linux', invoke });
    renderDialog();
    expect((await screen.findByTestId('provider-connect-cli-error')).textContent).toContain('where failed');
  });
});

describe('found on this computer — local Ollama', () => {
  it('lists a running Ollama\'s models and adds the chosen one without sending an address or a key', async () => {
    const invoke = stubBridge();
    const onConnected = vi.fn();
    renderDialog({ onConnected });
    const card = await screen.findByTestId('add-ai-local');
    expect(card.getAttribute('data-status')).toBe('running');
    expect(screen.getByTestId('add-ai-local-status').textContent).toBe('로컬 · 127.0.0.1:11434에서 실행 중 · 모델 2개');
    const radios = screen.getAllByTestId('add-ai-local-model') as HTMLInputElement[];
    expect(radios.map((radio) => radio.value)).toEqual(['gemma4:e4b', 'llama3:8b']);
    expect(radios[0]?.checked).toBe(true);
    fireEvent.click(radios[1] as HTMLInputElement);
    fireEvent.click(await enabled('add-ai-local-add'));
    await waitFor(() => expect(onConnected).toHaveBeenCalledOnce());
    expect(invoke).toHaveBeenCalledWith('provider:add-local', { displayName: 'llama3:8b', model: 'llama3:8b' });
    expect(invoke.mock.calls.some(([channel]) => channel === 'config:set-secret')).toBe(false);
  });

  it.each<[LocalAiDetection, string]>([
    [{ status: 'no-models', endpoint: LOCAL_ADDRESS, version: '0.9.0' }, '설치된 모델이 없습니다'],
    [{ status: 'not-responding', endpoint: LOCAL_ADDRESS, cause: 'refused', detail: 'ECONNREFUSED' }, '설치되지 않았거나 꺼져 있습니다'],
    [{ status: 'not-responding', endpoint: LOCAL_ADDRESS, cause: 'timeout', detail: null }, '2초 안에 응답하지 않았습니다'],
    [{ status: 'not-responding', endpoint: LOCAL_ADDRESS, cause: 'unreachable', detail: 'EHOSTUNREACH' }, '연결하지 못했습니다'],
    // QA Minor 3: an HTTP error says the server answered with an error, not that it isn't Ollama.
    [{ status: 'unrecognized', endpoint: LOCAL_ADDRESS, cause: 'http-error', detail: 'HTTP 404' }, '오류로 답했습니다'],
    [{ status: 'unrecognized', endpoint: LOCAL_ADDRESS, cause: 'not-ollama', detail: null }, 'Ollama가 아닙니다'],
    [{ status: 'unrecognized', endpoint: LOCAL_ADDRESS, cause: 'bad-model-list', detail: null }, '모델 목록을 읽지 못했습니다'],
    [{ status: 'invalid-endpoint', endpoint: 'ftp://x' }, 'OLLAMA_HOST'],
  ])('shows %j by its cause, with no model list and no add button', async (detection, cause) => {
    stubBridge({ detection });
    renderDialog();
    const card = await screen.findByTestId('add-ai-local');
    expect(card.getAttribute('data-status')).toBe(detection.status);
    expect(screen.getByTestId('add-ai-local-status').textContent).toContain(cause);
    if ('detail' in detection && detection.detail !== null) {
      expect(screen.getByTestId('add-ai-local-status').textContent).toContain(detection.detail);
    }
    expect(screen.queryAllByTestId('add-ai-local-model')).toHaveLength(0);
    expect(screen.queryByTestId('add-ai-local-add')).toBeNull();
  });

  it('shows a failed local check as an error, not as "not running"', async () => {
    stubBridge({ detectLocalFails: true });
    renderDialog();
    expect((await screen.findByTestId('add-ai-local-error')).textContent).toContain('bridge down');
    expect(screen.queryByTestId('add-ai-local')).toBeNull();
  });

  it('"다시 찾기" runs both checks again', async () => {
    const invoke = stubBridge({ detection: { status: 'not-responding', endpoint: LOCAL_ADDRESS, cause: 'refused', detail: 'ECONNREFUSED' } });
    renderDialog();
    await screen.findByTestId('add-ai-local');
    fireEvent.click(await enabled('provider-connect-rescan'));
    await waitFor(() => {
      expect(invoke.mock.calls.filter(([channel]) => channel === 'provider:detect-local')).toHaveLength(2);
      expect(invoke.mock.calls.filter(([channel]) => channel === 'provider:detect-cli')).toHaveLength(2);
    });
  });
});

// QA High-1: the dialog says why an add failed — never only "check your input".
describe('failure causes', () => {
  const GENERIC = '입력과 설정을 확인하세요';

  it('says Ollama changed when main finds it no longer running', async () => {
    stubBridge({ addError: transported('provider:add-local',
      '[INTERNAL_ERROR] {cause:local-ai-not-ready} Ollama is not ready at http://127.0.0.1:11434: not-responding') });
    renderDialog();
    fireEvent.click(await enabled('add-ai-local-add'));
    const error = await screen.findByTestId('provider-connect-error');
    expect(error.textContent).toContain('다시 찾기');
    expect(error.textContent).not.toContain(GENERIC);
  });

  it('names the model main could not find', async () => {
    stubBridge({ addError: transported('provider:add-local',
      '[NOT_FOUND] {cause:local-model-missing} Model gemma4:e4b is not installed on Ollama at http://127.0.0.1:11434') });
    renderDialog();
    fireEvent.click(await enabled('add-ai-local-add'));
    expect((await screen.findByTestId('provider-connect-error')).textContent).toContain('gemma4:e4b');
  });

  it('names a display name another AI already took', async () => {
    stubBridge({ addError: transported('provider:add',
      '[INTERNAL_ERROR] {cause:duplicate-display-name} Display name already in use: Claude Code') });
    renderDialog();
    fireEvent.click(await enabled('provider-connect-cli-claude'));
    const error = await screen.findByTestId('provider-connect-error');
    expect(error.textContent).toContain('Claude Code');
    expect(error.textContent).toContain('이미');
    expect(error.textContent).not.toContain(GENERIC);
  });

  it("shows main's own message for any other failure", async () => {
    stubBridge({ addError: transported('provider:add', '[INTERNAL_ERROR] database is locked') });
    renderDialog();
    fireEvent.click(await enabled('provider-connect-cli-claude'));
    const error = await screen.findByTestId('provider-connect-error');
    expect(error.textContent).toContain('database is locked');
    expect(error.textContent).not.toContain('IpcError');
    expect(error.textContent).not.toContain('[INTERNAL_ERROR]');
  });

  it('says why the key could not be stored', async () => {
    const invoke = stubBridge({ setSecretError: transported('config:set-secret',
      '[INTERNAL_ERROR] Encryption is not available. Cannot store secrets without OS-level encryption.') });
    renderDialog();
    fireEvent.click(await enabled('provider-connect-service-anthropic'));
    fireEvent.change(screen.getByTestId('provider-connect-secret'), { target: { value: 'private-token' } });
    fireEvent.click(screen.getByTestId('provider-connect-load-models'));
    const error = await screen.findByTestId('provider-connect-error');
    expect(error.textContent).toContain('Encryption is not available');
    expect(error.textContent).not.toContain('private-token');
    expect(invoke.mock.calls.some(([channel]) => channel === 'provider:list-models')).toBe(false);
  });
});

// QA High-2: a key the dialog could not delete is reported, never dropped silently.
describe('leftover key cleanup failures', () => {
  const failure = (): Error => transported('config:delete-secret', '[INTERNAL_ERROR] secrets file is read-only');

  it('says so in the dialog when a key edit cannot delete the stored key', async () => {
    const invoke = stubBridge({ deleteSecretError: failure() });
    renderDialog();
    await loadModelsForOfficialService(invoke);
    await waitFor(() => expect(screen.getByTestId('provider-connect-model-select')).toBeTruthy());
    fireEvent.change(screen.getByTestId('provider-connect-secret'), { target: { value: 'another-key' } });
    const error = await screen.findByTestId('provider-connect-error');
    expect(error.textContent).toContain('secrets file is read-only');
    expect(error.textContent).not.toContain('private-token');
  });

  it('raises an app notice when closing cannot delete the stored key', async () => {
    const notify = vi.spyOn(errorBoundary, 'notifyError').mockImplementation(() => 'toast');
    try {
      const invoke = stubBridge({ deleteSecretError: failure() });
      renderDialog();
      await loadModelsForOfficialService(invoke);
      await waitFor(() => expect(screen.getByTestId('provider-connect-model-select')).toBeTruthy());
      fireEvent.click(screen.getByTestId('provider-connect-close'));
      await waitFor(() => expect(notify).toHaveBeenCalledOnce());
      expect(String(notify.mock.calls[0]?.[0])).toContain('secrets file is read-only');
    } finally {
      notify.mockRestore();
    }
  });
});

describe('after adding', () => {
  it('offers to edit the new AI\'s name and character sheet, then hands it over', async () => {
    stubBridge();
    const onEditProfile = vi.fn();
    const onOpenChange = vi.fn();
    renderDialog({ onEditProfile, onOpenChange });
    fireEvent.click(await enabled('provider-connect-cli-claude'));
    expect((await screen.findByTestId('provider-connect-added')).textContent).toContain('Claude Code');
    expect(screen.queryByTestId('provider-connect-found')).toBeNull();
    fireEvent.click(screen.getByTestId('provider-connect-edit-profile'));
    expect(onEditProfile).toHaveBeenCalledWith('new-provider', 'Claude Code');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

// ── F1-1/F1-2/F1-3: service picker + auto-filled official endpoint ──
describe('API — service selection (F1-1..F1-3)', () => {
  it('shows the four services and no form until one is picked', async () => {
    stubBridge();
    renderDialog();
    for (const service of ['anthropic', 'openai', 'google', 'other']) {
      expect(await screen.findByTestId(`provider-connect-service-${service}`)).toBeTruthy();
    }
    expect(screen.queryByTestId('provider-connect-secret')).toBeNull();
  });

  it('picking Claude auto-fills the official Anthropic endpoint and a default name', async () => {
    stubBridge();
    renderDialog();
    fireEvent.click(await enabled('provider-connect-service-anthropic'));
    expect((screen.getByTestId('provider-connect-name') as HTMLInputElement).value).toBe('Claude');
    // Official services never show the endpoint field — it's locked.
    expect(screen.queryByTestId('provider-connect-endpoint')).toBeNull();
  });

  it('the default service name skips a name another AI already uses', async () => {
    stubBridge({ providers: [
      { id: 'a', type: 'api', displayName: 'Claude', config: { type: 'api', endpoint: 'https://x/v1', apiKeyRef: 'provider-x', model: 'm' } },
    ] });
    renderDialog();
    fireEvent.click(await enabled('provider-connect-service-anthropic'));
    expect((screen.getByTestId('provider-connect-name') as HTMLInputElement).value).toBe('Claude 2');
  });

  it('the default name can be edited by the user afterwards', async () => {
    stubBridge();
    renderDialog();
    fireEvent.click(await enabled('provider-connect-service-anthropic'));
    fireEvent.change(screen.getByTestId('provider-connect-name'), { target: { value: 'My Claude' } });
    expect((screen.getByTestId('provider-connect-name') as HTMLInputElement).value).toBe('My Claude');
  });

  it('only "other" shows a free-text endpoint field', async () => {
    stubBridge();
    renderDialog();
    fireEvent.click(await enabled('provider-connect-service-google'));
    expect(screen.queryByTestId('provider-connect-endpoint')).toBeNull();
    fireEvent.click(screen.getByTestId('provider-connect-service-other'));
    expect(screen.getByTestId('provider-connect-endpoint')).toBeTruthy();
  });
});

// ── F1-3/F1-4: key → load models → select, key stored once ──────────
describe('API — key + model loading (F1-3..F1-5)', () => {
  it('stores the API key exactly once and reuses the same ref for provider:add', async () => {
    const invoke = stubBridge();
    renderDialog();
    await loadModelsForOfficialService(invoke);
    await waitFor(() => expect(screen.getByTestId('provider-connect-model-select')).toBeTruthy());

    fireEvent.click(screen.getByTestId('provider-connect-submit'));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('provider:add', expect.any(Object)));

    const setCalls = invoke.mock.calls.filter(([channel]) => channel === 'config:set-secret');
    expect(setCalls).toHaveLength(1);
    const ref = (setCalls[0]?.[1] as { key: string }).key;
    expect(ref).toMatch(/^provider-[a-f0-9-]+$/i);
    const addCall = invoke.mock.calls.find(([channel]) => channel === 'provider:add');
    expect((addCall?.[1] as { config: { apiKeyRef: string } }).config.apiKeyRef).toBe(ref);
    expect(JSON.stringify(addCall?.[1])).not.toContain('private-token');
  });

  it('renders every model the handler returned', async () => {
    const invoke = stubBridge({ listModelsResult: { ok: true, models: ['claude-opus-4-6', 'claude-sonnet-4-6'] } });
    renderDialog();
    await loadModelsForOfficialService(invoke);
    const select = await screen.findByTestId('provider-connect-model-select');
    const options = Array.from(select.querySelectorAll('option')).map((o) => o.textContent);
    expect(options).toEqual(['claude-opus-4-6', 'claude-sonnet-4-6']);
  });

  it('explains an empty model list without offering a blank selection or allowing an add', async () => {
    const invoke = stubBridge({ listModelsResult: { ok: true, models: [] } });
    renderDialog();
    await loadModelsForOfficialService(invoke);

    const notice = await screen.findByTestId('provider-connect-model-list-empty');
    expect(notice.textContent).toContain('채팅');
    expect(screen.queryByTestId('provider-connect-model-select')).toBeNull();
    expect(screen.queryByTestId('provider-connect-model')).toBeNull();
    expect((screen.getByTestId('provider-connect-submit') as HTMLButtonElement).disabled).toBe(true);
  });

  it.each(['failure result', 'rejected request'] as const)(
    'discards the previous selection when refreshing models ends with a %s', async (failure) => {
      const invoke = stubBridge();
      renderDialog();
      await loadModelsForOfficialService(invoke);
      const select = await screen.findByTestId('provider-connect-model-select');
      fireEvent.change(select, { target: { value: 'model-b' } });
      expect((screen.getByTestId('provider-connect-submit') as HTMLButtonElement).disabled).toBe(false);

      if (failure === 'failure result') invoke.mockResolvedValueOnce({ ok: false, reason: 'network' });
      else invoke.mockRejectedValueOnce(new Error('bridge down'));
      fireEvent.click(screen.getByTestId('provider-connect-load-models'));

      await screen.findByTestId(failure === 'failure result'
        ? 'provider-connect-model-list-error' : 'provider-connect-error');
      expect(screen.queryByTestId('provider-connect-model-select')).toBeNull();
      expect((screen.getByTestId('provider-connect-submit') as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(screen.getByTestId('provider-connect-submit'));
      expect(invoke.mock.calls.some(([channel]) => channel === 'provider:add')).toBe(false);
    },
  );

  it.each(['key', 'endpoint', 'service', 'close'] as const)(
    'ignores a delayed model list after changing the %s', async (change) => {
      let resolveModels!: (result: { ok: true; models: string[] }) => void;
      const modelsPromise = new Promise<{ ok: true; models: string[] }>((resolve) => { resolveModels = resolve; });
      const invoke = stubBridge();
      const original = invoke.getMockImplementation()!;
      invoke.mockImplementation((channel, data) => channel === 'provider:list-models' ? modelsPromise : original(channel, data));
      render(<ConditionalProviderConnect onConnected={vi.fn()} />);
      fireEvent.click(await enabled('provider-connect-service-other'));
      fireEvent.change(screen.getByTestId('provider-connect-name'), { target: { value: 'Custom AI' } });
      fireEvent.change(screen.getByTestId('provider-connect-endpoint'), { target: { value: 'https://api.example.test/v1' } });
      fireEvent.change(screen.getByTestId('provider-connect-secret'), { target: { value: 'private-token' } });
      fireEvent.click(screen.getByTestId('provider-connect-load-models'));
      await waitFor(() => expect(invoke).toHaveBeenCalledWith('provider:list-models', expect.any(Object)));

      if (change === 'key') fireEvent.change(screen.getByTestId('provider-connect-secret'), { target: { value: 'another-key' } });
      else if (change === 'endpoint') fireEvent.change(screen.getByTestId('provider-connect-endpoint'), { target: { value: 'https://other.example.test/v1' } });
      else fireEvent.click(screen.getByTestId(change === 'close' ? 'provider-connect-close' : 'provider-connect-service-google'));
      await act(async () => { resolveModels({ ok: true, models: ['stale-model'] }); });

      expect(screen.queryByTestId('provider-connect-model-select')).toBeNull();
      if (change !== 'close') {
        expect((screen.getByTestId('provider-connect-submit') as HTMLButtonElement).disabled).toBe(true);
        expect((screen.getByTestId('provider-connect-load-models') as HTMLButtonElement).textContent).toContain('불러오기');
      }
    },
  );

  it('cleans up a newly stored key if the dialog closed before storage finished', async () => {
    let resolveStore!: (result: { success: boolean }) => void;
    const storePromise = new Promise<{ success: boolean }>((resolve) => { resolveStore = resolve; });
    const invoke = stubBridge();
    const original = invoke.getMockImplementation()!;
    invoke.mockImplementation((channel, data) => channel === 'config:set-secret' ? storePromise : original(channel, data));
    render(<ConditionalProviderConnect onConnected={vi.fn()} />);
    fireEvent.click(await enabled('provider-connect-service-google'));
    fireEvent.change(screen.getByTestId('provider-connect-secret'), { target: { value: 'private-token' } });
    fireEvent.click(screen.getByTestId('provider-connect-load-models'));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('config:set-secret', expect.any(Object)));
    const storeCall = invoke.mock.calls.find(([channel]) => channel === 'config:set-secret');

    fireEvent.click(screen.getByTestId('provider-connect-close'));
    await act(async () => { resolveStore({ success: true }); });

    expect(invoke).toHaveBeenCalledWith('config:delete-secret', { key: (storeCall?.[1] as { key: string }).key });
    expect(invoke.mock.calls.filter(([channel]) => channel === 'config:delete-secret')).toHaveLength(1);
    expect(invoke.mock.calls.some(([channel]) => channel === 'provider:list-models')).toBe(false);
  });

  it('keeps a newer model request loading when an obsolete refresh completes', async () => {
    const invoke = stubBridge();
    renderDialog();
    await loadModelsForOfficialService(invoke);
    await screen.findByTestId('provider-connect-model-select');
    let resolveOld!: (result: { ok: true; models: string[] }) => void;
    let resolveCurrent!: (result: { ok: true; models: string[] }) => void;
    const oldPromise = new Promise<{ ok: true; models: string[] }>((resolve) => { resolveOld = resolve; });
    const currentPromise = new Promise<{ ok: true; models: string[] }>((resolve) => { resolveCurrent = resolve; });
    const original = invoke.getMockImplementation()!;
    let listCalls = 0;
    invoke.mockImplementation((channel, data) => {
      if (channel === 'provider:list-models') return listCalls++ === 0 ? oldPromise : currentPromise;
      return original(channel, data);
    });

    fireEvent.click(screen.getByTestId('provider-connect-load-models'));
    expect(screen.queryByTestId('provider-connect-model-select')).toBeNull();
    expect((screen.getByTestId('provider-connect-submit') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByTestId('provider-connect-secret'), { target: { value: 'another-key' } });
    fireEvent.click(screen.getByTestId('provider-connect-load-models'));
    await waitFor(() => expect(listCalls).toBe(2));

    await act(async () => { resolveOld({ ok: true, models: ['obsolete-model'] }); });
    expect(screen.queryByTestId('provider-connect-model-select')).toBeNull();
    expect((screen.getByTestId('provider-connect-load-models') as HTMLButtonElement).disabled).toBe(true);

    await act(async () => { resolveCurrent({ ok: true, models: ['current-model'] }); });
    expect((await screen.findByTestId('provider-connect-model-select') as HTMLSelectElement).value).toBe('current-model');
    expect((screen.getByTestId('provider-connect-submit') as HTMLButtonElement).disabled).toBe(false);
  });

  it('changing the key after a successful load discards the stored secret and clears the model list', async () => {
    const invoke = stubBridge();
    renderDialog();
    await loadModelsForOfficialService(invoke);
    await waitFor(() => expect(screen.getByTestId('provider-connect-model-select')).toBeTruthy());
    invoke.mockClear();

    fireEvent.change(screen.getByTestId('provider-connect-secret'), { target: { value: 'a-different-key' } });

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('config:delete-secret', expect.any(Object)));
    expect(screen.queryByTestId('provider-connect-model-select')).toBeNull();
  });

  it('closing the dialog after a load discards that attempt\'s stored secret', async () => {
    const invoke = stubBridge();
    const onOpenChange = vi.fn();
    renderDialog({ onOpenChange });
    await loadModelsForOfficialService(invoke);
    await waitFor(() => expect(screen.getByTestId('provider-connect-model-select')).toBeTruthy());
    invoke.mockClear();

    fireEvent.click(screen.getByTestId('provider-connect-close'));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('config:delete-secret', expect.any(Object)));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

// ── F1-6: per-cause model-list error, never an empty list ───────────
describe('API — model-list failure reasons (F1-6)', () => {
  it('auth failure shows the auth-specific message', async () => {
    const invoke = stubBridge({ listModelsResult: { ok: false, reason: 'auth' } });
    renderDialog();
    await loadModelsForOfficialService(invoke);
    const banner = await screen.findByTestId('provider-connect-model-list-error');
    expect(banner.textContent).toBe('API 키를 확인하세요. 모델 목록을 가져올 권한이 없습니다.');
    expect(screen.queryByTestId('provider-connect-model-select')).toBeNull();
  });

  it('network failure shows the network-specific message', async () => {
    const invoke = stubBridge({ listModelsResult: { ok: false, reason: 'network' } });
    renderDialog();
    await loadModelsForOfficialService(invoke);
    const banner = await screen.findByTestId('provider-connect-model-list-error');
    expect(banner.textContent).toBe('서비스에 연결하지 못했습니다. 네트워크 상태를 확인하고 다시 시도하세요.');
  });

  it('parse failure shows the parse-specific message', async () => {
    const invoke = stubBridge({ listModelsResult: { ok: false, reason: 'parse' } });
    renderDialog();
    await loadModelsForOfficialService(invoke);
    const banner = await screen.findByTestId('provider-connect-model-list-error');
    expect(banner.textContent).toBe('서비스 응답을 해석하지 못했습니다. 잠시 후 다시 시도하세요.');
  });

  it('an official service (not "other") never offers manual model entry on failure', async () => {
    const invoke = stubBridge({ listModelsResult: { ok: false, reason: 'network' } });
    renderDialog();
    await loadModelsForOfficialService(invoke);
    await screen.findByTestId('provider-connect-model-list-error');
    expect(screen.queryByTestId('provider-connect-model')).toBeNull();
    expect(screen.queryByTestId('provider-connect-model-select')).toBeNull();
  });
});

// ── F1-8: "other" allows manual model entry on failure ───────────────
describe('API — "other" (OpenAI-compatible) manual entry (F1-8)', () => {
  it('shows the endpoint field and allows typing a model name when listing fails', async () => {
    const invoke = stubBridge({ listModelsResult: { ok: false, reason: 'network' } });
    renderDialog();
    fireEvent.click(await enabled('provider-connect-service-other'));
    fireEvent.change(screen.getByTestId('provider-connect-endpoint'), { target: { value: 'https://api.example.test/v1' } });
    fireEvent.change(screen.getByTestId('provider-connect-secret'), { target: { value: 'private-token' } });
    fireEvent.click(screen.getByTestId('provider-connect-load-models'));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('provider:list-models', expect.any(Object)));

    await screen.findByTestId('provider-connect-model-list-error');
    const manualInput = await screen.findByTestId('provider-connect-model');
    fireEvent.change(manualInput, { target: { value: 'my-custom-model' } });
    fireEvent.change(screen.getByTestId('provider-connect-name'), { target: { value: 'Custom AI' } });
    fireEvent.click(screen.getByTestId('provider-connect-submit'));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('provider:add', expect.objectContaining({
      config: expect.objectContaining({ model: 'my-custom-model' }),
    })));
  });

  it('rejects an unsafe "other" endpoint at load-models time — never reaches config:set-secret or provider:list-models', async () => {
    const invoke = stubBridge();
    renderDialog();
    fireEvent.click(await enabled('provider-connect-service-other'));
    fireEvent.change(screen.getByTestId('provider-connect-name'), { target: { value: 'My AI' } });
    fireEvent.change(screen.getByTestId('provider-connect-endpoint'), { target: { value: 'https://user:pass@api.example.test/v1' } });
    fireEvent.change(screen.getByTestId('provider-connect-secret'), { target: { value: 'private-token' } });
    fireEvent.click(screen.getByTestId('provider-connect-load-models'));
    expect(screen.getByTestId('provider-connect-error').textContent).toBeTruthy();
    expect(invoke.mock.calls.map(([channel]) => channel)).not.toContain('config:set-secret');
    expect(invoke.mock.calls.map(([channel]) => channel)).not.toContain('provider:list-models');

    fireEvent.click(screen.getByTestId('provider-connect-submit'));
    expect(invoke.mock.calls.some(([channel]) => channel === 'provider:add')).toBe(false);
  });
});

describe('API — secret cleanup (A1 regressions)', () => {
  it('never rolls back a registered API provider if the UI refresh callback fails', async () => {
    const invoke = stubBridge();
    renderDialog({ onConnected: () => { throw new Error('UI refresh failed'); } });
    await loadModelsForOfficialService(invoke);
    await waitFor(() => expect(screen.getByTestId('provider-connect-model-select')).toBeTruthy());
    fireEvent.change(screen.getByTestId('provider-connect-name'), { target: { value: 'My AI' } });
    fireEvent.click(screen.getByTestId('provider-connect-submit'));

    await waitFor(() => expect(screen.getByTestId('provider-connect-error')).toBeTruthy());
    expect(invoke.mock.calls.some(([channel]) => channel === 'config:delete-secret')).toBe(false);
  });

  it('never deletes the just-registered secret when registration succeeds, even after closing (stale-closure regression)', async () => {
    const invoke = stubBridge();
    const onConnected = vi.fn();
    renderDialog({ onConnected });
    await loadModelsForOfficialService(invoke);
    await waitFor(() => expect(screen.getByTestId('provider-connect-model-select')).toBeTruthy());
    fireEvent.change(screen.getByTestId('provider-connect-name'), { target: { value: 'My AI' } });
    fireEvent.click(screen.getByTestId('provider-connect-submit'));

    await waitFor(() => expect(onConnected).toHaveBeenCalledOnce());
    fireEvent.click(await screen.findByTestId('provider-connect-done'));
    expect(invoke.mock.calls.some(([channel]) => channel === 'config:delete-secret')).toBe(false);
  });

  it('stores API secret separately and rolls it back if registration fails', async () => {
    const invoke = stubBridge({ addFails: true });
    renderDialog();
    await loadModelsForOfficialService(invoke);
    await waitFor(() => expect(screen.getByTestId('provider-connect-model-select')).toBeTruthy());
    fireEvent.change(screen.getByTestId('provider-connect-name'), { target: { value: 'My AI' } });
    fireEvent.click(screen.getByTestId('provider-connect-submit'));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('config:delete-secret', expect.any(Object)));
    const setCall = invoke.mock.calls.find(([channel]) => channel === 'config:set-secret');
    const addCall = invoke.mock.calls.find(([channel]) => channel === 'provider:add');
    const deleteCall = invoke.mock.calls.find(([channel]) => channel === 'config:delete-secret');
    const ref = (setCall?.[1] as { key: string }).key;
    expect((addCall?.[1] as { config: { apiKeyRef: string } }).config.apiKeyRef).toBe(ref);
    expect(deleteCall?.[1]).toEqual({ key: ref });
    expect(JSON.stringify(addCall?.[1])).not.toContain('private-token');
    expect(screen.getByTestId('provider-connect-error').textContent).not.toContain('private-token');
  });

  // ── Close mid-registration (review follow-up #1) ─────────────────────
  describe('closing the dialog while provider:add is still in flight', () => {
    async function submitAndClose(invoke: ReturnType<typeof vi.fn>): Promise<void> {
      fireEvent.click(await enabled('provider-connect-service-anthropic'));
      fireEvent.change(screen.getByTestId('provider-connect-secret'), { target: { value: 'private-token' } });
      fireEvent.click(screen.getByTestId('provider-connect-load-models'));
      await waitFor(() => expect(screen.getByTestId('provider-connect-model-select')).toBeTruthy());
      fireEvent.change(screen.getByTestId('provider-connect-name'), { target: { value: 'My AI' } });
      fireEvent.click(screen.getByTestId('provider-connect-submit'));
      await waitFor(() => expect(invoke).toHaveBeenCalledWith('provider:add', expect.any(Object)));
      // Close while provider:add is still pending — the dialog unmounts.
      fireEvent.click(screen.getByTestId('provider-connect-close'));
      expect(screen.queryByTestId('provider-connect-dialog')).toBeNull();
    }

    it('does not delete the secret when the in-flight registration then SUCCEEDS', async () => {
      const { invoke, resolveAdd } = stubBridgeWithControlledAdd();
      const onConnected = vi.fn();
      render(<ConditionalProviderConnect onConnected={onConnected} />);
      await submitAndClose(invoke);

      resolveAdd();
      await waitFor(() => expect(onConnected).toHaveBeenCalledOnce());
      expect(invoke.mock.calls.some(([channel]) => channel === 'config:delete-secret')).toBe(false);
    });

    it('deletes the secret exactly once when the in-flight registration then FAILS', async () => {
      const { invoke, rejectAdd } = stubBridgeWithControlledAdd();
      render(<ConditionalProviderConnect onConnected={vi.fn()} />);
      await submitAndClose(invoke);
      const setCall = invoke.mock.calls.find(([channel]) => channel === 'config:set-secret');
      const ref = (setCall?.[1] as { key: string }).key;

      rejectAdd('registration failed');
      await waitFor(() => expect(invoke).toHaveBeenCalledWith('config:delete-secret', expect.any(Object)));

      const deleteCalls = invoke.mock.calls.filter(([channel]) => channel === 'config:delete-secret');
      expect(deleteCalls).toHaveLength(1);
      expect(deleteCalls[0]?.[1]).toEqual({ key: ref });
    });
  });
});
