/**
 * Turn Manager — controls speaking order and round progression.
 *
 * Manages round-robin turn assignment among active AI participants,
 * handles user interruptions, and tracks round completion.
 *
 * Design:
 * - Round-robin among active participants for fair turn distribution.
 * - User messages can interrupt at any point (not bound by turns).
 * - Supports pause/resume/stop lifecycle.
 * - Round tracking respects both numeric limits and 'unlimited' mode.
 */

import type {
  Participant,
  ConversationState,
  RoundSetting,
} from '../../shared/engine-types';

export class TurnManager {
  private _roundSetting: RoundSetting;
  private _currentRound: number;
  private _participants: Participant[];
  private _state: ConversationState;

  /**
   * Index of the last speaker in the participants array.
   * -1 means no one has spoken yet this round.
   */
  private speakerIndex: number;

  /** Number of participants who have spoken in the current round. */
  private turnsInCurrentRound: number;

  /**
   * Flag set by interruptWithUserMessage().
   * When true, getNextSpeaker() yields null once so the orchestrator
   * can process the user message before resuming AI turns.
   */
  private _interrupted = false;

  constructor(options: {
    roundSetting: RoundSetting;
    participants: Participant[];
  }) {
    this._roundSetting = options.roundSetting;
    this._participants = [...options.participants];
    this._currentRound = 1;
    this._state = 'idle';
    this.speakerIndex = -1;
    this.turnsInCurrentRound = 0;
  }

  // ── Read-only accessors ──────────────────────────────────────────

  get roundSetting(): RoundSetting {
    return this._roundSetting;
  }

  get currentRound(): number {
    return this._currentRound;
  }

  get participants(): readonly Participant[] {
    return this._participants;
  }

  get state(): ConversationState {
    return this._state;
  }

  // ── Mutators ─────────────────────────────────────────────────────

  setRoundSetting(setting: RoundSetting): void {
    this._roundSetting = setting;
  }

  addParticipant(participant: Participant): void {
    if (this._participants.some(p => p.id === participant.id)) {
      throw new Error(`Participant already exists: ${participant.id}`);
    }
    this._participants.push({ ...participant });
  }

  removeParticipant(id: string): void {
    this._participants = this._participants.filter(p => p.id !== id);
  }

  setParticipantActive(id: string, isActive: boolean): void {
    const participant = this._participants.find(p => p.id === id);
    if (!participant) {
      throw new Error(`Participant not found: ${id}`);
    }
    participant.isActive = isActive;
  }

  // ── Turn logic ───────────────────────────────────────────────────

  /**
   * Get the next AI speaker using round-robin among active participants.
   *
   * Returns null when:
   * - The conversation is not running.
   * - All rounds are complete (for numeric round settings).
   * - No active AI participants remain.
   */
  getNextSpeaker(): Participant | null {
    if (this._state !== 'running') {
      return null;
    }

    // Yield control back so the orchestrator can process the user message
    if (this._interrupted) {
      this._interrupted = false;
      return null;
    }

    const activeAi = this._participants.filter(
      p => p.isActive && p.id !== 'user',
    );

    if (activeAi.length === 0) {
      return null;
    }

    // Check if the current round is complete
    if (this.turnsInCurrentRound >= activeAi.length) {
      // All active AI participants have spoken this round
      if (this._roundSetting !== 'unlimited' && this._currentRound >= this._roundSetting) {
        // All rounds complete
        return null;
      }
      // Advance to the next round
      this._currentRound++;
      this.turnsInCurrentRound = 0;
    }

    // Find next speaker index in the full participants list (round-robin)
    const startSearch = this.speakerIndex + 1;
    for (let i = 0; i < this._participants.length; i++) {
      const idx = (startSearch + i) % this._participants.length;
      const candidate = this._participants[idx];
      if (candidate.isActive && candidate.id !== 'user') {
        this.speakerIndex = idx;
        this.turnsInCurrentRound++;
        return candidate;
      }
    }

    return null;
  }

  /**
   * Handle a user interruption during AI conversation.
   *
   * Sets an internal flag that causes getNextSpeaker() to return null
   * on the next call, yielding control back to the orchestrator so it
   * can process the user message before resuming AI turns.
   *
   * The speaker index and round state are preserved, so AI turns
   * resume from where they left off after the interruption.
   */
  interruptWithUserMessage(): void {
    this._interrupted = true;
  }

  /**
   * Check whether the current round is complete
   * (all active AI participants have spoken).
   */
  isRoundComplete(): boolean {
    const activeAi = this._participants.filter(
      p => p.isActive && p.id !== 'user',
    );
    return this.turnsInCurrentRound >= activeAi.length;
  }

  /**
   * Check whether all configured rounds are finished.
   */
  isAllRoundsComplete(): boolean {
    if (this._roundSetting === 'unlimited') {
      return false;
    }
    return this._currentRound >= this._roundSetting && this.isRoundComplete();
  }

  // ── Lifecycle ────────────────────────────────────────────────────

  start(): void {
    if (this._state !== 'idle') {
      throw new Error(`Cannot start: current state is "${this._state}"`);
    }
    this._state = 'running';
    this._currentRound = 1;
    this.speakerIndex = -1;
    this.turnsInCurrentRound = 0;
  }

  pause(): void {
    if (this._state !== 'running') {
      throw new Error(`Cannot pause: current state is "${this._state}"`);
    }
    this._state = 'paused';
  }

  resume(): void {
    if (this._state !== 'paused') {
      throw new Error(`Cannot resume: current state is "${this._state}"`);
    }
    this._state = 'running';
  }

  stop(): void {
    if (this._state === 'idle' || this._state === 'stopped') {
      return; // Already stopped or never started — idempotent
    }
    this._state = 'stopped';
  }

  /**
   * Reset the turn manager to idle state for reuse.
   */
  reset(): void {
    this._state = 'idle';
    this._currentRound = 1;
    this.speakerIndex = -1;
    this.turnsInCurrentRound = 0;
    this._interrupted = false;
  }
}
