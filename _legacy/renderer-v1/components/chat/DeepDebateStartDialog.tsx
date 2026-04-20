/**
 * Deep debate start dialog — lets the user pick a facilitator before
 * starting deep debate mode.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProviderInfo } from '../../../shared/provider-types';

export interface DeepDebateStartDialogProps {
  participants: ProviderInfo[];
  onStart: (facilitatorId: string) => void;
  onCancel: () => void;
}

export function DeepDebateStartDialog({
  participants,
  onStart,
  onCancel,
}: DeepDebateStartDialogProps): React.JSX.Element {
  const { t } = useTranslation();
  const [selectedId, setSelectedId] = useState(participants[0]?.id ?? '');

  return (
    <div className="consensus-panel consensus-panel--warning">
      <div style={{ marginBottom: 8 }}>
        <strong className="deep-debate-label">
          {t('chat.deepDebateStart')}
        </strong>
      </div>

      <p className="dialog-description">
        {t('chat.deepDebateDescription')}
      </p>

      <div className="form-row">
        <label className="form-label-sm">
          {t('chat.selectFacilitator')}
        </label>
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          className="form-select-sm"
        >
          {participants.map((p) => (
            <option key={p.id} value={p.id}>{p.displayName}</option>
          ))}
        </select>
      </div>

      <div className="action-buttons" style={{ justifyContent: 'flex-start' }}>
        <button
          className="btn-primary btn-primary--sm"
          onClick={() => onStart(selectedId)}
          disabled={!selectedId}
        >
          {t('chat.deepDebateStart')}
        </button>
        <button
          className="btn-control btn-primary--sm"
          onClick={onCancel}
        >
          {t('app.cancel')}
        </button>
      </div>
    </div>
  );
}
