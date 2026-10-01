import { afterEach, describe, expect, it } from 'vitest';
import { modelFacingBody } from '../chat-whisper-output';
import { createChatRuntime, publicReply, type ChatRuntime } from './chat-runtime-harness';

const result = {
  voteId: 'private-vote-id', title: 'Visit the forest?',
  counts: { agree: 2, oppose: 1, abstain: 0, failed: 1 },
};
let runtime: ChatRuntime | null = null;
afterEach(() => { runtime?.close(); runtime = null; });

describe('shared vote result model context', () => {
  it('expands a result notice to the proposal and final tally without internal identifiers or extra metadata', () => {
    const body = modelFacingBody({ authorKind: 'user', role: 'user', content: 'vote_result',
      meta: { chatVoteResult: { ...result, participants: [{ displayName: 'SECRET_NAME', opinion: 'SECRET_REASON' }] } } as never });
    expect(body).toContain('Visit the forest?');
    expect(body).toContain('agree: 2');
    expect(body).toContain('oppose: 1');
    expect(body).toContain('abstain: 0');
    expect(body).toContain('unanswered: 1');
    for (const hidden of ['vote_result', 'private-vote-id', 'SECRET_NAME', 'SECRET_REASON']) expect(body).not.toContain(hidden);
  });

  it.each([false, true])('gives API and CLI participants the aggregate notice in one normal round (resume: %s)', async (resume) => {
    const rt = runtime = createChatRuntime({ api: ['alice'], cli: ['bob'] });
    const room = rt.createRoom('Vote room', ['alice', 'bob']);
    if (resume) {
      rt.script('alice', publicReply('opening A'));
      rt.script('bob', publicReply('opening B'));
      await rt.sendUser(room, 'Discuss our destination');
    }
    rt.script('alice', publicReply('reaction A'));
    rt.script('bob', publicReply('reaction B'));
    const message = rt.messages.append({ channelId: room.id, authorId: 'user', authorKind: 'user', role: 'user',
      content: 'vote_result', meta: { chatVoteResult: result } });
    await rt.responder.handle(message, room);

    expect(rt.roundStatus(message.id)).toBe('finished');
    for (const id of ['alice', 'bob']) {
      const calls = rt.callsFor(id);
      expect(calls).toHaveLength(resume ? 2 : 1);
      const context = calls.at(-1)!.messages.map((entry) => entry.content).join('\n');
      expect(context).toContain('Visit the forest?');
      expect(context).toContain('agree: 2');
      expect(context).toContain('unanswered: 1');
      expect(context).not.toContain('private-vote-id');
      expect(context).not.toContain('vote_result');
    }
    expect(rt.callsFor('bob').at(-1)?.resumed).toBe(resume ? `session:${room.id}:bob` : null);
    expect(rt.publicReplies(room.id, 'alice').at(-1)).toBe('reaction A');
    expect(rt.publicReplies(room.id, 'bob').at(-1)).toBe('reaction B');
  });

  it('keeps the stored result code out of search without hiding ordinary vote discussion', () => {
    const rt = runtime = createChatRuntime({ api: ['alice'] });
    const room = rt.createRoom('Vote room', ['alice']);
    rt.messages.append({ channelId: room.id, authorId: 'user', authorKind: 'user', role: 'user',
      content: 'vote_result', meta: { chatVoteResult: result } });
    rt.messages.append({ channelId: room.id, authorId: 'user', authorKind: 'user', role: 'user',
      content: 'Let us vote on the forest' });
    expect(rt.messages.search('vote', { channelId: room.id }).map((hit) => hit.content))
      .toEqual(['Let us vote on the forest']);
    expect(rt.messages.searchWithContext('vote', { channelId: room.id }, { kind: 'observer' }).map((hit) => hit.content))
      .toEqual(['Let us vote on the forest']);
  });
});
