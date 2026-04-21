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
 *   - **D8 (CLI permission)**: CLI-native permission_request handling is
 *     left on the v2 `registerPendingCliPermission` path — the MeetingOrchestrator
 *     (R6-Task4) continues to import that helper and wires it through the
 *     optional `legacyWebContents` hook below. R7 replaces the flow with
 *     ApprovalService end-to-end and retires the legacy surface.
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
 *   - **D11 (stream:log, stream:deep-debate)**: these v2 diagnostics
 *     are still emitted via the optional `legacyWebContents` hook so the
 *     existing orchestrator dev UX is preserved. R10 replaces them with
 *     the structured logger.
 */

import { randomUUID } from 'node:crypto';
import type { WebContents } from 'electron';
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
import type { CliPermissionRequestData } from '../../../shared/stream-types';
import type { StreamEventMap, StreamEventName } from '../../../shared/stream-types';
import { buildEffectivePersona } from '../../engine/persona-builder';
import { MessageFormatter } from '../../engine/message-formatter';
import { AppToolProvider, type AppTool } from '../../engine/app-tool-provider';
import type { BaseProvider } from '../../providers/provider-interface';
import { CliProvider } from '../../providers/cli/cli-provider';
import type { ParsedCliPermissionRequest } from '../../providers/cli/cli-permission-parser';
import { registerPendingCliPermission } from '../../ipc/handlers/cli-permission-handler';
import type { StreamBridge } from '../../streams/stream-bridge';
import type { MessageService } from '../../channels/message-service';
import type { ArenaRootService } from '../../arena/arena-root-service';
import type { providerRegistry } from '../../providers/registry';

/** Alias for the registry's instance type — the concrete class is not
 *  exported, so callers reach it via the singleton or through DI. */
type ProviderRegistry = typeof providerRegistry;
import type { MessageMeta } from '../../../shared/message-types';
import type { MeetingSession } from './meeting-session';

const WORK_SUMMARY_PREFIX = 'work-summary-';

const WORKER_PERMISSION_REQUEST_INSTRUCTION =
  '작업 시작 전에 프로젝트 폴더에 대한 쓰기 권한을 요청해 주세요. 권한 승인 후 작업을 진행하세요.';

function buildSummaryFileName(timestamp: number): string {
  return `${WORK_SUMMARY_PREFIX}${timestamp}.md`;
}

/** Deps injected into the constructor — every field is mandatory except
 *  `legacyWebContents` (deferred v2 event bridge, removed in R10). */
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
  /** Optional hook for v2 diagnostic streams still consumed by the
   *  renderer (stream:log / stream:deep-debate / stream:cli-permission-request).
   *  Removed in R10 when the structured logger replaces them. */
  legacyWebContents?: WebContents | null;
}

export class MeetingTurnExecutor {
  private readonly session: MeetingSession;
  private readonly streamBridge: StreamBridge;
  private readonly messageService: MessageService;
  private readonly arenaRootService: ArenaRootService;
  private readonly providerRegistry: ProviderRegistry;
  private readonly personaPrimedParticipants: Set<string>;
  private readonly legacyWebContents: WebContents | null;

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
    this.legacyWebContents = deps.legacyWebContents ?? null;
  }

  /** Abort the currently in-flight provider request, if any. */
  abort(): void {
    this.abortController?.abort();
  }

  /** Execute a single AI turn for the given speaker. */
  async executeTurn(speaker: Participant): Promise<void> {
    const provider = this.providerRegistry.get(speaker.id);
    if (!provider) {
      this.streamBridge.emitMeetingError({
        meetingId: this.session.meetingId,
        channelId: this.session.channelId,
        error: `Provider not found: ${speaker.id}`,
        fatal: false,
      });
      return;
    }

    const messageId = randomUUID();
    let fullContent = '';

    this.streamBridge.emitMeetingTurnStart({
      meetingId: this.session.meetingId,
      channelId: this.session.channelId,
      speakerId: speaker.id,
      messageId,
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

      // R6 D9: permission omitted — PermissionService per-participant
      // surface lands in R7. Persona retains conversation-mode guardrails.
      let persona = this.shouldIncludePersona(provider, speaker.id)
        ? buildEffectivePersona(provider, {
            permission: null,
            projectFolder: this.session.sessionMachine.ctx.projectPath || null,
            arenaFolder: this.arenaRootService.getPath(),
          })
        : '';

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
        console.error(
          `[MeetingOrchestrator:${this.session.meetingId}] ${speaker.displayName} turn error: ${errorMsg}`,
        );
        this.streamBridge.emitMeetingError({
          meetingId: this.session.meetingId,
          channelId: this.session.channelId,
          error: errorMsg,
          fatal: false,
        });
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
        const permData: CliPermissionRequestData = {
          cliRequestId: req.cliRequestId,
          toolName: req.toolName,
          target: req.target,
          description: req.description,
        };
        // R6 D11: CLI permission prompt UI still rides the v2 stream:*
        // surface until R7 moves approvals to ApprovalService.
        this.legacyEmit('stream:cli-permission-request', {
          conversationId: this.session.meetingId,
          participantId,
          participantName: speaker.displayName,
          request: permData,
        });
        return new Promise<boolean>((resolve) => {
          registerPendingCliPermission(participantId, req.cliRequestId, resolve);
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

  private legacyEmit<E extends StreamEventName>(
    event: E,
    data: StreamEventMap[E],
  ): void {
    const wc = this.legacyWebContents;
    if (!wc || wc.isDestroyed()) return;
    wc.send(event, data);
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
