import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BaseProvider } from '../../providers/provider-interface';
import { providerRegistry } from '../../providers/registry';
import { handleChannelDelete, setGeneralChannelServiceAccessor } from '../../ipc/handlers/channel-handler';
import { createChatRuntime, type ChatRuntime } from './chat-runtime-harness';

let runtime: ChatRuntime | null = null;
const registered: string[] = [];
afterEach(() => {
  runtime?.close();
  runtime = null;
  for (const id of registered.splice(0)) providerRegistry.discardUnstarted(id);
});

/** The general channel's members come from the provider registry. */
function registerMember(id: string): void {
  providerRegistry.register({ id, toInfo: () => ({ id }) } as unknown as BaseProvider);
  registered.push(id);
}

describe('general channel delete closes the conversation (spec 2026-10-08 F1)', () => {
  it('aborts the in-flight turn, stores nothing late, leaves no notice and drops the CLI clone', async () => {
    const rt = runtime = createChatRuntime({ cli: ['bob'] });
    registerMember('bob');
    setGeneralChannelServiceAccessor(() => rt.general);
    const general = rt.general.provisionOnFirstRun()!;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    rt.script('bob', async function* () {
      await gate;
      yield JSON.stringify({ public: 'late general reply', whispers: [] });
    });

    const pending = rt.sendUser(general, 'hello');
    await vi.waitFor(() => expect(rt.callsFor('bob')).toHaveLength(1));
    const append = vi.spyOn(rt.messages, 'append');
    const appendWhisper = vi.spyOn(rt.messages, 'appendWhisper');
    expect(handleChannelDelete({ id: general.id }, 'general')).toEqual({ success: true });

    expect(rt.callsFor('bob')[0]!.signal?.aborted).toBe(true);
    release?.();
    await pending;
    expect(append).not.toHaveBeenCalled();
    expect(appendWhisper).not.toHaveBeenCalled();
    expect(rt.channels.get(general.id)).toBeNull();
    expect(rt.timeline(general.id).at(-1)).toBe('round:false');
    await vi.waitFor(() => expect(rt.cooldowns).toEqual(['bob']));
  });
});
