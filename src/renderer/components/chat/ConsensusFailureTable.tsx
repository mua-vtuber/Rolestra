/**
 * Consensus failure table — shows AI alternatives for user selection
 * when consensus fails after maxRetries.
 */

import { useTranslation } from 'react-i18next';
import type { VoteRecord } from '../../../shared/consensus-types';

export interface ConsensusFailureTableProps {
  votes: VoteRecord[];
  proposal: string | null;
  retryCount: number;
  maxRetries: number;
  onSelect: (participantId: string) => void;
  onDismiss: () => void;
}

export function ConsensusFailureTable({
  votes,
  proposal,
  retryCount,
  maxRetries,
  onSelect,
  onDismiss,
}: ConsensusFailureTableProps): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <div className="consensus-panel consensus-panel--danger">
      <div className="panel-header">
        <strong style={{ color: 'var(--text-danger)' }}>{t('consensus.failedTitle')}</strong>
        <span className="text-md" style={{ color: 'var(--text-tertiary)' }}>
          {t('consensus.retry', { count: retryCount, max: maxRetries })}
        </span>
      </div>

      <p className="dialog-description">
        {t('consensus.failedDescription')}
      </p>

      {proposal && (
        <div className="proposal-box proposal-box--sm">
          <div className="text-sm" style={{ fontWeight: 600, color: 'var(--text-tertiary)', marginBottom: 4 }}>
            {t('consensus.lastProposal')}
          </div>
          {proposal}
        </div>
      )}

      <table className="votes-table">
        <thead>
          <tr>
            <th>{t('consensus.participant')}</th>
            <th>{t('consensus.vote')}</th>
            <th>{t('consensus.reason')}</th>
            <th>{t('consensus.select')}</th>
          </tr>
        </thead>
        <tbody>
          {votes.map((v) => (
            <tr key={v.participantId}>
              <td className="td-name">{v.participantName}</td>
              <td>
                <span className={`vote-badge vote-badge--sm ${v.vote === 'agree' ? 'vote-badge--agree' : 'vote-badge--disagree'}`}>
                  {t(`consensus.${v.vote}`)}
                </span>
              </td>
              <td className="td-reason">
                {v.comment ?? '-'}
              </td>
              <td>
                <button
                  className="btn-primary btn-primary--sm"
                  onClick={() => onSelect(v.participantId)}
                >
                  {t('consensus.adopt')}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="action-buttons">
        <button className="btn-control btn-control--sm" onClick={onDismiss}>
          {t('consensus.dismiss')}
        </button>
      </div>
    </div>
  );
}
