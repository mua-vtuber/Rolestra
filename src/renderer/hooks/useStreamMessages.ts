/**
 * useStreamMessages -- handles stream event subscriptions that update
 * chat messages, token usage, and conversation state.
 *
 * Extracts all useStreamEvent() calls from the original useChat hook.
 */

import { useRef } from 'react';
import { useChatStore } from '../stores/chat-store';
import { useProviderStore } from '../stores/provider-store';
import { useStreamEvent } from './useStream';
import { showError } from './useErrorDialog';
import type { ConsensusInfo } from '../../shared/consensus-types';
import type { DiffEntry } from '../../shared/execution-types';
import type { PermissionRequest } from '../../shared/file-types';
import type { FailureReportData } from '../components/chat/FailureReportDialog';
import type { StreamDeepDebateEvent, StreamConsensusDocumentEvent, StreamModeTransitionRequestEvent, StreamWorkerSelectionRequestEvent, StreamReviewRequestEvent, StreamLogEvent, StreamCliPermissionRequestEvent } from '../../shared/stream-types';
import type { SessionInfo } from '../../shared/session-state-types';

export interface UseStreamMessagesParams {
  setTurnWaiting: (v: boolean) => void;
  setConsensus: (c: ConsensusInfo | null) => void;
  pendingDiffs: { operationId: string; diffs: DiffEntry[] } | null;
  setPendingDiffs: (v: { operationId: string; diffs: DiffEntry[] } | null) => void;
  setPendingPermission: (v: PermissionRequest | null) => void;
  setFailureReport: (v: FailureReportData | null) => void;
  setDeepDebate: (v: StreamDeepDebateEvent | null) => void;
  setConsensusDocument: (v: StreamConsensusDocumentEvent | null) => void;
  setSessionInfo: (v: SessionInfo | null) => void;
  setModeTransitionRequest: (v: StreamModeTransitionRequestEvent | null) => void;
  setWorkerSelectionRequest: (v: StreamWorkerSelectionRequestEvent | null) => void;
  setReviewRequest: (v: StreamReviewRequestEvent | null) => void;
  addLogEntry: (entry: StreamLogEvent) => void;
  addCliPermissionRequest: (event: StreamCliPermissionRequestEvent) => void;
}

export function useStreamMessages(params: UseStreamMessagesParams): void {
  const {
    setTurnWaiting,
    setConsensus,
    pendingDiffs,
    setPendingDiffs,
    setPendingPermission,
    setFailureReport,
    setDeepDebate,
    setConsensusDocument,
    setSessionInfo,
    setModeTransitionRequest,
    setWorkerSelectionRequest,
    setReviewRequest,
    addLogEntry,
    addCliPermissionRequest,
  } = params;

  const addMessage = useChatStore((s) => s.addMessage);
  const appendToken = useChatStore((s) => s.appendToken);
  const finalizeMessage = useChatStore((s) => s.finalizeMessage);
  const setConversationState = useChatStore((s) => s.setConversationState);
  const sending = useChatStore((s) => s.sending);
  const paused = useChatStore((s) => s.paused);
  const pause = useChatStore((s) => s.pause);
  const addTokenUsage = useProviderStore((s) => s.addTokenUsage);

  const currentRoundRef = useRef<number>(1);

  useStreamEvent('stream:message-start', (data) => {
    setTurnWaiting(false);
    addMessage({
      id: data.messageId,
      role: data.role,
      content: '',
      speakerName: data.participantName,
      timestamp: data.timestamp,
      streaming: true,
      round: currentRoundRef.current,
    });
  });

  useStreamEvent('stream:token', (data) => {
    appendToken(data.messageId, data.token);
  });

  useStreamEvent('stream:message-done', (data) => {
    finalizeMessage(data.messageId, data.tokenCount, data.responseTimeMs, data.parsedContent);
    addTokenUsage(data.participantId, {
      inputTokens: data.inputTokens,
      outputTokens: data.tokenCount,
      usageSource: data.usageSource,
    });
  });

  useStreamEvent('stream:state', (data) => {
    setConversationState(data.state);
    currentRoundRef.current = data.currentRound;
    if (data.state !== 'running') setTurnWaiting(false);
  });

  useStreamEvent('stream:error', (data) => {
    addMessage({
      id: crypto.randomUUID(),
      role: 'system',
      content: `[${data.participantId}] ${data.error}`,
      timestamp: Date.now(),
    });
    showError(`stream:error:${data.participantId}`, new Error(data.error));
  });

  useStreamEvent('stream:turn-wait', () => {
    setTurnWaiting(true);
  });

  useStreamEvent('stream:consensus-update', (data) => {
    setConsensus(data.consensus);
  });

  useStreamEvent('stream:execution-pending', (data) => {
    if (pendingDiffs) return; // already showing one
    setPendingDiffs({ operationId: data.operationId, diffs: data.diffs });
    if (sending && !paused) {
      void pause().catch((err) => showError('chat:pause', err));
    }
  });

  useStreamEvent('stream:permission-pending', (data) => {
    setPendingPermission(data.request);
    if (sending && !paused) {
      void pause().catch((err) => showError('chat:pause', err));
    }
  });

  useStreamEvent('stream:failure-report', (data) => {
    setFailureReport({ stage: data.stage, reason: data.reason, options: data.options });
  });

  useStreamEvent('stream:deep-debate', (data) => {
    setDeepDebate(data.active ? data : null);
  });

  useStreamEvent('stream:consensus-document', (data) => {
    setConsensusDocument(data);
  });

  useStreamEvent('stream:session-update', (data) => {
    setSessionInfo(data.session);
  });

  useStreamEvent('stream:mode-transition-request', (data) => {
    setModeTransitionRequest(data);
  });

  useStreamEvent('stream:worker-selection-request', (data) => {
    setWorkerSelectionRequest(data);
  });

  useStreamEvent('stream:review-request', (data) => {
    setReviewRequest(data);
  });

  useStreamEvent('stream:log', (data) => {
    addLogEntry(data);
  });

  useStreamEvent('stream:cli-permission-request', (data) => {
    addCliPermissionRequest(data);
  });
}
