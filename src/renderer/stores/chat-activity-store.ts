/**
 * Chat writing indicator and round state (spec 2026-10-01 F5, QA M1) —
 * zustand, never persisted.
 *
 * - Activity: main reports each provider call of a chat turn as `queued`,
 *   `writing` and finally `idle` (`stream:chat-activity`). The store keeps
 *   the calls still in progress, per channel and provider; `idle` removes
 *   the entry. The indicator line reads this.
 * - Rounds: main reports whether a channel has a round running or waiting
 *   (`stream:chat-round`), which stays on between turns. A reloaded renderer
 *   starts from `chat:list-active-rounds`. The pass button reads both.
 *
 * When a round ends nothing of it can still be running, so its channel's
 * activity entries go too (a closed room clears at once, QA m6).
 */
import { create } from 'zustand';

import type {
  ChatActivityPhase, ChatActivityTarget, StreamChatActivityPayload, StreamChatRoundPayload,
} from '../../shared/stream-events';

export interface ChatActivityEntry {
  providerId: string;
  phase: Exclude<ChatActivityPhase, 'idle'>;
  target: ChatActivityTarget;
}

export interface ChatActivityState {
  /** channelId → providerId → the call in progress. */
  byChannel: Record<string, Record<string, ChatActivityEntry>>;
  /** Channels whose round is running or waiting. */
  activeRounds: Record<string, true>;
  apply: (payload: StreamChatActivityPayload) => void;
  applyRound: (payload: StreamChatRoundPayload) => void;
  setActiveRounds: (channelIds: readonly string[]) => void;
  reset: () => void;
}

function targetOf(payload: StreamChatActivityPayload): ChatActivityTarget {
  return payload.kind === 'whisper'
    ? { kind: 'whisper', peerProviderId: payload.peerProviderId }
    : { kind: 'turn' };
}

function without<T>(record: Record<string, T>, key: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([entryKey]) => entryKey !== key));
}

export const useChatActivityStore = create<ChatActivityState>()((set) => ({
  byChannel: {},
  activeRounds: {},
  apply: (payload) => set((state) => {
    const current = state.byChannel[payload.channelId] ?? {};
    if (payload.phase === 'idle') {
      if (!(payload.providerId in current)) return state;
      const rest = without(current, payload.providerId);
      const others = without(state.byChannel, payload.channelId);
      return { byChannel: Object.keys(rest).length === 0 ? others : { ...others, [payload.channelId]: rest } };
    }
    return {
      byChannel: {
        ...state.byChannel,
        [payload.channelId]: {
          ...current,
          [payload.providerId]: { providerId: payload.providerId, phase: payload.phase, target: targetOf(payload) },
        },
      },
    };
  }),
  applyRound: ({ channelId, active }) => set((state) => active
    ? { activeRounds: { ...state.activeRounds, [channelId]: true } }
    : { activeRounds: without(state.activeRounds, channelId), byChannel: without(state.byChannel, channelId) }),
  setActiveRounds: (channelIds) => set({
    activeRounds: Object.fromEntries(channelIds.map((channelId) => [channelId, true] as const)),
  }),
  reset: () => set({ byChannel: {}, activeRounds: {} }),
}));

/** True while any call of this channel's round is queued or writing. */
export function channelHasActivity(state: Pick<ChatActivityState, 'byChannel'>, channelId: string): boolean {
  return Object.keys(state.byChannel[channelId] ?? {}).length > 0;
}

/** True while this channel's round runs or waits, including between turns. */
export function channelBusy(state: Pick<ChatActivityState, 'byChannel' | 'activeRounds'>, channelId: string): boolean {
  return channelId in state.activeRounds || channelHasActivity(state, channelId);
}
