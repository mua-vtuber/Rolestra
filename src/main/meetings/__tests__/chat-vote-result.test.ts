import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { asAbsolutePath } from '../../../shared/absolute-path';
import type { Message } from '../../../shared/message-types';
import { MessageRepository } from '../../channels/message-repository';
import { MessageService } from '../../channels/message-service';
import { insertChannel } from '../../database/__tests__/_helpers';
import { migrations } from '../../database/migrations';
import { runMigrations } from '../../database/migrator';
import { ChatVoteRepository } from '../chat-vote-repository';
import { ChatVoteService } from '../chat-vote-service';
import { OpinionRepository } from '../opinion-repository';

const opened: Database.Database[] = [];
const directories: string[] = [];
afterEach(() => {
  for (const db of opened.splice(0)) if (db.open) db.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function open(path = ':memory:'): Database.Database {
  const db = new Database(path);
  opened.push(db);
  db.pragma('foreign_keys = ON');
  runMigrations(db, migrations);
  return db;
}

function serviceFor(db: Database.Database, append?: MessageService['append']) {
  const messages = new MessageService(new MessageRepository(db));
  const repo = new ChatVoteRepository(db);
  const service = new ChatVoteService(
    repo, new OpinionRepository(db), {
      get: (channelId) => {
        const row = db.prepare('SELECT archived_at FROM chat_rooms WHERE channel_id = ?')
          .get(channelId) as { archived_at: number | null } | undefined;
        return row ? { archivedAt: row.archived_at } : null;
      },
      listMembers: () => [],
    }, messages, { get: () => undefined }, () => { throw new Error('Unexpected provider call'); },
    () => 'C:/test-consensus', asAbsolutePath('C:/test-instructions', 'vote result test'),
    (channelId) => {
      const row = db.prepare('SELECT kind FROM channels WHERE id = ?').get(channelId) as { kind: string } | undefined;
      return row?.kind === 'system_general';
    }, undefined, undefined, {
      append: append ?? messages.append.bind(messages),
      assertWritable: (channelId) => {
        const row = db.prepare('SELECT read_only FROM channels WHERE id = ?').get(channelId) as { read_only: number } | undefined;
        if (!row || row.read_only) throw new Error('Channel not writable');
      },
    },
  );
  return { service, repo, messages };
}

function setup(path?: string, channelKind: 'user' | 'system_general' = 'user') {
  const db = open(path);
  insertChannel(db, 'room', null, channelKind);
  if (channelKind === 'user') db.prepare("INSERT INTO chat_rooms(channel_id, created_at) VALUES ('room', 1)").run();
  db.prepare(`INSERT INTO opinion(id,channel_id,kind,author_label,title,content,status,created_at,updated_at)
    VALUES ('op','room','user-raised','private-author','Proposal title','PRIVATE proposal body','pending',1,1)`).run();
  const context = serviceFor(db);
  context.repo.insert('vote', 'op', 'room', ['agree', 'oppose', 'abstain', 'failed'].map((id) => ({
    providerId: `private-${id}`, displayName: `PRIVATE name ${id}`, persona: `PRIVATE persona ${id}`,
  })));
  for (const vote of ['agree', 'oppose', 'abstain'] as const) {
    context.repo.settleParticipant('vote', `private-${vote}`, {
      status: 'submitted', opinion: `PRIVATE reason ${vote}`, vote, error: null,
    });
  }
  context.repo.settleParticipant('vote', 'private-failed', {
    status: 'failed', opinion: null, vote: null, error: 'provider_error',
  });
  context.repo.complete('vote');
  return { db, ...context };
}

describe('sending a completed chat vote result', () => {
  it('persists one public user row containing only the title and anonymous counts, after commit', () => {
    const { db, service, messages } = setup();
    const emitted: Message[] = [];
    messages.on('message', (message: Message) => {
      expect(db.inTransaction).toBe(false);
      expect(service.getVote('op')?.resultMessageId).toBe(message.id);
      emitted.push(message);
    });
    expect(service.getVote('op')?.resultMessageId).toBeNull();
    const result = service.sendResult('op');
    expect(result.resultMessageId).toEqual(expect.any(String));
    const rows = messages.listByChannel('room', {}, { kind: 'public' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: result.resultMessageId, channelId: 'room',
      authorId: 'user', authorKind: 'user', role: 'user', visibility: 'public', content: 'vote_result' });
    expect(rows[0]?.meta).toEqual({ chatVoteResult: {
      voteId: 'vote', title: 'Proposal title', counts: { agree: 1, oppose: 1, abstain: 1, failed: 1 },
    } });
    expect(JSON.stringify(rows)).not.toMatch(/PRIVATE|private-|provider_error|participants/);
    expect(emitted).toHaveLength(1);
    expect(service.sendResult('op').resultMessageId).toBe(result.resultMessageId);
    expect(emitted).toHaveLength(1);
    expect(messages.listByChannel('room')).toHaveLength(1);
  });

  it('preserves delivery after closing and reopening the database and reconstructing the service', () => {
    const directory = mkdtempSync(join(tmpdir(), 'rolestra-vote-result-'));
    directories.push(directory);
    const path = join(directory, 'test.sqlite');
    const first = setup(path);
    const messageId = first.service.sendResult('op').resultMessageId;
    first.db.close();
    const reopened = serviceFor(open(path));
    expect(reopened.service.getVote('op')?.resultMessageId).toBe(messageId);
    expect(reopened.service.sendResult('op').resultMessageId).toBe(messageId);
    expect(reopened.messages.listByChannel('room')).toHaveLength(1);
  });

  it('keeps a general-channel result sent after conversation history is cleared', () => {
    const { db, service, messages } = setup(undefined, 'system_general');
    const emitted: Message[] = [];
    messages.on('message', (message: Message) => emitted.push(message));
    const result = service.sendResult('op');
    new MessageRepository(db).deleteByChannel('room');
    expect(messages.listByChannel('room')).toEqual([]);
    expect(service.getVote('op')?.resultMessageId).toBe(result.resultMessageId);
    expect(service.sendResult('op').resultMessageId).toBe(result.resultMessageId);
    expect(messages.listByChannel('room')).toEqual([]);
    expect(emitted).toHaveLength(1);
  });

  it('rejects a duplicate append after history deletion without emitting another message', () => {
    const { db, service, messages } = setup(undefined, 'system_general');
    const emitted: Message[] = [];
    messages.on('message', (message: Message) => emitted.push(message));
    service.sendResult('op');
    const original = messages.listByChannel('room')[0]!;
    new MessageRepository(db).deleteByChannel('room');
    expect(() => messages.append(original)).toThrow(/UNIQUE/);
    expect(messages.listByChannel('room')).toEqual([]);
    expect(emitted).toHaveLength(1);
  });

  it('returns the winning row when another service inserts between the check and append', () => {
    const { db, service: winner, messages } = setup();
    const contender = serviceFor(db, (input) => {
      winner.sendResult('op');
      return messages.append(input);
    });
    const result = contender.service.sendResult('op');
    expect(result.resultMessageId).toBe(winner.getVote('op')?.resultMessageId);
    expect(messages.listByChannel('room')).toHaveLength(1);
  });

  it('leaves a failed append unsent so a later attempt can succeed', () => {
    const { db, service, messages } = setup();
    const failing = serviceFor(db, () => { throw new Error('Storage unavailable'); });
    expect(() => failing.service.sendResult('op')).toThrow('Storage unavailable');
    expect(service.getVote('op')?.resultMessageId).toBeNull();
    expect(messages.listByChannel('room')).toEqual([]);
    expect(service.sendResult('op').resultMessageId).toEqual(expect.any(String));
    expect(messages.listByChannel('room')).toHaveLength(1);
  });

  it.each(['running', 'interrupted'] as const)('rejects a %s vote without a message', (status) => {
    const { db, service, messages } = setup();
    db.prepare('UPDATE chat_votes SET status = ? WHERE id = ?').run(status, 'vote');
    expect(() => service.sendResult('op')).toThrow(/completed/);
    expect(messages.listByChannel('room')).toEqual([]);
  });

  it.each(['archived', 'read-only', 'deleted', 'non-chat', 'disallowed-opinion', 'missing-vote'] as const)(
    'rejects %s state without a message', (state) => {
      const { db, service, messages } = setup();
      if (state === 'archived') db.prepare("UPDATE chat_rooms SET archived_at = 2 WHERE channel_id = 'room'").run();
      if (state === 'read-only') db.prepare("UPDATE channels SET read_only = 1 WHERE id = 'room'").run();
      if (state === 'deleted') db.prepare("DELETE FROM channels WHERE id = 'room'").run();
      if (state === 'non-chat') db.prepare("DELETE FROM chat_rooms WHERE channel_id = 'room'").run();
      if (state === 'disallowed-opinion') db.prepare("UPDATE opinion SET kind = 'root' WHERE id = 'op'").run();
      if (state === 'missing-vote') db.prepare("DELETE FROM chat_votes WHERE id = 'vote'").run();
      const expected = { archived: /archived/, 'read-only': /not writable/, deleted: /opinion not found/,
        'non-chat': /room not found/, 'disallowed-opinion': /opinion not found/, 'missing-vote': /completed/ };
      expect(() => service.sendResult('op')).toThrow(expected[state]);
      expect(messages.listByChannel('room')).toEqual([]);
    });

  it('rejects shutdown without a message', async () => {
    const { service, messages } = setup();
    await service.shutdown();
    expect(() => service.sendResult('op')).toThrow(/shutting down/);
    expect(messages.listByChannel('room')).toEqual([]);
  });

  it('can send a completed vote in the global general channel', () => {
    const { service, messages } = setup(undefined, 'system_general');
    expect(service.sendResult('op').resultMessageId).toEqual(expect.any(String));
    expect(messages.listByChannel('room')).toHaveLength(1);
  });
});
