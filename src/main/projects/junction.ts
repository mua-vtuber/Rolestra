/**
 * Junction / symlink helpers — ported from `tools/cli-smoke/src/junction.ts` (R1).
 *
 * Creates a directory link (Windows junction via `mklink /J`, POSIX symlink
 * elsewhere) and resolves it to its target's realpath. Used exclusively by
 * `ProjectService` when materialising `kind='external'` projects — the
 * `<ArenaRoot>/projects/<slug>/link` entry must transparently redirect the
 * CLI's `cwd` to the user's external folder without requiring admin rights
 * on Windows.
 *
 * Behaviour:
 *   - `createLink`: idempotent. If `linkPath` already exists (link or
 *     directory), it is removed first, then recreated pointing at
 *     `targetRealPath`. Windows uses `mklink /J` (directory junction);
 *     POSIX uses `fs.symlink(..., 'dir')`.
 *   - `removeLink`: ENOENT-tolerant. Refuses to touch files that are
 *     neither symlinks nor directories (prevents accidental unlink of a
 *     regular file planted at the same path).
 *   - `resolveLink`: thin wrapper over `fs.realpathSync`. Returned in a
 *     distinct helper so callers can stub it in tests if needed.
 */

import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import { realpathSync } from 'node:fs';

/**
 * Create a directory link at `linkPath` that redirects to `targetRealPath`.
 * Pre-existing links or directories at `linkPath` are removed first so that
 * callers can retry creation safely.
 */
export async function createLink(
  linkPath: string,
  targetRealPath: string,
): Promise<void> {
  // Idempotent: remove any prior link/directory so create never races itself.
  try {
    await removeLink(linkPath);
  } catch {
    // Swallow — removeLink already throws on genuinely dangerous cases;
    // transient failures here should not block the retry of creation.
  }

  if (process.platform === 'win32') {
    await runMklinkJunction(linkPath, targetRealPath);
    return;
  }
  await fs.symlink(targetRealPath, linkPath, 'dir');
}

/**
 * Remove a directory link.
 *
 * - Missing path: no-op.
 * - Symlink:      unlinked (POSIX) / rmdir'd (Windows junctions are reported
 *                 as directories by `lstat`, so `rmdir` is correct).
 * - Directory:    rmdir'd on Windows (junction path). On POSIX we refuse to
 *                 rmdir a real directory because it's almost certainly a bug
 *                 in the caller (unexpected file-system state).
 * - Other:        throws — regular files at this path are never correct.
 */
export async function removeLink(linkPath: string): Promise<void> {
  let st: Awaited<ReturnType<typeof fs.lstat>>;
  try {
    st = await fs.lstat(linkPath);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw err;
  }

  if (!st.isSymbolicLink() && !st.isDirectory()) {
    throw new Error(`${linkPath} is neither symlink nor directory`);
  }

  if (process.platform === 'win32') {
    await fs.rmdir(linkPath);
    return;
  }
  await fs.unlink(linkPath);
}

/** Resolve `linkPath` to its target's realpath. */
export function resolveLink(linkPath: string): string {
  return realpathSync(linkPath);
}

/**
 * Execute `mklink /J <linkPath> <target>` via cmd.exe. `mklink /J` creates a
 * directory junction which (unlike a Windows symlink) does not require the
 * `SeCreateSymbolicLinkPrivilege` and so works under standard-user sessions.
 */
function runMklinkJunction(linkPath: string, target: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('cmd.exe', ['/c', 'mklink', '/J', linkPath, target], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const stderrChunks: string[] = [];
    proc.stderr.on('data', (c: Buffer) => stderrChunks.push(c.toString('utf-8')));
    proc.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `mklink /J failed (exit ${code}): ${stderrChunks.join('')}`,
        ),
      );
    });
    proc.on('error', reject);
  });
}
