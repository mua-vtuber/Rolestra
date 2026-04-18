import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * cli-detect-handler internally does:
 *   const execFileAsync = promisify(execFile);
 *
 * We mock child_process so `execFile` is a vi.fn(),
 * and mock `util.promisify` to return that same fn directly
 * (since the mock already returns Promises).
 */

const { mockExecFileAsync } = vi.hoisted(() => ({
  mockExecFileAsync: vi.fn(),
}));

vi.mock('child_process', () => ({
  execFile: mockExecFileAsync,
}));

vi.mock('util', async (importOriginal) => {
  const original = await importOriginal<typeof import('util')>();
  return {
    ...original,
    promisify: () => mockExecFileAsync,
  };
});

import { handleProviderDetectCli } from '../cli-detect-handler';

describe('cli-detect-handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('handleProviderDetectCli', () => {
    it('happy path — returns detected CLIs with version and path', async () => {
      // KNOWN_CLIS: claude, gemini, codex, aider (4 total)
      // Promise.all runs all lookups in parallel, so all 4 lookups fire first,
      // then version calls for found CLIs follow.
      // Order: claude-lookup, gemini-lookup, codex-lookup, aider-lookup, claude-version
      mockExecFileAsync
        .mockResolvedValueOnce({ stdout: '/usr/bin/claude\n', stderr: '' })  // claude lookup
        .mockRejectedValueOnce(new Error('not found'))                       // gemini lookup
        .mockRejectedValueOnce(new Error('not found'))                       // codex lookup
        .mockRejectedValueOnce(new Error('not found'))                       // aider lookup
        .mockResolvedValueOnce({ stdout: '1.0.5\n', stderr: '' });          // claude version

      const result = await handleProviderDetectCli();

      expect(result.detected).toHaveLength(1);
      expect(result.detected[0]).toEqual(
        expect.objectContaining({
          command: 'claude',
          displayName: 'Claude Code',
          version: '1.0.5',
          path: '/usr/bin/claude',
        }),
      );
    });

    it('returns empty array when no CLIs are installed', async () => {
      mockExecFileAsync.mockRejectedValue(new Error('not found'));

      const result = await handleProviderDetectCli();

      expect(result.detected).toHaveLength(0);
      expect(result.detected).toEqual([]);
    });

    it('returns CLI without version when version detection fails', async () => {
      // Order: claude-lookup, gemini-lookup, codex-lookup, aider-lookup, claude-version(fails)
      mockExecFileAsync
        .mockResolvedValueOnce({ stdout: '/usr/bin/claude\n', stderr: '' })  // claude lookup
        .mockRejectedValueOnce(new Error('not found'))                       // gemini lookup
        .mockRejectedValueOnce(new Error('not found'))                       // codex lookup
        .mockRejectedValueOnce(new Error('not found'))                       // aider lookup
        .mockRejectedValueOnce(new Error('timeout'));                        // claude version

      const result = await handleProviderDetectCli();

      expect(result.detected).toHaveLength(1);
      expect(result.detected[0].command).toBe('claude');
      expect(result.detected[0].version).toBeUndefined();
      expect(result.detected[0].path).toBe('/usr/bin/claude');
    });

    it('detects multiple CLIs when several are available', async () => {
      // KNOWN_CLIS: claude, gemini, codex, aider
      // Order: all 4 lookups first, then version calls for found CLIs
      mockExecFileAsync
        // Lookups (all 4 in parallel)
        .mockResolvedValueOnce({ stdout: '/usr/bin/claude\n', stderr: '' })   // claude lookup
        .mockResolvedValueOnce({ stdout: '/usr/bin/gemini\n', stderr: '' })   // gemini lookup
        .mockRejectedValueOnce(new Error('not found'))                        // codex lookup
        .mockRejectedValueOnce(new Error('not found'))                        // aider lookup
        // Version calls for found CLIs
        .mockResolvedValueOnce({ stdout: '1.0.5\n', stderr: '' })            // claude version
        .mockResolvedValueOnce({ stdout: '0.3.0\n', stderr: '' });           // gemini version

      const result = await handleProviderDetectCli();

      expect(result.detected).toHaveLength(2);
      expect(result.detected.map((d) => d.command)).toEqual(['claude', 'gemini']);
    });
  });
});
