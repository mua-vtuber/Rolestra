/**
 * Memory settings tab — enable/disable, provider assignment, tuning parameters.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useProviderStore } from '../../stores/provider-store';
import type { MemorySettings } from '../../../shared/config-types';
import { DEFAULT_MEMORY_SETTINGS } from '../../../shared/config-types';
import { showError } from '../../hooks/useErrorDialog';

export function MemoryTab(): React.JSX.Element {
  const { t } = useTranslation();
  const providers = useProviderStore((s) => s.providers);
  const fetchProviders = useProviderStore((s) => s.fetchProviders);

  const [memSettings, setMemSettings] = useState<MemorySettings>(DEFAULT_MEMORY_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState(false);
  const [reindexing, setReindexing] = useState(false);
  const [reindexResult, setReindexResult] = useState<string | null>(null);
  const [embeddingModels, setEmbeddingModels] = useState<string[]>([]);
  const [embeddingModelsLoading, setEmbeddingModelsLoading] = useState(false);
  const [embeddingModelError, setEmbeddingModelError] = useState('');

  useEffect(() => {
    void fetchProviders();
  }, [fetchProviders]);

  useEffect(() => {
    const fetch = async (): Promise<void> => {
      try {
        const result = await window.arena.invoke('config:get-settings', undefined);
        if (result.settings.memorySettings) {
          setMemSettings({ ...DEFAULT_MEMORY_SETTINGS, ...result.settings.memorySettings });
        }
        setLoaded(true);
      } catch (err) { console.warn('[config:get-settings] error:', err); }
    };
    void fetch();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const providerId = memSettings.embeddingProviderId;
    if (!providerId) {
      setEmbeddingModels([]);
      setEmbeddingModelError('');
      return;
    }
    const provider = providers.find((p) => p.id === providerId);
    if (!provider) {
      setEmbeddingModels([]);
      setEmbeddingModelError('');
      return;
    }
    const config = provider.config;
    const key = config.type === 'cli'
      ? config.command
      : config.type === 'api'
        ? config.endpoint
        : config.type === 'local'
          ? config.baseUrl
          : '';
    if (!key) return;

    setEmbeddingModelsLoading(true);
    setEmbeddingModelError('');
    void (async () => {
      try {
        const apiKeyRef = config.type === 'api' ? config.apiKeyRef : undefined;
        const { models } = await window.arena.invoke('provider:list-embedding-models', {
          type: provider.type,
          key,
          apiKeyRef,
        });
        if (cancelled) return;
        setEmbeddingModels(models);
        if (models.length === 0) {
          setEmbeddingModelError(t('memory.settings.embeddingModelFetchError'));
          update('vectorSearchEnabled', false);
        } else if (!models.includes(memSettings.embeddingModel)) {
          update('embeddingModel', models[0]);
        }
      } catch (err) {
        console.warn('[provider:list-embedding-models] error:', err);
        if (!cancelled) {
          setEmbeddingModels([]);
          setEmbeddingModelError(t('memory.settings.embeddingModelFetchError'));
          update('vectorSearchEnabled', false);
        }
      } finally {
        if (!cancelled) setEmbeddingModelsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [memSettings.embeddingProviderId, memSettings.embeddingModel, providers, t]);

  const handleSave = async (): Promise<void> => {
    try {
      const result = await window.arena.invoke('config:update-settings', {
        patch: { memorySettings: memSettings },
      });
      if (result.settings.memorySettings) {
        setMemSettings({ ...DEFAULT_MEMORY_SETTINGS, ...result.settings.memorySettings });
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) { showError('config:update-settings', err); }
  };

  const update = <K extends keyof MemorySettings>(key: K, value: MemorySettings[K]): void => {
    setMemSettings((prev) => ({ ...prev, [key]: value }));
  };

  // API and local providers can serve embedding/reflection calls
  const assignableProviders = providers.filter(
    (p) => p.type === 'api' || p.type === 'local',
  );
  const embeddingModelValid = !memSettings.embeddingProviderId ||
    (embeddingModels.length > 0 && embeddingModels.includes(memSettings.embeddingModel));
  const canSave = !memSettings.enabled || embeddingModelValid;

  if (!loaded) {
    return <div className="settings-section"><p>{t('app.loading')}</p></div>;
  }

  return (
    <div className="settings-section">
      {/* Description */}
      <div className="settings-card">
        <p className="dialog-description">
          {t('memory.settings.description')}
        </p>

        {/* Enable toggle */}
        <div className="settings-row">
          <label className="settings-label settings-label--inline settings-label--title">
            {t('memory.settings.enabled')}
          </label>
          <input
            type="checkbox"
            checked={memSettings.enabled}
            onChange={(e) => update('enabled', e.target.checked)}
            className="settings-checkbox"
          />
        </div>
      </div>

      {memSettings.enabled && (
        <>
          {/* Phase 3-b notice */}
          <div className="hint-box">
            {t('memory.settings.phase3bNotice')}
          </div>

          {/* Provider assignment */}
          <div className="settings-card">
            {/* Embedding provider */}
            <div className="settings-field-group">
              <label className="settings-label">
                {t('memory.settings.embeddingProvider')}
                <span className="info-tooltip" data-tooltip={t('memory.settings.embeddingTooltip')}>?</span>
              </label>
              <p className="settings-hint" style={{ margin: '0 0 6px' }}>
                {t('memory.settings.embeddingProviderHint')}
              </p>
              <select
                value={memSettings.embeddingProviderId ?? ''}
                onChange={(e) => {
                  const val = e.target.value || null;
                  update('embeddingProviderId', val);
                  if (val) {
                    update('vectorSearchEnabled', true);
                  } else {
                    update('vectorSearchEnabled', false);
                  }
                }}
                className="settings-input settings-input--auto-min-lg"
              >
                <option value="">{t('memory.settings.noneSelected')}</option>
                {assignableProviders.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.displayName} ({p.model})
                  </option>
                ))}
              </select>
              {memSettings.embeddingProviderId && (
                <div className="settings-field-group" style={{ marginTop: 8 }}>
                  <label className="settings-label">
                    {t('memory.settings.embeddingModel')}
                  </label>
                  <p className="settings-hint" style={{ margin: '0 0 6px' }}>
                    {t('memory.settings.embeddingModelHint')}
                  </p>
                  {embeddingModels.length > 0 ? (
                    <select
                      value={memSettings.embeddingModel}
                      onChange={(e) => update('embeddingModel', e.target.value)}
                      className="settings-input settings-input--auto-min-lg"
                      disabled={embeddingModelsLoading}
                    >
                      {embeddingModels.map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      className="settings-input"
                      value={embeddingModelsLoading ? t('app.loading') : ''}
                      disabled
                    />
                  )}
                  {embeddingModelError && (
                    <p className="text-md" style={{ color: 'var(--text-danger)', margin: '4px 0 0' }}>
                      {embeddingModelError}
                    </p>
                  )}
                </div>
              )}

              {/* Reindex button */}
              {memSettings.embeddingProviderId && (
                <div className="settings-save-row" style={{ marginTop: 8 }}>
                  <button
                    className="btn-primary btn-primary--sm"
                    style={{ opacity: reindexing ? 0.5 : 1 }}
                    disabled={reindexing}
                    onClick={async () => {
                      setReindexing(true);
                      setReindexResult(null);
                      try {
                        const res = await window.arena.invoke('memory:reindex', undefined);
                        setReindexResult(t('memory.settings.reindexDone', { count: res.reindexed }));
                      } catch (err) { showError('memory:reindex', err); }
                      setReindexing(false);
                      setTimeout(() => setReindexResult(null), 5000);
                    }}
                  >
                    {reindexing ? t('memory.settings.reindexing') : t('memory.settings.reindex')}
                  </button>
                  {reindexResult && (
                    <span className="text-md" style={{ color: 'var(--text-success)' }}>{reindexResult}</span>
                  )}
                  <p className="text-sm" style={{ color: 'var(--text-tertiary)', margin: 0 }}>
                    {t('memory.settings.reindexHint')}
                  </p>
                </div>
              )}
            </div>

            {/* Reflection provider */}
            <div className="settings-field-group">
              <label className="settings-label">
                {t('memory.settings.reflectionProvider')}
                <span className="info-tooltip" data-tooltip={t('memory.settings.reflectionTooltip')}>?</span>
              </label>
              <p className="settings-hint" style={{ margin: '0 0 6px' }}>
                {t('memory.settings.reflectionProviderHint')}
              </p>
              <select
                value={memSettings.reflectionProviderId ?? ''}
                onChange={(e) => update('reflectionProviderId', e.target.value || null)}
                className="settings-input settings-input--auto-min-lg"
              >
                <option value="">{t('memory.settings.noneSelected')}</option>
                {assignableProviders.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.displayName} ({p.model})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Feature toggles */}
          <div className="settings-card">
            <div className="settings-row">
              <label className="settings-label settings-label--inline" style={{ flex: 1 }}>
                {t('memory.settings.vectorSearch')}
              </label>
              <input
                type="checkbox"
                checked={memSettings.vectorSearchEnabled}
                onChange={(e) => update('vectorSearchEnabled', e.target.checked)}
                disabled={!memSettings.embeddingProviderId}
                className="settings-checkbox"
              />
            </div>
            {!memSettings.embeddingProviderId && (
              <p className="settings-hint" style={{ margin: '0 0 8px' }}>
                {t('memory.settings.vectorSearchHint')}
              </p>
            )}

            <div className="settings-row">
              <label className="settings-label settings-label--inline" style={{ flex: 1 }}>
                {t('memory.settings.graphEnabled')}
              </label>
              <input
                type="checkbox"
                checked={memSettings.graphEnabled}
                onChange={(e) => update('graphEnabled', e.target.checked)}
                className="settings-checkbox"
              />
            </div>
          </div>

          {/* Tuning parameters */}
          <div className="settings-card">
            <div className="settings-row">
              <label className="settings-label settings-label--inline settings-label--xwide">
                {t('memory.settings.contextBudget')}
              </label>
              <input
                type="number"
                className="settings-input settings-input--narrow-md"
                value={memSettings.contextBudget}
                onChange={(e) => update('contextBudget', Number(e.target.value))}
                min={512}
                max={32768}
              />
            </div>
            <p className="settings-hint settings-hint--neg">
              {t('memory.settings.contextBudgetHint')}
            </p>

            <div className="settings-row">
              <label className="settings-label settings-label--inline settings-label--xwide">
                {t('memory.settings.retrievalLimit')}
              </label>
              <input
                type="number"
                className="settings-input settings-input--narrow"
                value={memSettings.retrievalLimit}
                onChange={(e) => update('retrievalLimit', Number(e.target.value))}
                min={1}
                max={50}
              />
            </div>

            <div className="settings-row">
              <label className="settings-label settings-label--inline settings-label--xwide">
                {t('memory.settings.reflectionThreshold')}
              </label>
              <input
                type="number"
                className="settings-input settings-input--narrow"
                value={memSettings.reflectionThreshold}
                onChange={(e) => update('reflectionThreshold', Number(e.target.value))}
                min={3}
                max={100}
              />
            </div>
            <p className="settings-hint settings-hint--neg">
              {t('memory.settings.reflectionThresholdHint')}
            </p>
          </div>

          {/* Save */}
          <div className="settings-save-row">
            <button className="btn-primary" onClick={() => void handleSave()} disabled={!canSave}>
              {t('app.save')}
            </button>
            {saved && <span className="settings-saved-msg">{t('settings.saved')}</span>}
          </div>
        </>
      )}

      {!memSettings.enabled && (
        <div className="settings-save-row">
          <button className="btn-primary" onClick={() => void handleSave()}>
            {t('app.save')}
          </button>
          {saved && <span className="settings-saved-msg">{t('settings.saved')}</span>}
        </div>
      )}
    </div>
  );
}
