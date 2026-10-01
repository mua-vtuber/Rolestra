import { afterEach, describe, expect, it } from 'vitest';
import { DM_ERROR_DETAIL_MAX_CHARS } from '../chat-limits';
import { createChatRuntime, type ChatRuntime, type ModelStep } from './chat-runtime-harness';

let runtime: ChatRuntime | null = null;
afterEach(() => {
  runtime?.close();
  runtime = null;
});

const failWith = (message: string): ModelStep => async function* () {
  yield* [];
  throw new Error(message);
};

describe('DM failure notices are stored as codes (A5)', () => {
  it('stores a provider failure code with one masked, shortened line of cause', async () => {
    const rt = runtime = createChatRuntime({ api: ['bob'] });
    const dm = rt.channels.createDm('bob');
    rt.script('bob', failWith(
      'Incorrect API key provided: sk-proj-abcdefghijklmnopqrstuvwxyz0123456789\n' +
      'request body echo: private prompt text',
    ));

    await rt.sendUser(dm, 'hello');

    const notices = rt.observer(dm.id).filter((m) => m.role === 'system');
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      authorId: 'bob', authorKind: 'member', content: 'provider_error',
      meta: { chatError: 'provider_error' },
    });
    const detail = notices[0]!.meta?.chatErrorDetail;
    expect(detail).toContain('Incorrect API key provided');
    expect(detail).not.toContain('sk-proj-abcdefghij');
    expect(detail).not.toContain('private prompt text');
    expect(JSON.stringify(notices[0])).not.toContain('응답 실패');
  });

  it('caps the stored DM cause', async () => {
    const rt = runtime = createChatRuntime({ api: ['bob'] });
    const dm = rt.channels.createDm('bob');
    rt.script('bob', failWith(`upstream said ${'x'.repeat(5_000)}`));

    await rt.sendUser(dm, 'hello');

    const detail = rt.observer(dm.id).find((m) => m.role === 'system')?.meta?.chatErrorDetail;
    expect(typeof detail).toBe('string');
    expect((detail as string).startsWith('upstream said x')).toBe(true);
    expect((detail as string).length).toBe(DM_ERROR_DETAIL_MAX_CHARS);
  });

  it('stores an unregistered DM provider as a code without detail', async () => {
    const rt = runtime = createChatRuntime({ api: ['bob'] });
    const dm = rt.channels.createDm('bob');
    rt.providers.delete('bob');

    await rt.sendUser(dm, 'hello');

    expect(rt.observer(dm.id).filter((m) => m.role === 'system')).toEqual([
      expect.objectContaining({ authorId: 'system', authorKind: 'system', content: 'provider_unavailable',
        meta: { chatError: 'provider_unavailable' } }),
    ]);
  });

  it('keeps room failure notices free of provider detail', async () => {
    const rt = runtime = createChatRuntime({ api: ['bob'] });
    const room = rt.createRoom('Room', ['bob']);
    rt.script('bob', failWith('upstream said something private'));

    await rt.sendUser(room, 'hello');

    expect(rt.observer(room.id).filter((m) => m.role === 'system').map((m) => m.meta))
      .toEqual([{ chatError: 'provider_error' }]);
  });
});
