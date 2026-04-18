/**
 * Tests for Tailscale CLI client.
 *
 * Mocks child_process.execFile to simulate various Tailscale CLI states:
 * - Not installed
 * - Installed but stopped
 * - Running with peers
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock child_process before importing the module under test
vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

import { execFile } from 'node:child_process';
import {
  detectTailscaleCli,
  getTailscaleStatus,
  getTailscaleIp,
} from '../tailscale-client';

const mockExecFile = vi.mocked(execFile);

/** Helper to configure mock execFile responses. */
function mockCommand(
  responses: Record<string, { stdout?: string; error?: Error }>,
): void {
  mockExecFile.mockImplementation(((
    command: string,
    args: string[],
    _options: unknown,
    callback: (error: Error | null, stdout: string, stderr: string) => void,
  ) => {
    const key = `${command} ${args.join(' ')}`;
    const match = Object.entries(responses).find(([pattern]) => key.includes(pattern));

    if (match) {
      const [, response] = match;
      if (response.error) {
        callback(response.error, '', '');
      } else {
        callback(null, response.stdout ?? '', '');
      }
    } else {
      callback(new Error(`Command not mocked: ${key}`), '', '');
    }

    return undefined;
  }) as unknown as typeof execFile);
}

// ── Sample Tailscale status JSON ──────────────────────────────────

const SAMPLE_STATUS_JSON = JSON.stringify({
  BackendState: 'Running',
  Self: {
    HostName: 'my-pc',
    DNSName: 'my-pc.tailnet-1234.ts.net.',
    TailscaleIPs: ['100.64.0.1', 'fd7a:115c:a1e0::1'],
    Online: true,
    OS: 'linux',
  },
  Peer: {
    'node-key:abc123': {
      HostName: 'server-1',
      DNSName: 'server-1.tailnet-1234.ts.net.',
      TailscaleIPs: ['100.64.0.2'],
      Online: true,
      OS: 'linux',
    },
    'node-key:def456': {
      HostName: 'laptop-2',
      DNSName: 'laptop-2.tailnet-1234.ts.net.',
      TailscaleIPs: ['100.64.0.3'],
      Online: false,
      OS: 'windows',
    },
  },
  Version: '1.62.0',
});

const STOPPED_STATUS_JSON = JSON.stringify({
  BackendState: 'Stopped',
  Self: null,
  Peer: null,
});

// ── Tests ──────────────────────────────────────────────────────────

describe('detectTailscaleCli', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns installed=true with version when CLI is found', async () => {
    mockCommand({
      'tailscale version': { stdout: '1.62.0\n  go1.21.5' },
    });

    const result = await detectTailscaleCli();

    expect(result.installed).toBe(true);
    expect(result.version).toBe('1.62.0');
  });

  it('returns installed=false when CLI is not found', async () => {
    mockCommand({
      'tailscale version': { error: new Error('ENOENT') },
    });

    const result = await detectTailscaleCli();

    expect(result.installed).toBe(false);
    expect(result.version).toBeUndefined();
  });
});

describe('getTailscaleStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns full status when Tailscale is running', async () => {
    mockCommand({
      'tailscale version': { stdout: '1.62.0' },
      'tailscale status': { stdout: SAMPLE_STATUS_JSON },
    });

    const status = await getTailscaleStatus();

    expect(status.installed).toBe(true);
    expect(status.version).toBe('1.62.0');
    expect(status.backendState).toBe('Running');
    expect(status.selfIp).toBe('100.64.0.1');
    expect(status.selfDnsName).toBe('my-pc.tailnet-1234.ts.net');
    expect(status.selfHostName).toBe('my-pc');
    expect(status.onlinePeers).toBe(1);
    expect(status.error).toBeUndefined();
  });

  it('returns installed=false when CLI is missing', async () => {
    mockCommand({
      'tailscale version': { error: new Error('ENOENT') },
    });

    const status = await getTailscaleStatus();

    expect(status.installed).toBe(false);
    expect(status.backendState).toBeUndefined();
    expect(status.selfIp).toBeUndefined();
  });

  it('returns error when status command fails', async () => {
    mockCommand({
      'tailscale version': { stdout: '1.62.0' },
      'tailscale status': { error: new Error('daemon not running') },
    });

    const status = await getTailscaleStatus();

    expect(status.installed).toBe(true);
    expect(status.version).toBe('1.62.0');
    expect(status.error).toContain('daemon not running');
  });

  it('handles Stopped backend state', async () => {
    mockCommand({
      'tailscale version': { stdout: '1.62.0' },
      'tailscale status': { stdout: STOPPED_STATUS_JSON },
    });

    const status = await getTailscaleStatus();

    expect(status.installed).toBe(true);
    expect(status.backendState).toBe('Stopped');
    expect(status.selfIp).toBeUndefined();
    expect(status.onlinePeers).toBe(0);
  });

  it('counts only online peers', async () => {
    mockCommand({
      'tailscale version': { stdout: '1.62.0' },
      'tailscale status': { stdout: SAMPLE_STATUS_JSON },
    });

    const status = await getTailscaleStatus();

    // 1 online (server-1), 1 offline (laptop-2)
    expect(status.onlinePeers).toBe(1);
  });
});

describe('getTailscaleIp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns IPv4 address when Tailscale is running', async () => {
    mockCommand({
      'tailscale ip': { stdout: '100.64.0.1\n' },
    });

    const ip = await getTailscaleIp();

    expect(ip).toBe('100.64.0.1');
  });

  it('returns null when Tailscale is not running', async () => {
    mockCommand({
      'tailscale ip': { error: new Error('not connected') },
    });

    const ip = await getTailscaleIp();

    expect(ip).toBeNull();
  });

  it('returns null for empty output', async () => {
    mockCommand({
      'tailscale ip': { stdout: '' },
    });

    const ip = await getTailscaleIp();

    expect(ip).toBeNull();
  });
});
