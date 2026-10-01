import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../providers/registry', () => ({
  providerRegistry: {
    listAll: () => [
      { id: 'ai-a', displayName: 'Alice' },
      { id: 'ai-b', displayName: 'Bob' },
    ],
  },
}));

import {
  handleChannelListSummaries,
  handleChannelMarkRead,
  setChannelSummaryRepositoryAccessor,
} from '../channel-summary-handler';
import type { ChannelSummaryRepository } from '../../../channels/channel-summary-repository';
import { v3ChannelSchemas } from '../../../../shared/ipc-schemas';

const repo = {
  listSummaries: vi.fn(() => []),
  markRead: vi.fn(),
};

beforeEach(() => {
  repo.listSummaries.mockClear();
  repo.markRead.mockClear();
  setChannelSummaryRepositoryAccessor(() => repo as unknown as ChannelSummaryRepository);
});

describe('channel:list-summaries', () => {
  it('passes every registered AI as the general channel participants', () => {
    expect(handleChannelListSummaries()).toEqual({ summaries: [] });
    expect(repo.listSummaries).toHaveBeenCalledWith([
      { providerId: 'ai-a', displayName: 'Alice' },
      { providerId: 'ai-b', displayName: 'Bob' },
    ]);
  });

  it('takes no request payload', () => {
    expect(v3ChannelSchemas['channel:list-summaries'].safeParse(undefined).success).toBe(true);
    expect(v3ChannelSchemas['channel:list-summaries'].safeParse({ channelId: 'x' }).success).toBe(false);
  });
});

describe('channel:mark-read', () => {
  it('moves the marker to the given message', () => {
    expect(handleChannelMarkRead({ channelId: 'room-1', messageId: 'm-9' })).toEqual({ success: true });
    expect(repo.markRead).toHaveBeenCalledWith('room-1', 'm-9');
  });

  it('propagates a refusal from the repository', () => {
    repo.markRead.mockImplementationOnce(() => { throw new Error('Message m-9 not found in channel room-1'); });
    expect(() => handleChannelMarkRead({ channelId: 'room-1', messageId: 'm-9' }))
      .toThrow('Message m-9 not found in channel room-1');
  });

  it('requires both ids', () => {
    const schema = v3ChannelSchemas['channel:mark-read'];
    expect(schema.safeParse({ channelId: 'room-1', messageId: 'm-9' }).success).toBe(true);
    expect(schema.safeParse({ channelId: 'room-1' }).success).toBe(false);
    expect(schema.safeParse({ channelId: '', messageId: 'm-9' }).success).toBe(false);
  });
});
