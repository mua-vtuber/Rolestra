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

      const cliCapabilities: ProviderCapability[] = ['streaming'];

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
