/**
 * The local AI part of "이 컴퓨터에서 찾은 AI" (spec
 * 2026-10-01-messenger-redesign.md R6-3): what main found at the Ollama
 * address it resolved. Running → pick an installed model and "이 모델로
 * 추가". Every other status says why, by cause, with no model list.
 */
import { useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import { Button } from '../../../components/primitives/button';
import { addressOf } from '../tabs/ai/ai-connection';
import type { LocalAiDetection } from '../../../../shared/local-ai-types';
import { OLLAMA_DETECTION_TIMEOUT_MS } from '../../../../shared/timeouts';
import type { DetectionState } from './use-ai-detection';

const MS_PER_SECOND = 1000;

function causeText(t: TFunction, detection: LocalAiDetection): string {
  const address = addressOf(detection.endpoint);
  switch (detection.status) {
    case 'running':
      return t('providerConnect.local.running', { address, count: detection.models.length });
    case 'no-models':
      return t('providerConnect.local.noModels', { address });
    case 'invalid-endpoint':
      return t('providerConnect.local.invalidEndpoint', { address: detection.endpoint });
    case 'not-responding':
      switch (detection.cause) {
        case 'refused': return t('providerConnect.local.refused', { address });
        case 'timeout':
          return t('providerConnect.local.timeout', { address, seconds: OLLAMA_DETECTION_TIMEOUT_MS / MS_PER_SECOND });
        case 'unreachable': return t('providerConnect.local.unreachable', { address });
      }
      break;
    case 'unrecognized':
      switch (detection.cause) {
        case 'http-error': return t('providerConnect.local.httpError', { address });
        case 'not-ollama': return t('providerConnect.local.notOllama', { address });
        case 'bad-model-list': return t('providerConnect.local.badModelList', { address });
      }
  }
}

/** The status line, with the technical detail (`ECONNREFUSED`, `HTTP 404`) when there is one. */
function localStatusLine(t: TFunction, detection: LocalAiDetection): string {
  const text = causeText(t, detection);
  const detail = 'detail' in detection ? detection.detail : null;
  return detail === null ? text : `${text} ${t('providerConnect.local.detail', { detail })}`;
}

export interface LocalAiCardProps {
  state: DetectionState<LocalAiDetection>;
  /** False until adding is possible (AI list loaded, nothing in flight). */
  canAdd: boolean;
  onAdd: (model: string) => void;
}

function ModelPicker({ models, canAdd, onAdd }: { models: string[]; canAdd: boolean; onAdd: (model: string) => void }): ReactElement {
  const { t } = useTranslation();
  const [chosen, setChosen] = useState(models[0] ?? '');
  const selected = models.includes(chosen) ? chosen : (models[0] ?? '');
  return (
    <>
      <fieldset className="flex flex-col gap-1.5 border-t border-border-soft pt-3">
        <legend className="sr-only">{t('providerConnect.local.modelLegend')}</legend>
        {models.map((name) => (
          <label key={name} className="flex items-center gap-2.5 font-mono text-sm">
            <input type="radio" name="ollama-model" data-testid="add-ai-local-model" value={name}
              checked={selected === name} onChange={() => setChosen(name)} className="accent-brand" />
            {name}
          </label>
        ))}
      </fieldset>
      <div className="flex justify-end">
        <Button type="button" tone="primary" size="sm" data-testid="add-ai-local-add"
          disabled={!canAdd || selected === ''} onClick={() => onAdd(selected)}>
          {t('providerConnect.local.addModel')}
        </Button>
      </div>
    </>
  );
}

export function LocalAiCard({ state, canAdd, onAdd }: LocalAiCardProps): ReactElement {
  const { t } = useTranslation();
  const name = t('providerConnect.local.name');

  if (state.phase === 'loading') {
    return <p data-testid="add-ai-local-loading" className="text-sm text-fg-muted">{t('providerConnect.local.checking')}</p>;
  }
  if (state.phase === 'failed') {
    return (
      <p data-testid="add-ai-local-error" role="alert" className="text-sm text-danger-text">
        {t('providerConnect.local.detectFailed', { message: state.message })}
      </p>
    );
  }
  const detection = state.value;
  const running = detection.status === 'running';
  return (
    <div data-testid="add-ai-local" data-status={detection.status}
      className="flex flex-col gap-3 border border-border-soft px-3.5 py-3 [background:var(--color-panel-bg)] [clip-path:var(--clip-control)]">
      <div className="flex items-center gap-3">
        <span aria-hidden="true"
          className="flex h-9 w-9 shrink-0 items-center justify-center border border-border-soft bg-sunk font-mono font-bold text-brand-text [clip-path:var(--clip-control)]">
          {name.charAt(0)}
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="text-sm font-semibold">{name}</span>
          <span data-testid="add-ai-local-status" role={running ? undefined : 'status'}
            className={`text-xs ${running ? 'text-fg-muted' : 'text-warning'}`}>
            {localStatusLine(t, detection)}
          </span>
        </span>
      </div>
      {detection.status === 'running' ? (
        <ModelPicker key={detection.models.join('\n')} models={detection.models} canAdd={canAdd} onAdd={onAdd} />
      ) : null}
    </div>
  );
}
