/**
 * IPC handler for provider:detect-cli channel.
 *
 * Scans PATH for known CLI AI tools and returns detected ones.
 * On Windows, falls back to WSL detection when a CLI is not found natively.
 *
 * Windows command resolution goes through the shared `windows-command.ts`
 * (the same module cli-process.ts and cli-spawn.ts use), so `where` / a `.cmd`
 * shim / a bare name are all resolved exactly as they will be at spawn time.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { SUPPORTED_CHAT_CLI_COMMANDS, type SupportedChatCli } from '../../../shared/cli-command-key';
import type { DetectedCli } from '../../../shared/ipc-types';
import { CLI_DETECTION_TIMEOUT_MS } from '../../../shared/timeouts';
import { resolveWindowsCommand } from '../../providers/cli/windows-command';

const execFileAsync = promisify(execFile);
const IS_WINDOWS = process.platform === 'win32';
const LOOKUP_COMMAND = IS_WINDOWS ? 'where' : 'which';

function pickDetectedPath(lookupOut: string): string {
  const candidates = lookupOut
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (candidates.length === 0) return '';
  if (!IS_WINDOWS) return candidates[0];
  const rank = (path: string): number => {
    const lower = path.toLowerCase();
    if (lower.endsWith('.exe') || lower.endsWith('.com')) return 1;
    if (lower.endsWith('.cmd')) return 2;
    if (lower.endsWith('.bat')) return 3;
    if (lower.endsWith('.ps1')) return 4;
    return 5;
  };
  const sorted = [...candidates].sort((a, b) => rank(a) - rank(b));
  return sorted[0];
}

interface KnownCli {
  command: SupportedChatCli;
  displayName: string;
  versionArgs: string[];
}

const CLI_DETAILS: Record<SupportedChatCli, Omit<KnownCli, 'command'>> = {
  claude: { displayName: 'Claude Code', versionArgs: ['--version'] },
  codex: { displayName: 'Codex CLI', versionArgs: ['--version'] },
};

/** Detection follows the same supported list as registration and the AI dialog. */
const KNOWN_CLIS: KnownCli[] = SUPPORTED_CHAT_CLI_COMMANDS.map((command) => ({
  command, ...CLI_DETAILS[command],
}));

/** Detect a CLI on the native (Windows or host) PATH. */
async function detectNative(cli: KnownCli): Promise<DetectedCli | null> {
  try {
    // where/which are native executables — no shell needed
    const {
      resolvedCommand: lookupCmd,
      resolvedArgs: lookupArgs,
      windowsVerbatimArguments: lookupVerbatim,
    } = resolveWindowsCommand(LOOKUP_COMMAND, [cli.command]);
    const { stdout: lookupOut } = await execFileAsync(lookupCmd, lookupArgs, {
      windowsVerbatimArguments: lookupVerbatim,
      timeout: CLI_DETECTION_TIMEOUT_MS,
    });
    const path = pickDetectedPath(lookupOut);
    if (!path) return null;

    // Try to get version (using resolved command to avoid shell: true)
    let version: string | undefined;
    try {
      const {
        resolvedCommand: verCmd,
        resolvedArgs: verArgs,
        windowsVerbatimArguments: verVerbatim,
      } = resolveWindowsCommand(path, cli.versionArgs);
      const { stdout: versionOut, stderr: versionErr } = await execFileAsync(verCmd, verArgs, {
        windowsVerbatimArguments: verVerbatim,
        timeout: 10_000,
      });
      // Filter out Node.js deprecation warnings from CLI version output.
      const rawVersion = (versionOut || versionErr).trim();
      const lines = rawVersion.split(/\r?\n/).filter(
        (l) => l.trim() && !l.startsWith('(node:') && !l.startsWith('(Use '),
      );
      version = lines[0] || undefined;
    } catch {
      // version detection failed, but command exists
    }

    return {
      command: cli.command,
      displayName: cli.displayName,
      version,
      path,
    };
  } catch {
    return null;
  }
}

// ── WSL Detection (Windows only) ──────────────────────────────────

/** Get available WSL distro names. Returns empty array if WSL is not available. */
async function getWslDistros(): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync('wsl.exe', ['-l', '-q'], {
      timeout: CLI_DETECTION_TIMEOUT_MS,
    });
    // wsl -l -q may output UTF-16LE with null bytes — strip them
    return stdout
      .replace(/\0/g, '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** Detect a CLI inside a specific WSL distro. */
async function detectInWsl(cli: KnownCli, distro: string): Promise<DetectedCli | null> {
  try {
    // which <command> inside WSL
    const { stdout: whichOut } = await execFileAsync(
      'wsl.exe',
      ['-d', distro, '--', 'which', cli.command],
      { timeout: CLI_DETECTION_TIMEOUT_MS },
    );
    const path = whichOut.replace(/\0/g, '').trim();
    if (!path) return null;

    // Try to get version inside WSL
    let version: string | undefined;
    try {
      const { stdout: versionOut, stderr: versionErr } = await execFileAsync(
        'wsl.exe',
        ['-d', distro, '--', cli.command, ...cli.versionArgs],
        { timeout: 10_000 },
      );
      const rawVersion = (versionOut || versionErr).replace(/\0/g, '').trim();
      const lines = rawVersion.split(/\r?\n/).filter(
        (l) => l.trim() && !l.startsWith('(node:') && !l.startsWith('(Use '),
      );
      version = lines[0] || undefined;
    } catch {
      // version detection failed, but command exists in WSL
    }

    return {
      command: cli.command,
      displayName: `${cli.displayName} (WSL: ${distro})`,
      version,
      path,
      wslDistro: distro,
    };
  } catch {
    return null;
  }
}

export async function handleProviderDetectCli(): Promise<{ detected: DetectedCli[] }> {
  // Phase 1: native detection
  const nativeResults = await Promise.all(KNOWN_CLIS.map(detectNative));
  const detected: DetectedCli[] = nativeResults.filter((r): r is DetectedCli => r !== null);
  const foundCommands = new Set(detected.map((d) => d.command));

  // Phase 2: WSL fallback for CLIs not found natively (Windows only)
  if (IS_WINDOWS) {
    const notFound = KNOWN_CLIS.filter((cli) => !foundCommands.has(cli.command));
    if (notFound.length > 0) {
      const distros = await getWslDistros();

      if (distros.length > 0) {
        // Search the first (default or preferred) distro for all missing CLIs
        const targetDistro = distros[0];
        const wslResults = await Promise.all(
          notFound.map((cli) => detectInWsl(cli, targetDistro)),
        );
        for (const result of wslResults) {
          if (result) detected.push(result);
        }
      }
    }
  }

  return { detected };
}
