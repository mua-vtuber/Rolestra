/**
 * Runtime chat rules (spec 2026-10-01 F4-6): the "do not mention the runtime
 * environment" rule is added to the persona at call time, so it reaches rooms
 * whose persona snapshot was frozen before the rule existed, DMs and the
 * general channel alike — and never twice.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { CHAT_RUNTIME_ENVIRONMENT_RULE } from '../../members/persona-builder';
import {
  createChatRuntime, publicReply, reply, type ChatRuntime, type ModelCall,
} from './chat-runtime-harness';

let runtime: ChatRuntime | null = null;
afterEach(() => {
  runtime?.close();
  runtime = null;
});

const ruleCount = (call: ModelCall | undefined): number =>
  (call?.persona ?? '').split(CHAT_RUNTIME_ENVIRONMENT_RULE).length - 1;

describe('runtime chat rules (F4-6)', () => {
  it('reach a room whose persona snapshot predates the rule, once, on API and CLI turns', async () => {
    const rt = runtime = createChatRuntime({ api: ['alice'], cli: ['bob'] });
    const room = rt.createRoom('Old room', ['alice', 'bob']);
    rt.db.prepare('UPDATE chat_room_members SET effective_persona = ? WHERE channel_id = ?')
      .run('LEGACY_SNAPSHOT persona frozen before 2026-10-01', room.id);
    rt.script('alice', publicReply('alice'));
    rt.script('bob', publicReply('bob'));

    await rt.sendUser(room, 'U1');

    for (const id of ['alice', 'bob']) {
      const [call] = rt.callsFor(id);
      expect(call?.persona).toContain('LEGACY_SNAPSHOT');
      expect(ruleCount(call)).toBe(1);
    }
  });

  it('stays single for a snapshot that already carries the rule', async () => {
    const rt = runtime = createChatRuntime({ api: ['alice'] });
    const room = rt.createRoom('Branch room', ['alice']);
    rt.db.prepare('UPDATE chat_room_members SET effective_persona = ? WHERE channel_id = ?')
      .run(`Snapshot persona. ${CHAT_RUNTIME_ENVIRONMENT_RULE}`, room.id);
    rt.script('alice', publicReply('alice'));

    await rt.sendUser(room, 'U1');

    expect(ruleCount(rt.callsFor('alice')[0])).toBe(1);
  });

  it('reach DMs too, once', async () => {
    const rt = runtime = createChatRuntime({ api: ['bob'], cli: ['carol'] });
    const apiDm = rt.channels.createDm('bob');
    const cliDm = rt.channels.createDm('carol');
    rt.script('bob', reply('api answer'));
    rt.script('carol', reply('cli answer'));

    await rt.sendUser(apiDm, 'hello');
    await rt.sendUser(cliDm, 'hello');

    expect(ruleCount(rt.callsFor('bob')[0])).toBe(1);
    expect(ruleCount(rt.callsFor('carol')[0])).toBe(1);
  });
});
