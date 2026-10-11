import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { migrations } from '../migrations';
import { runMigrations } from '../migrator';

const opened: Database.Database[] = [];
afterEach(() => { for (const db of opened.splice(0)) db.close(); });

const MIGRATION_ID = '040-chat-vote-error-cause';

describe('040 chat vote error cause', () => {
  it('adds error_cause and error_detail, leaving existing participants NULL', () => {
    const db = new Database(':memory:');
    opened.push(db);
    runMigrations(db, migrations.filter((item) => item.id < MIGRATION_ID));
    db.prepare(`INSERT INTO channels
      (id, project_id, name, kind, read_only, created_at, role, purpose, handoff_mode)
      VALUES ('general', NULL, '일반', 'system_general', 0, 1, NULL, NULL, 'check')`).run();
    db.prepare(`INSERT INTO opinion (id, channel_id, kind, author_label, status, created_at, updated_at)
      VALUES ('op', 'general', 'user-raised', 'user', 'pending', 1, 1)`).run();
    db.prepare(`INSERT INTO chat_votes (id, opinion_id, channel_id, status, created_at)
      VALUES ('vote', 'op', 'general', 'completed', 1)`).run();
    db.prepare(`INSERT INTO chat_vote_participants
      (vote_id, provider_id, display_name, persona, sort_order, status, error)
      VALUES ('vote', 'p1', 'P1', '', 0, 'failed', 'provider_error')`).run();

    runMigrations(db, migrations);

    const columns = (db.prepare('PRAGMA table_info(chat_vote_participants)').all() as Array<{ name: string }>)
      .map((column) => column.name);
    expect(columns).toEqual(expect.arrayContaining(['error_cause', 'error_detail']));
    expect(db.prepare('SELECT error_cause, error_detail FROM chat_vote_participants').get())
      .toEqual({ error_cause: null, error_detail: null });
  });
});
