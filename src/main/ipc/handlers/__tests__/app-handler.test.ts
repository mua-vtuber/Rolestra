import { describe, it, expect } from 'vitest';
import { handlePing, handleGetInfo } from '../app-handler';
import { APP_NAME, APP_VERSION } from '../../../../shared/constants';

describe('app-handler', () => {
  describe('handlePing', () => {
    it('happy path — returns pong with timestamp', () => {
      const before = Date.now();
      const result = handlePing();
      const after = Date.now();

      expect(result.pong).toBe(true);
      expect(result.timestamp).toBeGreaterThanOrEqual(before);
      expect(result.timestamp).toBeLessThanOrEqual(after);
    });
  });

  describe('handleGetInfo', () => {
    it('happy path — returns correct app name and version', () => {
      const result = handleGetInfo();

      expect(result.name).toBe(APP_NAME);
      expect(result.version).toBe(APP_VERSION);
    });

    it('name and version match shared constants', () => {
      const result = handleGetInfo();

      expect(result.name).toBe('AI Chat Arena');
      expect(result.version).toBe('0.1.0');
    });
  });
});
