import { cliCommandKey, isSupportedChatCliKey } from '../../shared/cli-command-key';
import type { ChatErrorCode } from '../../shared/message-types';
import type { ProviderFailureCause } from '../../shared/provider-failure-types';
import type { ProviderConfig } from '../../shared/provider-types';
import { ProviderCallError } from '../providers/provider-call-error';
import { chatErrorCodeFor } from './chat-whisper-output';

/** What failed (the notice code) and, when known, why (spec 2026-10-08 F3). */
export interface ChatFailure {
  code: ChatErrorCode;
  cause: ProviderFailureCause | null;
  causeDetail: string | null;
}

const CLI_CAUSES: ReadonlySet<ProviderFailureCause> = new Set(['cli-login-required', 'cli-not-found', 'cli-failed']);

/** The supported CLI's command key from the provider's own config, never from CLI output. */
function cliDetail(config: ProviderConfig | null): string | null {
  if (config?.type !== 'cli') return null;
  const key = cliCommandKey(config.command);
  return isSupportedChatCliKey(key) ? key : null;
}

/**
 * Turns one failure into its notice code and cause. A cause is attached only
 * to `provider_error` from a {@link ProviderCallError}; anything else keeps
 * no cause and the general sentence. A CLI cause's detail comes from the
 * provider config: the supported CLI key, or null.
 */
export function describeChatFailure(error: unknown, timedOut: boolean,
  providerConfig: ProviderConfig | null): ChatFailure {
  const code = chatErrorCodeFor(error, timedOut);
  if (code !== 'provider_error' || !(error instanceof ProviderCallError)) {
    return { code, cause: null, causeDetail: null };
  }
  const cause = error.failureCause;
  return {
    code,
    cause,
    causeDetail: CLI_CAUSES.has(cause) ? cliDetail(providerConfig) : error.failureDetail,
  };
}
