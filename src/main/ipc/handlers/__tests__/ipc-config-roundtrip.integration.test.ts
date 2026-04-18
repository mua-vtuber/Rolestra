/**
 * Integration tests for config CRUD roundtrip through IPC handler functions.
 *
 * Tests handleConfigGetSettings, handleConfigUpdateSettings, handleConfigSetSecret,
 * handleConfigDeleteSecret, and handleConfigListSecretKeys by mocking the
 * ConfigServiceImpl singleton accessor.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTmpDir, removeTmpDir } from '../../../../test-utils';
import { ConfigServiceImpl } from '../../../config/config-service';
import type { SafeStorageAdapter } from '../../../config/secret-store';
import { DEFAULT_SETTINGS } from '../../../../shared/config-types';

// ── Mock safeStorage adapter ────────────────────────────────────────────

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

// ── Setup: create ConfigServiceImpl and mock getConfigService ───────────

let tmpDir: string;
let service: ConfigServiceImpl;

vi.mock('../../../config/instance', () => ({
  getConfigService: () => service,
}));

// Mock the memory reconfiguration (called when memorySettings change)
vi.mock('../../../memory/instance', () => ({
  reconfigureMemoryFacade: vi.fn(),
}));

import {
  handleConfigGetSettings,
  handleConfigUpdateSettings,
  handleConfigSetSecret,
  handleConfigDeleteSecret,
  handleConfigListSecretKeys,
} from '../config-handler';

// ═════════════════════════════════════════════════════════════════════════

describe('IPC Config Roundtrip', () => {
  beforeEach(() => {
    tmpDir = createTmpDir('ipc-config-roundtrip-');
    service = new ConfigServiceImpl({
      settingsDir: tmpDir,
      secretsDir: tmpDir,
      safeStorageAdapter: createMockAdapter(),
    });
  });

  afterEach(() => {
    removeTmpDir(tmpDir);
  });

  it('config:get-settings returns default settings on fresh start', () => {
    const result = handleConfigGetSettings();
    expect(result.settings).toEqual(DEFAULT_SETTINGS);
  });

  it('config:update-settings with partial patch merges correctly', () => {
    const result = handleConfigUpdateSettings({
      patch: { uiTheme: 'light', language: 'en' },
    });

    expect(result.settings.uiTheme).toBe('light');
    expect(result.settings.language).toBe('en');
    // Other defaults preserved
    expect(result.settings.defaultRounds).toBe(DEFAULT_SETTINGS.defaultRounds);
    expect(result.settings.version).toBe(DEFAULT_SETTINGS.version);
  });

  it('config:update-settings then config:get-settings reflects changes', () => {
    handleConfigUpdateSettings({
      patch: { softTokenLimit: 5000 },
    });

    const result = handleConfigGetSettings();
    expect(result.settings.softTokenLimit).toBe(5000);
  });

  it('config:set-secret then config:list-secret-keys shows the key', () => {
    handleConfigSetSecret({ key: 'openai-key', value: 'sk-test-123' });

    const result = handleConfigListSecretKeys();
    expect(result.keys).toContain('openai-key');
  });

  it('config:delete-secret then config:list-secret-keys removes the key', () => {
    handleConfigSetSecret({ key: 'temp-key', value: 'temp-value' });
    expect(handleConfigListSecretKeys().keys).toContain('temp-key');

    handleConfigDeleteSecret({ key: 'temp-key' });
    expect(handleConfigListSecretKeys().keys).not.toContain('temp-key');
  });

  it('config:set-secret with invalid key format is rejected by SecretStore', () => {
    // The SecretStore validates keys with /^[a-zA-Z0-9_-]{1,64}$/
    // Keys with dots are allowed by the zod schema but rejected by SecretStore's stricter pattern
    expect(() => handleConfigSetSecret({ key: '', value: 'val' })).toThrow();
  });

  it('multiple settings updates merge correctly without overwriting', () => {
    handleConfigUpdateSettings({ patch: { uiTheme: 'light' } });
    handleConfigUpdateSettings({ patch: { language: 'en' } });
    handleConfigUpdateSettings({ patch: { softTokenLimit: 9999 } });

    const result = handleConfigGetSettings();
    expect(result.settings.uiTheme).toBe('light');
    expect(result.settings.language).toBe('en');
    expect(result.settings.softTokenLimit).toBe(9999);
    // Unmodified fields retain defaults
    expect(result.settings.hardTokenLimit).toBe(DEFAULT_SETTINGS.hardTokenLimit);
    expect(result.settings.maxRetries).toBe(DEFAULT_SETTINGS.maxRetries);
  });

  it('settings persist across get calls (cached correctly)', () => {
    handleConfigUpdateSettings({ patch: { uiTheme: 'light' } });

    const result1 = handleConfigGetSettings();
    const result2 = handleConfigGetSettings();

    expect(result1.settings.uiTheme).toBe('light');
    expect(result2.settings.uiTheme).toBe('light');
    expect(result1.settings).toEqual(result2.settings);
  });
});
