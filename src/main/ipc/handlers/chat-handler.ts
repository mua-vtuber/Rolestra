/**
 * Handler for 'chat:*' IPC channels.
 *
 * Bridges between the IPC layer and ConversationSession + Orchestrator.
 * When a user sends a message, the orchestrator is started to drive
 * the AI turn loop with streaming token push to the renderer.
 */

import type { BrowserWindow } from 'electron';
import type { IpcRequest, IpcResponse } from '../../../shared/ipc-types';
import type { Participant } from '../../../shared/engine-types';
import { ConversationSession } from '../../engine/conversation';
import { ConversationOrchestrator } from '../../engine/orchestrator';
import { submitPatchForReview, clearPendingPatches } from './execution-handler';
import { workspaceService, permissionService } from './workspace-handler';
import { attachPermissionRevocationListener } from '../../files/permission-revocation-listener';
import { attachCliPermissionBridge } from '../../files/cli-permission-bridge';
import { providerRegistry } from '../../providers/registry';
import { getMemoryFacade } from '../../memory/instance';
import { getDatabase } from '../../database/connection';
import { ConversationRepository } from '../../database/conversation-repository';
import { getConfigService } from '../../config/instance';
import { PatchExtractor } from '../../engine/patch-extractor';
import type { OrchestratorDeps } from '../../engine/orchestrator';
import { createDefaultSsmContext } from '../../../shared/ssm-context-types';

const patchExtractor = new PatchExtractor({ parseRetryLimit: 2 });

/** Build execution pipeline deps for the orchestrator. */
function buildOrchestratorDeps(): OrchestratorDeps {
  return {
    submitPatchForReview,
    extractPatchSet: async (proposal, aiId, conversationId) => {
      const projectFolder = workspaceService.getProjectFolder();
      if (!projectFolder) return null;
      return patchExtractor.extract(proposal, aiId, conversationId, projectFolder);
    },
  };
}

/** Track whether first user message has been persisted (for auto-title). */
let firstUserMessagePersisted = false;

/** The currently active conversation session. */
let activeSession: ConversationSession | null = null;

/** The currently active orchestrator. */
let activeOrchestrator: ConversationOrchestrator | null = null;

/** Guard flag to prevent double-click / concurrent send race. */
let isBusy = false;

/** Reference to main window for webContents access. */
let mainWindow: BrowserWindow | null = null;

/** Set the main window reference (called during app init). */
export function setMainWindow(win: BrowserWindow | null): void {
  mainWindow = win;
}

/** Get the active session for testing and external access. */
export function getActiveSession(): ConversationSession | null {
  return activeSession;
}

/** Get the active orchestrator for execution approval callbacks. */
export function getActiveOrchestrator(): ConversationOrchestrator | null {
  return activeOrchestrator;
}

/** Set the active session (used by orchestration layer). */
export function setActiveSession(session: ConversationSession | null): void {
  activeSession = session;
  activeOrchestrator = null;
  firstUserMessagePersisted = false;

  // When session is cleared, reset transient state
  if (session === null) {
    requestedRoundSetting = 'unlimited';
    clearPendingPatches();
    // R7-Task4: v2 cli-permission pending-resolver map is gone — any
    // inflight approvals now live in ApprovalService and are cleaned up
    // by TTL / ApprovalCliAdapter timeout. No explicit reset needed here.
  }
}

/**
 * Build participants from the current provider registry.
 */
function buildParticipants(): Participant[] {
  const providers = providerRegistry.listAll();
  return providers.map((p) => ({
    id: p.id,
    providerId: p.id,
    displayName: p.displayName,
    isActive: true,
  }));
}

/**
 * Get or create a session, ensuring participants are up to date.
 */
/** Requested round setting to apply to newly created sessions. */
let requestedRoundSetting: number | 'unlimited' = 'unlimited';
function getOrCreateSession(): ConversationSession {
  if (!activeSession) {
    const participants = buildParticipants();

    // Read settings and build consensus config from them
    const settings = getConfigService().getSettings();
    const taskSettings = settings.conversationTask;

    activeSession = new ConversationSession({
      participants,
      roundSetting: requestedRoundSetting,
      sessionConfig: {
        maxRetries: settings.maxRetries,
        phaseTimeout: settings.phaseTimeoutMs,
        // Runtime only implements 'designated'; the wider union in
        // SettingsConfig exists because the UI picker exposes planned
        // strategies that the engine hasn't grown yet. Collapse to
        // 'designated' at the call site rather than leaking the
        // mismatch into the SSM.
        aggregatorStrategy: 'designated',
        designatedAggregatorId: settings.designatedAggregatorId || undefined,
        parseRetryLimit: taskSettings.aiDecisionParseRetryLimit,
        // `deepDebateTurnBudget` lives on `taskSettings` (passed
        // separately below) and on the v2 ConsensusConfig shape; it is
        // NOT a field of the v3 SessionConfig interface, so we do not
        // forward it here.
      },
      taskSettings,
      // R2-bridge: no real meeting/channel yet — the v2 chat UI has
      // no project selector. Task 18 IPC wiring and Task 20 SSM
      // side-effects consume the ctx with the sentinel empty strings
      // and skip DB writes. A future R3 pass will inject real ids
      // when the project-aware chat view lands.
      ssmCtx: createDefaultSsmContext(),
    });
    // Persist conversation to DB
    try {
      const repo = new ConversationRepository(getDatabase());
      const participantsJson = JSON.stringify(participants);
      repo.createConversation(activeSession.id, '', 'conversation', participantsJson);
      firstUserMessagePersisted = false;
    } catch (err) {
      console.error('[chat-handler] Failed to persist conversation:', err);
    }

    // SSM snapshot persistence is handled by SessionStateMachine internally

    // Attach permission revocation listener to SSM
    if (activeSession.sessionMachine) {
      attachPermissionRevocationListener(activeSession.sessionMachine, permissionService);
      // Bridge SSM permission events to CLI provider respawn
      attachCliPermissionBridge(
        activeSession.sessionMachine,
        (id) => providerRegistry.get(id),
        () => providerRegistry.listAll().map(p => p.id),
      );
    }
  }
  return activeSession;
}

function syncSessionParticipants(
  session: ConversationSession,
  activeProviderIds?: string[],
): void {
  const requestedActive = new Set(activeProviderIds ?? []);
  const providers = providerRegistry.listAll();
  const existingIds = new Set(session.participants.map((p) => p.id));

  for (const provider of providers) {
    if (!existingIds.has(provider.id)) {
      session.turnManager.addParticipant({
        id: provider.id,
        providerId: provider.id,
        displayName: provider.displayName,
        isActive: true,
      });
    }
  }

  const hasSelection = requestedActive.size > 0;
  for (const participant of session.participants) {
    if (participant.id === 'user') continue;
    const isActive = hasSelection ? requestedActive.has(participant.id) : true;
    session.turnManager.setParticipantActive(participant.id, isActive);
  }
}

/**
 * chat:send — process an incoming user message.
 *
 * Adds the user message and starts the AI turn loop via orchestrator.
 */
export function handleChatSend(
  data: IpcRequest<'chat:send'>,
): IpcResponse<'chat:send'> {
  if (isBusy) {
    throw new Error('Chat send already in progress.');
  }
  isBusy = true;
  try {
  const session = getOrCreateSession();

  // A completed run leaves TurnManager in "stopped".
  // Reset before starting a new orchestrator run.
  if (session.state === 'stopped') {
    session.turnManager.reset();
  }

  syncSessionParticipants(session, data.activeProviderIds);

  const userMsg = session.createMessage({
    participantId: 'user',
    participantName: 'User',
    role: 'user',
    content: data.content,
  });
  // Note: CSM removed; voting invalidation now handled by SSM transitions

  // Persist user message to DB
    try {
      const repo = new ConversationRepository(getDatabase());
      const participantsJson = JSON.stringify(session.participants);
      repo.createConversation(session.id, '', 'conversation', participantsJson);
      repo.insertMessage({
        id: userMsg.id,
        conversationId: session.id,
        participantId: 'user',
      participantName: 'User',
      role: 'user',
      content: data.content,
      branchId: userMsg.branchId,
      parentMessageId: userMsg.parentMessageId,
    });
    // Auto-generate title from first user message
    if (!firstUserMessagePersisted) {
      firstUserMessagePersisted = true;
      const title = repo.generateTitle(data.content);
      repo.updateTitle(session.id, title);
    }
  } catch (err) {
    console.error('[chat-handler] Failed to persist user message:', err);
  }

  // If conversation is already running or paused, inject the message
  // into the existing session without creating a new orchestrator.
  // Running: remaining AI speakers will see the message in their context.
  // Paused: the message is recorded; AIs will see it upon resume.
  if ((session.state === 'running' || session.state === 'paused') && activeOrchestrator) {
    if (session.state === 'running') {
      activeOrchestrator.handleUserInterjection();
    }
    return undefined;
  }

  // Start orchestrator if we have a main window
  if (mainWindow && !mainWindow.isDestroyed()) {
    activeOrchestrator = new ConversationOrchestrator(
      session,
      mainWindow.webContents,
      getMemoryFacade(),
      buildOrchestratorDeps(),
    );
    void activeOrchestrator.run().catch((err) => {
      const errorMessage = err instanceof Error ? err.message : String(err);
      if (!mainWindow || mainWindow.isDestroyed()) return;
      mainWindow.webContents.send('stream:error', {
        conversationId: session.id,
        participantId: 'system',
        error: `Orchestrator failed: ${errorMessage}`,
      });
    });
  }

  return undefined;
  } finally {
    isBusy = false;
  }
}

/**
 * chat:pause — pause the active conversation.
 */
export function handleChatPause(): IpcResponse<'chat:pause'> {
  if (!activeOrchestrator) {
    throw new Error('No active conversation to pause.');
  }
  activeOrchestrator.pause();
  return undefined;
}

/**
 * chat:resume — resume a paused conversation.
 */
export function handleChatResume(): IpcResponse<'chat:resume'> {
  if (!activeOrchestrator) {
    throw new Error('No active conversation to resume.');
  }
  activeOrchestrator.resume();
  return undefined;
}

/**
 * chat:stop — stop the active conversation.
 */
export function handleChatStop(): IpcResponse<'chat:stop'> {
  if (!activeOrchestrator) {
    throw new Error('No active conversation to stop.');
  }
  activeOrchestrator.stop();
  activeOrchestrator = null;
  return undefined;
}

/**
 * chat:set-rounds — update the round setting for the active conversation.
 */
export function handleChatSetRounds(
  data: IpcRequest<'chat:set-rounds'>,
): IpcResponse<'chat:set-rounds'> {
  requestedRoundSetting = data.rounds;

  const session = getOrCreateSession();
  session.setRoundSetting(data.rounds);
  return undefined;
}

/**
 * chat:deep-debate — activate deep debate mode for the current conversation.
 */
export function handleChatDeepDebate(
  _data: IpcRequest<'chat:deep-debate'>,
): IpcResponse<'chat:deep-debate'> {
  const session = getOrCreateSession();

  if (session.deepDebateActive) {
    throw new Error('Deep debate is already active.');
  }

  const activeAi = session.participants.filter(p => p.isActive && p.id !== 'user');
  if (activeAi.length < 2) {
    throw new Error('Deep debate requires at least 2 active AI participants.');
  }

  // Note: designated facilitator is set via sessionConfig at session creation

  session.startDeepDebate();

  // Reset turn manager so the loop can continue with new budget
  if (session.state === 'stopped') {
    session.turnManager.reset();
  }

  session.setRoundSetting('unlimited');

  // Start orchestrator if not already running
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (!activeOrchestrator || !session.deepDebateActive) {
      activeOrchestrator = new ConversationOrchestrator(
        session,
        mainWindow.webContents,
        getMemoryFacade(),
        buildOrchestratorDeps(),
      );
      void activeOrchestrator.run().catch((err) => {
        const errorMessage = err instanceof Error ? err.message : String(err);
        if (!mainWindow || mainWindow.isDestroyed()) return;
        mainWindow.webContents.send('stream:error', {
          conversationId: session.id,
          participantId: 'system',
          error: `Deep debate failed: ${errorMessage}`,
        });
      });
    }

    mainWindow.webContents.send('stream:deep-debate', {
      conversationId: session.id,
      active: true,
      turnsUsed: 0,
      turnBudget: session.deepDebateTurnBudget,
      turnsRemaining: session.deepDebateTurnsRemaining,
    });
  }

  return undefined;
}

/**
 * chat:continue — continue conversation with additional turns after pause/round completion.
 */
export function handleChatContinue(): IpcResponse<'chat:continue'> {
  const session = getOrCreateSession();

  // Reset turn manager for additional turns
  if (session.state === 'stopped') {
    session.turnManager.reset();
  }

  // If paused, resume
  if (session.state === 'paused' && activeOrchestrator) {
    activeOrchestrator.resume();
    return undefined;
  }

  // Arena mode (2+ AIs, SSM active): wake the loop from its user-action wait.
  // After a round completes, runArenaLoop() waits for user action. The session
  // remains internally 'running', so we must wake it rather than create a new orchestrator.
  if (activeOrchestrator && session.sessionMachine && session.state === 'running') {
    activeOrchestrator.wakeFromUserAction();
    return undefined;
  }

  // Start a new orchestrator run if needed
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (!activeOrchestrator || session.state === 'stopped' || session.state === 'idle') {
      activeOrchestrator = new ConversationOrchestrator(
        session,
        mainWindow.webContents,
        getMemoryFacade(),
        buildOrchestratorDeps(),
      );
      void activeOrchestrator.run().catch((err) => {
        const errorMessage = err instanceof Error ? err.message : String(err);
        if (!mainWindow || mainWindow.isDestroyed()) return;
        mainWindow.webContents.send('stream:error', {
          conversationId: session.id,
          participantId: 'system',
          error: `Continue failed: ${errorMessage}`,
        });
      });
    }
  }

  return undefined;
}

/**
 * chat:fork — fork the conversation from a specific message.
 *
 * Stops any running orchestrator, creates a new branch,
 * and returns the fork result.
 */
export function handleChatFork(
  data: IpcRequest<'chat:fork'>,
): IpcResponse<'chat:fork'> {
  const session = getOrCreateSession();

  // Stop the orchestrator if running
  if (activeOrchestrator) {
    activeOrchestrator.stop();
    activeOrchestrator = null;
  }

  return session.fork(data.messageId);
}

/**
 * chat:list-branches — list all branches in the active conversation.
 */
export function handleChatListBranches(): IpcResponse<'chat:list-branches'> {
  const session = getOrCreateSession();
  return {
    branches: session.listBranches(),
    currentBranchId: session.currentBranchId,
  };
}

/**
 * chat:switch-branch — switch to a different branch.
 */
export function handleChatSwitchBranch(
  data: IpcRequest<'chat:switch-branch'>,
): IpcResponse<'chat:switch-branch'> {
  const session = getOrCreateSession();

  // Stop the orchestrator if running
  if (activeOrchestrator) {
    activeOrchestrator.stop();
    activeOrchestrator = null;
  }

  session.switchBranch(data.branchId);
  return undefined;
}


/**
 * session:mode-transition-respond — user approves/rejects a mode transition.
 */
export function handleSessionModeTransitionRespond(
  data: IpcRequest<'session:mode-transition-respond'>,
): IpcResponse<'session:mode-transition-respond'> {
  if (!activeOrchestrator) throw new Error('No active conversation.');
  void activeOrchestrator.handleModeTransitionResponse(data.approved);
  return undefined;
}

/**
 * session:select-worker — user selects a worker after consensus approval.
 */
export function handleSessionSelectWorker(
  data: IpcRequest<'session:select-worker'>,
): IpcResponse<'session:select-worker'> {
  if (!activeOrchestrator) throw new Error('No active conversation.');
  void activeOrchestrator.handleWorkerSelection(data.workerId);
  return undefined;
}

/**
 * session:user-decision — user decides after review (accept/rework/reassign/stop).
 */
export function handleSessionUserDecision(
  data: IpcRequest<'session:user-decision'>,
): IpcResponse<'session:user-decision'> {
  if (!activeOrchestrator) throw new Error('No active conversation.');
  void activeOrchestrator.handleUserDecision(data.decision, data.reassignWorkerId);
  return undefined;
}

/**
 * session:status — get current session state machine info.
 */
export function handleSessionStatus(): IpcResponse<'session:status'> {
  if (!activeSession?.sessionMachine) return { session: null };
  return { session: activeSession.sessionMachine.toInfo() };
}
