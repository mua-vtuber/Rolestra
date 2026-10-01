/**
 * Pure rules of the AI add dialog (spec 2026-10-01-messenger-redesign.md R6).
 *
 * Registration identity of a detected CLI — "추가됨":
 *   a detected CLI counts as already added when a registered CLI AI has the
 *   same command path (`CliProviderConfig.command`, which is the path
 *   `provider:detect-cli` reported when it was added) and the same WSL
 *   distro (both none, or equal). Paths are compared with `/` and `\` read
 *   alike; a Windows-style path (drive letter, UNC or backslash) is compared
 *   case-insensitively, a POSIX path exactly. The same path inside a WSL
 *   distro is a different CLI.
 *
 * Default names: the product name for a CLI, the model name for a local
 * model, the service's name for an API. A name another AI already uses
 * (case-insensitive, the same rule main enforces) gets the first free
 * number: "Claude Code 2", "Claude Code 3", …
 */
import type { TFunction } from 'i18next';

import { isSupportedChatCliKey } from '../../../../shared/cli-command-key';
import type { DetectedCli } from '../../../../shared/ipc-types';
import type { CliProviderConfig, ProviderInfo } from '../../../../shared/provider-types';

/** Session settings a newly added chat CLI starts with (unchanged from the previous dialog). */
const CLI_HANG_TIMEOUT_MS = 30_000;
const CLI_MODEL_UNKNOWN = 'unknown';

const WINDOWS_PATH_PATTERN = /^[a-z]:[\\/]|^\\\\|\\/i;

export function supportedClis(list: readonly DetectedCli[]): DetectedCli[] {
  return list.filter((cli) => isSupportedChatCliKey(cli.command));
}

/** The comparable form of a CLI command path (see the module note). */
export function cliPathKey(path: string): string {
  const trimmed = path.trim();
  const slashed = trimmed.replace(/\\/g, '/');
  return WINDOWS_PATH_PATTERN.test(trimmed) ? slashed.toLowerCase() : slashed;
}

export function isCliRegistered(cli: DetectedCli, providers: readonly ProviderInfo[]): boolean {
  const key = cliPathKey(cli.path);
  return providers.some((provider) => provider.config.type === 'cli' &&
    cliPathKey(provider.config.command) === key &&
    (provider.config.wslDistro ?? null) === (cli.wslDistro ?? null));
}

export function cliConfig(cli: DetectedCli): CliProviderConfig {
  return {
    type: 'cli', command: cli.path, args: [],
    inputFormat: 'stdin-json', outputFormat: 'stream-json',
    sessionStrategy: 'persistent',
    hangTimeout: { first: CLI_HANG_TIMEOUT_MS, subsequent: CLI_HANG_TIMEOUT_MS },
    model: CLI_MODEL_UNKNOWN,
    ...(cli.wslDistro === undefined ? {} : { wslDistro: cli.wslDistro }),
  };
}

/** `base` if no AI uses it (case-insensitive), else the first free numbered form. */
export function uniqueDisplayName(t: TFunction, base: string, providers: readonly ProviderInfo[]): string {
  const taken = new Set(providers.map((provider) => provider.displayName.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let number = 2; ; number += 1) {
    const candidate = t('providerConnect.numberedName', { name: base, number });
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

/** Validate an http(s) URL with no embedded credentials. */
export function validateEndpoint(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}
