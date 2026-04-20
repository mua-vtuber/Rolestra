/**
 * PermissionManagementPanel — read-only view of per-AI file permission rules.
 *
 * Fetches current rules via `permission:list-rules` IPC.
 * Permissions are managed automatically by the SSM in work mode.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface PermissionRule {
  aiId: string;
  path: string;
  read: boolean;
  write: boolean;
  execute: boolean;
}

export function PermissionManagementPanel(): React.JSX.Element {
  const { t } = useTranslation();
  const [rules, setRules] = useState<PermissionRule[]>([]);

  useEffect(() => {
    void (async () => {
      try {
        const { rules: fetched } = await window.arena.invoke('permission:list-rules', {});
        setRules(fetched);
      } catch (err) {
        console.warn('[permission:list-rules] error:', err);
      }
    })();
  }, []);

  return (
    <div className="settings-section">
      <h3 className="settings-section-title">{t('permission.rules.title')}</h3>
      <p className="text-md text-muted">{t('permission.rules.readOnly')}</p>

      {rules.length === 0 ? (
        <p className="text-md text-muted">{t('permission.rules.empty')}</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>{t('permission.participant')}</th>
              <th>{t('permission.rules.path')}</th>
              <th>{t('permission.rules.read')}</th>
              <th>{t('permission.rules.write')}</th>
              <th>{t('permission.rules.execute')}</th>
            </tr>
          </thead>
          <tbody>
            {rules.map((rule, i) => (
              <tr key={`${rule.aiId}-${rule.path}-${i}`}>
                <td>{rule.aiId}</td>
                <td>{rule.path}</td>
                <td>{rule.read ? '\u2713' : '\u2717'}</td>
                <td>{rule.write ? '\u2713' : '\u2717'}</td>
                <td>{rule.execute ? '\u2713' : '\u2717'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
