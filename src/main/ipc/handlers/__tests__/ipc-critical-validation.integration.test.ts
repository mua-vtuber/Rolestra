/**
 * Integration tests for critical channel payload validation.
 *
 * Tests zod schemas defined in shared/ipc-schemas.ts for security-sensitive
 * channels: config:set-secret, config:delete-secret, execution:approve,
 * execution:reject, provider:add, provider:remove.
 *
 * R11-Task2 retired the v2 critical schemas (`consensus:respond`,
 * `consensus:set-facilitator`, `permission:approve`, `permission:reject`,
 * `workspace:init`) along with their IPC channels.
 */

import { describe, it, expect } from 'vitest';
import { ZodError } from 'zod';
import {
  criticalChannelSchemas,
  validateCriticalPayload,
  CRITICAL_CHANNELS,
} from '../../../../shared/ipc-schemas';

// ═════════════════════════════════════════════════════════════════════════
// config:set-secret
// ═════════════════════════════════════════════════════════════════════════

describe('Critical Validation — config:set-secret', () => {
  const schema = criticalChannelSchemas['config:set-secret'];

  it('accepts valid payload with key and value', () => {
    const data = { key: 'openai-key', value: 'sk-abc123xyz' };
    expect(() => schema.parse(data)).not.toThrow();
  });

  it('rejects missing key', () => {
    const data = { value: 'sk-abc123xyz' };
    expect(() => schema.parse(data)).toThrow(ZodError);
  });

  it('rejects missing value', () => {
    const data = { key: 'openai-key' };
    expect(() => schema.parse(data)).toThrow(ZodError);
  });

  it('rejects empty string value', () => {
    const data = { key: 'openai-key', value: '' };
    expect(() => schema.parse(data)).toThrow(ZodError);
  });

  it('rejects key with invalid characters (spaces)', () => {
    const data = { key: 'key with spaces', value: 'val' };
    expect(() => schema.parse(data)).toThrow(ZodError);
  });

  it('rejects key with path traversal characters', () => {
    const data = { key: '../etc/passwd', value: 'val' };
    expect(() => schema.parse(data)).toThrow(ZodError);
  });

  it('rejects key exceeding 128 characters', () => {
    const data = { key: 'a'.repeat(129), value: 'val' };
    expect(() => schema.parse(data)).toThrow(ZodError);
  });

  it('accepts key at exactly 128 characters', () => {
    const data = { key: 'a'.repeat(128), value: 'val' };
    expect(() => schema.parse(data)).not.toThrow();
  });

  it('rejects value exceeding 8192 characters', () => {
    const data = { key: 'test-key', value: 'a'.repeat(8193) };
    expect(() => schema.parse(data)).toThrow(ZodError);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// config:delete-secret
// ═════════════════════════════════════════════════════════════════════════

describe('Critical Validation — config:delete-secret', () => {
  const schema = criticalChannelSchemas['config:delete-secret'];

  it('accepts valid key', () => {
    expect(() => schema.parse({ key: 'openai-key' })).not.toThrow();
  });

  it('rejects missing key', () => {
    expect(() => schema.parse({})).toThrow(ZodError);
  });

  it('rejects key with invalid format', () => {
    expect(() => schema.parse({ key: 'key with spaces' })).toThrow(ZodError);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// execution:approve / execution:reject
// ═════════════════════════════════════════════════════════════════════════

describe('Critical Validation — provider:add', () => {
  const schema = criticalChannelSchemas['provider:add'];

  it('accepts valid provider add payload', () => {
    const data = {
      displayName: 'My Claude',
      config: { type: 'api', endpoint: 'https://api.example.com', apiKeyRef: 'api-key', model: 'model-a' },
    };
    expect(() => schema.parse(data)).not.toThrow();
  });

  // F3 (QA defect 1): `provider:add` no longer accepts a `persona` input —
  // the character sheet (MemberProfile.characterSheet) is the only
  // editable persona surface. The schema is a plain z.object (not strict),
  // so a stray `persona` key is silently dropped from the PARSED output
  // rather than rejected — this pins that behavior down explicitly so a
  // future switch to z.strictObject() is a deliberate choice, not an
  // accidental regression this test would otherwise miss.
  it('drops a stray persona field from the parsed output (schema no longer defines it)', () => {
    const data = {
      displayName: 'My Claude',
      persona: 'You are a helpful assistant.',
      config: { type: 'api', endpoint: 'https://api.example.com', apiKeyRef: 'api-key', model: 'model-a' },
    };
    const parsed = schema.parse(data) as Record<string, unknown>;
    expect(parsed).not.toHaveProperty('persona');
  });

  it('rejects empty displayName', () => {
    const data = { displayName: '', config: { type: 'api' } };
    expect(() => schema.parse(data)).toThrow(ZodError);
  });

  it('rejects displayName exceeding 128 characters', () => {
    const data = { displayName: 'a'.repeat(129), config: { type: 'api' } };
    expect(() => schema.parse(data)).toThrow(ZodError);
  });

  it('rejects missing config', () => {
    const data = { displayName: 'Test' };
    expect(() => schema.parse(data)).toThrow(ZodError);
  });

  it('rejects config without type', () => {
    const data = { displayName: 'Test', config: { endpoint: 'http://example.com' } };
    expect(() => schema.parse(data)).toThrow(ZodError);
  });

  it('rejects incomplete or unknown provider configurations before persistence', () => {
    for (const config of [
      { type: 'api', endpoint: 'https://api.example.com' },
      { type: 'api', endpoint: 'https://api.example.com', apiKeyRef: 'api-key', model: '' },
      { type: 'local', baseUrl: 'not a URL', model: 'model-a' },
      { type: 'cli', command: 'claude' },
      { type: 'unknown', model: 'model-a' },
    ]) {
      expect(() => schema.parse({ displayName: 'A', config })).toThrow(ZodError);
    }
  });
});

describe('Critical Validation — provider:remove', () => {
  const schema = criticalChannelSchemas['provider:remove'];

  it('accepts valid id', () => {
    expect(() => schema.parse({ id: 'provider-1' })).not.toThrow();
  });

  it('rejects empty id', () => {
    expect(() => schema.parse({ id: '' })).toThrow(ZodError);
  });

  it('rejects missing id', () => {
    expect(() => schema.parse({})).toThrow(ZodError);
  });

  it('rejects id exceeding 128 characters', () => {
    expect(() => schema.parse({ id: 'x'.repeat(129) })).toThrow(ZodError);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// validateCriticalPayload wrapper
// ═════════════════════════════════════════════════════════════════════════

describe('Critical Validation — validateCriticalPayload', () => {
  it('validates critical channels and throws on invalid payload', () => {
    expect(() => validateCriticalPayload('config:set-secret', {})).toThrow();
  });

  it('skips validation for non-critical channels', () => {
    // app:ping is not critical; even garbage data should pass
    expect(() => validateCriticalPayload('app:ping', { garbage: true })).not.toThrow();
  });

  it('passes for critical channel with valid payload', () => {
    expect(() =>
      validateCriticalPayload('config:set-secret', { key: 'test-key', value: 'val' }),
    ).not.toThrow();
  });

  it('CRITICAL_CHANNELS set contains expected channels', () => {
    expect(CRITICAL_CHANNELS.has('config:set-secret')).toBe(true);
    expect(CRITICAL_CHANNELS.has('execution:approve')).toBe(false);
    expect(CRITICAL_CHANNELS.has('provider:add')).toBe(true);
    expect(CRITICAL_CHANNELS.has('provider:remove')).toBe(true);
    // R11-Task2: the v2 channels below were removed from the schema map.
    expect(CRITICAL_CHANNELS.has('consensus:respond')).toBe(false);
    expect(CRITICAL_CHANNELS.has('permission:approve')).toBe(false);
  });
});
