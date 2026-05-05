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
  // R12-C2 P1.5 — default fixture 가 부서 채널 (kind 'user') 이다. 옛 R10
  // 시점에는 디폴트가 system_general 이었지만 spec §11.3 결정 (일반 채널
  // 회의 X) 이후로 happy path 의 default landing 은 부서 채널이어야 한다.
  // sad path 테스트는 명시적으로 `kind: 'system_general'` 를 override.
  return {
    id: 'c-plan',
    projectId: 'p-1',
    name: '기획',
    kind: 'user',
    readOnly: false,
    createdAt: 1,
    ...overrides,
  } as Channel;
}

function makeMeeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    id: 'meet-1',
    channelId: 'c-plan',
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
  // R12-C2 P1.5 — 디폴트 targetChannelId 가 부서 채널 (c-plan) pin.
  // R10 시점 leftover 였던 "pin 없으면 #일반 fallback" 흐름은 P1.5 가드로
  // throw 가 정답이라 — happy path 테스트는 pin 명시가 정직. 디폴트 pin
  // 없는 시나리오 (fallback 검증) 는 sad path 테스트가 명시적으로
  // override.
  return {
    id: 'q-1',
    projectId: 'p-1',
    targetChannelId: 'c-plan',
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
  it('resolves a 부서 channel by default landing and spawns a meeting via the factory', async () => {
    // R12-C2 P1.5 — default landing 은 부서 채널 (kind 'user') 이어야
    // 한다. 옛 R10 시점에는 #일반 (system_general) 이 default 였지만
    // spec §11.3 결정 (일반 채널 회의 X) 이후로 happy path 가 부서 채널로
    // 흐른다. queue 의 default landing 이 #일반 인 R10 시점 leftover
    // 차단은 별도 sad path 테스트 (아래) 에서 검증.
    const h = makeHarness();
    const starter = createDefaultMeetingStarter(h as unknown as DefaultMeetingStarterDeps);

    const result = await starter({
      projectId: 'p-1',
      prompt: 'do the thing',
      queueItemId: 'q-1',
    });

    expect(result.meetingId).toBe('meet-1');
    expect(h.meetingService.start).toHaveBeenCalledWith({
      channelId: 'c-plan',
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
          channelId: 'c-plan',
          projectId: 'p-1',
          permissionMode: 'hybrid',
          autonomyMode: 'queue',
        }),
      }),
    );
  });

  it('honours queue_items.targetChannelId when set', async () => {
    // 디폴트 fixture (c-plan) 와 충돌 회피 위해 pinned 는 c-design.
    const pinned = makeChannel({ id: 'c-design', name: '디자인' });
    const h = makeHarness({
      channels: [makeChannel(), pinned],
      queueItem: makeQueueItem({ targetChannelId: 'c-design' }),
    });
    h.channelService.get = vi.fn().mockImplementation((id: string) => {
      if (id === 'c-design') return pinned;
      return null;
    });
    const starter = createDefaultMeetingStarter(h as unknown as DefaultMeetingStarterDeps);

    await starter({ projectId: 'p-1', prompt: 'X', queueItemId: 'q-1' });

    expect(h.channelService.get).toHaveBeenCalledWith('c-design');
    expect(h.meetingService.start).toHaveBeenCalledWith({
      channelId: 'c-design',
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
  it('throws QueueMeetingStarterError when default landing is system_general (R12-C2 P1.5)', async () => {
    // R12-C2 P1.5 — queue 의 default landing 이 #일반 (system_general) 인
    // R10 시점 leftover 가 회의 row 신규 생성의 회귀 경로. spec §11.3
    // 결정 (일반 채널 회의 X) 이후로 throw 가 정답. queue runner 가 catch
    // → queue_items.last_error 로 surface 한다. queue 의 default landing
    // 재배선 (부서 채널 자동 트리거) 은 P2 회의 backend 안에서 정식.
    const generalChannel = makeChannel({
      id: 'c-general',
      name: '일반',
      kind: 'system_general',
    });
    const h = makeHarness({
      channel: generalChannel,
      channels: [generalChannel],
      // fallback 경로 검증이라 pin 비움 — resolveChannelId 가 channels 안
      // system_general 을 default landing 으로 잡고, 가드가 그 결과에서 throw.
      queueItem: makeQueueItem({ targetChannelId: null }),
    });
    const starter = createDefaultMeetingStarter(h as unknown as DefaultMeetingStarterDeps);

    await expect(
      starter({ projectId: 'p-1', prompt: 'X', queueItemId: 'q-1' }),
    ).rejects.toThrow(QueueMeetingStarterError);
    // 두 번째 호출도 같은 throw — 가드가 channel.kind 만 보고 단정.
    await expect(
      starter({ projectId: 'p-1', prompt: 'X', queueItemId: 'q-1' }),
    ).rejects.toThrow(/일반 채널/);
    expect(h.meetingService.start).not.toHaveBeenCalled();
  });

  it('throws when the project lookup misses', async () => {
    const h = makeHarness({ project: null });
    const starter = createDefaultMeetingStarter(h as unknown as DefaultMeetingStarterDeps);
    await expect(
      starter({ projectId: 'p-1', prompt: 'X', queueItemId: 'q-1' }),
    ).rejects.toThrow(QueueMeetingStarterError);
  });

  it('throws when there is no #일반 channel and no pinned target', async () => {
    // R12-C2 P1.5 — 디폴트 makeQueueItem 이 pin 을 갖게 됐으므로 *fallback
    // 경로* 검증을 위해 명시적으로 targetChannelId=null 로 override.
    const h = makeHarness({
      channels: [],
      queueItem: makeQueueItem({ targetChannelId: null }),
    });
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
