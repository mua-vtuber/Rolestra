/**
 * DatabaseTab — database statistics, export, and import.
 *
 * Shows per-table row counts and file size.
 * Export uses `db:export` (VACUUM INTO + save dialog).
 * Import uses `db:import` (open dialog + validate + requires restart).
 */

import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

interface TableStat {
  name: string;
  count: number;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DatabaseTab(): React.JSX.Element {
  const { t } = useTranslation();
  const [tables, setTables] = useState<TableStat[]>([]);
  const [sizeBytes, setSizeBytes] = useState(0);
  const [message, setMessage] = useState('');

  const loadStats = useCallback(async () => {
    try {
      const result = await window.arena.invoke('db:stats', undefined);
      setTables(result.tables);
      setSizeBytes(result.sizeBytes);
    } catch (err) {
      console.warn('[db:stats] error:', err);
    }
  }, []);

  useEffect(() => {
    void loadStats(); // eslint-disable-line react-hooks/set-state-in-effect -- async fetch pattern
  }, [loadStats]);

  const handleExport = useCallback(async () => {
    try {
      const result = await window.arena.invoke('db:export', undefined);
      if (result.success) {
        setMessage(t('db.exportSuccess'));
      }
    } catch (err) {
      console.warn('[db:export] error:', err);
    }
  }, [t]);

  const handleImport = useCallback(async () => {
    if (!window.confirm(t('db.importConfirm'))) return;
    try {
      const result = await window.arena.invoke('db:import', undefined);
      if (result.success) {
        setMessage(t('db.importSuccess'));
      }
    } catch (err) {
      console.warn('[db:import] error:', err);
    }
  }, [t]);

  return (
    <div className="settings-section">
      <h3 className="settings-section-title">{t('db.stats.title')}</h3>

      <p className="text-md">
        <strong>{t('db.stats.size')}:</strong> {formatBytes(sizeBytes)}
      </p>

      {tables.length > 0 && (
        <table className="data-table">
          <thead>
            <tr>
              <th>{t('db.stats.tables')}</th>
              <th>{t('db.stats.records')}</th>
            </tr>
          </thead>
          <tbody>
            {tables.map((tbl) => (
              <tr key={tbl.name}>
                <td>{tbl.name}</td>
                <td>{tbl.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="action-buttons" style={{ marginTop: 12, gap: 8 }}>
        <button className="btn-control btn-primary--sm" onClick={() => void handleExport()}>
          {t('db.export')}
        </button>
        <button className="btn-control btn-secondary--sm" onClick={() => void handleImport()}>
          {t('db.import')}
        </button>
      </div>

      {message && (
        <p className="text-md" style={{ color: 'var(--text-success)', marginTop: 8 }}>{message}</p>
      )}
    </div>
  );
}
