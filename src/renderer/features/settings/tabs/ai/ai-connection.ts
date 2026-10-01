/**
 * How the settings AI tab describes each registered AI (spec
 * 2026-10-01-messenger-redesign.md R5-5): a one-line connection
 * ("Claude Code · CLI", "gemini-2.5-flash · API (Google)",
 * "gemma4:e4b · 로컬 (localhost:11434)") and a status with, when the AI is
 * not reachable, a hint at where to look plus whether "다시 연결" applies.
 *
 * Everything shown comes from the stored provider config, the live work
 * status and the cause of the last failed connection check. The local line says "로컬 (Ollama)" only when main confirmed the
 * server as Ollama while adding it (`LocalProviderConfig.confirmedServer`,
 * set by `provider:add-local` after Ollama's own `/api/version` answered);
 * otherwise it names the server address — a local provider talks to any
 * OpenAI-compatible server, so without that evidence the address is the
 * fact the app actually has (2026-10-01 user decision).
 */
import type { TFunction } from 'i18next';

import { serviceIdForEndpoint } from '../../../../../shared/api-service-catalog';
import { cliCommandKey } from '../../../../../shared/cli-command-key';
import type { ConnectionFailure } from '../../../../../shared/connection-failure-types';
import type { WorkStatus } from '../../../../../shared/member-profile-types';
import type { ProviderConfig } from '../../../../../shared/provider-types';

/** `host[:port]` of a stored URL; the stored text itself when it is not a URL. */
export function addressOf(url: string): string {
  try {
    const host = new URL(url).host;
    return host.length > 0 ? host : url;
  } catch {
    return url;
  }
}

/** Product name of a known chat CLI, else the command's own name. */
export function cliDisplayName(t: TFunction, command: string): string {
  const key = cliCommandKey(command);
  switch (key) {
    case 'claude': return t('settings.ai.cli.claude');
    case 'codex': return t('settings.ai.cli.codex');
    default: return key;
  }
}

/** Company behind an official API endpoint, else the endpoint's address. */
export function apiServiceName(t: TFunction, endpoint: string): string {
  switch (serviceIdForEndpoint(endpoint)) {
    case 'anthropic': return t('settings.ai.apiService.anthropic');
    case 'openai': return t('settings.ai.apiService.openai');
    case 'google': return t('settings.ai.apiService.google');
    case null: return addressOf(endpoint);
  }
}

export function describeConnection(t: TFunction, config: ProviderConfig): string {
  switch (config.type) {
    case 'cli': {
      const name = cliDisplayName(t, config.command);
      return config.wslDistro === undefined
        ? t('settings.ai.connection.cli', { name })
        : t('settings.ai.connection.cliWsl', { name, distro: config.wslDistro });
    }
    case 'api':
      return t('settings.ai.connection.api', {
        model: config.model, service: apiServiceName(t, config.endpoint),
      });
    case 'local':
      return config.confirmedServer === 'ollama'
        ? t('settings.ai.connection.localOllama', { model: config.model })
        : t('settings.ai.connection.local', { model: config.model, address: addressOf(config.baseUrl) });
  }
}

export type AiStatusTone = 'ok' | 'pending' | 'problem';

export interface AiStatusView {
  label: string;
  tone: AiStatusTone;
  /** Why the AI is not connected; null when there is nothing to fix. */
  hint: string | null;
  /** Offer "다시 연결" (`member:reconnect`). */
  canReconnect: boolean;
}

/** The CLI's product name for CLI causes; a generic word while the config is not known. */
function cliName(t: TFunction, config: ProviderConfig | null): string {
  return config?.type === 'cli' ? cliDisplayName(t, config.command) : t('settings.ai.cause.cliGeneric');
}

function causeSentence(t: TFunction, config: ProviderConfig | null, failure: ConnectionFailure): string {
  switch (failure.code) {
    case 'key-missing': return t('settings.ai.cause.keyMissing');
    case 'auth': return t('settings.ai.cause.auth');
    case 'http-error': return t('settings.ai.cause.httpError');
    case 'network': return t('settings.ai.cause.network');
    case 'timeout': return t('settings.ai.cause.timeout');
    case 'cli-not-found': return t('settings.ai.cause.cliNotFound', { name: cliName(t, config) });
    case 'cli-failed': return t('settings.ai.cause.cliFailed', { name: cliName(t, config) });
    case 'local-not-running': return t('settings.ai.cause.localNotRunning');
    case 'local-not-ollama': return t('settings.ai.cause.localNotOllama');
    case 'local-bad-model-list': return t('settings.ai.cause.localBadModelList');
    case 'local-no-models': return t('settings.ai.cause.localNoModels');
    case 'local-model-missing': return t('settings.ai.cause.localModelMissing', { model: failure.detail ?? '' });
    case 'local-invalid-endpoint': return t('settings.ai.cause.localInvalidEndpoint');
    case 'probe-failed': return t('settings.ai.cause.probeFailed');
  }
}

/** The translated cause, with its technical detail (`HTTP 401`, `ECONNREFUSED`) when there is one. */
function causeText(t: TFunction, config: ProviderConfig | null, failure: ConnectionFailure): string {
  const sentence = causeSentence(t, config, failure);
  const showDetail = failure.detail !== null && failure.code !== 'local-model-missing';
  return showDetail ? `${sentence} ${t('settings.ai.cause.detail', { detail: failure.detail })}` : sentence;
}

/**
 * The status line and, when the AI is not connected, the cause main's last
 * check found (QA Medium-1, `MemberView.connectionFailure`). With no
 * check recorded yet the hint says so instead of guessing. `config` is
 * null only while the connection data has not arrived.
 */
export function describeStatus(
  t: TFunction,
  status: WorkStatus,
  config: ProviderConfig | null,
  failure: ConnectionFailure | null,
): AiStatusView {
  switch (status) {
    case 'online':
      return { label: t('settings.ai.status.online'), tone: 'ok', hint: null, canReconnect: false };
    case 'connecting':
      return { label: t('settings.ai.status.connecting'), tone: 'pending', hint: null, canReconnect: false };
    case 'offline-connection':
      return {
        label: t('settings.ai.status.offlineConnection'),
        tone: 'problem',
        hint: failure === null ? t('settings.ai.cause.notChecked') : causeText(t, config, failure),
        canReconnect: true,
      };
    case 'offline-manual':
      return { label: t('settings.ai.status.offlineManual'), tone: 'problem', hint: null, canReconnect: true };
  }
}
