/**
 * Whisper thread order for the observer view (spec 2026-10-01 F2-8).
 *
 * A thread is a root whisper plus its alternating replies; every reply
 * points at the root (`whisper.replyToMessageId`) and carries its position
 * (`whisper.threadSeq`: root 1, replies 2, 3, ...). Rows of one thread are
 * stored back to back, but several can share a millisecond timestamp, so
 * the rows of each thread are put in position order inside the places the
 * thread already occupies. Every other row keeps its place.
 */
import type { Message as ChannelMessage } from '../../../shared/message-types';

interface ThreadRow { message: ChannelMessage; seq: number }
interface ThreadPlaces { slots: number[]; rows: ThreadRow[] }

export function inWhisperThreadOrder(messages: readonly ChannelMessage[]): ChannelMessage[] {
  const threads = new Map<string, ThreadPlaces>();
  messages.forEach((message, index) => {
    const whisper = message.visibility === 'whisper' ? message.whisper : undefined;
    if (!whisper) return;
    const root = whisper.replyToMessageId ?? message.id;
    const places = threads.get(root) ?? { slots: [], rows: [] };
    places.slots.push(index);
    places.rows.push({ message, seq: whisper.threadSeq });
    threads.set(root, places);
  });
  const ordered = [...messages];
  for (const { slots, rows } of threads.values()) {
    if (rows.length < 2) continue;
    const byPosition = [...rows].sort((a, b) => a.seq - b.seq);
    byPosition.forEach((row, position) => {
      const slot = slots[position];
      if (slot !== undefined) ordered[slot] = row.message;
    });
  }
  return ordered;
}
