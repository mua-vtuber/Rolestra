/**
 * SessionStatusBar -- displays the current SSM state as a visual indicator.
 *
 * Renders only when sessionInfo is non-null (arena mode active).
 * Each of the 12 session states maps to a distinct i18n label and color class.
 */

import { useTranslation } from 'react-i18next';
import type { SessionInfo, SessionState } from '../../../shared/session-state-types';

export interface SessionStatusBarProps {
  sessionInfo: SessionInfo;
}

/** CSS modifier class per session state. */
const STATE_VARIANT: Record<SessionState, string> = {
  CONVERSATION: 'info',
  MODE_TRANSITION_PENDING: 'warning',
  WORK_DISCUSSING: 'info',
  SYNTHESIZING: 'info',
  VOTING: 'warning',
  CONSENSUS_APPROVED: 'success',
  EXECUTING: 'warning',
  REVIEWING: 'info',
  USER_DECISION: 'warning',
  DONE: 'success',
  FAILED: 'error',
  PAUSED: 'muted',
};

export function SessionStatusBar({ sessionInfo }: SessionStatusBarProps): React.JSX.Element {
  const { t } = useTranslation();

  const variant = STATE_VARIANT[sessionInfo.state];

  return (
    <div className={`chat-bar session-status-bar session-status-bar--${variant}`}>
      <span className="session-status-label">
        {t(`session.state.${sessionInfo.state}`)}
      </span>
      {sessionInfo.workRound > 0 && (
        <span className="session-status-detail">
          {t('chat.round', { round: sessionInfo.workRound })}
        </span>
      )}
    </div>
  );
}
