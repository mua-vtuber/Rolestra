import { beforeEach, describe, expect, it } from 'vitest';

import { channelBusy, channelHasActivity, useChatActivityStore } from '../chat-activity-store';

beforeEach(() => useChatActivityStore.getState().reset());

describe('chat activity store (spec 2026-10-01 F5)', () => {
  it('keeps one live entry per provider and channel, and drops it on idle', () => {
    const { apply } = useChatActivityStore.getState();
    apply({ channelId: 'room', providerId: 'ai-1', phase: 'queued', kind: 'turn' });
    apply({ channelId: 'room', providerId: 'ai-1', phase: 'writing', kind: 'turn' });
    apply({ channelId: 'other', providerId: 'ai-2', phase: 'writing', kind: 'whisper', peerProviderId: 'ai-3' });

    expect(useChatActivityStore.getState().byChannel).toEqual({
      room: { 'ai-1': { providerId: 'ai-1', phase: 'writing', target: { kind: 'turn' } } },
      other: { 'ai-2': { providerId: 'ai-2', phase: 'writing', target: { kind: 'whisper', peerProviderId: 'ai-3' } } },
    });
    expect(channelHasActivity(useChatActivityStore.getState(), 'room')).toBe(true);

    apply({ channelId: 'room', providerId: 'ai-1', phase: 'idle', kind: 'turn' });
    expect(useChatActivityStore.getState().byChannel.room).toBeUndefined();
    expect(channelHasActivity(useChatActivityStore.getState(), 'room')).toBe(false);
    expect(channelHasActivity(useChatActivityStore.getState(), 'other')).toBe(true);
  });

  it('ignores an idle event for a call it never saw start', () => {
    useChatActivityStore.getState().apply({ channelId: 'room', providerId: 'ai-1', phase: 'idle', kind: 'turn' });
    expect(useChatActivityStore.getState().byChannel).toEqual({});
  });
});

describe('chat round state (QA M1)', () => {
  it('stays busy between one turn\'s idle and the next turn while the round is active', () => {
    const { apply, applyRound } = useChatActivityStore.getState();
    applyRound({ channelId: 'room', active: true });
    apply({ channelId: 'room', providerId: 'ai-1', phase: 'writing', kind: 'turn' });
    apply({ channelId: 'room', providerId: 'ai-1', phase: 'idle', kind: 'turn' });
    expect(channelHasActivity(useChatActivityStore.getState(), 'room')).toBe(false);
    expect(channelBusy(useChatActivityStore.getState(), 'room')).toBe(true);
    expect(channelBusy(useChatActivityStore.getState(), 'other')).toBe(false);

    applyRound({ channelId: 'room', active: false });
    expect(channelBusy(useChatActivityStore.getState(), 'room')).toBe(false);
  });

  it('clears what is still shown for a channel when its round ends (QA m6)', () => {
    const { apply, applyRound } = useChatActivityStore.getState();
    applyRound({ channelId: 'room', active: true });
    apply({ channelId: 'room', providerId: 'ai-1', phase: 'queued', kind: 'turn' });
    applyRound({ channelId: 'room', active: false });
    expect(useChatActivityStore.getState().byChannel).toEqual({});
    expect(channelBusy(useChatActivityStore.getState(), 'room')).toBe(false);
  });

  it('starts from the reloaded list of active rounds', () => {
    useChatActivityStore.getState().setActiveRounds(['room', 'general']);
    expect(channelBusy(useChatActivityStore.getState(), 'room')).toBe(true);
    expect(channelBusy(useChatActivityStore.getState(), 'general')).toBe(true);
    useChatActivityStore.getState().setActiveRounds([]);
    expect(channelBusy(useChatActivityStore.getState(), 'room')).toBe(false);
  });
});
