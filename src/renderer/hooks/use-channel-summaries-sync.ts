/**
 * Feeds the chat list (`channel-summary-store.ts`) — spec
 * 2026-10-01-messenger-redesign.md R4-4. Mounted once in `App`.
 *
 * Cost model:
 *   - one `channel:list-summaries` read at start (two SQL statements in
 *     main whatever the channel count, `channel-summary-repository.ts`);
 *   - each `stream:channel-message` event patches its own row in memory —
 *     no IPC, O(rows) to find the row;
 *   - a message for a channel the list does not hold yet (a room or DM made
 *     elsewhere), or one that lands while a read is in flight, schedules a
 *     single re-read; further events inside {@link SUMMARY_REFETCH_COALESCE_MS}
 *     join it instead of adding reads;
 *   - channel create / archive / delete (the invalidation bus) re-read once.
 * A burst of N messages in known channels therefore costs N in-memory
 * patches and zero reads.
 *
 * A failed read keeps its error on screen. It is retried when the user asks
 * (`reloadChannelSummaries`, the chat list's retry button) or when the next
 * message arrives — QA Minor 7.
 */
import { useEffect } from 'react';

import { subscribeChannelsInvalidation } from './channel-invalidation-bus';
import { invoke } from '../ipc/invoke';
import { useActiveChannelStore } from '../stores/active-channel-store';
import { useAppViewStore } from '../stores/app-view-store';
import { useChannelSummaryStore } from '../stores/channel-summary-store';
import type { StreamChannelMessagePayload } from '../../shared/stream-events';

/** How long further events may join one scheduled re-read. */
export const SUMMARY_REFETCH_COALESCE_MS = 150;

/** The mounted sync's read, for the chat list's retry button. */
let activeReload: (() => void) | null = null;

/** Reads the chat list again now. Throws when no sync is mounted (nothing would read). */
export function reloadChannelSummaries(): void {
  if (activeReload === null) throw new Error('Channel summaries sync is not mounted');
  activeReload();
}

function toError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason));
}

/** The channel the user is looking at right now, or null (other view, hidden window). */
function viewingChannelId(): string | null {
  if (useAppViewStore.getState().view !== 'messenger') return null;
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return null;
  return useActiveChannelStore.getState().globalChannelId;
}

/** Stores the read marker in main, then zeroes the row if nothing newer came in. */
export async function markChannelRead(channelId: string, messageId: string): Promise<void> {
  await invoke('channel:mark-read', { channelId, messageId });
  useChannelSummaryStore.getState().clearUnread(channelId, messageId);
}

export function useChannelSummariesSync(): void {
  useEffect(() => {
    const store = useChannelSummaryStore.getState();
    let alive = true;
    let sequence = 0;
    let fetching = false;
    let missedWhileFetching = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const scheduleRead = (): void => {
      if (timer !== null) return;
      timer = setTimeout(() => {
        timer = null;
        void read();
      }, SUMMARY_REFETCH_COALESCE_MS);
    };

    const read = async (): Promise<void> => {
      const mine = ++sequence;
      fetching = true;
      missedWhileFetching = false;
      store.setLoading(true);
      try {
        const { summaries } = await invoke('channel:list-summaries', undefined);
        if (!alive || mine !== sequence) return;
        store.setSummaries(summaries);
      } catch (reason) {
        if (!alive || mine !== sequence) return;
        store.setError(toError(reason));
      } finally {
        if (alive && mine === sequence) {
          fetching = false;
          store.setLoading(false);
          // A message that arrived mid-read may or may not be in the answer;
          // read again rather than guess (never double-counts).
          if (missedWhileFetching) scheduleRead();
        }
      }
    };

    const onMessage = ({ message }: StreamChannelMessagePayload): void => {
      if (fetching) {
        missedWhileFetching = true;
        return;
      }
      // The first read failed: this event is a reason to try again.
      if (useChannelSummaryStore.getState().summaries === null) {
        scheduleRead();
        return;
      }
      if (!useChannelSummaryStore.getState().applyMessage(message, viewingChannelId())) scheduleRead();
    };

    const onStream = typeof window !== 'undefined' ? window.arena?.onStream : undefined;
    const offMessage = onStream ? onStream('stream:channel-message', onMessage) : undefined;
    const offInvalidation = subscribeChannelsInvalidation(() => read());
    const reload = (): void => { void read(); };
    activeReload = reload;
    void read();
    return () => {
      alive = false;
      if (activeReload === reload) activeReload = null;
      if (timer !== null) clearTimeout(timer);
      offMessage?.();
      offInvalidation();
    };
  }, []);
}
