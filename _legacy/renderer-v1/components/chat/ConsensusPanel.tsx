/**
 * Consensus result panel — displays proposal, votes, and action buttons.
 * Includes block reason type selector when user chooses to reject.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ConsensusInfo, BlockReasonType } from '../../../shared/consensus-types';

export interface ConsensusPanelProps {
  consensus: ConsensusInfo;
  comment: string;
  onCommentChange: (value: string) => void;
  onAction: (action: 'approve' | 'reject' | 'revise' | 'abort', blockReasonType?: BlockReasonType) => void;
}

export function ConsensusPanel({ consensus, comment, onCommentChange, onAction }: ConsensusPanelProps): React.JSX.Element {
  const { t } = useTranslation();
  const [showBlockSelector, setShowBlockSelector] = useState(false);
  const [selectedBlockReason, setSelectedBlockReason] = useState<BlockReasonType>('unknown');

  const blockReasons: BlockReasonType[] = ['security', 'data_loss', 'spec_conflict', 'unknown'];

  const handleReject = (): void => {
    if (!showBlockSelector) {
      setShowBlockSelector(true);
      return;
    }
  };

  const handleRejectAndDiscuss = (): void => {
    onAction('reject', selectedBlockReason);
    setShowBlockSelector(false);
  };

  const handleRejectAndStop = (): void => {
    onAction('abort', selectedBlockReason);
    setShowBlockSelector(false);
  };

  const handleCancelBlock = (): void => {
    setShowBlockSelector(false);
    setSelectedBlockReason('unknown');
  };

  return (
    <div className="consensus-panel">
      <div className="panel-header">
        <strong>{t('consensus.title')}</strong>
        <span className="text-md" style={{ color: 'var(--text-tertiary)' }}>
          {consensus.retryCount > 0 ? t('consensus.retry', { count: consensus.retryCount, max: consensus.maxRetries }) : ''}
        </span>
      </div>

      {consensus.proposal && (
        <div className="proposal-box">
          {consensus.proposal}
        </div>
      )}

      {consensus.votes.length > 0 && (
        <div className="votes-section">
          <span className="text-md" style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>{t('consensus.votes')}</span>
          <div className="votes-container">
            {consensus.votes.map((v) => (
              <span
                key={v.participantId}
                className={`vote-badge ${v.vote === 'agree' ? 'vote-badge--agree' : 'vote-badge--disagree'}`}
              >
                {v.participantName}: {t(`consensus.${v.vote}`)}
              </span>
            ))}
          </div>
        </div>
      )}

      <textarea
        value={comment}
        onChange={(e) => onCommentChange(e.target.value)}
        placeholder={t('consensus.comment')}
        rows={2}
        className="chat-textarea"
        style={{ marginBottom: 8 }}
      />

      {/* Block reason type selector */}
      {showBlockSelector && (
        <div className="block-reason-selector">
          <span className="block-reason-label">
            {t('consensus.blockReason')}
          </span>
          <div className="reason-options">
            {blockReasons.map((reason) => (
              <label
                key={reason}
                className={`reason-radio-label${selectedBlockReason === reason ? ' reason-radio-label--selected' : ''}`}
              >
                <input
                  type="radio"
                  name="blockReason"
                  value={reason}
                  checked={selectedBlockReason === reason}
                  onChange={() => setSelectedBlockReason(reason)}
                  style={{ margin: 0 }}
                />
                {t(`consensus.blockReason${reason.charAt(0).toUpperCase() + reason.slice(1).replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())}`)}
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="action-buttons action-buttons--wrap">
        {showBlockSelector && (
          <button onClick={handleCancelBlock} className="btn-control btn-control--sm">
            {t('app.cancel')}
          </button>
        )}
        {showBlockSelector ? (
          <>
            <button onClick={handleRejectAndDiscuss} className="btn-danger btn-danger--sm">
              {t('consensus.rejectAndDiscuss')}
            </button>
            <button onClick={handleRejectAndStop} className="btn-danger btn-danger--sm btn-danger--active">
              {t('consensus.rejectAndStop')}
            </button>
          </>
        ) : (
          <button onClick={handleReject} className="btn-danger">
            {t('consensus.reject')}
          </button>
        )}
        <button onClick={() => onAction('revise')} className="btn-control btn-control--warning">
          {t('consensus.revise')}
        </button>
        <button onClick={() => onAction('approve')} className="btn-primary btn-primary--md">
          {t('consensus.approve')}
        </button>
      </div>
    </div>
  );
}
