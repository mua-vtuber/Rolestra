import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SettingsConfig } from '../../../../shared/config-types';
import { DEFAULT_SETTINGS } from '../../../../shared/config-types';

const mockGetSettings = vi.fn(() => ({ ...DEFAULT_SETTINGS }));
const mockUpdateSettings = vi.fn();
const mockSetSecret = vi.fn();
const mockDeleteSecret = vi.fn();
const mockListSecretKeys = vi.fn(() => ['openai-key', 'anthropic-key']);

vi.mock('../../../config/instance', () => ({
  getConfigService: vi.fn(() => ({
    getSettings: mockGetSettings,
    updateSettings: mockUpdateSettings,
    setSecret: mockSetSecret,
    deleteSecret: mockDeleteSecret,
    listSecretKeys: mockListSecretKeys,
  })),
}));

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
import { reconfigureMemoryFacade } from '../../../memory/instance';

describe('config-handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('handleConfigGetSettings', () => {
    it('happy path — returns current settings', () => {
      const result = handleConfigGetSettings();

      expect(result.settings).toEqual(DEFAULT_SETTINGS);
      expect(mockGetSettings).toHaveBeenCalledOnce();
    });
  });

  describe('handleConfigUpdateSettings', () => {
    it('happy path — updates settings and returns updated result', () => {
      const updatedSettings = { ...DEFAULT_SETTINGS, uiTheme: 'light' as const };
      mockGetSettings.mockReturnValueOnce(updatedSettings);

      const result = handleConfigUpdateSettings({ patch: { uiTheme: 'light' } });

      expect(mockUpdateSettings).toHaveBeenCalledWith({ uiTheme: 'light' });
      expect(result.settings.uiTheme).toBe('light');
    });

    it('reconfigures memory facade when memorySettings change', () => {
      const patch: Partial<SettingsConfig> = {
        memorySettings: { ...DEFAULT_SETTINGS.memorySettings, enabled: false },
      };

      handleConfigUpdateSettings({ patch });

      expect(vi.mocked(reconfigureMemoryFacade)).toHaveBeenCalledOnce();
    });

    it('does not reconfigure memory when non-memory settings change', () => {
      handleConfigUpdateSettings({ patch: { uiTheme: 'light' } });

      expect(vi.mocked(reconfigureMemoryFacade)).not.toHaveBeenCalled();
    });

    it('propagates error when memory reconfiguration fails', () => {
      vi.mocked(reconfigureMemoryFacade).mockImplementationOnce(() => {
        throw new Error('Embedding provider not available');
      });

      const patch: Partial<SettingsConfig> = {
        memorySettings: { ...DEFAULT_SETTINGS.memorySettings, vectorSearchEnabled: true },
      };

      expect(() => handleConfigUpdateSettings({ patch })).toThrow(
        /Memory reconfiguration failed/,
      );
    });
  });

  describe('handleConfigSetSecret', () => {
    it('happy path — sets a secret and returns success', () => {
      const result = handleConfigSetSecret({ key: 'openai-key', value: 'sk-test123' });

      expect(mockSetSecret).toHaveBeenCalledWith('openai-key', 'sk-test123');
      expect(result.success).toBe(true);
    });

    it('service throws — propagates error', () => {
      mockSetSecret.mockImplementationOnce(() => {
        throw new Error('safeStorage not available');
      });

      expect(() => handleConfigSetSecret({ key: 'k', value: 'v' })).toThrow(
        'safeStorage not available',
      );
    });
  });

  describe('handleConfigDeleteSecret', () => {
    it('happy path — deletes a secret and returns success', () => {
      const result = handleConfigDeleteSecret({ key: 'openai-key' });

      expect(mockDeleteSecret).toHaveBeenCalledWith('openai-key');
      expect(result.success).toBe(true);
    });
  });

  describe('handleConfigListSecretKeys', () => {
    it('happy path — returns list of secret keys', () => {
      const result = handleConfigListSecretKeys();

      expect(result.keys).toEqual(['openai-key', 'anthropic-key']);
      expect(mockListSecretKeys).toHaveBeenCalledOnce();
    });
  });
});
