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

  reset(): void {
    this._judgments = [];
  }
}
