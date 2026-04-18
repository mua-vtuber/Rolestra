/**
 * DecisionCollector — extracts vote collection, parsing, and retry logic
 * from the orchestrator for better separation of concerns.
 *
 * Responsibilities:
 * - Send voting prompt to each AI participant
 * - Parse structured AiDecisionSchemaV1 responses with retry
 * - Record ABSTAIN on parse failure or network error
 * - Classify errors (timeout, network, unknown)
 */

import type { VoteRecord, BlockReasonType, AiDecisionSchemaV1 } from '../../shared/consensus-types';
import type { ConsensusStateMachine } from './consensus-machine';
import { providerRegistry } from '../providers/registry';
import type { Participant } from '../../shared/engine-types';

export interface DecisionCollectorConfig {
  parseRetryLimit: number;
}

export interface DecisionCollectorError {
  participantId: string;
  error: string;
}

export interface DecisionCollectorResult {
  errors: DecisionCollectorError[];
}

export class DecisionCollector {
  private config: DecisionCollectorConfig;

  constructor(config: DecisionCollectorConfig) {
    this.config = config;
  }

  /**
   * Collect votes from all active AI participants on the given proposal.
   * Records votes directly into the CSM.
   */
  async collect(
    participants: Participant[],
    proposal: string,
    csm: ConsensusStateMachine,
  ): Promise<DecisionCollectorResult> {
    const errors: DecisionCollectorError[] = [];

    for (const participant of participants) {
      const provider = providerRegistry.get(participant.id);
      if (!provider) continue;

      const votePrompt = this.buildVotePrompt(proposal);
      const messages = [{ role: 'user' as const, content: votePrompt }];

      try {
        const parsed = await this.parseWithRetry(provider, messages);

        if (!parsed) {
          this.recordAbstain(csm, participant, 'Decision schema parse failed after retries');
          errors.push({
            participantId: participant.id,
            error: 'Decision schema parse failed after retries; recorded as ABSTAIN.',
          });
          continue;
        }

        csm.recordVote({
          participantId: participant.id,
          participantName: participant.displayName,
          source: 'ai',
          vote: parsed.vote,
          blockReasonType: parsed.blockReasonType,
          comment: parsed.comment,
          timestamp: Date.now(),
        });
      } catch (err) {
        const errorType = this.classifyError(err);
        const errorDetail = err instanceof Error ? err.message : String(err);

        this.recordAbstain(csm, participant, `Vote collection failed: ${errorType}`);
        errors.push({
          participantId: participant.id,
          error: `Vote collection failed (${errorType}): ${errorDetail}; recorded as ABSTAIN.`,
        });
      }
    }

    return { errors };
  }

  /**
   * Send the vote prompt to a provider and parse the response,
   * retrying on parse failure up to parseRetryLimit times.
   */
  private async parseWithRetry(
    provider: ReturnType<typeof providerRegistry.get> & object,
    messages: Array<{ role: 'user'; content: string }>,
  ): Promise<{ vote: VoteRecord['vote']; blockReasonType?: BlockReasonType; comment?: string } | null> {
    for (let attempt = 0; attempt <= this.config.parseRetryLimit; attempt++) {
      let response = '';
      for await (const token of provider.streamCompletion(messages, '', undefined, undefined)) {
        response += token;
      }

      try {
        return this.parseVoteDecisionSchema(response);
      } catch (error) {
        if (attempt >= this.config.parseRetryLimit) {
          return null;
        }
        messages.push({
          role: 'user',
          content: `Your previous output could not be parsed (${String(error)}). Return only valid JSON with the exact schema.`,
        });
      }
    }
    return null;
  }

  /** Record an ABSTAIN vote for a participant who failed to provide a valid decision. */
  recordAbstain(csm: ConsensusStateMachine, participant: Participant, comment: string): void {
    csm.recordVote({
      participantId: participant.id,
      participantName: participant.displayName,
      source: 'ai',
      vote: 'abstain',
      comment,
      timestamp: Date.now(),
    });
  }

  /** Classify an error as timeout, network_error, or unknown_error. */
  classifyError(err: unknown): string {
    if (err instanceof Error) {
      if (/timeout|timed?\s*out|ETIMEDOUT|ECONNABORTED/i.test(err.message)) return 'timeout';
      if (/ECONNREFUSED|ENOTFOUND|ECONNRESET|network|fetch failed/i.test(err.message)) return 'network_error';
    }
    return 'unknown_error';
  }

  /** Build the structured vote prompt for a proposal. */
  private buildVotePrompt(proposal: string): string {
    return [
      'Evaluate the proposal and return STRICT JSON only.',
      'Schema:',
      '{',
      '  "decision_schema_version": "v1",',
      '  "decision": "AGREE | DISAGREE | BLOCK",',
      '  "block_reason_type": "security | data_loss | spec_conflict | unknown",',
      '  "reason": "string"',
      '}',
      'Rules:',
      '- block_reason_type is required only when decision=BLOCK.',
      '- reason is always required.',
      '',
      'Proposal:',
      proposal,
    ].join('\n');
  }

  /** Parse a raw AI response into a structured vote decision. */
  parseVoteDecisionSchema(
    response: string,
  ): { vote: VoteRecord['vote']; blockReasonType?: BlockReasonType; comment?: string } {
    const jsonText = this.extractFirstJsonObject(response);
    const parsed = JSON.parse(jsonText) as Partial<AiDecisionSchemaV1>;

    if (parsed.decision_schema_version !== 'v1') {
      throw new Error('invalid decision_schema_version');
    }
    if (!parsed.reason || typeof parsed.reason !== 'string') {
      throw new Error('reason is required');
    }
    if (!parsed.decision || typeof parsed.decision !== 'string') {
      throw new Error('decision is required');
    }

    if (parsed.decision === 'AGREE') {
      return { vote: 'agree', comment: parsed.reason };
    }
    if (parsed.decision === 'DISAGREE') {
      return { vote: 'disagree', comment: parsed.reason };
    }
    if (parsed.decision === 'BLOCK') {
      if (
        parsed.block_reason_type !== 'security'
        && parsed.block_reason_type !== 'data_loss'
        && parsed.block_reason_type !== 'spec_conflict'
        && parsed.block_reason_type !== 'unknown'
      ) {
        throw new Error('invalid block_reason_type');
      }
      return {
        vote: 'block',
        blockReasonType: parsed.block_reason_type,
        comment: parsed.reason,
      };
    }

    throw new Error('unsupported decision');
  }

  /** Extract the first JSON object from a text response. */
  private extractFirstJsonObject(text: string): string {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) {
      throw new Error('no JSON object found');
    }
    return text.slice(start, end + 1);
  }
}
