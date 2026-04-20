/**
 * Integration tests for the 9 v3 IPC handler domains (Task 18).
 *
 * Each domain is covered with a service mock + handler round-trip plus a
 * zod-schema rejection probe against `v3ChannelSchemas` so the router's
 * dev-mode validation guard is exercised without booting Electron.
 *
 * The handlers themselves are thin adapters; the real service behaviour
 * is covered in per-service tests (ApprovalService, QueueService, etc).
 * What we verify here is the contract: input shape → service call →
 * response shape.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ZodError } from 'zod';
import { v3ChannelSchemas } from '../../../shared/ipc-schemas';

import {
  handleArenaRootGet,
  handleArenaRootSet,
  handleArenaRootStatus,
  setArenaRootServiceAccessor,
} from '../handlers/arena-root-handler';
import {
  handleProjectList,
  handleProjectCreate,
  handleProjectLinkExternal,
  handleProjectImport,
  handleProjectUpdate,
  handleProjectArchive,
  handleProjectOpen,
  handleProjectSetAutonomy,
  setProjectServiceAccessor,
} from '../handlers/project-handler';
import {
  handleChannelList,
  handleChannelCreate,
  handleChannelRename,
  handleChannelDelete,
  handleChannelAddMembers,
  handleChannelRemoveMembers,
  handleChannelStartMeeting,
  setChannelServiceAccessor,
  setMeetingServiceAccessor,
} from '../handlers/channel-handler';
import {
  handleMessageAppend,
  handleMessageListByChannel,
  handleMessageListRecent,
  handleMessageSearch,
  setMessageServiceAccessor,
} from '../handlers/message-handler';
import {
  handleMeetingAbort,
  handleMeetingListActive,
  setMeetingAbortServiceAccessor,
} from '../handlers/meeting-handler';
import {
  handleMemberList,
  handleMemberGetProfile,
  handleMemberUpdateProfile,
  handleMemberSetStatus,
  handleMemberReconnect,
  handleMemberListAvatars,
  setMemberProfileServiceAccessor,
} from '../handlers/member-handler';
import {
  handleApprovalList,
  handleApprovalDecide,
  setApprovalServiceAccessor,
} from '../handlers/approval-handler';
import {
  handleNotificationGetPrefs,
  handleNotificationUpdatePrefs,
  handleNotificationTest,
  setNotificationServiceAccessor,
} from '../handlers/notification-handler';
import {
  handleQueueList,
  handleQueueAdd,
  handleQueueReorder,
  handleQueueRemove,
  handleQueueCancel,
  handleQueuePause,
  handleQueueResume,
  setQueueServiceAccessor,
} from '../handlers/queue-handler';

import { providerRegistry } from '../../providers/registry';
import { DEFAULT_AVATARS } from '../../members/default-avatars';

// ───────────────────────────────────────────────────────────────
// arena-root:*
// ───────────────────────────────────────────────────────────────
describe('arena-root handlers', () => {
  it('get/set/status round-trip to ArenaRootService', async () => {
    const svc = {
      getPath: vi.fn().mockReturnValue('/tmp/arena'),
      setPath: vi.fn(),
      getStatus: vi.fn().mockResolvedValue({
        path: '/tmp/arena',
        exists: true,
        writable: true,
        consensusReady: true,
        projectsCount: 2,
      }),
    };
    setArenaRootServiceAccessor(() => svc as never);

    expect(handleArenaRootGet()).toEqual({ path: '/tmp/arena' });

    const setResult = handleArenaRootSet({ path: '/new/path' });
    expect(setResult).toEqual({ success: true, requiresRestart: true });
    expect(svc.setPath).toHaveBeenCalledWith('/new/path');

    const status = await handleArenaRootStatus();
    expect(status.status.projectsCount).toBe(2);
  });

  it('throws when service accessor is not wired', () => {
    setArenaRootServiceAccessor(null as never);
    expect(() => handleArenaRootGet()).toThrow(/not initialized/);
  });

  it('v3 schema rejects empty path on arena-root:set', () => {
    expect(() =>
      v3ChannelSchemas['arena-root:set'].parse({ path: '' }),
    ).toThrow(ZodError);
  });
});

// ───────────────────────────────────────────────────────────────
// project:*
// ───────────────────────────────────────────────────────────────
describe('project handlers', () => {
  const mockProject = {
    id: 'p1',
    slug: 'demo',
    name: 'demo',
    description: '',
    kind: 'new' as const,
    externalLink: null,
    permissionMode: 'hybrid' as const,
    autonomyMode: 'manual' as const,
    status: 'active' as const,
    createdAt: 1,
    archivedAt: null,
  };

  let svc: {
    list: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    archive: ReturnType<typeof vi.fn>;
    open: ReturnType<typeof vi.fn>;
    setAutonomy: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    svc = {
      list: vi.fn().mockReturnValue([
        mockProject,
        { ...mockProject, id: 'p2', status: 'archived' },
      ]),
      create: vi.fn().mockResolvedValue(mockProject),
      update: vi.fn().mockReturnValue(mockProject),
      archive: vi.fn(),
      open: vi.fn(),
      setAutonomy: vi.fn().mockReturnValue(mockProject),
    };
    setProjectServiceAccessor(() => svc as never);
  });

  it('list filters archived unless requested', () => {
    expect(handleProjectList(undefined).projects).toHaveLength(1);
    expect(
      handleProjectList({ includeArchived: true }).projects,
    ).toHaveLength(2);
  });

  it('create / link-external / import all funnel through service.create', async () => {
    await handleProjectCreate({
      name: 'a',
      kind: 'new',
      permissionMode: 'hybrid',
    });
    await handleProjectLinkExternal({
      name: 'b',
      externalPath: '/tmp/x',
      permissionMode: 'hybrid',
    });
    await handleProjectImport({
      name: 'c',
      sourcePath: '/tmp/src',
      permissionMode: 'auto',
    });
    expect(svc.create).toHaveBeenCalledTimes(3);
    const calls = svc.create.mock.calls.map((c) => c[0].kind);
    expect(calls).toEqual(['new', 'external', 'imported']);
  });

  it('update/archive/open/set-autonomy delegate to service', () => {
    handleProjectUpdate({ id: 'p1', patch: { name: 'x' } });
    handleProjectArchive({ id: 'p1' });
    handleProjectOpen({ id: 'p1' });
    handleProjectSetAutonomy({ id: 'p1', mode: 'queue' });
    expect(svc.update).toHaveBeenCalledWith('p1', { name: 'x' });
    expect(svc.archive).toHaveBeenCalledWith('p1');
    expect(svc.open).toHaveBeenCalledWith('p1');
    expect(svc.setAutonomy).toHaveBeenCalledWith('p1', 'queue');
  });

  it('v3 schema rejects external+auto on project:create', () => {
    expect(() =>
      v3ChannelSchemas['project:create'].parse({
        name: 'x',
        kind: 'external',
        externalPath: '/tmp/x',
        permissionMode: 'auto',
      }),
    ).toThrow(ZodError);
  });

  it('v3 schema rejects empty patch on project:update', () => {
    expect(() =>
      v3ChannelSchemas['project:update'].parse({ id: 'p1', patch: {} }),
    ).toThrow(ZodError);
  });
});

// ───────────────────────────────────────────────────────────────
// channel:* + meeting:*
// ───────────────────────────────────────────────────────────────
describe('channel + meeting handlers', () => {
  const mockChannel = {
    id: 'c1',
    projectId: 'p1',
    name: '일반',
    kind: 'user' as const,
    readOnly: false,
    createdAt: 1,
  };
  const mockMeeting = {
    id: 'm1',
    channelId: 'c1',
    topic: 't',
    state: 'CONVERSATION' as const,
    stateSnapshotJson: null,
    startedAt: 1,
    endedAt: null,
    outcome: null,
  };

  let channelSvc: {
    listByProject: ReturnType<typeof vi.fn>;
    listDms: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    createDm: ReturnType<typeof vi.fn>;
    rename: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    addMember: ReturnType<typeof vi.fn>;
    removeMember: ReturnType<typeof vi.fn>;
  };
  let meetingSvc: {
    start: ReturnType<typeof vi.fn>;
    finish: ReturnType<typeof vi.fn>;
    listActive: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    channelSvc = {
      listByProject: vi.fn().mockReturnValue([mockChannel]),
      listDms: vi.fn().mockReturnValue([]),
      create: vi.fn().mockReturnValue(mockChannel),
      createDm: vi.fn().mockReturnValue({ ...mockChannel, kind: 'dm' }),
      rename: vi.fn().mockReturnValue({ ...mockChannel, name: 'rn' }),
      delete: vi.fn(),
      addMember: vi.fn(),
      removeMember: vi.fn(),
    };
    meetingSvc = {
      start: vi.fn().mockReturnValue(mockMeeting),
      finish: vi.fn().mockReturnValue({
        ...mockMeeting,
        endedAt: 2,
        outcome: 'aborted',
      }),
      listActive: vi.fn().mockReturnValue([]),
    };
    setChannelServiceAccessor(() => channelSvc as never);
    setMeetingServiceAccessor(() => meetingSvc as never);
    setMeetingAbortServiceAccessor(() => meetingSvc as never);
  });

  it('list routes null projectId to DMs', () => {
    handleChannelList({ projectId: null });
    expect(channelSvc.listDms).toHaveBeenCalled();
    handleChannelList({ projectId: 'p1' });
    expect(channelSvc.listByProject).toHaveBeenCalledWith('p1');
  });

  it('create: user vs. dm route to distinct methods; system rejected', () => {
    handleChannelCreate({
      projectId: 'p1',
      name: 'devops',
      kind: 'user',
      memberProviderIds: ['ai-1'],
    });
    expect(channelSvc.create).toHaveBeenCalled();

    handleChannelCreate({
      projectId: null,
      name: 'dm:ai-1',
      kind: 'dm',
      memberProviderIds: ['ai-1'],
    });
    expect(channelSvc.createDm).toHaveBeenCalledWith('ai-1');

    expect(() =>
      handleChannelCreate({
        projectId: 'p1',
        name: '일반',
        kind: 'system_general',
        memberProviderIds: [],
      }),
    ).toThrow(/auto-created/);
  });

  it('rename / delete / add-members / remove-members delegate', () => {
    handleChannelRename({ id: 'c1', name: 'rn' });
    expect(channelSvc.rename).toHaveBeenCalledWith('c1', 'rn');

    handleChannelDelete({ id: 'c1' });
    expect(channelSvc.delete).toHaveBeenCalledWith('c1');

    handleChannelAddMembers({ id: 'c1', providerIds: ['a', 'b'] });
    expect(channelSvc.addMember).toHaveBeenCalledTimes(2);

    handleChannelRemoveMembers({ id: 'c1', providerIds: ['a'] });
    expect(channelSvc.removeMember).toHaveBeenCalledWith('c1', 'a');
  });

  it('start-meeting / meeting:abort round-trip', () => {
    handleChannelStartMeeting({ channelId: 'c1', topic: 't' });
    expect(meetingSvc.start).toHaveBeenCalledWith({
      channelId: 'c1',
      topic: 't',
    });

    handleMeetingAbort({ meetingId: 'm1' });
    expect(meetingSvc.finish).toHaveBeenCalledWith('m1', 'aborted', null);
  });

  it('meeting:list-active forwards optional limit to the service', () => {
    handleMeetingListActive(undefined);
    expect(meetingSvc.listActive).toHaveBeenLastCalledWith(undefined);

    handleMeetingListActive({ limit: 7 });
    expect(meetingSvc.listActive).toHaveBeenLastCalledWith(7);
  });
});

// ───────────────────────────────────────────────────────────────
// message:*
// ───────────────────────────────────────────────────────────────
describe('message handlers', () => {
  let svc: {
    append: ReturnType<typeof vi.fn>;
    listByChannel: ReturnType<typeof vi.fn>;
    listRecent: ReturnType<typeof vi.fn>;
    search: ReturnType<typeof vi.fn>;
  };
  beforeEach(() => {
    svc = {
      append: vi.fn().mockReturnValue({ id: 'msg', content: 'x' }),
      listByChannel: vi.fn().mockReturnValue([]),
      listRecent: vi.fn().mockReturnValue([]),
      search: vi.fn().mockReturnValue([]),
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
    });
  });

  it('search branches on scope discriminator', () => {
    handleMessageSearch({
      query: 'q',
      scope: { kind: 'channel', channelId: 'c' },
      limit: 5,
    });
    expect(svc.search).toHaveBeenLastCalledWith('q', {
      channelId: 'c',
      limit: 5,
    });

    handleMessageSearch({
      query: 'q',
      scope: { kind: 'project', projectId: 'p' },
    });
    expect(svc.search).toHaveBeenLastCalledWith('q', {
      projectId: 'p',
      limit: undefined,
    });
  });

  it('v3 schema rejects empty content on message:append', () => {
    expect(() =>
      v3ChannelSchemas['message:append'].parse({
        channelId: 'c',
        content: '',
      }),
    ).toThrow(ZodError);
  });

  it('message:list-recent forwards optional limit to the service', () => {
    handleMessageListRecent(undefined);
    expect(svc.listRecent).toHaveBeenLastCalledWith(undefined);

    handleMessageListRecent({ limit: 5 });
    expect(svc.listRecent).toHaveBeenLastCalledWith(5);
  });
});

// ───────────────────────────────────────────────────────────────
// member:*
// ───────────────────────────────────────────────────────────────
describe('member handlers', () => {
  const profile = {
    providerId: 'ai-1',
    role: '',
    personality: '',
    expertise: '',
    avatarKind: 'default' as const,
    avatarData: null,
    statusOverride: null,
    updatedAt: 0,
  };

  let svc: {
    getProfile: ReturnType<typeof vi.fn>;
    getView: ReturnType<typeof vi.fn>;
    updateProfile: ReturnType<typeof vi.fn>;
    setStatus: ReturnType<typeof vi.fn>;
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
      setStatus: vi.fn(),
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

  it('get-profile / update-profile / set-status / reconnect delegate', async () => {
    handleMemberGetProfile({ providerId: 'ai-1' });
    handleMemberUpdateProfile({
      providerId: 'ai-1',
      patch: { role: 'dev' },
    });
    handleMemberSetStatus({
      providerId: 'ai-1',
      status: 'offline-manual',
    });
    const rc = await handleMemberReconnect({ providerId: 'ai-1' });
    expect(rc.status).toBe('online');
    expect(svc.getProfile).toHaveBeenCalled();
    expect(svc.updateProfile).toHaveBeenCalledWith('ai-1', { role: 'dev' });
    expect(svc.setStatus).toHaveBeenCalledWith('ai-1', 'offline-manual');
  });

  it('list-avatars returns the default palette', () => {
    const res = handleMemberListAvatars();
    expect(res.avatars).toHaveLength(DEFAULT_AVATARS.length);
    expect(res.avatars[0]).toHaveProperty('key');
    expect(res.avatars[0]).toHaveProperty('label');
  });
});

// ───────────────────────────────────────────────────────────────
// approval:*
// ───────────────────────────────────────────────────────────────
describe('approval handlers', () => {
  let svc: {
    list: ReturnType<typeof vi.fn>;
    decide: ReturnType<typeof vi.fn>;
  };
  beforeEach(() => {
    svc = { list: vi.fn().mockReturnValue([]), decide: vi.fn() };
    setApprovalServiceAccessor(() => svc as never);
  });

  it('list forwards filters verbatim', () => {
    handleApprovalList({ status: 'pending', projectId: 'p1' });
    expect(svc.list).toHaveBeenCalledWith({
      status: 'pending',
      projectId: 'p1',
    });
    handleApprovalList(undefined);
    expect(svc.list).toHaveBeenLastCalledWith({
      status: undefined,
      projectId: undefined,
    });
  });

  it('decide delegates', () => {
    handleApprovalDecide({
      id: 'a1',
      decision: 'conditional',
      comment: 'ok but fix x',
    });
    expect(svc.decide).toHaveBeenCalledWith(
      'a1',
      'conditional',
      'ok but fix x',
    );
  });

  it('v3 schema requires comment on conditional', () => {
    expect(() =>
      v3ChannelSchemas['approval:decide'].parse({
        id: 'a1',
        decision: 'conditional',
      }),
    ).toThrow(ZodError);
  });
});

// ───────────────────────────────────────────────────────────────
// notification:*
// ───────────────────────────────────────────────────────────────
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
    handleNotificationTest({ kind: 'queue_progress' });
    expect(svc.test).toHaveBeenCalledWith('queue_progress');
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

// ───────────────────────────────────────────────────────────────
// queue:*
// ───────────────────────────────────────────────────────────────
describe('queue handlers', () => {
  const queueItem = {
    id: 'q1',
    projectId: 'p1',
    targetChannelId: null,
    orderIndex: 1000,
    prompt: 'run tests',
    status: 'pending' as const,
    startedMeetingId: null,
    startedAt: null,
    finishedAt: null,
    lastError: null,
    createdAt: 1,
  };

  let svc: {
    listByProject: ReturnType<typeof vi.fn>;
    add: ReturnType<typeof vi.fn>;
    reorder: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
    pause: ReturnType<typeof vi.fn>;
    resume: ReturnType<typeof vi.fn>;
  };
  beforeEach(() => {
    svc = {
      listByProject: vi.fn().mockReturnValue([queueItem]),
      add: vi.fn().mockReturnValue(queueItem),
      reorder: vi.fn(),
      remove: vi.fn(),
      cancel: vi.fn(),
      pause: vi.fn().mockReturnValue(3),
      resume: vi.fn().mockReturnValue(2),
    };
    setQueueServiceAccessor(() => svc as never);
  });

  it('all 7 ops delegate with correct shape', () => {
    expect(handleQueueList({ projectId: 'p1' }).items).toHaveLength(1);
    handleQueueAdd({ projectId: 'p1', prompt: 'x' });
    handleQueueReorder({ projectId: 'p1', orderedIds: ['q1', 'q2'] });
    handleQueueRemove({ id: 'q1' });
    handleQueueCancel({ id: 'q1' });
    handleQueuePause({ projectId: 'p1' });
    handleQueueResume({ projectId: 'p1' });

    expect(svc.add).toHaveBeenCalledWith({
      projectId: 'p1',
      prompt: 'x',
      targetChannelId: null,
    });
    expect(svc.reorder).toHaveBeenCalledWith('p1', ['q1', 'q2']);
    expect(svc.remove).toHaveBeenCalledWith('q1');
    expect(svc.cancel).toHaveBeenCalledWith('q1');
    expect(svc.pause).toHaveBeenCalledWith('p1');
    expect(svc.resume).toHaveBeenCalledWith('p1');
  });

  it('v3 schema rejects empty orderedIds on queue:reorder', () => {
    expect(() =>
      v3ChannelSchemas['queue:reorder'].parse({
        projectId: 'p1',
        orderedIds: [],
      }),
    ).toThrow(ZodError);
  });

  it('v3 schema rejects prompt over 20000 chars on queue:add', () => {
    expect(() =>
      v3ChannelSchemas['queue:add'].parse({
        projectId: 'p1',
        prompt: 'x'.repeat(20_001),
      }),
    ).toThrow(ZodError);
  });
});
