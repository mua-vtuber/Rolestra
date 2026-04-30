/**
 * MeetingSession — v3 replacement for the legacy `ConversationSession`.
 *
 * Responsibilities:
 *   - Holds the immutable meeting identity (meetingId / channelId /
 *     projectId / topic).
 *   - Owns the SessionStateMachine that drives the 12-state consensus
 *     lifecycle for THIS meeting. A MeetingSession always creates a SSM
 *     — spec §7.5 "DM 은 회의를 갖지 않는다" invariant.
 *   - Owns a TurnManager that orders AI turns. R6 removes conversation
 *     branching (fork / switchBranch) since meetings are a single linear
 *     consensus thread; branch history belongs to the channel's full
 *     message log, not the live meeting.
 *   - Tracks the participant-message buffer for provider history adaption.
 *     The buffer is transient (process-lifetime only) — persistent
 *     history lives in the `messages` DB table and is joined on replay.
 *
 * Validation invariants (enforced by the constructor):
 *   - `meetingId`, `channelId`, `projectId` are non-empty strings.
 *   - `participants.length >= 2` (excluding the implicit 'user' sentinel
 *     when present). The R6 plan D7 removes the v2 single-AI branch.
 *   - `ssmCtx.meetingId === meetingId` + `ssmCtx.channelId === channelId`
 *     + `ssmCtx.projectId === projectId`. A mismatch is a programming
 *     error — caller built the context against a different meeting row.
 *
 * Differences vs legacy `ConversationSession`:
 *   - `id` → `meetingId` (1-to-1 with `meetings.id`).
 *   - `channelId` / `projectId` promoted from ad-hoc SSM-only fields to
 *     top-level readonly properties so side-effects and DI consumers can
 *     reach them directly.
 *   - No conversation-branch support. The v2 `fork` / `switchBranch` flow
 *     is unused in v3 meetings — dropped to keep the contract lean.
 *   - SSM is NEVER optional. Callers that want a 1:1 chat path build a
 *     separate (future, R10) `DmSession` class.
 */

import { randomUUID } from 'node:crypto';
import type { Message } from '../../../shared/provider-types';
import type {
  Participant,
  ConversationState,
  RoundSetting,
} from '../../../shared/engine-types';
import type { SessionConfig } from '../../../shared/session-state-types';
import type { SsmContext } from '../../../shared/ssm-context-types';
import type { ConversationTaskSettings } from '../../../shared/config-types';
import { TurnManager } from '../../engine/turn-manager';
import { SessionStateMachine } from '../../engine/session-state-machine';
import {
  adaptMessagesForProvider,
  type ParticipantMessage,
} from '../../engine/history';
import { buildTopicSystemPrompt } from './meeting-prompt-labels';

/**
 * Sentinel participant id / name for the auto-injected topic system message
 * (D-A T2.5, spec §5.5). Picked so it never collides with a real provider id
 * (which are non-empty alphanumeric) and so renderer surfaces filtering AI
 * vs system messages can match on this exact literal.
 */
export const SYSTEM_TOPIC_PARTICIPANT_ID = '__system__';
export const SYSTEM_TOPIC_PARTICIPANT_NAME = 'system';

/**
 * IPC-safe projection used when the renderer asks for the current meeting
 * state. Contains identifiers + turn/round metadata only — the message
 * bodies are streamed separately over `stream:meeting-turn-*`.
 */
export interface MeetingSessionInfo {
  meetingId: string;
  channelId: string;
  projectId: string;
  title: string;
  topic: string;
  state: ConversationState;
  participants: Participant[];
  currentRound: number;
  roundSetting: RoundSetting;
}

export interface MeetingSessionOptions {
  meetingId: string;
  channelId: string;
  projectId: string;
  /** User-provided meeting topic (spec §7.5 "주제 단일 입력 3~200 자"). */
  topic: string;
  /**
   * Participants ordered for turn rotation. MUST contain at least two
   * non-user participants. Callers may include the implicit 'user'
   * sentinel (id === 'user') — it is counted separately.
   */
  participants: Participant[];
  /**
   * Execution context shared with the SSM. Must carry non-empty
   * meetingId / channelId / projectId that match the top-level fields.
   */
  ssmCtx: SsmContext;
  /** Optional display title; defaults to the topic string. */
  title?: string;
  /** Turn-rotation policy. Default: 'unlimited'. */
  roundSetting?: RoundSetting;
  /** SSM configuration override (timeouts, maxRetries, etc). */
  sessionConfig?: Partial<SessionConfig>;
  /** Conversation/task mode policy settings consumed by the orchestrator. */
  taskSettings?: ConversationTaskSettings;
}

export class MeetingSession {
  readonly meetingId: string;
  readonly channelId: string;
  readonly projectId: string;
  readonly topic: string;

  private _title: string;
  private _messages: ParticipantMessage[];
  private _turnManager: TurnManager;
  private _sessionMachine: SessionStateMachine;
  private _taskSettings: ConversationTaskSettings | null;

  private _deepDebateActive = false;
  private _deepDebateTurnsUsed = 0;

  constructor(options: MeetingSessionOptions) {
    const { meetingId, channelId, projectId, topic, participants, ssmCtx } =
      options;

    if (!meetingId) {
      throw new Error('[MeetingSession] meetingId must be non-empty');
    }
    if (!channelId) {
      throw new Error('[MeetingSession] channelId must be non-empty');
    }
    if (!projectId) {
      throw new Error('[MeetingSession] projectId must be non-empty');
    }
    if (typeof topic !== 'string' || topic.trim().length < 3) {
      throw new Error(
        '[MeetingSession] topic must be a string of at least 3 characters',
      );
    }

    // SSM context mirror check — catches the "built context against the
    // wrong meeting row" bug at construction instead of much later in
    // the permission-side-effect path.
    if (ssmCtx.meetingId !== meetingId) {
      throw new Error(
        `[MeetingSession] ssmCtx.meetingId (${ssmCtx.meetingId}) must match meetingId (${meetingId})`,
      );
    }
    if (ssmCtx.channelId !== channelId) {
      throw new Error(
        `[MeetingSession] ssmCtx.channelId (${ssmCtx.channelId}) must match channelId (${channelId})`,
      );
    }
    if (ssmCtx.projectId !== projectId) {
      throw new Error(
        `[MeetingSession] ssmCtx.projectId (${ssmCtx.projectId}) must match projectId (${projectId})`,
      );
    }

    const aiParticipants = participants.filter((p) => p.id !== 'user');
    if (aiParticipants.length < 2) {
      throw new Error(
        `[MeetingSession] a meeting requires at least 2 AI participants (got ${aiParticipants.length})`,
      );
    }

    this.meetingId = meetingId;
    this.channelId = channelId;
    this.projectId = projectId;
    this.topic = topic;
    this._title = options.title ?? topic;
    this._messages = [];
    this._taskSettings = options.taskSettings ?? null;

    // D-A T2.5 / spec §5.5 — 회의 주제를 첫 system 메시지로 주입한다.
    // 이전에는 `topic` 이 metadata 로만 보존되고 AI prompt 에 들어가지 않아
    // (logging only) 사용자가 준 주제가 무시되는 회귀가 있었다 (round2.6
    // dogfooding 보고 #3). 본 주입이 _messages[0] 의 불변식.
    this._messages.push({
      id: randomUUID(),
      role: 'system',
      content: buildTopicSystemPrompt(topic),
      participantId: SYSTEM_TOPIC_PARTICIPANT_ID,
      participantName: SYSTEM_TOPIC_PARTICIPANT_NAME,
    });

    this._turnManager = new TurnManager({
      roundSetting: options.roundSetting ?? 'unlimited',
      participants,
    });

    // SSM is ALWAYS created in v3 meetings — no 1:1 branch.
    this._sessionMachine = new SessionStateMachine({
      conversationId: meetingId,
      participants,
      ctx: ssmCtx,
      projectPath: ssmCtx.projectPath || null,
      config: options.sessionConfig,
    });
  }

  // ── Identity / metadata ──────────────────────────────────────────

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

  get sessionMachine(): SessionStateMachine {
    return this._sessionMachine;
  }

  get taskSettings(): ConversationTaskSettings | null {
    return this._taskSettings;
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

  /**
   * Update the project path on the SSM. Called when the project folder
   * is resolved after the meeting has already started (e.g. external
   * link resolution lands late).
   */
  setProjectPath(projectPath: string): void {
    this._sessionMachine.setProjectPath(projectPath);
  }

  // ── Message management ───────────────────────────────────────────

  /** Append a pre-constructed message to the in-memory buffer. */
  addMessage(message: ParticipantMessage): void {
    this._messages.push(message);
  }

  /** Construct and append a participant message in one step. */
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
    };
    this._messages.push(msg);
    return msg;
  }

  /**
   * Return the history formatted for the given provider — e.g. anthropic
   * and openai expect slightly different role strings and tool-call
   * conventions. The adapter lives in `engine/history.ts` (shared asset).
   */
  getMessagesForProvider(participantId: string): Message[] {
    return adaptMessagesForProvider(this._messages, participantId);
  }

  // ── Turn delegation ──────────────────────────────────────────────

  getNextSpeaker(): Participant | null {
    return this._turnManager.getNextSpeaker();
  }

  /**
   * Append a user message to the meeting buffer AND interrupt turn rotation
   * so the next AI turn sees it (D-A T2.5 / spec §5.5).
   *
   * Prior to T2.5 this method only flagged the turn manager — the message
   * text never reached `_messages`, so AI providers received an empty user
   * history and replied to a generic phantom prompt. Callers must now pass
   * the full {@link ParticipantMessage} they appended to the channel; the
   * session pushes it onto the buffer in addition to interrupting.
   *
   * @throws when `message.role !== 'user'` — guards against accidental
   *   prompt contamination by mis-routed system / assistant messages.
   */
  interruptWithUserMessage(message: ParticipantMessage): void {
    if (message.role !== 'user') {
      throw new Error(
        `[MeetingSession] interruptWithUserMessage requires role='user' (got '${message.role}')`,
      );
    }
    this._messages.push(message);
    this._turnManager.interruptWithUserMessage();
  }

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

  setRoundSetting(setting: RoundSetting): void {
    this._turnManager.setRoundSetting(setting);
  }

  // ── Deep Debate ──────────────────────────────────────────────────

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

  /** Produce an IPC-safe projection for renderer / logging consumers. */
  toInfo(): MeetingSessionInfo {
    return {
      meetingId: this.meetingId,
      channelId: this.channelId,
      projectId: this.projectId,
      title: this._title,
      topic: this.topic,
      state: this.state,
      participants: [...this._turnManager.participants],
      currentRound: this._turnManager.currentRound,
      roundSetting: this._turnManager.roundSetting,
    };
  }
}
