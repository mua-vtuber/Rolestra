/**
 * The form of the safeStorage key names this app creates for API keys:
 * `provider-<uuid>` (a fresh `crypto.randomUUID()` per attempt). The
 * renderer makes new refs with it (`settings/api-key-ref.ts`); main's
 * startup cleanup (`providers/orphan-api-keys.ts`) only ever deletes keys
 * of exactly this form, so secrets stored under any other name are never
 * touched.
 */
export const API_KEY_REF_PREFIX = 'provider-';

const APP_API_KEY_REF_PATTERN = /^provider-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isAppApiKeyRef(key: string): boolean {
  return APP_API_KEY_REF_PATTERN.test(key);
}
