/**
 * ExecutionCoordinator — drives the execution pipeline when the CSM
 * enters the APPLYING phase.
 *
 * Extracted from ConversationOrchestrator to isolate execution-specific
 * logic (patch extraction, user approval waiting, apply/review flow)
 * into a focused module.
 *
 * @deprecated R6-Task7 — v3 MeetingOrchestrator handles execution via
 *   ApprovalService (R7). This file stays to keep v2 ConversationOrchestrator
 *   compiling until R11 deletes the v2 engine files en bloc. Do NOT add
 *   new callers.
 */

import type { WebContents } from 'electron';
import type { StreamEventName, StreamEventMap } from '../../shared/stream-types';
import type { ConversationSession } from './conversation';
import type { ConsensusDriver } from './consensus-driver';

/** Optional dependency injection for execution pipeline. */
export interface OrchestratorDeps {
  submitPatchForReview?: (
    patchSet: import('../../shared/execution-types').PatchSet,
    conversationId?: string,
  ) => { operationId: string; diffs: import('../../shared/execution-types').DiffEntry[] };
  /** Extract a PatchSet from the consensus proposal via LLM call. */
  extractPatchSet?: (
    aiOutput: string,
    aiId: string,
    conversationId: string,
  ) => Promise<import('../../shared/execution-types').PatchSet | null>;
}

/**
 * Manages the execution pipeline (patch extraction, approval, apply).
 */
export class ExecutionCoordinator {
  private session: ConversationSession;
  private webContents: WebContents;
  private deps: OrchestratorDeps;
  private consensusDriver: ConsensusDriver;

  /** Resolve function for execution approval waiter. */
  private _executionApprovalResolve: ((approved: boolean) => void) | null = null;

  constructor(
    session: ConversationSession,
    webContents: WebContents,
    deps: OrchestratorDeps,
    consensusDriver: ConsensusDriver,
  ) {
    this.session = session;
    this.webContents = webContents;
    this.deps = deps;
    this.consensusDriver = consensusDriver;
  }

  /**
   * Drive the execution pipeline when CSM enters APPLYING phase.
   *
   * If deps.extractPatchSet and deps.submitPatchForReview are provided,
   * runs the full pipeline: extract PatchSet -> preview diffs -> wait for
   * user approval (execution-handler applies the patch and resolves approval).
   * Otherwise falls through to auto-succeed.
   */
  async driveExecution(): Promise<void> {
    const csm = this.session.consensus;
    if (!csm || csm.phase !== 'APPLYING') return;

    // Attempt real execution if deps are wired
    if (this.deps.extractPatchSet && this.deps.submitPatchForReview) {
      const proposal = csm.proposal ?? '';
      const aggregatorId = csm.aggregatorId ?? 'system';
      const patchSet = await this.deps.extractPatchSet(proposal, aggregatorId, this.session.id);

      if (patchSet && patchSet.entries.length > 0) {
        // Submit for user review (pushes stream:execution-pending to renderer)
        this.deps.submitPatchForReview(patchSet, this.session.id);

        // Wait for user approval via resolveExecutionApproval().
        // execution-handler applies the patch on approve and resolves with success/failure.
        const approved = await new Promise<boolean>((resolve) => {
          this._executionApprovalResolve = resolve;
        });
        this._executionApprovalResolve = null;

        if (!approved) {
          csm.transition('APPLY_FAILED');
          this.consensusDriver.emitConsensusUpdate();
          this.emit('stream:failure-report', {
            conversationId: this.session.id,
            stage: 'EXECUTE',
            reason: 'File changes rejected or failed to apply',
            options: ['retry', 'stop', 'reassign'],
          });
          return;
        }

        // Patch applied successfully by execution-handler -> REVIEWING -> DONE
        const nextPhase = csm.transition('APPLY_SUCCESS');
        this.consensusDriver.emitConsensusUpdate();
        if (nextPhase === 'REVIEWING') {
          csm.transition('REVIEW_SUCCESS');
          this.consensusDriver.emitConsensusUpdate();
        }
        return;
      }
    }

    // Fallback: auto-succeed when no execution deps or no patch extracted
    const nextPhase = csm.transition('APPLY_SUCCESS');
    this.consensusDriver.emitConsensusUpdate();
    if (nextPhase === 'REVIEWING') {
      csm.transition('REVIEW_SUCCESS');
      this.consensusDriver.emitConsensusUpdate();
    }
  }

  /**
   * Called by the execution handler when user approves/rejects a pending execution.
   * Resolves the promise in driveExecution().
   */
  resolveExecutionApproval(approved: boolean): void {
    this._executionApprovalResolve?.(approved);
  }

  private emit<E extends StreamEventName>(event: E, data: StreamEventMap[E]): void {
    if (!this.webContents.isDestroyed()) {
      this.webContents.send(event, data);
    }
  }
}
