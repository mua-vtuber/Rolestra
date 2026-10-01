/**
 * CLI session state management.
 *
 * Encapsulates mutable per-session state: session ID, rate-limit flag,
 * warmup flag, and first-response tracking. Extracted from CliProvider
 * to keep state mutations explicit and testable.
 */

import type { CliRuntimeConfig } from './cli-provider';

export class CliSessionState {
  /** Session ID captured from CLI response events (for persistent session continuity). */
  sessionId: string | null = null;
  /** Whether a rate-limit (e.g. 429) was detected on stderr during the current turn. */
  rateLimited = false;
  /** Whether the initial warmup delay has been applied. */
  warmedUp = false;
  /**
   * Whether no text token has been yielded to the consumer yet in this turn
   * (affects hang timeout). Stays true while the CLI emits only meta events
   * such as stream-json `init` / tool events — those mean the process is
   * alive, not that the model has started answering.
   */
  isFirstResponse = true;

  /**
   * Get the hang timeout based on current state. Pure read — the switch from
   * `first` to `subsequent` happens in `markTextYielded()`.
   */
  getHangTimeout(config: CliRuntimeConfig): number {
    // When rate-limited, use the extended timeout if configured
    if (this.rateLimited && config.rateLimitTimeout) {
      return config.rateLimitTimeout;
    }
    return this.isFirstResponse
      ? config.hangTimeout.first
      : config.hangTimeout.subsequent;
  }

  /**
   * Mark that a sanitized text token has been handed to the consumer.
   *
   * Only this transitions the hang timeout from `first` to `subsequent`.
   * Timing the switch on a meta event instead would apply the short
   * `subsequent` budget while the model is still thinking — the cause of
   * the Gemini `CLI response hang timeout (... 30000ms)` reports.
   */
  markTextYielded(): void {
    this.isFirstResponse = false;
  }

  /** Reset per-turn transient state (rate-limit flag, first-response). */
  resetForTurn(): void {
    this.rateLimited = false;
    this.isFirstResponse = true;
  }

  /** Clear the session ID (e.g., when resume produces no output). */
  clearSession(): void {
    this.sessionId = null;
  }
}
