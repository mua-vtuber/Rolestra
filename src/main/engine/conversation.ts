/**
 * Conversation Session — manages a single conversation's lifecycle.
 *
 * Responsibilities:
 * - Stores the full message history (with participant metadata).
 * - Delegates turn ordering to TurnManager.
 * - Provides per-provider message adaptation via history.ts.
 * - Exposes start/pause/resume/stop lifecycle controls.
 * - Manages conversation branches (fork/switch).
 *
 * This is the main entry point for the conversation engine.
 * The IPC handler (chat-handler) interacts with ConversationSession instances.
 */

import { randomUUID } from 'node:crypto';
import type { Message } from '../../shared/provider-types';
import type {
  Participant,
  ConversationState,
  RoundSetting,
  ConversationInfo,
  BranchInfo,
  ForkResult,
} from '../../shared/engine-types';
import { DEFAULT_BRANCH_ID } from '../../shared/engine-types';
import type { SessionConfig } from '../../shared/session-state-types';
import type { ConversationTaskSettings } from '../../shared/config-types';
import { TurnManager } from './turn-manager';
import { SessionStateMachine } from './session-state-machine';
import { adaptMessagesForProvider, type ParticipantMessage } from './history';

export class ConversationSession {
  readonly id: string;
  private _title: string;
  private _messages: ParticipantMessage[];
  private _turnManager: TurnManager;
  private _sessionMachine: SessionStateMachine | null;

  /** Conversation/task mode policy settings (read by orchestrator). */
  private _taskSettings: ConversationTaskSettings | null = null;

  /** Whether deep debate mode is currently active. */
  private _deepDebateActive = false;

  /** Turns consumed in the current deep debate session. */
  private _deepDebateTurnsUsed = 0;

  /** All branches in this conversation. Main branch is implicit. */
  private _branches: Map<string, BranchInfo> = new Map();

  /** Currently active branch ID. */
  private _currentBranchId: string = DEFAULT_BRANCH_ID;

  constructor(options: {
    id?: string;
    title?: string;
    participants: Participant[];
    roundSetting?: RoundSetting;
    sessionConfig?: Partial<SessionConfig>;
    taskSettings?: ConversationTaskSettings;
  }) {
    this.id = options.id ?? randomUUID();
    this._title = options.title ?? '';
    this._messages = [];
    this._taskSettings = options.taskSettings ?? null;
    this._turnManager = new TurnManager({
      roundSetting: options.roundSetting ?? 'unlimited',
      participants: options.participants,
    });

    // Arena mode: 2+ AI participants → create SSM; 1:1 mode → null
    const aiParticipants = options.participants.filter((p) => p.id !== 'user');
    if (aiParticipants.length >= 2) {
      this._sessionMachine = new SessionStateMachine({
        conversationId: this.id,
        participants: options.participants,
        projectPath: null,
        config: options.sessionConfig,
      });
    } else {
      this._sessionMachine = null;
    }
  }

  // ── Accessors ────────────────────────────────────────────────────

  get title(): string {
    return this._title;
  }

  set title(value: string) {
    this._title = value;
  }

  get messages(): readonly ParticipantMessage[] {
    return this._messages;
  }

  get turnManager(): TurnManager {
    return this._turnManager;
  }

  get state(): ConversationState {
    return this._turnManager.state;
  }

  get participants(): readonly Participant[] {
    return this._turnManager.participants;
  }

  /** Session state machine (Arena mode only, 2+ AI participants). */
  get sessionMachine(): SessionStateMachine | null {
    return this._sessionMachine;
  }

  /** @deprecated — CSM replaced by SSM. Always returns null. */
  get consensus(): null {
    return null;
  }

  /** Conversation/task mode policy settings. */
  get taskSettings(): ConversationTaskSettings | null {
    return this._taskSettings;
  }

  get currentBranchId(): string {
    return this._currentBranchId;
  }

  get deepDebateActive(): boolean {
    return this._deepDebateActive;
  }

  get deepDebateTurnsUsed(): number {
    return this._deepDebateTurnsUsed;
  }

  get deepDebateTurnBudget(): number {
    return this._taskSettings?.deepDebateTurnBudget ?? 30;
  }

  get deepDebateTurnsRemaining(): number {
    if (!this._deepDebateActive) return 0;
    return Math.max(0, this.deepDebateTurnBudget - this._deepDebateTurnsUsed);
  }

  /** Set project path on the session machine (called by chat-handler after workspace init). */
  setProjectPath(projectPath: string): void {
    this._sessionMachine?.setProjectPath(projectPath);
  }

  // ── Message management ───────────────────────────────────────────

  /**
   * Add a message to the conversation history.
   * Automatically assigns branchId if not set.
   */
  addMessage(message: ParticipantMessage): void {
    if (!message.branchId) {
      message.branchId = this._currentBranchId;
    }
    // Set parentMessageId to the last message on the current branch
    if (!message.parentMessageId) {
      const branchMessages = this.getMessagesForBranch(message.branchId);
      if (branchMessages.length > 0) {
        message.parentMessageId = branchMessages[branchMessages.length - 1].id;
      }
    }
    this._messages.push(message);
  }

  /**
   * Create and add a message in one step.
   */
  createMessage(options: {
    id?: string;
    participantId: string;
    participantName: string;
    role: Message['role'];
    content: Message['content'];
    metadata?: Record<string, unknown>;
  }): ParticipantMessage {
    const msg: ParticipantMessage = {
      id: options.id ?? randomUUID(),
      role: options.role,
      content: options.content,
      participantId: options.participantId,
      participantName: options.participantName,
      metadata: options.metadata,
      branchId: this._currentBranchId,
    };

    // Set parentMessageId to the last message on the current branch
    const branchMessages = this.getMessagesForBranch(this._currentBranchId);
    if (branchMessages.length > 0) {
      msg.parentMessageId = branchMessages[branchMessages.length - 1].id;
    }

    this._messages.push(msg);
    return msg;
  }

  /**
   * Get the conversation history adapted for a specific provider.
   * Only includes messages from the current branch.
   */
  getMessagesForProvider(participantId: string): Message[] {
    const branchMessages = this.getMessagesForBranch(this._currentBranchId);
    return adaptMessagesForProvider(branchMessages, participantId);
  }

  // ── Branch / Fork ─────────────────────────────────────────────────

  /**
   * Fork the conversation from a specific message.
   *
   * Creates a new branch that shares all messages up to (and including)
   * the fork point, then diverges independently.
   *
   * @param messageId - The message to fork from.
   * @returns ForkResult with the new branch ID.
   * @throws Error if the message is not found.
   */
  fork(messageId: string): ForkResult {
    // Find the message to fork from
    const forkMessage = this._messages.find((m) => m.id === messageId);
    if (!forkMessage) {
      throw new Error(`Message not found: ${messageId}`);
    }

    // Determine the branch the message belongs to
    const sourceBranchId = forkMessage.branchId ?? DEFAULT_BRANCH_ID;

    const newBranchId = randomUUID();
    const branchInfo: BranchInfo = {
      id: newBranchId,
      parentBranchId: sourceBranchId,
      branchRootMessageId: messageId,
      createdAt: Date.now(),
    };

    this._branches.set(newBranchId, branchInfo);
    this._currentBranchId = newBranchId;

    // Reset turn manager for the new branch conversation
    this._turnManager.reset();

    return {
      branchId: newBranchId,
      branchRootMessageId: messageId,
    };
  }

  /**
   * Switch to a different branch.
   *
   * @param branchId - The branch to switch to.
   * @throws Error if the branch does not exist.
   */
  switchBranch(branchId: string): void {
    if (branchId !== DEFAULT_BRANCH_ID && !this._branches.has(branchId)) {
      throw new Error(`Branch not found: ${branchId}`);
    }
    this._currentBranchId = branchId;

    // Reset turn manager when switching branches
    this._turnManager.reset();
  }

  /**
   * List all branches in this conversation.
   */
  listBranches(): BranchInfo[] {
    return Array.from(this._branches.values());
  }

  /**
   * Get the ordered message list for a specific branch.
   *
   * For the main branch, returns all messages tagged with 'main'.
   * For fork branches, returns the ancestor messages up to the fork point
   * plus the branch's own messages.
   */
  getMessagesForBranch(branchId: string): ParticipantMessage[] {
    if (branchId === DEFAULT_BRANCH_ID) {
      return this._messages.filter(
        (m) => !m.branchId || m.branchId === DEFAULT_BRANCH_ID,
      );
    }

    const branch = this._branches.get(branchId);
    if (!branch) {
      return [];
    }

    // Get ancestor messages up to the fork point (inclusive)
    const ancestorMessages = this.getAncestorMessages(
      branch.parentBranchId ?? DEFAULT_BRANCH_ID,
      branch.branchRootMessageId,
    );

    // Get this branch's own messages
    const ownMessages = this._messages.filter((m) => m.branchId === branchId);

    return [...ancestorMessages, ...ownMessages];
  }

  /**
   * Recursively collect ancestor messages up to a given message ID.
   */
  private getAncestorMessages(
    branchId: string,
    upToMessageId: string,
  ): ParticipantMessage[] {
    const branchMessages =
      branchId === DEFAULT_BRANCH_ID
        ? this._messages.filter(
            (m) => !m.branchId || m.branchId === DEFAULT_BRANCH_ID,
          )
        : this.getMessagesForBranch(branchId);

    // Find the fork point and include everything up to it
    const cutoffIndex = branchMessages.findIndex((m) => m.id === upToMessageId);
    if (cutoffIndex === -1) {
      return branchMessages;
    }
    return branchMessages.slice(0, cutoffIndex + 1);
  }

  // ── Turn delegation ──────────────────────────────────────────────

  /**
   * Get the next AI speaker for this conversation.
   * Delegates to the internal TurnManager.
   */
  getNextSpeaker(): Participant | null {
    return this._turnManager.getNextSpeaker();
  }

  /**
   * Handle user interruption.
   * Delegates to the internal TurnManager.
   */
  interruptWithUserMessage(): void {
    this._turnManager.interruptWithUserMessage();
  }

  /**
   * Check whether all rounds are complete.
   */
  isComplete(): boolean {
    return this._turnManager.isAllRoundsComplete();
  }

  // ── Lifecycle ────────────────────────────────────────────────────

  start(): void {
    this._turnManager.start();
  }

  pause(): void {
    this._turnManager.pause();
  }

  resume(): void {
    this._turnManager.resume();
  }

  stop(): void {
    this._turnManager.stop();
  }

  // ── Settings ─────────────────────────────────────────────────────

  setRoundSetting(setting: RoundSetting): void {
    this._turnManager.setRoundSetting(setting);
  }

  // ── Deep Debate ─────────────────────────────────────────────────

  startDeepDebate(): void {
    this._deepDebateActive = true;
    this._deepDebateTurnsUsed = 0;
  }

  recordDeepDebateTurn(): void {
    if (!this._deepDebateActive) return;
    this._deepDebateTurnsUsed++;
  }

  isDeepDebateBudgetExhausted(): boolean {
    if (!this._deepDebateActive) return false;
    return this._deepDebateTurnsUsed >= this.deepDebateTurnBudget;
  }

  stopDeepDebate(): void {
    this._deepDebateActive = false;
    this._deepDebateTurnsUsed = 0;
  }

  // ── Serialization ────────────────────────────────────────────────

  /**
   * Serialize to IPC-safe ConversationInfo (no methods, no message bodies).
   */
  toInfo(): ConversationInfo {
    return {
      id: this.id,
      title: this._title,
      state: this.state,
      participants: [...this._turnManager.participants],
      currentRound: this._turnManager.currentRound,
      roundSetting: this._turnManager.roundSetting,
      currentBranchId: this._currentBranchId,
      branches: this.listBranches(),
    };
  }
}
