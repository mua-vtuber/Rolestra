/**
 * Multi-party message adaptation — converts conversation history
 * so each AI sees itself as "assistant" and all others as "user".
 *
 * Core rules (from v1 AI_Chat and design doc Section 4-3):
 * 1. selfId's messages       → role: "assistant"
 * 2. All other participants   → role: "user", content prefixed with "[name]: "
 * 3. Consecutive user messages are merged (most AI APIs reject consecutive user roles)
 * 4. System messages pass through unchanged
 *
 * This function is provider-agnostic and handles all multi-party
 * message adaptation centrally.
 */

import type { Message } from '../../shared/provider-types';

/**
 * A conversation message with participant metadata.
 * The engine stores messages in this extended form;
 * adaptation strips it down to plain Message[] for the API.
 */
export interface ParticipantMessage extends Message {
  /** Unique message ID for referencing (e.g., memory pin, fork). */
  id: string;
  /** The participant who produced this message. */
  participantId: string;
  /** Display name of the participant (used for "[name]: " prefix). */
  participantName: string;
  /** Parent message ID (previous message in the chain). */
  parentMessageId?: string;
  /** Branch this message belongs to. */
  branchId?: string;
  /** The message ID from which the branch was forked (set on fork branches). */
  branchRootMessageId?: string;
}

/** Structured mode determines how other participants' messages are formatted. */
export type StructuredMode = 'conversation' | 'work_discussion' | 'review';

/**
 * Convert multi-party conversation history for a specific provider's perspective.
 *
 * @param messages - Full conversation history with participant metadata.
 * @param selfParticipantId - The participant ID of the provider receiving the adapted messages.
 * @param structuredMode - When set, other participants' messages use JSON `{name, content}` format
 *   instead of the legacy `[name]: content` prefix. Undefined preserves legacy behavior.
 * @returns Plain Message[] suitable for passing to a provider's streamCompletion.
 */
export function adaptMessagesForProvider(
  messages: readonly ParticipantMessage[],
  selfParticipantId: string,
  structuredMode?: StructuredMode,
): Message[] {
  const adapted: Message[] = [];

  for (const msg of messages) {
    // System messages pass through unchanged
    if (msg.role === 'system') {
      adapted.push({
        role: 'system',
        content: msg.content,
        name: msg.name,
        metadata: msg.metadata,
      });
      continue;
    }

    if (msg.participantId === selfParticipantId) {
      // Self → assistant
      adapted.push({
        role: 'assistant',
        content: msg.content,
        name: msg.name,
        metadata: msg.metadata,
      });
    } else {
      if (structuredMode) {
        // Structured mode: JSON object with name and content
        const textContent = contentToString(msg.content);
        const structuredContent = JSON.stringify({
          name: msg.participantName,
          content: textContent,
        });
        adapted.push({
          role: 'user',
          content: structuredContent,
          name: msg.participantName,
          metadata: msg.metadata,
        });
      } else {
        // Legacy mode: "[name]: content" prefix
        const prefixedContent = prefixContent(msg.content, msg.participantName);
        adapted.push({
          role: 'user',
          content: prefixedContent,
          name: msg.participantName,
          metadata: msg.metadata,
        });
      }
    }
  }

  // Merge consecutive user messages for API compatibility
  return mergeConsecutiveUserMessages(adapted);
}

/**
 * Prefix message content with the speaker's display name.
 * Handles both string and ContentBlock[] content types.
 */
function prefixContent(
  content: Message['content'],
  displayName: string,
): Message['content'] {
  if (typeof content === 'string') {
    return `[${displayName}]: ${content}`;
  }

  // For ContentBlock[], prefix the first text block
  return content.map((block, index) => {
    if (index === 0 && block.type === 'text' && typeof block.data === 'string') {
      return { ...block, data: `[${displayName}]: ${block.data}` };
    }
    return block;
  });
}

/**
 * Merge consecutive user-role messages into a single message.
 *
 * Most AI APIs (OpenAI, Anthropic, Google) reject or mishandle
 * consecutive messages with the same role. This merger concatenates
 * them with double-newline separators.
 */
function mergeConsecutiveUserMessages(messages: Message[]): Message[] {
  if (messages.length === 0) return [];

  const merged: Message[] = [];
  let pendingUser: Message | null = null;

  for (const msg of messages) {
    if (msg.role === 'user') {
      if (pendingUser === null) {
        // Start accumulating
        pendingUser = { ...msg };
      } else {
        // Merge into pending
        pendingUser.content = mergeContent(pendingUser.content, msg.content);
        // Clear the name field since this is now a merged message
        pendingUser.name = undefined;
      }
    } else {
      // Flush pending user message before non-user message
      if (pendingUser !== null) {
        merged.push(pendingUser);
        pendingUser = null;
      }
      merged.push(msg);
    }
  }

  // Flush any remaining pending user message
  if (pendingUser !== null) {
    merged.push(pendingUser);
  }

  return merged;
}

/**
 * Merge two content values (string or ContentBlock[]) with a separator.
 */
function mergeContent(
  existing: Message['content'],
  incoming: Message['content'],
): Message['content'] {
  // Both strings → simple concatenation
  if (typeof existing === 'string' && typeof incoming === 'string') {
    return `${existing}\n\n${incoming}`;
  }

  // Mixed or both arrays → convert to string representation
  const existingStr = contentToString(existing);
  const incomingStr = contentToString(incoming);
  return `${existingStr}\n\n${incomingStr}`;
}

/**
 * Convert content to string for merging purposes.
 */
function contentToString(content: Message['content']): string {
  if (typeof content === 'string') return content;
  return content
    .filter(block => block.type === 'text')
    .map(block => String(block.data))
    .join('\n');
}
