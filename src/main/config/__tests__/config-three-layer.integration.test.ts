/**
 * Integration tests for the 3-layer config system:
 *   1. Settings (persistent JSON file)
 *   2. Secrets (encrypted via SafeStorageAdapter)
 *   3. Runtime (ephemeral in-memory overrides)
 *
 * Tests the SettingsStore, SecretStore, and ConfigServiceImpl together
 * to verify layer isolation, merge behavior, precedence rules, and
 * persistence across instances.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import { createTmpDir, removeTmpDir } from '../../../test-utils';
import { SettingsStore } from '../settings-store';
import { SecretStore, type SafeStorageAdapter } from '../secret-store';
import { ConfigServiceImpl } from '../config-service';
import {
  DEFAULT_SETTINGS,
  DEFAULT_MEMORY_SETTINGS,
} from '../../../shared/config-types';

// ── Mock SafeStorageAdapter ─────────────────────────────────────────────

function createMockAdapter(available = true): SafeStorageAdapter {
  const XOR_KEY = 0x42;
  return {
    isEncryptionAvailable: () => available,
    encryptString: (plaintext: string): Buffer => {
      const buf = Buffer.from(plaintext, 'utf-8');
      for (let i = 0; i < buf.length; i++) {
        buf[i] = buf[i] ^ XOR_KEY;
      }
      return buf;
    },
    decryptString: (encrypted: Buffer): string => {
      const buf = Buffer.from(encrypted);
      for (let i = 0; i < buf.length; i++) {
        buf[i] = buf[i] ^ XOR_KEY;
      }
      return buf.toString('utf-8');
    },
  };
}

// ═════════════════════════════════════════════════════════════════════════
// Settings Store
// ═════════════════════════════════════════════════════════════════════════

describe('Config Three-Layer — Settings Store', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTmpDir('config-settings-');
  });

  afterEach(() => {
    removeTmpDir(tmpDir);
  });

  it('defaults exist on first read', () => {
    const store = new SettingsStore(tmpDir);
    const settings = store.getSettings();

    expect(settings).toEqual(DEFAULT_SETTINGS);
    expect(settings.version).toBe(1);
    expect(settings.uiTheme).toBe('dark');
    expect(settings.language).toBe('ko');
    expect(settings.defaultRounds).toBe(3);
  });

  it('update merges partial patch without losing other fields', () => {
    const store = new SettingsStore(tmpDir);
    store.updateSettings({ uiTheme: 'light' });

    const settings = store.getSettings();
    expect(settings.uiTheme).toBe('light');
    expect(settings.language).toBe('ko');
    expect(settings.defaultRounds).toBe(3);
    expect(settings.memorySettings).toEqual(DEFAULT_MEMORY_SETTINGS);
  });

  it('updated values persist on re-read', () => {
    const store = new SettingsStore(tmpDir);
    store.updateSettings({ language: 'en', softTokenLimit: 5000 });

    const settings = store.getSettings();
    expect(settings.language).toBe('en');
    expect(settings.softTokenLimit).toBe(5000);
  });

  it('multiple sequential updates all merge correctly', () => {
    const store = new SettingsStore(tmpDir);
    store.updateSettings({ uiTheme: 'light' });
    store.updateSettings({ language: 'en' });
    store.updateSettings({ softTokenLimit: 9000 });
    store.updateSettings({ maxRetries: 5 });

    const settings = store.getSettings();
    expect(settings.uiTheme).toBe('light');
    expect(settings.language).toBe('en');
    expect(settings.softTokenLimit).toBe(9000);
    expect(settings.maxRetries).toBe(5);
    // Unchanged fields still at defaults
    expect(settings.hardTokenLimit).toBe(DEFAULT_SETTINGS.hardTokenLimit);
    expect(settings.phaseTimeoutMs).toBe(DEFAULT_SETTINGS.phaseTimeoutMs);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// Secret Store
// ═════════════════════════════════════════════════════════════════════════

describe('Config Three-Layer — Secret Store', () => {
  let tmpDir: string;
  let adapter: SafeStorageAdapter;

  beforeEach(() => {
    tmpDir = createTmpDir('config-secrets-');
    adapter = createMockAdapter();
  });

  afterEach(() => {
    removeTmpDir(tmpDir);
  });

  it('set then get returns the original value', () => {
    const store = new SecretStore(tmpDir, adapter);
    store.setSecret('api-key', 'sk-super-secret-value');

    expect(store.getSecret('api-key')).toBe('sk-super-secret-value');
  });

  it('set then delete then get returns null', () => {
    const store = new SecretStore(tmpDir, adapter);
    store.setSecret('temp-key', 'temp-value');
    expect(store.getSecret('temp-key')).toBe('temp-value');

    store.deleteSecret('temp-key');
    expect(store.getSecret('temp-key')).toBeNull();
  });

  it('list-keys returns all set keys', () => {
    const store = new SecretStore(tmpDir, adapter);
    store.setSecret('key-a', 'val-a');
    store.setSecret('key-b', 'val-b');
    store.setSecret('key-c', 'val-c');

    const keys = store.listKeys();
    expect(keys).toHaveLength(3);
    expect(keys).toContain('key-a');
    expect(keys).toContain('key-b');
    expect(keys).toContain('key-c');
  });

  it('encryption/decryption roundtrip: value is encrypted on disk', () => {
    const store = new SecretStore(tmpDir, adapter);
    store.setSecret('encrypted-key', 'plaintext-value-123');

    // Read the raw file — should NOT contain the plaintext
    const raw = fs.readFileSync(store.getFilePath(), 'utf-8');
    expect(raw).not.toContain('plaintext-value-123');

    // But decryption should yield the original
    expect(store.getSecret('encrypted-key')).toBe('plaintext-value-123');
  });
});

// ═════════════════════════════════════════════════════════════════════════
// ConfigServiceImpl — 3-Layer Integration
// ═════════════════════════════════════════════════════════════════════════

describe('Config Three-Layer — ConfigServiceImpl', () => {
  let tmpDir: string;
  let adapter: SafeStorageAdapter;

  beforeEach(() => {
    tmpDir = createTmpDir('config-3layer-');
    adapter = createMockAdapter();
  });

  afterEach(() => {
    removeTmpDir(tmpDir);
  });

  function createService(): ConfigServiceImpl {
    return new ConfigServiceImpl({
      settingsDir: tmpDir,
      secretsDir: tmpDir,
      safeStorageAdapter: adapter,
    });
  }

  it('3-layer: settings layer returns defaults initially', () => {
    const svc = createService();
    expect(svc.getSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('3-layer: get() resolves from settings when no runtime override', () => {
    const svc = createService();
    expect(svc.get('uiTheme')).toBe('dark');
    expect(svc.get('language')).toBe('ko');
    expect(svc.get('defaultRounds')).toBe(3);
  });

  it('3-layer: runtime override does not affect persisted settings', () => {
    const svc = createService();
    svc.updateSettings({ uiTheme: 'light' });
    svc.setRuntime({ debugMode: true });

    // Persisted settings are unchanged by runtime
    const settings = svc.getSettings();
    expect(settings.uiTheme).toBe('light');

    // Runtime does not leak into settings
    expect(JSON.stringify(settings)).not.toContain('debugMode');

    // Clear runtime, persisted settings still intact
    svc.clearRuntime();
    expect(svc.get('uiTheme')).toBe('light');
  });

  it('3-layer: settings file persistence (write to temp, reload)', () => {
    const svc1 = createService();
    svc1.updateSettings({ uiTheme: 'light', language: 'en' });

    // Create a new service instance — forces disk reload
    const svc2 = createService();
    const settings = svc2.getSettings();

    expect(settings.uiTheme).toBe('light');
    expect(settings.language).toBe('en');
    // Unmodified fields from defaults
    expect(settings.defaultRounds).toBe(DEFAULT_SETTINGS.defaultRounds);
  });

  it('3-layer: default values for all required settings fields', () => {
    const svc = createService();
    const settings = svc.getSettings();

    // Top-level fields
    expect(settings.version).toBe(1);
    expect(settings.uiTheme).toBe('dark');
    expect(settings.language).toBe('ko');
    expect(settings.defaultRounds).toBe(3);
    expect(settings.softTokenLimit).toBe(3000);
    expect(settings.hardTokenLimit).toBe(4000);
    expect(settings.maxRetries).toBe(3);
    expect(settings.phaseTimeoutMs).toBe(60_000);
    expect(settings.aggregatorStrategy).toBe('strongest');
    expect(settings.designatedAggregatorId).toBe('');
    expect(settings.arenaGitManagementEnabled).toBe(false);

    // Nested memorySettings
    expect(settings.memorySettings.enabled).toBe(true);
    expect(settings.memorySettings.embeddingProviderId).toBeNull();
    expect(settings.memorySettings.vectorSearchEnabled).toBe(false);
    expect(settings.memorySettings.contextBudget).toBe(4096);
    expect(settings.memorySettings.retrievalLimit).toBe(10);
    expect(settings.memorySettings.reflectionThreshold).toBe(10);
    expect(settings.memorySettings.embeddingModel).toBe('text-embedding-3-small');

    // Nested conversationTask
    expect(settings.conversationTask.deepDebateTurnBudget).toBe(30);
    expect(settings.conversationTask.aiDecisionParseRetryLimit).toBe(2);
    expect(settings.conversationTask.twoParticipantUnanimousRequired).toBe(true);
    expect(settings.conversationTask.majorityAllowedFromParticipants).toBe(3);
  });

  it('3-layer: secrets are independent from settings', () => {
    const svc = createService();

    svc.setSecret('api-key', 'secret-value');
    svc.updateSettings({ uiTheme: 'light' });

    // Settings should not contain secrets
    const settings = svc.getSettings();
    expect(JSON.stringify(settings)).not.toContain('secret-value');

    // Secret keys should not contain settings keys
    const keys = svc.listSecretKeys();
    expect(keys).not.toContain('uiTheme');
    expect(keys).toContain('api-key');
  });

  it('3-layer: runtime overrides are lost on new service instance', () => {
    const svc1 = createService();
    svc1.setRuntime({ debugMode: true, logLevel: 'debug' });
    expect(svc1.getRuntime().debugMode).toBe(true);

    // New instance should have no runtime overrides
    const svc2 = createService();
    expect(svc2.getRuntime()).toEqual({});
  });
});
