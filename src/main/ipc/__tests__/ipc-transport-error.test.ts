/**
 * QA High-1 (2026-10-01): a handler error crosses IPC as one message line.
 * A known cause (`ipcCause` on the thrown error) travels as a tag the
 * renderer reads back (`shared/ipc-error.ts`); other errors keep their
 * own message.
 */
import { describe, expect, it } from 'vitest';

import { readIpcErrorCause, ipcErrorText } from '../../../shared/ipc-error';
import { DuplicateDisplayNameError } from '../../providers/display-name-uniqueness';
import { LocalAiNotReadyError, LocalModelMissingError } from '../../providers/local/local-ai-errors';
import { toTransportError } from '../ipc-transport-error';

/** What the renderer receives: Electron keeps only the message. */
function received(error: Error): Error {
  return new Error(`Error invoking remote method 'provider:add': ${error.name}: ${error.message}`);
}

describe('toTransportError', () => {
  it('tags a duplicate display name so the renderer can name the cause', () => {
    const transported = toTransportError(new DuplicateDisplayNameError('Claude Code'));
    expect(transported.name).toBe('IpcError');
    expect(readIpcErrorCause(received(transported))).toBe('duplicate-display-name');
    expect(ipcErrorText(received(transported))).toBe('Display name already in use: Claude Code');
  });

  it('tags local AI failures', () => {
    expect(readIpcErrorCause(received(toTransportError(
      new LocalAiNotReadyError('not-responding', 'http://127.0.0.1:11434'),
    )))).toBe('local-ai-not-ready');
    expect(readIpcErrorCause(received(toTransportError(
      new LocalModelMissingError('gemma4:e4b', 'http://127.0.0.1:11434'),
    )))).toBe('local-model-missing');
  });

  it('keeps an untagged error\'s classification and message', () => {
    const transported = toTransportError(new Error('connect ECONNREFUSED 127.0.0.1:11434'));
    expect(transported.message).toBe('[NETWORK_ERROR] connect ECONNREFUSED 127.0.0.1:11434');
    expect(readIpcErrorCause(received(transported))).toBeNull();
  });
});
