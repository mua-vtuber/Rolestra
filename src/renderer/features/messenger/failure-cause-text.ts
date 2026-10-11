/**
 * The sentence for a failure cause (spec 2026-10-08 F3): what went wrong and
 * what the user can do about it. Main stores only the cause code and a short
 * marker (`meta.chatErrorCause` / `chatErrorCauseDetail`, or a vote
 * participant's `errorCause` / `errorDetail`). Every key is a static `t()`
 * call so i18next-parser finds it.
 *
 * Markers (`HTTP 503`, `ENOTFOUND`) follow the sentence as "(원인: …)"; names
 * (the CLI, the local model) go inside it. A CLI name comes from the stored
 * CLI key; an unknown key reads as the generic "CLI".
 */
import type { TFunction } from 'i18next';

import { CLI_LOGIN_COMMANDS, isSupportedChatCliKey } from '../../../shared/cli-command-key';
import type { ProviderFailureCause } from '../../../shared/provider-failure-types';
import { cliDisplayName } from '../settings/tabs/ai/ai-connection';

function withMarker(t: TFunction, message: string, detail: string | null): string {
  return detail ? t('messenger.whisper.errorWithDetail', { message, detail }) : message;
}

function cliName(t: TFunction, detail: string | null): string {
  return detail !== null && isSupportedChatCliKey(detail)
    ? cliDisplayName(t, detail) : t('messenger.failureCause.cliGeneric');
}

export function failureCauseText(t: TFunction, cause: ProviderFailureCause, detail: string | null): string {
  switch (cause) {
    case 'key-missing': return t('messenger.failureCause.keyMissing');
    case 'auth': return withMarker(t, t('messenger.failureCause.auth'), detail);
    case 'cli-login-required':
      return detail !== null && isSupportedChatCliKey(detail)
        ? t('messenger.failureCause.cliLoginRequired', {
          cli: cliDisplayName(t, detail), command: CLI_LOGIN_COMMANDS[detail],
        })
        : t('messenger.failureCause.cliLoginRequiredNoCommand', { cli: cliName(t, detail) });
    case 'rate-limited': return withMarker(t, t('messenger.failureCause.rateLimited'), detail);
    case 'service-busy': return withMarker(t, t('messenger.failureCause.serviceBusy'), detail);
    case 'request-rejected': return withMarker(t, t('messenger.failureCause.requestRejected'), detail);
    case 'http-error': return withMarker(t, t('messenger.failureCause.httpError'), detail);
    case 'network': return withMarker(t, t('messenger.failureCause.network'), detail);
    case 'local-not-running': return t('messenger.failureCause.localNotRunning');
    case 'local-model-missing': return t('messenger.failureCause.localModelMissing', { model: detail ?? '' });
    case 'cli-not-found': return t('messenger.failureCause.cliNotFound', { cli: cliName(t, detail) });
    case 'cli-failed': return t('messenger.failureCause.cliFailed', { cli: cliName(t, detail) });
  }
}
