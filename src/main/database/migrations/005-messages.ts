/**
 * Migration 005-messages: messages + FTS5 virtual table + triggers.
 *
 * Depends on 003-channels (channels), 004-meetings (meetings), 001-core (providers).
 * Copied verbatim from docs/superpowers/specs/2026-04-18-rolestra-design.md
 * §5.2 (005_messages.sql).
 *
 * Key invariants:
 * - `rowid INTEGER PRIMARY KEY AUTOINCREMENT` is explicit (CA-5) because FTS5
 *   joins via `content_rowid='rowid'`. Removing AUTOINCREMENT would let SQLite
 *   recycle rowids and silently corrupt the FTS index.
 * - `messages_author_fk_check` enforces the conditional FK on `author_id`:
 *   author_kind='member' → must reference providers.id
 *   author_kind='user'   → must equal the literal 'user'
 * - Three FTS triggers (`ai`/`ad`/`au`) keep the FTS index in lock-step with
 *   the base table. `au` does delete-then-insert (not `UPDATE`) because
 *   external-content FTS5 requires it.
 *
 * Migration files are immutable once applied.
 */

import type { Migration } from '../migrator';

export const migration: Migration = {
  id: '005-messages',
  sql: `
CREATE TABLE messages (
  rowid INTEGER PRIMARY KEY AUTOINCREMENT,      -- FTS5 join용 정수 rowid (CA-5)
  id TEXT NOT NULL UNIQUE,                      -- 애플리케이션 레벨 식별자 (UUID)
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  meeting_id TEXT DEFAULT NULL REFERENCES meetings(id) ON DELETE SET NULL,
  author_id TEXT NOT NULL,                       -- provider_id 또는 리터럴 'user' (단일 사용자)
  author_kind TEXT NOT NULL CHECK(author_kind IN ('user','member','system')),
  role TEXT NOT NULL CHECK(role IN ('user','assistant','system','tool')),
  content TEXT NOT NULL,
  meta_json TEXT DEFAULT NULL,                   -- MessageMeta (§6 zod)
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_messages_channel_time ON messages(channel_id, created_at);
CREATE INDEX idx_messages_meeting ON messages(meeting_id);
CREATE INDEX idx_messages_id ON messages(id);

-- author_id의 conditional FK를 트리거로 강제 (CB-8)
CREATE TRIGGER messages_author_fk_check BEFORE INSERT ON messages BEGIN
  SELECT CASE
    WHEN NEW.author_kind = 'member' AND NOT EXISTS (SELECT 1 FROM providers WHERE id = NEW.author_id)
      THEN RAISE(ABORT, 'messages.author_id must reference providers.id when author_kind=member')
    WHEN NEW.author_kind = 'user' AND NEW.author_id != 'user'
      THEN RAISE(ABORT, 'messages.author_id must be literal "user" when author_kind=user')
  END;
END;

-- FTS5: content 테이블 연결 (rowid 매핑 명시)
CREATE VIRTUAL TABLE messages_fts USING fts5(
  content,
  content='messages',
  content_rowid='rowid'
);

CREATE TRIGGER messages_fts_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
END;
CREATE TRIGGER messages_fts_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.rowid, old.content);
END;
CREATE TRIGGER messages_fts_au AFTER UPDATE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.rowid, old.content);
  INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
END;
`,
};
