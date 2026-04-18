/**
 * Provider store unit tests.
 *
 * Tests Zustand store actions directly without rendering React components.
 * window.arena is mocked for actions that invoke IPC.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useProviderStore } from '../provider-store';
import type { ProviderInfo } from '../../../shared/provider-types';

// ── Mock window.arena + localStorage ──────────────────────────────────

const invokeMock = vi.fn().mockResolvedValue(undefined);
const storageMap = new Map<string, string>();

vi.stubGlobal('window', {
  arena: { invoke: invokeMock, on: vi.fn(() => vi.fn()) },
  dispatchEvent: vi.fn(),
  CustomEvent: class CustomEvent { detail: unknown; constructor(_type: string, opts?: { detail?: unknown }) { this.detail = opts?.detail; } },
});

vi.stubGlobal('localStorage', {
  getItem: (key: string) => storageMap.get(key) ?? null,
  setItem: (key: string, value: string) => storageMap.set(key, value),
  removeItem: (key: string) => storageMap.delete(key),
  clear: () => storageMap.clear(),
});

// ── Helpers ────────────────────────────────────────────────────────────

function makeProvider(overrides?: Partial<ProviderInfo>): ProviderInfo {
  return {
    id: 'provider-1',
    type: 'api',
    displayName: 'Test GPT',
    model: 'gpt-4o',
    capabilities: ['streaming'],
    status: 'ready',
    config: { type: 'api', endpoint: 'https://api.test.com', apiKeyRef: 'test-key', model: 'gpt-4o' },
    ...overrides,
  };
}

function resetStore(): void {
  storageMap.clear();
  useProviderStore.setState({
    providers: [],
    selectedProviderIds: null,
    tokenUsageByProvider: {},
    loading: false,
    error: null,
  });
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('provider-store', () => {
  beforeEach(() => {
    resetStore();
    invokeMock.mockReset().mockResolvedValue(undefined);
  });

  // ── fetchProviders ─────────────────────────────────────────────────

  describe('fetchProviders', () => {
    it('populates providers array from IPC result', async () => {
      const p1 = makeProvider({ id: 'p1', displayName: 'GPT-4' });
      const p2 = makeProvider({ id: 'p2', displayName: 'Claude' });
      invokeMock.mockResolvedValue({ providers: [p1, p2] });

      await useProviderStore.getState().fetchProviders();

      const state = useProviderStore.getState();
      expect(state.providers).toHaveLength(2);
      expect(state.providers[0].displayName).toBe('GPT-4');
      expect(state.providers[1].displayName).toBe('Claude');
      expect(state.loading).toBe(false);
      expect(state.error).toBeNull();
    });

    it('auto-selects all providers when none previously selected', async () => {
      const p1 = makeProvider({ id: 'p1' });
      const p2 = makeProvider({ id: 'p2' });
      invokeMock.mockResolvedValue({ providers: [p1, p2] });

      await useProviderStore.getState().fetchProviders();

      const state = useProviderStore.getState();
      expect(state.selectedProviderIds).toEqual(['p1', 'p2']);
    });

    it('preserves existing selection when providers are refreshed', async () => {
      const p1 = makeProvider({ id: 'p1' });
      const p2 = makeProvider({ id: 'p2' });
      useProviderStore.setState({ selectedProviderIds: ['p1'] });
      invokeMock.mockResolvedValue({ providers: [p1, p2] });

      await useProviderStore.getState().fetchProviders();

      const state = useProviderStore.getState();
      expect(state.selectedProviderIds).toEqual(['p1']);
    });

    it('removes stale selections for providers that no longer exist', async () => {
      useProviderStore.setState({ selectedProviderIds: ['p1', 'p-gone'] });
      invokeMock.mockResolvedValue({ providers: [makeProvider({ id: 'p1' })] });

      await useProviderStore.getState().fetchProviders();

      const state = useProviderStore.getState();
      expect(state.selectedProviderIds).toEqual(['p1']);
    });

    it('sets error on failure', async () => {
      invokeMock.mockRejectedValue(new Error('Network error'));

      await useProviderStore.getState().fetchProviders();

      const state = useProviderStore.getState();
      expect(state.error).toBe('Network error');
      expect(state.loading).toBe(false);
    });

    it('sets loading=true during fetch', async () => {
      let resolvePromise: (value: unknown) => void;
      invokeMock.mockReturnValue(new Promise((resolve) => { resolvePromise = resolve; }));

      const fetchPromise = useProviderStore.getState().fetchProviders();
      expect(useProviderStore.getState().loading).toBe(true);

      resolvePromise!({ providers: [] });
      await fetchPromise;
      expect(useProviderStore.getState().loading).toBe(false);
    });
  });

  // ── toggleProviderSelection ────────────────────────────────────────

  describe('toggleProviderSelection', () => {
    it('adds provider to selection if not present', () => {
      useProviderStore.setState({ selectedProviderIds: ['p1'] });

      useProviderStore.getState().toggleProviderSelection('p2');

      expect(useProviderStore.getState().selectedProviderIds).toEqual(['p1', 'p2']);
    });

    it('removes provider from selection if already present', () => {
      useProviderStore.setState({ selectedProviderIds: ['p1', 'p2'] });

      useProviderStore.getState().toggleProviderSelection('p1');

      expect(useProviderStore.getState().selectedProviderIds).toEqual(['p2']);
    });

    it('toggles correctly on repeated calls', () => {
      useProviderStore.setState({ selectedProviderIds: [] });

      useProviderStore.getState().toggleProviderSelection('p1');
      expect(useProviderStore.getState().selectedProviderIds).toContain('p1');

      useProviderStore.getState().toggleProviderSelection('p1');
      expect(useProviderStore.getState().selectedProviderIds).not.toContain('p1');
    });
  });

  // ── activeProviders (derived) ──────────────────────────────────────

  describe('activeProviders (derived from selection)', () => {
    it('returns only selected providers', () => {
      const p1 = makeProvider({ id: 'p1' });
      const p2 = makeProvider({ id: 'p2' });
      const p3 = makeProvider({ id: 'p3' });
      useProviderStore.setState({
        providers: [p1, p2, p3],
        selectedProviderIds: ['p1', 'p3'],
      });

      const state = useProviderStore.getState();
      const active = state.providers.filter((p) => (state.selectedProviderIds ?? []).includes(p.id));
      expect(active).toHaveLength(2);
      expect(active.map((p) => p.id)).toEqual(['p1', 'p3']);
    });

    it('returns empty array when none selected', () => {
      const p1 = makeProvider({ id: 'p1' });
      useProviderStore.setState({
        providers: [p1],
        selectedProviderIds: [],
      });

      const state = useProviderStore.getState();
      const active = state.providers.filter((p) => (state.selectedProviderIds ?? []).includes(p.id));
      expect(active).toHaveLength(0);
    });
  });

  // ── addTokenUsage ──────────────────────────────────────────────────

  describe('addTokenUsage', () => {
    it('accumulates token usage for a provider', () => {
      useProviderStore.getState().addTokenUsage('p1', { inputTokens: 10, outputTokens: 20, usageSource: 'provider' });
      useProviderStore.getState().addTokenUsage('p1', { inputTokens: 5, outputTokens: 15, usageSource: 'provider' });

      const usage = useProviderStore.getState().tokenUsageByProvider['p1'];
      expect(usage.inputTokens).toBe(15);
      expect(usage.outputTokens).toBe(35);
      expect(usage.totalTokens).toBe(50);
    });

    it('sets null values for unknown usage source', () => {
      useProviderStore.getState().addTokenUsage('p1', { inputTokens: null, outputTokens: null, usageSource: 'unknown' });

      const usage = useProviderStore.getState().tokenUsageByProvider['p1'];
      expect(usage.inputTokens).toBeNull();
      expect(usage.outputTokens).toBeNull();
      expect(usage.totalTokens).toBeNull();
      expect(usage.usageSource).toBe('unknown');
    });
  });

  // ── resetTokenUsage ────────────────────────────────────────────────

  describe('resetTokenUsage', () => {
    it('clears all token usage data', () => {
      useProviderStore.getState().addTokenUsage('p1', { inputTokens: 10, outputTokens: 20, usageSource: 'provider' });
      useProviderStore.getState().resetTokenUsage();

      expect(useProviderStore.getState().tokenUsageByProvider).toEqual({});
    });
  });
});
