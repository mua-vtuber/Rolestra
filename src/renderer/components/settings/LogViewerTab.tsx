/**
 * LogViewerTab — structured log viewer with component/level/time filters.
 *
 * Fetches entries via log:list IPC, displays filterable table,
 * and offers export via log:export IPC.
 */

import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { StructuredLogEntry } from '../../../shared/log-types';

export function LogViewerTab(): React.JSX.Element {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<StructuredLogEntry[]>([]);
  const [filterComponent, setFilterComponent] = useState('');
  const [filterLevel, setFilterLevel] = useState('');
  const [exporting, setExporting] = useState(false);

  const fetchEntries = useCallback(async () => {
    try {
      const req: Record<string, unknown> = { limit: 500 };
      if (filterComponent) req.component = filterComponent;
      if (filterLevel) req.level = filterLevel;
      const result = await window.arena.invoke('log:list', req as Parameters<typeof window.arena.invoke<'log:list'>>[1]);
      setEntries(result.entries);
    } catch (err) { console.warn('[log:list] error:', err); }
  }, [filterComponent, filterLevel]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch pattern
  useEffect(() => { void fetchEntries(); }, [fetchEntries]);

  const handleExport = async (format: 'json' | 'markdown'): Promise<void> => {
    setExporting(true);
    try {
      const result = await window.arena.invoke('log:export', {
        format,
        maskSecrets: true,
        component: filterComponent || undefined,
      });
      const blob = new Blob([result.content], { type: format === 'json' ? 'application/json' : 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = result.filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) { console.warn('[log:export] error:', err); }
    setExporting(false);
  };

  // Summary stats
  const errorCount = entries.filter((e) => e.result === 'failure').length;
  const latencies = entries.filter((e): e is typeof e & { latencyMs: number } => e.latencyMs != null).map((e) => e.latencyMs);
  const avgLatency = latencies.length > 0
    ? (latencies.reduce((s, v) => s + v, 0) / latencies.length).toFixed(1)
    : '-';
  const totalTokens = entries.reduce((sum, e) => sum + (e.tokenCount?.total ?? 0), 0);

  return (
    <div className="settings-section">
      <div className="settings-card">
        {/* Filters */}
        <div className="action-buttons" style={{ marginBottom: 8, justifyContent: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
          <select
            className="settings-input settings-input--auto"
            value={filterComponent}
            onChange={(e) => setFilterComponent(e.target.value)}
          >
            <option value="">{t('log.viewer.allComponents')}</option>
            <option value="provider">{t('log.viewer.components.provider')}</option>
            <option value="consensus">{t('log.viewer.components.consensus')}</option>
            <option value="execution">{t('log.viewer.components.execution')}</option>
            <option value="memory">{t('log.viewer.components.memory')}</option>
          </select>
          <select
            className="settings-input settings-input--auto"
            value={filterLevel}
            onChange={(e) => setFilterLevel(e.target.value)}
          >
            <option value="">{t('log.viewer.allLevels')}</option>
            <option value="debug">{t('log.viewer.levels.debug')}</option>
            <option value="info">{t('log.viewer.levels.info')}</option>
            <option value="warn">{t('log.viewer.levels.warn')}</option>
            <option value="error">{t('log.viewer.levels.error')}</option>
          </select>
          <button
            className="btn-control btn-primary--sm"
            disabled={exporting}
            onClick={() => void handleExport('json')}
          >
            {t('log.export.json')}
          </button>
          <button
            className="btn-control btn-primary--sm"
            disabled={exporting}
            onClick={() => void handleExport('markdown')}
          >
            {t('log.export.markdown')}
          </button>
        </div>

        {/* Summary */}
        <div className="action-buttons" style={{ marginBottom: 8, justifyContent: 'flex-start', gap: 16, fontSize: '0.85em' }}>
          <span>{t('log.viewer.entries')}: <strong>{entries.length}</strong></span>
          <span>{t('log.viewer.avgLatency')}: <strong>{t('log.viewer.ms', { value: avgLatency })}</strong></span>
          <span>{t('log.viewer.totalTokens')}: <strong>{totalTokens}</strong></span>
          <span>{t('log.viewer.errors')}: <strong style={{ color: errorCount > 0 ? 'var(--text-danger)' : undefined }}>{errorCount}</strong></span>
        </div>

        {entries.length === 0 ? (
          <p className="dialog-description">{t('log.viewer.empty')}</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="consensus-table">
              <thead>
                <tr>
                  <th>{t('log.viewer.time')}</th>
                  <th>{t('log.viewer.level')}</th>
                  <th>{t('log.viewer.component')}</th>
                  <th>{t('log.viewer.action')}</th>
                  <th>{t('log.viewer.result')}</th>
                  <th>{t('log.viewer.latency')}</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e, i) => (
                  <tr key={`${e.timestamp}-${i}`}>
                    <td style={{ whiteSpace: 'nowrap' }}>{new Date(e.timestamp).toLocaleTimeString()}</td>
                    <td>
                      <span className={`chip ${e.level === 'error' ? 'chip--error' : e.level === 'warn' ? 'chip--warning' : 'chip--info'}`}>
                        {e.level}
                      </span>
                    </td>
                    <td>{e.component}</td>
                    <td>{e.action}</td>
                    <td>
                      <span className={`chip ${e.result === 'failure' ? 'chip--error' : e.result === 'denied' ? 'chip--warning' : 'chip--success'}`}>
                        {e.result}
                      </span>
                    </td>
                    <td>{e.latencyMs != null ? `${e.latencyMs}ms` : '-'}</td>
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
