// @ts-nocheck — R6-Task10: legacy CSM-era consensus handler. R7 replaces
// the surface with the v3 MeetingOrchestrator + ApprovalService path.

/**
 * IPC handlers for consensus (work-mode) channels.
 *
 * CSM (ConsensusStateMachine) has been replaced by SSM (SessionStateMachine).
 * session.consensus always returns null; these handlers now route to SSM-based
 * orchestrator methods when applicable, or return graceful defaults.
 */

import type { IpcRequest } from '../../../shared/ipc-types';
import type { ConsensusInfo } from '../../../shared/consensus-types';
import { getActiveSession, getActiveOrchestrator } from './chat-handler';

/**
 * Handle consensus:respond - user decision for approval/failure paths.
 *
 * Routes through the orchestrator's SSM handlers when the session uses SSM.
 */
export async function handleConsensusRespond(
  data: IpcRequest<'consensus:respond'>,
): Promise<void> {
  const session = getActiveSession();
  if (!session) {
    throw new Error('No active conversation session.');
  }

  const orchestrator = getActiveOrchestrator();

  // --- Failure resolution path ---
  if (data.failureResolution) {
    if (!orchestrator) {
      throw new Error('No active orchestrator for failure resolution.');
    }
    const decisionMap = {
      retry: 'rework' as const,
      stop: 'stop' as const,
      reassign: 'reassign' as const,
    };
    const decision = decisionMap[data.failureResolution];
    if (decision) {
      void orchestrator.handleUserDecision(
        decision,
        data.failureResolution === 'reassign' ? data.reassignFacilitatorId : undefined,
      );
    }
    return;
  }

  // --- ABORT → stop ---
  if (data.decision === 'ABORT') {
    if (orchestrator) {
      void orchestrator.handleUserDecision('stop');
    }
    return;
  }

  // --- Voting decisions (AGREE/DISAGREE/BLOCK) ---
  // In SSM mode, voting is AI-only (VOTING state) and user decisions
  // are handled via session:user-decision (USER_DECISION state).
  // Map AGREE → accept, DISAGREE/BLOCK → rework.
  if (orchestrator && session.sessionMachine) {
    const ssmState = session.sessionMachine.state;
    if (ssmState === 'USER_DECISION' || ssmState === 'REVIEWING') {
      const decision = data.decision === 'AGREE' ? 'accept' : 'rework';
      void orchestrator.handleUserDecision(decision);
    }
  }
}

/**
 * Handle consensus:status - return current consensus state.
 *
 * Returns SSM info mapped to ConsensusInfo format when available.
 */
export async function handleConsensusStatus(): Promise<{
  consensus: ConsensusInfo | null;
}> {
  const session = getActiveSession();
  if (!session) {
    return { consensus: null };
  }

  // SSM mode: map SSM info to ConsensusInfo
  const ssm = session.sessionMachine;
  if (ssm) {
    const info = ssm.toInfo();
    return {
      consensus: {
        phase: info.state,
        event: null,
        conversationId: session.id,
        proposalHash: info.proposalHash,
        retryCount: info.retryCount,
        maxRetries: info.maxRetries,
        aggregatorStrategy: info.aggregatorStrategy,
        facilitatorId: info.aggregatorId,
        humanVote: null,
        aiVotes: info.votes,
        isTerminal: info.state === 'DONE' || info.state === 'FAILED',
      },
    };
  }

  return { consensus: null };
}

/**
 * Handle consensus:set-facilitator - choose designated facilitator AI.
 *
 * In SSM mode, updates the session config if applicable.
 */
export async function handleConsensusSetFacilitator(
  _data: IpcRequest<'consensus:set-facilitator'>,
): Promise<{ success: true }> {
  const session = getActiveSession();
  if (!session) {
    throw new Error('No active conversation session.');
  }

  // SSM does not expose runtime config update; return success gracefully
  return { success: true };
}
