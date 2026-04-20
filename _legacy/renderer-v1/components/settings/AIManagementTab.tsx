/**
 * AI Management tab — API / CLI / Local provider registration & list.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useProviderStore } from '../../stores/provider-store';
import type { ProviderConfig, ProviderInfo } from '../../../shared/provider-types';
import type { DetectedCli } from '../../../shared/ipc-types';
import { showError } from '../../hooks/useErrorDialog';
import {
  API_PROVIDERS, cliAutoDetectCache, runAutoCliDetection,
  getCommandKey, getDefaultCliConfig,
} from './settings-utils';
import { AIConfigModal } from './AIConfigModal';

export function AIManagementTab(): React.JSX.Element {
  const { t } = useTranslation();
  const providers = useProviderStore((s) => s.providers);
  const loading = useProviderStore((s) => s.loading);
  const fetchProviders = useProviderStore((s) => s.fetchProviders);
  const addProvider = useProviderStore((s) => s.addProvider);
  const removeProvider = useProviderStore((s) => s.removeProvider);

  const [selectedApiProvider, setSelectedApiProvider] = useState('');
  const [apiKeyRef, setApiKeyRef] = useState('');
  const [secretKeys, setSecretKeys] = useState<string[]>([]);
  const [editingProvider, setEditingProvider] = useState<ProviderInfo | null>(null);
  const [detectedClis, setDetectedClis] = useState<DetectedCli[]>([]);
  const [cliDetecting, setCliDetecting] = useState(false);
  const [ollamaDetecting, setOllamaDetecting] = useState(false);
  const [ollamaRunning, setOllamaRunning] = useState<boolean | null>(null);

  useEffect(() => {
    void fetchProviders();
    void (async () => {
      try {
        const { keys } = await window.arena.invoke('config:list-secret-keys', undefined);
        setSecretKeys(keys);
      } catch { /* ignore */ }
    })();
  }, [fetchProviders]);

  useEffect(() => {
    const hasPreparing = providers.some((p) => p.status === 'warming-up');
    if (!hasPreparing) return;

    const timer = setInterval(() => {
      void fetchProviders();
    }, 2000);

    return () => {
      clearInterval(timer);
    };
  }, [providers, fetchProviders]);

  // Auto-detect CLIs on tab mount
  useEffect(() => {
    void (async () => {
      await runAutoCliDetection();
      setDetectedClis(cliAutoDetectCache.detected);
    })();
  }, []); // runs once on mount

  const detectClis = async (auto = false): Promise<void> => {
    setCliDetecting(true);

    let detected: DetectedCli[] = [];

    if (auto) {
      await runAutoCliDetection();
      setDetectedClis(cliAutoDetectCache.detected);
    } else {
      try {
        const result = await window.arena.invoke('provider:detect-cli', undefined);
        detected = result.detected;
      } catch (err) {
        showError('provider:detect-cli', err);
        detected = [];
      }

      cliAutoDetectCache.completed = true;
      cliAutoDetectCache.detected = detected;
      setDetectedClis(detected);
    }

    setCliDetecting(false);
  };

  const handleAddCli = async (cli: DetectedCli): Promise<void> => {
    const key = getCommandKey(cli.command);
    const config = getDefaultCliConfig(cli.path || cli.command, key);
    await addProvider(cli.displayName, config);
    void fetchProviders();
  };

  const detectOllama = async (): Promise<void> => {
    setOllamaDetecting(true);
    try {
      const { models } = await window.arena.invoke('provider:list-models', { type: 'local', key: 'http://localhost:11434' });
      setOllamaRunning(models.length > 0);
    } catch {
      setOllamaRunning(false);
    }
    setOllamaDetecting(false);
  };

  const handleAddOllama = async (): Promise<void> => {
    const config = { type: 'local' as const, baseUrl: 'http://localhost:11434', model: '' };
    await addProvider('Ollama', config);
    void fetchProviders();
  };

  const selectedApi = API_PROVIDERS.find((p) => p.label === selectedApiProvider);

  const handleAddApi = async (): Promise<void> => {
    if (!selectedApi || !apiKeyRef.trim()) return;
    const config: ProviderConfig = {
      type: 'api',
      endpoint: selectedApi.endpoint,
      apiKeyRef: apiKeyRef.trim(),
      model: '',
    };
    await addProvider(selectedApiProvider, config);
    setSelectedApiProvider('');
    setApiKeyRef('');
  };

  const handleModalSave = async (
    provider: ProviderInfo,
    displayName: string,
    persona: string,
    model: string,
  ): Promise<void> => {
    // Remove and re-add with updated info (including model change)
    const updatedConfig = { ...provider.config, model };
    await removeProvider(provider.id);
    await addProvider(displayName, updatedConfig, persona || undefined);
    setEditingProvider(null);
    void fetchProviders();
  };

  return (
    <div className="settings-section">
      {/* API Provider Section */}
      <h3 style={{ margin: '0 0 12px' }}>{t('provider.type.api')}</h3>
      <div className="settings-card">
        <div className="settings-field-group">
          <label className="settings-label">{t('provider.selectApi')}</label>
          <select
            value={selectedApiProvider}
            onChange={(e) => {
              setSelectedApiProvider(e.target.value);
              setApiKeyRef('');
            }}
            className="settings-input settings-input--auto-min"
          >
            <option value="">{t('provider.selectApiPlaceholder')}</option>
            {API_PROVIDERS.map((p) => (
              <option key={p.label} value={p.label}>{p.label}</option>
            ))}
          </select>
        </div>

        {selectedApi && (
          <>
            <div className="settings-row separator-top" style={{ marginBottom: 12 }}>
              <strong style={{ fontSize: 15 }}>{selectedApiProvider}</strong>
              <button
                onClick={() => {
                  setSelectedApiProvider('');
                  setApiKeyRef('');
                }}
                className="cancel-btn-sm"
                title={t('app.cancel')}
              >
                X
              </button>
            </div>
          </>
        )}

        {selectedApi && (
          <>
            <div className="settings-field-group">
              <label className="settings-label">{t('provider.api.apiKeyRef')}</label>
              {secretKeys.length > 0 ? (
                <select
                  value={apiKeyRef}
                  onChange={(e) => setApiKeyRef(e.target.value)}
                  className="settings-input settings-input--auto-min"
                >
                  <option value="">{t('provider.api.selectKeyPlaceholder')}</option>
                  {secretKeys.map((k) => (
                    <option key={k} value={k}>{k}</option>
                  ))}
                </select>
              ) : (
                <div className="hint-box hint-box--danger-left">
                  <p style={{ margin: 0, fontSize: 13 }}>{t('provider.apiKeyNotRegistered')}</p>
                </div>
              )}
            </div>

            <button
              className="btn-primary"
              style={{ opacity: !apiKeyRef.trim() ? 0.5 : 1 }}
              disabled={!apiKeyRef.trim()}
              onClick={() => void handleAddApi()}
            >
              {t('app.add')}
            </button>
          </>
        )}
      </div>

      {/* CLI Provider Section */}
      <h3 style={{ margin: '16px 0 12px' }}>{t('provider.type.cli')}</h3>
      <div className="settings-card">
        {cliDetecting && (
          <p className="text-base" style={{ color: 'var(--text-tertiary)', margin: '0 0 8px' }}>{t('provider.cli.detecting')}</p>
        )}

        {!cliDetecting && detectedClis.length === 0 && (
          <div className="hint-box">
            {t('provider.cli.hint')}
            <div className="text-md" style={{ marginTop: 4, color: 'var(--text-warning-dark)' }}>
              {t('provider.cli.examples')}
            </div>
          </div>
        )}

        {detectedClis.map((cli) => {
          const detectedKey = getCommandKey(cli.command);
          const alreadyAdded = providers.some(
            (p) => p.config.type === 'cli' && getCommandKey(p.config.command) === detectedKey,
          );
          return (
            <div key={cli.command} className="settings-row cli-row">
              <div>
                <strong style={{ fontSize: 14 }}>{cli.displayName}</strong>
                <div className="provider-meta">
                  {cli.path}
                  {cli.version && ` — ${cli.version}`}
                </div>
              </div>
              {alreadyAdded ? (
                <span className="text-md" style={{ color: 'var(--text-success)', fontWeight: 500 }}>{t('provider.cli.added')}</span>
              ) : (
                <button
                  className="btn-primary"
                  onClick={() => void handleAddCli(cli)}
                >
                  {t('app.add')}
                </button>
              )}
            </div>
          );
        })}

        {!cliDetecting && (
          <button
            onClick={() => void detectClis()}
            className="btn-control"
            style={{ marginTop: 8 }}
          >
            {t('provider.cli.rescan')}
          </button>
        )}
      </div>

      {/* Local LLM Section (Ollama) */}
      <h3 style={{ margin: '16px 0 12px' }}>{t('provider.type.local')}</h3>
      <div className="settings-card">
        {ollamaDetecting && (
          <p className="text-base" style={{ color: 'var(--text-tertiary)', margin: '0 0 8px' }}>{t('provider.local.detecting')}</p>
        )}

        {ollamaRunning === null && !ollamaDetecting && (
          <div className="hint-box">
            {t('provider.local.hint')}
            <div className="text-md" style={{ marginTop: 4, color: 'var(--text-warning-dark)' }}>
              {t('provider.local.examples')}
            </div>
          </div>
        )}

        {ollamaRunning === false && !ollamaDetecting && (
          <div className="hint-box hint-box--danger-left">
            <p style={{ margin: '0 0 4px', fontWeight: 600 }}>{t('provider.local.ollamaNotRunning')}</p>
            <p className="text-base" style={{ margin: 0, color: 'var(--text-tertiary)' }}>{t('provider.local.ollamaNotRunningHint')}</p>
          </div>
        )}

        {ollamaRunning === true && !ollamaDetecting && (() => {
          const alreadyAdded = providers.some((p) => p.config.type === 'local' && p.config.baseUrl.includes('11434'));
          return (
            <div className="settings-row cli-row">
              <div>
                <strong style={{ fontSize: 14 }}>{t('provider.local.ollamaName')}</strong>
                <div className="provider-meta">{t('provider.local.ollamaUrl')}</div>
              </div>
              {alreadyAdded ? (
                <span className="text-md" style={{ color: 'var(--text-success)', fontWeight: 500 }}>{t('provider.local.ollamaAdded')}</span>
              ) : (
                <button className="btn-primary" onClick={() => void handleAddOllama()}>
                  {t('app.add')}
                </button>
              )}
            </div>
          );
        })()}

        <button
          onClick={() => void detectOllama()}
          className="btn-control"
          style={{ marginTop: 8 }}
          disabled={ollamaDetecting}
        >
          {t('provider.local.detectOllama')}
        </button>
      </div>

      {/* Registered providers list */}
      <h3 style={{ margin: '24px 0 12px' }}>{t('provider.registered')}</h3>
      {loading && <p>{t('app.loading')}</p>}

      {!loading && providers.length === 0 && (
        <p style={{ color: 'var(--text-tertiary)' }}>{t('provider.emptyState')}</p>
      )}

      {providers.map((provider) => (
        <div key={provider.id} className="settings-card provider-card">
          <div>
            <strong>{provider.displayName}</strong>
            <div className="provider-meta">
              {t(`provider.type.${provider.type}`)} / {provider.model}
            </div>
            {provider.persona && (
              <div className="provider-persona">
                {provider.persona}
              </div>
            )}
          </div>
          <div className="settings-row" style={{ marginBottom: 0 }}>
            <span
              className={`status-badge ${provider.status === 'ready' ? 'status-badge--ready' : 'status-badge--error'}`}
            >
              {t(`provider.status.${provider.status}`)}
            </span>
            <button
              className="btn-danger btn-configure"
              onClick={() => setEditingProvider(provider)}
            >
              {t('provider.configure')}
            </button>
            <button
              className="btn-danger"
              onClick={() => {
                if (confirm(t('provider.removeConfirm'))) {
                  void removeProvider(provider.id);
                }
              }}
            >
              {t('provider.remove')}
            </button>
          </div>
        </div>
      ))}

      {/* AI Config Modal */}
      {editingProvider && (
        <AIConfigModal
          provider={editingProvider}
          onSave={(name, persona, model) => void handleModalSave(editingProvider, name, persona, model)}
          onClose={() => setEditingProvider(null)}
        />
      )}
    </div>
  );
}
