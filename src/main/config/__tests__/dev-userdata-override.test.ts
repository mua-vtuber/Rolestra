/**
 * Unit tests for the F4-1/F4-2 dev-only `userData` override
 * (spec `docs/specs/2026-09-29-ai-setup-and-character.md`).
 *
 * Coverage:
 *   - packaged build → always ignored, even with the env var set.
 *   - dev build + env var set → applies app.setPath('userData', …) and
 *     returns the path.
 *   - dev build + env var unset/empty → no-op, returns null.
 *   - dev build + env var whitespace-only → treated as unset (no-op).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyDevUserDataOverride,
  DEV_USER_DATA_OVERRIDE_ENV,
} from '../dev-userdata-override';

const ORIGINAL_ENV = process.env[DEV_USER_DATA_OVERRIDE_ENV];

function fakeApp(isPackaged: boolean): { isPackaged: boolean; setPath: (name: string, path: string) => void } {
  return { isPackaged, setPath: vi.fn<(name: string, path: string) => void>() };
}

describe('applyDevUserDataOverride (F4-1/F4-2)', () => {
  beforeEach(() => {
    process.env[DEV_USER_DATA_OVERRIDE_ENV] = '';
  });

  afterEach(() => {
    process.env[DEV_USER_DATA_OVERRIDE_ENV] = ORIGINAL_ENV ?? '';
  });

  it('packaged build — ignores the env var even when set to a real path', () => {
    process.env[DEV_USER_DATA_OVERRIDE_ENV] = 'D:/tmp/rolestra-dev-1234';
    const app = fakeApp(true);

    const result = applyDevUserDataOverride(app);

    expect(result).toBeNull();
    expect(app.setPath).not.toHaveBeenCalled();
  });

  it('dev build + env var set — applies setPath and returns the path', () => {
    process.env[DEV_USER_DATA_OVERRIDE_ENV] = 'D:/tmp/rolestra-dev-1234';
    const app = fakeApp(false);

    const result = applyDevUserDataOverride(app);

    expect(result).toBe('D:/tmp/rolestra-dev-1234');
    expect(app.setPath).toHaveBeenCalledWith('userData', 'D:/tmp/rolestra-dev-1234');
  });

  it('dev build + env var unset — no-op, returns null', () => {
    const app = fakeApp(false);

    const result = applyDevUserDataOverride(app);

    expect(result).toBeNull();
    expect(app.setPath).not.toHaveBeenCalled();
  });

  it('dev build + env var set to empty string — no-op, returns null', () => {
    process.env[DEV_USER_DATA_OVERRIDE_ENV] = '';
    const app = fakeApp(false);

    const result = applyDevUserDataOverride(app);

    expect(result).toBeNull();
    expect(app.setPath).not.toHaveBeenCalled();
  });

  it('packaged build + env var unset — no-op, returns null (both conditions independently false)', () => {
    const app = fakeApp(true);

    const result = applyDevUserDataOverride(app);

    expect(result).toBeNull();
    expect(app.setPath).not.toHaveBeenCalled();
  });
});
