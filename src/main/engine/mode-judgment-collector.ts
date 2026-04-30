/**
 * ModeJudgmentCollector — collects and evaluates mode_judgment votes per round.
 *
 * Tracks each AI's judgment (conversation|work) and determines
 * whether a majority voted for work mode transition.
 */

import type { ModeJudgment } from '../../shared/session-state-types';

export class ModeJudgmentCollector {
  private _judgments: ModeJudgment[] = [];

  get judgments(): readonly ModeJudgment[] {
    return this._judgments;
  }

  record(judgment: ModeJudgment): void {
    const idx = this._judgments.findIndex((j) => j.participantId === judgment.participantId);
    if (idx >= 0) {
      this._judgments[idx] = judgment;
    } else {
      this._judgments.push(judgment);
    }
  }

  hasMajorityWork(): boolean {
    if (this._judgments.length === 0) return false;
    const workCount = this._judgments.filter((j) => j.judgment === 'work').length;
    return workCount > this._judgments.length / 2;
  }

  /**
   * dogfooding 2026-05-01 #2-1 — every recorded judgment in this round
   * is `conversation` + `no_action`. Spec semantics: `no_action` means
   * "informational only, no task required" — when all participants who
   * spoke in this round vote that, they implicitly agree the discussion
   * has concluded with nothing left to do. The orchestrator uses this
   * to terminate the meeting naturally instead of looping CONVERSATION
   * forever.
   *
   * Returns false when the collector is empty (no votes yet) or when
   * any judgment is `work` or has a non-`no_action` reason
   * (`further_discussion` etc.) — those signal someone still wants to
   * continue, so we keep the round going.
   *
   * Note: failed / skipped turns do not record a judgment, so they are
   * treated as neutral (not blocking consensus). A round where all
   * speakers failed produces zero judgments → returns false → the
   * orchestrator's existing "all-failed → ERROR" path handles that.
   */
  hasUnanimousNoAction(): boolean {
    if (this._judgments.length === 0) return false;
    return this._judgments.every(
      (j) => j.judgment === 'conversation' && j.reason === 'no_action',
    );
  }

  reset(): void {
    this._judgments = [];
  }
}
