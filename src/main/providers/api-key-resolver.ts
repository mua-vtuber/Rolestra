import { getConfigService } from '../config/instance';
import { ApiKeyMissingError } from './provider-call-error';

/**
 * Returns the stored API key for `ref`. A missing key throws
 * {@link ApiKeyMissingError}, whose message names the reference only — never
 * a key value (spec 2026-10-08 F3: the chat notice then says the key is not
 * stored).
 */
export async function resolveStoredApiKey(ref: string): Promise<string> {
  const secret = getConfigService().getSecret(ref);
  if (!secret) throw new ApiKeyMissingError(`API key not found: ${ref}`);
  return secret;
}
