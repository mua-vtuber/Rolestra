/**
 * Provider management Zustand store.
 *
 * Manages the list of AI providers and CRUD operations via IPC.
 * Selected provider IDs are persisted to localStorage so they
 * survive page refreshes.
 */

import { create } from 'zustand';
import type { ProviderInfo, ProviderConfig } from '../../shared/provider-types';

export interface ProviderTokenUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  usageSource: 'provider' | 'unknown';
}

interface ProviderState {
  providers: ProviderInfo[];
  /** null = not yet initialized (select all on first fetch), [] = user deselected all */
  selectedProviderIds: string[] | null;
  tokenUsageByProvider: Record<string, ProviderTokenUsage>;
  loading: boolean;
  error: string | null;

  fetchProviders: () => Promise<void>;
  toggleProviderSelection: (id: string) => void;
  addTokenUsage: (
    providerId: string,
    usage: { inputTokens: number | null; outputTokens: number | null; usageSource: 'provider' | 'unknown' },
  ) => void;
  resetTokenUsage: () => void;
  addProvider: (
    displayName: string,
    config: ProviderConfig,
    persona?: string,
  ) => Promise<ProviderInfo>;
  removeProvider: (id: string) => Promise<void>;
}

// ── localStorage persistence for selectedProviderIds ──────────

const STORAGE_KEY = 'arena:selectedProviderIds';

function loadSelection(): string[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function saveSelection(ids: string[] | null): void {
  try {
    if (ids === null) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
    }
  } catch { /* storage full or disabled */ }
}

// ── Store ─────────────────────────────────────────────────────

export const useProviderStore = create<ProviderState>((set) => ({
  providers: [],
  selectedProviderIds: loadSelection(),
  tokenUsageByProvider: {},
  loading: false,
  error: null,

  fetchProviders: async () => {
    set({ loading: true, error: null });
    try {
      const result = await window.arena.invoke('provider:list', undefined);
      set((state) => {
        const nextProviderIds = result.providers.map((p) => p.id);
        // null = first fetch, select all; [] = user deselected all, keep empty
        const selected = state.selectedProviderIds === null
          ? nextProviderIds
          : state.selectedProviderIds.filter((id) => nextProviderIds.includes(id));
        saveSelection(selected);
        return {
          providers: result.providers,
          selectedProviderIds: selected,
          tokenUsageByProvider: Object.fromEntries(
            Object.entries(state.tokenUsageByProvider).filter(([id]) => nextProviderIds.includes(id)),
          ),
          loading: false,
        };
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      set({ error: message, loading: false });
    }
  },

  toggleProviderSelection: (id) =>
    set((state) => {
      const current = state.selectedProviderIds ?? state.providers.map((p) => p.id);
      const exists = current.includes(id);
      const next = exists
        ? current.filter((providerId) => providerId !== id)
        : [...current, id];
      saveSelection(next);
      return { selectedProviderIds: next };
    }),

  addTokenUsage: (providerId, usage) =>
    set((state) => {
      const prev = state.tokenUsageByProvider[providerId];
      if (usage.usageSource === 'unknown' || usage.inputTokens == null || usage.outputTokens == null) {
        return {
          tokenUsageByProvider: {
            ...state.tokenUsageByProvider,
            [providerId]: {
              inputTokens: null,
              outputTokens: null,
              totalTokens: null,
              usageSource: 'unknown',
            },
          },
        };
      }
      if (prev?.usageSource === 'unknown') {
        return state;
      }
      const nextInput = (prev?.inputTokens ?? 0) + usage.inputTokens;
      const nextOutput = (prev?.outputTokens ?? 0) + usage.outputTokens;
      return {
        tokenUsageByProvider: {
          ...state.tokenUsageByProvider,
          [providerId]: {
            inputTokens: nextInput,
            outputTokens: nextOutput,
            totalTokens: nextInput + nextOutput,
            usageSource: usage.usageSource,
          },
        },
      };
    }),

  resetTokenUsage: () => set({ tokenUsageByProvider: {} }),

  addProvider: async (displayName, config, persona) => {
    const result = await window.arena.invoke('provider:add', {
      displayName,
      config,
      persona,
    });
    set((state) => {
      const current = state.selectedProviderIds ?? state.providers.map((p) => p.id);
      const next = [...current, result.provider.id];
      saveSelection(next);
      return {
        providers: [...state.providers, result.provider],
        selectedProviderIds: next,
      };
    });
    return result.provider;
  },

  removeProvider: async (id) => {
    await window.arena.invoke('provider:remove', { id });
    set((state) => {
      const next = (state.selectedProviderIds ?? []).filter((providerId) => providerId !== id);
      saveSelection(next);
      return {
        providers: state.providers.filter((p) => p.id !== id),
        selectedProviderIds: next,
        tokenUsageByProvider: Object.fromEntries(
          Object.entries(state.tokenUsageByProvider).filter(([providerId]) => providerId !== id),
        ),
      };
    });
  },
}));
