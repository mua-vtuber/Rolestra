/**
 * MeetingTurnExecutor 단위 테스트 — R12-C2 T10a 통째 재작성.
 *
 * 옛 SSM/getFormatInstruction/lastWorkerSummaryFileName 의존 테스트는
 * 새 모델에서 의미 X — 통째 삭제. phase 별 3 method 의 contract 검증:
 *   - work-status gate skip
 *   - provider lookup 실패
 *   - ok happy-path (schema PASS)
 *   - invalid-schema retry → 2 회 실패 시 skipped
 *   - abort 가드
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MeetingSession } from '../meeting-session';
import {
  MeetingTurnExecutor,
  type MeetingTurnExecutorDeps,
} from '../meeting-turn-executor';
import type { Participant } from '../../../../shared/engine-types';
import type { SsmContext } from '../../../../shared/ssm-context-types';
import type { StreamBridge } from '../../../streams/stream-bridge';
import type { MessageService } from '../../../channels/message-service';
import type { ArenaRootService } from '../../../arena/arena-root-service';
import type { providerRegistry as ProviderRegistryInstance } from '../../../providers/registry';
import type { ApprovalCliAdapter } from '../../../approvals/approval-cli-adapter';

const MEETING_ID = 'mt-1';
const CHANNEL_ID = 'ch-1';
const PROJECT_ID = 'pr-1';

function ctx(): SsmContext {
  return {
    meetingId: MEETING_ID,
    channelId: CHANNEL_ID,
    projectId: PROJECT_ID,
    projectPath: '/tmp/project',
    permissionMode: 'hybrid',
    autonomyMode: 'manual',
  };
}

function participants(count = 2): Participant[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `ai-${i + 1}`,
    providerId: `ai-${i + 1}`,
    displayName: `AI ${i + 1}`,
    isActive: true,
  }));
}

function buildSession(): MeetingSession {
  return new MeetingSession({
    meetingId: MEETING_ID,
    channelId: CHANNEL_ID,
    projectId: PROJECT_ID,
    topic: 'Release planning',
    participants: participants(2),
    ssmCtx: ctx(),
  });
}

/**
 * Minimal provider stub — yields the configured token sequence then ends.
 * `consumeLastTokenUsage` always returns null so the executor uses the
 * `sequence` count as totalTokens fallback.
 */
function makeProvider(tokens: string[]): {
  type: string;
  config: { command: string };
  streamCompletion: ReturnType<typeof vi.fn>;
  consumeLastTokenUsage: ReturnType<typeof vi.fn>;
} {
  return {
    type: 'api',
    config: { command: '' },
    streamCompletion: vi.fn(async function* () {
      for (const t of tokens) yield t;
    }),
    consumeLastTokenUsage: vi.fn(() => null),
  };
}

function buildDeps(
  overrides: Partial<MeetingTurnExecutorDeps> = {},
): MeetingTurnExecutorDeps {
  const streamBridge = {
    emitMeetingTurnStart: vi.fn(),
    emitMeetingTurnToken: vi.fn(),
    emitMeetingTurnDone: vi.fn(),
    emitMeetingError: vi.fn(),
    emitMeetingTurnSkipped: vi.fn(),
  } as unknown as StreamBridge;

  const messageService = {
    append: vi.fn((input) => ({
      id: 'msg-1',
      ...input,
      meta: input.meta ?? null,
      createdAt: Date.now(),
    })),
  } as unknown as MessageService;

  const arenaRootService = {
    getPath: vi.fn(() => '/tmp/arena'),
    consensusPath: vi.fn(() => '/tmp/arena/consensus'),
  } as unknown as ArenaRootService;

  const providerRegistry = {
    get: vi.fn(() => null),
  } as unknown as typeof ProviderRegistryInstance;

  const approvalCliAdapter = {
    createCliPermissionApproval: vi.fn(async () => true),
  } as unknown as ApprovalCliAdapter;

  const memberProfileService = {
    getWorkStatus: vi.fn(() => 'online'),
    buildPersona: vi.fn(() => ''),
  } as unknown as MeetingTurnExecutorDeps['memberProfileService'];

  return {
    session: overrides.session ?? buildSession(),
    streamBridge: overrides.streamBridge ?? streamBridge,
    messageService: overrides.messageService ?? messageService,
    arenaRootService: overrides.arenaRootService ?? arenaRootService,
    providerRegistry: overrides.providerRegistry ?? providerRegistry,
    personaPrimedParticipants:
      overrides.personaPrimedParticipants ?? new Set<string>(),
    approvalCliAdapter: overrides.approvalCliAdapter ?? approvalCliAdapter,
    memberProfileService:
      overrides.memberProfileService ?? memberProfileService,
    circuitBreaker: overrides.circuitBreaker,
  };
}

const speaker: Participant = {
  id: 'ai-1',
  providerId: 'ai-1',
  displayName: 'AI 1',
  isActive: true,
};

describe('MeetingTurnExecutor — work-status gate', () => {
  it('skips with reason=offline and persists a system marker', async () => {
    const memberProfileService = {
      getWorkStatus: vi.fn(() => 'offline-manual'),
      buildPersona: vi.fn(() => ''),
    } as unknown as MeetingTurnExecutorDeps['memberProfileService'];
    const messageAppend = vi.fn((input) => ({
      id: 'msg-1',
      ...input,
      meta: input.meta ?? null,
      createdAt: Date.now(),
    }));
    const messageService = {
      append: messageAppend,
    } as unknown as MessageService;

    const deps = buildDeps({ memberProfileService, messageService });
    const executor = new MeetingTurnExecutor(deps);

    const result = await executor.requestOpinionGather(speaker, {
      suggestedLabel: 'ai-1_1',
    });

    expect(result.kind).toBe('skipped');
    if (result.kind === 'skipped') {
      expect(result.reason).toBe('work-status-gate');
    }
    expect(deps.streamBridge.emitMeetingTurnSkipped).toHaveBeenCalled();
    // 시스템 marker 메시지가 채널 transcript 에 persist 되었는지.
    expect(messageAppend).toHaveBeenCalledWith(
      expect.objectContaining({
        authorKind: 'system',
        role: 'system',
        content: expect.stringContaining('meeting.turnSkipped'),
      }),
    );
  });
});

describe('MeetingTurnExecutor — provider lookup', () => {
  it('returns skipped:provider-error when registry has no provider', async () => {
    const deps = buildDeps();
    const executor = new MeetingTurnExecutor(deps);

    const result = await executor.requestQuickVote(speaker, {
      suggestedLabel: 'ai-1_1',
      opinionsMarkdown: '(empty)',
    });

    expect(result.kind).toBe('skipped');
    if (result.kind === 'skipped') {
      expect(result.reason).toBe('provider-error');
    }
    expect(deps.streamBridge.emitMeetingError).toHaveBeenCalled();
  });
});

describe('MeetingTurnExecutor — ok happy-path', () => {
  it('parses valid Step1OpinionGather JSON and persists assistant', async () => {
    const validJson = JSON.stringify({
      name: 'AI 1',
      label: 'ai-1_1',
      opinions: [
        { title: 't', content: 'c', rationale: 'r' },
      ],
    });
    const provider = makeProvider([validJson]);
    const providerRegistry = {
      get: vi.fn(() => provider),
    } as unknown as typeof ProviderRegistryInstance;

    const deps = buildDeps({ providerRegistry });
    const executor = new MeetingTurnExecutor(deps);

    const result = await executor.requestOpinionGather(speaker, {
      suggestedLabel: 'ai-1_1',
    });

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.payload.opinions[0].title).toBe('t');
    }
    expect(provider.streamCompletion).toHaveBeenCalledTimes(1);
    expect(deps.messageService.append).toHaveBeenCalledWith(
      expect.objectContaining({
        authorKind: 'member',
        role: 'assistant',
      }),
    );
    expect(deps.streamBridge.emitMeetingTurnDone).toHaveBeenCalled();
  });

  it('extracts trailing JSON object after surrounding prose', async () => {
    const valid = JSON.stringify({
      name: 'AI 1',
      label: 'ai-1_1',
      quick_votes: [{ target_id: 'ITEM_001', vote: 'agree' }],
    });
    const messy = `Here is my response\n\`\`\`json\n${valid}\n\`\`\``;
    const provider = makeProvider([messy]);
    const providerRegistry = {
      get: vi.fn(() => provider),
    } as unknown as typeof ProviderRegistryInstance;

    const deps = buildDeps({ providerRegistry });
    const executor = new MeetingTurnExecutor(deps);

    const result = await executor.requestQuickVote(speaker, {
      suggestedLabel: 'ai-1_1',
      opinionsMarkdown: '| ITEM_001 |',
    });
    expect(result.kind).toBe('ok');
  });
});

describe('MeetingTurnExecutor — invalid-schema retry', () => {
  it('retries once then skipped after two invalid responses', async () => {
    const provider = makeProvider(['not json at all']);
    // Both calls return invalid — provider is reused across attempts because
    // streamCompletion is a fresh AsyncGenerator each call.
    const providerRegistry = {
      get: vi.fn(() => provider),
    } as unknown as typeof ProviderRegistryInstance;

    const deps = buildDeps({ providerRegistry });
    const executor = new MeetingTurnExecutor(deps);

    const result = await executor.requestOpinionGather(speaker, {
      suggestedLabel: 'ai-1_1',
    });

    expect(result.kind).toBe('skipped');
    if (result.kind === 'skipped') {
      expect(result.reason).toBe('invalid-schema');
    }
    expect(provider.streamCompletion).toHaveBeenCalledTimes(2);
    expect(deps.streamBridge.emitMeetingError).toHaveBeenCalled();
  });

  it('retries once then succeeds on the second valid response', async () => {
    const valid = JSON.stringify({
      name: 'AI 1',
      label: 'ai-1_1',
      opinions: [],
    });
    let calls = 0;
    const provider = {
      type: 'api',
      config: { command: '' },
      streamCompletion: vi.fn(async function* () {
        calls += 1;
        if (calls === 1) yield 'garbage';
        else yield valid;
      }),
      consumeLastTokenUsage: vi.fn(() => null),
    };
    const providerRegistry = {
      get: vi.fn(() => provider),
    } as unknown as typeof ProviderRegistryInstance;

    const deps = buildDeps({ providerRegistry });
    const executor = new MeetingTurnExecutor(deps);

    const result = await executor.requestOpinionGather(speaker, {
      suggestedLabel: 'ai-1_1',
    });
    expect(result.kind).toBe('ok');
    expect(provider.streamCompletion).toHaveBeenCalledTimes(2);
  });
});

describe('MeetingTurnExecutor — abort guard', () => {
  it('returns skipped:aborted before contacting provider when session.aborted', async () => {
    const session = buildSession();
    session.abort();
    const deps = buildDeps({ session });
    const executor = new MeetingTurnExecutor(deps);

    const result = await executor.requestFreeDiscussion(speaker, {
      suggestedLabel: 'ai-1_1',
      currentOpinionMarkdown: '...',
      childrenMarkdown: '...',
      depthCapReachedScreenIds: [],
    });

    expect(result.kind).toBe('skipped');
    if (result.kind === 'skipped') {
      expect(result.reason).toBe('aborted');
    }
    expect(deps.streamBridge.emitMeetingTurnStart).not.toHaveBeenCalled();
  });
});

describe('MeetingTurnExecutor — basic DI', () => {
  let deps: MeetingTurnExecutorDeps;
  let executor: MeetingTurnExecutor;

  beforeEach(() => {
    deps = buildDeps();
    executor = new MeetingTurnExecutor(deps);
  });

  it('constructs without throwing with all mandatory deps', () => {
    expect(executor).toBeInstanceOf(MeetingTurnExecutor);
  });

  it('abort() is safe to call when no in-flight call', () => {
    expect(() => executor.abort()).not.toThrow();
  });
});
