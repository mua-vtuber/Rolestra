import { describe, expect, it } from 'vitest';
import {
  ARENA_ROOT_ENV,
  buildDevFreshEnv,
  computeDevFreshLayout,
  DEV_USER_DATA_OVERRIDE_ENV,
} from '../paths';

describe('computeDevFreshLayout', () => {
  it('nests userData and arena under one run-scoped folder, distinct from each other', () => {
    const layout = computeDevFreshLayout('/tmp', 'abc123');

    expect(layout.runRoot).toContain('rolestra-dev-fresh-abc123');
    expect(layout.userDataPath.startsWith(layout.runRoot)).toBe(true);
    expect(layout.arenaRootPath.startsWith(layout.runRoot)).toBe(true);
    expect(layout.userDataPath).not.toBe(layout.arenaRootPath);
  });

  it('is deterministic for the same inputs (pure function)', () => {
    const a = computeDevFreshLayout('/tmp', 'same-token');
    const b = computeDevFreshLayout('/tmp', 'same-token');
    expect(a).toEqual(b);
  });

  it('a different token produces a different run folder — no collision between runs', () => {
    const a = computeDevFreshLayout('/tmp', 'token-a');
    const b = computeDevFreshLayout('/tmp', 'token-b');
    expect(a.runRoot).not.toBe(b.runRoot);
  });

  // The chat CLI working folder is fixed at `<ArenaRoot>/consensus`, so the
  // ArenaRoot override alone isolates it — no settings.json pre-write and no
  // separate consensus folder in the layout.
  it('lays out only userData and the arena root under the run folder', () => {
    const layout = computeDevFreshLayout('/tmp', 'layout-keys');

    expect(Object.keys(layout).sort()).toEqual(['arenaRootPath', 'runRoot', 'userDataPath']);
  });
});

describe('buildDevFreshEnv', () => {
  it('layers the two overrides on top of the base env without mutating it', () => {
    const layout = computeDevFreshLayout('/tmp', 'xyz');
    const base = { PATH: '/usr/bin', SOME_OTHER_VAR: 'kept' };

    const env = buildDevFreshEnv(base, layout);

    expect(env.PATH).toBe('/usr/bin');
    expect(env.SOME_OTHER_VAR).toBe('kept');
    expect(env[DEV_USER_DATA_OVERRIDE_ENV]).toBe(layout.userDataPath);
    expect(env[ARENA_ROOT_ENV]).toBe(layout.arenaRootPath);
    // base object itself is untouched — buildDevFreshEnv must not mutate its input.
    expect(base).toEqual({ PATH: '/usr/bin', SOME_OTHER_VAR: 'kept' });
  });

  it('an override in the base env is replaced, never left ambiguous between the two values', () => {
    const layout = computeDevFreshLayout('/tmp', 'override-test');
    const base = { [DEV_USER_DATA_OVERRIDE_ENV]: 'stale-value' };

    const env = buildDevFreshEnv(base, layout);

    expect(env[DEV_USER_DATA_OVERRIDE_ENV]).toBe(layout.userDataPath);
  });
});
