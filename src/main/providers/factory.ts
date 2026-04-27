/**
 * Provider Factory — creates BaseProvider instances from ProviderConfig.
 *
 * Centralizes provider instantiation. The provider-handler uses this
 * to create provider instances when 'provider:add' is invoked.
 */

import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import type { ProviderConfig, ProviderCapability } from '../../shared/provider-types';
import type { BaseProvider } from './provider-interface';
import { ApiProvider, type ApiKeyResolver } from './api/api-provider';
import { LocalProvider } from './local/local-provider';
import { CliProvider } from './cli/cli-provider';
import { CLAUDE_CLI_CONFIG } from './cli/claude-config';
import { GEMINI_CLI_CONFIG } from './cli/gemini-config';
import { CODEX_CLI_CONFIG } from './cli/codex-config';
import type { CliRuntimeConfig } from './cli/cli-provider';

function getCommandKey(command: string): string {
  return basename(command).toLowerCase().replace(/\.(cmd|exe|bat)$/i, '');
}

/**
 * F1 (cleanup): provider id 단일 진실원. cli-detect-handler 가 반환하는
 * `command` (이미 'claude' 같은 normalized form 이지만 path 가 섞여 들어올
 * 가능성에 견고하게) 을 stable provider id 로 정규화한다. onboarding-handler
 * 의 `handleProviderDetect` 와 `handleOnboardingApplyStaffSelection` 둘 다
 * 본 함수 결과를 providerId 로 사용해 wizard / registry / DB / messenger
 * 사이드바가 같은 id 공간을 공유한다.
 */
export function normalizeCliCommand(command: string): string {
  return getCommandKey(command);
}

/**
 * F1 (cleanup): CLI provider 가 등록되지 않은 시점에 wizard 가 사용자에게
 * "이 카드는 summarize 가능" 처럼 미리보기 capability 를 보여줘야 할 때
 * 사용하는 well-known 기본 capability snapshot. createProvider 내부의 cli
 * 분기와 1:1 동기화되어 있어야 한다 — 아래 리터럴을 추가/수정할 때 line
 * 99 의 cliCapabilities 도 같이 갱신할 것 (또는 본 상수를 spread 해 사용).
 */
export const CLI_DEFAULT_CAPABILITIES: ReadonlyArray<ProviderCapability> = [
  'streaming',
  'summarize',
];

function getRuntimeCliConfig(config: Extract<ProviderConfig, { type: 'cli' }>): CliRuntimeConfig {
  const commandKey = getCommandKey(config.command);
  const command = config.command;
  const wslDistro = config.wslDistro;

  if (commandKey === 'claude') {
    return { ...CLAUDE_CLI_CONFIG, command, wslDistro };
  }
  if (commandKey === 'gemini') {
    return { ...GEMINI_CLI_CONFIG, command, wslDistro };
  }
  if (commandKey === 'codex') {
    return { ...CODEX_CLI_CONFIG, command, wslDistro };
  }

  return {
    command: config.command,
    args: config.args,
    inputFormat: config.inputFormat,
    outputFormat: config.outputFormat,
    sessionStrategy: config.sessionStrategy,
    hangTimeout: config.hangTimeout,
    wslDistro,
  };
}

/** Options for creating a provider. */
export interface CreateProviderOptions {
  id?: string;
  displayName: string;
  persona?: string;
  config: ProviderConfig;
  /** Callback to resolve an API key reference (from SecretStore). */
  resolveApiKey?: ApiKeyResolver;
}

/**
 * Create a BaseProvider from a ProviderConfig.
 */
export function createProvider(options: CreateProviderOptions): BaseProvider {
  const id = options.id ?? randomUUID();
  const model = options.config.model ?? 'unknown';

  switch (options.config.type) {
    case 'api': {
      if (!options.resolveApiKey) {
        throw new Error('resolveApiKey callback is required for API providers');
      }
      return new ApiProvider({
        id,
        displayName: options.displayName,
        model,
        persona: options.persona,
        config: options.config,
        resolveApiKey: options.resolveApiKey,
      });
    }

    case 'local': {
      return new LocalProvider({
        id,
        displayName: options.displayName,
        model,
        persona: options.persona,
        config: options.config,
      });
    }

    case 'cli': {
      const runtimeCliConfig = getRuntimeCliConfig(options.config);

      // R11-Task9: 'summarize' 정식 추가. Claude Code / Codex CLI / Gemini
      // CLI 모두 stdin 으로 prompt 를 받아 1-shot 응답을 낼 수 있으므로
      // capability snapshot 에 일관 노출. 실제 호출 시 sessionStrategy 가
      // per-turn / persistent 어느 쪽이든 streamCompletion 이 동일하게 답한다.
      const cliCapabilities: ProviderCapability[] = [...CLI_DEFAULT_CAPABILITIES];

      return new CliProvider({
        id,
        type: 'cli',
        displayName: options.displayName,
        model,
        persona: options.persona,
        capabilities: cliCapabilities,
        config: options.config,
        cliConfig: runtimeCliConfig,
      });
    }

    default:
      throw new Error(`Unknown provider type: ${(options.config as { type: string }).type}`);
  }
}
