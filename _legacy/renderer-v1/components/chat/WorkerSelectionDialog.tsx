/**
 * WorkerSelectionDialog -- shown when consensus is approved (CONSENSUS_APPROVED).
 *
 * Displays the agreed proposal and lets the user select which AI
 * will execute the work.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';

export interface WorkerSelectionDialogProps {
  candidates: Array<{ id: string; displayName: string }>;
  proposal: string;
  onSelect: (workerId: string) => void;
}

export function WorkerSelectionDialog({
  candidates,
  proposal,
  onSelect,
}: WorkerSelectionDialogProps): React.JSX.Element {
  const { t } = useTranslation();
  const [selectedId, setSelectedId] = useState(candidates[0]?.id ?? '');

  return (
    <div className="consensus-panel consensus-panel--success">
      <div style={{ marginBottom: 8 }}>
        <strong>{t('session.workerSelection.title')}</strong>
      </div>

      <p className="dialog-description">
        {t('session.workerSelection.description')}
      </p>

      {proposal && (
        <div className="proposal-block" style={{ marginBottom: 8 }}>
          <div className="form-label-sm">{t('session.workerSelection.proposal')}</div>
          <p className="dialog-description">{proposal}</p>
        </div>
      )}

      <div className="form-row">
        <label className="form-label-sm">
          {t('session.workerSelection.selectWorker')}
        </label>
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          className="form-select-sm"
        >
          {candidates.map((c) => (
            <option key={c.id} value={c.id}>{c.displayName}</option>
          ))}
        </select>
      </div>

      <div className="action-buttons" style={{ justifyContent: 'flex-start', marginTop: 8 }}>
        <button
          className="btn-primary btn-primary--sm"
          onClick={() => onSelect(selectedId)}
          disabled={!selectedId}
        >
          {t('session.workerSelection.confirm')}
        </button>
      </div>
    </div>
  );
}
