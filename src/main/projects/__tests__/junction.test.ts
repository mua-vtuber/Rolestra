/**
 * Unit tests for the junction/symlink helpers.
 *
 * Strategy:
 *   - POSIX (non-Windows) runs `createLink` + `resolveLink` against a
 *     real symlink. `fs.realpathSync` is the oracle.
 *   - Windows (`win32`) runs the same pair but via `mklink /J`. Junction
 *     creation does not require elevation so it can run on CI agents. The
 *     POSIX-only assertions (symlink-type check) are skipped on win32.
 *   - Tests that would require both OSes to run identically are split so
 *     each platform skips only what it cannot assert.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLink, removeLink, resolveLink } from '../junction';

function makeTmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanupDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

const isWindows = process.platform === 'win32';

describe('junction helpers', () => {
  let tmpBase: string;

  beforeEach(() => {
    tmpBase = makeTmpDir('rolestra-junction-');
  });

  afterEach(() => {
    cleanupDir(tmpBase);
  });

  describe('createLink → resolveLink round-trip', () => {
    it('points the link at the target realpath', async () => {
      const target = path.join(tmpBase, 'target');
      const linkPath = path.join(tmpBase, 'link');
      fs.mkdirSync(target);
      const targetReal = fs.realpathSync(target);

      await createLink(linkPath, targetReal);

      expect(fs.existsSync(linkPath)).toBe(true);
      expect(resolveLink(linkPath)).toBe(targetReal);
    });

    it('is idempotent — second call replaces an existing link', async () => {
      const targetA = path.join(tmpBase, 'target-a');
      const targetB = path.join(tmpBase, 'target-b');
      const linkPath = path.join(tmpBase, 'link');
      fs.mkdirSync(targetA);
      fs.mkdirSync(targetB);
      const realA = fs.realpathSync(targetA);
      const realB = fs.realpathSync(targetB);

      await createLink(linkPath, realA);
      expect(resolveLink(linkPath)).toBe(realA);

      // Re-create pointing elsewhere — should not throw.
      await createLink(linkPath, realB);
      expect(resolveLink(linkPath)).toBe(realB);
    });
  });

  describe('POSIX-specific symlink semantics', () => {
    it.skipIf(isWindows)('creates an actual symbolic link (lstat)', async () => {
      const target = path.join(tmpBase, 'target');
      const linkPath = path.join(tmpBase, 'link');
      fs.mkdirSync(target);
      const targetReal = fs.realpathSync(target);

      await createLink(linkPath, targetReal);

      const st = fs.lstatSync(linkPath);
      expect(st.isSymbolicLink()).toBe(true);
    });
  });

  describe('Windows-specific junction semantics', () => {
    it.skipIf(!isWindows)(
      'creates a directory junction (lstat reports directory)',
      async () => {
        const target = path.join(tmpBase, 'target');
        const linkPath = path.join(tmpBase, 'link');
        fs.mkdirSync(target);
        const targetReal = fs.realpathSync(target);

        await createLink(linkPath, targetReal);

        // Junctions are reported as directories by lstat; the presence
        // of the entry plus realpath redirection is the Windows oracle.
        expect(fs.existsSync(linkPath)).toBe(true);
        expect(resolveLink(linkPath)).toBe(targetReal);
      },
    );

    it.skipIf(!isWindows)(
      'resolves a junction whose target is outside the link parent (R12-C 정리 #6)',
      async () => {
        // Mirrors the production scenario: ArenaRoot is one tmp tree, the
        // user's external project lives in a sibling tmp tree. The junction
        // sits inside ArenaRoot but its realpath must point at the external
        // tree — that is exactly what the CA-3 TOCTOU guard reads at every
        // CLI spawn.
        const externalTree = fs.mkdtempSync(
          path.join(os.tmpdir(), 'rolestra-junction-ext-'),
        );
        try {
          const externalTarget = path.join(externalTree, 'real');
          const linkPath = path.join(tmpBase, 'link');
          fs.mkdirSync(externalTarget);
          const externalTargetReal = fs.realpathSync(externalTarget);

          await createLink(linkPath, externalTargetReal);

          expect(resolveLink(linkPath)).toBe(externalTargetReal);
        } finally {
          cleanupDir(externalTree);
        }
      },
    );

    it.skipIf(!isWindows)(
      'reports a different realpath after the junction is swapped (R12-C 정리 #6)',
      async () => {
        // Simulates a TOCTOU attack: two distinct external trees, the
        // junction starts pointing at the first, then is recreated to point
        // at the second. realpathSync must return distinct, accurate values
        // both times — that is what allows PermissionService to detect the
        // swap.
        const treeA = fs.mkdtempSync(
          path.join(os.tmpdir(), 'rolestra-junction-a-'),
        );
        const treeB = fs.mkdtempSync(
          path.join(os.tmpdir(), 'rolestra-junction-b-'),
        );
        try {
          const linkPath = path.join(tmpBase, 'link');
          const realA = fs.realpathSync(treeA);
          const realB = fs.realpathSync(treeB);

          await createLink(linkPath, realA);
          expect(resolveLink(linkPath)).toBe(realA);

          await createLink(linkPath, realB);
          expect(resolveLink(linkPath)).toBe(realB);
          expect(resolveLink(linkPath)).not.toBe(realA);
        } finally {
          cleanupDir(treeA);
          cleanupDir(treeB);
        }
      },
    );
  });

  describe('removeLink', () => {
    it('is a no-op on a missing path', async () => {
      await expect(
        removeLink(path.join(tmpBase, 'does-not-exist')),
      ).resolves.toBeUndefined();
    });

    it('removes an existing link and tolerates double-remove', async () => {
      const target = path.join(tmpBase, 'target');
      const linkPath = path.join(tmpBase, 'link');
      fs.mkdirSync(target);
      await createLink(linkPath, fs.realpathSync(target));

      expect(fs.existsSync(linkPath)).toBe(true);
      await removeLink(linkPath);
      expect(fs.existsSync(linkPath)).toBe(false);

      // Second remove is a no-op.
      await expect(removeLink(linkPath)).resolves.toBeUndefined();
    });

    it.skipIf(isWindows)(
      'refuses to touch a regular file squatting at the link path',
      async () => {
        const filePath = path.join(tmpBase, 'not-a-link');
        fs.writeFileSync(filePath, 'hello');

        await expect(removeLink(filePath)).rejects.toThrow(
          /neither symlink nor directory/,
        );
        // File must still exist — removal was refused.
        expect(fs.existsSync(filePath)).toBe(true);
      },
    );
  });
});
