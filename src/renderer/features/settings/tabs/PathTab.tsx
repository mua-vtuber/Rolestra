/**
 * PathTab — R10-Task6 ArenaRoot path display + change banner.
 *
 * `arena-root` is the on-disk directory that holds avatars, attached
 * files, consensus output, etc. v3 owners can pick a custom path on
 * first launch (via `arena-root:set`). This tab surfaces the *current*
 * absolute path so users can verify it; an in-place picker is deferred
 * to R11 because changing the path mid-session needs a full restart
 * and the consequent cache flushing belongs in onboarding.
 *
 * The "변경" affordance is a placeholder button that surfaces a banner
 * explaining the restart requirement — clicking it does NOT mutate
 * state today (R10 limitation). The plan defers the real picker until
 * Task 14 / R11 onboarding.
 */
import {
  useEffect,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import { useTranslation } from 'react-i18next';

import { invoke } from '../../../ipc/invoke';
import { Button } from '../../../components/primitives/button';

export function PathTab(): ReactElement {
  const { t } = useTranslation();
  const [arenaRoot, setArenaRoot] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showRestartHint, setShowRestartHint] = useState<boolean>(false);

  const didMountFetchRef = useRef(false);
  useEffect(() => {
    if (didMountFetchRef.current) return;
    didMountFetchRef.current = true;
    let cancelled = false;
    void (async () => {
      try {
        const { path } = await invoke('arena-root:get', undefined);
        if (!cancelled) setArenaRoot(path);
      } catch (reason) {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section
      data-testid="settings-tab-path"
      className="space-y-4 max-w-2xl"
    >
      <header>
        <h2 className="text-sm font-display font-semibold">
          {t('settings.path.title')}
        </h2>
        <p className="text-xs text-fg-muted mt-0.5">
          {t('settings.path.description')}
        </p>
      </header>

      {error !== null && (
        <div
          role="alert"
          data-testid="settings-path-error"
          className="text-xs text-danger border border-danger rounded-panel px-2 py-1 bg-sunk"
        >
          {error}
        </div>
      )}

      <div className="space-y-2">
        <label className="text-xs text-fg-muted">
          {t('settings.path.arenaRoot.label')}
        </label>
        <div
          data-testid="settings-path-arena-root"
          className="font-mono text-xs px-2 py-1.5 border border-border-soft rounded-panel bg-elev break-all"
        >
          {arenaRoot ?? t('settings.path.loading')}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button
          type="button"
          tone="secondary"
          size="sm"
          data-testid="settings-path-change-button"
          onClick={() => setShowRestartHint(true)}
        >
          {t('settings.path.change')}
        </Button>
        <span className="text-xs text-fg-muted">
          {t('settings.path.changeHint')}
        </span>
      </div>

      {showRestartHint && (
        <div
          role="status"
          data-testid="settings-path-restart-banner"
          className="text-xs text-warning border border-warning rounded-panel px-2 py-1.5 bg-sunk"
        >
          {t('settings.path.restartBanner')}
        </div>
      )}
    </section>
  );
}
