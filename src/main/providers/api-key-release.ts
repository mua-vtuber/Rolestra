/**
 * Releases an API key ref once its AI no longer needs it (spec
 * 2026-10-01-messenger-redesign.md R5-6): when an AI is deleted or switched
 * to a new key, the old secret is deleted from safeStorage unless another
 * stored AI still points at the same ref.
 *
 * "Still points at" is decided from the provider rows left in the database
 * after the change, which are the source the registry is restored from. A
 * row whose config cannot be parsed keeps the key when its stored text
 * mentions the ref — losing a key that a broken-but-recoverable row needs
 * is worse than keeping one stray secret.
 *
 * The AI change has already been committed when this runs, so a failure is
 * returned as `{ status: 'failed' }` for the caller to report rather than
 * thrown (a throw would read as "the delete/replace failed" and could make
 * the renderer clean up the key the AI now uses).
 */
import type { ApiKeyCleanup } from '../../shared/provider-types';
import type { ProviderRow } from './provider-repository';

export interface ApiKeyReleaseDeps {
  /** Provider rows still stored after the delete / replace. */
  remainingRows: () => ProviderRow[];
  /** Deletes the secret stored under `ref`. */
  deleteSecret: (ref: string) => void;
}

function referencesRef(row: ProviderRow, ref: string): boolean {
  let config: unknown;
  try {
    config = JSON.parse(row.configJson);
  } catch {
    return row.configJson.includes(ref);
  }
  if (config === null || typeof config !== 'object') return false;
  const candidate = config as { type?: unknown; apiKeyRef?: unknown };
  return candidate.type === 'api' && candidate.apiKeyRef === ref;
}

/** True when a stored provider row still uses `ref`. */
export function isApiKeyRefStillReferenced(ref: string, rows: readonly ProviderRow[]): boolean {
  return rows.some((row) => referencesRef(row, ref));
}

export function releaseApiKeyRef(ref: string, deps: ApiKeyReleaseDeps): ApiKeyCleanup {
  try {
    if (isApiKeyRefStillReferenced(ref, deps.remainingRows())) return { status: 'kept-shared' };
    deps.deleteSecret(ref);
    return { status: 'deleted' };
  } catch (error) {
    return { status: 'failed', message: error instanceof Error ? error.message : String(error) };
  }
}
