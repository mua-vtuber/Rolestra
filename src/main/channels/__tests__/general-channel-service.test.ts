import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearLoggerAccessor, setLoggerAccessor } from '../../log/logger-accessor';
import { StructuredLogger } from '../../log/structured-logger';
import { ChannelError } from '../channel-errors';
import { GENERAL_CHANNEL_PROVISIONED_MARKER, GeneralChannelRepository } from '../general-channel-repository';
import { GeneralChannelService } from '../general-channel-service';
import { createChatRuntime, type ChatRuntime } from './chat-runtime-harness';

let runtime: ChatRuntime | null = null;
afterEach(() => {
  runtime?.close();
  runtime = null;
});

function count(rt: ChatRuntime, sql: string, ...params: unknown[]): number {
  return (rt.db.prepare(`SELECT COUNT(*) AS n FROM ${sql}`).get(...params) as { n: number }).n;
}

const generalRows = (rt: ChatRuntime): number =>
  count(rt, `channels WHERE kind = 'system_general' AND project_id IS NULL`);
const markerRows = (rt: ChatRuntime): number =>
  count(rt, 'app_install_markers WHERE marker = ?', GENERAL_CHANNEL_PROVISIONED_MARKER);

describe('GeneralChannelService.provisionOnFirstRun', () => {
  it('creates the general channel and its marker on a fresh DB, once', () => {
    const rt = runtime = createChatRuntime({ api: ['alice'] });
    expect(markerRows(rt)).toBe(0);

    const created = rt.general.provisionOnFirstRun();
    expect(created).toMatchObject({
      projectId: null, name: '일반', kind: 'system_general', readOnly: false,
      role: null, purpose: null, maxRounds: null, handoffMode: 'check',
    });
    expect(generalRows(rt)).toBe(1);
    expect(markerRows(rt)).toBe(1);

    const again = rt.general.provisionOnFirstRun();
    expect(again?.id).toBe(created?.id);
    expect(generalRows(rt)).toBe(1);
  });

  it('returns null and creates nothing after the user deleted the channel', () => {
    const rt = runtime = createChatRuntime({ api: ['alice'] });
    const general = rt.general.provisionOnFirstRun()!;
    rt.general.delete(general.id);

    expect(rt.general.provisionOnFirstRun()).toBeNull();
    expect(generalRows(rt)).toBe(0);
    expect(markerRows(rt)).toBe(1);
  });

  it('only records the marker when a general row exists without one', () => {
    const rt = runtime = createChatRuntime({ api: ['alice'] });
    rt.db.prepare(`INSERT INTO channels
      (id, project_id, name, kind, read_only, created_at, role, purpose, handoff_mode)
      VALUES ('old-general', NULL, '일반', 'system_general', 0, 77, NULL, NULL, 'check')`).run();

    expect(rt.general.provisionOnFirstRun()?.id).toBe('old-general');
    expect(generalRows(rt)).toBe(1);
    expect(rt.db.prepare('SELECT recorded_at FROM app_install_markers WHERE marker = ?')
      .get(GENERAL_CHANNEL_PROVISIONED_MARKER)).toEqual({ recorded_at: 77 });
  });
});

describe('GeneralChannelService.delete', () => {
  it('removes the channel with its messages, opinion cards, votes, read marker, CLI sessions and whisper rounds', () => {
    const rt = runtime = createChatRuntime({ api: ['alice'] });
    const general = rt.general.provisionOnFirstRun()!;
    const message = rt.messages.append({ channelId: general.id, meetingId: null,
      authorId: 'user', authorKind: 'user', role: 'user', content: 'hello general' });
    rt.db.prepare(`INSERT INTO opinion (id, channel_id, kind, author_label, status, created_at, updated_at)
      VALUES ('op', ?, 'user-raised', 'user', 'pending', 1, 1)`).run(general.id);
    rt.db.prepare(`INSERT INTO opinion_vote (id, target_id, vote, round_kind, created_at)
      VALUES ('ov', 'op', 'agree', 'light', 1)`).run();
    rt.db.prepare(`INSERT INTO chat_votes (id, opinion_id, channel_id, status, created_at)
      VALUES ('vote', 'op', ?, 'running', 1)`).run(general.id);
    rt.db.prepare(`INSERT INTO chat_vote_participants
      (vote_id, provider_id, display_name, persona, sort_order, status)
      VALUES ('vote', 'alice', 'ALICE', '', 0, 'pending')`).run();
    rt.db.prepare('INSERT INTO channel_read_state (channel_id, last_read_rowid) VALUES (?, 1)').run(general.id);
    rt.db.prepare(`INSERT INTO cli_chat_sessions
      (channel_id, provider_id, session_id, context_fingerprint, updated_at)
      VALUES (?, 'alice', 's1', 'f1', 1)`).run(general.id);
    rt.db.prepare(`INSERT INTO chat_whisper_rounds (channel_id, user_message_id, status, created_at, updated_at)
      VALUES (?, ?, 'finished', 1, 1)`).run(general.id, message.id);
    rt.db.prepare(`INSERT INTO notification_log (id, kind, title, body, channel_id, created_at)
      VALUES ('n1', 'new_message', 't', 'b', ?, 1)`).run(general.id);

    rt.general.delete(general.id);

    expect(rt.channels.get(general.id)).toBeNull();
    expect(count(rt, 'messages WHERE channel_id = ?', general.id)).toBe(0);
    expect(count(rt, 'opinion')).toBe(0);
    expect(count(rt, 'opinion_vote')).toBe(0);
    expect(count(rt, 'chat_votes')).toBe(0);
    expect(count(rt, 'chat_vote_participants')).toBe(0);
    expect(count(rt, 'channel_read_state')).toBe(0);
    expect(count(rt, 'cli_chat_sessions')).toBe(0);
    expect(count(rt, 'chat_whisper_rounds')).toBe(0);
    // Notification history stays, detached from the deleted channel.
    expect(rt.db.prepare(`SELECT channel_id FROM notification_log WHERE id = 'n1'`).get())
      .toEqual({ channel_id: null });
    expect(markerRows(rt)).toBe(1);
  });

  it('refuses DM, room and unknown ids, leaving them stored', () => {
    const rt = runtime = createChatRuntime({ api: ['alice'] });
    rt.general.provisionOnFirstRun();
    const dm = rt.channels.createDm('alice');
    const room = rt.createRoom('Room', ['alice']);

    expect(() => rt.general.delete(dm.id)).toThrow(`Global general channel not found: ${dm.id}`);
    expect(() => rt.general.delete(room.id)).toThrow(`Global general channel not found: ${room.id}`);
    expect(() => rt.general.delete('missing')).toThrow('Global general channel not found: missing');
    expect(rt.channels.get(dm.id)).not.toBeNull();
    expect(rt.channels.get(room.id)).not.toBeNull();
  });

  it('refuses while a conversation archive of the channel is in progress', () => {
    const rt = runtime = createChatRuntime({ api: ['alice'] });
    const general = rt.general.provisionOnFirstRun()!;
    const service = new GeneralChannelService(new GeneralChannelRepository(rt.db), {
      get: (id) => rt.channels.get(id),
      getGlobalGeneralChannel: () => rt.channels.getGlobalGeneralChannel(),
      isConversationArchiving: (id) => id === general.id,
    }, () => { throw new Error('unused'); });
    const closed = vi.fn();
    service.on('closed', closed);

    expect(() => service.delete(general.id)).toThrow(ChannelError);
    expect(() => service.delete(general.id)).toThrow(`Conversation archive in progress: ${general.id}`);
    expect(rt.channels.get(general.id)).not.toBeNull();
    expect(closed).not.toHaveBeenCalled();
  });

  it("announces 'closed' only after the row is gone", () => {
    const rt = runtime = createChatRuntime({ api: ['alice'] });
    const general = rt.general.provisionOnFirstRun()!;
    const seen: Array<{ channelId: string; stillStored: boolean }> = [];
    rt.general.on('closed', ({ channelId }: { channelId: string }) => {
      seen.push({ channelId, stillStored: rt.channels.get(channelId) !== null });
    });

    rt.general.delete(general.id);
    expect(seen).toEqual([{ channelId: general.id, stillStored: false }]);
  });
});

describe('GeneralChannelService close-listener failures', () => {
  let logger: StructuredLogger;
  beforeEach(() => {
    logger = new StructuredLogger({ console: false, level: 'debug' });
    setLoggerAccessor(() => logger);
  });
  afterEach(() => clearLoggerAccessor());

  it('keeps the delete and logs when a closed listener throws', () => {
    const rt = runtime = createChatRuntime({ api: ['alice'] });
    const general = rt.general.provisionOnFirstRun()!;
    rt.general.on('closed', () => { throw new Error('listener boom'); });

    expect(() => rt.general.delete(general.id)).not.toThrow();

    expect(rt.channels.get(general.id)).toBeNull();
    const entries = logger.getEntries({ level: 'error' })
      .filter((entry) => entry.component === 'general-channel' && entry.action === 'close-listener');
    expect(entries).toHaveLength(1);
    expect((entries[0]?.metadata as { channelId: string }).channelId).toBe(general.id);
  });
});
