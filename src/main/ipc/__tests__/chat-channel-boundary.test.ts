import { describe, expect, it } from 'vitest';
import type { Channel } from '../../../shared/channel-types';
import {
  requireChatChannel,
  requireDeletableChatChannel,
  requireGlobalGeneral,
} from '../chat-channel-boundary';

const channels = new Map<string, Channel>([
  ['general', { id: 'general', kind: 'system_general' } as Channel],
  ['dm', { id: 'dm', kind: 'dm', projectId: 'legacy-project' } as Channel],
  ['work', { id: 'work', kind: 'user', projectId: 'legacy-project' } as Channel],
]);
const lookup = { get: (id: string) => channels.get(id) ?? null };

describe('live chat IPC channel boundary', () => {
  it('allows global general and legacy DM rows', () => {
    expect(requireChatChannel(lookup, 'general').kind).toBe('system_general');
    expect(requireChatChannel(lookup, 'dm').kind).toBe('dm');
    expect(() => requireGlobalGeneral(lookup, 'general')).not.toThrow();
  });

  it('rejects archived work channels and missing IDs', () => {
    expect(() => requireChatChannel(lookup, 'work')).toThrow();
    expect(() => requireChatChannel(lookup, 'missing')).toThrow();
    expect(() => requireGlobalGeneral(lookup, 'dm')).toThrow();
  });

  it('lets channel:delete take a DM or the global general channel only', () => {
    const deletable = new Map<string, Channel>([
      ['general', { id: 'general', kind: 'system_general', projectId: null } as Channel],
      ['dm', { id: 'dm', kind: 'dm', projectId: null } as Channel],
      ['room', { id: 'room', kind: 'user', projectId: null } as Channel],
      ['work', { id: 'work', kind: 'user', projectId: 'legacy-project' } as Channel],
    ]);
    const deletableLookup = { get: (id: string) => deletable.get(id) ?? null };
    expect(requireDeletableChatChannel(deletableLookup, 'dm')).toBe('dm');
    expect(requireDeletableChatChannel(deletableLookup, 'general')).toBe('general');
    // A chat room row without its room record is not a chat channel here;
    // rooms are deleted through room:delete.
    expect(() => requireDeletableChatChannel(deletableLookup, 'room')).toThrow(/Chat channel not found/);
    expect(() => requireDeletableChatChannel(deletableLookup, 'work')).toThrow(/Chat channel not found/);
    expect(() => requireDeletableChatChannel(deletableLookup, 'missing')).toThrow(/Chat channel not found/);
  });
});
