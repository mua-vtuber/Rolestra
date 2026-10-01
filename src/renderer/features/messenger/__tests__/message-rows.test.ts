import { describe, expect, it } from 'vitest';

import { buildMessageRows } from '../message-rows';
import type { Message } from '../../../../shared/message-types';

const DAY = 24 * 60 * 60 * 1000;
const BASE = new Date(2026, 9, 1, 21, 0).getTime();

function msg(id: string, authorId: string, at: number, extra: Partial<Message> = {}): Message {
  const user = authorId === 'user';
  return {
    id, channelId: 'room', meetingId: null, authorId,
    authorKind: user ? 'user' : 'member', role: user ? 'user' : 'assistant',
    content: id, meta: null, createdAt: at, visibility: 'public', ...extra,
  };
}

function whisper(id: string, authorId: string, recipientId: string, at: number, seq = 1): Message {
  return msg(id, authorId, at, {
    visibility: 'whisper',
    whisper: {
      recipientId, senderName: authorId, recipientName: recipientId, sourceMessageId: 'u0',
      replyToMessageId: seq === 1 ? null : 'w-root', threadSeq: seq,
    },
  });
}

const notice = (id: string, at: number): Message => msg(id, 'ai-a', at, {
  role: 'system', content: 'turn_passed', meta: { chatSilence: { code: 'turn_passed', speakerName: 'A' } },
});

const pass = (id: string, at: number): Message => msg(id, 'user', at, {
  content: 'user_pass', meta: { chatPass: 'user_pass' },
});

describe('buildMessageRows — bubbles', () => {
  it('shows name and avatar only on the first of consecutive messages by one speaker', () => {
    const rows = buildMessageRows([
      msg('u1', 'user', BASE), msg('a1', 'ai-a', BASE + 1), msg('a2', 'ai-a', BASE + 2), msg('b1', 'ai-b', BASE + 3),
    ], 'bubbles');
    expect(rows.map((row) => row.kind)).toEqual(['date', 'message', 'message', 'message', 'message']);
    expect(rows.filter((row) => row.kind === 'message').map((row) => row.kind === 'message' && row.groupStart))
      .toEqual([true, true, false, true]);
  });

  it('breaks a group at a whisper, a notice, a pass row and a new day', () => {
    const rows = buildMessageRows([
      msg('a1', 'ai-a', BASE), whisper('w1', 'ai-a', 'ai-b', BASE + 1), msg('a2', 'ai-a', BASE + 2),
      notice('n1', BASE + 3), msg('a3', 'ai-a', BASE + 4), pass('p1', BASE + 5), msg('a4', 'ai-a', BASE + 6),
      msg('a5', 'ai-a', BASE + DAY),
    ], 'bubbles');
    expect(rows.map((row) => row.kind === 'message' ? `${row.message.id}:${row.groupStart}` : row.kind)).toEqual([
      'date', 'a1:true', 'w1:true', 'a2:true', 'notice', 'a3:true', 'notice', 'a4:true', 'date', 'a5:true',
    ]);
  });
});

describe('buildMessageRows — log', () => {
  it('appends consecutive public lines of one speaker to one block (Main.dc bbsBlocks rule)', () => {
    const rows = buildMessageRows([
      msg('u1', 'user', BASE), msg('u2', 'user', BASE + 1), msg('a1', 'ai-a', BASE + 2), msg('a2', 'ai-a', BASE + 3),
      msg('b1', 'ai-b', BASE + 4),
    ], 'log');
    expect(rows.map((row) => row.kind === 'log-block' ? row.messages.map((m) => m.id).join('+') : row.kind))
      .toEqual(['date', 'u1+u2', 'a1+a2', 'b1']);
  });

  it('never merges a whisper, and a whisper splits the speaker\'s public lines', () => {
    const rows = buildMessageRows([
      msg('a1', 'ai-a', BASE), whisper('w1', 'ai-a', 'ai-b', BASE + 1), whisper('w2', 'ai-a', 'ai-b', BASE + 2, 3),
      msg('a2', 'ai-a', BASE + 3), notice('n1', BASE + 4), msg('a3', 'ai-a', BASE + 5),
    ], 'log');
    expect(rows.map((row) => row.kind === 'log-block' ? row.messages.map((m) => m.id).join('+') : row.kind))
      .toEqual(['date', 'a1', 'w1', 'w2', 'a2', 'notice', 'a3']);
  });

  it('keeps whisper thread rows in thread position order', () => {
    const at = BASE;
    const rows = buildMessageRows([
      { ...whisper('w3', 'ai-a', 'ai-b', at, 3) },
      { ...whisper('w-root', 'ai-a', 'ai-b', at, 1) },
      { ...whisper('w2', 'ai-b', 'ai-a', at, 2) },
    ], 'log');
    expect(rows.filter((row) => row.kind === 'log-block')
      .map((row) => row.kind === 'log-block' ? row.messages[0]!.id : '')).toEqual(['w-root', 'w2', 'w3']);
  });
});
