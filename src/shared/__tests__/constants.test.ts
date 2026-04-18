import { describe, it, expect } from 'vitest';
import { APP_NAME, APP_VERSION } from '../constants';

describe('shared/constants', () => {
  it('APP_NAME should be defined as a non-empty string', () => {
    expect(APP_NAME).toBeDefined();
    expect(typeof APP_NAME).toBe('string');
    expect(APP_NAME.length).toBeGreaterThan(0);
  });

  it('APP_NAME should be "AI Chat Arena"', () => {
    expect(APP_NAME).toBe('AI Chat Arena');
  });

  it('APP_VERSION should be defined and follow semver pattern', () => {
    expect(APP_VERSION).toBeDefined();
    expect(typeof APP_VERSION).toBe('string');
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('APP_VERSION should match package.json version', () => {
    expect(APP_VERSION).toBe('0.1.0');
  });
});
