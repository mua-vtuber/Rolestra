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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ARENA_ROOT_ENV_OVERRIDE,
  ARENA_ROOT_PATH_CHANGED_EVENT,
  ARENA_ROOT_SUBDIRS,
  ArenaRootService,
  getDefaultArenaRoot,
  type ArenaRootConfigAccessor,
} from '../arena-root-service';
import { AbsolutePathError } from '../../../shared/absolute-path';

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

  // ── F4-Task6: documentsPath injection ──────────────────────────────

  it('honours an injected documentsPath when computing the platform default', () => {
    const config = createConfigStub({ arenaRoot: '' });
    const customDocs = path.join(tmpRoot, 'CustomDocs');
    const svc = new ArenaRootService(config, customDocs);

    expect(svc.getPath()).toBe(path.join(customDocs, 'Rolestra'));
  });

  it('getDefaultArenaRoot() with documentsPath joins the OS-localized base', () => {
    expect(getDefaultArenaRoot('/home/user/Localized')).toBe(
      path.join('/home/user/Localized', 'Rolestra'),
    );
  });

  it('getDefaultArenaRoot() without documentsPath retains the legacy ~/Documents fallback', () => {
    expect(getDefaultArenaRoot()).toBe(path.join(os.homedir(), 'Documents', 'Rolestra'));
  });

  it('configured arenaRoot wins over documentsPath default', () => {
    const config = createConfigStub({ arenaRoot: tmpRoot });
    const svc = new ArenaRootService(config, '/elsewhere/Documents');

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

  it('getStatus() does not leak the writable probe file on success', async () => {
    const config = createConfigStub({ arenaRoot: tmpRoot });
    const svc = new ArenaRootService(config);
    await svc.ensure();

    const status = await svc.getStatus();
    expect(status.writable).toBe(true);

    // Root directory must not contain any `.arena-writable-test*` leftovers.
    const entries = fs.readdirSync(tmpRoot);
    const probeResidue = entries.filter((name) => name.startsWith('.arena-writable-test'));
    expect(probeResidue).toEqual([]);
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

    // R12-X T2: setPath 는 값을 `path.resolve` 로 정규화한 뒤 저장한다.
    // `..` 이 남은 채로 저장되면 같은 폴더가 두 가지 철자로 굳어져 봉인
    // 판정 (`isPathWithin`) 이 뿌리와 후보의 철자를 비교할 때 어긋난다.
    const requested = path.join(tmpRoot, '..', 'alt-arena-root-never-created');
    const normalized = path.resolve(requested);
    svc.setPath(requested);

    expect(svc.getPath()).toBe(normalized);
    expect(config.state.arenaRoot).toBe(normalized);
    expect(captured).toEqual([normalized]);
    // Crucially, setPath must NOT create the new directory.
    expect(fs.existsSync(normalized)).toBe(false);
  });

  // ── R12-X T2: AbsolutePath 경계 검증 ────────────────────────────────

  it('setPath() 는 빈 경로를 거부한다 — 앱 실행 폴더가 뿌리로 둔갑하지 않게', () => {
    const config = createConfigStub({ arenaRoot: tmpRoot });
    const svc = new ArenaRootService(config);

    expect(() => svc.setPath('')).toThrow(AbsolutePathError);
    // 거부된 값이 settings 에 남지 않아야 한다.
    expect(config.state.arenaRoot).toBe(tmpRoot);
  });

  it('setPath() 는 공백뿐인 경로도 거부한다', () => {
    const config = createConfigStub({ arenaRoot: tmpRoot });
    const svc = new ArenaRootService(config);

    expect(() => svc.setPath('   ')).toThrow(AbsolutePathError);
  });

  it('상대 경로로 저장된 settings.arenaRoot 는 절대화되지 않고 거부된다', () => {
    // cwd 를 채워 절대화하면 `<앱 실행 폴더>/relative/arena` 가 ArenaRoot 로
    // 승격되어, R12-X 가 막으려던 "앱 실행 폴더를 뿌리로 착각" 사고가 타입
    // 초록불 아래 그대로 재현된다. 그래서 절대화가 아니라 실패다.
    const config = createConfigStub({ arenaRoot: 'relative/arena' });

    expect(() => new ArenaRootService(config)).toThrow(AbsolutePathError);
  });

  it('상대 경로 ROLESTRA_ARENA_ROOT 도 거부된다', () => {
    // `vi.stubEnv` 를 쓰면 복원이 `unstubAllEnvs` 로 끝나 정리 코드가
    // 다른 테스트의 env 를 건드릴 여지가 없다.
    vi.stubEnv(ARENA_ROOT_ENV_OVERRIDE, 'env/relative/arena');
    try {
      expect(() => new ArenaRootService(createConfigStub({ arenaRoot: tmpRoot }))).toThrow(
        AbsolutePathError,
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('setPath() 는 상대 경로도 거부한다 — settings 에 남지 않는다', () => {
    const config = createConfigStub({ arenaRoot: tmpRoot });
    const svc = new ArenaRootService(config);

    expect(() => svc.setPath('relative/arena')).toThrow(AbsolutePathError);
    expect(config.state.arenaRoot).toBe(tmpRoot);
    expect(svc.getPath()).toBe(tmpRoot);
  });
});
