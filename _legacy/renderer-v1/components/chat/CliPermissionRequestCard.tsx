/**
 * CliPermissionRequestCard -- inline chat card for CLI native permission requests.
 *
 * Displayed in the chat stream when a CLI tool (e.g. Claude Code) emits a
 * permission_request event. Uses the same visual pattern as ModeTransitionDialog
 * so the UI is consistent across interactive decision points.
 *
 * Multiple simultaneous requests (from different AI participants) are each
 * rendered as independent cards.
 */

import { useTranslation } from 'react-i18next';
import type { StreamCliPermissionRequestEvent } from '../../../shared/stream-types';

export interface CliPermissionRequestCardProps {
  event: StreamCliPermissionRequestEvent;
  onRespond: (participantId: string, cliRequestId: string, approved: boolean) => void;
}

export function CliPermissionRequestCard({
  event,
  onRespond,
}: CliPermissionRequestCardProps): React.JSX.Element {
  const { t } = useTranslation();
  const { participantId, participantName, request } = event;

  return (
    <div className="consensus-panel consensus-panel--warning">
      <div style={{ marginBottom: 8 }}>
        <strong>{t('cliPermission.title', { name: participantName })}</strong>
      </div>

      <table className="consensus-table">
        <tbody>
          <tr>
            <th style={{ whiteSpace: 'nowrap' }}>{t('cliPermission.tool')}</th>
            <td>{request.toolName}</td>
          </tr>
          <tr>
            <th style={{ whiteSpace: 'nowrap' }}>{t('cliPermission.target')}</th>
            <td>
              <code style={{ wordBreak: 'break-all', fontSize: '0.85em' }}>
                {request.target}
              </code>
            </td>
          </tr>
          {request.description && (
            <tr>
              <th style={{ whiteSpace: 'nowrap' }}>{t('cliPermission.description')}</th>
              <td>{request.description}</td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="action-buttons" style={{ justifyContent: 'flex-start', marginTop: 8 }}>
        <button
          className="btn-primary btn-primary--sm"
          onClick={() => onRespond(participantId, request.cliRequestId, true)}
        >
          {t('cliPermission.approve')}
        </button>
        <button
          className="btn-control btn-primary--sm"
          onClick={() => onRespond(participantId, request.cliRequestId, false)}
        >
          {t('cliPermission.reject')}
        </button>
      </div>
    </div>
  );
}
