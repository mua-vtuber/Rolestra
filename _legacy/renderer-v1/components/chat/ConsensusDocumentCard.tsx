/**
 * Consensus document card — displays the facilitator-generated summary
 * after a successful consensus (DONE phase).
 */

import { useTranslation } from 'react-i18next';
import type { StreamConsensusDocumentEvent } from '../../../shared/stream-types';

export interface ConsensusDocumentCardProps {
  data: StreamConsensusDocumentEvent;
  onDismiss: () => void;
}

export function ConsensusDocumentCard({ data, onDismiss }: ConsensusDocumentCardProps): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <div className="document-card">
      <div className="document-header">
        <strong className="text-base">{t('consensus.documentTitle')}</strong>
        <span className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
          {data.facilitatorName}
        </span>
      </div>
      <div className="document-content">
        {data.document}
      </div>
      <div className="document-footer">
        <button onClick={onDismiss} className="btn-control btn-control--sm">
          {t('app.close')}
        </button>
      </div>
    </div>
  );
}
