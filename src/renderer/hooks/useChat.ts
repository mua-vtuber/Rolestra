/**
 * useChat -- thin composition hook that delegates to 10 sub-hooks.
 *
 * Each sub-hook owns a distinct slice of chat functionality:
 *   useStreamMessages      - stream event subscriptions
 *   useChatInput           - input field, attachments, send logic, provider selection
 *   useConsensus           - consensus voting UI
 *   useExecutionApproval   - diff/permission/failure approval flows
 *   useMessageSearch       - in-chat Ctrl+F search
 *   useMemoryPanel         - memory search & pin
 *   useConversationHistory - conversation list, recovery, load/delete/new
 *   useBranch              - conversation forking & branch switching
 *   useRoundSettings       - round count config & turn-waiting
 *   useDeepDebate          - deep debate dialog & actions
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useChatStore, type ChatMessage } from '../stores/chat-store';
import { useProviderStore } from '../stores/provider-store';
import type { RoundSetting, ConversationSummary } from '../../shared/engine-types';
import type { ConsensusInfo, BlockReasonType } from '../../shared/consensus-types';
import type { DiffEntry } from '../../shared/execution-types';
import type { MemoryTopic, MemorySearchResult, KnowledgeNode, ExtractionResult } from '../../shared/memory-types';
import type { StateRecoveryData } from '../../shared/recovery-types';
import type { PermissionRequest } from '../../shared/file-types';
import type { FailureReportData } from '../components/chat/FailureReportDialog';
import type { StreamDeepDebateEvent, StreamConsensusDocumentEvent, StreamModeTransitionRequestEvent, StreamWorkerSelectionRequestEvent, StreamReviewRequestEvent, StreamLogEvent, StreamCliPermissionRequestEvent } from '../../shared/stream-types';
import type { SessionInfo } from '../../shared/session-state-types';

import { useStreamMessages } from './useStreamMessages';
import { useChatInput } from './useChatInput';
import { useConsensus } from './useConsensus';
import { useExecutionApproval } from './useExecutionApproval';
import { useMessageSearch } from './useMessageSearch';
import { useMemoryPanel } from './useMemoryPanel';
import { useConversationHistory } from './useConversationHistory';
import { useBranch } from './useBranch';
import { useRoundSettings } from './useRoundSettings';
import { useDeepDebate } from './useDeepDebate';

export interface UseChatReturn {
  // Store state
  messages: ChatMessage[];
  sending: boolean;
  paused: boolean;
  currentBranchId: string;
  branches: ReturnType<typeof useChatStore.getState>['branches'];

  // Local state
  input: string;
  setInput: (v: string) => void;
  rounds: RoundSetting;
  consensus: ConsensusInfo | null;
  consensusComment: string;
  setConsensusComment: (v: string) => void;
  searchOpen: boolean;
  searchQuery: string;
  setSearchQuery: (v: string) => void;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  pendingDiffs: { operationId: string; diffs: DiffEntry[] } | null;
  pendingPermission: PermissionRequest | null;
  failureReport: FailureReportData | null;
  historyOpen: boolean;
  historyList: StateRecoveryData[];
  conversationListOpen: boolean;
  conversationList: ConversationSummary[];
  memoryOpen: boolean;
  memoryQuery: string;
  setMemoryQuery: (v: string) => void;
  memoryTopic: MemoryTopic | '';
  setMemoryTopic: (v: MemoryTopic | '') => void;
  memoryResults: MemorySearchResult[];
  pinnedNodes: KnowledgeNode[];
  detailNode: KnowledgeNode | null;
  extractionPreview: ExtractionResult | null;
  extractionResult: { stored: number; skipped: number } | null;
  turnWaiting: boolean;
  attachments: string[];
  deepDebate: StreamDeepDebateEvent | null;
  consensusDocument: StreamConsensusDocumentEvent | null;
  deepDebateDialogOpen: boolean;
  sessionInfo: SessionInfo | null;
  modeTransitionRequest: StreamModeTransitionRequestEvent | null;
  workerSelectionRequest: StreamWorkerSelectionRequestEvent | null;
  reviewRequest: StreamReviewRequestEvent | null;
  logEntries: StreamLogEvent[];
  pendingCliPermissionRequests: StreamCliPermissionRequestEvent[];

  // Provider derived
  hasProviders: boolean;
  providers: ReturnType<typeof useProviderStore.getState>['providers'];
  activeProviders: ReturnType<typeof useProviderStore.getState>['providers'];

  // Filtered messages
  filteredMessages: ChatMessage[];
  searchLower: string;
  hasStreamingBubble: boolean;

  // Refs
  messagesEndRef: React.RefObject<HTMLDivElement | null>;

  // Handlers
  handleCliPermissionRespond: (participantId: string, cliRequestId: string, approved: boolean) => void;
  handleSend: () => void;
  handleToggleProviderSelection: (providerId: string) => void;
  handleAttachFiles: () => Promise<void>;
  handleKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  handleConsensusAction: (action: 'approve' | 'reject' | 'revise' | 'abort', blockReasonType?: BlockReasonType) => void;
  handleSetRounds: (value: RoundSetting) => void;
  handleContainerKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  handleMemorySearch: () => Promise<void>;
  handlePinMessage: (messageId: string, topic: MemoryTopic) => Promise<void>;
  handleLoadPinned: () => void;
  handleViewDetail: (id: string) => void;
  handleDeleteNode: (id: string) => void;
  handleCloseDetail: () => void;
  handleExtractPreview: () => void;
  handleExtractExecute: () => void;
  handleHistoryToggle: () => void;
  handleHistoryRestore: (conversationId: string) => Promise<void>;
  handleHistoryDiscard: (conversationId: string) => Promise<void>;
  handleConversationListToggle: () => void;
  handleLoadConversation: (conversationId: string) => Promise<void>;
  handleDeleteConversation: (conversationId: string) => Promise<void>;
  handleNewConversation: () => void;
  handleDiffApprove: () => Promise<void>;
  handleDiffReject: () => Promise<void>;
  handlePermissionApprove: () => Promise<void>;
  handlePermissionReject: () => Promise<void>;
  handleFailureResolve: (resolution: 'retry' | 'stop' | 'reassign', facilitatorId?: string) => void;
  handleToggleMemory: () => void;
  handleToggleSearch: () => void;
  handleRemoveAttachment: (index: number) => void;
  handleSwitchBranch: (branchId: string) => void;
  handleFork: (messageId: string) => void;
  setConsensus: (c: ConsensusInfo | null) => void;
  setConsensusDocument: (d: StreamConsensusDocumentEvent | null) => void;
  handleDeepDebate: () => void;
  handleDeepDebateStart: (facilitatorId: string) => void;
  handleDeepDebateCancel: () => void;
  handleContinue: () => void;
  handleModeTransitionResponse: (approved: boolean) => void;
  handleSelectWorker: (workerId: string) => void;
  handleUserDecision: (decision: 'accept' | 'rework' | 'reassign' | 'stop', reassignWorkerId?: string) => void;

  // Store actions (pass-through)
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  stop: () => Promise<void>;
}

export function useChat(): UseChatReturn {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // -- Store selectors (minimal: only those not owned by sub-hooks) --
  const messages = useChatStore((s) => s.messages);
  const sending = useChatStore((s) => s.sending);
  const paused = useChatStore((s) => s.paused);
  const pause = useChatStore((s) => s.pause);
  const resume = useChatStore((s) => s.resume);
  const stop = useChatStore((s) => s.stop);
  const fetchProviders = useProviderStore((s) => s.fetchProviders);

  // -- Sub-hooks --
  const roundSettings = useRoundSettings();
  const consensusHook = useConsensus();
  const executionApproval = useExecutionApproval();
  const deepDebateHook = useDeepDebate();
  const memoryPanel = useMemoryPanel();
  const conversationHistory = useConversationHistory();
  const branchHook = useBranch();

  const chatInput = useChatInput({
    pendingDiffs: executionApproval.pendingDiffs,
  });

  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null);
  const [modeTransitionRequest, setModeTransitionRequest] = useState<StreamModeTransitionRequestEvent | null>(null);
  const [workerSelectionRequest, setWorkerSelectionRequest] = useState<StreamWorkerSelectionRequestEvent | null>(null);
  const [reviewRequest, setReviewRequest] = useState<StreamReviewRequestEvent | null>(null);
  const [logEntries, setLogEntries] = useState<StreamLogEvent[]>([]);
  const [pendingCliPermissionRequests, setPendingCliPermissionRequests] = useState<StreamCliPermissionRequestEvent[]>([]);

  const addLogEntry = useCallback((entry: StreamLogEvent) => {
    setLogEntries((prev) => {
      const next = [...prev, entry];
      return next.length > 100 ? next.slice(-100) : next;
    });
  }, []);

  const addCliPermissionRequest = useCallback((event: StreamCliPermissionRequestEvent) => {
    setPendingCliPermissionRequests((prev) => [...prev, event]);
  }, []);

  const handleCliPermissionRespond = useCallback((participantId: string, cliRequestId: string, approved: boolean) => {
    void window.arena.invoke('cli-permission:respond', { participantId, cliRequestId, approved });
    setPendingCliPermissionRequests((prev) =>
      prev.filter(
        (req) => !(req.participantId === participantId && req.request.cliRequestId === cliRequestId),
      ),
    );
  }, []);

  const handleModeTransitionResponse = useCallback((approved: boolean) => {
    void window.arena.invoke('session:mode-transition-respond', { approved });
    setModeTransitionRequest(null);
  }, []);

  const handleSelectWorker = useCallback((workerId: string) => {
    void window.arena.invoke('session:select-worker', { workerId });
    setWorkerSelectionRequest(null);
  }, []);

  const handleUserDecision = useCallback((decision: 'accept' | 'rework' | 'reassign' | 'stop', reassignWorkerId?: string) => {
    void window.arena.invoke('session:user-decision', { decision, reassignWorkerId });
    setReviewRequest(null);
  }, []);

  const messageSearch = useMessageSearch({ messages });

  // -- Stream event subscriptions (wires sub-hook setters) --
  useStreamMessages({
    setTurnWaiting: roundSettings.setTurnWaiting,
    setConsensus: consensusHook.setConsensus,
    pendingDiffs: executionApproval.pendingDiffs,
    setPendingDiffs: executionApproval.setPendingDiffs,
    setPendingPermission: executionApproval.setPendingPermission,
    setFailureReport: executionApproval.setFailureReport,
    setDeepDebate: deepDebateHook.setDeepDebate,
    setConsensusDocument: deepDebateHook.setConsensusDocument,
    setSessionInfo,
    setModeTransitionRequest,
    setWorkerSelectionRequest,
    setReviewRequest,
    addLogEntry,
    addCliPermissionRequest,
  });

  // -- Effects --
  useEffect(() => {
    void fetchProviders();
  }, [fetchProviders]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // -- Compose return --
  return {
    // Store state
    messages,
    sending,
    paused,
    currentBranchId: branchHook.currentBranchId,
    branches: branchHook.branches,

    // Chat input
    input: chatInput.input,
    setInput: chatInput.setInput,
    attachments: chatInput.attachments,
    handleSend: chatInput.handleSend,
    handleAttachFiles: chatInput.handleAttachFiles,
    handleKeyDown: chatInput.handleKeyDown,
    handleRemoveAttachment: chatInput.handleRemoveAttachment,
    handleToggleProviderSelection: chatInput.handleToggleProviderSelection,
    hasProviders: chatInput.hasProviders,
    providers: chatInput.providers,
    activeProviders: chatInput.activeProviders,

    // Round settings
    rounds: roundSettings.rounds,
    handleSetRounds: roundSettings.handleSetRounds,
    turnWaiting: roundSettings.turnWaiting,
    handleContinue: roundSettings.handleContinue,

    // Consensus
    consensus: consensusHook.consensus,
    setConsensus: consensusHook.setConsensus,
    consensusComment: consensusHook.consensusComment,
    setConsensusComment: consensusHook.setConsensusComment,
    handleConsensusAction: consensusHook.handleConsensusAction,

    // Execution approval
    pendingDiffs: executionApproval.pendingDiffs,
    pendingPermission: executionApproval.pendingPermission,
    failureReport: executionApproval.failureReport,
    handleDiffApprove: executionApproval.handleDiffApprove,
    handleDiffReject: executionApproval.handleDiffReject,
    handlePermissionApprove: executionApproval.handlePermissionApprove,
    handlePermissionReject: executionApproval.handlePermissionReject,
    handleFailureResolve: executionApproval.handleFailureResolve,

    // Message search
    searchOpen: messageSearch.searchOpen,
    searchQuery: messageSearch.searchQuery,
    setSearchQuery: messageSearch.setSearchQuery,
    searchInputRef: messageSearch.searchInputRef,
    filteredMessages: messageSearch.filteredMessages,
    searchLower: messageSearch.searchLower,
    hasStreamingBubble: messageSearch.hasStreamingBubble,
    handleToggleSearch: messageSearch.handleToggleSearch,
    handleContainerKeyDown: messageSearch.handleContainerKeyDown,

    // Memory panel
    memoryOpen: memoryPanel.memoryOpen,
    memoryQuery: memoryPanel.memoryQuery,
    setMemoryQuery: memoryPanel.setMemoryQuery,
    memoryTopic: memoryPanel.memoryTopic,
    setMemoryTopic: memoryPanel.setMemoryTopic,
    memoryResults: memoryPanel.memoryResults,
    handleMemorySearch: memoryPanel.handleMemorySearch,
    handlePinMessage: memoryPanel.handlePinMessage,
    handleToggleMemory: memoryPanel.handleToggleMemory,
    pinnedNodes: memoryPanel.pinnedNodes,
    handleLoadPinned: memoryPanel.handleLoadPinned,
    handleViewDetail: memoryPanel.handleViewDetail,
    handleDeleteNode: memoryPanel.handleDeleteNode,
    detailNode: memoryPanel.detailNode,
    handleCloseDetail: memoryPanel.handleCloseDetail,
    extractionPreview: memoryPanel.extractionPreview,
    extractionResult: memoryPanel.extractionResult,
    handleExtractPreview: memoryPanel.handleExtractPreview,
    handleExtractExecute: memoryPanel.handleExtractExecute,

    // Conversation history
    historyOpen: conversationHistory.historyOpen,
    historyList: conversationHistory.historyList,
    conversationListOpen: conversationHistory.conversationListOpen,
    conversationList: conversationHistory.conversationList,
    handleHistoryToggle: conversationHistory.handleHistoryToggle,
    handleHistoryRestore: conversationHistory.handleHistoryRestore,
    handleHistoryDiscard: conversationHistory.handleHistoryDiscard,
    handleConversationListToggle: conversationHistory.handleConversationListToggle,
    handleLoadConversation: conversationHistory.handleLoadConversation,
    handleDeleteConversation: conversationHistory.handleDeleteConversation,
    handleNewConversation: conversationHistory.handleNewConversation,

    // Branch
    handleSwitchBranch: branchHook.handleSwitchBranch,
    handleFork: branchHook.handleFork,

    // Deep debate
    deepDebate: deepDebateHook.deepDebate,
    consensusDocument: deepDebateHook.consensusDocument,
    setConsensusDocument: deepDebateHook.setConsensusDocument,
    deepDebateDialogOpen: deepDebateHook.deepDebateDialogOpen,
    handleDeepDebate: deepDebateHook.handleDeepDebate,
    handleDeepDebateStart: deepDebateHook.handleDeepDebateStart,
    handleDeepDebateCancel: deepDebateHook.handleDeepDebateCancel,

    // Session
    sessionInfo,
    modeTransitionRequest,
    handleModeTransitionResponse,
    workerSelectionRequest,
    handleSelectWorker,
    reviewRequest,
    handleUserDecision,
    logEntries,
    pendingCliPermissionRequests,
    handleCliPermissionRespond,

    // Refs
    messagesEndRef,

    // Store actions
    pause,
    resume,
    stop,
  };
}
