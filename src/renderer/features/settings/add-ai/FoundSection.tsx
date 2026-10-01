/**
 * "이 컴퓨터에서 찾은 AI" (spec 2026-10-01-messenger-redesign.md R6-1..R6-3):
 * detected chat CLIs with "추가" / "추가됨", the local Ollama card, and
 * "다시 찾기", which runs both checks again.
 */
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../../components/primitives/button';
import { cliDisplayName } from '../tabs/ai/ai-connection';
import type { DetectedCli } from '../../../../shared/ipc-types';
import type { ProviderInfo } from '../../../../shared/provider-types';
import { isCliRegistered } from './add-ai-model';
import { LocalAiCard } from './LocalAiCard';
import type { AiDetection } from './use-ai-detection';

/** One-letter marks of the chat CLIs, as in the AddAI mockup. */
const CLI_MARKS: Readonly<Record<string, string>> = { claude: 'C', codex: 'X' };

export interface FoundSectionProps {
  detection: AiDetection;
  /** Registered AIs; null until known — nothing can be added before that. */
  providers: readonly ProviderInfo[] | null;
  busy: boolean;
  onAddCli: (cli: DetectedCli) => void;
  onAddLocal: (model: string) => void;
}

function CliRow({ cli, registered, canAdd, onAdd }: {
  cli: DetectedCli; registered: boolean; canAdd: boolean; onAdd: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const product = cliDisplayName(t, cli.command);
  const name = cli.wslDistro === undefined ? product : t('providerConnect.cli.wslName', { name: product, distro: cli.wslDistro });
  return (
    <div data-testid="provider-connect-found-cli" data-command={cli.command}
      className="flex items-center gap-3 border border-border-soft px-3.5 py-3 [background:var(--color-panel-bg)] [clip-path:var(--clip-control)]">
      <span aria-hidden="true"
        className="flex h-9 w-9 shrink-0 items-center justify-center border border-border-soft bg-sunk font-mono font-bold text-brand-text [clip-path:var(--clip-control)]">
        {CLI_MARKS[cli.command] ?? product.charAt(0)}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-semibold">{name}</span>
        <span className="truncate text-xs text-fg-muted">
          {cli.version === undefined ? t('providerConnect.cli.detail') : t('providerConnect.cli.detailVersion', { version: cli.version })}
        </span>
      </span>
      {registered ? (
        <span data-testid={`provider-connect-cli-added-${cli.command}`} className="shrink-0 text-xs text-fg-muted">
          {t('providerConnect.cli.added')}
        </span>
      ) : (
        <Button type="button" tone="secondary" size="sm" data-testid={`provider-connect-cli-${cli.command}`}
          disabled={!canAdd} onClick={onAdd}>
          {t('providerConnect.cli.add')}
        </Button>
      )}
    </div>
  );
}

export function FoundSection({ detection, providers, busy, onAddCli, onAddLocal }: FoundSectionProps): ReactElement {
  const { t } = useTranslation();
  const canAdd = providers !== null && !busy;
  const { cli } = detection;
  return (
    <section data-testid="provider-connect-found" className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-preview font-semibold">{t('providerConnect.found.title')}</h3>
        <Button type="button" tone="ghost" size="sm" data-testid="provider-connect-rescan"
          disabled={detection.rescanning} onClick={detection.rescan}>
          {detection.rescanning ? t('providerConnect.found.rescanning') : t('providerConnect.found.rescan')}
        </Button>
      </div>
      {cli.phase === 'loading' ? <p className="text-sm text-fg-muted">{t('providerConnect.detecting')}</p> : null}
      {cli.phase === 'failed' ? (
        <p data-testid="provider-connect-cli-error" role="alert" className="text-sm text-danger-text">
          {t('providerConnect.detectFailed', { message: cli.message })}
        </p>
      ) : null}
      {cli.phase === 'done' && cli.value.length === 0 ? (
        <p data-testid="provider-connect-no-cli" className="text-sm text-fg-muted">{t('providerConnect.noCli')}</p>
      ) : null}
      {cli.phase === 'done' ? cli.value.map((found) => (
        <CliRow key={`${found.command}:${found.wslDistro ?? ''}`} cli={found}
          registered={providers !== null && isCliRegistered(found, providers)}
          canAdd={canAdd} onAdd={() => onAddCli(found)} />
      )) : null}
      <LocalAiCard state={detection.local} canAdd={canAdd} onAdd={onAddLocal} />
    </section>
  );
}
