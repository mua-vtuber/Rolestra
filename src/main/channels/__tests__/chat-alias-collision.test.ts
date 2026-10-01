/**
 * A participant-alias collision (spec 2026-09-29 §C) is astronomically rare
 * but deterministic for a room, so it must never stop a room silently: the
 * turn that cannot route whispers stores a notice naming the cause and the
 * round goes on with the next member.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

// Only Alice's turn (the sender is the first id handed to participantAliasMap)
// sees Alice and Bob under one alias; every other turn uses the real aliases.
vi.mock('../participant-alias', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../participant-alias')>();
  const colliding = (channelId: string, providerId: string): string =>
    providerId === 'alice' || providerId === 'bob' ? 'p-collision' : actual.participantAlias(channelId, providerId);
  return {
    ...actual,
    participantAliasMap: (channelId: string, providerIds: readonly string[]) =>
      actual.participantAliasMap(channelId, providerIds,
        providerIds[0] === 'alice' ? colliding : actual.participantAlias),
  };
});

import { createChatRuntime, publicReply, type ChatRuntime } from './chat-runtime-harness';

let runtime: ChatRuntime | null = null;
afterEach(() => {
  runtime?.close();
  runtime = null;
});

describe('participant alias collision in a room', () => {
  it('stores a participant_alias_collision notice for that turn and lets the next members run', async () => {
    const rt = runtime = createChatRuntime({ api: ['alice', 'bob'], cli: ['carol'] });
    const room = rt.createRoom('Room', ['alice', 'bob', 'carol']);
    rt.script('bob', publicReply('bob speaks'));
    rt.script('carol', publicReply('carol speaks'));

    await rt.sendUser(room, 'U1');

    const notices = rt.observer(room.id).filter((m) => m.role === 'system' && m.meta?.chatError !== undefined);
    expect(notices.map((m) => [m.authorId, m.meta?.chatError])).toEqual([['alice', 'participant_alias_collision']]);
    expect(rt.callsFor('alice')).toEqual([]);
    expect(rt.publicReplies(room.id, 'bob')).toEqual(['bob speaks']);
    expect(rt.publicReplies(room.id, 'carol')).toEqual(['carol speaks']);
    expect(rt.roundStatus(rt.observer(room.id)[0]!.id)).toBe('finished');
  });
});
