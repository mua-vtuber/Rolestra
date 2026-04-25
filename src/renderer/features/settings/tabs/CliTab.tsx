/**
 * CliTab — R10-Task6 CLI provider roster + detection.
 *
 * Splits the providers from `provider:list` into CLI / API / Local
 * groups and renders each CLI provider as a removable row. Below the
 * list, `provider:detect-cli` is rendered as a one-shot probe so users
 * can confirm which CLI binaries the bootstrap auto-detected on launch
 * (Claude/Codex/Gemini × native vs. WSL).
 *
 * Adding a new CLI provider goes through `provider:add` — the entry
 * point is the existing project create modal in v3 (provider creation
 * is bundled with onboarding). A standalone "add CLI" wizard is
 * deferred to R11 onboarding redesign.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import { useTranslation } from 'react-i18next';

import { invoke } from '../../../ipc/invoke';
import { Button } from '../../../components/primitives/button';
import type { ProviderInfo } from '../../../../shared/provider-types';
import type { DetectedCli } from '../../../../shared/ipc-types';

export function CliTab(): ReactElement {
  const { t } = useTranslation();
  const [providers, setProviders] = useState<ProviderInfo[] | null>(null);
  const [detected, setDetected] = useState<DetectedCli[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [detecting, setDetecting] = useState<boolean>(false);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const { providers: list } = await invoke('provider:list', undefined);
      setProviders(list);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, []);

  const didMountFetchRef = useRef(false);
  useEffect(() => {
    if (didMountFetchRef.current) return;
    didMountFetchRef.current = true;
    void refresh();
  }, [refresh]);

  const handleRemove = async (id: string): Promise<void> => {
    setPendingId(id);
    try {
      await invoke('provider:remove', { id });
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setPendingId(null);
    }
  };

  const handleDetect = async (): Promise<void> => {
    setDetecting(true);
    setError(null);
    try {
      const { detected: list } = await invoke(
        'provider:detect-cli',
        undefined,
      );
      setDetected(list);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setDetecting(false);
    }
  };

  const cliProviders =
    providers?.filter((p) => p.type === 'cli') ?? null;

  return (
    <section
      data-testid="settings-tab-cli"
      className="space-y-4 max-w-2xl"
    >
      <header>
        <h2 className="text-sm font-display font-semibold">
          {t('settings.cli.title')}
        </h2>
        <p className="text-xs text-fg-muted mt-0.5">
          {t('settings.cli.description')}
        </p>
      </header>

      {error !== null && (
        <div
          role="alert"
          data-testid="settings-cli-error"
          className="text-xs text-danger border border-danger rounded-panel px-2 py-1 bg-sunk"
        >
          {error}
        </div>
      )}

      <div className="space-y-2">
        <h3 className="text-xs font-medium text-fg-muted">
          {t('settings.cli.registered.label')}
        </h3>
        {cliProviders === null ? (
          <p
            data-testid="settings-cli-loading"
            className="text-sm text-fg-muted italic"
          >
            {t('settings.cli.loading')}
          </p>
        ) : cliProviders.length === 0 ? (
          <p
            data-testid="settings-cli-empty"
            className="text-sm text-fg-muted italic"
          >
            {t('settings.cli.empty')}
          </p>
        ) : (
          <ul
            data-testid="settings-cli-list"
            className="space-y-1"
          >
            {cliProviders.map((provider) => (
              <li
                key={provider.id}
                data-testid="settings-cli-row"
                data-provider-id={provider.id}
                className="flex items-center gap-3 px-2 py-2 border border-border-soft rounded-panel bg-sunk"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">
                    {provider.displayName}
                  </div>
                  <div className="text-xs text-fg-muted truncate font-mono">
                    {provider.model} · {provider.status}
                  </div>
                </div>
                <Button
                  type="button"
                  tone="danger"
                  size="sm"
                  data-testid="settings-cli-remove"
                  disabled={pendingId === provider.id}
                  onClick={() => {
                    void handleRemove(provider.id);
                  }}
                >
                  {t('settings.cli.remove')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-2 border-t border-border-soft pt-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-xs font-medium text-fg-muted">
            {t('settings.cli.detect.label')}
          </h3>
          <Button
            type="button"
            tone="secondary"
            size="sm"
            data-testid="settings-cli-detect"
            disabled={detecting}
            onClick={() => {
              void handleDetect();
            }}
          >
            {detecting
              ? t('settings.cli.detect.running')
              : t('settings.cli.detect.run')}
          </Button>
        </div>
        {detected !== null && (
          <ul
            data-testid="settings-cli-detected-list"
            className="space-y-1 text-xs"
          >
            {detected.length === 0 ? (
              <li
                data-testid="settings-cli-detected-empty"
                className="text-fg-muted italic"
              >
                {t('settings.cli.detect.empty')}
              </li>
            ) : (
              detected.map((entry, idx) => (
                <li
                  key={`${entry.command}-${idx}`}
                  data-testid="settings-cli-detected-row"
                  data-command={entry.command}
                  className="font-mono px-2 py-1 border border-border-soft rounded-panel bg-elev"
                >
                  <span className="text-fg">{entry.displayName}</span>
                  <span className="text-fg-muted ml-2">{entry.path}</span>
                  {entry.wslDistro !== undefined && (
                    <span className="text-fg-subtle ml-2">
                      [WSL: {entry.wslDistro}]
                    </span>
                  )}
                </li>
              ))
            )}
          </ul>
        )}
      </div>
    </section>
  );
}
