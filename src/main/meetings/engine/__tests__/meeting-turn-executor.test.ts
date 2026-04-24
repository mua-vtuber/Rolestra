/**
 * MeetingTurnExecutor smoke tests.
 *
 * Full provider streaming is covered via `orchestrator.test` integration
 * in R6-Task4. Here we pin the v3 DI contract + the "provider not found"
 * failure path to lock the bridge in place before MeetingOrchestrator
 * lands.
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
import {
  CircuitBreaker,
  CIRCUIT_BREAKER_FIRED_EVENT,
  type CircuitBreakerFiredEvent,
} from '../../../queue/circuit-breaker';

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

  return {
    session: overrides.session ?? buildSession(),
    streamBridge: overrides.streamBridge ?? streamBridge,
    messageService: overrides.messageService ?? messageService,
    arenaRootService: overrides.arenaRootService ?? arenaRootService,
    providerRegistry: overrides.providerRegistry ?? providerRegistry,
    personaPrimedParticipants:
      overrides.personaPrimedParticipants ?? new Set<string>(),
    approvalCliAdapter: overrides.approvalCliAdapter ?? approvalCliAdapter,
    // R8-Task9: optional — only forwarded when an explicit override is
    // passed (most R7 callers don't supply it and rely on the gate being
    // dormant).
    memberProfileService: overrides.memberProfileService,
    // R9-Task6: optional CircuitBreaker. Dormant by default so existing
    // tests that never installed the breaker continue to run with the
    // recordError hook muted.
    circuitBreaker: overrides.circuitBreaker,
  };
}

describe('MeetingTurnExecutor — DI contract', () => {
  let deps: MeetingTurnExecutorDeps;
  let executor: MeetingTurnExecutor;

  beforeEach(() => {
    deps = buildDeps();
    executor = new MeetingTurnExecutor(deps);
  });

  it('constructs with all required DI fields', () => {
    expect(executor).toBeInstanceOf(MeetingTurnExecutor);
    expect(executor.lastWorkerSummaryFileName).toBeNull();
  });

  it('executeTurn emits meeting-error when provider is missing', async () => {
    const speaker = participants(1)[0];
    await executor.executeTurn(speaker);

    expect(deps.streamBridge.emitMeetingError).toHaveBeenCalledWith(
      expect.objectContaining({
        meetingId: MEETING_ID,
        channelId: CHANNEL_ID,
        fatal: false,
        error: expect.stringContaining('Provider not found'),
      }),
    );
    expect(deps.streamBridge.emitMeetingTurnStart).not.toHaveBeenCalled();
    expect(deps.streamBridge.emitMeetingTurnDone).not.toHaveBeenCalled();
    expect(deps.messageService.append).not.toHaveBeenCalled();
  });

  it('abort() cancels the in-flight turn without throwing', () => {
    expect(() => executor.abort()).not.toThrow();
  });
});

describe('MeetingTurnExecutor — work-status gate (R8-Task9, spec §7.2)', () => {
  function buildWithStatus(
    status: 'online' | 'connecting' | 'offline-connection' | 'offline-manual',
  ): { deps: MeetingTurnExecutorDeps; executor: MeetingTurnExecutor } {
    const memberProfileService = {
      getWorkStatus: vi.fn(() => status),
    } as unknown as NonNullable<MeetingTurnExecutorDeps['memberProfileService']>;
    const deps = buildDeps({ memberProfileService });
    return { deps, executor: new MeetingTurnExecutor(deps) };
  }

  it('online: gate passes — flow proceeds (and falls into "Provider not found" because the test rig has no provider)', async () => {
    const { deps, executor } = buildWithStatus('online');
    await executor.executeTurn(participants(1)[0]);
    // The skip path was NOT taken (no skip event, no skip-marker append).
    expect(deps.streamBridge.emitMeetingTurnSkipped).not.toHaveBeenCalled();
    // The provider lookup falls through to the existing "Provider not found"
    // error path — proves we reached the post-gate code.
    expect(deps.streamBridge.emitMeetingError).toHaveBeenCalled();
  });

  it.each(['connecting', 'offline-connection', 'offline-manual'] as const)(
    '%s: gate skips the turn, emits stream:meeting-turn-skipped, and persists a marker — never emits TURN_DONE/TURN_FAIL',
    async (status) => {
      const { deps, executor } = buildWithStatus(status);
      await executor.executeTurn(participants(1)[0]);

      expect(deps.streamBridge.emitMeetingTurnSkipped).toHaveBeenCalledWith(
        expect.objectContaining({
          meetingId: MEETING_ID,
          channelId: CHANNEL_ID,
          participantId: 'ai-1',
          participantName: 'AI 1',
          reason: status,
        }),
      );
      expect(deps.messageService.append).toHaveBeenCalledWith(
        expect.objectContaining({
          channelId: CHANNEL_ID,
          authorKind: 'system',
          meta: expect.objectContaining({
            turnSkipped: expect.objectContaining({ reason: status }),
          }),
        }),
      );
      // SSM TURN_DONE / TURN_FAIL ARE NOT fired — skip is "this slot is empty"
      expect(deps.streamBridge.emitMeetingTurnStart).not.toHaveBeenCalled();
      expect(deps.streamBridge.emitMeetingTurnDone).not.toHaveBeenCalled();
      expect(deps.streamBridge.emitMeetingError).not.toHaveBeenCalled();
    },
  );

  it('absent memberProfileService: gate is dormant, behaves like R7 (provider lookup fires)', async () => {
    const deps = buildDeps(); // memberProfileService omitted
    const exec = new MeetingTurnExecutor(deps);
    await exec.executeTurn(participants(1)[0]);
    expect(deps.streamBridge.emitMeetingTurnSkipped).not.toHaveBeenCalled();
    expect(deps.streamBridge.emitMeetingError).toHaveBeenCalled();
  });
});

describe('MeetingTurnExecutor — circuit breaker feed (R9-Task6)', () => {
  /**
   * The executor records a categorised error tick whenever
   * `provider.streamCompletion` rejects *and* the turn was not aborted
   * by the user. We drive this path without a real provider by
   * injecting a stub that rejects with a spawn-shaped error, which the
   * classifier maps onto `cli_spawn_failed`.
   */
  it('records a same_error tick on turn failure (non-aborted)', async () => {
    // Reuse an existing speaker id from buildSession() so
    // getMessagesForProvider() finds the participant before the
    // provider stream is invoked.
    const speaker = participants(1)[0];
    const stubProvider = {
      id: speaker.id,
      type: 'api',
      displayName: speaker.displayName,
      persona: '',
      model: 'stub-model',
      // eslint-disable-next-line require-yield
      streamCompletion: vi.fn(async function* () {
        throw new Error('spawn ENOENT claude');
      }),
      consumeLastTokenUsage: vi.fn(() => null),
      // Non-Gemini api config — persona-builder reads .endpoint to
      // decide the Gemini guardrail branch; anything non-Google works.
      config: { type: 'api', endpoint: 'https://api.example.test/v1' },
    };
    const providerRegistry = {
      get: vi.fn(() => stubProvider),
    } as unknown as typeof ProviderRegistryInstance;

    const breaker = new CircuitBreaker();
    const fires: CircuitBreakerFiredEvent[] = [];
    breaker.on(CIRCUIT_BREAKER_FIRED_EVENT, (e) => fires.push(e));

    const deps = buildDeps({ providerRegistry, circuitBreaker: breaker });
    const exec = new MeetingTurnExecutor(deps);

    await exec.executeTurn(speaker);

    // emitMeetingError fires on the same path as recordError — confirm
    // the shared catch block ran.
    expect(deps.streamBridge.emitMeetingError).toHaveBeenCalled();
    // Single spawn failure does not yet cross the same_error threshold
    // (default 3) but the counter must advance to 1 in the cli_spawn_failed
    // bucket.
    expect(breaker.getState().recentErrorCategory).toBe('cli_spawn_failed');
    expect(breaker.getState().recentErrorCount).toBe(1);
    expect(fires).toHaveLength(0);

    // Two more same-category failures cross the threshold.
    await exec.executeTurn(speaker);
    await exec.executeTurn(speaker);

    expect(fires).toHaveLength(1);
    expect(fires[0]!.reason).toBe('same_error');
    expect((fires[0]!.detail as { category: string }).category).toBe(
      'cli_spawn_failed',
    );
  });

  it('does NOT record when the turn is aborted (user gesture)', async () => {
    const speakerParticipant = participants(1)[0];
    // Provider that yields forever until aborted. The test aborts the
    // controller before the first yield so the catch branch sees
    // signal.aborted === true and skips the recordError call.
    const stubProvider = {
      id: speakerParticipant.id,
      type: 'api',
      displayName: speakerParticipant.displayName,
      persona: '',
      model: 'stub-model',
      // eslint-disable-next-line require-yield
      streamCompletion: vi.fn(async function* (
        _messages: unknown,
        _persona: string,
        _opts: unknown,
        signal?: AbortSignal,
      ) {
        await new Promise<void>((_resolve, reject) => {
          if (signal?.aborted) {
            reject(new Error('aborted'));
            return;
          }
          signal?.addEventListener('abort', () => reject(new Error('aborted')));
        });
      }),
      consumeLastTokenUsage: vi.fn(() => null),
      config: { type: 'api', endpoint: 'https://api.example.test/v1' },
    };
    const providerRegistry = {
      get: vi.fn(() => stubProvider),
    } as unknown as typeof ProviderRegistryInstance;

    const breaker = new CircuitBreaker();
    const deps = buildDeps({ providerRegistry, circuitBreaker: breaker });
    const exec = new MeetingTurnExecutor(deps);

    const pending = exec.executeTurn(speakerParticipant);
    exec.abort(); // user gesture flips signal.aborted before rejection.
    await pending;

    expect(breaker.getState().recentErrorCount).toBe(0);
    expect(breaker.getState().recentErrorCategory).toBeNull();
  });
});

describe('MeetingTurnExecutor — format instructions delegate to MessageFormatter', () => {
  it('returns a conversation format string for CONVERSATION state', () => {
    const exec = new MeetingTurnExecutor(buildDeps());
    const text = exec.getFormatInstruction('CONVERSATION', 'AI 1', ['AI 2']);
    expect(typeof text).toBe('string');
    expect(text).not.toBe('');
  });

  it('returns null for unknown / non-output states', () => {
    const exec = new MeetingTurnExecutor(buildDeps());
    const text = exec.getFormatInstruction(
      'SYNTHESIZING' as never,
      'AI 1',
      [],
    );
    expect(text).toBeNull();
  });

  it('EXECUTING state primes a worker-summary filename', () => {
    const exec = new MeetingTurnExecutor(buildDeps());
    exec.getFormatInstruction('EXECUTING', 'AI 1', []);
    expect(exec.lastWorkerSummaryFileName).not.toBeNull();
    expect(exec.lastWorkerSummaryFileName).toMatch(/^work-summary-\d+\.md$/);
  });
});

describe('MeetingTurnExecutor — CLI permission callback (R7-Task3)', () => {
  it('routes CLI permission prompts through ApprovalCliAdapter with v3 context', async () => {
    const createApproval = vi.fn(async () => true);
    const approvalCliAdapter = {
      createCliPermissionApproval: createApproval,
    } as unknown as import('../../../approvals/approval-cli-adapter').ApprovalCliAdapter;

    const exec = new MeetingTurnExecutor(
      buildDeps({ approvalCliAdapter }),
    );
    const speaker: Participant = {
      id: 'provider-claude',
      providerId: 'provider-claude',
      displayName: 'Claude',
      isActive: true,
    };

    // Fake CliProvider that captures the callback the executor installs,
    // then invokes it with a parsed request — no real spawn needed.
    type Callback = (pid: string, req: unknown) => Promise<boolean>;
    const capturedHolder: { current: Callback | null } = { current: null };
    const fakeProvider = {
      setPermissionRequestCallback: (cb: Callback | null): void => {
        capturedHolder.current = cb;
      },
    } as unknown as import('../../../providers/cli/cli-provider').CliProvider;

    // The method is private; reach through the instance typed as unknown.
    type WireCallback = (
      provider: typeof fakeProvider,
      speaker: Participant,
    ) => void;
    const wire = (
      exec as unknown as { wireCliPermissionCallback: WireCallback }
    ).wireCliPermissionCallback.bind(exec);
    wire(fakeProvider, speaker);

    const cb = capturedHolder.current;
    expect(cb).not.toBeNull();
    if (!cb) throw new Error('callback not installed');

    const parsedReq = {
      cliRequestId: 'req-42',
      toolName: 'Edit',
      target: 'src/file.ts',
      description: 'refactor',
      rawLine: '{"type":"permission_request"}',
    };
    const result = await cb('provider-claude', parsedReq);

    expect(result).toBe(true);
    expect(createApproval).toHaveBeenCalledWith({
      meetingId: MEETING_ID,
      channelId: CHANNEL_ID,
      projectId: PROJECT_ID,
      participantId: 'provider-claude',
      participantName: 'Claude',
      request: parsedReq,
    });
  });
});

describe('MeetingTurnExecutor — persona priming heuristic', () => {
  it('non-CLI providers always get persona', () => {
    const exec = new MeetingTurnExecutor(buildDeps());
    const include = exec.shouldIncludePersona(
      { type: 'api', config: {} },
      'ai-1',
    );
    expect(include).toBe(true);
  });

  it('CLI providers other than claude always get persona', () => {
    const exec = new MeetingTurnExecutor(buildDeps());
    const include = exec.shouldIncludePersona(
      { type: 'cli', config: { command: 'codex' } },
      'ai-1',
    );
    expect(include).toBe(true);
  });

  it('Claude CLI gets persona only on first turn (not primed yet)', () => {
    const primed = new Set<string>();
    const exec = new MeetingTurnExecutor(
      buildDeps({ personaPrimedParticipants: primed }),
    );
    expect(
      exec.shouldIncludePersona(
        { type: 'cli', config: { command: 'claude' } },
        'ai-1',
      ),
    ).toBe(true);

    primed.add('ai-1');
    expect(
      exec.shouldIncludePersona(
        { type: 'cli', config: { command: 'claude' } },
        'ai-1',
      ),
    ).toBe(false);
  });
});
