/**
 * ReviewDecisionPanel -- shown after review phase completes (USER_DECISION state).
 *
 * Displays the review result and lets the user choose:
 * accept / rework / reassign to another AI / stop.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SessionInfo } from '../../../shared/session-state-types';

export interface ReviewDecisionPanelProps {
  session: SessionInfo;
  candidates: Array<{ id: string; displayName: string }>;
  onDecision: (decision: 'accept' | 'rework' | 'reassign' | 'stop', reassignWorkerId?: string) => void;
}

export function ReviewDecisionPanel({
  session,
  candidates,
  onDecision,
}: ReviewDecisionPanelProps): React.JSX.Element {
  const { t } = useTranslation();
  const [reassignId, setReassignId] = useState(candidates[0]?.id ?? '');
  const [showReassign, setShowReassign] = useState(false);

  return (
    <div className="consensus-panel consensus-panel--info">
      <div style={{ marginBottom: 8 }}>
        <strong>{t('session.review.title')}</strong>
      </div>

      <p className="dialog-description">
        {t('session.review.description')}
      </p>

      {session.proposal && (
        <div className="proposal-block" style={{ marginBottom: 8 }}>
          <div className="form-label-sm">{t('session.review.proposal')}</div>
          <p className="dialog-description">{session.proposal}</p>
        </div>
      )}

      {showReassign && (
        <div className="form-row" style={{ marginBottom: 8 }}>
          <label className="form-label-sm">
            {t('session.review.selectWorker')}
          </label>
          <select
            value={reassignId}
            onChange={(e) => setReassignId(e.target.value)}
            className="form-select-sm"
          >
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>{c.displayName}</option>
            ))}
          </select>
        </div>
      )}

      <div className="action-buttons action-buttons--wrap" style={{ justifyContent: 'flex-start', marginTop: 8 }}>
        <button
          className="btn-primary btn-primary--sm"
          onClick={() => onDecision('accept')}
        >
          {t('session.review.accept')}
        </button>
        <button
          className="btn-control btn-primary--sm"
          onClick={() => onDecision('rework')}
        >
          {t('session.review.rework')}
        </button>
        {showReassign ? (
          <button
            className="btn-control btn-primary--sm"
            onClick={() => onDecision('reassign', reassignId)}
            disabled={!reassignId}
          >
            {t('session.review.confirmReassign')}
          </button>
        ) : (
          <button
            className="btn-control btn-primary--sm"
            onClick={() => setShowReassign(true)}
          >
            {t('session.review.reassign')}
          </button>
        )}
        <button
          className="btn-danger btn-primary--sm"
          onClick={() => onDecision('stop')}
        >
          {t('session.review.stop')}
        </button>
      </div>
    </div>
  );
}
