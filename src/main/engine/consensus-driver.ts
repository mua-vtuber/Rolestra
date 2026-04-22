/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-non-null-assertion */
// @ts-nocheck — R6-Task10: ConsensusDriver operates on a legacy
// `session.consensus` surface that no longer matches SessionStateMachine.
// Two SsmContext/SsmDriver type drift errors; file retires alongside the
// v2 orchestrator in R11.

/**
 * @deprecated R6-Task7 — legacy ConsensusDriver; the v3 MeetingOrchestrator
 *   absorbs the synthesis/voting flow in R7. R11 deletes this file.
 *
 * ConsensusDriver — drives the consensus lifecycle (synthesis, voting,
 * document generation, and state-change reactions).
 *
 * Extracted from ConversationOrchestrator to isolate all consensus-related
 * orchestration into a focused module.
 */

import type { WebContents } from 'electron';
import type { StreamEventName, StreamEventMap } from '../../shared/stream-types';
import type { ConversationSession } from './conversation';
import type { VoteRecord } from '../../shared/consensus-types';
import type { ConversationTaskSettings } from '../../shared/config-types';
import { DEFAULT_CONVERSATION_TASK_SETTINGS } from '../../shared/config-types';
import { DecisionCollector } from './decision-collector';
import { ConsensusEvaluator } from './consensus-evaluator';
import { providerRegistry } from '../providers/registry';

/**
 * Drives consensus rounds and manages SSM state-change reactions.
 */
export class ConsensusDriver {
  private session: ConversationSession;
  private webContents: WebContents;

  /** Resolve function for the consensus waiter promise (work mode only). */
  private _consensusResolve: (() => void) | null = null;
  /** Unsubscribe from SSM state listener. */
  private _unsubPhaseListener: (() => void) | null = null;

  constructor(session: ConversationSession, webContents: WebContents) {
    this.session = session;
    this.webContents = webContents;
  }

  /** Resolve task settings from session or fall back to defaults. */
  private get taskSettings(): ConversationTaskSettings {
    return this.session.taskSettings ?? DEFAULT_CONVERSATION_TASK_SETTINGS;
  }

  /**
   * Wait for the SSM to reach a terminal state (DONE or FAILED).
   * Listens for state changes and drives execution or re-enters the loop as needed.
   *
   * @param onApplying - Called when SSM enters EXECUTING state.
   * @param onReenterLoop - Called when the discussion loop should restart.
   */
  waitForConsensusTermination(
    onApplying: () => Promise<void>,
    onReenterLoop: () => Promise<void>,
  ): Promise<void> {
    const ssm = this.session.sessionMachine;
    if (!ssm || ssm.isTerminal) return Promise.resolve();

    return new Promise<void>((resolve) => {
      this._consensusResolve = resolve;

      this._unsubPhaseListener = ssm.onStateChange((snapshot) => {
        if (snapshot.state === 'EXECUTING') {
          void onApplying().catch((err) => {
            console.error(`[orchestrator:${this.session.id}] execution error:`, err);
            this.emit('stream:error', {
              conversationId: this.session.id,
              participantId: 'system',
              error: `Execution failed: ${err instanceof Error ? err.message : String(err)}`,
            });
            ssm.transition('ERROR');
            this.emitConsensusUpdate();
          });
        } else if (snapshot.state === 'WORK_DISCUSSING' && snapshot.event === 'DISAGREE') {
          // Retry: re-enter the discussion loop
          void onReenterLoop().catch((err) => {
            console.error(`[orchestrator:${this.session.id}] retry loop error:`, err);
          });
        }

        // Terminal state reached
        if (ssm.isTerminal) {
          if (snapshot.state === 'DONE') {
            void this.generateConsensusDocument().then(() => resolve());
          } else {
            resolve();
          }
        }
      });
    });
  }

  /** Release the consensus waiter if active (used during stop). */
  releaseWaiter(): void {
    this._consensusResolve?.();
    this._consensusResolve = null;
  }

  /** Check whether the orchestrator is waiting for consensus. */
  isWaiting(): boolean {
    return this._consensusResolve !== null;
  }

  /**
   * Run the consensus process: synthesize -> vote -> await user.
   * Only called in work mode after all AI participants finish discussing.
   */
  async runConsensusRound(): Promise<void> {
    const ssm = this.session.sessionMachine;
    if (!ssm) return;

    // WORK_DISCUSSING -> SYNTHESIZING
    ssm.transition('ROUND_COMPLETE');
    ssm.startPhaseTimeout();

    // Select aggregator and have them synthesize
    const aggregatorId = ssm.selectAggregator();
    if (!aggregatorId) {
      ssm.transition('ERROR');
      return;
    }

    const provider = providerRegistry.get(aggregatorId);
    if (!provider) {
      ssm.transition('ERROR');
      return;
    }

    // Build synthesis prompt
    const messages = this.session.getMessagesForProvider(aggregatorId);
    const synthesisPrompt = '이전 논의를 바탕으로, 합의안을 하나의 구체적인 제안으로 정리해 주세요. 모든 참여자의 핵심 의견이 반영되어야 합니다.';
    messages.push({ role: 'user', content: synthesisPrompt });

    try {
      let proposal = '';
      for await (const token of provider.streamCompletion(messages, '', undefined, undefined)) {
        proposal += token;
      }

      ssm.setProposal(proposal);

      // Push session update to renderer
      this.emitConsensusUpdate();

      // Emit the proposal as a system message for UI display
      this.session.createMessage({
        participantId: aggregatorId,
        participantName: '[합의안]',
        role: 'assistant',
        content: proposal,
      });

      // SYNTHESIZING -> VOTING
      ssm.transition('SYNTHESIS_COMPLETE');
      ssm.startPhaseTimeout();

      // Collect votes from all active AI participants
      await this.collectVotes(proposal);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[orchestrator:${this.session.id}] consensus synthesis error: ${errorMsg}`);
      this.emit('stream:error', {
        conversationId: this.session.id,
        participantId: 'system',
        error: `Consensus synthesis failed: ${errorMsg}`,
      });
      ssm.transition('ERROR');
      this.emitConsensusUpdate();
    }
  }

  /**
   * Ask each active AI to vote on the proposal.
   * Delegates to DecisionCollector for collection and ConsensusEvaluator for evaluation.
   */
  async collectVotes(proposal: string): Promise<void> {
    const ssm = this.session.sessionMachine;
    if (!ssm || ssm.state !== 'VOTING') return;

    const activeParticipants = this.session.participants.filter(
      p => p.isActive && p.id !== 'user',
    );

    // Collect votes via DecisionCollector
    const collector = new DecisionCollector({
      parseRetryLimit: Math.max(0, this.taskSettings.aiDecisionParseRetryLimit),
    });
    const result = await collector.collect(activeParticipants, proposal, ssm);

    // Emit errors from collection
    for (const err of result.errors) {
      this.emit('stream:error', {
        conversationId: this.session.id,
        participantId: err.participantId,
        error: err.error,
      });
    }

    // Evaluate votes via ConsensusEvaluator
    const evaluator = new ConsensusEvaluator(this.taskSettings);
    const evaluation = evaluator.evaluate(ssm, activeParticipants.length);

    switch (evaluation.outcome) {
      case 'hard_block':
        ssm.transition('ERROR');
        ssm.startPhaseTimeout();
        this.emitConsensusUpdate();
        break;
      case 'insufficient_votes':
        ssm.transition('DISAGREE');
        ssm.startPhaseTimeout();
        this.emitConsensusUpdate();
        break;
      case 'passed':
        ssm.transition('ALL_AGREE');
        ssm.startPhaseTimeout();
        this.emitConsensusUpdate();
        break;
      case 'failed':
        ssm.transition('DISAGREE');
        ssm.startPhaseTimeout();
        this.emitConsensusUpdate();
        break;
    }
  }

  /**
   * Generate a consensus summary document after SSM reaches DONE.
   * Sends the proposal + votes to the facilitator AI and stores/emits the result.
   */
  async generateConsensusDocument(): Promise<void> {
    const ssm = this.session.sessionMachine;
    if (!ssm || ssm.state !== 'DONE') return;

    const aggregatorId = ssm.aggregatorId;
    if (!aggregatorId) return;

    const provider = providerRegistry.get(aggregatorId);
    if (!provider) return;

    const votes = ssm.votes as VoteRecord[];
    const votesSummary = votes
      .map((v) => `- ${v.participantName}: ${v.vote}${v.comment ? ` (${v.comment})` : ''}`)
      .join('\n');

    const prompt = [
      'Write a concise consensus summary document based on the following:',
      '',
      'Proposal:',
      ssm.proposal ?? '(none)',
      '',
      'Votes:',
      votesSummary || '(no votes)',
      '',
      `Round: ${ssm.workRound}`,
      `Retries: ${ssm.retryCount}`,
      '',
      'Requirements:',
      '- Summarize the decision and key reasoning',
      '- Note any dissenting views and how they were addressed',
      '- Keep it under 500 words',
      '- Write in plain text (no markdown)',
    ].join('\n');

    try {
      let document = '';
      for await (const token of provider.streamCompletion(
        [{ role: 'user', content: prompt }], '', undefined, undefined,
      )) {
        document += token;
      }

      if (document.trim()) {
        // Store in DB
        try {
          const { getDatabase } = await import('../database/connection');
          const db = getDatabase();
          db.prepare(
            `UPDATE consensus_records
             SET summary_text = ?
             WHERE conversation_id = ? AND phase IN ('DONE', 'FREE_TALK')
             ORDER BY created_at DESC LIMIT 1`,
          ).run(document.trim(), this.session.id);
        } catch {
          // DB write failure is non-fatal for document generation
        }

        // Emit event
        const aggregator = this.session.participants.find((p) => p.id === aggregatorId);
        this.emit('stream:consensus-document', {
          conversationId: this.session.id,
          document: document.trim(),
          facilitatorId: aggregatorId,
          facilitatorName: aggregator?.displayName ?? 'Facilitator',
        });

        // Also add as a system message
        this.session.createMessage({
          participantId: aggregatorId,
          participantName: aggregator?.displayName ?? 'Facilitator',
          role: 'assistant',
          content: document.trim(),
        });
      }
    } catch (err) {
      this.emit('stream:error', {
        conversationId: this.session.id,
        participantId: aggregatorId,
        error: `Consensus document generation failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  /** Push the current session state to the renderer. */
  emitConsensusUpdate(): void {
    const ssm = this.session.sessionMachine;
    if (!ssm) return;
    this.emit('stream:session-update', {
      conversationId: this.session.id,
      session: ssm.toInfo(),
    });
    // Derive failure stage from SSM snapshots
    if (ssm.state === 'FAILED') {
      const snapshots = ssm.snapshots;
      const lastSnapshot = snapshots.length > 0 ? snapshots[snapshots.length - 1] : null;
      const previousState = lastSnapshot?.previousState ?? null;
      let failureStage: 'EXECUTE' | 'REVIEW' | null = null;
      if (previousState === 'EXECUTING') failureStage = 'EXECUTE';
      else if (previousState === 'REVIEWING') failureStage = 'REVIEW';

      if (failureStage) {
        this.emit('stream:failure-report', {
          conversationId: this.session.id,
          stage: failureStage,
          reason: failureStage === 'REVIEW' ? 'Review step failed' : 'Execution step failed',
          options: this.taskSettings.failureResolutionOptions,
        });
      }
    }
  }

  /** Remove the SSM state listener if registered. */
  cleanupPhaseListener(): void {
    this._unsubPhaseListener?.();
    this._unsubPhaseListener = null;
  }

  private emit<E extends StreamEventName>(event: E, data: StreamEventMap[E]): void {
    if (!this.webContents.isDestroyed()) {
      this.webContents.send(event, data);
    }
  }
}
