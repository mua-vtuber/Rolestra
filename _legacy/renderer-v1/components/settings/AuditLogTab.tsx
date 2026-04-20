/**
 * AuditLogTab — displays execution audit log entries with filters.
 *
 * Fetches entries via audit:list IPC and displays in a filterable table.
 */

import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { AuditEntry } from '../../../shared/execution-types';

export function AuditLogTab(): React.JSX.Element {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [filterAiId, setFilterAiId] = useState('');
  const [filterAction, setFilterAction] = useState('');
  const [filterResult, setFilterResult] = useState('');

  const fetchEntries = useCallback(async () => {
    try {
      const req: Record<string, unknown> = { limit: 500 };
      if (filterAiId) req.aiId = filterAiId;
      if (filterAction) req.action = filterAction;
      if (filterResult) req.result = filterResult;
      const result = await window.arena.invoke('audit:list', req as Parameters<typeof window.arena.invoke<'audit:list'>>[1]);
      setEntries(result.entries);
    } catch (err) { console.warn('[audit:list] error:', err); }
  }, [filterAiId, filterAction, filterResult]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch pattern
  useEffect(() => { void fetchEntries(); }, [fetchEntries]);

  const handleClear = async (): Promise<void> => {
    try {
      await window.arena.invoke('audit:clear', undefined);
      setEntries([]);
    } catch (err) { console.warn('[audit:clear] error:', err); }
  };

  return (
    <div className="settings-section">
      <div className="settings-card">
        <div className="action-buttons" style={{ marginBottom: 8, justifyContent: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
          <input
            type="text"
            className="settings-input settings-input--narrow-md"
            placeholder={t('audit.filter.aiId')}
            value={filterAiId}
            onChange={(e) => setFilterAiId(e.target.value)}
          />
          <select
            className="settings-input settings-input--auto"
            value={filterAction}
            onChange={(e) => setFilterAction(e.target.value)}
          >
            <option value="">{t('audit.filter.allActions')}</option>
            <option value="read">{t('audit.action.read')}</option>
            <option value="write">{t('audit.action.write')}</option>
            <option value="execute">{t('audit.action.execute')}</option>
            <option value="apply-patch">{t('audit.action.applyPatch')}</option>
          </select>
          <select
            className="settings-input settings-input--auto"
            value={filterResult}
            onChange={(e) => setFilterResult(e.target.value)}
          >
            <option value="">{t('audit.filter.allResults')}</option>
            <option value="success">{t('audit.result.success')}</option>
            <option value="denied">{t('audit.result.denied')}</option>
            <option value="failed">{t('audit.result.failed')}</option>
          </select>
          <button className="btn-danger btn-primary--sm" onClick={() => void handleClear()}>
            {t('audit.clear')}
          </button>
        </div>

        {entries.length === 0 ? (
          <p className="dialog-description">{t('audit.empty')}</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="consensus-table">
              <thead>
                <tr>
                  <th>{t('audit.columns.timestamp')}</th>
                  <th>{t('audit.columns.aiId')}</th>
                  <th>{t('audit.columns.action')}</th>
                  <th>{t('audit.columns.target')}</th>
                  <th>{t('audit.columns.result')}</th>
                  <th>{t('audit.columns.operationId')}</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e, i) => (
                  <tr key={`${e.operationId}-${i}`}>
                    <td style={{ whiteSpace: 'nowrap' }}>{new Date(e.timestamp).toLocaleTimeString()}</td>
                    <td>{e.aiId}</td>
                    <td><span className="chip chip--info">{e.action}</span></td>
                    <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }} title={e.targetPath}>{e.targetPath}</td>
                    <td>
                      <span className={`chip ${e.result === 'success' ? 'chip--success' : e.result === 'denied' ? 'chip--warning' : 'chip--error'}`}>
                        {e.result}
                      </span>
                    </td>
                    <td style={{ fontSize: '0.8em', opacity: 0.7 }}>{e.operationId.slice(0, 8)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
