/**
 * Unit tests for ArenaRootService.
 *
 * Each test uses a freshly-minted tmpdir so that `ensure()` creations and
 * writable-probe artifacts can not collide between cases. A minimal
 * in-memory config stub is injected to keep the tests decoupled from
 * Electron's `app.getPath` and the on-disk settings file.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ARENA_ROOT_PATH_CHANGED_EVENT,
  ARENA_ROOT_SUBDIRS,
  ArenaRootService,
  getDefaultArenaRoot,
  type ArenaRootConfigAccessor,
} from '../arena-root-service';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'arena-root-test-'));
}

function cleanupDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

/** Minimal ConfigService stub backed by an in-memory settings object. */
function createConfigStub(initial: { arenaRoot?: string } = {}): ArenaRootConfigAccessor & {
  state: { arenaRoot: string };
} {
  const state = { arenaRoot: initial.arenaRoot ?? '' };
  return {
    state,
    getSettings() {
      return state;
    },
    updateSettings(patch: { arenaRoot?: string }) {
      if (patch.arenaRoot !== undefined) {
        state.arenaRoot = patch.arenaRoot;
      }
    },
  };
}

describe('ArenaRootService', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = makeTmpDir();
    // fs.mkdtempSync pre-creates the dir; remove it so ensure() has a clean slate.
    cleanupDir(tmpRoot);
  });

  afterEach(() => {
    cleanupDir(tmpRoot);
  });

  // ── Construction & defaults ────────────────────────────────────────

  it('falls back to the platform default when settings.arenaRoot is empty', () => {
    const config = createConfigStub({ arenaRoot: '' });
    const svc = new ArenaRootService(config);

    expect(svc.getPath()).toBe(getDefaultArenaRoot());
  });

  it('uses the configured arenaRoot path verbatim when non-empty', () => {
    const config = createConfigStub({ arenaRoot: tmpRoot });
    const svc = new ArenaRootService(config);

    expect(svc.getPath()).toBe(tmpRoot);
  });

  // ── ensure() ───────────────────────────────────────────────────────

  it('ensure() creates all 6 canonical subdirectories', async () => {
    const config = createConfigStub({ arenaRoot: tmpRoot });
    const svc = new ArenaRootService(config);

    await svc.ensure();

    for (const sub of ARENA_ROOT_SUBDIRS) {
      const full = path.join(tmpRoot, sub);
      expect(fs.existsSync(full)).toBe(true);
      expect(fs.statSync(full).isDirectory()).toBe(true);
    }
  });

  it('ensure() is idempotent — second call does not throw', async () => {
    const config = createConfigStub({ arenaRoot: tmpRoot });
    const svc = new ArenaRootService(config);

    await svc.ensure();
    await expect(svc.ensure()).resolves.toBeUndefined();
  });

  it('ensure() throws when the configured path already exists as a regular file', async () => {
    // Re-use tmpRoot as a file path — parent already gone after cleanup above.
    fs.mkdirSync(path.dirname(tmpRoot), { recursive: true });
    fs.writeFileSync(tmpRoot, 'not a directory');

    const config = createConfigStub({ arenaRoot: tmpRoot });
    const svc = new ArenaRootService(config);

    await expect(svc.ensure()).rejects.toThrow(
      /ArenaRoot path exists but is not a directory/,
    );
  });

  // ── getStatus() ────────────────────────────────────────────────────

  it('getStatus() reports exists/writable/consensusReady=true after ensure()', async () => {
    const config = createConfigStub({ arenaRoot: tmpRoot });
    const svc = new ArenaRootService(config);
    await svc.ensure();

    const status = await svc.getStatus();

    expect(status.path).toBe(path.resolve(tmpRoot));
    expect(status.exists).toBe(true);
    expect(status.writable).toBe(true);
    expect(status.consensusReady).toBe(true);
    expect(status.projectsCount).toBe(0);
  });

  it('getStatus() reflects the count of entries under projects/', async () => {
    const config = createConfigStub({ arenaRoot: tmpRoot });
    const svc = new ArenaRootService(config);
    await svc.ensure();

    const projectsDir = svc.projectsRoot();
    fs.mkdirSync(path.join(projectsDir, 'alpha'));
    fs.mkdirSync(path.join(projectsDir, 'beta'));

    const status = await svc.getStatus();
    expect(status.projectsCount).toBe(2);
  });

  it('getStatus() reports exists=false for a missing root', async () => {
    const config = createConfigStub({ arenaRoot: tmpRoot });
    const svc = new ArenaRootService(config);
    // Do NOT call ensure() — tmpRoot was deleted in beforeEach.

    const status = await svc.getStatus();
    expect(status.exists).toBe(false);
    expect(status.writable).toBe(false);
    expect(status.consensusReady).toBe(false);
    expect(status.projectsCount).toBe(0);
  });

  it('getStatus() reports consensusReady=false when one consensus subdir is missing', async () => {
    const config = createConfigStub({ arenaRoot: tmpRoot });
    const svc = new ArenaRootService(config);
    await svc.ensure();

    // Remove one of the required sub-subdirs.
    fs.rmSync(path.join(tmpRoot, 'consensus', 'scratch'), { recursive: true });

    const status = await svc.getStatus();
    expect(status.consensusReady).toBe(false);
    // Other flags stay green since the root itself is fine.
    expect(status.exists).toBe(true);
    expect(status.writable).toBe(true);
  });

  // ── path accessors ─────────────────────────────────────────────────

  it('exposes dbPath/consensusPath/projectsRoot/logsPath derived from currentPath', () => {
    const config = createConfigStub({ arenaRoot: tmpRoot });
    const svc = new ArenaRootService(config);

    expect(svc.consensusPath()).toBe(path.join(tmpRoot, 'consensus'));
    expect(svc.dbPath()).toBe(path.join(tmpRoot, 'db', 'arena.sqlite'));
    expect(svc.projectsRoot()).toBe(path.join(tmpRoot, 'projects'));
    expect(svc.logsPath()).toBe(path.join(tmpRoot, 'logs'));
  });

  // ── setPath() ──────────────────────────────────────────────────────

  it('setPath() updates settings + current path and emits pathChanged (no disk I/O)', () => {
    const config = createConfigStub({ arenaRoot: tmpRoot });
    const svc = new ArenaRootService(config);

    const captured: string[] = [];
    svc.on(ARENA_ROOT_PATH_CHANGED_EVENT, (p: string) => captured.push(p));

    const next = path.join(tmpRoot, '..', 'alt-arena-root-never-created');
    svc.setPath(next);

    expect(svc.getPath()).toBe(next);
    expect(config.state.arenaRoot).toBe(next);
    expect(captured).toEqual([next]);
    // Crucially, setPath must NOT create the new directory.
    expect(fs.existsSync(next)).toBe(false);
  });
});
