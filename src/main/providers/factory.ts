/**
 * Provider Factory — creates BaseProvider instances from ProviderConfig.
 *
 * Centralizes provider instantiation. The provider-handler uses this
 * to create provider instances when 'provider:add' is invoked.
 */

import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import type { ProviderConfig, ProviderCapability } from '../../shared/provider-types';
import type { RoleId } from '../../shared/role-types';
import type { BaseProvider } from './provider-interface';
import { ApiProvider, type ApiKeyResolver } from './api/api-provider';
import { LocalProvider } from './local/local-provider';
import { CliProvider } from './cli/cli-provider';
import { CLAUDE_CLI_CONFIG } from './cli/claude-config';
import { GEMINI_CLI_CONFIG } from './cli/gemini-config';
import { CODEX_CLI_CONFIG } from './cli/codex-config';
import type { CliRuntimeConfig } from './cli/cli-provider';
import { resolveCliCapabilities } from './capability-resolver';

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
 * 사용하는 well-known 기본 capability snapshot.
 *
 * 결재 3번 (A, 2026-05-19): wizard 미리보기에서도 CLI 종류별 실제 능력 매트릭스
 * (resume / tools / code-execution 등) 를 정직하게 노출하기 위해 본 상수는
 * `capability-resolver.resolveCliCapabilities()` 로 위임. 미리보기는 unknown
 * CLI 명령일 때의 보수적 baseline (= 공통 능력만) 을 그대로 사용.
 */
export const CLI_DEFAULT_CAPABILITIES: ReadonlyArray<ProviderCapability> =
  resolveCliCapabilities('unknown-cli-baseline');

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
  /** R12-S: 직원 부여 능력. 미지정 시 빈 배열 (어떤 부서에도 합류 X). */
  roles?: RoleId[];
  /** R12-S: 능력별 customize prompt. null = 카탈로그 default. */
  skill_overrides?: Partial<Record<RoleId, string>> | null;
}

/**
 * Create a BaseProvider from a ProviderConfig.
 */
export function createProvider(options: CreateProviderOptions): BaseProvider {
  const id = options.id ?? randomUUID();
  const model = options.config.model ?? 'unknown';
  const roles = options.roles ?? [];
  const skill_overrides = options.skill_overrides ?? null;

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
        roles,
        skill_overrides,
      });
    }

    case 'local': {
      return new LocalProvider({
        id,
        displayName: options.displayName,
        model,
        persona: options.persona,
        config: options.config,
        roles,
        skill_overrides,
      });
    }

    case 'cli': {
      const runtimeCliConfig = getRuntimeCliConfig(options.config);

      // 결재 3번 (A, 2026-05-19): CLI 종류별 (claude / codex / gemini) 로
      // 실제 능력 매트릭스를 등록. R11-Task9 의 'summarize' 일관 노출은
      // resolver 의 COMMON_CAPABILITIES 에 보존되어 있어 모든 CLI 가 계속
      // streamCompletion 을 답한다. claude/codex 는 추가로 code-execution,
      // 모든 CLI 는 persistent session resume + tools 까지 광고.
      const commandKey = getCommandKey(options.config.command);
      const cliCapabilities: ProviderCapability[] = resolveCliCapabilities(commandKey);

      return new CliProvider({
        id,
        type: 'cli',
        displayName: options.displayName,
        model,
        persona: options.persona,
        capabilities: cliCapabilities,
        config: options.config,
        cliConfig: runtimeCliConfig,
        roles,
        skill_overrides,
      });
    }

    default:
      throw new Error(`Unknown provider type: ${(options.config as { type: string }).type}`);
  }
}
