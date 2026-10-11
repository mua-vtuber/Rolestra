/**
 * Which conversation the app opens when nothing valid is selected (spec
 * 2026-10-08 F1): a restored legacy selection first, then the general
 * channel, then the most recent active chat room — the top of the chat list.
 * With no active conversation the screen shows "대화방이 없어요". While the
 * data to decide is not loaded yet the answer is `wait`; there is no
 * fallback that opens some other conversation instead.
 */
import type { Channel } from '../../../shared/channel-types';
import type { ChannelSummary } from '../../../shared/channel-summary-types';
import { sortByActivity } from './chat-list-model';

export type LandingDecision =
  | { kind: 'wait' }
  | { kind: 'none' }
  | { kind: 'open'; channelId: string };

/** The general channel or a chat room that is not archived. */
export function isActiveConversation(channel: Channel): boolean {
  if (channel.kind === 'system_general') return true;
  return channel.isChatRoom === true && channel.archivedAt === null;
}

export function landingConversation(input: {
  /** `useGlobalChannelLists().authoritative`. */
  channels: readonly Channel[] | null;
  general: Channel | null;
  /** `useChannelSummaryStore` summaries. */
  summaries: readonly ChannelSummary[] | null;
  legacyChannelId: string | null;
}): LandingDecision {
  const { channels, general, summaries, legacyChannelId } = input;
  if (channels === null) return { kind: 'wait' };
  if (legacyChannelId !== null && channels.some((channel) => channel.id === legacyChannelId)) {
    return { kind: 'open', channelId: legacyChannelId };
  }
  if (general !== null) return { kind: 'open', channelId: general.id };
  const candidates = new Set(channels.filter(isActiveConversation).map((channel) => channel.id));
  if (candidates.size === 0) return { kind: 'none' };
  if (summaries === null) return { kind: 'wait' };
  const ranked = sortByActivity(summaries.filter((summary) => candidates.has(summary.channelId)));
  // A room created a moment ago may not have its summary yet: decide on the next update.
  const first = ranked[0];
  return first === undefined ? { kind: 'wait' } : { kind: 'open', channelId: first.channelId };
}
