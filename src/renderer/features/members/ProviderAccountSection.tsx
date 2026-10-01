/**
 * Connection controls inside an AI's edit dialog (spec
 * 2026-10-01-messenger-redesign.md R5-5/R5-6): replace an API AI's key, and
 * delete the AI.
 *
 * Key replacement: the new key is stored under a fresh ref with
 * `config:set-secret`, then `provider:replace-api-key` points the AI at it
 * (only the ref crosses IPC). If that switch fails, this attempt's new
 * secret is deleted again; the old key is untouched. Main deletes the old
 * key unless another AI shares it, and reports if that delete failed.
 *
 * Delete: asks once, then `provider:remove` deletes the AI and — unless
 * another AI shares it — its stored key. A key that could not be deleted
 * is reported through the app's error toast because this dialog closes
 * with the AI gone.
 */
import { useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../components/primitives/button';
import { notifyError } from '../../components/ErrorBoundary';
import { notifyChannelsChanged } from '../../hooks/channel-invalidation-bus';
import { useProviders } from '../../hooks/use-providers';
import { invoke } from '../../ipc/invoke';
import { newApiKeyRef } from '../settings/api-key-ref';
import type { ApiKeyCleanup } from '../../../shared/provider-types';

function messageOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

type KeyResult =
  | { kind: 'replaced'; cleanup: ApiKeyCleanup }
  | { kind: 'error'; message: string };

function ApiKeyReplace({ providerId }: { providerId: string }): ReactElement {
  const { t } = useTranslation();
  const [secret, setSecret] = useState('');
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<KeyResult | null>(null);

  const replace = async (): Promise<void> => {
    const value = secret.trim();
    if (value.length === 0) return;
    setPending(true);
    setResult(null);
    const ref = newApiKeyRef();
    try {
      await invoke('config:set-secret', { key: ref, value });
    } catch (reason) {
      setResult({ kind: 'error', message: t('profile.editor.apiKey.storeFailed', { message: messageOf(reason) }) });
      setPending(false);
      return;
    }
    let previousKeyCleanup: ApiKeyCleanup;
    try {
      ({ previousKeyCleanup } = await invoke('provider:replace-api-key', { id: providerId, apiKeyRef: ref }));
    } catch (reason) {
      // main did not switch the AI, so this attempt's new key is unused.
      let message = t('profile.editor.apiKey.replaceFailed', { message: messageOf(reason) });
      try {
        await invoke('config:delete-secret', { key: ref });
      } catch (cleanupReason) {
        message = t('profile.editor.apiKey.replaceAndCleanupFailed', {
          message: messageOf(reason), cleanup: messageOf(cleanupReason),
        });
      }
      setResult({ kind: 'error', message });
      setPending(false);
      return;
    }
    // The AI now uses the new key: nothing after this point may delete it
    // (QA Minor 4). A failed screen refresh is only reported.
    setSecret('');
    setResult({ kind: 'replaced', cleanup: previousKeyCleanup });
    setPending(false);
    try {
      await notifyChannelsChanged();
    } catch (reason) {
      notifyError(t('profile.editor.apiKey.refreshFailed', { message: messageOf(reason) }));
    }
  };

  return (
    <div className="space-y-2">
      <label className="block text-sm">{t('profile.editor.apiKey.label')}
        <input data-testid="profile-editor-api-key-input" type="password" autoComplete="off"
          value={secret} disabled={pending}
          onChange={(event) => { setSecret(event.target.value); setResult(null); }}
          className="mt-1 w-full rounded-panel border border-border bg-sunk px-3 py-2" />
      </label>
      <p className="text-xs text-fg-muted">{t('profile.editor.apiKey.hint')}</p>
      <Button type="button" tone="secondary" size="sm" data-testid="profile-editor-api-key-replace"
        disabled={pending || secret.trim().length === 0} onClick={() => void replace()}>
        {pending ? t('profile.editor.apiKey.replacing') : t('profile.editor.apiKey.replace')}
      </Button>
      {result?.kind === 'replaced' ? (
        <p data-testid="profile-editor-api-key-replaced" role="status" className="text-xs text-success">
          {t('profile.editor.apiKey.replaced')}
        </p>
      ) : null}
      {result?.kind === 'replaced' && result.cleanup.status === 'failed' ? (
        <p data-testid="profile-editor-api-key-cleanup-failed" role="alert" className="text-xs text-warning">
          {t('profile.editor.apiKey.oldKeyCleanupFailed', { message: result.cleanup.message })}
        </p>
      ) : null}
      {result?.kind === 'error' ? (
        <p data-testid="profile-editor-api-key-error" role="alert" className="text-xs text-danger-text">
          {result.message}
        </p>
      ) : null}
    </div>
  );
}

function DeleteAi({ providerId, displayName, onDeleted }: {
  providerId: string;
  displayName: string;
  onDeleted: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = async (): Promise<void> => {
    setPending(true);
    setError(null);
    try {
      const { apiKeyCleanup } = await invoke('provider:remove', { id: providerId });
      if (apiKeyCleanup?.status === 'failed') {
        notifyError(t('profile.editor.delete.keyCleanupFailed', { name: displayName, message: apiKeyCleanup.message }));
      }
    } catch (reason) {
      setError(t('profile.editor.delete.failed', { message: messageOf(reason) }));
      setPending(false);
      return;
    }
    onDeleted();
    await notifyChannelsChanged();
  };

  if (!confirming) {
    return (
      <Button type="button" tone="danger" size="sm" data-testid="profile-editor-delete"
        onClick={() => setConfirming(true)}>
        {t('profile.editor.delete.button')}
      </Button>
    );
  }
  return (
    <div data-testid="profile-editor-delete-confirm-box" className="space-y-2">
      <p className="text-sm">{t('profile.editor.delete.confirm', { name: displayName })}</p>
      <div className="flex gap-2">
        <Button type="button" tone="danger" size="sm" data-testid="profile-editor-delete-confirm"
          disabled={pending} onClick={() => void remove()}>
          {t('profile.editor.delete.confirmButton')}
        </Button>
        <Button type="button" tone="ghost" size="sm" data-testid="profile-editor-delete-cancel"
          disabled={pending} onClick={() => setConfirming(false)}>
          {t('profile.editor.cancel')}
        </Button>
      </div>
      {error !== null ? (
        <p data-testid="profile-editor-delete-error" role="alert" className="text-xs text-danger-text">{error}</p>
      ) : null}
    </div>
  );
}

export function ProviderAccountSection({ providerId, displayName, onDeleted }: {
  providerId: string;
  displayName: string;
  /** Called once the AI is deleted (the dialog closes). */
  onDeleted: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const { providers, error } = useProviders();
  const provider = providers?.find((p) => p.id === providerId) ?? null;

  return (
    <section data-testid="profile-editor-account" className="space-y-3 border-t border-border-soft pt-4">
      <h3 className="text-sm font-semibold text-fg-muted">{t('profile.editor.account.title')}</h3>
      {error !== null ? (
        <p data-testid="profile-editor-account-error" role="alert" className="text-xs text-danger-text">
          {t('profile.editor.account.loadFailed', { message: error.message })}
        </p>
      ) : null}
      {provider?.config.type === 'api' ? <ApiKeyReplace providerId={providerId} /> : null}
      <DeleteAi providerId={providerId} displayName={displayName} onDeleted={onDeleted} />
    </section>
  );
}
