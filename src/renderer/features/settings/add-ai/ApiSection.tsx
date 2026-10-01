/**
 * "API 키로 연결" (spec 2026-10-01-messenger-redesign.md R6-1): the four
 * services (Claude / ChatGPT·Codex / Gemini / 기타 호환) and, once one is
 * picked, the existing connect form — name, (기타 only) address, key,
 * "모델 불러오기", model, "추가". The flow and its key handling live in
 * `use-provider-connect.ts`.
 */
import { clsx } from 'clsx';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../../components/primitives/button';
import { API_SERVICE_CHOICES } from '../../../../shared/api-service-catalog';
import type { ProviderConnectState } from './use-provider-connect';

const FIELD_CLASS = 'mt-1 w-full border border-border bg-sunk px-2.5 py-1.5 text-sm text-fg [clip-path:var(--clip-control)]';

export interface ApiSectionProps {
  state: ProviderConnectState;
  /** False until the AI list is known (default names need it). */
  ready: boolean;
}

function ApiForm({ state }: { state: ProviderConnectState }): ReactElement {
  const { t } = useTranslation();
  const { pending } = state;
  return (
    <div className="flex flex-col gap-3">
      <label className="block text-sm">{t('providerConnect.name')}
        <input data-testid="provider-connect-name" value={state.name} disabled={pending}
          onChange={(event) => state.setName(event.target.value)} className={FIELD_CLASS} />
      </label>
      {state.service === 'other' ? (
        <label className="block text-sm">{t('providerConnect.endpoint')}
          <input data-testid="provider-connect-endpoint" value={state.endpoint} disabled={pending}
            onChange={(event) => state.handleEndpointChange(event.target.value)} className={FIELD_CLASS} />
        </label>
      ) : null}
      <label className="block text-sm">{t('providerConnect.secret')}
        <input data-testid="provider-connect-secret" type="password" autoComplete="off" value={state.secret}
          disabled={pending} onChange={(event) => state.handleSecretChange(event.target.value)} className={FIELD_CLASS} />
      </label>
      <div>
        <Button type="button" tone="secondary" size="sm" data-testid="provider-connect-load-models"
          disabled={pending || state.loadingModels || !state.secret.trim() || !state.endpoint.trim()}
          onClick={() => void state.loadModels()}>
          {state.loadingModels ? t('providerConnect.loadingModels') : t('providerConnect.loadModels')}
        </Button>
      </div>
      {state.modelListErrorReason ? (
        <p data-testid="provider-connect-model-list-error" role="alert" className="text-sm text-danger-text">
          {t(`providerConnect.modelListError.${state.modelListErrorReason}`)}
        </p>
      ) : null}
      {state.modelOptions?.length === 0 ? (
        <p data-testid="provider-connect-model-list-empty" role="status" className="text-sm text-fg-muted">
          {t('providerConnect.modelListEmpty')}
        </p>
      ) : state.modelOptions !== null ? (
        <label className="block text-sm">{t('providerConnect.model')}
          <select data-testid="provider-connect-model-select" value={state.model} disabled={pending}
            onChange={(event) => state.setModel(event.target.value)} className={FIELD_CLASS}>
            {state.modelOptions.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>
      ) : state.manualModel ? (
        <label className="block text-sm">{t('providerConnect.model')}
          <input data-testid="provider-connect-model" value={state.model} disabled={pending}
            onChange={(event) => state.setModel(event.target.value)} className={FIELD_CLASS} />
        </label>
      ) : null}
      <div className="flex justify-end">
        <Button type="button" tone="primary" size="sm" data-testid="provider-connect-submit"
          disabled={pending || state.registered || !state.canSubmitApi} onClick={state.submitApi}>
          {t('providerConnect.add')}
        </Button>
      </div>
    </div>
  );
}

export function ApiSection({ state, ready }: ApiSectionProps): ReactElement {
  const { t } = useTranslation();
  return (
    <section data-testid="provider-connect-api" className="flex flex-col gap-2.5">
      <h3 className="text-preview font-semibold">{t('providerConnect.api.title')}</h3>
      <div role="group" aria-label={t('providerConnect.api.title')} className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {API_SERVICE_CHOICES.map((choice) => (
          <button key={choice} type="button" data-testid={`provider-connect-service-${choice}`}
            aria-pressed={state.service === choice} disabled={!ready || state.pending}
            onClick={() => state.selectService(choice)}
            className={clsx('flex flex-col items-start gap-0.5 border px-3 py-2.5 text-left disabled:opacity-60 [clip-path:var(--clip-control)]',
              state.service === choice
                ? 'border-brand bg-project-item-active-bg'
                : 'border-border-soft [background:var(--color-panel-bg)] hover:border-border')}>
            <span className="text-sm font-semibold">{t(`providerConnect.service.${choice}.name`)}</span>
            <span className="text-xs text-fg-muted">{t(`providerConnect.service.${choice}.vendor`)}</span>
          </button>
        ))}
      </div>
      {state.service !== null ? <ApiForm state={state} /> : null}
    </section>
  );
}
