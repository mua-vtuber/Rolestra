/**
 * Stream event types for Main → Renderer push communication.
 *
 * These events are sent via webContents.send() from Main process
 * and received via ipcRenderer.on() in the Renderer process.
 */

import type { ConversationState } from './engine-types';
import type { ConsensusInfo } from './consensus-types';
import type { DiffEntry } from './execution-types';
import type { PermissionRequest } from './file-types';
import type { ModeJudgment, SessionInfo } from './session-state-types';

/** Map of push event names to their payload types. */
export type StreamEventMap = {
  /** A new token arrived from an AI participant. */
  'stream:token': StreamTokenEvent;
  /** A CLI tool natively requested permission (e.g. Claude Code permission_request event). */
  'stream:cli-permission-request': StreamCliPermissionRequestEvent;
  /** An error occurred during streaming. */
  'stream:error': StreamErrorEvent;
  /** The conversation state changed. */
  'stream:state': StreamStateEvent;
  /** A new message was created (for adding to chat store). */
  'stream:message-start': StreamMessageStartEvent;
  /** A message is complete (final token count, response time). */
  'stream:message-done': StreamMessageDoneEvent;
  /** Informational runtime log line for the conversation UI. */
  'stream:log': StreamLogEvent;
  /** Inter-turn wait indicator (next speaker about to start). */
  'stream:turn-wait': StreamTurnWaitEvent;
  /** Consensus status changed (replaces polling). */
  'stream:consensus-update': StreamConsensusUpdateEvent;
  /** A new execution patch set is pending review (replaces polling). */
  'stream:execution-pending': StreamExecutionPendingEvent;
  /** A runtime file/command permission request is awaiting user decision. */
  'stream:permission-pending': StreamPermissionPendingEvent;
  /** Execute/review failure report requiring user decision. */
  'stream:failure-report': StreamFailureReportEvent;
  /** Deep debate state changed. */
  'stream:deep-debate': StreamDeepDebateEvent;
  /** Facilitator generated a consensus document. */
  'stream:consensus-document': StreamConsensusDocumentEvent;
  /** Mode transition request (AI majority voted work). */
  'stream:mode-transition-request': StreamModeTransitionRequestEvent;
  /** Worker selection request (consensus approved). */
  'stream:worker-selection-request': StreamWorkerSelectionRequestEvent;
  /** Session state update (any SSM transition). */
  'stream:session-update': StreamSessionUpdateEvent;
  /** Review complete, awaiting user decision. */
  'stream:review-request': StreamReviewRequestEvent;
};

export type StreamEventName = keyof StreamEventMap;

export interface StreamTokenEvent {
  conversationId: string;
  messageId: string;
  participantId: string;
  token: string;
  sequence: number;
}

export interface StreamErrorEvent {
  conversationId: string;
  participantId: string;
  error: string;
}

export interface StreamStateEvent {
  conversationId: string;
  state: ConversationState;
  currentRound: number;
}

export interface StreamMessageStartEvent {
  conversationId: string;
  messageId: string;
  participantId: string;
  participantName: string;
  role: 'assistant';
  timestamp: number;
}

export interface StreamMessageDoneEvent {
  conversationId: string;
  messageId: string;
  participantId: string;
  inputTokens: number | null;
  tokenCount: number | null;
  totalTokens: number | null;
  usageSource: 'provider' | 'unknown';
  responseTimeMs: number;
  /** Parsed display content to replace raw streaming content. */
  parsedContent?: string;
}

export interface StreamLogEvent {
  conversationId: string;
  participantId?: string;
  level: 'info' | 'warn' | 'error';
  message: string;
  timestamp: number;
}

export interface StreamTurnWaitEvent {
  conversationId: string;
  nextParticipantId: string;
  nextParticipantName: string;
  delayMs: number;
}

export interface StreamConsensusUpdateEvent {
  conversationId: string;
  consensus: ConsensusInfo | null;
}

export interface StreamExecutionPendingEvent {
  conversationId: string;
  operationId: string;
  diffs: DiffEntry[];
}

export interface StreamPermissionPendingEvent {
  conversationId: string;
  request: PermissionRequest;
}

export interface StreamFailureReportEvent {
  conversationId: string;
  stage: 'EXECUTE' | 'REVIEW';
  reason: string;
  options: Array<'retry' | 'stop' | 'reassign'>;
}

export interface StreamDeepDebateEvent {
  conversationId: string;
  active: boolean;
  turnsUsed: number;
  turnBudget: number;
  turnsRemaining: number;
}

export interface StreamConsensusDocumentEvent {
  conversationId: string;
  document: string;
  facilitatorId: string;
  facilitatorName: string;
}

export interface StreamModeTransitionRequestEvent {
  conversationId: string;
  judgments: ModeJudgment[];
}

export interface StreamWorkerSelectionRequestEvent {
  conversationId: string;
  candidates: Array<{ id: string; displayName: string }>;
  proposal: string;
}

export interface StreamSessionUpdateEvent {
  conversationId: string;
  session: SessionInfo;
}

export interface StreamReviewRequestEvent {
  conversationId: string;
  session: SessionInfo;
}

/** Data describing a single CLI-native permission request. */
export interface CliPermissionRequestData {
  /** CLI-internal request identifier for routing responses back. */
  cliRequestId: string;
  /** Tool or action name requested (e.g. "Write", "Bash", "Edit"). */
  toolName: string;
  /** Target path or command string. */
  target: string;
  /** Optional human-readable description from the CLI. */
  description?: string;
}

export interface StreamCliPermissionRequestEvent {
  conversationId: string;
  participantId: string;
  participantName: string;
  request: CliPermissionRequestData;
}
