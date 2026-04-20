/**
 * Secret keys management tab — add/delete encrypted secrets.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { showError } from '../../hooks/useErrorDialog';

export function SecretsTab(): React.JSX.Element {
  const { t } = useTranslation();
  const [secretKeys, setSecretKeys] = useState<string[]>([]);
  const [newSecretKey, setNewSecretKey] = useState('');
  const [newSecretValue, setNewSecretValue] = useState('');

  useEffect(() => {
    const fetch = async (): Promise<void> => {
      try {
        const result = await window.arena.invoke('config:list-secret-keys', undefined);
        setSecretKeys(result.keys);
      } catch (err) { console.warn('[config:list-secret-keys] error:', err); }
    };
    void fetch();
  }, []);

  const handleAddSecret = async (): Promise<void> => {
    if (!newSecretKey.trim() || !newSecretValue.trim()) return;
    try {
      await window.arena.invoke('config:set-secret', {
        key: newSecretKey.trim(),
        value: newSecretValue.trim(),
      });
      setSecretKeys((prev) => [...new Set([...prev, newSecretKey.trim()])]);
      setNewSecretKey('');
      setNewSecretValue('');
    } catch (err) { showError('config:set-secret', err); }
  };

  const handleDeleteSecret = async (key: string): Promise<void> => {
    try {
      await window.arena.invoke('config:delete-secret', { key });
      setSecretKeys((prev) => prev.filter((k) => k !== key));
    } catch (err) { showError('config:delete-secret', err); }
  };

  return (
    <div className="settings-section">
      <div className="settings-card">
        <p className="dialog-description">
          {t('settings.secretDescription')}
        </p>

        {secretKeys.length === 0 && (
          <p style={{ color: 'var(--text-tertiary)', margin: '0 0 12px' }}>{t('settings.secretEmpty')}</p>
        )}

        {secretKeys.map((key) => (
          <div key={key} className="settings-row" style={{ justifyContent: 'space-between' }}>
            <code className="text-base">{key}</code>
            <button className="btn-danger" onClick={() => void handleDeleteSecret(key)}>
              {t('settings.secretDelete')}
            </button>
          </div>
        ))}

        <div className="settings-row separator-top" style={{ marginTop: 4 }}>
          <input
            className="settings-input settings-input--narrow-lg"
            value={newSecretKey}
            onChange={(e) => setNewSecretKey(e.target.value)}
            placeholder={t('settings.secretKey')}
          />
          <input
            type="password"
            className="settings-input settings-input--med"
            value={newSecretValue}
            onChange={(e) => setNewSecretValue(e.target.value)}
            placeholder={t('settings.secretValue')}
          />
          <button
            className="btn-primary"
            style={{ opacity: !newSecretKey.trim() || !newSecretValue.trim() ? 0.5 : 1 }}
            onClick={() => void handleAddSecret()}
            disabled={!newSecretKey.trim() || !newSecretValue.trim()}
          >
            {t('settings.secretAdd')}
          </button>
        </div>
      </div>
    </div>
  );
}
