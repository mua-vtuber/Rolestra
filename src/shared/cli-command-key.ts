/**
 * The CLI identity of a stored CLI command (`CliProviderConfig.command`):
 * its last path segment, lower-cased, without a Windows launcher extension
 * (`.cmd` / `.exe` / `.bat`). `C:\tools\Claude.cmd` and `/usr/bin/claude`
 * are both `claude`.
 *
 * Shared so main (`providers/factory.ts`, supported-CLI check and
 * capabilities) and the renderer (settings connection labels) read a
 * command the same way. Pure string work — no `node:path`, which the
 * renderer cannot import.
 */
export function cliCommandKey(command: string): string {
  const segments = command.split(/[\\/]/);
  const last = segments[segments.length - 1] ?? command;
  return last.toLowerCase().replace(/\.(cmd|exe|bat)$/i, '');
}

/**
 * The chat CLIs the app can drive, by command key. One list for main
 * (`providers/factory.ts` supported-CLI check, `cli-detect-handler.ts`
 * detection catalog) and the renderer (AI add dialog) — QA Minor 10.
 */
export const SUPPORTED_CHAT_CLI_COMMANDS = ['claude', 'codex'] as const;

export type SupportedChatCli = (typeof SUPPORTED_CHAT_CLI_COMMANDS)[number];

export function isSupportedChatCliKey(key: string): key is SupportedChatCli {
  return (SUPPORTED_CHAT_CLI_COMMANDS as readonly string[]).includes(key);
}
