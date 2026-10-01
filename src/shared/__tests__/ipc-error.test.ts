/**
 * QA High-1 (2026-10-01): main's failure cause must reach the renderer.
 * Electron passes only the message of a handler's error, wrapped as
 * "Error invoking remote method '<channel>': <name>: <message>", so the
 * cause travels as a tag inside the message and is read back here.
 */
import { describe, expect, it } from 'vitest';

import { ipcCauseTag, ipcErrorText, readIpcErrorCause } from '../ipc-error';

const transported = (message: string): Error =>
  new Error(`Error invoking remote method 'provider:add-local': IpcError: ${message}`);

describe('IPC error cause', () => {
  it('reads a known cause back from the transported message', () => {
    const error = transported(`[INTERNAL_ERROR] ${ipcCauseTag('local-ai-not-ready')} Ollama is not ready at http://127.0.0.1:11434: not-responding`);
    expect(readIpcErrorCause(error)).toBe('local-ai-not-ready');
    expect(ipcErrorText(error)).toBe('Ollama is not ready at http://127.0.0.1:11434: not-responding');
  });

  it('gives no cause for an unknown tag or an untagged error', () => {
    expect(readIpcErrorCause(transported('[INTERNAL_ERROR] {cause:made-up} boom'))).toBeNull();
    expect(readIpcErrorCause(transported('[INTERNAL_ERROR] database is locked'))).toBeNull();
    expect(readIpcErrorCause('not an error')).toBeNull();
  });

  it('keeps main\'s own message line, without the transport prefixes', () => {
    expect(ipcErrorText(transported('[NETWORK_ERROR] connect ECONNREFUSED 127.0.0.1:11434'))).toBe('connect ECONNREFUSED 127.0.0.1:11434');
    expect(ipcErrorText(new Error('plain failure'))).toBe('plain failure');
    expect(ipcErrorText('text reason')).toBe('text reason');
  });
});
