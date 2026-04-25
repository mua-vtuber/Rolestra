/**
 * ApiKeysTab — R10-Task6 secrets registry view.
 *
 * Lists every key that is currently stored via `safeStorage` (the
 * Main-side `config:list-secret-keys` returns just the keys — values
 * never cross the IPC boundary). Each row offers a "삭제" button that
 * calls `config:delete-secret`.
 *
 * Adding a new key requires picking a provider and entering the secret
 * value. R10 keeps that flow inside the existing CLI / project create
 * modals (provider:add accepts the secret inline); this tab is the
 * read + delete surface only — a full add UX would duplicate the
 * provider create modal which already owns secret entry.
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

export function ApiKeysTab(): ReactElement {
  const { t } = useTranslation();
  const [keys, setKeys] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const { keys: list } = await invoke(
        'config:list-secret-keys',
        undefined,
      );
      setKeys(list);
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

  const handleDelete = async (key: string): Promise<void> => {
    setPendingKey(key);
    try {
      await invoke('config:delete-secret', { key });
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setPendingKey(null);
    }
  };

  return (
    <section
      data-testid="settings-tab-api-keys"
      className="space-y-3 max-w-2xl"
    >
      <header>
        <h2 className="text-sm font-display font-semibold">
          {t('settings.apiKeys.title')}
        </h2>
        <p className="text-xs text-fg-muted mt-0.5">
          {t('settings.apiKeys.description')}
        </p>
      </header>

      {error !== null && (
        <div
          role="alert"
          data-testid="settings-api-keys-error"
          className="text-xs text-danger border border-danger rounded-panel px-2 py-1 bg-sunk"
        >
          {error}
        </div>
      )}

      {keys === null ? (
        <p
          data-testid="settings-api-keys-loading"
          className="text-sm text-fg-muted italic"
        >
          {t('settings.apiKeys.loading')}
        </p>
      ) : keys.length === 0 ? (
        <p
          data-testid="settings-api-keys-empty"
          className="text-sm text-fg-muted italic"
        >
          {t('settings.apiKeys.empty')}
        </p>
      ) : (
        <ul
          data-testid="settings-api-keys-list"
          className="space-y-1"
        >
          {keys.map((key) => (
            <li
              key={key}
              data-testid="settings-api-keys-row"
              data-key={key}
              className="flex items-center gap-3 px-2 py-2 border border-border-soft rounded-panel bg-sunk"
            >
              <span className="flex-1 font-mono text-xs truncate">
                {key}
              </span>
              <span className="font-mono text-xs text-fg-muted">
                {t('settings.apiKeys.maskedValue')}
              </span>
              <Button
                type="button"
                tone="danger"
                size="sm"
                data-testid="settings-api-keys-delete"
                disabled={pendingKey === key}
                onClick={() => {
                  void handleDelete(key);
                }}
              >
                {t('settings.apiKeys.delete')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
