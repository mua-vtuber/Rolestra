/**
 * Chat list rows in memory (zustand, no persist) — fed by
 * `use-channel-summaries-sync.ts` (one full read, then per-message patches)
 * and read by the chat list. The room view zeroes a row's unread count
 * after it has marked the channel read in main.
 */
import { create } from 'zustand';

import { patchSummary } from '../features/chat-list/summary-patch';
import type { ChannelSummary } from '../../shared/channel-summary-types';
import type { Message } from '../../shared/message-types';

export interface ChannelSummaryState {
  /** `null` until the first `channel:list-summaries` answer. */
  summaries: ChannelSummary[] | null;
  loading: boolean;
  error: Error | null;
  setSummaries: (summaries: ChannelSummary[]) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: Error | null) => void;
  /**
   * Applies one streamed message to its channel's row. Returns false when
   * the channel is not in the list yet (the caller re-reads the list).
   */
  applyMessage: (message: Message, viewingChannelId: string | null) => boolean;
  /**
   * Main stored the read marker at `messageId`. The row's count goes to 0
   * only when that is still the row's newest message; a newer one that
   * arrived meanwhile is marked by the room's next call.
   */
  clearUnread: (channelId: string, messageId: string) => void;
}

export const useChannelSummaryStore = create<ChannelSummaryState>()((set, get) => ({
  summaries: null,
  loading: false,
  error: null,
  setSummaries: (summaries) => set({ summaries, error: null }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  applyMessage: (message, viewingChannelId) => {
    const current = get().summaries;
    if (current === null) return false;
    const row = current.find((summary) => summary.channelId === message.channelId);
    if (row === undefined) return false;
    const patched = patchSummary(row, message, viewingChannelId === message.channelId);
    if (patched !== row) {
      set({ summaries: current.map((summary) => (summary === row ? patched : summary)) });
    }
    return true;
  },
  clearUnread: (channelId, messageId) => {
    const current = get().summaries;
    if (current === null) return;
    const row = current.find((summary) => summary.channelId === channelId);
    if (row === undefined || row.unreadCount === 0) return;
    if (row.lastMessage !== null && row.lastMessage.id !== messageId) return;
    set({ summaries: current.map((summary) => (summary === row ? { ...row, unreadCount: 0 } : summary)) });
  },
}));
