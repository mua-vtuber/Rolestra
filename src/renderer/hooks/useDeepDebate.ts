/**
 * useDeepDebate -- manages deep debate dialog state and actions.
 */

import { useState, useCallback } from 'react';
import type { StreamDeepDebateEvent, StreamConsensusDocumentEvent } from '../../shared/stream-types';
import { showError } from './useErrorDialog';

export interface UseDeepDebateReturn {
  deepDebate: StreamDeepDebateEvent | null;
  setDeepDebate: (v: StreamDeepDebateEvent | null) => void;
  consensusDocument: StreamConsensusDocumentEvent | null;
  setConsensusDocument: (v: StreamConsensusDocumentEvent | null) => void;
  deepDebateDialogOpen: boolean;
  handleDeepDebate: () => void;
  handleDeepDebateStart: (facilitatorId: string) => void;
  handleDeepDebateCancel: () => void;
}

export function useDeepDebate(): UseDeepDebateReturn {
  const [deepDebate, setDeepDebate] = useState<StreamDeepDebateEvent | null>(null);
  const [consensusDocument, setConsensusDocument] = useState<StreamConsensusDocumentEvent | null>(null);
  const [deepDebateDialogOpen, setDeepDebateDialogOpen] = useState(false);

  const handleDeepDebate = useCallback((): void => {
    setDeepDebateDialogOpen(true);
  }, []);

  const handleDeepDebateStart = useCallback((facilitatorId: string): void => {
    setDeepDebateDialogOpen(false);
    void window.arena.invoke('chat:deep-debate', { facilitatorId })
      .catch((err) => showError('chat:deep-debate', err));
  }, []);

  const handleDeepDebateCancel = useCallback((): void => {
    setDeepDebateDialogOpen(false);
  }, []);

  return {
    deepDebate,
    setDeepDebate,
    consensusDocument,
    setConsensusDocument,
    deepDebateDialogOpen,
    handleDeepDebate,
    handleDeepDebateStart,
    handleDeepDebateCancel,
  };
}
