/**
 * Stored CLI AIs the app no longer runs (B1/B8, `provider:list-inactive-cli`):
 * an unsupported command (e.g. a retired Gemini CLI row) or a config that
 * could not be read. They are not in the live roster, so this list keeps
 * them visible with the reason instead of letting them vanish. Moved here
 * from the former CLI settings tab.
 */
import { useEffect, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import { invoke } from '../../../../ipc/invoke';
import type {
  InactiveCliProviderInfo,
  InactiveCliReason,
} from '../../../../../shared/provider-types';

function reasonText(t: TFunction, reason: InactiveCliReason): string {
  switch (reason) {
    case 'unsupported-command': return t('settings.ai.inactive.reason.unsupportedCommand');
    case 'corrupt-config': return t('settings.ai.inactive.reason.corruptConfig');
  }
}

export function InactiveCliList(): ReactElement | null {
  const { t } = useTranslation();
  const [rows, setRows] = useState<InactiveCliProviderInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    invoke('provider:list-inactive-cli', undefined).then(
      ({ inactive }) => { if (!cancelled) setRows(inactive); },
      (reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      },
    );
    return () => { cancelled = true; };
  }, []);

  if (error !== null) {
    return (
      <p data-testid="settings-ai-inactive-error" role="alert" className="text-xs text-danger-text">
        {t('settings.ai.inactive.loadFailed', { message: error })}
      </p>
    );
  }
  if (rows === null || rows.length === 0) return null;

  return (
    <section data-testid="settings-ai-inactive" className="flex max-w-4xl flex-col gap-2">
      <h3 className="text-preview font-semibold text-fg-muted">{t('settings.ai.inactive.title')}</h3>
      <ul className="flex flex-col gap-2">
        {rows.map((row) => (
          <li key={row.id} data-testid="settings-ai-inactive-row" data-provider-id={row.id}
            className="flex flex-col gap-0.5 border border-border-soft px-4 py-3 text-fg-muted [clip-path:var(--clip-control)]">
            <span className="text-sm font-semibold text-fg">{row.displayName}</span>
            {row.command !== null ? <span className="font-mono text-xs">{row.command}</span> : null}
            <span className="text-xs">{reasonText(t, row.reason)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
