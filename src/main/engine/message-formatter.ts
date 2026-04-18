/**
 * MessageFormatter — handles JSON message generation and parsing per session mode.
 *
 * Four formats:
 * - Conversation mode: content + mode_judgment
 * - Work discussion mode: opinion + reasoning + agreements
 * - Execution mode: freeform worker output (no JSON schema), + work summary doc instruction
 * - Review mode: review_result + issues + comments
 *
 * Parsing is lenient: conversation mode always returns a valid result
 * (raw text fallback), while work/review modes return 'raw' on failure.
 */

import type {
  ConversationModeInput,
  ConversationModeOutput,
  WorkDiscussionMessage,
  ReviewOutput,
  ReviewContext,
  ParsedAiOutput,
  JudgmentReason,
} from '../../shared/message-protocol-types';

const VALID_JUDGMENT_REASONS: readonly JudgmentReason[] = [
  'code_change',
  'execution_needed',
  'further_discussion',
  'no_action',
];

/** Input for formatConversationInput. */
export interface ConversationInputEntry {
  name: string;
  content: string;
  modeJudgment: 'conversation' | 'work';
}

export class MessageFormatter {
  // ── Input formatting ──────────────────────────────────────────

  /** Serialize other AI messages as JSON for conversation mode context. */
  formatConversationInput(messages: ConversationInputEntry[]): string {
    const formatted: ConversationModeInput[] = messages.map(m => ({
      name: m.name,
      content: m.content,
      mode_judgment: m.modeJudgment,
    }));
    return JSON.stringify(formatted);
  }

  /** Serialize work discussion messages as JSON context. */
  formatWorkDiscussionInput(messages: WorkDiscussionMessage[]): string {
    return JSON.stringify(messages);
  }

  /** Serialize review context as JSON. */
  formatReviewInput(context: ReviewContext): string {
    return JSON.stringify(context);
  }

  // ── Output parsing ────────────────────────────────────────────

  /**
   * Parse conversation mode output.
   * Always returns type: 'conversation' — gracefully degrades on parse failure.
   */
  parseConversationOutput(raw: string, speakerName: string): ParsedAiOutput {
    try {
      const parsed = JSON.parse(stripCodeFence(raw)) as Record<string, unknown>;
      if (typeof parsed === 'object' && parsed !== null) {
        const content = typeof parsed.content === 'string' ? parsed.content : undefined;
        const modeJudgment = parsed.mode_judgment === 'work' ? 'work' as const : 'conversation' as const;
        const name = typeof parsed.name === 'string' ? parsed.name : speakerName;
        const rawReason = parsed.judgment_reason;
        const judgmentReason: JudgmentReason | undefined =
          typeof rawReason === 'string' && (VALID_JUDGMENT_REASONS as readonly string[]).includes(rawReason)
            ? rawReason as JudgmentReason
            : undefined;

        if (content) {
          const data: ConversationModeOutput = {
            name,
            content,
            mode_judgment: modeJudgment,
          };
          if (judgmentReason) data.judgment_reason = judgmentReason;
          return { type: 'conversation', data };
        }
      }
    } catch {
      // Fall through to fallback
    }

    // Fallback: treat raw text as content
    return {
      type: 'conversation',
      data: {
        name: speakerName,
        content: raw,
        mode_judgment: 'conversation',
      },
    };
  }

  /**
   * Parse work discussion mode output.
   * Returns type: 'raw' on parse failure (structured fields required).
   */
  parseWorkDiscussionOutput(raw: string, speakerName: string): ParsedAiOutput {
    try {
      const parsed = JSON.parse(stripCodeFence(raw)) as Record<string, unknown>;
      if (
        typeof parsed === 'object' && parsed !== null &&
        typeof parsed.opinion === 'string' &&
        typeof parsed.reasoning === 'string' &&
        typeof parsed.agreements === 'object' && parsed.agreements !== null
      ) {
        const data: WorkDiscussionMessage = {
          name: typeof parsed.name === 'string' ? parsed.name : speakerName,
          opinion: parsed.opinion,
          reasoning: parsed.reasoning,
          agreements: parsed.agreements as Record<string, boolean>,
        };
        return { type: 'work_discussion', data };
      }
    } catch {
      // Fall through
    }

    return { type: 'raw', content: raw };
  }

  /**
   * Parse review mode output.
   * Returns type: 'raw' on parse failure.
   */
  parseReviewOutput(raw: string, speakerName: string): ParsedAiOutput {
    try {
      const parsed = JSON.parse(stripCodeFence(raw)) as Record<string, unknown>;
      if (
        typeof parsed === 'object' && parsed !== null &&
        (parsed.review_result === 'approve' || parsed.review_result === 'request_changes') &&
        Array.isArray(parsed.issues) &&
        typeof parsed.comments === 'string'
      ) {
        const data: ReviewOutput = {
          name: typeof parsed.name === 'string' ? parsed.name : speakerName,
          review_result: parsed.review_result,
          issues: parsed.issues.filter((i): i is string => typeof i === 'string'),
          comments: parsed.comments,
        };
        return { type: 'review', data };
      }
    } catch {
      // Fall through
    }

    return { type: 'raw', content: raw };
  }

  // ── System prompt instructions ────────────────────────────────

  /** Build JSON format instruction for conversation mode. */
  buildConversationFormatInstruction(selfName: string): string {
    return `You are ${selfName}. Respond in JSON format:
{
  "name": "${selfName}",
  "content": "your response",
  "mode_judgment": "conversation" | "work",
  "judgment_reason": "code_change" | "execution_needed" | "further_discussion" | "no_action"
}

mode_judgment: "work" if concrete action is needed, "conversation" to continue discussion.
judgment_reason values:
  "code_change"        — code needs to be written or modified (use with "work")
  "execution_needed"   — commands or scripts need to run (use with "work")
  "further_discussion" — more discussion needed before any action (use with "conversation")
  "no_action"          — response is informational only, no task required (use with "conversation")`;
  }

  /** Build JSON format instruction for work discussion mode. */
  buildWorkDiscussionFormatInstruction(selfName: string, otherNames: string[]): string {
    const agreementsExample = otherNames.reduce<Record<string, boolean>>((acc, name) => {
      acc[name] = true;
      return acc;
    }, {});
    return `You are ${selfName}. Respond in JSON format:
{
  "name": "${selfName}",
  "opinion": "your specific opinion on the task",
  "reasoning": "evidence and logic supporting your opinion",
  "agreements": ${JSON.stringify(agreementsExample)}
}

Set agreements to true/false for each other participant based on whether you agree with their opinion.`;
  }

  /**
   * Build format instruction for EXECUTING mode.
   *
   * Instructs the worker to execute the approved plan and write a work summary
   * document to the consensus folder upon completion.
   *
   * @param selfName - Display name of the worker AI.
   * @param consensusFolder - Absolute path to the consensus folder.
   * @param summaryFileName - Target filename for the summary (e.g. work-summary-1234567890.md).
   */
  buildExecutionFormatInstruction(
    selfName: string,
    consensusFolder: string,
    summaryFileName: string,
  ): string {
    return `You are ${selfName}, the designated worker. Execute the approved plan now.

When you have finished all work, write a summary document to:
  ${consensusFolder}/${summaryFileName}

The document must be in Markdown format with the following sections:

# 작업 요약

**작업 일시**: <ISO timestamp>
**작업자**: ${selfName}

## 수정한 파일

- \`<file path>\`: <one-line summary of change>

## 변경 내용 요약

<Overall description of what was changed and why>

## 주요 결정사항

- <Key decision or rationale>

Do not output a JSON object. Write the summary file and then respond with a brief plain-text confirmation that the file has been written.`;
  }

  /**
   * Build JSON format instruction for review mode.
   *
   * @param selfName - Display name of the reviewer AI.
   * @param summaryFilePath - Absolute path to the work summary file written by the worker.
   *   When provided, reviewers are instructed to read this file before writing their review.
   */
  buildReviewFormatInstruction(selfName: string, summaryFilePath?: string): string {
    const summaryInstruction = summaryFilePath
      ? `\n\nThe worker has written a work summary document to:\n  ${summaryFilePath}\nRead this file first to understand what was done before writing your review.\n`
      : '';
    return `You are ${selfName}. Review the changes and respond in JSON format:${summaryInstruction}
{
  "name": "${selfName}",
  "review_result": "approve" | "request_changes",
  "issues": ["list of issues found"],
  "comments": "overall assessment"
}`;
  }
}

/**
 * Strip markdown code fences from AI responses.
 * Handles ```json ... ```, ``` ... ```, and plain text.
 */
function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:\w*)\s*\n?([\s\S]*?)\n?\s*```$/);
  return match ? match[1].trim() : trimmed;
}
