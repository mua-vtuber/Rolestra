/**
 * Pure rules of the AI add dialog (spec 2026-10-01-messenger-redesign.md R6).
 *
 * Registration identity of a detected CLI — "추가됨":
 *   a CLI AI stores the bare command name (`claude` / `codex`), never the
 *   path `provider:detect-cli` found it at, and every spawn looks the name up
 *   on PATH again. A stored path breaks as soon as the CLI moves: the Codex
 *   desktop app keeps its codex.exe under a per-version folder and deletes the
 *   old one on update, which turned every check into ENOENT. A detected CLI
 *   therefore counts as already added when a registered CLI AI has the same
 *   command name and the same WSL distro (both none, or equal); the same
 *   name inside a WSL distro is a different CLI.
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

export function supportedClis(list: readonly DetectedCli[]): DetectedCli[] {
  return list.filter((cli) => isSupportedChatCliKey(cli.command));
}

export function isCliRegistered(cli: DetectedCli, providers: readonly ProviderInfo[]): boolean {
  return providers.some((provider) => provider.config.type === 'cli' &&
    provider.config.command === cli.command &&
    (provider.config.wslDistro ?? null) === (cli.wslDistro ?? null));
}

export function cliConfig(cli: DetectedCli): CliProviderConfig {
  return {
    type: 'cli', command: cli.command, args: [],
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
