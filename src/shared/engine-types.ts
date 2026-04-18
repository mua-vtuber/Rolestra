/**
 * Conversation engine type definitions shared between main and renderer.
 *
 * These types define the contract for conversation sessions, participants,
 * turn management, and branching.
 */

/** A participant in a conversation (AI or user). */
export interface Participant {
  /** Unique participant ID (matches provider ID for AI, 'user' for human). */
  id: string;
  /** Provider ID for AI participants, undefined for the user. */
  providerId?: string;
  /** Display name shown in the chat UI. */
  displayName: string;
  /** Whether this participant is currently active in the conversation. */
  isActive: boolean;
}

/** Conversation lifecycle state. */
export type ConversationState = 'idle' | 'running' | 'paused' | 'stopped';

/** Round setting: a specific number or unlimited rounds. */
export type RoundSetting = number | 'unlimited';

/** Default branch ID for the main (un-forked) conversation line. */
export const DEFAULT_BRANCH_ID = 'main';

/** Information about a conversation branch (fork). */
export interface BranchInfo {
  /** Unique branch identifier. */
  id: string;
  /** Parent branch ID (null for the main branch). */
  parentBranchId: string | null;
  /** The message ID from which this branch was forked. */
  branchRootMessageId: string;
  /** Timestamp when the branch was created. */
  createdAt: number;
}

/** Result returned after creating a fork. */
export interface ForkResult {
  /** The new branch's ID. */
  branchId: string;
  /** The message from which the fork originated. */
  branchRootMessageId: string;
}

/** Summary for listing persisted conversations. */
export interface ConversationSummary {
  id: string;
  title: string;
  participantNames: string[];
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

/** Serialized message data for IPC transport (conversation load). */
export interface ChatMessageData {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  participantId: string;
  participantName: string;
  responseTimeMs?: number;
  tokenCount?: number;
  createdAt: string;
  branchId?: string;
}

/** Serializable conversation info for IPC transport. */
export interface ConversationInfo {
  id: string;
  title: string;
  state: ConversationState;
  participants: Participant[];
  currentRound: number;
  roundSetting: RoundSetting;
  /** Current active branch ID. */
  currentBranchId: string;
  /** All branches in this conversation. */
  branches: BranchInfo[];
}
