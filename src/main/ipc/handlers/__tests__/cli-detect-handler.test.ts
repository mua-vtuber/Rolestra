import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockExecFileAsync } = vi.hoisted(() => ({ mockExecFileAsync: vi.fn() }));

vi.mock('child_process', () => ({ execFile: mockExecFileAsync }));
vi.mock('util', async (importOriginal) => ({
  ...(await importOriginal<typeof import('util')>()),
  promisify: () => mockExecFileAsync,
}));

import { handleProviderDetectCli } from '../cli-detect-handler';

describe('cli-detect-handler', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('detects Claude without probing Gemini CLI', async () => {
    mockExecFileAsync
      .mockResolvedValueOnce({ stdout: '/usr/bin/claude\n', stderr: '' })
      .mockRejectedValueOnce(new Error('not found')) // codex
      .mockResolvedValueOnce({ stdout: '1.0.5\n', stderr: '' });

    const result = await handleProviderDetectCli();
    expect(result.detected).toEqual([expect.objectContaining({
      command: 'claude', displayName: 'Claude Code', version: '1.0.5', path: '/usr/bin/claude',
    })]);
    expect(JSON.stringify(mockExecFileAsync.mock.calls)).not.toContain('gemini');
  });

  it('returns empty when supported CLIs are absent', async () => {
    mockExecFileAsync.mockRejectedValue(new Error('not found'));
    expect((await handleProviderDetectCli()).detected).toEqual([]);
  });

  it('returns a detected CLI when its version lookup fails', async () => {
    mockExecFileAsync
      .mockResolvedValueOnce({ stdout: '/usr/bin/claude\n', stderr: '' })
      .mockRejectedValueOnce(new Error('not found'))
      .mockRejectedValueOnce(new Error('timeout'));
    const result = await handleProviderDetectCli();
    expect(result.detected).toEqual([expect.objectContaining({
      command: 'claude', path: '/usr/bin/claude', version: undefined,
    })]);
  });

  it('detects Claude and Codex together without Gemini', async () => {
    mockExecFileAsync
      .mockResolvedValueOnce({ stdout: '/usr/bin/claude\n', stderr: '' })
      .mockResolvedValueOnce({ stdout: '/usr/bin/codex\n', stderr: '' })
      .mockResolvedValueOnce({ stdout: '1.0.5\n', stderr: '' })
      .mockResolvedValueOnce({ stdout: '0.3.0\n', stderr: '' });
    const result = await handleProviderDetectCli();
    expect(result.detected.map((d) => d.command)).toEqual(['claude', 'codex']);
    expect(JSON.stringify(mockExecFileAsync.mock.calls)).not.toContain('gemini');
  });

  it('does not attempt to detect the unregistrable aider CLI', async () => {
    mockExecFileAsync.mockRejectedValue(new Error('not found'));
    await handleProviderDetectCli();
    expect(JSON.stringify(mockExecFileAsync.mock.calls)).not.toContain('aider');
  });
});
