/**
 * AI provider configuration modal — edit name, persona, model.
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProviderInfo } from '../../../shared/provider-types';

type ValidateStatus = 'idle' | 'validating' | 'success' | 'failed';

export interface AIConfigModalProps {
  provider: ProviderInfo;
  onSave: (displayName: string, persona: string, model: string) => void;
  onClose: () => void;
}

export function AIConfigModal({ provider, onSave, onClose }: AIConfigModalProps): React.JSX.Element {
  const { t } = useTranslation();
  const [displayName, setDisplayName] = useState(provider.displayName);
  const [persona, setPersona] = useState(provider.persona ?? '');
  const [model, setModel] = useState(provider.model);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [modelError, setModelError] = useState('');
  const [validateStatus, setValidateStatus] = useState<ValidateStatus>('idle');
  const [validateMessage, setValidateMessage] = useState('');

  const handleValidate = useRef(async () => {
    setValidateStatus('validating');
    setValidateMessage('');
    try {
      const result = await window.arena.invoke('provider:validate', { id: provider.id });
      if (result.valid) {
        setValidateStatus('success');
        setValidateMessage(t('provider.validateSuccess'));
      } else {
        setValidateStatus('failed');
        setValidateMessage(t('provider.validateFailed', { message: result.message ?? '' }));
      }
    } catch (err) {
      setValidateStatus('failed');
      setValidateMessage(t('provider.validateFailed', { message: String(err) }));
    }
  }).current;

  // Fetch available models for this provider via IPC
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const config = provider.config;
        const key = config.type === 'cli'
          ? config.command
          : config.type === 'api'
            ? config.endpoint
            : config.type === 'local'
              ? config.baseUrl
              : '';
        if (!key) return;
        const apiKeyRef = config.type === 'api' ? config.apiKeyRef : undefined;
        const { models } = await window.arena.invoke('provider:list-models', {
          type: provider.type,
          key,
          apiKeyRef,
        });
        if (!cancelled) {
          setAvailableModels(models);
          setModelError(models.length === 0 && config.type === 'api' ? t('provider.modelFetchError') : '');
          if (models.length > 0 && !model) setModel(models[0]);
        }
      } catch (err) {
        console.warn('[provider:list-models] error:', err);
        if (!cancelled) setModelError(t('provider.modelFetchError'));
      }
    })();
    return () => { cancelled = true; };
  }, [provider, model, t]);

  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={handleOverlayClick}>
      <div className="modal-dialog">
        <h3 className="modal-title">{t('provider.configureTitle')}</h3>

        <div className="settings-field-group">
          <label className="settings-label">{t('provider.displayName')}</label>
          <input
            className="settings-input"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </div>

        <div className="settings-field-group">
          <label className="settings-label">{t('provider.persona')}</label>
          <textarea
            className="settings-input settings-input--textarea"
            value={persona}
            onChange={(e) => setPersona(e.target.value)}
            placeholder={t('provider.personaPlaceholder')}
          />
        </div>

        <div className="settings-field-group">
          <label className="settings-label">{t('provider.model')}</label>
          {availableModels.length > 0 ? (
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="settings-input settings-input--auto-min"
            >
              {availableModels.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
              {!availableModels.includes(model) && (
                <option value={model}>{model}</option>
              )}
            </select>
          ) : (
            <input
              className="settings-input"
              value={model}
              onChange={(e) => setModel(e.target.value)}
            />
          )}
        </div>
        {modelError && (
          <p className="text-md" style={{ color: 'var(--text-danger)', margin: '4px 0 0' }}>{modelError}</p>
        )}

        {/* Validate connection */}
        <div className="action-buttons" style={{ justifyContent: 'flex-start', gap: 8, margin: '8px 0' }}>
          <button
            className="btn-control btn-primary--sm"
            disabled={validateStatus === 'validating'}
            onClick={() => void handleValidate()}
          >
            {validateStatus === 'validating' ? t('app.loading') : t('provider.validate')}
          </button>
          {validateMessage && (
            <span style={{
              fontSize: '0.85em',
              color: validateStatus === 'success' ? 'var(--text-success)' : 'var(--text-danger)',
            }}>
              {validateMessage}
            </span>
          )}
        </div>

        <div className="modal-actions">
          <button
            className="btn-secondary"
            onClick={onClose}
          >
            {t('app.cancel')}
          </button>
          <button
            className="btn-primary"
            style={{ opacity: !displayName.trim() ? 0.5 : 1 }}
            disabled={!displayName.trim()}
            onClick={() => onSave(displayName.trim(), persona.trim(), model)}
          >
            {t('app.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
