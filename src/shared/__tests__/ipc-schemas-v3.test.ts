import { describe, it, expect } from 'vitest';
import {
  projectCreateSchema,
  projectLinkExternalSchema,
  projectUpdateSchema,
  channelCreateSchema,
  messageAppendSchema,
  messageSearchSchema,
  approvalDecideSchema,
  queueAddSchema,
  queueReorderSchema,
  queueListSchema,
  queueItemIdSchema,
  queuePauseResumeSchema,
  notificationGetPrefsSchema,
  notificationUpdatePrefsSchema,
  notificationTestSchema,
  meetingAbortSchema,
  meetingListActiveSchema,
  messageListRecentSchema,
  memberSetStatusSchema,
  memberUploadAvatarSchema,
  projectSetAutonomySchema,
  v3ChannelSchemas,
} from '../ipc-schemas';

describe('v3 IPC schemas — projectCreateSchema', () => {
  it('rejects external + auto (spec §7.3 / CA-1)', () => {
    const result = projectCreateSchema.safeParse({
      name: 'X',
      kind: 'external',
      externalPath: '/tmp/x',
      permissionMode: 'auto',
    });
    expect(result.success).toBe(false);
  });

  it('accepts external + hybrid with externalPath', () => {
    const result = projectCreateSchema.safeParse({
      name: 'X',
      kind: 'external',
      externalPath: '/tmp/x',
      permissionMode: 'hybrid',
    });
    expect(result.success).toBe(true);
  });

  it('accepts new + auto (no path required)', () => {
    const result = projectCreateSchema.safeParse({
      name: 'X',
      kind: 'new',
      permissionMode: 'auto',
    });
    expect(result.success).toBe(true);
  });

  it('rejects external without externalPath', () => {
    const result = projectCreateSchema.safeParse({
      name: 'X',
      kind: 'external',
      permissionMode: 'hybrid',
    });
    expect(result.success).toBe(false);
  });

  it('rejects imported without sourcePath', () => {
    const result = projectCreateSchema.safeParse({
      name: 'X',
      kind: 'imported',
      permissionMode: 'approval',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty name', () => {
    const result = projectCreateSchema.safeParse({
      name: '',
      kind: 'new',
      permissionMode: 'auto',
    });
    expect(result.success).toBe(false);
  });
});

describe('v3 IPC schemas — projectLinkExternalSchema', () => {
  it('accepts hybrid and approval modes', () => {
    expect(
      projectLinkExternalSchema.safeParse({
        name: 'P',
        externalPath: '/tmp/p',
        permissionMode: 'hybrid',
      }).success,
    ).toBe(true);
    expect(
      projectLinkExternalSchema.safeParse({
        name: 'P',
        externalPath: '/tmp/p',
        permissionMode: 'approval',
      }).success,
    ).toBe(true);
  });

  it('rejects auto mode (external + auto forbidden)', () => {
    const result = projectLinkExternalSchema.safeParse({
      name: 'P',
      externalPath: '/tmp/p',
      permissionMode: 'auto',
    });
    expect(result.success).toBe(false);
  });
});

describe('v3 IPC schemas — projectUpdateSchema', () => {
  it('rejects empty patch', () => {
    const result = projectUpdateSchema.safeParse({ id: 'p1', patch: {} });
    expect(result.success).toBe(false);
  });

  it('accepts single-field patch', () => {
    const result = projectUpdateSchema.safeParse({
      id: 'p1',
      patch: { name: 'renamed' },
    });
    expect(result.success).toBe(true);
  });
});

describe('v3 IPC schemas — channelCreateSchema', () => {
  it('accepts null projectId (DM channel)', () => {
    const result = channelCreateSchema.safeParse({
      projectId: null,
      name: 'dm-a',
      kind: 'dm',
      memberProviderIds: ['p1', 'p2'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects unknown channel kind', () => {
    const result = channelCreateSchema.safeParse({
      projectId: 'proj1',
      name: 'c',
      kind: 'bogus',
      memberProviderIds: [],
    });
    expect(result.success).toBe(false);
  });
});

describe('v3 IPC schemas — messageAppendSchema', () => {
  it('accepts basic append', () => {
    const result = messageAppendSchema.safeParse({
      channelId: 'c1',
      content: 'hello',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty content', () => {
    const result = messageAppendSchema.safeParse({
      channelId: 'c1',
      content: '',
    });
    expect(result.success).toBe(false);
  });
});

describe('v3 IPC schemas — messageSearchSchema', () => {
  it('accepts channel scope', () => {
    const result = messageSearchSchema.safeParse({
      query: 'bug',
      scope: { kind: 'channel', channelId: 'c1' },
    });
    expect(result.success).toBe(true);
  });

  it('accepts project scope with limit', () => {
    const result = messageSearchSchema.safeParse({
      query: 'bug',
      scope: { kind: 'project', projectId: 'p1' },
      limit: 50,
    });
    expect(result.success).toBe(true);
  });

  it('rejects scope with wrong discriminator', () => {
    const result = messageSearchSchema.safeParse({
      query: 'bug',
      scope: { kind: 'invalid', channelId: 'c1' },
    });
    expect(result.success).toBe(false);
  });
});

describe('v3 IPC schemas — approvalDecideSchema', () => {
  it('accepts approve without comment', () => {
    const result = approvalDecideSchema.safeParse({
      id: 'a1',
      decision: 'approve',
    });
    expect(result.success).toBe(true);
  });

  it('requires comment when decision=conditional', () => {
    const fail = approvalDecideSchema.safeParse({
      id: 'a1',
      decision: 'conditional',
    });
    expect(fail.success).toBe(false);

    const ok = approvalDecideSchema.safeParse({
      id: 'a1',
      decision: 'conditional',
      comment: 'only if tests pass',
    });
    expect(ok.success).toBe(true);
  });

  it('caps comment at 4000 chars', () => {
    const result = approvalDecideSchema.safeParse({
      id: 'a1',
      decision: 'reject',
      comment: 'x'.repeat(4001),
    });
    expect(result.success).toBe(false);
  });
});

describe('v3 IPC schemas — queueAddSchema / queueReorderSchema', () => {
  it('queueAddSchema accepts minimum payload', () => {
    const result = queueAddSchema.safeParse({
      projectId: 'p1',
      prompt: 'run tests',
    });
    expect(result.success).toBe(true);
  });

  it('queueReorderSchema rejects empty orderedIds', () => {
    const result = queueReorderSchema.safeParse({
      projectId: 'p1',
      orderedIds: [],
    });
    expect(result.success).toBe(false);
  });
});

describe('v3 IPC schemas — notificationUpdatePrefsSchema', () => {
  it('accepts partial per-kind update', () => {
    const result = notificationUpdatePrefsSchema.safeParse({
      patch: { new_message: { enabled: false } },
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty patch', () => {
    const result = notificationUpdatePrefsSchema.safeParse({ patch: {} });
    expect(result.success).toBe(false);
  });

  it('rejects empty pref value object', () => {
    const result = notificationUpdatePrefsSchema.safeParse({
      patch: { error: {} },
    });
    expect(result.success).toBe(false);
  });
});

describe('v3 IPC schemas — meetingAbortSchema / memberSetStatusSchema', () => {
  it('meetingAbortSchema requires meetingId', () => {
    expect(meetingAbortSchema.safeParse({}).success).toBe(false);
    expect(meetingAbortSchema.safeParse({ meetingId: 'm1' }).success).toBe(true);
  });

  it('memberSetStatusSchema restricts status to online | offline-manual', () => {
    expect(
      memberSetStatusSchema.safeParse({
        providerId: 'p1',
        status: 'online',
      }).success,
    ).toBe(true);
    expect(
      memberSetStatusSchema.safeParse({
        providerId: 'p1',
        status: 'connecting',
      }).success,
    ).toBe(false);
  });
});

describe('v3 IPC schemas — memberUploadAvatarSchema (R8-Task1)', () => {
  it('accepts a well-formed payload with absolute source path', () => {
    const result = memberUploadAvatarSchema.safeParse({
      providerId: 'claude-code',
      sourcePath: '/home/user/Pictures/avatar.png',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty providerId', () => {
    const result = memberUploadAvatarSchema.safeParse({
      providerId: '',
      sourcePath: '/tmp/x.png',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty sourcePath', () => {
    const result = memberUploadAvatarSchema.safeParse({
      providerId: 'p1',
      sourcePath: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects sourcePath beyond 4096 characters (POSIX PATH_MAX baseline)', () => {
    const result = memberUploadAvatarSchema.safeParse({
      providerId: 'p1',
      sourcePath: '/' + 'x'.repeat(4096),
    });
    expect(result.success).toBe(false);
  });

  it('does NOT validate file existence or extension (delegated to AvatarStore — R8-Task5)', () => {
    // schema treats /nonexistent.weird as syntactically valid; AvatarStore
    // produces the actionable error during the actual copy.
    const result = memberUploadAvatarSchema.safeParse({
      providerId: 'p1',
      sourcePath: '/nonexistent/path.weird',
    });
    expect(result.success).toBe(true);
  });
});

describe('v3 IPC schemas — v3ChannelSchemas map', () => {
  it('exposes expected core channels', () => {
    expect(v3ChannelSchemas['project:create']).toBeDefined();
    expect(v3ChannelSchemas['channel:create']).toBeDefined();
    expect(v3ChannelSchemas['message:append']).toBeDefined();
    expect(v3ChannelSchemas['approval:decide']).toBeDefined();
    expect(v3ChannelSchemas['queue:add']).toBeDefined();
    expect(v3ChannelSchemas['notification:update-prefs']).toBeDefined();
    expect(v3ChannelSchemas['meeting:abort']).toBeDefined();
  });

  it('exposes dashboard:get-kpis (R4)', () => {
    expect(v3ChannelSchemas['dashboard:get-kpis']).toBeDefined();
  });

  it('exposes meeting:list-active and message:list-recent (R4 widgets)', () => {
    expect(v3ChannelSchemas['meeting:list-active']).toBeDefined();
    expect(v3ChannelSchemas['message:list-recent']).toBeDefined();
  });

  it('exposes member:upload-avatar (R8-Task1)', () => {
    expect(v3ChannelSchemas['member:upload-avatar']).toBeDefined();
  });
});

describe('v3 IPC schemas — meetingListActiveSchema / messageListRecentSchema', () => {
  it('meetingListActiveSchema accepts an omitted payload (undefined)', () => {
    expect(meetingListActiveSchema.safeParse(undefined).success).toBe(true);
  });

  it('meetingListActiveSchema accepts {} and explicit limit', () => {
    expect(meetingListActiveSchema.safeParse({}).success).toBe(true);
    expect(
      meetingListActiveSchema.safeParse({ limit: 5 }).success,
    ).toBe(true);
  });

  it('meetingListActiveSchema rejects non-positive / oversized limit', () => {
    expect(meetingListActiveSchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(meetingListActiveSchema.safeParse({ limit: -1 }).success).toBe(false);
    expect(meetingListActiveSchema.safeParse({ limit: 999 }).success).toBe(false);
  });

  it('messageListRecentSchema accepts omitted / empty / valid limit', () => {
    expect(messageListRecentSchema.safeParse(undefined).success).toBe(true);
    expect(messageListRecentSchema.safeParse({}).success).toBe(true);
    expect(
      messageListRecentSchema.safeParse({ limit: 25 }).success,
    ).toBe(true);
  });

  it('messageListRecentSchema rejects non-integer limit', () => {
    expect(
      messageListRecentSchema.safeParse({ limit: 1.5 }).success,
    ).toBe(false);
  });
});

describe('v3 IPC schemas — R9 queue / notification / autonomy', () => {
  it('queueListSchema requires projectId', () => {
    expect(queueListSchema.safeParse({ projectId: 'p1' }).success).toBe(true);
    expect(queueListSchema.safeParse({}).success).toBe(false);
    expect(queueListSchema.safeParse({ projectId: '' }).success).toBe(false);
  });

  it('queueItemIdSchema requires id (non-empty)', () => {
    expect(queueItemIdSchema.safeParse({ id: 'q1' }).success).toBe(true);
    expect(queueItemIdSchema.safeParse({}).success).toBe(false);
    expect(queueItemIdSchema.safeParse({ id: '' }).success).toBe(false);
  });

  it('queuePauseResumeSchema requires projectId', () => {
    expect(queuePauseResumeSchema.safeParse({ projectId: 'p1' }).success).toBe(true);
    expect(queuePauseResumeSchema.safeParse({}).success).toBe(false);
  });

  it('notificationGetPrefsSchema accepts undefined only', () => {
    expect(notificationGetPrefsSchema.safeParse(undefined).success).toBe(true);
    expect(notificationGetPrefsSchema.safeParse({}).success).toBe(false);
    expect(notificationGetPrefsSchema.safeParse({ any: 1 }).success).toBe(false);
  });

  it('notificationTestSchema accepts each kind', () => {
    for (const kind of [
      'new_message',
      'approval_pending',
      'work_done',
      'error',
      'queue_progress',
      'meeting_state',
    ] as const) {
      expect(notificationTestSchema.safeParse({ kind }).success).toBe(true);
    }
    expect(notificationTestSchema.safeParse({ kind: 'bogus' }).success).toBe(false);
  });

  it('notificationUpdatePrefsSchema rejects empty patch', () => {
    expect(notificationUpdatePrefsSchema.safeParse({ patch: {} }).success).toBe(false);
    expect(
      notificationUpdatePrefsSchema.safeParse({ patch: { work_done: {} } }).success,
    ).toBe(false); // inner pref patch must not be empty either
    expect(
      notificationUpdatePrefsSchema.safeParse({
        patch: { work_done: { enabled: false } },
      }).success,
    ).toBe(true);
  });

  it('projectSetAutonomySchema accepts 3 modes', () => {
    for (const mode of ['manual', 'auto_toggle', 'queue'] as const) {
      expect(
        projectSetAutonomySchema.safeParse({ id: 'p1', mode }).success,
      ).toBe(true);
    }
    expect(
      projectSetAutonomySchema.safeParse({ id: 'p1', mode: 'bogus' }).success,
    ).toBe(false);
  });

  it('v3ChannelSchemas maps R9 channels (queue:list/remove/cancel/pause/resume + notification:get-prefs)', () => {
    expect(v3ChannelSchemas['queue:list']).toBe(queueListSchema);
    expect(v3ChannelSchemas['queue:remove']).toBe(queueItemIdSchema);
    expect(v3ChannelSchemas['queue:cancel']).toBe(queueItemIdSchema);
    expect(v3ChannelSchemas['queue:pause']).toBe(queuePauseResumeSchema);
    expect(v3ChannelSchemas['queue:resume']).toBe(queuePauseResumeSchema);
    expect(v3ChannelSchemas['notification:get-prefs']).toBe(notificationGetPrefsSchema);
  });
});
