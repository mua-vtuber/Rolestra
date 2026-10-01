import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ZodError } from 'zod';
import { v3ChannelSchemas } from '../../../shared/ipc-schemas';
import {
  handleMessageAppend, handleMessageListByChannel,
  handleMessageSearch, setMessageServiceAccessor,
} from '../handlers/message-handler';
import {
  handleMemberList, handleMemberGetProfile, handleMemberUpdateProfile,
  handleMemberReconnect, handleMemberListAvatars,
  setMemberProfileServiceAccessor,
} from '../handlers/member-handler';
import {
  handleNotificationGetPrefs, handleNotificationUpdatePrefs,
  handleNotificationTest, setNotificationServiceAccessor,
} from '../handlers/notification-handler';
import { providerRegistry } from '../../providers/registry';
import { DEFAULT_AVATARS } from '../../members/default-avatars';

describe('message handlers', () => {
  let svc: {
    append: ReturnType<typeof vi.fn>;
    listByChannel: ReturnType<typeof vi.fn>;
    searchWithContext: ReturnType<typeof vi.fn>;
  };
  beforeEach(() => {
    svc = {
      append: vi.fn().mockReturnValue({ id: 'msg', content: 'x' }),
      listByChannel: vi.fn().mockReturnValue([]),
      searchWithContext: vi.fn().mockReturnValue([]),
    };
    setMessageServiceAccessor(() => svc as never);
  });

  it('append forces author_kind=user + author_id=user', () => {
    handleMessageAppend({
      channelId: 'c',
      content: 'hi',
      mentions: ['ai-1'],
    });
    const call = svc.append.mock.calls[0][0];
    expect(call.authorId).toBe('user');
    expect(call.authorKind).toBe('user');
    expect(call.meta).toEqual({ mentions: ['ai-1'] });
  });

  it('list-by-channel forwards cursor args', () => {
    handleMessageListByChannel({
      channelId: 'c',
      limit: 10,
      beforeCreatedAt: 123,
    });
    expect(svc.listByChannel).toHaveBeenCalledWith('c', {
      limit: 10,
      before: 123,
      beforeMessageId: undefined,
    }, { kind: 'observer' });
  });

  it('search branches on scope discriminator', () => {
    handleMessageSearch({
      query: 'q',
      scope: { kind: 'channel', channelId: 'c' },
      limit: 5,
    });
    expect(svc.searchWithContext).toHaveBeenLastCalledWith('q', {
      channelId: 'c',
      limit: 5,
    }, { kind: 'observer' });

  });

  it('v3 schema rejects empty content on message:append', () => {
    expect(() =>
      v3ChannelSchemas['message:append'].parse({
        channelId: 'c',
        content: '',
      }),
    ).toThrow(ZodError);
  });

});

// ───────────────────────────────────────────────────────────────
// member:*
// ───────────────────────────────────────────────────────────────
describe('member handlers', () => {
  const profile = {
    providerId: 'ai-1',
    characterSheet: '',
    avatarKind: 'default' as const,
    avatarData: null,
    statusOverride: null,
    updatedAt: 0,
  };

  let svc: {
    getProfile: ReturnType<typeof vi.fn>;
    getView: ReturnType<typeof vi.fn>;
    updateProfile: ReturnType<typeof vi.fn>;
    reconnect: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    svc = {
      getProfile: vi.fn().mockReturnValue(profile),
      getView: vi.fn().mockReturnValue({
        ...profile,
        displayName: 'AI-1',
        persona: '',
        workStatus: 'online',
      }),
      updateProfile: vi.fn().mockReturnValue(profile),
      reconnect: vi.fn().mockResolvedValue('online'),
    };
    setMemberProfileServiceAccessor(() => svc as never);
    // listAll is a method on the provider registry — stub it for the test.
    vi.spyOn(providerRegistry, 'listAll').mockReturnValue([
      { id: 'ai-1', displayName: 'AI-1' } as never,
    ]);
  });

  it('list fuses registry + getView', () => {
    const result = handleMemberList();
    expect(result.members).toHaveLength(1);
    expect(svc.getView).toHaveBeenCalledWith('ai-1');
  });

  it('get-profile / update-profile / reconnect delegate', async () => {
    handleMemberGetProfile({ providerId: 'ai-1' });
    handleMemberUpdateProfile({
      providerId: 'ai-1',
      patch: { characterSheet: 'dev' },
    });
    const rc = await handleMemberReconnect({ providerId: 'ai-1' });
    expect(rc.status).toBe('online');
    expect(svc.getProfile).toHaveBeenCalled();
    expect(svc.updateProfile).toHaveBeenCalledWith('ai-1', { characterSheet: 'dev' });
  });

  it('list-avatars returns the default palette', () => {
    const res = handleMemberListAvatars();
    expect(res.avatars).toHaveLength(DEFAULT_AVATARS.length);
    expect(res.avatars[0]).toHaveProperty('key');
    expect(res.avatars[0]).toHaveProperty('label');
  });
});

describe('notification handlers', () => {
  const fullPrefs = {
    new_message: { enabled: true, soundEnabled: true },
    approval_pending: { enabled: true, soundEnabled: true },
    work_done: { enabled: true, soundEnabled: true },
    error: { enabled: true, soundEnabled: true },
    queue_progress: { enabled: true, soundEnabled: true },
    meeting_state: { enabled: true, soundEnabled: true },
  };

  let svc: {
    getPrefs: ReturnType<typeof vi.fn>;
    updatePrefs: ReturnType<typeof vi.fn>;
    test: ReturnType<typeof vi.fn>;
  };
  beforeEach(() => {
    svc = {
      getPrefs: vi.fn().mockReturnValue(fullPrefs),
      updatePrefs: vi.fn().mockReturnValue(fullPrefs),
      test: vi.fn(),
    };
    setNotificationServiceAccessor(() => svc as never);
  });

  it('update-prefs merges patch onto current prefs', () => {
    handleNotificationUpdatePrefs({
      patch: { new_message: { enabled: false } },
    });
    const merged = svc.updatePrefs.mock.calls[0][0];
    expect(merged.new_message).toEqual({
      enabled: false,
      soundEnabled: true,
    });
  });

  it('test delegates with kind', () => {
    handleNotificationTest({ kind: 'error' });
    expect(svc.test).toHaveBeenCalledWith('error');
  });

  it('get-prefs returns full map', () => {
    expect(handleNotificationGetPrefs().prefs).toEqual(fullPrefs);
  });

  it('v3 schema rejects empty patch on notification:update-prefs', () => {
    expect(() =>
      v3ChannelSchemas['notification:update-prefs'].parse({ patch: {} }),
    ).toThrow(ZodError);
  });
});
