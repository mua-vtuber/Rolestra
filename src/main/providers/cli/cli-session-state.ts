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
  /** Whether the next response is the first in a turn (affects hang timeout). */
  isFirstResponse = true;

  /** Get the hang timeout based on current state. Advances isFirstResponse. */
  getHangTimeout(config: CliRuntimeConfig): number {
    // When rate-limited, use the extended timeout if configured
    if (this.rateLimited && config.rateLimitTimeout) {
      return config.rateLimitTimeout;
    }
    const timeout = this.isFirstResponse
      ? config.hangTimeout.first
      : config.hangTimeout.subsequent;
    this.isFirstResponse = false;
    return timeout;
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
