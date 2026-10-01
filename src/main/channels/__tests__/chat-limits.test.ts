import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CHAT_HISTORY_LIMIT, CHAT_RESPONSE_MAX_BYTES, CHAT_RESPONSE_TIMEOUT_MS,
} from '../chat-limits';

const MAIN = resolve(__dirname, '..', '..');

// D6: alternate notations for the same numbers, so a copy-paste under a
// different spelling still trips the guard.
const TIME_LITERAL = /\b60_?000\b|\b60\s*\*\s*1000\b|\b6e4\b/i;
const BYTES_LITERAL = /\b64\s*\*\s*1024\b|\b65_?536\b|\b0x10000\b/i;
// D6: the old /\b50\b/ banned the digits "50" anywhere in the file,
// including plain prose — a harmless comment like "waits 50ms" would have
// failed the guard. Narrow this to the shapes the history limit is actually
// copy-pasted in as code (an inline `limit:`/`=` assignment, or the
// `slice(-50)` history-window idiom), not bare digits.
const HISTORY_LITERAL = /\blimit:\s*50\b|=\s*50\b|slice\(-50\)/;
const ALL = [TIME_LITERAL, BYTES_LITERAL, HISTORY_LITERAL];

/** Chat runtime modules that must read the shared limits instead of local copies. */
const GUARDED: Array<{ file: string; importFrom: string; patterns: RegExp[] }> = [
  { file: 'channels/dm-auto-responder.ts', importFrom: './chat-limits', patterns: ALL },
  { file: 'channels/chat-session-coordinator.ts', importFrom: './chat-limits', patterns: ALL },
  { file: 'channels/chat-whisper-output.ts', importFrom: './chat-limits', patterns: ALL },
  { file: 'meetings/chat-vote-service.ts', importFrom: '../channels/chat-limits', patterns: ALL },
  // The message service header documents its unrelated page size (50), so only
  // the whisper byte bound is guarded there.
  { file: 'channels/message-service.ts', importFrom: './chat-limits', patterns: [BYTES_LITERAL] },
];

describe('chat runtime limits (A7)', () => {
  it('defines the response time, response size and history depth once', () => {
    expect(CHAT_RESPONSE_TIMEOUT_MS).toBe(60_000);
    expect(CHAT_RESPONSE_MAX_BYTES).toBe(64 * 1024);
    expect(CHAT_HISTORY_LIMIT).toBe(50);
  });

  it.each(GUARDED)('$file keeps no local copy of a chat limit', ({ file, importFrom, patterns }) => {
    const source = readFileSync(resolve(MAIN, file), 'utf8');
    for (const pattern of patterns) expect(source).not.toMatch(pattern);
    expect(source).toContain(`from '${importFrom}'`);
  });
});

describe('chat limit guard regexes (D6)', () => {
  it('still catches the history limit copy-pasted as code, not just the literal 50', () => {
    expect('const limit: number = 50;').toMatch(HISTORY_LITERAL);
    expect('const CHAT_HISTORY_LIMIT = 50;').toMatch(HISTORY_LITERAL);
    expect('recent.slice(-50)').toMatch(HISTORY_LITERAL);
  });

  it('no longer bans an unrelated "50" in prose or an unrelated numeric literal', () => {
    // The old /\b50\b/ would have failed on every one of these — none of
    // them is a copy-paste of the chat history limit.
    expect('// waits 50ms before the retry').not.toMatch(HISTORY_LITERAL);
    expect('bounded by `limit` (default 50, max 200)').not.toMatch(HISTORY_LITERAL);
    expect('const page = clamp(request.page, 1, 50);').not.toMatch(HISTORY_LITERAL);
  });

  it('catches alternate notations of the 60s response timeout', () => {
    expect('setTimeout(fn, 60_000)').toMatch(TIME_LITERAL);
    expect('setTimeout(fn, 60000)').toMatch(TIME_LITERAL);
    expect('setTimeout(fn, 60 * 1000)').toMatch(TIME_LITERAL);
    expect('const TIMEOUT_MS = 6e4;').toMatch(TIME_LITERAL);
  });

  it('catches alternate notations of the 64KiB response byte bound', () => {
    expect('64 * 1024').toMatch(BYTES_LITERAL);
    expect('65536').toMatch(BYTES_LITERAL);
    expect('65_536').toMatch(BYTES_LITERAL);
    expect('0x10000').toMatch(BYTES_LITERAL);
  });
});
