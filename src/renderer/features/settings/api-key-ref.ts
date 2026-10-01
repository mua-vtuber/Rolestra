/**
 * A fresh safeStorage key name for one API key a user enters (AI add, or
 * replacing an AI's key). Each attempt gets its own name, so cleaning up a
 * cancelled or failed attempt can never delete a key another AI uses.
 * The form (`provider-<uuid>`, `shared/api-key-ref.ts`) matches the
 * `config:set-secret` key pattern, is what earlier versions already stored,
 * and is the only form main's startup cleanup of unused keys touches.
 */
import { API_KEY_REF_PREFIX } from '../../../shared/api-key-ref';

export function newApiKeyRef(): string {
  return `${API_KEY_REF_PREFIX}${crypto.randomUUID()}`;
}
