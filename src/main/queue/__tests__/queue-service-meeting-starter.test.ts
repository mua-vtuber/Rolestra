/**
 * Unit tests for `createDefaultMeetingStarter` (R10-Task4 Part i).
 *
 * Closes R9 Known Concern #1: the production wiring for
 * {@link QueueMeetingStarter}. These tests exercise the helper in
 * isolation with hand-rolled fakes so the assertion is "starter
 * resolves channel, opens meeting, hands the orchestrator factory the
 * right inputs" — not a full integration walk through MeetingService.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createDefaultMeetingStarter,
  QueueMeetingStarterError,
  type DefaultMeetingStarterDeps,
} from '../default-meeting-starter';
import type { Channel } from '../../../shared/channel-types';
import type { Meeting } from '../../../shared/meeting-types';
import type { Project } from '../../../shared/project-types';
import type { ProjectMember } from '../../../shared/project-types';
import type { QueueItem } from '../../../shared/queue-types';

// ── Fakes ──────────────────────────────────────────────────────────────

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p-1',
    slug: 'p-1',
    name: 'Project',
    description: '',
    kind: 'new',
    externalLink: null,
    permissionMode: 'hybrid',
    autonomyMode: 'queue',
    status: 'active',
    createdAt: 1,
    archivedAt: null,
    ...overrides,
  };
}

function makeChannel(overrides: Partial<Channel> = {}): Channel {
  return {
    id: 'c-general',
    projectId: 'p-1',
    name: '일반',
    kind: 'system_general',
    readOnly: false,
    createdAt: 1,
    ...overrides,
  } as Channel;
}

function makeMeeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    id: 'meet-1',
    channelId: 'c-general',
    topic: 'topic',
    state: 'IDLE',
    stateSnapshotJson: null,
    startedAt: 1,
    endedAt: null,
    outcome: null,
    ...overrides,
  } as Meeting;
}

function makeMember(providerId: string): ProjectMember {
  return {
    projectId: 'p-1',
    providerId,
    roleAtProject: null,
    addedAt: 1,
  };
}

function makeQueueItem(overrides: Partial<QueueItem> = {}): QueueItem {
  return {
    id: 'q-1',
    projectId: 'p-1',
    targetChannelId: null,
    orderIndex: 1000,
    prompt: 'do the thing',
    status: 'in_progress',
    startedMeetingId: null,
    startedAt: 1,
    finishedAt: null,
    lastError: null,
    createdAt: 1,
    ...overrides,
  };
}

interface Harness {
  channelService: {
    get: ReturnType<typeof vi.fn>;
    listByProject: ReturnType<typeof vi.fn>;
    listMembers: ReturnType<typeof vi.fn>;
  };
  meetingService: { start: ReturnType<typeof vi.fn> };
  projectService: { get: ReturnType<typeof vi.fn> };
  queueItemLookup: { get: ReturnType<typeof vi.fn> };
  orchestratorFactory: { createAndRun: ReturnType<typeof vi.fn> };
}

interface HarnessOpts {
  project?: Project | null;
  channel?: Channel | null;
  members?: ProjectMember[];
  queueItem?: QueueItem | null;
  channels?: Channel[];
  meeting?: Meeting;
  factoryThrows?: Error;
}

function makeHarness(opts: HarnessOpts = {}): Harness {
  const project = opts.project === undefined ? makeProject() : opts.project;
  const channel = opts.channel === undefined ? makeChannel() : opts.channel;
  const members = opts.members ?? [makeMember('alpha'), makeMember('beta')];
  const queueItem =
    opts.queueItem === undefined ? makeQueueItem() : opts.queueItem;
  const channels = opts.channels ?? [makeChannel()];
  const meeting = opts.meeting ?? makeMeeting();

  return {
    channelService: {
      get: vi.fn().mockReturnValue(channel),
      listByProject: vi.fn().mockReturnValue(channels),
      listMembers: vi.fn().mockReturnValue(members),
    },
    meetingService: {
      start: vi.fn().mockReturnValue(meeting),
    },
    projectService: {
      get: vi.fn().mockReturnValue(project),
    },
    queueItemLookup: {
      get: vi.fn().mockReturnValue(queueItem),
    },
    orchestratorFactory: {
      createAndRun: opts.factoryThrows
        ? vi.fn().mockRejectedValue(opts.factoryThrows)
        : vi.fn().mockResolvedValue(undefined),
    },
  };
}

// ── Tests ──────────────────────────────────────────────────────────────

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  warnSpy.mockRestore();
});

describe('createDefaultMeetingStarter — happy path', () => {
  it('resolves #일반 by default and spawns a meeting via the factory', async () => {
    const h = makeHarness();
    const starter = createDefaultMeetingStarter(h as unknown as DefaultMeetingStarterDeps);

    const result = await starter({
      projectId: 'p-1',
      prompt: 'do the thing',
      queueItemId: 'q-1',
    });

    expect(result.meetingId).toBe('meet-1');
    expect(h.meetingService.start).toHaveBeenCalledWith({
      channelId: 'c-general',
      topic: 'do the thing',
    });
    expect(h.orchestratorFactory.createAndRun).toHaveBeenCalledWith(
      expect.objectContaining({
        meeting: expect.objectContaining({ id: 'meet-1' }),
        projectId: 'p-1',
        topic: 'do the thing',
        participants: [
          expect.objectContaining({ id: 'alpha', isActive: true }),
          expect.objectContaining({ id: 'beta', isActive: true }),
        ],
        ssmCtx: expect.objectContaining({
          meetingId: 'meet-1',
          channelId: 'c-general',
          projectId: 'p-1',
          permissionMode: 'hybrid',
          autonomyMode: 'queue',
        }),
      }),
    );
  });

  it('honours queue_items.targetChannelId when set', async () => {
    const pinned = makeChannel({ id: 'c-plan', name: '계획' });
    const h = makeHarness({
      channels: [makeChannel(), pinned],
      queueItem: makeQueueItem({ targetChannelId: 'c-plan' }),
    });
    h.channelService.get = vi.fn().mockImplementation((id: string) => {
      if (id === 'c-plan') return pinned;
      return null;
    });
    const starter = createDefaultMeetingStarter(h as unknown as DefaultMeetingStarterDeps);

    await starter({ projectId: 'p-1', prompt: 'X', queueItemId: 'q-1' });

    expect(h.channelService.get).toHaveBeenCalledWith('c-plan');
    expect(h.meetingService.start).toHaveBeenCalledWith({
      channelId: 'c-plan',
      topic: 'X',
    });
  });

  it('truncates very long prompts when minting the topic', async () => {
    const long = 'x'.repeat(200);
    const h = makeHarness();
    const starter = createDefaultMeetingStarter(h as unknown as DefaultMeetingStarterDeps);

    await starter({ projectId: 'p-1', prompt: long, queueItemId: 'q-1' });

    const callArgs = h.meetingService.start.mock.calls[0][0];
    expect(callArgs.topic.length).toBeLessThan(long.length);
    expect(callArgs.topic.endsWith('…')).toBe(true);
  });
});

describe('createDefaultMeetingStarter — error surfaces', () => {
  it('throws when the project lookup misses', async () => {
    const h = makeHarness({ project: null });
    const starter = createDefaultMeetingStarter(h as unknown as DefaultMeetingStarterDeps);
    await expect(
      starter({ projectId: 'p-1', prompt: 'X', queueItemId: 'q-1' }),
    ).rejects.toThrow(QueueMeetingStarterError);
  });

  it('throws when there is no #일반 channel and no pinned target', async () => {
    const h = makeHarness({ channels: [] });
    const starter = createDefaultMeetingStarter(h as unknown as DefaultMeetingStarterDeps);
    await expect(
      starter({ projectId: 'p-1', prompt: 'X', queueItemId: 'q-1' }),
    ).rejects.toThrow(QueueMeetingStarterError);
  });

  it('throws when the channel has fewer than 2 members', async () => {
    const h = makeHarness({ members: [makeMember('alpha')] });
    const starter = createDefaultMeetingStarter(h as unknown as DefaultMeetingStarterDeps);
    await expect(
      starter({ projectId: 'p-1', prompt: 'X', queueItemId: 'q-1' }),
    ).rejects.toThrow(/need >= 2/);
  });

  it('propagates a factory-side rejection', async () => {
    const h = makeHarness({ factoryThrows: new Error('boom') });
    const starter = createDefaultMeetingStarter(h as unknown as DefaultMeetingStarterDeps);
    await expect(
      starter({ projectId: 'p-1', prompt: 'X', queueItemId: 'q-1' }),
    ).rejects.toThrow(/boom/);
  });
});
