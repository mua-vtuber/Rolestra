/**
 * ModeTransitionDialog -- shown when AI majority votes for work mode.
 *
 * Displays each AI's judgment (conversation vs work) with optional reason,
 * and lets the user approve or reject the mode transition.
 */

import { useTranslation } from 'react-i18next';
import type { ModeJudgment } from '../../../shared/session-state-types';

export interface ModeTransitionDialogProps {
  judgments: ModeJudgment[];
  onRespond: (approved: boolean) => void;
}

export function ModeTransitionDialog({
  judgments,
  onRespond,
}: ModeTransitionDialogProps): React.JSX.Element {
  const { t } = useTranslation();

  const workCount = judgments.filter((j) => j.judgment === 'work').length;
  const totalCount = judgments.length;

  return (
    <div className="consensus-panel consensus-panel--warning">
      <div style={{ marginBottom: 8 }}>
        <strong>{t('session.modeTransition.title')}</strong>
      </div>

      <p className="dialog-description">
        {t('session.modeTransition.description', { work: workCount, total: totalCount })}
      </p>

      <table className="consensus-table">
        <thead>
          <tr>
            <th>{t('consensus.participant')}</th>
            <th>{t('consensus.vote')}</th>
            <th>{t('consensus.reason')}</th>
          </tr>
        </thead>
        <tbody>
          {judgments.map((j) => (
            <tr key={j.participantId}>
              <td>{j.participantName}</td>
              <td>
                <span className={`chip ${j.judgment === 'work' ? 'chip--warning' : 'chip--info'}`}>
                  {t(`session.modeTransition.judgment.${j.judgment}`)}
                </span>
              </td>
              <td>{j.reason ? t(`session.modeTransition.reason.${j.reason}`) : '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="action-buttons" style={{ justifyContent: 'flex-start', marginTop: 8 }}>
        <button
          className="btn-primary btn-primary--sm"
          onClick={() => onRespond(true)}
        >
          {t('session.modeTransition.approve')}
        </button>
        <button
          className="btn-control btn-primary--sm"
          onClick={() => onRespond(false)}
        >
          {t('session.modeTransition.reject')}
        </button>
      </div>
    </div>
  );
}
