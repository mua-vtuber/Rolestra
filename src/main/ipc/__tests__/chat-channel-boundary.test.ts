import { describe, expect, it } from 'vitest';
import type { Channel } from '../../../shared/channel-types';
import {
  requireChatChannel,
  requireDm,
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
    expect(() => requireDm(lookup, 'dm')).not.toThrow();
    expect(() => requireGlobalGeneral(lookup, 'general')).not.toThrow();
  });

  it('rejects archived work channels and missing IDs', () => {
    expect(() => requireChatChannel(lookup, 'work')).toThrow();
    expect(() => requireChatChannel(lookup, 'missing')).toThrow();
    expect(() => requireDm(lookup, 'general')).toThrow();
    expect(() => requireGlobalGeneral(lookup, 'dm')).toThrow();
  });
});
