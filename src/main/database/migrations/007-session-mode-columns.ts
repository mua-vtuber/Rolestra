/**
 * Migration 007: Add session_mode and message_mode columns.
 *
 * - conversations.session_mode: tracks the mode of the session
 *   (e.g. 'conversation', 'consensus', 'context').
 * - messages.message_mode: tracks the mode active when the message was sent.
 * - Index on session_mode for efficient filtering.
 *
 * IMPORTANT: This file is IMMUTABLE once applied.
 * Do not modify; create a new migration instead.
 */

import type { Migration } from '../migrator';

const migration: Migration = {
  id: '007-session-mode-columns',
  sql: `
    ALTER TABLE conversations ADD COLUMN session_mode TEXT DEFAULT 'conversation';
    ALTER TABLE messages ADD COLUMN message_mode TEXT DEFAULT 'conversation';
    CREATE INDEX IF NOT EXISTS idx_conversations_session_mode ON conversations(session_mode);
  `,
};

export default migration;
