import { describe, expect, it } from 'vitest';

import { isActiveConversation, landingConversation } from '../landing-conversation';
import { chatChannelForTest } from '../../../../test-utils/channel-fixture';
import type { Channel } from '../../../../shared/channel-types';
import type { ChannelSummary } from '../../../../shared/channel-summary-types';

const general = chatChannelForTest({
  id: 'general', projectId: null, name: '일반', kind: 'system_general', readOnly: false, createdAt: 1,
});
const room = (id: string, archivedAt: number | null = null): Channel => chatChannelForTest({
  id, projectId: null, name: id, kind: 'user', isChatRoom: true,
  readOnly: archivedAt !== null, archivedAt, createdAt: 1,
});
const summary = (channelId: string, lastActivityAt: number): ChannelSummary => ({
  channelId, kind: 'room', name: channelId, archivedAt: null, participants: [],
  lastMessage: null, lastActivityAt, unreadCount: 0,
});

describe('isActiveConversation', () => {
  it('counts general and unarchived rooms only', () => {
    expect(isActiveConversation(general)).toBe(true);
    expect(isActiveConversation(room('a'))).toBe(true);
    expect(isActiveConversation(room('old', 5))).toBe(false);
    expect(isActiveConversation(chatChannelForTest({
      id: 'dm', projectId: null, name: 'dm', kind: 'dm', readOnly: false, createdAt: 1,
    }))).toBe(false);
  });
});

describe('landingConversation (spec 2026-10-08 F1)', () => {
  it('1: waits while the channel lists are not loaded', () => {
    expect(landingConversation({ channels: null, general, summaries: [], legacyChannelId: 'a' }))
      .toEqual({ kind: 'wait' });
  });

  it('2: restores a legacy selection that still exists', () => {
    expect(landingConversation({
      channels: [general, room('a')], general, summaries: null, legacyChannelId: 'a',
    })).toEqual({ kind: 'open', channelId: 'a' });
  });

  it('3: opens the general channel when it exists (legacy selection gone)', () => {
    expect(landingConversation({
      channels: [general, room('a')], general, summaries: null, legacyChannelId: 'gone',
    })).toEqual({ kind: 'open', channelId: 'general' });
  });

  it('4: says none when there is no general channel and no active room', () => {
    expect(landingConversation({ channels: [], general: null, summaries: null, legacyChannelId: null }))
      .toEqual({ kind: 'none' });
    expect(landingConversation({
      channels: [room('old', 5)], general: null, summaries: [summary('old', 9)], legacyChannelId: null,
    })).toEqual({ kind: 'none' });
  });

  it('5: waits for the summaries when active rooms exist', () => {
    expect(landingConversation({
      channels: [room('a')], general: null, summaries: null, legacyChannelId: null,
    })).toEqual({ kind: 'wait' });
  });

  it('6: opens the most recent active room, like the top of the chat list', () => {
    expect(landingConversation({
      channels: [room('a'), room('b'), room('old', 5)], general: null,
      summaries: [summary('a', 10), summary('b', 20), summary('old', 99)], legacyChannelId: null,
    })).toEqual({ kind: 'open', channelId: 'b' });
  });

  it('6: waits when an active room has no summary yet', () => {
    expect(landingConversation({
      channels: [room('new')], general: null, summaries: [], legacyChannelId: null,
    })).toEqual({ kind: 'wait' });
  });
});
