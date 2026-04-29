/**
 * MeetingTurnExecutor — v3 replacement for the legacy `TurnExecutor`.
 *
 * Runs one AI participant's turn inside a MeetingSession:
 *   1. Resolve provider via the registry (injected).
 *   2. Emit `stream:meeting-turn-start` so renderers allocate a bubble
 *      for the new messageId.
 *   3. Build the provider-adapted history + persona (optionally with an
 *      SSM-state-specific format instruction) and call
 *      `provider.streamCompletion(...)`.
 *   4. Fan each incremental token out as `stream:meeting-turn-token` with
 *      the running cumulative buffer + a monotonic `sequence`.
 *   5. On success, persist the final row via `messageService.append(...)`
 *      and emit `stream:meeting-turn-done` (the renderer refetches via
 *      `message:list-by-channel`).
 *   6. On error, emit `stream:meeting-error` with `fatal` reflecting
 *      whether the turn can be retried.
 *
 * R6 Decision Log notes:
 *   - **D8 (CLI permission)** [R7-Task3 resolved]: CLI-native permission_request
 *     handling used to sit on the v2 `registerPendingCliPermission` Map.
 *     R7 routes every prompt through {@link ApprovalCliAdapter}, which
 *     creates an `approval_items` row, subscribes to `ApprovalService`
 *     `'decided'`, and resolves the CLI Promise on approve/conditional/
 *     reject/timeout. The legacy helper + `stream:cli-permission-request`
 *     emit + `legacyWebContents` DI slot are gone — no Map, no dangling
 *     resolvers across app restarts.
 *   - **D9 (persona permission)**: `buildEffectivePersona` accepts a
 *     `permission` field that the v2 path populated from the singleton
 *     `permissionService.getPermissionsForParticipant`. The v3
 *     PermissionService exposes only boundary / CLI policy APIs; a
 *     per-participant permission surface lands in R7. For R6 the persona
 *     is built with `permission: null`, yielding conversation-mode
 *     guardrails — meetings still function, persona just omits the
 *     "write allowed under /project/x" block until R7 adds it.
 *   - **D10 (worker summary + SSM parsing)**: state-specific format
 *     injection and worker-summary filename management are delegated to
 *     the v2 `MessageFormatter` asset (re-used unchanged). If the SSM
 *     is in a state the formatter doesn't know about, we send raw prose —
 *     a regression would be caught by the orchestrator-flow tests.
 *   - **D11 (stream:log, stream:deep-debate)** [R10 still owns]: these
 *     v2 diagnostic streams have no emit site here post-R7. The render-
 *     side subscribers survive in the legacy channel isolation list until
 *     R10 replaces them with the structured logger.
 */

import { randomUUID } from 'node:crypto';
import type {
  Participant,
  RoundSetting as _RoundSetting,
} from '../../../shared/engine-types';
import type {
  CliProviderConfig,
  ToolDefinition,
  Message as ProviderMessage,
} from '../../../shared/provider-types';
import type { SessionState } from '../../../shared/session-state-types';
import type { ParsedAiOutput } from '../../../shared/message-protocol-types';
import { buildPermissionRules } from '../../members/persona-permission-rules';
import { MessageFormatter } from '../../engine/message-formatter';
import { AppToolProvider, type AppTool } from '../../engine/app-tool-provider';
import { tryGetLogger } from '../../log/logger-accessor';
import type { BaseProvider } from '../../providers/provider-interface';
import { CliProvider } from '../../providers/cli/cli-provider';
import type { ParsedCliPermissionRequest } from '../../providers/cli/cli-permission-parser';
import type { StreamBridge } from '../../streams/stream-bridge';
import type { MessageService } from '../../channels/message-service';
import type { ArenaRootService } from '../../arena/arena-root-service';
import type { providerRegistry } from '../../providers/registry';
import type { ApprovalCliAdapter } from '../../approvals/approval-cli-adapter';

/** Alias for the registry's instance type — the concrete class is not
 *  exported, so callers reach it via the singleton or through DI. */
type ProviderRegistry = typeof providerRegistry;
import type { MessageMeta } from '../../../shared/message-types';
import type { MeetingSession } from './meeting-session';
import type { CircuitBreaker } from '../../queue/circuit-breaker';

/**
 * R9-Task6 error categories fed to CircuitBreaker.recordError. Tightly
 * enumerated so free-form strings never explode the `same_error` streak
 * counter (spec §12 boundary: `recordError(cat)` must accept an enum
 * only — a random error.message would let an attacker force a reset by
 * perturbing the text).
 */
type TurnErrorCategory =
  | 'cli_spawn_failed'
  | 'provider_stream_failed'
  | 'turn_error';

/**
 * Map a raw turn exception to a CircuitBreaker category. Narrow by the
 * marker strings the CLI stack produces (`spawn`, `ENOENT`); everything
 * else collapses to the generic `turn_error` bucket. We classify off the
 * message because the exception class is invariably a plain `Error`
 * rethrown from subprocess / HTTP layers.
 */
function classifyTurnError(err: unknown): TurnErrorCategory {
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();
  if (
    lower.includes('spawn') ||
    lower.includes('enoent') ||
    lower.includes('not found')
  ) {
    return 'cli_spawn_failed';
  }
  if (lower.includes('stream') || lower.includes('token')) {
    return 'provider_stream_failed';
  }
  return 'turn_error';
}

const WORK_SUMMARY_PREFIX = 'work-summary-';

const WORKER_PERMISSION_REQUEST_INSTRUCTION =
  '작업 시작 전에 프로젝트 폴더에 대한 쓰기 권한을 요청해 주세요. 권한 승인 후 작업을 진행하세요.';

function buildSummaryFileName(timestamp: number): string {
  return `${WORK_SUMMARY_PREFIX}${timestamp}.md`;
}

/** Deps injected into the constructor — all mandatory.
 *
 *  R7-Task3 removed `legacyWebContents` together with the only remaining
 *  legacyEmit call site (`stream:cli-permission-request`). The v2 stream:log
 *  and stream:deep-debate events had no emit sites here even before R7.
 *  `approvalCliAdapter` is the new channel for CLI permission prompts. */
export interface MeetingTurnExecutorDeps {
  session: MeetingSession;
  streamBridge: StreamBridge;
  messageService: MessageService;
  arenaRootService: ArenaRootService;
  providerRegistry: ProviderRegistry;
  /** Shared set across all turns of the meeting — tracks which CLI
   *  providers already consumed their persona prompt this meeting.
   *  Owned by the MeetingOrchestrator so it survives turn boundaries. */
  personaPrimedParticipants: Set<string>;
  /** R7-Task3: CLI permission prompts go through ApprovalService via this
   *  adapter. One instance can be shared across every turn executor. */
  approvalCliAdapter: ApprovalCliAdapter;
  /**
   * R8-Task9 / R11-Task2: MemberProfileService for the work-status gate
   * (spec §7.2 "턴매니저는 online 상태 멤버만 선발") and the persona
   * Identity block. R8 made it optional so R7 smoke harnesses kept
   * compiling; R11 made it required when the v2 fallback path was
   * deleted along with `engine/persona-builder.ts`. Tests construct a
   * minimal mock — see `meeting-turn-executor.test.ts:buildDeps`.
   */
  memberProfileService: import('../../members/member-profile-service').MemberProfileService;
  /**
   * R9-Task6 (spec §8 CB-5 `same_error`): optional CircuitBreaker that
   * receives a `recordError(category)` tick whenever a turn bubbles an
   * exception out of `provider.streamCompletion`. Optional to match
   * the `memberProfileService` pattern — R6/R7 smoke tests do not
   * install an autonomy loop, so the DI slot stays null.
   */
  circuitBreaker?: CircuitBreaker;
}

export class MeetingTurnExecutor {
  private readonly session: MeetingSession;
  private readonly streamBridge: StreamBridge;
  private readonly messageService: MessageService;
  private readonly arenaRootService: ArenaRootService;
  private readonly providerRegistry: ProviderRegistry;
  private readonly personaPrimedParticipants: Set<string>;
  private readonly approvalCliAdapter: ApprovalCliAdapter;
  private readonly memberProfileService: MeetingTurnExecutorDeps['memberProfileService'];
  private readonly circuitBreaker?: CircuitBreaker;

  private readonly messageFormatter = new MessageFormatter();
  private readonly appToolProvider = new AppToolProvider();

  private abortController: AbortController | null = null;

  /** Filename of the work summary document written during the last
   *  EXECUTING turn. Read by the orchestrator to hand reviewers the path. */
  lastWorkerSummaryFileName: string | null = null;

  /** Tracks whether the worker's first EXECUTING turn injected the
   *  permission-request instruction. Resets when the worker id changes. */
  private workerPermissionInstructionSentForId: string | null = null;

  constructor(deps: MeetingTurnExecutorDeps) {
    this.session = deps.session;
    this.streamBridge = deps.streamBridge;
    this.messageService = deps.messageService;
    this.arenaRootService = deps.arenaRootService;
    this.providerRegistry = deps.providerRegistry;
    this.personaPrimedParticipants = deps.personaPrimedParticipants;
    this.approvalCliAdapter = deps.approvalCliAdapter;
    this.memberProfileService = deps.memberProfileService;
    this.circuitBreaker = deps.circuitBreaker;
  }

  /** Abort the currently in-flight provider request, if any. */
  abort(): void {
    this.abortController?.abort();
  }

  /** Execute a single AI turn for the given speaker. */
  async executeTurn(speaker: Participant): Promise<void> {
    // R8-Task9 / R11-Task2: work-status gate (spec §7.2). Skip the turn
    // entirely when the speaker is not `online`. The skip is NOT a turn
    // failure — we do not emit TURN_DONE/TURN_FAIL. The orchestrator's
    // turn rotation decides what to do next (move to the next speaker).
    {
      const status = this.memberProfileService.getWorkStatus(speaker.id);
      if (status !== 'online') {
        this.streamBridge.emitMeetingTurnSkipped({
          meetingId: this.session.meetingId,
          channelId: this.session.channelId,
          participantId: speaker.id,
          participantName: speaker.displayName,
          reason: status,
          skipId: randomUUID(),
        });
        tryGetLogger()?.info({
          component: 'meeting',
          action: 'turn-skipped',
          result: 'success',
          participantId: speaker.id,
          metadata: {
            meetingId: this.session.meetingId,
            channelId: this.session.channelId,
            participantName: speaker.displayName,
            reason: status,
          },
        });
        // Persist a system message so the channel transcript shows the
        // skip even after the meeting ends. The renderer Thread (Task 9
        // continued) maps the well-known meta marker to a translated
        // banner.
        try {
          this.messageService.append({
            channelId: this.session.channelId,
            meetingId: this.session.meetingId,
            authorId: speaker.id,
            authorKind: 'system',
            role: 'system',
            content: `meeting.turnSkipped|${speaker.displayName}|${status}`,
            meta: {
              turnSkipped: {
                participantId: speaker.id,
                participantName: speaker.displayName,
                reason: status,
              },
            },
          });
        } catch (e) {
          // Persisting the marker is best-effort — even if the DB write
          // fails, the live `stream:meeting-turn-skipped` already
          // surfaced the skip to the renderer.
          console.warn(
            '[meeting-turn-executor] failed to persist turn-skipped marker',
            e instanceof Error ? e.message : String(e),
          );
        }
        return;
      }
    }

    const provider = this.providerRegistry.get(speaker.id);
    if (!provider) {
      const errorMsg = `Provider not found: ${speaker.id}`;
      this.streamBridge.emitMeetingError({
        meetingId: this.session.meetingId,
        channelId: this.session.channelId,
        error: errorMsg,
        fatal: false,
        speakerId: speaker.id,
      });
      tryGetLogger()?.error({
        component: 'meeting',
        action: 'turn-error',
        result: 'failure',
        participantId: speaker.id,
        error: { code: 'ProviderNotFound', message: errorMsg },
        metadata: {
          meetingId: this.session.meetingId,
          channelId: this.session.channelId,
          phase: 'pre-start',
        },
      });
      return;
    }

    const messageId = randomUUID();
    const turnStartedAt = Date.now();
    let fullContent = '';

    this.streamBridge.emitMeetingTurnStart({
      meetingId: this.session.meetingId,
      channelId: this.session.channelId,
      speakerId: speaker.id,
      messageId,
    });
    tryGetLogger()?.info({
      component: 'meeting',
      action: 'turn-start',
      result: 'success',
      participantId: speaker.id,
      metadata: {
        meetingId: this.session.meetingId,
        channelId: this.session.channelId,
        messageId,
        participantName: speaker.displayName,
        ssmState: this.session.sessionMachine.state,
        providerType: provider.type,
      },
    });

    this.abortController = new AbortController();
    const { signal } = this.abortController;

    try {
      const messages = this.session.getMessagesForProvider(speaker.id);

      const ssm = this.session.sessionMachine;
      const otherNames = this.session.participants
        .filter((p) => p.isActive && p.id !== 'user' && p.id !== speaker.id)
        .map((p) => p.displayName);
      const formatInstruction = this.getFormatInstruction(
        ssm.state,
        speaker.displayName,
        otherNames,
      );
      if (formatInstruction) {
        messages.unshift({ role: 'system', content: formatInstruction });
      }

      // R11-Task2: v3 PersonaBuilder is now the single path. Identity
      // section comes from {@link MemberProfileService.buildPersona}
      // (reads the `member_profiles` row fresh every call so user edits
      // in {@link MemberProfileEditModal} land in the AI's system prompt
      // starting next turn). Permission rules are appended via the v3
      // {@link buildPermissionRules} helper. The v2 `buildEffectivePersona`
      // fallback is gone with the v2 engine deletion.
      let persona = '';
      if (this.shouldIncludePersona(provider, speaker.id)) {
        const permissionRules = buildPermissionRules({
          permission: null,
          projectFolder: this.session.sessionMachine.ctx.projectPath || null,
          arenaFolder: this.arenaRootService.getPath(),
        });
        const v3Identity = this.memberProfileService.buildPersona(speaker.id);
        persona = `${v3Identity}${permissionRules}`;
      }

      if (provider.type === 'cli') {
        const permissionPrompt = this.buildCliPermissionPrompt(provider, speaker);
        if (permissionPrompt) persona = permissionPrompt + '\n\n' + persona;
      }

      let completionOptions: { tools: ToolDefinition[] } | undefined;
      if (provider.type !== 'cli') {
        const isWorker =
          ssm.workerId === speaker.id && ssm.state === 'EXECUTING';
        const appTools = this.appToolProvider.getAvailableTools(
          ssm.state,
          isWorker,
        );
        if (appTools.length > 0) {
          completionOptions = {
            tools: this.convertToolsToDefinitions(appTools),
          };
        }
      }

      if (provider instanceof CliProvider) {
        this.wireCliPermissionCallback(provider, speaker);
      }

      let sequence = 0;
      try {
        for await (const token of provider.streamCompletion(
          messages,
          persona,
          completionOptions,
          signal,
        )) {
          if (this.session.state === 'stopped') break;
          fullContent += token;
          this.streamBridge.emitMeetingTurnToken({
            meetingId: this.session.meetingId,
            channelId: this.session.channelId,
            messageId,
            token,
            cumulative: fullContent,
            sequence: sequence++,
          });
        }
      } finally {
        if (provider instanceof CliProvider) {
          provider.setPermissionRequestCallback(null);
        }
      }

      const providerUsage = provider.consumeLastTokenUsage();
      const outputTokens = providerUsage?.outputTokens ?? null;

      if (fullContent) {
        const parsedMetadata = this.parseOutputByState(
          ssm.state,
          speaker,
          fullContent,
        );
        let contentForDisplay = fullContent;

        if (
          ssm.state === 'EXECUTING' &&
          ssm.workerId === speaker.id
        ) {
          const summaryFileName = this.lastWorkerSummaryFileName;
          contentForDisplay = summaryFileName
            ? `작업을 완료했습니다. 작업 내용은 합의 폴더의 \`${summaryFileName}\`을 확인해 주세요.`
            : '작업을 완료했습니다.';
        } else {
          const display = this.extractDisplayContent(parsedMetadata);
          if (display) contentForDisplay = display;
        }

        this.session.createMessage({
          id: messageId,
          participantId: speaker.id,
          participantName: speaker.displayName,
          role: 'assistant',
          content: fullContent,
          metadata: parsedMetadata,
        });

        const meta: MessageMeta | null = parsedMetadata
          ? { parsedOutput: parsedMetadata.parsedOutput }
          : null;

        try {
          this.messageService.append({
            channelId: this.session.channelId,
            meetingId: this.session.meetingId,
            authorId: speaker.providerId ?? speaker.id,
            authorKind: 'member',
            role: 'assistant',
            content: contentForDisplay,
            meta,
          });
        } catch (dbErr) {
          console.error(
            `[MeetingOrchestrator:${this.session.meetingId}] DB persist error:`,
            dbErr,
          );
        }
      }

      this.streamBridge.emitMeetingTurnDone({
        meetingId: this.session.meetingId,
        channelId: this.session.channelId,
        messageId,
        totalTokens: outputTokens ?? sequence,
      });
      tryGetLogger()?.info({
        component: 'meeting',
        action: 'turn-done',
        result: 'success',
        participantId: speaker.id,
        latencyMs: Date.now() - turnStartedAt,
        metadata: {
          meetingId: this.session.meetingId,
          channelId: this.session.channelId,
          messageId,
          participantName: speaker.displayName,
          totalTokens: outputTokens ?? sequence,
          contentLength: fullContent.length,
        },
      });

      this.personaPrimedParticipants.add(speaker.id);

      if (this.session.deepDebateActive && fullContent) {
        this.session.recordDeepDebateTurn();
        if (this.session.isDeepDebateBudgetExhausted()) {
          this.session.stopDeepDebate();
          this.session.setRoundSetting(
            this.session.turnManager.currentRound,
          );
          console.info(
            `[MeetingOrchestrator:${this.session.meetingId}] deep debate budget exhausted`,
          );
        }
      }
    } catch (err) {
      if (!signal.aborted) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error';
        const errorCategory = classifyTurnError(err);
        this.streamBridge.emitMeetingError({
          meetingId: this.session.meetingId,
          channelId: this.session.channelId,
          error: errorMsg,
          fatal: false,
          messageId,
          speakerId: speaker.id,
        });
        tryGetLogger()?.error({
          component: 'meeting',
          action: 'turn-error',
          result: 'failure',
          participantId: speaker.id,
          latencyMs: Date.now() - turnStartedAt,
          error: { code: errorCategory, message: errorMsg },
          metadata: {
            meetingId: this.session.meetingId,
            channelId: this.session.channelId,
            messageId,
            participantName: speaker.displayName,
            partialContentLength: fullContent.length,
          },
        });
        // R9-Task6: feed the `same_error` tripwire. User-initiated aborts
        // (signal.aborted) are a control-flow signal, not a failure — we
        // must not let `meeting:abort` inflate the counter and trip the
        // breaker. Classification is a closed enum (see
        // `classifyTurnError`) so the streak counter cannot be perturbed
        // by attacker-controlled error text.
        this.circuitBreaker?.recordError(errorCategory);
      }
    } finally {
      this.abortController = null;
    }
  }

  // ── SSM-aware helpers (delegate to v2 MessageFormatter asset) ────

  getFormatInstruction(
    state: SessionState,
    selfName: string,
    otherNames: string[],
  ): string | null {
    switch (state) {
      case 'CONVERSATION':
        return this.messageFormatter.buildConversationFormatInstruction(selfName);
      case 'WORK_DISCUSSING':
        return this.messageFormatter.buildWorkDiscussionFormatInstruction(
          selfName,
          otherNames,
        );
      case 'EXECUTING': {
        // projectPath is the permission-guard anchor; consensusFolder
        // resolves via ArenaRootService (shared across projects for now).
        const consensusFolder = this.arenaRootService.consensusPath();
        const summaryFileName = buildSummaryFileName(Date.now());
        this.lastWorkerSummaryFileName = summaryFileName;
        return this.messageFormatter.buildExecutionFormatInstruction(
          selfName,
          consensusFolder,
          summaryFileName,
        );
      }
      case 'REVIEWING':
        return this.messageFormatter.buildReviewFormatInstruction(selfName);
      default:
        return null;
    }
  }

  convertToolsToDefinitions(tools: AppTool[]): ToolDefinition[] {
    return tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: {},
    }));
  }

  shouldIncludePersona(
    provider: { type: string; config: unknown },
    participantId: string,
  ): boolean {
    if (provider.type !== 'cli') return true;
    const config = provider.config;
    const command = isCliProviderConfig(config)
      ? config.command.toLowerCase()
      : '';
    const isClaudeCli = command.includes('claude');
    if (!isClaudeCli) return true;
    return !this.personaPrimedParticipants.has(participantId);
  }

  // ── Private helpers ──────────────────────────────────────────────

  private buildCliPermissionPrompt(
    provider: BaseProvider,
    speaker: Participant,
  ): string {
    const ssm = this.session.sessionMachine;
    const isWorker = ssm.workerId === speaker.id && ssm.state === 'EXECUTING';
    const providerWithAdapter = provider as {
      getPermissionAdapter?: () => {
        getWorkerSystemPrompt?: (
          projectPath: string,
          consensusFolder: string,
          summaryFileName: string,
        ) => string;
        getObserverSystemPrompt?: (workerName: string) => string;
        getReadOnlySystemPrompt?: () => string;
      } | null;
    };
    const adapter =
      typeof providerWithAdapter.getPermissionAdapter === 'function'
        ? providerWithAdapter.getPermissionAdapter()
        : null;

    const projectPath = this.session.sessionMachine.ctx.projectPath || '.';

    if (adapter) {
      if (isWorker && adapter.getWorkerSystemPrompt) {
        const consensusFolder = this.arenaRootService.consensusPath();
        const summaryFileName = buildSummaryFileName(Date.now());
        this.lastWorkerSummaryFileName = summaryFileName;
        let prompt = adapter.getWorkerSystemPrompt(
          projectPath,
          consensusFolder,
          summaryFileName,
        );
        if (this.workerPermissionInstructionSentForId !== speaker.id) {
          this.workerPermissionInstructionSentForId = speaker.id;
          prompt = WORKER_PERMISSION_REQUEST_INSTRUCTION + '\n\n' + prompt;
        }
        return prompt;
      }
      if (ssm.state === 'EXECUTING' && adapter.getObserverSystemPrompt) {
        const workerParticipant = this.session.participants.find(
          (p) => p.id === ssm.workerId,
        );
        const workerName = workerParticipant?.displayName ?? 'Worker';
        return adapter.getObserverSystemPrompt(workerName);
      }
      if (ssm.state === 'REVIEWING' && adapter.getReadOnlySystemPrompt) {
        return adapter.getReadOnlySystemPrompt();
      }
      return '';
    }

    // Hardcoded fallback when no permission adapter is available.
    if (isWorker) {
      const consensusFolder = this.arenaRootService.consensusPath();
      const summaryFileName = buildSummaryFileName(Date.now());
      this.lastWorkerSummaryFileName = summaryFileName;
      return `[WORKER MODE] You have write access to the project. Execute the approved plan.\nAfter completing all work, write a summary to: ${consensusFolder}/${summaryFileName}`;
    }
    return ssm.state === 'REVIEWING'
      ? '[REVIEWER MODE] Review the worker output. Report issues found.'
      : '[OBSERVER MODE] You are in read-only mode. Discuss and analyze only.';
  }

  private wireCliPermissionCallback(
    provider: CliProvider,
    speaker: Participant,
  ): void {
    provider.setPermissionRequestCallback(
      async (
        participantId: string,
        req: ParsedCliPermissionRequest,
      ): Promise<boolean> => {
        // R7-Task3: every CLI permission prompt now lands in the
        // ApprovalService table with kind='cli_permission'. The adapter
        // owns the Promise bridge (create + subscribe-once('decided') +
        // 5-minute timeout + listener cleanup). approve/conditional →
        // true, reject/timeout → false. Conditional comments are
        // delivered to the AI on the next turn by the SystemMessage-
        // Injector (R7-Task6) — the CLI only sees the allow signal.
        return this.approvalCliAdapter.createCliPermissionApproval({
          meetingId: this.session.meetingId,
          channelId: this.session.channelId,
          projectId: this.session.projectId,
          participantId,
          participantName: speaker.displayName,
          request: req,
        });
      },
    );
  }

  private parseOutputByState(
    state: SessionState,
    speaker: Participant,
    content: string,
  ): { parsedOutput: ParsedAiOutput } | undefined {
    let parsed: ParsedAiOutput;
    switch (state) {
      case 'CONVERSATION':
        parsed = this.messageFormatter.parseConversationOutput(
          content,
          speaker.displayName,
        );
        if (parsed.type === 'conversation') {
          this.session.sessionMachine.recordModeJudgment({
            participantId: speaker.id,
            participantName: speaker.displayName,
            judgment: parsed.data.mode_judgment,
            reason: parsed.data.judgment_reason,
          });
        }
        return { parsedOutput: parsed };
      case 'WORK_DISCUSSING':
        parsed = this.messageFormatter.parseWorkDiscussionOutput(
          content,
          speaker.displayName,
        );
        return { parsedOutput: parsed };
      case 'REVIEWING':
        parsed = this.messageFormatter.parseReviewOutput(
          content,
          speaker.displayName,
        );
        return { parsedOutput: parsed };
      default:
        return undefined;
    }
  }

  private extractDisplayContent(
    parsedMetadata: { parsedOutput: ParsedAiOutput } | undefined,
  ): string | undefined {
    if (!parsedMetadata) return undefined;
    const output = parsedMetadata.parsedOutput;
    switch (output.type) {
      case 'conversation':
        return output.data.content;
      case 'work_discussion':
        return `**의견:** ${output.data.opinion}\n\n**근거:** ${output.data.reasoning}`;
      case 'review': {
        const issues =
          output.data.issues.length > 0
            ? output.data.issues.map((i: string) => `- ${i}`).join('\n')
            : '';
        return `**결과:** ${output.data.review_result}${issues ? `\n\n**이슈:**\n${issues}` : ''}\n\n${output.data.comments}`;
      }
      default:
        return undefined;
    }
  }

}

function isCliProviderConfig(config: unknown): config is CliProviderConfig {
  return (
    typeof config === 'object' &&
    config !== null &&
    'command' in config &&
    typeof (config as Record<string, unknown>).command === 'string'
  );
}

// Unused-re-export guard: silence strict builds that dead-letter an
// interface we expose purely as a documentation touchpoint.
export type { ProviderMessage as _ProviderMessage };
