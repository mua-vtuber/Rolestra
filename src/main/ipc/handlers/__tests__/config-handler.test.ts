import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DEFAULT_SETTINGS } from '../../../../shared/config-types';

const mockGetSettings = vi.fn(() => ({ ...DEFAULT_SETTINGS }));
const mockUpdateSettings = vi.fn();
const mockSetSecret = vi.fn();
const mockDeleteSecret = vi.fn();

vi.mock('../../../config/instance', () => ({
  getConfigService: vi.fn(() => ({
    getSettings: mockGetSettings,
    updateSettings: mockUpdateSettings,
    setSecret: mockSetSecret,
    deleteSecret: mockDeleteSecret,
  })),
}));

import {
  handleConfigUpdateSettings,
  handleConfigSetSecret,
  handleConfigDeleteSecret,
} from '../config-handler';

describe('config-handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('handleConfigUpdateSettings', () => {
    it('happy path — updates settings and returns updated result', () => {
      const updatedSettings = { ...DEFAULT_SETTINGS, language: 'en' as const };
      mockGetSettings.mockReturnValueOnce(updatedSettings);

      const result = handleConfigUpdateSettings({ patch: { language: 'en' } });

      expect(mockUpdateSettings).toHaveBeenCalledWith({ language: 'en' });
      expect(result.settings.language).toBe('en');
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
});
