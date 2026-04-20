/**
 * Chat view — main conversation interface.
 *
 * Includes round settings, message list, consensus panel, and input area.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useChat } from '../hooks/useChat';
import { MessageBubble } from './chat/MessageBubble';
import { ConsensusPanel } from './chat/ConsensusPanel';
import { DiffPreviewPanel } from './chat/DiffPreviewPanel';
import { ConversationHistoryPanel } from './chat/ConversationHistoryPanel';
import { MemoryPanel } from './chat/MemoryPanel';
import { PermissionRequestPanel } from './chat/PermissionRequestPanel';
import { ConsensusFailureTable } from './chat/ConsensusFailureTable';
import { FailureReportDialog } from './chat/FailureReportDialog';
import { ModeTransitionDialog } from './chat/ModeTransitionDialog';
import { WorkerSelectionDialog } from './chat/WorkerSelectionDialog';
import { ReviewDecisionPanel } from './chat/ReviewDecisionPanel';
import { RuntimeLogPanel } from './chat/RuntimeLogPanel';
import { ConsensusDocumentCard } from './chat/ConsensusDocumentCard';
import { DeepDebateStartDialog } from './chat/DeepDebateStartDialog';
import { SearchOverlay } from './chat/SearchOverlay';
import { SessionStatusBar } from './chat/SessionStatusBar';
import { ThinkingIndicator } from './chat/ThinkingIndicator';
import { InputArea } from './chat/InputArea';
import { CliPermissionRequestCard } from './chat/CliPermissionRequestCard';

// ── Component ──────────────────────────────────────────────────────────

export function ChatView(): React.JSX.Element {
  const { t } = useTranslation();
  const chat = useChat();
  // Stable timestamp for the thinking placeholder — avoids impure Date.now() during render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const thinkingTimestamp = useMemo(() => Date.now(), [chat.sending]);

  return (
    <div className="chat-view" onKeyDown={chat.handleContainerKeyDown}>
      {/* Search bar */}
      {chat.searchOpen && (
        <SearchOverlay
          searchInputRef={chat.searchInputRef}
          searchQuery={chat.searchQuery}
          onSearchQueryChange={chat.setSearchQuery}
          filteredCount={chat.filteredMessages.length}
          totalCount={chat.messages.length}
          onClose={chat.handleToggleSearch}
        />
      )}

      {/* Branch bar */}
      {chat.branches.length > 0 && (
        <div className="chat-bar">
          <span className="chat-bar-label">{t('chat.branch')}</span>
          <button
            onClick={() => chat.handleSwitchBranch('main')}
            className={`chip${chat.currentBranchId === 'main' ? ' active' : ''}`}
          >
            {t('chat.branchMain')}
            {chat.currentBranchId === 'main' && <span className="branch-label">({t('chat.branchCurrent')})</span>}
          </button>
          {chat.branches.map((b, i) => (
            <button
              key={b.id}
              onClick={() => chat.handleSwitchBranch(b.id)}
              className={`chip${chat.currentBranchId === b.id ? ' active' : ''}`}
            >
              {t('chat.branch')} {i + 1}
              {chat.currentBranchId === b.id && <span className="branch-label">({t('chat.branchCurrent')})</span>}
            </button>
          ))}
          <span className="branch-count">
            {t('chat.branchCount', { count: chat.branches.length + 1 })}
          </span>
        </div>
      )}

      {/* Session status bar */}
      {chat.sessionInfo && (
        <SessionStatusBar sessionInfo={chat.sessionInfo} />
      )}

      {/* Message area */}
      <div className="message-area">
        {!chat.hasProviders && (
          <div className="empty-state">{t('chat.emptyState')}</div>
        )}

        {chat.hasProviders && chat.activeProviders.length === 0 && (
          <div className="empty-state">{t('chat.noParticipants')}</div>
        )}

        {chat.filteredMessages.map((msg, idx) => {
          const prevRound = idx > 0 ? chat.filteredMessages[idx - 1].round : undefined;
          const showDivider = msg.round != null && msg.round > 1 && msg.round !== prevRound;
          return (
            <div key={msg.id}>
              {showDivider && (
                <div className="round-divider">
                  {t('chat.round', { round: msg.round })}
                </div>
              )}
              <MessageBubble message={msg} highlight={chat.searchLower} onPin={chat.handlePinMessage} onFork={(messageId) => chat.handleFork(messageId)} />
            </div>
          );
        })}

        {chat.turnWaiting && (
          <div className="thinking-dots thinking-center">
            <span>{t('chat.turnWaiting')}</span>
          </div>
        )}

        {chat.sending && !chat.hasStreamingBubble && !chat.turnWaiting && (
          <ThinkingIndicator timestamp={thinkingTimestamp} highlight={chat.searchLower} />
        )}

        <div ref={chat.messagesEndRef} />
      </div>

      {/* Diff preview panel */}
      {chat.pendingDiffs && (
        <DiffPreviewPanel
          diffs={chat.pendingDiffs.diffs}
          onApprove={() => void chat.handleDiffApprove()}
          onReject={() => void chat.handleDiffReject()}
        />
      )}

      {/* Runtime permission approval panel */}
      {chat.pendingPermission && (
        <PermissionRequestPanel
          request={chat.pendingPermission}
          onApprove={() => void chat.handlePermissionApprove()}
          onReject={() => void chat.handlePermissionReject()}
        />
      )}

      {/* CLI native permission request cards (one per pending request) */}
      {chat.pendingCliPermissionRequests.map((event) => (
        <CliPermissionRequestCard
          key={`${event.participantId}:${event.request.cliRequestId}`}
          event={event}
          onRespond={chat.handleCliPermissionRespond}
        />
      ))}

      {/* Failure report dialog */}
      {chat.failureReport && (
        <FailureReportDialog
          report={chat.failureReport}
          participants={chat.activeProviders}
          onResolve={chat.handleFailureResolve}
        />
      )}

      {/* Mode transition dialog */}
      {chat.modeTransitionRequest && (
        <ModeTransitionDialog
          judgments={chat.modeTransitionRequest.judgments}
          onRespond={chat.handleModeTransitionResponse}
        />
      )}

      {/* Worker selection dialog */}
      {chat.workerSelectionRequest && (
        <WorkerSelectionDialog
          candidates={chat.workerSelectionRequest.candidates}
          proposal={chat.workerSelectionRequest.proposal}
          onSelect={chat.handleSelectWorker}
        />
      )}

      {/* Review decision panel */}
      {chat.reviewRequest && (
        <ReviewDecisionPanel
          session={chat.reviewRequest.session}
          candidates={chat.activeProviders.map((p) => ({ id: p.id, displayName: p.displayName }))}
          onDecision={chat.handleUserDecision}
        />
      )}

      {/* Consensus failure table */}
      {chat.consensus && chat.consensus.phase === 'FAILED' && chat.consensus.votes.length > 0 && (
        <ConsensusFailureTable
          votes={chat.consensus.votes}
          proposal={chat.consensus.proposal}
          retryCount={chat.consensus.retryCount}
          maxRetries={chat.consensus.maxRetries}
          onSelect={(participantId) => {
            void window.arena.invoke('consensus:respond', {
              decision: 'DISAGREE',
              failureResolution: 'reassign',
              reassignFacilitatorId: participantId,
            });
          }}
          onDismiss={() => chat.setConsensus(null)}
        />
      )}

      {/* Memory panel */}
      {chat.memoryOpen && (
        <MemoryPanel
          query={chat.memoryQuery}
          onQueryChange={chat.setMemoryQuery}
          topic={chat.memoryTopic}
          onTopicChange={chat.setMemoryTopic}
          results={chat.memoryResults}
          onSearch={() => void chat.handleMemorySearch()}
          onClose={chat.handleToggleMemory}
          pinnedNodes={chat.pinnedNodes}
          onLoadPinned={chat.handleLoadPinned}
          onViewDetail={chat.handleViewDetail}
          onDeleteNode={chat.handleDeleteNode}
          detailNode={chat.detailNode}
          onCloseDetail={chat.handleCloseDetail}
          extractionPreview={chat.extractionPreview}
          extractionResult={chat.extractionResult}
          onExtractPreview={chat.handleExtractPreview}
          onExtractExecute={chat.handleExtractExecute}
        />
      )}

      {/* Consensus panel */}
      {chat.consensus && chat.consensus.phase === 'AWAITING_USER' && (
        <ConsensusPanel
          consensus={chat.consensus}
          comment={chat.consensusComment}
          onCommentChange={chat.setConsensusComment}
          onAction={chat.handleConsensusAction}
        />
      )}

      {/* Consensus document card */}
      {chat.consensusDocument && (
        <ConsensusDocumentCard
          data={chat.consensusDocument}
          onDismiss={() => chat.setConsensusDocument(null)}
        />
      )}

      {/* Deep debate start dialog */}
      {chat.deepDebateDialogOpen && (
        <DeepDebateStartDialog
          participants={chat.activeProviders}
          onStart={chat.handleDeepDebateStart}
          onCancel={chat.handleDeepDebateCancel}
        />
      )}

      {/* Deep debate indicator */}
      {chat.deepDebate && (
        <div className="chat-bar deep-debate-bar">
          <strong className="deep-debate-label">
            {t('chat.deepDebateActive')}
          </strong>
          <span className="deep-debate-info">
            {t('chat.turnsRemaining', { count: chat.deepDebate.turnsRemaining })}
          </span>
        </div>
      )}

      {/* Controls */}
      {chat.sending && (
        <div className="controls-row">
          <button className="btn-control" onClick={() => void (chat.paused ? chat.resume() : chat.pause())}>
            {chat.paused ? t('chat.resume') : t('chat.pause')}
          </button>
          <button className="btn-control" onClick={() => void chat.stop()}>
            {t('chat.stop')}
          </button>
        </div>
      )}

      {/* Deep debate + continue controls (shown when not sending) */}
      {!chat.sending && chat.hasProviders && chat.activeProviders.length >= 2 && chat.messages.length > 0 && (
        <div className="controls-row">
          {!chat.deepDebate && (
            <button
              className="btn-control btn-control--sm btn-control--warning"
              onClick={chat.handleDeepDebate}
            >
              {t('chat.deepDebate')}
            </button>
          )}
          <button
            className="btn-control btn-control--sm"
            onClick={chat.handleContinue}
          >
            {t('chat.continue')}
          </button>
        </div>
      )}

      {/* History panel */}
      {chat.historyOpen && (
        <ConversationHistoryPanel
          conversations={chat.historyList}
          onRestore={(id) => void chat.handleHistoryRestore(id)}
          onDiscard={(id) => void chat.handleHistoryDiscard(id)}
          onClose={() => chat.handleHistoryToggle()}
          persistedConversations={chat.conversationList}
          onLoad={(id) => void chat.handleLoadConversation(id)}
          onDelete={(id) => void chat.handleDeleteConversation(id)}
          onNew={() => chat.handleNewConversation()}
        />
      )}

      {/* Runtime log panel */}
      <RuntimeLogPanel entries={chat.logEntries} />

      {/* Input area */}
      <InputArea
        input={chat.input}
        onInputChange={chat.setInput}
        onKeyDown={chat.handleKeyDown}
        onSend={chat.handleSend}
        disabled={chat.activeProviders.length === 0}
        pendingDiffs={chat.pendingDiffs != null}
        attachments={chat.attachments}
        onAttachFiles={() => void chat.handleAttachFiles()}
        onRemoveAttachment={chat.handleRemoveAttachment}
        historyOpen={chat.historyOpen}
        onHistoryToggle={chat.handleHistoryToggle}
        memoryOpen={chat.memoryOpen}
        onMemoryToggle={chat.handleToggleMemory}
      />
    </div>
  );
}
