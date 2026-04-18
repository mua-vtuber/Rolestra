/**
 * Tailscale CLI wrapper for detecting, querying status, and monitoring
 * the local Tailscale daemon.
 *
 * Uses child_process.execFile (shell: false) per project coding standards.
 */

import { execFile } from 'node:child_process';
import type { TailscaleBackendState, TailscaleStatus } from '../../shared/remote-types';

/** Timeout for CLI commands in milliseconds. */
const CLI_TIMEOUT_MS = 5_000;

/** Raw JSON structure from `tailscale status --json`. */
interface TailscaleStatusJson {
  BackendState: string;
  Self?: {
    HostName: string;
    DNSName: string;
    TailscaleIPs: string[];
    Online: boolean;
    OS: string;
  };
  Peer?: Record<
    string,
    {
      HostName: string;
      DNSName: string;
      TailscaleIPs: string[];
      Online: boolean;
      OS: string;
    }
  >;
  Version?: string;
}

/**
 * Executes a CLI command and returns stdout as a string.
 * Rejects on non-zero exit or timeout.
 */
function runCommand(
  command: string,
  args: string[],
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { shell: false, timeout: CLI_TIMEOUT_MS },
      (error, stdout) => {
        if (error) {
          reject(error);
        } else {
          resolve(stdout.trim());
        }
      },
    );
  });
}

/**
 * Detects whether the `tailscale` CLI is installed by running `tailscale version`.
 *
 * Returns `{ installed: true, version }` on success,
 * or `{ installed: false }` if the binary is not found.
 */
export async function detectTailscaleCli(): Promise<{
  installed: boolean;
  version?: string;
}> {
  try {
    const output = await runCommand('tailscale', ['version']);
    // First line is the version string (e.g. "1.62.0")
    const version = output.split('\n')[0]?.trim();
    return { installed: true, version };
  } catch {
    return { installed: false };
  }
}

/**
 * Queries `tailscale status --json` and returns a parsed TailscaleStatus.
 *
 * If Tailscale is not installed or the daemon is not running, returns
 * a status object with `installed: false` or appropriate error.
 */
export async function getTailscaleStatus(): Promise<TailscaleStatus> {
  // Step 1: Check if CLI exists
  const detection = await detectTailscaleCli();
  if (!detection.installed) {
    return { installed: false };
  }

  // Step 2: Query full status
  try {
    const raw = await runCommand('tailscale', ['status', '--json']);
    const json = JSON.parse(raw) as TailscaleStatusJson;

    const backendState = json.BackendState as TailscaleBackendState;
    const self = json.Self;

    // Count online peers
    let onlinePeers = 0;
    if (json.Peer) {
      for (const peer of Object.values(json.Peer)) {
        if (peer.Online) {
          onlinePeers++;
        }
      }
    }

    return {
      installed: true,
      version: detection.version,
      backendState,
      selfIp: self?.TailscaleIPs?.[0],
      selfDnsName: self?.DNSName?.replace(/\.$/, ''),
      selfHostName: self?.HostName,
      onlinePeers,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      installed: true,
      version: detection.version,
      error: message,
    };
  }
}

/**
 * Returns the Tailscale IPv4 address of this machine.
 *
 * Uses `tailscale ip -4` for a quick lookup (faster than full status).
 * Returns `null` if Tailscale is not running or no IP is assigned.
 */
export async function getTailscaleIp(): Promise<string | null> {
  try {
    const output = await runCommand('tailscale', ['ip', '-4']);
    const ip = output.split('\n')[0]?.trim();
    return ip && ip.length > 0 ? ip : null;
  } catch {
    return null;
  }
}
