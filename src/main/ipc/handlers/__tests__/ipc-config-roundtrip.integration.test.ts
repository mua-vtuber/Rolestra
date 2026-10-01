/**
 * Integration tests for config CRUD roundtrip through IPC handler functions.
 *
 * Tests handleConfigUpdateSettings (language only — QA Minor 1),
 * handleConfigSetSecret and handleConfigDeleteSecret against a real
 * ConfigServiceImpl through the mocked singleton accessor. Reads go
 * through the service itself: the renderer no longer has settings-read or
 * secret-list channels.
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

import {
  handleConfigUpdateSettings,
  handleConfigSetSecret,
  handleConfigDeleteSecret,
} from '../config-handler';

// ═════════════════════════════════════════════════════════════════════════

describe('IPC Config Roundtrip', () => {
  beforeEach(() => {
    tmpDir = createTmpDir('config-roundtrip-');
    service = new ConfigServiceImpl({
      settingsDir: tmpDir,
      secretsDir: tmpDir,
      safeStorageAdapter: createMockAdapter(),
    });
  });

  afterEach(() => {
    removeTmpDir(tmpDir);
  });

  it('starts from the default settings', () => {
    expect(service.getSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('config:update-settings changes the language and keeps every other default', () => {
    const result = handleConfigUpdateSettings({ patch: { language: 'en' } });

    expect(result.settings.language).toBe('en');
    expect(result.settings.defaultRounds).toBe(DEFAULT_SETTINGS.defaultRounds);
    expect(result.settings.version).toBe(DEFAULT_SETTINGS.version);
    expect(service.getSettings().language).toBe('en');
  });

  it('config:set-secret then config:delete-secret adds and removes the key', () => {
    handleConfigSetSecret({ key: 'temp-key', value: 'temp-value' });
    expect(service.listSecretKeys()).toContain('temp-key');

    handleConfigDeleteSecret({ key: 'temp-key' });
    expect(service.listSecretKeys()).not.toContain('temp-key');
  });

  it('config:set-secret with invalid key format is rejected by SecretStore', () => {
    expect(() => handleConfigSetSecret({ key: '', value: 'val' })).toThrow();
  });

  it('language updates persist across reads (cached correctly)', () => {
    handleConfigUpdateSettings({ patch: { language: 'en' } });
    handleConfigUpdateSettings({ patch: { language: 'ko' } });

    expect(service.getSettings().language).toBe('ko');
    expect(service.getSettings()).toEqual(service.getSettings());
  });
});
