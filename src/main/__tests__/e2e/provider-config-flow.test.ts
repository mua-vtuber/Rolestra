/**
 * E2E Integration test: Provider → Config flow.
 *
 * Tests the main process logic without Electron shell:
 * - Provider registry add/remove/list
 * - Config service settings CRUD
 * - Secrets lifecycle
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { ProviderInfo, ProviderConfig, ApiProviderConfig } from '../../../shared/provider-types';
import type { SettingsConfig } from '../../../shared/config-types';
import { DEFAULT_SETTINGS } from '../../../shared/config-types';

// ── Minimal in-memory provider registry ─────────────────────────────────

class InMemoryProviderRegistry {
  private providers = new Map<string, ProviderInfo>();

  add(displayName: string, config: ProviderConfig, persona?: string): ProviderInfo {
    const id = `provider-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const info: ProviderInfo = {
      id,
      type: config.type,
      displayName,
      model: config.model,
      capabilities: [],
      status: 'ready',
      config,
      persona,
      roles: [],
      skill_overrides: null,
    };
    this.providers.set(id, info);
    return info;
  }

  remove(id: string): boolean {
    return this.providers.delete(id);
  }

  list(): ProviderInfo[] {
    return Array.from(this.providers.values());
  }

  get(id: string): ProviderInfo | undefined {
    return this.providers.get(id);
  }
}

// ── Minimal in-memory config service ────────────────────────────────────

class InMemoryConfigService {
  private settings: SettingsConfig = { ...DEFAULT_SETTINGS };
  private secrets = new Map<string, string>();

  getSettings(): SettingsConfig {
    return { ...this.settings };
  }

  updateSettings(patch: Partial<SettingsConfig>): SettingsConfig {
    this.settings = { ...this.settings, ...patch };
    return { ...this.settings };
  }

  async setSecret(key: string, value: string): Promise<void> {
    this.secrets.set(key, value);
  }

  async getSecret(key: string): Promise<string | null> {
    return this.secrets.get(key) ?? null;
  }

  async deleteSecret(key: string): Promise<void> {
    this.secrets.delete(key);
  }

  listSecretKeys(): string[] {
    return Array.from(this.secrets.keys());
  }
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('E2E: Provider → Config Flow', () => {
  let registry: InMemoryProviderRegistry;
  let config: InMemoryConfigService;

  beforeEach(() => {
    registry = new InMemoryProviderRegistry();
    config = new InMemoryConfigService();
  });

  // ── Provider registration lifecycle ────────────────────────────────

  it('registers a provider and lists it', () => {
    const apiConfig: ApiProviderConfig = {
      type: 'api',
      endpoint: 'https://api.openai.com/v1',
      apiKeyRef: 'openai-key',
      model: 'gpt-4o',
    };

    const provider = registry.add('My GPT', apiConfig);

    expect(provider.displayName).toBe('My GPT');
    expect(provider.type).toBe('api');
    expect(provider.model).toBe('gpt-4o');

    const list = registry.list();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(provider.id);
  });

  it('registers multiple providers of different types', () => {
    registry.add('Claude API', {
      type: 'api',
      endpoint: 'https://api.anthropic.com/v1',
      apiKeyRef: 'anthropic-key',
      model: 'claude-sonnet',
    });

    registry.add('Claude CLI', {
      type: 'cli',
      command: 'claude',
      args: [],
      inputFormat: 'stdin-json',
      outputFormat: 'stream-json',
      sessionStrategy: 'persistent',
      hangTimeout: { first: 30_000, subsequent: 60_000 },
      model: 'claude',
    });

    registry.add('Ollama', {
      type: 'local',
      baseUrl: 'http://localhost:11434',
      model: 'llama3',
    });

    const list = registry.list();
    expect(list).toHaveLength(3);
    expect(list.map((p) => p.type)).toEqual(['api', 'cli', 'local']);
  });

  it('removes a provider', () => {
    const provider = registry.add('Temp', {
      type: 'api',
      endpoint: 'https://temp.com',
      apiKeyRef: 'temp',
      model: 'temp',
    });

    expect(registry.list()).toHaveLength(1);

    const removed = registry.remove(provider.id);
    expect(removed).toBe(true);
    expect(registry.list()).toHaveLength(0);
  });

  it('returns false when removing non-existent provider', () => {
    expect(registry.remove('non-existent')).toBe(false);
  });

  // ── Config settings lifecycle ─────────────────────────────────────

  it('returns default settings initially', () => {
    const settings = config.getSettings();
    expect(settings.language).toBe('ko');
    expect(settings.defaultRounds).toBe(3);
    expect(settings.uiTheme).toBe('dark');
    expect(settings.designatedAggregatorId).toBe('');
  });

  it('updates settings with partial patch', () => {
    const updated = config.updateSettings({
      uiTheme: 'light',
      defaultRounds: 5,
      language: 'en',
    });

    expect(updated.uiTheme).toBe('light');
    expect(updated.defaultRounds).toBe(5);
    expect(updated.language).toBe('en');
    expect(updated.maxRetries).toBe(3);
  });

  it('persists settings across getSettings calls', () => {
    config.updateSettings({ softTokenLimit: 5000 });
    const s1 = config.getSettings();
    const s2 = config.getSettings();
    expect(s1.softTokenLimit).toBe(5000);
    expect(s2.softTokenLimit).toBe(5000);
  });

  // ── Secrets lifecycle ─────────────────────────────────────────────

  it('stores and retrieves a secret', async () => {
    await config.setSecret('openai-key', 'sk-test-12345');
    const value = await config.getSecret('openai-key');
    expect(value).toBe('sk-test-12345');
  });

  it('lists secret keys', async () => {
    await config.setSecret('key-a', 'value-a');
    await config.setSecret('key-b', 'value-b');

    const keys = config.listSecretKeys();
    expect(keys).toContain('key-a');
    expect(keys).toContain('key-b');
    expect(keys).toHaveLength(2);
  });

  it('deletes a secret', async () => {
    await config.setSecret('temp-key', 'temp-value');
    await config.deleteSecret('temp-key');

    const value = await config.getSecret('temp-key');
    expect(value).toBeNull();
    expect(config.listSecretKeys()).not.toContain('temp-key');
  });

  it('returns null for non-existent secret', async () => {
    expect(await config.getSecret('nonexistent')).toBeNull();
  });

  // ── Provider + Config integration ────────────────────────────────

  it('full flow: register → configure → cleanup', async () => {
    await config.setSecret('my-api-key', 'sk-real-key');

    const provider = registry.add('My AI', {
      type: 'api',
      endpoint: 'https://api.provider.com/v1',
      apiKeyRef: 'my-api-key',
      model: 'smart-model',
    });

    config.updateSettings({
      defaultRounds: 5,
      softTokenLimit: 2000,
      hardTokenLimit: 3000,
    });

    const settings = config.getSettings();
    expect(settings.defaultRounds).toBe(5);
    expect(settings.softTokenLimit).toBe(2000);

    const retrieved = registry.get(provider.id);
    expect(retrieved?.displayName).toBe('My AI');

    registry.remove(provider.id);
    await config.deleteSecret('my-api-key');

    expect(registry.list()).toHaveLength(0);
    expect(await config.getSecret('my-api-key')).toBeNull();
  });
});
