import { useTranslation } from 'react-i18next';
import type { PermissionRequest } from '../../../shared/file-types';

export interface PermissionRequestPanelProps {
  request: PermissionRequest;
  onApprove: () => void;
  onReject: () => void;
}

export function PermissionRequestPanel(
  { request, onApprove, onReject }: PermissionRequestPanelProps,
): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <div className="diff-panel diff-panel--scroll" style={{ maxHeight: 240 }}>
      <div className="panel-header">
        <strong>{t('permission.title')}</strong>
      </div>

      <div className="permission-details">
        <div><strong>{t('permission.participant')}:</strong> {request.participantId}</div>
        <div><strong>{t('permission.action')}:</strong> {request.action}</div>
        <div><strong>{t('permission.target')}:</strong> <code>{request.targetPath}</code></div>
        {request.reason && (
          <div><strong>{t('permission.reason')}:</strong> {request.reason}</div>
        )}
      </div>

      <div className="action-buttons" style={{ marginTop: 12 }}>
        <button onClick={onReject} className="btn-danger">
          {t('permission.reject')}
        </button>
        <button onClick={onApprove} className="btn-primary btn-primary--md">
          {t('permission.approve')}
        </button>
      </div>
    </div>
  );
}
