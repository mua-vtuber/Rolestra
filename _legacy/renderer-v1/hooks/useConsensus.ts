/**
 * useConsensus -- manages consensus UI state and user voting actions.
 */

import { useState, useCallback } from 'react';
import type { ConsensusInfo, BlockReasonType } from '../../shared/consensus-types';

export interface UseConsensusReturn {
  consensus: ConsensusInfo | null;
  setConsensus: (c: ConsensusInfo | null) => void;
  consensusComment: string;
  setConsensusComment: (v: string) => void;
  handleConsensusAction: (action: 'approve' | 'reject' | 'revise' | 'abort', blockReasonType?: BlockReasonType) => void;
}

export function useConsensus(): UseConsensusReturn {
  const [consensus, setConsensus] = useState<ConsensusInfo | null>(null);
  const [consensusComment, setConsensusComment] = useState('');

  const handleConsensusAction = useCallback((action: 'approve' | 'reject' | 'revise' | 'abort', blockReasonType?: BlockReasonType): void => {
    if (action === 'abort') {
      void window.arena.invoke('consensus:respond', {
        decision: 'ABORT',
        comment: consensusComment.trim() || undefined,
        blockReasonType: blockReasonType ?? 'unknown',
      });
      setConsensusComment('');
      return;
    }
    const decision = action === 'approve' ? 'AGREE' : action === 'reject' ? 'BLOCK' : 'DISAGREE';
    void window.arena.invoke('consensus:respond', {
      decision,
      comment: consensusComment.trim() || undefined,
      ...(decision === 'BLOCK' ? { blockReasonType: blockReasonType ?? 'unknown' } : {}),
    });
    setConsensusComment('');
  }, [consensusComment]);

  return {
    consensus,
    setConsensus,
    consensusComment,
    setConsensusComment,
    handleConsensusAction,
  };
}
