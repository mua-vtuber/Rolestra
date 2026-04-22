/**
 * @deprecated R6-Task7 — replaced by
 *   `src/main/meetings/engine/meeting-turn-executor.ts`. Kept until R11
 *   deletes the v2 engine; do not add new callers.
 *
 * TurnExecutor — handles execution of a single AI participant's turn.
 *
 * Extracted from ConversationOrchestrator to isolate the per-turn
 * streaming logic, token accounting, DB persistence, and deep debate
 * tracking into a focused module.
 */

import { randomUUID } from 'node:crypto';
import type { WebContents } from 'electron';
import type { StreamEventName, StreamEventMap } from '../../shared/stream-types';
import type { ConversationSession } from './conversation';
import type { Participant } from '../../shared/engine-types';
import type { CliProviderConfig, ToolDefinition } from '../../shared/provider-types';
import type { SessionState } from '../../shared/session-state-types';
import type { ParsedAiOutput } from '../../shared/message-protocol-types';
import { providerRegistry } from '../providers/registry';
import { buildEffectivePersona } from './persona-builder';
import { permissionService, workspaceService, consensusFolderService } from '../ipc/handlers/workspace-handler';
import type { MemoryCoordinator } from './memory-coordinator';
import { MessageFormatter } from './message-formatter';
import { AppToolProvider, type AppTool } from './app-tool-provider';
import type { CliPermissionAdapter } from '../providers/cli/permission-adapter';
import { CliProvider } from '../providers/cli/cli-provider';
import type { ParsedCliPermissionRequest } from '../providers/cli/cli-permission-parser';
import type { CliPermissionRequestData } from '../../shared/stream-types';
import { registerPendingCliPermission } from '../ipc/handlers/cli-permission-handler';

/** Filename prefix for work summary documents. */
const WORK_SUMMARY_PREFIX = 'work-summary-';

/**
 * System prompt injected into the worker's first EXECUTING turn to prompt
 * the CLI provider to request write permissions before beginning work.
 *
 * This message is prepended to the permission prompt for CLI providers only.
 * It appears once per EXECUTING phase (tracked by workerFirstTurnSeen).
 */
const WORKER_PERMISSION_REQUEST_INSTRUCTION =
  '작업 시작 전에 프로젝트 폴더에 대한 쓰기 권한을 요청해 주세요. 권한 승인 후 작업을 진행하세요.';

/**
 * Generate a work summary filename based on a timestamp.
 * Format: work-summary-{timestamp}.md
 */
function buildSummaryFileName(timestamp: number): string {
  return `${WORK_SUMMARY_PREFIX}${timestamp}.md`;
}

/**
 * Manages execution of individual AI turns within the conversation loop.
 */
export class TurnExecutor {
  private session: ConversationSession;
  private webContents: WebContents;
  private memoryCoordinator: MemoryCoordinator;
  private personaPrimedParticipants: Set<string>;
  private abortController: AbortController | null = null;
  private messageFormatter: MessageFormatter;
  private appToolProvider: AppToolProvider;

  /**
   * The filename of the work summary document written during the last
   * EXECUTING turn. Set by executeWorkerTurn; read by the orchestrator
   * to pass the path to reviewers.
   */
  lastWorkerSummaryFileName: string | null = null;

  /**
   * Tracks whether the worker's first EXECUTING turn has already had the
   * permission request instruction injected. Reset when the worker ID changes.
   */
  private _workerPermissionInstructionSentForId: string | null = null;

  constructor(
    session: ConversationSession,
    webContents: WebContents,
    memoryCoordinator: MemoryCoordinator,
    personaPrimedParticipants: Set<string>,
  ) {
    this.session = session;
    this.webContents = webContents;
    this.memoryCoordinator = memoryCoordinator;
    this.personaPrimedParticipants = personaPrimedParticipants;
    this.messageFormatter = new MessageFormatter();
    this.appToolProvider = new AppToolProvider();
  }

  /** Abort the currently in-flight provider request, if any. */
  abort(): void {
    this.abortController?.abort();
  }

  /** Execute a single AI turn for the given speaker. */
  async executeTurn(speaker: Participant): Promise<void> {
    const provider = providerRegistry.get(speaker.id);
    if (!provider) {
      this.emit('stream:error', {
        conversationId: this.session.id,
        participantId: speaker.id,
        error: `Provider not found: ${speaker.id}`,
      });
      return;
    }

    const messageId = randomUUID();
    const startTime = Date.now();
    let fullContent = '';

    // Signal message start
    this.emit('stream:message-start', {
      conversationId: this.session.id,
      messageId,
      participantId: speaker.id,
      participantName: speaker.displayName,
      role: 'assistant',
      timestamp: startTime,
    });

    this.abortController = new AbortController();
    const { signal } = this.abortController;

    try {
      console.info(`[orchestrator:${this.session.id}] ${speaker.displayName} turn start`);
      this.emit('stream:log', {
        conversationId: this.session.id,
        participantId: speaker.id,
        level: 'info',
        message: `${speaker.displayName}: 응답 생성 시작`,
        timestamp: Date.now(),
      });

      // Get adapted messages for this provider
      const messages = this.session.getMessagesForProvider(speaker.id);

      // SSM format instruction injection
      const ssm = this.session.sessionMachine;
      if (ssm) {
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
      }

      // Inject relevant memories as a system message at the beginning
      const memoryContext = await this.memoryCoordinator.buildMemoryContext();
      if (memoryContext) {
        messages.unshift({ role: 'system', content: memoryContext });
      }

      // For Claude CLI, send persona only once on the first turn.
      let persona = this.shouldIncludePersona(provider, speaker.id)
        ? buildEffectivePersona(provider, {
            permission: permissionService.getPermissionsForParticipant(speaker.id),
            projectFolder: workspaceService.getProjectFolder(),
            arenaFolder: workspaceService.getArenaFolder(),
          })
        : '';

      // SSM permission prompt injection for CLI providers
      if (ssm && provider.type === 'cli') {
        const isWorker = ssm.workerId === speaker.id && ssm.state === 'EXECUTING';
        const providerWithAdapter = provider as { getPermissionAdapter?: () => CliPermissionAdapter };
        const adapter = typeof providerWithAdapter.getPermissionAdapter === 'function'
          ? providerWithAdapter.getPermissionAdapter()
          : null;

        let permissionPrompt: string;
        if (adapter) {
          const projectPath = workspaceService.getProjectFolder() ?? '.';
          if (isWorker) {
            const consensusFolder = consensusFolderService.getFolderPath() ?? projectPath;
            const summaryFileName = buildSummaryFileName(Date.now());
            // Store so orchestrator can retrieve it after the turn completes
            this.lastWorkerSummaryFileName = summaryFileName;
            // @ts-expect-error R2-Task21 — v2 adapter API removed; cleanup pending
            permissionPrompt = adapter.getWorkerSystemPrompt(
              projectPath,
              consensusFolder,
              summaryFileName,
            );

            // Inject permission request instruction on the worker's first EXECUTING turn
            if (
              provider.type === 'cli' &&
              this._workerPermissionInstructionSentForId !== speaker.id
            ) {
              this._workerPermissionInstructionSentForId = speaker.id;
              permissionPrompt = WORKER_PERMISSION_REQUEST_INSTRUCTION + '\n\n' + permissionPrompt;
            }
          } else if (ssm.state === 'EXECUTING') {
            // Find worker display name for observer prompt
            const workerParticipant = this.session.participants.find(
              (p) => p.id === ssm.workerId,
            );
            const workerName = workerParticipant?.displayName ?? 'Worker';
            // @ts-expect-error R2-Task21 — v2 adapter API removed; cleanup pending
            permissionPrompt = adapter.getObserverSystemPrompt(workerName);
          } else if (ssm.state === 'REVIEWING') {
            // @ts-expect-error R2-Task21 — v2 adapter API removed; cleanup pending
            permissionPrompt = adapter.getReadOnlySystemPrompt();
          } else {
            permissionPrompt = '';
          }
        } else {
          // Hardcoded fallback prompts when no permission adapter
          if (isWorker) {
            const projectPath = workspaceService.getProjectFolder() ?? '.';
            const consensusFolder = consensusFolderService.getFolderPath() ?? projectPath;
            const summaryFileName = buildSummaryFileName(Date.now());
            this.lastWorkerSummaryFileName = summaryFileName;
            permissionPrompt = `[WORKER MODE] You have write access to the project. Execute the approved plan.\nAfter completing all work, write a summary to: ${consensusFolder}/${summaryFileName}`;
          } else {
            permissionPrompt = ssm.state === 'REVIEWING'
              ? '[REVIEWER MODE] Review the worker output. Report issues found.'
              : '[OBSERVER MODE] You are in read-only mode. Discuss and analyze only.';
          }
        }

        if (permissionPrompt) {
          persona = permissionPrompt + '\n\n' + persona;
        }
      }

      // SSM tool injection for API/Local providers
      let completionOptions = undefined;
      if (ssm && provider.type !== 'cli') {
        const isWorker = ssm.workerId === speaker.id && ssm.state === 'EXECUTING';
        const appTools = this.appToolProvider.getAvailableTools(ssm.state, isWorker);
        if (appTools.length > 0) {
          completionOptions = { tools: this.convertToolsToDefinitions(appTools) };
        }
      }

      // Register CLI permission request callback before streaming starts
      if (provider instanceof CliProvider) {
        provider.setPermissionRequestCallback(
          async (participantId: string, req: ParsedCliPermissionRequest): Promise<boolean> => {
            const permData: CliPermissionRequestData = {
              cliRequestId: req.cliRequestId,
              toolName: req.toolName,
              target: req.target,
              description: req.description,
            };

            // Emit to renderer so the user sees an approval card
            this.emit('stream:cli-permission-request', {
              conversationId: this.session.id,
              participantId,
              participantName: speaker.displayName,
              request: permData,
            });

            // Suspend until the user responds via cli-permission:respond IPC
            return new Promise<boolean>((resolve) => {
              registerPendingCliPermission(participantId, req.cliRequestId, resolve);
            });
          },
        );
      }

      // Stream completion
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
          sequence++;

          this.emit('stream:token', {
            conversationId: this.session.id,
            messageId,
            participantId: speaker.id,
            token,
            sequence,
          });
        }
      } finally {
        // Always clear the CLI permission callback after streaming completes
        if (provider instanceof CliProvider) {
          provider.setPermissionRequestCallback(null);
        }
      }

      const providerUsage = provider.consumeLastTokenUsage();
      const inputTokens = providerUsage?.inputTokens ?? null;
      const outputTokens = providerUsage?.outputTokens ?? null;
      const usageSource: 'provider' | 'unknown' = providerUsage ? 'provider' : 'unknown';

      // Add completed message to session history
      let parsedContent: string | undefined;
      if (fullContent) {
        // SSM structured output parsing
        let parsedMetadata: Record<string, unknown> | undefined;
        if (ssm) {
          switch (ssm.state) {
            case 'CONVERSATION': {
              const parsed = this.messageFormatter.parseConversationOutput(
                fullContent,
                speaker.displayName,
              );
              if (parsed.type === 'conversation') {
                ssm.recordModeJudgment({
                  participantId: speaker.id,
                  participantName: speaker.displayName,
                  judgment: parsed.data.mode_judgment,
                  reason: parsed.data.judgment_reason,
                });
              }
              parsedMetadata = { parsedOutput: parsed };
              break;
            }
            case 'WORK_DISCUSSING': {
              const parsed = this.messageFormatter.parseWorkDiscussionOutput(
                fullContent,
                speaker.displayName,
              );
              parsedMetadata = { parsedOutput: parsed };
              break;
            }
            case 'REVIEWING': {
              const parsed = this.messageFormatter.parseReviewOutput(
                fullContent,
                speaker.displayName,
              );
              parsedMetadata = { parsedOutput: parsed };
              break;
            }
          }
        }

        // Extract display-friendly text from parsed output
        if (parsedMetadata?.parsedOutput) {
          const output = parsedMetadata.parsedOutput as ParsedAiOutput;
          switch (output.type) {
            case 'conversation':
              parsedContent = output.data.content;
              break;
            case 'work_discussion':
              parsedContent = `**의견:** ${output.data.opinion}\n\n**근거:** ${output.data.reasoning}`;
              break;
            case 'review': {
              const issues = output.data.issues.length > 0
                ? output.data.issues.map((i: string) => `- ${i}`).join('\n')
                : '';
              parsedContent = `**결과:** ${output.data.review_result}${issues ? `\n\n**이슈:**\n${issues}` : ''}\n\n${output.data.comments}`;
              break;
            }
            // 'raw' → parsedContent = undefined → keep original
          }
        }

        // EXECUTING turn: replace raw streaming output with a short notification.
        // The actual work content is in the work summary document in the consensus folder.
        if (ssm?.state === 'EXECUTING' && ssm.workerId === speaker.id) {
          const summaryFileName = this.lastWorkerSummaryFileName;
          parsedContent = summaryFileName
            ? `작업을 완료했습니다. 작업 내용은 합의 폴더의 \`${summaryFileName}\`을 확인해 주세요.`
            : '작업을 완료했습니다.';
        }

        const aiMsg = this.session.createMessage({
          id: messageId,
          participantId: speaker.id,
          participantName: speaker.displayName,
          role: 'assistant',
          content: fullContent,
          metadata: parsedMetadata,
        });

        // Persist AI message to DB (non-fatal on failure)
        try {
          const { getDatabase } = await import('../database/connection');
          const { ConversationRepository } = await import('../database/conversation-repository');
          const repo = new ConversationRepository(getDatabase());
          const participantsJson = JSON.stringify(this.session.participants);
          repo.createConversation(this.session.id, '', 'conversation', participantsJson);
          repo.insertMessage({
            id: messageId,
            conversationId: this.session.id,
            participantId: speaker.id,
            participantName: speaker.displayName,
            role: 'assistant',
            content: fullContent,
            responseTimeMs: Date.now() - startTime,
            tokenCount: outputTokens ?? undefined,
            branchId: aiMsg.branchId,
            parentMessageId: aiMsg.parentMessageId,
          });
          repo.touchTimestamp(this.session.id);
        } catch (dbErr) {
          console.error(`[orchestrator:${this.session.id}] DB persist error:`, dbErr);
        }

        // Auto-extract memories from the AI response (+ last user message)
        this.memoryCoordinator.extractMemories(fullContent, speaker.id);
      }

      // Signal message done
      this.emit('stream:message-done', {
        conversationId: this.session.id,
        messageId,
        participantId: speaker.id,
        inputTokens,
        tokenCount: outputTokens,
        totalTokens: (inputTokens ?? 0) + (outputTokens ?? 0) || null,
        usageSource,
        responseTimeMs: Date.now() - startTime,
        parsedContent,
      });
      this.emit('stream:log', {
        conversationId: this.session.id,
        participantId: speaker.id,
        level: 'info',
        message: `${speaker.displayName}: 응답 완료 (${Date.now() - startTime}ms)`,
        timestamp: Date.now(),
      });
      console.info(`[orchestrator:${this.session.id}] ${speaker.displayName} turn done (${Date.now() - startTime}ms)`);
      this.personaPrimedParticipants.add(speaker.id);

      // Deep debate turn tracking
      if (this.session.deepDebateActive && fullContent) {
        this.session.recordDeepDebateTurn();
        this.emitDeepDebateState();

        if (this.session.isDeepDebateBudgetExhausted()) {
          // Instead of stopping immediately, deactivate turn counter and fix
          // round setting to the current round so remaining speakers finish,
          // then loop() naturally triggers runConsensusRound() at round end.
          this.session.stopDeepDebate();
          const currentRound = this.session.turnManager.currentRound;
          this.session.setRoundSetting(currentRound);
          this.emitDeepDebateState();
          console.info(`[orchestrator:${this.session.id}] deep debate budget exhausted, finishing round ${currentRound} with final consensus`);
        }
      }

    } catch (err) {
      if (!signal.aborted) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error';
        console.error(`[orchestrator:${this.session.id}] ${speaker.displayName} turn error: ${errorMsg}`);
        this.emit('stream:log', {
          conversationId: this.session.id,
          participantId: speaker.id,
          level: 'error',
          message: `${speaker.displayName}: ${errorMsg}`,
          timestamp: Date.now(),
        });
        this.emit('stream:error', {
          conversationId: this.session.id,
          participantId: speaker.id,
          error: errorMsg,
        });
      }
    } finally {
      this.abortController = null;
    }
  }

  // ── SSM-aware format/tool helpers ────────────────────────────────

  /**
   * Get the JSON format instruction for the given SSM state.
   * Returns null for states that don't need structured output.
   */
  getFormatInstruction(
    state: SessionState,
    selfName: string,
    otherNames: string[],
  ): string | null {
    switch (state) {
      case 'CONVERSATION':
        return this.messageFormatter.buildConversationFormatInstruction(selfName);
      case 'WORK_DISCUSSING':
        return this.messageFormatter.buildWorkDiscussionFormatInstruction(selfName, otherNames);
      case 'EXECUTING': {
        const projectPath = workspaceService.getProjectFolder() ?? '.';
        const consensusFolder = consensusFolderService.getFolderPath() ?? projectPath;
        const summaryFileName = buildSummaryFileName(Date.now());
        // Pre-seed the filename so it is available when the permission prompt is also built.
        // The permission prompt block in executeTurn may overwrite this with the same value.
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

  /** Convert AppTool[] to ToolDefinition[] for CompletionOptions. */
  convertToolsToDefinitions(tools: AppTool[]): ToolDefinition[] {
    return tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: {},
    }));
  }

  // ── Special turn aliases (delegates to executeTurn) ─────────────

  /** Aggregator synthesis turn (SYNTHESIZING state). */
  async executeSynthesisTurn(speaker: Participant): Promise<void> {
    return this.executeTurn(speaker);
  }

  /** Worker execution turn (EXECUTING state). */
  async executeWorkerTurn(speaker: Participant): Promise<void> {
    // Reset the summary filename before each worker turn so a stale value is
    // never carried over if the worker produces no content.
    this.lastWorkerSummaryFileName = null;
    return this.executeTurn(speaker);
  }

  /** Reviewer review turn (REVIEWING state). */
  async executeReviewTurn(speaker: Participant): Promise<void> {
    return this.executeTurn(speaker);
  }

  /** Push deep debate state to the renderer. */
  emitDeepDebateState(): void {
    this.emit('stream:deep-debate', {
      conversationId: this.session.id,
      active: this.session.deepDebateActive,
      turnsUsed: this.session.deepDebateTurnsUsed,
      turnBudget: this.session.deepDebateTurnBudget,
      turnsRemaining: this.session.deepDebateTurnsRemaining,
    });
  }

  /** Determine whether persona should be included for a provider/participant. */
  shouldIncludePersona(
    provider: { type: string; config: unknown },
    participantId: string,
  ): boolean {
    if (provider.type !== 'cli') return true;
    const config = provider.config;
    const command = isCliProviderConfig(config) ? config.command.toLowerCase() : '';
    const isClaudeCli = command.includes('claude');
    if (!isClaudeCli) return true;
    return !this.personaPrimedParticipants.has(participantId);
  }

  private emit<E extends StreamEventName>(event: E, data: StreamEventMap[E]): void {
    if (!this.webContents.isDestroyed()) {
      this.webContents.send(event, data);
    }
  }
}

/** Type guard: checks if a provider config looks like a CLI provider config. */
function isCliProviderConfig(config: unknown): config is CliProviderConfig {
  return (
    typeof config === 'object'
    && config !== null
    && 'command' in config
    && typeof (config as Record<string, unknown>).command === 'string'
  );
}
