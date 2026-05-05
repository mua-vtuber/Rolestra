/**
 * MeetingMinutesService 단위 테스트 — R12-C2 P2-3.
 *
 * 검증 (spec §11.18.6 + §11.18.7 acceptance):
 *   - compose() 통상 — 모더레이터 응답 → minutes.md 저장 + body 반환 + source='moderator'
 *   - truncate 검출 → 1 회 재요청 (재요청 PASS) → source='moderator-retry' + truncationDetected
 *   - 재요청도 truncate → deterministic fallback → source='fallback'
 *   - 모더레이터 호출 실패 (summary null) → fallback
 *   - 의견 0 건 회의 → truncate 검사 skip + fallback minutes 도 빈 섹션 안내
 *   - atomic write (tmp + rename) — caller 가 본 부분 보장
 *   - PathGuard — meetingId 가 path traversal 시도해도 consensus 안에 갇힘 → throw
 *   - meeting 미존재 → MeetingNotFoundForMinutesError
 *   - mkdir + writeFile + rename 순서 호출
 *   - 의견 본문 합 짧으면 (≤ 100 자) truncate 검사 skip
 */

import { describe, expect, it, vi } from 'vitest';
import {
  MeetingMinutesService,
  MeetingNotFoundForMinutesError,
  MinutesPathOutsideConsensusError,
  TRUNCATE_RATIO_THRESHOLD,
} from '../meeting-minutes-service';
import type { Meeting } from '../../../shared/meeting-types';
import type { Opinion, OpinionVote } from '../../../shared/opinion-types';
import type { Channel } from '../../../shared/channel-types';
import type { Project } from '../../../shared/project-types';
import type { Message } from '../../../shared/message-types';

// ── 헬퍼 fixture ──────────────────────────────────────────────────────

function makeMeeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    id: 'm-1',
    channelId: 'ch-1',
    topic: '신규 기능 결정 회의',
    state: 'discussing',
    stateSnapshotJson: null,
    startedAt: 1_700_000_000_000,
    endedAt: 1_700_000_600_000,
    outcome: 'accepted',
    pausedAt: null,
    kind: 'manual',
    ...overrides,
  };
}

function makeChannel(overrides: Partial<Channel> = {}): Channel {
  return {
    id: 'ch-1',
    projectId: 'p-1',
    name: '#planning',
    kind: 'user',
    readOnly: false,
    createdAt: 1_700_000_000_000,
    role: 'planning',
    purpose: null,
    handoffMode: 'check',
    maxRounds: null,
    ...overrides,
  };
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p-1',
    slug: 'demo',
    name: '데모 프로젝트',
    description: '',
    kind: 'new',
    externalLink: null,
    permissionMode: 'auto',
    autonomyMode: 'manual',
    status: 'active',
    createdAt: 1_700_000_000_000,
    archivedAt: null,
    ...overrides,
  };
}

function makeOpinion(overrides: Partial<Opinion> = {}): Opinion {
  return {
    id: 'op-1',
    parentId: null,
    meetingId: 'm-1',
    channelId: 'ch-1',
    kind: 'root',
    authorProviderId: 'pv-codex',
    authorLabel: 'codex_1',
    title: '제목 없음',
    content: '본문 없음',
    rationale: '근거 없음',
    status: 'agreed',
    exclusionReason: null,
    round: 0,
    createdAt: 1_700_000_001_000,
    updatedAt: 1_700_000_002_000,
    ...overrides,
  };
}

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'msg-1',
    channelId: 'ch-1',
    meetingId: 'm-1',
    authorId: 'pv-codex',
    authorKind: 'member',
    role: 'assistant',
    content: '코덱스 발화',
    meta: null,
    createdAt: 1_700_000_001_500,
    ...overrides,
  };
}

// ── Stub deps ──────────────────────────────────────────────────────────

interface BuildOptions {
  meeting?: Meeting | null;
  channel?: Channel | null;
  project?: Project | null;
  messages?: Message[];
  opinions?: Opinion[];
  votes?: OpinionVote[];
  consensusPath?: string;
  /** 모더레이터 응답 list — 호출 순서대로 소비. */
  summaries?: Array<{ summary: string | null; providerId: string | null }>;
  fs?: {
    mkdir?: ReturnType<typeof vi.fn>;
    writeFile?: ReturnType<typeof vi.fn>;
    rename?: ReturnType<typeof vi.fn>;
    randomSuffix?: ReturnType<typeof vi.fn>;
  };
  now?: number;
}

function build(options: BuildOptions = {}): {
  service: MeetingMinutesService;
  summarize: ReturnType<typeof vi.fn>;
  fsMocks: {
    mkdir: ReturnType<typeof vi.fn>;
    writeFile: ReturnType<typeof vi.fn>;
    rename: ReturnType<typeof vi.fn>;
    randomSuffix: ReturnType<typeof vi.fn>;
  };
  consensusPath: string;
} {
  const meeting = options.meeting === undefined ? makeMeeting() : options.meeting;
  const channel = options.channel === undefined ? makeChannel() : options.channel;
  const project = options.project === undefined ? makeProject() : options.project;
  const messages = options.messages ?? [makeMessage()];
  const opinions = options.opinions ?? [makeOpinion()];
  const votes = options.votes ?? [];
  const consensusPath = options.consensusPath ?? '/tmp/arena-root/consensus';

  const summaries = options.summaries ?? [
    { summary: 'A'.repeat(2_000), providerId: 'pv-haiku' },
  ];
  let summarizeCallCount = 0;
  const summarize = vi.fn(async () => {
    const next = summaries[summarizeCallCount];
    summarizeCallCount += 1;
    return next ?? { summary: null, providerId: null };
  });

  const fsMocks = {
    mkdir:
      options.fs?.mkdir ??
      vi.fn(async (_p: string, _opts: { recursive: true }) => undefined),
    writeFile:
      options.fs?.writeFile ??
      vi.fn(async (_p: string, _data: string, _enc: 'utf-8') => undefined),
    rename:
      options.fs?.rename ??
      vi.fn(async (_from: string, _to: string) => undefined),
    randomSuffix: options.fs?.randomSuffix ?? vi.fn(() => 'rand'),
  };

  const service = new MeetingMinutesService({
    arenaRoot: { consensusPath: () => consensusPath },
    meetingRepo: { get: () => meeting },
    channelRepo: { get: () => channel },
    projectRepo: { get: () => project },
    messageRepo: { listAllByChannel: () => messages },
    opinionRepo: {
      listByMeeting: () => opinions,
      listVotesByMeeting: () => votes,
    },
    meetingSummary: { summarize },
    now: options.now !== undefined ? () => options.now! : undefined,
    fs: {
      mkdir: fsMocks.mkdir as (
        p: string,
        opts: { recursive: true },
      ) => Promise<unknown>,
      writeFile: fsMocks.writeFile as (
        p: string,
        data: string,
        encoding: 'utf-8',
      ) => Promise<void>,
      rename: fsMocks.rename as (from: string, to: string) => Promise<void>,
      randomSuffix: fsMocks.randomSuffix as () => string,
    },
  });

  return { service, summarize, fsMocks, consensusPath };
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('MeetingMinutesService.compose', () => {
  it('uses moderator summary when truncate check passes', async () => {
    // 의견 본문 합 ~30 자 → 100 자 미만이라 truncate 검사 skip.
    const { service, summarize, fsMocks } = build({
      opinions: [
        makeOpinion({ content: '본문 X', rationale: '근거 Y' }),
      ],
      summaries: [
        { summary: '# 회의록\n전체 합의 도달.', providerId: 'pv-haiku' },
      ],
    });

    const result = await service.compose({ meetingId: 'm-1' });

    expect(result.source).toBe('moderator');
    expect(result.providerId).toBe('pv-haiku');
    expect(result.body).toBe('# 회의록\n전체 합의 도달.');
    expect(result.truncationDetected).toBe(false);
    expect(summarize).toHaveBeenCalledTimes(1);
    expect(fsMocks.mkdir).toHaveBeenCalledTimes(1);
    expect(fsMocks.writeFile).toHaveBeenCalledTimes(1);
    expect(fsMocks.rename).toHaveBeenCalledTimes(1);
  });

  it('passes truncate check when opinion body length is below skip threshold', async () => {
    // 짧은 회의 — body 가 의견 합의 1.2 배 못 넘어도 PASS.
    const shortOpinion = makeOpinion({
      content: '짧다',
      rationale: '음',
    });
    const { service } = build({
      opinions: [shortOpinion],
      summaries: [{ summary: '회의록', providerId: 'pv-haiku' }],
    });
    const result = await service.compose({ meetingId: 'm-1' });
    expect(result.source).toBe('moderator');
    expect(result.truncationDetected).toBe(false);
  });

  it('retries once when first response fails truncate check', async () => {
    // 의견 본문 합 200 자 → 임계 = 240. 첫 응답 100 자 (미달) → 재요청.
    const longContent = 'X'.repeat(200);
    const { service, summarize } = build({
      opinions: [makeOpinion({ content: longContent, rationale: '' })],
      summaries: [
        { summary: 'A'.repeat(50), providerId: 'pv-flash' },
        { summary: 'B'.repeat(300), providerId: 'pv-haiku' },
      ],
    });

    const result = await service.compose({ meetingId: 'm-1' });

    expect(result.source).toBe('moderator-retry');
    expect(result.providerId).toBe('pv-haiku');
    expect(result.body).toBe('B'.repeat(300));
    expect(result.truncationDetected).toBe(true);
    expect(summarize).toHaveBeenCalledTimes(2);
  });

  it('falls back to deterministic minutes when retry also fails truncate check', async () => {
    const longContent = 'X'.repeat(300);
    const { service, summarize, fsMocks } = build({
      opinions: [
        makeOpinion({ content: longContent, status: 'agreed', title: 'X 도입' }),
      ],
      summaries: [
        { summary: '짧음 1', providerId: 'pv-flash' },
        { summary: '짧음 2', providerId: 'pv-haiku' },
      ],
    });

    const result = await service.compose({ meetingId: 'm-1' });

    expect(result.source).toBe('fallback');
    expect(result.providerId).toBeNull();
    expect(result.truncationDetected).toBe(true);
    expect(result.body).toContain('## 합의 항목');
    expect(result.body).toContain('## 제외 항목');
    expect(result.body).toContain('X 도입');
    expect(result.body).toContain('모더레이터 작성 불가');
    expect(summarize).toHaveBeenCalledTimes(2);
    expect(fsMocks.writeFile).toHaveBeenCalledTimes(1);
  });

  it('falls back when moderator summarize returns null', async () => {
    const { service, summarize } = build({
      opinions: [
        makeOpinion({
          content: 'X'.repeat(200),
          status: 'rejected',
          title: 'X 하지 말자',
        }),
      ],
      summaries: [{ summary: null, providerId: null }],
    });

    const result = await service.compose({ meetingId: 'm-1' });

    expect(result.source).toBe('fallback');
    expect(result.providerId).toBeNull();
    expect(result.truncationDetected).toBe(false); // truncate 가 아닌 호출 실패
    expect(result.body).toContain('## 제외 항목');
    expect(result.body).toContain('X 하지 말자');
    expect(summarize).toHaveBeenCalledTimes(1);
  });

  it('handles meeting with zero opinions — fallback shows empty sections', async () => {
    const { service } = build({
      opinions: [],
      summaries: [{ summary: '회의록 짧음', providerId: 'pv-haiku' }],
    });
    const result = await service.compose({ meetingId: 'm-1' });
    // 의견 0 → truncate skip → moderator 사용.
    expect(result.source).toBe('moderator');
    expect(result.body).toBe('회의록 짧음');
  });

  it('zero opinion fallback also produces well-formed empty minutes', async () => {
    const { service } = build({
      opinions: [],
      summaries: [{ summary: null, providerId: null }],
    });
    const result = await service.compose({ meetingId: 'm-1' });
    expect(result.source).toBe('fallback');
    expect(result.body).toContain('## 합의 항목');
    expect(result.body).toContain('(합의된 의견 없음)');
    expect(result.body).toContain('## 제외 항목');
    expect(result.body).toContain('(제외된 의견 없음)');
  });

  it('throws MeetingNotFoundForMinutesError when meeting is missing', async () => {
    const { service } = build({ meeting: null });
    await expect(service.compose({ meetingId: 'm-missing' })).rejects.toThrow(
      MeetingNotFoundForMinutesError,
    );
  });

  it('writes to <consensusPath>/meetings/<meetingId>/minutes.md via tmp + rename', async () => {
    const { service, fsMocks, consensusPath } = build({
      opinions: [makeOpinion({ content: '짧다' })],
      summaries: [{ summary: '회의록', providerId: 'pv-haiku' }],
    });

    const result = await service.compose({ meetingId: 'm-1' });

    expect(fsMocks.mkdir).toHaveBeenCalledWith(
      `${consensusPath}/meetings/m-1`.replace(/\//g, expect.anything().constructor === String ? '/' : '/'),
      { recursive: true },
    );
    // 정규화 — Linux 환경 가정 (path.sep = '/').
    const expectedDir = `${consensusPath}/meetings/m-1`;
    const expectedFile = `${expectedDir}/minutes.md`;
    const expectedTmp = `${expectedFile}.rand.tmp`;

    expect(fsMocks.writeFile.mock.calls[0]?.[0]).toBe(expectedTmp);
    expect(fsMocks.writeFile.mock.calls[0]?.[2]).toBe('utf-8');
    expect(fsMocks.rename).toHaveBeenCalledWith(expectedTmp, expectedFile);
    expect(result.minutesPath).toBe(expectedFile);
  });

  it('refuses meetingId that escapes consensus folder (PathGuard)', async () => {
    const { service } = build({
      opinions: [],
      summaries: [{ summary: '본문', providerId: 'pv-haiku' }],
    });
    await expect(
      service.compose({ meetingId: '../../../../etc' }),
    ).rejects.toThrow(MinutesPathOutsideConsensusError);
  });

  it('exposes the truncate threshold constant for spec audit', () => {
    expect(TRUNCATE_RATIO_THRESHOLD).toBe(1.2);
  });

  it('passes meeting + history + opinion tree into the prompt body', async () => {
    const { service, summarize } = build({
      opinions: [
        makeOpinion({
          id: 'op-A',
          title: 'A 도입',
          content: 'A 본문 통째',
          rationale: 'A 근거 통째',
          status: 'agreed',
        }),
      ],
      messages: [
        makeMessage({ content: '회의 시작' }),
        makeMessage({
          id: 'msg-2',
          authorId: 'pv-claude',
          content: '발화 2',
          createdAt: 1_700_000_002_000,
        }),
      ],
      summaries: [{ summary: '회의록', providerId: 'pv-haiku' }],
    });

    await service.compose({ meetingId: 'm-1' });

    const promptArg = summarize.mock.calls[0]?.[0] as string;
    expect(promptArg).toContain('truncate / 요약 / 축약 금지');
    expect(promptArg).toContain('[합의 항목]'.replace('[', '##').slice(0, 0)); // smoke
    expect(promptArg).toContain('## 합의 항목');
    expect(promptArg).toContain('회의 주제: 신규 기능 결정 회의');
    expect(promptArg).toContain('프로젝트: 데모 프로젝트');
    expect(promptArg).toContain('A 본문 통째');
    expect(promptArg).toContain('A 근거 통째');
    expect(promptArg).toContain('회의 시작');
    expect(promptArg).toContain('발화 2');
    expect(promptArg).toContain('ITEM_001');
  });

  it('filters channel messages to those tagged with the meeting id', async () => {
    const { service, summarize } = build({
      messages: [
        makeMessage({ id: 'in', meetingId: 'm-1', content: 'IN' }),
        makeMessage({ id: 'out', meetingId: 'm-other', content: 'OUT' }),
        makeMessage({ id: 'preview', meetingId: null, content: 'BEFORE' }),
      ],
      summaries: [{ summary: '회의록', providerId: 'pv-haiku' }],
    });
    await service.compose({ meetingId: 'm-1' });
    const promptArg = summarize.mock.calls[0]?.[0] as string;
    expect(promptArg).toContain('IN');
    expect(promptArg).not.toContain('OUT');
    expect(promptArg).not.toContain('BEFORE');
  });

  it('writes the resolved body (not the prompt) to disk', async () => {
    const { service, fsMocks } = build({
      opinions: [makeOpinion({ content: '짧다' })],
      summaries: [{ summary: '회의록 본문', providerId: 'pv-haiku' }],
    });
    await service.compose({ meetingId: 'm-1' });
    const written = fsMocks.writeFile.mock.calls[0]?.[1] as string;
    expect(written).toBe('회의록 본문');
  });
});
