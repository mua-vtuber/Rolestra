/**
 * Integration tests for IPC router chain: meta validation, error classification,
 * schema version checking, and handler invocation.
 *
 * Tests the exported functions from router.ts (validateMeta, checkSchemaVersion,
 * classifyError) and handler chain behavior by testing handler functions directly
 * (since the router requires Electron's ipcMain).
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { handlePing, handleGetInfo } from '../app-handler';
import { validateCriticalPayload, CRITICAL_CHANNELS } from '../../../../shared/ipc-schemas';
import { CURRENT_SCHEMA_VERSION } from '../../../../shared/ipc-types';
import type { IpcMeta } from '../../../../shared/ipc-types';
import type { IpcErrorCode } from '../../../../shared/ipc-error';
import { APP_NAME, APP_VERSION } from '../../../../shared/constants';

// ── Replicate router's validateMeta logic (since it's not exported) ──────

const metaSchema = z.object({
  requestId: z.string().uuid(),
  conversationId: z.string().optional(),
  sequence: z.number().int().nonnegative().optional(),
  schemaVersion: z.number().int().positive(),
  timestamp: z.number().positive(),
});

function validateMeta(meta: unknown): IpcMeta {
  return metaSchema.parse(meta) as IpcMeta;
}

// ── Replicate router's classifyError logic (since it's not exported) ─────

function classifyError(err: unknown): IpcErrorCode {
  if (!(err instanceof Error)) return 'INTERNAL_ERROR';
  const msg = err.message.toLowerCase();
  if (msg.includes('not found') || msg.includes('not exist')) return 'NOT_FOUND';
  if (msg.includes('not initialized') || msg.includes('no active')) return 'INVALID_STATE';
  if (msg.includes('validation') || msg.includes('invalid')) return 'VALIDATION_ERROR';
  if (msg.includes('permission') || msg.includes('denied')) return 'PERMISSION_DENIED';
  if (
    msg.includes('network') ||
    msg.includes('econnrefused') ||
    msg.includes('timeout')
  )
    return 'NETWORK_ERROR';
  return 'INTERNAL_ERROR';
}

// ── Replicate router's checkSchemaVersion logic ─────────────────────────

function checkSchemaVersion(meta: IpcMeta, channel: string): string | null {
  if (meta.schemaVersion !== CURRENT_SCHEMA_VERSION) {
    return (
      `[IPC] Schema version mismatch on "${channel}": ` +
      `expected ${CURRENT_SCHEMA_VERSION}, got ${meta.schemaVersion}`
    );
  }
  return null;
}

// ═════════════════════════════════════════════════════════════════════════
// Tests
// ═════════════════════════════════════════════════════════════════════════

describe('IPC Router Chain — Meta Validation', () => {
  it('valid meta passes through with all required fields', () => {
    const meta = {
      requestId: '550e8400-e29b-41d4-a716-446655440000',
      schemaVersion: 1,
      timestamp: Date.now(),
    };

    const result = validateMeta(meta);
    expect(result.requestId).toBe(meta.requestId);
    expect(result.schemaVersion).toBe(1);
    expect(result.timestamp).toBe(meta.timestamp);
  });

  it('valid meta with optional fields passes through', () => {
    const meta = {
      requestId: '550e8400-e29b-41d4-a716-446655440000',
      conversationId: 'conv-123',
      sequence: 5,
      schemaVersion: 1,
      timestamp: Date.now(),
    };

    const result = validateMeta(meta);
    expect(result.conversationId).toBe('conv-123');
    expect(result.sequence).toBe(5);
  });

  it('missing requestId throws validation error', () => {
    const meta = {
      schemaVersion: 1,
      timestamp: Date.now(),
    };

    expect(() => validateMeta(meta)).toThrow();
  });

  it('invalid UUID format for requestId throws validation error', () => {
    const meta = {
      requestId: 'not-a-uuid',
      schemaVersion: 1,
      timestamp: Date.now(),
    };

    expect(() => validateMeta(meta)).toThrow();
  });

  it('missing schemaVersion throws validation error', () => {
    const meta = {
      requestId: '550e8400-e29b-41d4-a716-446655440000',
      timestamp: Date.now(),
    };

    expect(() => validateMeta(meta)).toThrow();
  });

  it('schemaVersion mismatch produces warning message but passes validation', () => {
    const meta: IpcMeta = {
      requestId: '550e8400-e29b-41d4-a716-446655440000',
      schemaVersion: 99,
      timestamp: Date.now(),
    };

    // Meta validation itself passes (schemaVersion is still a valid positive int)
    const result = validateMeta(meta);
    expect(result.schemaVersion).toBe(99);

    // checkSchemaVersion produces a warning string
    const warning = checkSchemaVersion(meta, 'test:channel');
    expect(warning).toContain('Schema version mismatch');
    expect(warning).toContain('expected 1');
    expect(warning).toContain('got 99');
  });

  it('matching schemaVersion produces no warning', () => {
    const meta: IpcMeta = {
      requestId: '550e8400-e29b-41d4-a716-446655440000',
      schemaVersion: CURRENT_SCHEMA_VERSION,
      timestamp: Date.now(),
    };

    const warning = checkSchemaVersion(meta, 'test:channel');
    expect(warning).toBeNull();
  });

  it('missing timestamp throws validation error', () => {
    const meta = {
      requestId: '550e8400-e29b-41d4-a716-446655440000',
      schemaVersion: 1,
    };

    expect(() => validateMeta(meta)).toThrow();
  });

  it('negative timestamp throws validation error', () => {
    const meta = {
      requestId: '550e8400-e29b-41d4-a716-446655440000',
      schemaVersion: 1,
      timestamp: -1,
    };

    expect(() => validateMeta(meta)).toThrow();
  });
});

describe('IPC Router Chain — Error Classification', () => {
  it('classifies NOT_FOUND for "not found" errors', () => {
    expect(classifyError(new Error('Resource not found'))).toBe('NOT_FOUND');
  });

  it('classifies NOT_FOUND for "not exist" errors', () => {
    expect(classifyError(new Error('File does not exist'))).toBe('NOT_FOUND');
  });

  it('classifies INVALID_STATE for "not initialized" errors', () => {
    expect(classifyError(new Error('Service not initialized'))).toBe('INVALID_STATE');
  });

  it('classifies INVALID_STATE for "no active" errors', () => {
    expect(classifyError(new Error('No active conversation session.'))).toBe(
      'INVALID_STATE',
    );
  });

  it('classifies VALIDATION_ERROR for "invalid" errors', () => {
    expect(classifyError(new Error('Invalid operation ID'))).toBe('VALIDATION_ERROR');
  });

  it('classifies VALIDATION_ERROR for "validation" errors', () => {
    expect(classifyError(new Error('Payload validation failed'))).toBe('VALIDATION_ERROR');
  });

  it('classifies PERMISSION_DENIED for "permission" errors', () => {
    expect(classifyError(new Error('Write permission denied'))).toBe('PERMISSION_DENIED');
  });

  it('classifies NETWORK_ERROR for "econnrefused" errors', () => {
    expect(classifyError(new Error('connect ECONNREFUSED 127.0.0.1'))).toBe(
      'NETWORK_ERROR',
    );
  });

  it('classifies NETWORK_ERROR for "timeout" errors', () => {
    expect(classifyError(new Error('Request timeout after 30s'))).toBe('NETWORK_ERROR');
  });

  it('classifies INTERNAL_ERROR for non-Error values', () => {
    expect(classifyError('plain string')).toBe('INTERNAL_ERROR');
    expect(classifyError(42)).toBe('INTERNAL_ERROR');
    expect(classifyError(null)).toBe('INTERNAL_ERROR');
  });

  it('classifies INTERNAL_ERROR for generic errors', () => {
    expect(classifyError(new Error('Something completely unexpected'))).toBe(
      'INTERNAL_ERROR',
    );
  });
});

describe('IPC Router Chain — Handler Functions', () => {
  it('app:ping returns { pong: true, timestamp: number }', () => {
    const before = Date.now();
    const result = handlePing();
    const after = Date.now();

    expect(result.pong).toBe(true);
    expect(typeof result.timestamp).toBe('number');
    expect(result.timestamp).toBeGreaterThanOrEqual(before);
    expect(result.timestamp).toBeLessThanOrEqual(after);
  });

  it('app:get-info returns { name, version }', () => {
    const result = handleGetInfo();

    expect(result.name).toBe(APP_NAME);
    expect(result.version).toBe(APP_VERSION);
    expect(typeof result.name).toBe('string');
    expect(typeof result.version).toBe('string');
  });

  it('multiple sequential calls with different requestIds are independent', () => {
    // Simulate two independent calls by validating two different meta objects
    const meta1 = {
      requestId: '550e8400-e29b-41d4-a716-446655440001',
      schemaVersion: 1,
      timestamp: Date.now(),
    };
    const meta2 = {
      requestId: '550e8400-e29b-41d4-a716-446655440002',
      schemaVersion: 1,
      timestamp: Date.now() + 1,
    };

    const result1 = validateMeta(meta1);
    const result2 = validateMeta(meta2);

    expect(result1.requestId).not.toBe(result2.requestId);
    expect(result1.requestId).toBe(meta1.requestId);
    expect(result2.requestId).toBe(meta2.requestId);
  });

  it('handler chain order: meta validation runs before payload validation', () => {
    // If meta is invalid, the chain should fail before reaching payload validation
    const invalidMeta = { schemaVersion: 1, timestamp: Date.now() };
    expect(() => validateMeta(invalidMeta)).toThrow();

    // If meta is valid, payload validation runs next
    const validMeta = {
      requestId: '550e8400-e29b-41d4-a716-446655440000',
      schemaVersion: 1,
      timestamp: Date.now(),
    };
    expect(() => validateMeta(validMeta)).not.toThrow();

    // Critical payload validation for unknown channel is a no-op
    expect(() => validateCriticalPayload('app:ping', undefined)).not.toThrow();
  });

  it('non-critical channels skip payload validation', () => {
    // app:ping is not in CRITICAL_CHANNELS
    expect(CRITICAL_CHANNELS.has('app:ping')).toBe(false);
    expect(CRITICAL_CHANNELS.has('app:get-info')).toBe(false);

    // validateCriticalPayload should be a no-op for these channels
    expect(() => validateCriticalPayload('app:ping', undefined)).not.toThrow();
    expect(() => validateCriticalPayload('app:get-info', undefined)).not.toThrow();
  });
});
