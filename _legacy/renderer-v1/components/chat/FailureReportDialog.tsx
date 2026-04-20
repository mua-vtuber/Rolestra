/**
 * Failure report dialog — shown when execute/review step fails.
 *
 * Replaces the previous window.prompt() approach with a proper React dialog.
 * Displays the failure stage, reason, and available resolution options.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProviderInfo } from '../../../shared/provider-types';

export interface FailureReportData {
  stage: 'EXECUTE' | 'REVIEW';
  reason: string;
  options: Array<'retry' | 'stop' | 'reassign'>;
}

export interface FailureReportDialogProps {
  report: FailureReportData;
  participants: ProviderInfo[];
  onResolve: (resolution: 'retry' | 'stop' | 'reassign', facilitatorId?: string) => void;
}

export function FailureReportDialog({
  report,
  participants,
  onResolve,
}: FailureReportDialogProps): React.JSX.Element {
  const { t } = useTranslation();
  const [selectedFacilitator, setSelectedFacilitator] = useState(participants[0]?.id ?? '');

  return (
    <div className="consensus-panel consensus-panel--danger">
      <div style={{ marginBottom: 8 }}>
        <strong style={{ color: 'var(--text-danger)' }}>
          {t('failure.title', { stage: report.stage })}
        </strong>
      </div>

      <p className="dialog-description">
        {report.reason}
      </p>

      <div className="action-buttons action-buttons--wrap" style={{ alignItems: 'center' }}>
        {report.options.includes('retry') && (
          <button
            className="btn-primary btn-primary--sm"
            onClick={() => onResolve('retry')}
          >
            {t('failure.retry')}
          </button>
        )}

        {report.options.includes('reassign') && (
          <>
            <select
              value={selectedFacilitator}
              onChange={(e) => setSelectedFacilitator(e.target.value)}
              className="form-select-sm"
            >
              {participants.map((p) => (
                <option key={p.id} value={p.id}>{p.displayName}</option>
              ))}
            </select>
            <button
              className="btn-control btn-primary--sm"
              onClick={() => onResolve('reassign', selectedFacilitator)}
              disabled={!selectedFacilitator}
            >
              {t('failure.reassign')}
            </button>
          </>
        )}

        {report.options.includes('stop') && (
          <button
            className="btn-danger btn-primary--sm"
            onClick={() => onResolve('stop')}
          >
            {t('failure.stop')}
          </button>
        )}
      </div>
    </div>
  );
}
