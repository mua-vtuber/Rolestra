/**
 * Integration tests for critical channel payload validation.
 *
 * Tests zod schemas defined in shared/ipc-schemas.ts for security-sensitive
 * channels: config:set-secret, config:delete-secret, execution:approve,
 * execution:reject, consensus:respond, permission:approve, permission:reject,
 * consensus:set-facilitator, provider:add, provider:remove.
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

describe('Critical Validation — execution:approve', () => {
  const schema = criticalChannelSchemas['execution:approve'];

  it('accepts valid UUID operationId', () => {
    const data = { operationId: '550e8400-e29b-41d4-a716-446655440000' };
    expect(() => schema.parse(data)).not.toThrow();
  });

  it('rejects missing operationId', () => {
    expect(() => schema.parse({})).toThrow(ZodError);
  });

  it('rejects non-UUID operationId', () => {
    expect(() => schema.parse({ operationId: 'not-a-uuid' })).toThrow(ZodError);
  });

  it('rejects empty string operationId', () => {
    expect(() => schema.parse({ operationId: '' })).toThrow(ZodError);
  });
});

describe('Critical Validation — execution:reject', () => {
  const schema = criticalChannelSchemas['execution:reject'];

  it('accepts valid UUID operationId', () => {
    const data = { operationId: '550e8400-e29b-41d4-a716-446655440000' };
    expect(() => schema.parse(data)).not.toThrow();
  });

  it('rejects missing operationId', () => {
    expect(() => schema.parse({})).toThrow(ZodError);
  });

  it('rejects non-UUID operationId', () => {
    expect(() => schema.parse({ operationId: 'invalid' })).toThrow(ZodError);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// consensus:respond
// ═════════════════════════════════════════════════════════════════════════

describe('Critical Validation — consensus:respond', () => {
  const schema = criticalChannelSchemas['consensus:respond'];

  it('accepts AGREE decision', () => {
    expect(() => schema.parse({ decision: 'AGREE' })).not.toThrow();
  });

  it('accepts DISAGREE decision', () => {
    expect(() => schema.parse({ decision: 'DISAGREE' })).not.toThrow();
  });

  it('accepts ABORT decision', () => {
    expect(() => schema.parse({ decision: 'ABORT' })).not.toThrow();
  });

  it('accepts BLOCK decision with blockReasonType', () => {
    const data = { decision: 'BLOCK', blockReasonType: 'security' };
    expect(() => schema.parse(data)).not.toThrow();
  });

  it('rejects BLOCK decision without blockReasonType', () => {
    const data = { decision: 'BLOCK' };
    expect(() => schema.parse(data)).toThrow(ZodError);
  });

  it('rejects blockReasonType on non-BLOCK decision', () => {
    const data = { decision: 'AGREE', blockReasonType: 'security' };
    expect(() => schema.parse(data)).toThrow(ZodError);
  });

  it('rejects invalid decision enum value', () => {
    expect(() => schema.parse({ decision: 'INVALID' })).toThrow(ZodError);
  });

  it('rejects missing decision', () => {
    expect(() => schema.parse({})).toThrow(ZodError);
  });

  it('accepts AGREE with optional comment', () => {
    const data = { decision: 'AGREE', comment: 'Looks good' };
    expect(() => schema.parse(data)).not.toThrow();
  });

  it('rejects comment exceeding 4000 characters', () => {
    const data = { decision: 'AGREE', comment: 'x'.repeat(4001) };
    expect(() => schema.parse(data)).toThrow(ZodError);
  });

  it('accepts BLOCK with all valid blockReasonType values', () => {
    for (const reason of ['security', 'data_loss', 'spec_conflict', 'unknown']) {
      expect(() =>
        schema.parse({ decision: 'BLOCK', blockReasonType: reason }),
      ).not.toThrow();
    }
  });

  it('rejects invalid blockReasonType value', () => {
    const data = { decision: 'BLOCK', blockReasonType: 'invalid_reason' };
    expect(() => schema.parse(data)).toThrow(ZodError);
  });

  it('requires reassignFacilitatorId when failureResolution=reassign', () => {
    const data = { decision: 'AGREE', failureResolution: 'reassign' };
    expect(() => schema.parse(data)).toThrow(ZodError);
  });

  it('accepts failureResolution=reassign with reassignFacilitatorId', () => {
    const data = {
      decision: 'AGREE',
      failureResolution: 'reassign',
      reassignFacilitatorId: 'ai-2',
    };
    expect(() => schema.parse(data)).not.toThrow();
  });

  it('accepts failureResolution=retry without reassignFacilitatorId', () => {
    const data = { decision: 'AGREE', failureResolution: 'retry' };
    expect(() => schema.parse(data)).not.toThrow();
  });

  it('accepts failureResolution=stop without reassignFacilitatorId', () => {
    const data = { decision: 'AGREE', failureResolution: 'stop' };
    expect(() => schema.parse(data)).not.toThrow();
  });
});

// ═════════════════════════════════════════════════════════════════════════
// consensus:set-facilitator
// ═════════════════════════════════════════════════════════════════════════

describe('Critical Validation — consensus:set-facilitator', () => {
  const schema = criticalChannelSchemas['consensus:set-facilitator'];

  it('accepts valid facilitatorId', () => {
    expect(() => schema.parse({ facilitatorId: 'ai-1' })).not.toThrow();
  });

  it('rejects empty facilitatorId', () => {
    expect(() => schema.parse({ facilitatorId: '' })).toThrow(ZodError);
  });

  it('rejects missing facilitatorId', () => {
    expect(() => schema.parse({})).toThrow(ZodError);
  });

  it('rejects facilitatorId exceeding 128 characters', () => {
    expect(() => schema.parse({ facilitatorId: 'a'.repeat(129) })).toThrow(ZodError);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// permission:approve / permission:reject
// ═════════════════════════════════════════════════════════════════════════

describe('Critical Validation — permission:approve', () => {
  const schema = criticalChannelSchemas['permission:approve'];

  it('accepts valid UUID requestId', () => {
    expect(() =>
      schema.parse({ requestId: '550e8400-e29b-41d4-a716-446655440000' }),
    ).not.toThrow();
  });

  it('rejects non-UUID requestId', () => {
    expect(() => schema.parse({ requestId: 'not-uuid' })).toThrow(ZodError);
  });

  it('rejects missing requestId', () => {
    expect(() => schema.parse({})).toThrow(ZodError);
  });
});

describe('Critical Validation — permission:reject', () => {
  const schema = criticalChannelSchemas['permission:reject'];

  it('accepts valid UUID requestId', () => {
    expect(() =>
      schema.parse({ requestId: '550e8400-e29b-41d4-a716-446655440000' }),
    ).not.toThrow();
  });

  it('rejects non-UUID requestId', () => {
    expect(() => schema.parse({ requestId: 'invalid' })).toThrow(ZodError);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// provider:add / provider:remove
// ═════════════════════════════════════════════════════════════════════════

describe('Critical Validation — provider:add', () => {
  const schema = criticalChannelSchemas['provider:add'];

  it('accepts valid provider add payload', () => {
    const data = {
      displayName: 'My Claude',
      config: { type: 'api', endpoint: 'https://api.example.com' },
    };
    expect(() => schema.parse(data)).not.toThrow();
  });

  it('accepts with optional persona', () => {
    const data = {
      displayName: 'My Claude',
      persona: 'You are a helpful assistant.',
      config: { type: 'api' },
    };
    expect(() => schema.parse(data)).not.toThrow();
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
    expect(CRITICAL_CHANNELS.has('execution:approve')).toBe(true);
    expect(CRITICAL_CHANNELS.has('consensus:respond')).toBe(true);
    expect(CRITICAL_CHANNELS.has('permission:approve')).toBe(true);
    expect(CRITICAL_CHANNELS.has('provider:add')).toBe(true);
    expect(CRITICAL_CHANNELS.has('provider:remove')).toBe(true);
  });
});
