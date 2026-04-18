/**
 * JSON message protocol types for structured AI communication.
 *
 * Three message formats based on session state:
 * - Conversation mode: content + mode_judgment
 * - Work discussion mode: opinion + reasoning + agreements
 * - Review mode: review_result + issues + comments
 */

// ── Conversation Mode ──────────────────────────────────────────────

/**
 * Structured reason for the AI's mode judgment.
 * Used instead of free text so the app can reliably check and display it.
 *
 * work reasons:   'code_change' | 'execution_needed'
 * conversation reasons: 'further_discussion' | 'no_action'
 */
export type JudgmentReason =
  | 'code_change'         // Code needs to be written or modified
  | 'execution_needed'    // Commands or scripts need to run
  | 'further_discussion'  // Topic needs more discussion before any action
  | 'no_action';          // Response is informational; no concrete task required

/** What each AI receives about another AI's message in conversation mode. */
export interface ConversationModeInput {
  name: string;
  content: string;
  mode_judgment: 'conversation' | 'work';
}

/** What each AI outputs in conversation mode. */
export interface ConversationModeOutput {
  name: string;
  content: string;
  mode_judgment: 'conversation' | 'work';
  judgment_reason?: JudgmentReason;
}

// ── Work Discussion Mode ───────────────────────────────────────────

/** What each AI receives/outputs in work discussion mode. */
export interface WorkDiscussionMessage {
  name: string;
  opinion: string;
  reasoning: string;
  agreements: Record<string, boolean>;
}

// ── Review Mode ────────────────────────────────────────────────────

/** What review AIs output. */
export interface ReviewOutput {
  name: string;
  review_result: 'approve' | 'request_changes';
  issues: string[];
  comments: string;
}

/** Context passed to review AIs. */
export interface ReviewContext {
  worker: string;
  task_summary: string;
  changes: ReviewDiffEntry[];
}

export interface ReviewDiffEntry {
  file: string;
  diff: string;
}

// ── Parsed Output Union ────────────────────────────────────────────

/** Discriminated union of all parsed AI output types. */
export type ParsedAiOutput =
  | { type: 'conversation'; data: ConversationModeOutput }
  | { type: 'work_discussion'; data: WorkDiscussionMessage }
  | { type: 'review'; data: ReviewOutput }
  | { type: 'raw'; content: string };
