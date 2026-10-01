/**
 * Startup cleanup of API keys no AI uses (QA High-2, 2026-10-01).
 *
 * There is no separate API key screen any more, so a key left behind — its
 * AI deleted while the delete of the key failed, or an add attempt whose
 * own cleanup failed — would otherwise stay in safeStorage with no way to
 * find it. At startup main deletes every key that
 *   1. has exactly the app's own form (`provider-<uuid>`,
 *      `shared/api-key-ref.ts`) — any other secret is never touched; and
 *   2. no stored AI row uses (`isApiKeyRefStillReferenced`, the same rule
 *      as deleting an AI: a row whose config cannot be parsed keeps the key
 *      when its text mentions it).
 *
 * If the stored AI rows cannot be read, this throws before deleting
 * anything — without them no key can be judged unused. Each failed delete
 * is returned (by ref, never by value) and the rest carry on. The caller
 * logs the outcome; it never blocks startup.
 */
import { isAppApiKeyRef } from '../../shared/api-key-ref';
import { isApiKeyRefStillReferenced } from './api-key-release';
import type { ProviderRow } from './provider-repository';

export interface OrphanApiKeyDeps {
  /** Names of every stored secret (values are never read). */
  secretKeys: () => string[];
  /** Every stored AI row. */
  rows: () => ProviderRow[];
  deleteSecret: (ref: string) => void;
}

export interface OrphanApiKeyResult {
  removed: string[];
  failed: Array<{ ref: string; message: string }>;
}

export function releaseOrphanApiKeys(deps: OrphanApiKeyDeps): OrphanApiKeyResult {
  const rows = deps.rows();
  const result: OrphanApiKeyResult = { removed: [], failed: [] };
  for (const ref of deps.secretKeys()) {
    if (!isAppApiKeyRef(ref) || isApiKeyRefStillReferenced(ref, rows)) continue;
    try {
      deps.deleteSecret(ref);
      result.removed.push(ref);
    } catch (error) {
      result.failed.push({ ref, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return result;
}
