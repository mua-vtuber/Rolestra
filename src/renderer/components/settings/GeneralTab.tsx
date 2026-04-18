/**
 * General settings tab — theme, language, rounds, token limits, retries,
 * timeout, designated aggregator, WSL distro.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../../i18n';
import { useAppStore } from '../../stores/app-store';
import { useProviderStore } from '../../stores/provider-store';
import type { SettingsConfig } from '../../../shared/config-types';
import { showError } from '../../hooks/useErrorDialog';

export function GeneralTab(): React.JSX.Element {
  const { t } = useTranslation();
  const appInfo = useAppStore((s) => s.appInfo);
  const connected = useAppStore((s) => s.connected);
  const providers = useProviderStore((s) => s.providers);
  const fetchProviders = useProviderStore((s) => s.fetchProviders);

  const [settings, setSettings] = useState<SettingsConfig | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => { void fetchProviders(); }, [fetchProviders]);

  useEffect(() => {
    const fetch = async (): Promise<void> => {
      try {
        const result = await window.arena.invoke('config:get-settings', undefined);
        setSettings(result.settings);
      } catch (err) { console.warn('[config:get-settings] error:', err); }
    };
    void fetch();
  }, []);

  const handleSave = async (): Promise<void> => {
    if (!settings) return;
    try {
      const result = await window.arena.invoke('config:update-settings', { patch: settings });
      setSettings(result.settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      // Notify other components (e.g., theme hook) of settings change
      window.dispatchEvent(new CustomEvent('arena:settings-saved', { detail: result.settings }));
    } catch (err) { showError('config:update-settings', err); }
  };

  const updateSetting = <K extends keyof SettingsConfig>(key: K, value: SettingsConfig[K]): void => {
    setSettings((prev) => prev ? { ...prev, [key]: value } : prev);
  };

  return (
    <div className="settings-section">
      {/* App info */}
      <div className="settings-card">
        <div className="settings-row">
          <span className="settings-label settings-label--inline settings-label--med">{t('settings.appName')}</span>
          <span>{appInfo?.name ?? '-'}</span>
        </div>
        <div className="settings-row">
          <span className="settings-label settings-label--inline settings-label--med">{t('settings.version')}</span>
          <span>{appInfo?.version ?? '-'}</span>
        </div>
        <div className="settings-row">
          <span className="settings-label settings-label--inline settings-label--med">{t('settings.connection')}</span>
          <span style={{ color: connected ? 'var(--text-success)' : 'var(--text-danger)' }}>
            {connected ? t('settings.connected') : t('settings.disconnected')}
          </span>
        </div>
      </div>

      {/* Settings form */}
      {settings && (
        <>
          <div className="settings-card">
            <div className="settings-row">
              <label className="settings-label settings-label--inline settings-label--wide">{t('settings.theme')}</label>
              <select
                value={settings.uiTheme}
                onChange={(e) => updateSetting('uiTheme', e.target.value as 'light' | 'dark')}
                className="settings-input settings-input--auto"
              >
                <option value="light">{t('settings.themeLight')}</option>
                <option value="dark">{t('settings.themeDark')}</option>
              </select>
            </div>

            <div className="settings-row">
              <label className="settings-label settings-label--inline settings-label--wide">{t('settings.language')}</label>
              <select
                value={settings.language}
                onChange={(e) => {
                  const lang = e.target.value;
                  updateSetting('language', lang);
                  void i18n.changeLanguage(lang);
                }}
                className="settings-input settings-input--auto"
              >
                {/* Language names are intentionally literal — they identify themselves */}
                <option value="ko">{'한국어'}</option>
                <option value="en">{'English'}</option>
              </select>
            </div>

            <div className="settings-row">
              <label className="settings-label settings-label--inline settings-label--wide">{t('settings.defaultRounds')}</label>
              <input
                type="number"
                className="settings-input settings-input--narrow"
                min={1}
                value={settings.defaultRounds === 'unlimited' ? '' : settings.defaultRounds}
                placeholder={settings.defaultRounds === 'unlimited' ? t('settings.unlimited') : undefined}
                onChange={(e) => {
                  const v = e.target.value;
                  updateSetting('defaultRounds', v === '' ? 'unlimited' : Number(v));
                }}
              />
            </div>

            <div className="settings-row">
              <label className="settings-label settings-label--inline settings-label--wide">{t('settings.softTokenLimit')}</label>
              <input
                type="number"
                className="settings-input settings-input--narrow-md"
                min={0}
                value={settings.softTokenLimit}
                onChange={(e) => updateSetting('softTokenLimit', Number(e.target.value))}
              />
            </div>

            <div className="settings-row">
              <label className="settings-label settings-label--inline settings-label--wide">{t('settings.hardTokenLimit')}</label>
              <input
                type="number"
                className="settings-input settings-input--narrow-md"
                min={0}
                value={settings.hardTokenLimit}
                onChange={(e) => updateSetting('hardTokenLimit', Number(e.target.value))}
              />
            </div>

            <div className="settings-row">
              <label className="settings-label settings-label--inline settings-label--wide">{t('settings.maxRetries')}</label>
              <input
                type="number"
                className="settings-input settings-input--narrow"
                value={settings.maxRetries}
                onChange={(e) => updateSetting('maxRetries', Number(e.target.value))}
              />
            </div>

            <div className="settings-row">
              <label className="settings-label settings-label--inline settings-label--wide">{t('settings.phaseTimeout')}</label>
              <input
                type="number"
                className="settings-input settings-input--narrow-md"
                value={Math.round(settings.phaseTimeoutMs / 1000)}
                onChange={(e) => updateSetting('phaseTimeoutMs', Number(e.target.value) * 1000)}
              />
            </div>

            <div className="settings-row">
              <label className="settings-label settings-label--inline settings-label--wide">{t('settings.designatedAggregator')}</label>
              <select
                value={settings.designatedAggregatorId}
                onChange={(e) => updateSetting('designatedAggregatorId', e.target.value)}
                className="settings-input settings-input--auto"
              >
                <option value="">{t('settings.aggregatorAuto')}</option>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>{p.displayName}</option>
                ))}
              </select>
            </div>

            <div className="settings-row">
              <label className="settings-label settings-label--inline settings-label--wide">{t('settings.consensusFolder')}</label>
              <input
                type="text"
                className="settings-input settings-input--auto"
                readOnly
                value={settings.consensusFolderPath || t('settings.consensusFolderDefault')}
              />
              <button
                className="btn-secondary btn-sm"
                style={{ marginLeft: '0.5rem' }}
                onClick={() => {
                  void (async () => {
                    try {
                      const { folderPath } = await window.arena.invoke('consensus-folder:pick', undefined);
                      if (folderPath) {
                        updateSetting('consensusFolderPath', folderPath);
                        await window.arena.invoke('consensus-folder:init', { folderPath });
                      }
                    } catch (err) { showError('consensus-folder:pick', err); }
                  })();
                }}
              >
                {t('settings.consensusFolderChange')}
              </button>
            </div>
            <p className="settings-hint">{t('settings.consensusFolderHint')}</p>

            <div className="settings-save-row">
              <button className="btn-primary" onClick={() => void handleSave()}>
                {t('app.save')}
              </button>
              {saved && <span className="settings-saved-msg">{t('settings.saved')}</span>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
