/**
 * How a channel's messages become rows on screen (spec
 * 2026-10-01-messenger-redesign.md R3-2..R3-5).
 *
 * Shared by both layouts:
 *   - whisper threads keep their position order (`whisper-thread-order.ts`);
 *   - a date row starts every new calendar day;
 *   - stored notices (failure, silence, all-silent) and pass rows become
 *     notice rows — never speech.
 *
 * Bubbles: one row per message; `groupStart` marks the first of a run by
 * one speaker, the only one that shows name and avatar. A whisper always
 * starts its own run and ends the previous one.
 *
 * Log: consecutive public messages of one speaker share a block (one name
 * line, then a `└` line each) — the `bbsBlocks` rule of the approved
 * mockup (Main.dc.html). A whisper is always its own block.
 */
import {
  isChatPassMessage,
  isObserverNotice,
  type Message as ChannelMessage,
} from '../../../shared/message-types';
import type { MessageLayout } from '../../theme/theme-tokens';
import { inWhisperThreadOrder } from './whisper-thread-order';

export type MessageRow =
  | { kind: 'date'; key: string; timestamp: number }
  | { kind: 'notice'; key: string; message: ChannelMessage }
  | { kind: 'message'; key: string; message: ChannelMessage; groupStart: boolean }
  | { kind: 'log-block'; key: string; messages: ChannelMessage[] };

function dayKey(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

export function isNoticeRow(message: ChannelMessage): boolean {
  return message.authorKind === 'system' || isObserverNotice(message) || isChatPassMessage(message);
}

function isWhisper(message: ChannelMessage): boolean {
  return message.visibility === 'whisper';
}

function sameSpeaker(a: ChannelMessage, b: ChannelMessage): boolean {
  return a.authorId === b.authorId && a.authorKind === b.authorKind;
}

export function buildMessageRows(messages: readonly ChannelMessage[], layout: MessageLayout): MessageRow[] {
  const rows: MessageRow[] = [];
  let lastDay: string | null = null;
  for (const message of inWhisperThreadOrder(messages)) {
    const day = dayKey(message.createdAt);
    if (day !== lastDay) {
      rows.push({ kind: 'date', key: `date-${day}`, timestamp: message.createdAt });
      lastDay = day;
    }
    if (isNoticeRow(message)) {
      rows.push({ kind: 'notice', key: message.id, message });
      continue;
    }
    const previous = rows[rows.length - 1];
    if (layout === 'log') {
      const block = previous?.kind === 'log-block' ? previous : null;
      const head = block?.messages[0];
      if (block && head && !isWhisper(message) && !isWhisper(head) && sameSpeaker(head, message)) {
        block.messages.push(message);
      } else {
        rows.push({ kind: 'log-block', key: message.id, messages: [message] });
      }
      continue;
    }
    const continues = previous?.kind === 'message' && !isWhisper(previous.message) &&
      !isWhisper(message) && sameSpeaker(previous.message, message);
    rows.push({ kind: 'message', key: message.id, message, groupStart: !continues });
  }
  return rows;
}
