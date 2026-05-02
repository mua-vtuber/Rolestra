/**
 * ArenaRootService — manages the user's ArenaRoot directory.
 *
 * The ArenaRoot is a single folder that holds every Rolestra artifact on disk:
 *   <ArenaRoot>/
 *     consensus/documents/
 *     consensus/meetings/
 *     consensus/scratch/
 *     projects/
 *     db/arena.sqlite
 *     logs/
 *
 * Responsibilities:
 * - Resolve the current root path from settings (or default `~/Documents/arena`).
 * - Ensure the 6 canonical subdirectories exist (mkdir -p, idempotent).
 * - Report status (exists / writable / consensusReady / projectsCount).
 * - Update the root via `setPath()` which only mutates settings and emits a
 *   `pathChanged` event; it never touches the filesystem (caller must re-ensure).
 *
 * Ported from `tools/cli-smoke/src/arena-root.ts` (R1) and extended with:
 * - 3 consensus sub-subdirectories (documents / meetings / scratch)
 * - Writable probe via a temporary marker file
 * - EventEmitter integration
 */

import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ArenaRootStatus } from '../../shared/arena-root-types';
import type { ConfigServiceImpl } from '../config/config-service';

/** Canonical subdirectories under ArenaRoot. Creation order is insignificant. */
export const ARENA_ROOT_SUBDIRS = [
  'consensus/documents',
  'consensus/meetings',
  'consensus/scratch',
  'projects',
  'db',
  'logs',
  'avatars',
] as const;

/** Top-level subdir names used by path accessors. */
const CONSENSUS_DIR = 'consensus';
const PROJECTS_DIR = 'projects';
const DB_DIR = 'db';
const LOGS_DIR = 'logs';
const AVATARS_DIR = 'avatars';
const DB_FILENAME = 'arena.sqlite';
const WRITABLE_PROBE_FILENAME = '.arena-writable-test';

/** Consensus sub-subdirs probed by `consensusReady`. */
const CONSENSUS_REQUIRED_SUBDIRS = ['documents', 'meetings', 'scratch'] as const;

/** Event emitted when `setPath()` changes the configured ArenaRoot path. */
export const ARENA_ROOT_PATH_CHANGED_EVENT = 'pathChanged';

/**
 * Minimal ConfigService surface the service needs. Allows tests to supply a
 * lightweight in-memory stub instead of the full ConfigServiceImpl.
 */
export interface ArenaRootConfigAccessor {
  getSettings(): { arenaRoot: string };
  updateSettings(patch: { arenaRoot?: string }): void;
}

/**
 * Returns the platform-default ArenaRoot location: `<documents>/Rolestra`.
 *
 * F4-Task6: `documentsPath` is now caller-injected so production code
 * can pass `app.getPath('documents')` (Electron's OS-localized resolver
 * — handles 한국어 Windows `내 문서`, 日本語 `ドキュメント`, OneDrive
 * redirects, …) instead of the hardcoded English `'Documents'` literal.
 * Tests / non-Electron contexts may omit it to reuse the legacy
 * `os.homedir()/Documents` fallback, which still beats no path at all
 * but is acknowledged as imperfect on non-English systems.
 *
 * R12-C round 2 (2026-05-03): 디폴트 폴더 이름을 'arena' → 'Rolestra' 로
 * 변경. 사용자가 Documents 안에서 폴더 이름만으로 이게 어느 앱의
 * 데이터인지 즉시 알 수 있게 한다. 기존 사용자는 settings.json 의
 * arenaRoot 값이 그대로 유지되므로 영향 없음 — 신규 설치만 영향.
 */
export function getDefaultArenaRoot(documentsPath?: string): string {
  const base = documentsPath ?? path.join(os.homedir(), 'Documents');
  return path.join(base, 'Rolestra');
}

/**
 * Environment variable that overrides the settings-based ArenaRoot path.
 *
 * Dev/test only. When set to a non-empty string, the service will prefer
 * this value over `settings.arenaRoot` at construction time. The override
 * is *not* persisted to settings — it only affects the in-memory
 * `currentPath`, so a subsequent `setPath()` from the user still goes
 * through `updateSettings` and writes to disk as usual.
 *
 * Primary consumer: the Playwright Electron E2E harness (R4-Task12),
 * which launches the app against a fresh temp directory per test.
 */
export const ARENA_ROOT_ENV_OVERRIDE = 'ROLESTRA_ARENA_ROOT';

/**
 * ArenaRootService.
 *
 * Emits:
 *   'pathChanged' (newPath: string) — after `setPath()` updates the path.
 */
export class ArenaRootService extends EventEmitter {
  private currentPath: string;

  /**
   * @param config - settings accessor (full ConfigService or test stub).
   * @param documentsPath - F4-Task6 optional OS-localized Documents
   *   directory used to compute the platform default. Production wiring
   *   in `main/index.ts` passes `app.getPath('documents')`; tests may
   *   omit it (the constructor falls back to `~/Documents`).
   */
  constructor(
    private readonly config: ArenaRootConfigAccessor | ConfigServiceImpl,
    documentsPath?: string,
  ) {
    super();
    // Resolution order (dev/test first → user settings → platform default):
    //   1. `ROLESTRA_ARENA_ROOT` env var — set by the E2E harness. Never
    //      persisted to settings so the next non-test launch restores the
    //      user's real root.
    //   2. `settings.arenaRoot` — the user-chosen path from ConfigService.
    //   3. `getDefaultArenaRoot(documentsPath)` — `<documents>/arena`.
    const envOverride = process.env[ARENA_ROOT_ENV_OVERRIDE] ?? '';
    const configured = (config.getSettings() as { arenaRoot?: string }).arenaRoot ?? '';
    if (envOverride.length > 0) {
      this.currentPath = envOverride;
    } else if (configured.length > 0) {
      this.currentPath = configured;
    } else {
      this.currentPath = getDefaultArenaRoot(documentsPath);
    }
  }

  /**
   * Ensures the ArenaRoot and all required subdirectories exist.
   * - Idempotent (mkdir -p).
   * - Throws if the root path exists but is not a directory (e.g. a regular file).
   */
  async ensure(): Promise<void> {
    const absRoot = path.resolve(this.currentPath);
    if (fs.existsSync(absRoot) && !fs.statSync(absRoot).isDirectory()) {
      throw new Error(`ArenaRoot path exists but is not a directory: ${absRoot}`);
    }
    await fsp.mkdir(absRoot, { recursive: true });
    for (const sub of ARENA_ROOT_SUBDIRS) {
      await fsp.mkdir(path.join(absRoot, sub), { recursive: true });
    }
  }

  /** Current absolute ArenaRoot path. */
  getPath(): string {
    return this.currentPath;
  }

  /** `<ArenaRoot>/consensus` — parent of documents/meetings/scratch. */
  consensusPath(): string {
    return path.join(this.currentPath, CONSENSUS_DIR);
  }

  /** `<ArenaRoot>/db/arena.sqlite` — SQLite file location. */
  dbPath(): string {
    return path.join(this.currentPath, DB_DIR, DB_FILENAME);
  }

  /** `<ArenaRoot>/projects` — parent of per-project directories. */
  projectsRoot(): string {
    return path.join(this.currentPath, PROJECTS_DIR);
  }

  /** `<ArenaRoot>/logs`. */
  logsPath(): string {
    return path.join(this.currentPath, LOGS_DIR);
  }

  /**
   * `<ArenaRoot>/avatars` — destination for custom member avatars
   * (R8-Task5, spec §7.1).
   *
   * Always returns a path; the directory itself is created by
   * {@link ensure} (already includes `'avatars'` in {@link ARENA_ROOT_SUBDIRS}).
   * The AvatarStore additionally `mkdir -p`'s on each `copy()` so a stale
   * deletion between boot and a save action does not surface as ENOENT.
   */
  avatarsPath(): string {
    return path.join(this.currentPath, AVATARS_DIR);
  }

  /**
   * Reports the current state of the ArenaRoot directory.
   *
   * - `exists`: root directory exists on disk.
   * - `writable`: a probe file can be written and deleted at the root.
   * - `consensusReady`: consensus/{documents,meetings,scratch} all exist.
   * - `projectsCount`: number of direct entries (files or dirs) under projects/.
   *   Returns 0 if the projects/ directory is missing.
   */
  async getStatus(): Promise<ArenaRootStatus> {
    const absRoot = path.resolve(this.currentPath);
    const exists =
      fs.existsSync(absRoot) && fs.statSync(absRoot).isDirectory();

    let writable = false;
    if (exists) {
      const probe = path.join(absRoot, WRITABLE_PROBE_FILENAME);
      try {
        await fsp.writeFile(probe, '');
        writable = true;
      } catch {
        writable = false;
      }
      // Always attempt cleanup so a failed unlink earlier (or a concurrent
      // writer) does not leave the probe file behind in the user's ArenaRoot.
      // Best-effort — ignore errors (file may never have been written, or a
      // concurrent caller may have already removed it).
      await fsp.unlink(probe).catch(() => {});
    }

    const consensusBase = path.join(absRoot, CONSENSUS_DIR);
    const consensusReady =
      exists &&
      CONSENSUS_REQUIRED_SUBDIRS.every((sub) => {
        const p = path.join(consensusBase, sub);
        return fs.existsSync(p) && fs.statSync(p).isDirectory();
      });

    let projectsCount = 0;
    const projectsPath = path.join(absRoot, PROJECTS_DIR);
    if (fs.existsSync(projectsPath) && fs.statSync(projectsPath).isDirectory()) {
      projectsCount = (await fsp.readdir(projectsPath)).length;
    }

    return {
      path: absRoot,
      exists,
      writable,
      consensusReady,
      projectsCount,
    };
  }

  /**
   * Updates the configured ArenaRoot path in settings and emits
   * `'pathChanged'`. Does NOT touch the filesystem — callers must invoke
   * `ensure()` afterwards to create the new directory tree.
   */
  setPath(newPath: string): void {
    this.config.updateSettings({ arenaRoot: newPath });
    this.currentPath = newPath;
    this.emit(ARENA_ROOT_PATH_CHANGED_EVENT, newPath);
  }
}
