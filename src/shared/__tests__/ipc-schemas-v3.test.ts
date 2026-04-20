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
  notificationUpdatePrefsSchema,
  meetingAbortSchema,
  memberSetStatusSchema,
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
});
