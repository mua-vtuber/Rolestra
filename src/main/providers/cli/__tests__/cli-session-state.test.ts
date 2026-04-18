import { describe, it, expect, beforeEach } from 'vitest';
import { CliSessionState } from '../cli-session-state';
import type { CliRuntimeConfig } from '../cli-provider';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<CliRuntimeConfig> = {}): CliRuntimeConfig {
  return {
    command: 'test-cli',
    args: [],
    inputFormat: 'pipe',
    outputFormat: 'stream-json',
    sessionStrategy: 'per-turn',
    hangTimeout: { first: 5000, subsequent: 3000 },
    ...overrides,
  };
}

// ===========================================================================
// constructor (initial state)
// ===========================================================================

describe('CliSessionState constructor', () => {
  it('creates state with null sessionId', () => {
    const state = new CliSessionState();
    expect(state.sessionId).toBeNull();
  });

  it('creates state with rateLimited false', () => {
    const state = new CliSessionState();
    expect(state.rateLimited).toBe(false);
  });

  it('creates state with warmedUp false', () => {
    const state = new CliSessionState();
    expect(state.warmedUp).toBe(false);
  });

  it('creates state with isFirstResponse true', () => {
    const state = new CliSessionState();
    expect(state.isFirstResponse).toBe(true);
  });
});

// ===========================================================================
// sessionId get/set
// ===========================================================================

describe('sessionId', () => {
  let state: CliSessionState;

  beforeEach(() => {
    state = new CliSessionState();
  });

  it('returns null initially', () => {
    expect(state.sessionId).toBeNull();
  });

  it('sets and retrieves a session ID', () => {
    state.sessionId = 'sess-abc';
    expect(state.sessionId).toBe('sess-abc');
  });

  it('overwrites existing session ID', () => {
    state.sessionId = 'first';
    state.sessionId = 'second';
    expect(state.sessionId).toBe('second');
  });

  it('clears session ID by setting null', () => {
    state.sessionId = 'to-clear';
    state.sessionId = null;
    expect(state.sessionId).toBeNull();
  });
});

// ===========================================================================
// clearSession
// ===========================================================================

describe('clearSession', () => {
  it('clears the session ID', () => {
    const state = new CliSessionState();
    state.sessionId = 'sess-xyz';
    state.clearSession();
    expect(state.sessionId).toBeNull();
  });
});

// ===========================================================================
// resetForTurn
// ===========================================================================

describe('resetForTurn', () => {
  it('resets rateLimited to false', () => {
    const state = new CliSessionState();
    state.rateLimited = true;
    state.resetForTurn();
    expect(state.rateLimited).toBe(false);
  });

  it('resets isFirstResponse to true', () => {
    const state = new CliSessionState();
    state.isFirstResponse = false;
    state.resetForTurn();
    expect(state.isFirstResponse).toBe(true);
  });

  it('preserves sessionId', () => {
    const state = new CliSessionState();
    state.sessionId = 'keep-me';
    state.rateLimited = true;
    state.resetForTurn();
    expect(state.sessionId).toBe('keep-me');
  });

  it('preserves warmedUp', () => {
    const state = new CliSessionState();
    state.warmedUp = true;
    state.resetForTurn();
    expect(state.warmedUp).toBe(true);
  });
});

// ===========================================================================
// getHangTimeout
// ===========================================================================

describe('getHangTimeout', () => {
  it('returns first timeout on first call', () => {
    const state = new CliSessionState();
    const config = makeConfig({ hangTimeout: { first: 10000, subsequent: 5000 } });
    expect(state.getHangTimeout(config)).toBe(10000);
  });

  it('returns subsequent timeout after first call', () => {
    const state = new CliSessionState();
    const config = makeConfig({ hangTimeout: { first: 10000, subsequent: 5000 } });
    state.getHangTimeout(config); // first call
    expect(state.getHangTimeout(config)).toBe(5000);
  });

  it('returns rateLimitTimeout when rate-limited', () => {
    const state = new CliSessionState();
    state.rateLimited = true;
    const config = makeConfig({
      hangTimeout: { first: 10000, subsequent: 5000 },
      rateLimitTimeout: 60000,
    });
    expect(state.getHangTimeout(config)).toBe(60000);
  });

  it('falls back to normal timeout when rate-limited but no rateLimitTimeout configured', () => {
    const state = new CliSessionState();
    state.rateLimited = true;
    const config = makeConfig({ hangTimeout: { first: 10000, subsequent: 5000 } });
    expect(state.getHangTimeout(config)).toBe(10000);
  });

  it('advances isFirstResponse to false after first call', () => {
    const state = new CliSessionState();
    const config = makeConfig();
    expect(state.isFirstResponse).toBe(true);
    state.getHangTimeout(config);
    expect(state.isFirstResponse).toBe(false);
  });
});

// ===========================================================================
// full reset (manual property reset to match fresh state)
// ===========================================================================

describe('full state reset', () => {
  it('can be manually reset to match a fresh instance', () => {
    const state = new CliSessionState();
    state.sessionId = 'active-session';
    state.rateLimited = true;
    state.warmedUp = true;
    state.isFirstResponse = false;

    // Reset all fields
    state.clearSession();
    state.resetForTurn();
    state.warmedUp = false;

    const fresh = new CliSessionState();
    expect(state.sessionId).toEqual(fresh.sessionId);
    expect(state.rateLimited).toEqual(fresh.rateLimited);
    expect(state.warmedUp).toEqual(fresh.warmedUp);
    expect(state.isFirstResponse).toEqual(fresh.isFirstResponse);
  });
});
