/**
 * WorkspaceService manages the .arena/workspace/ directory structure
 * inside a user-selected project folder.
 *
 * Responsible for:
 * - Creating and verifying the workspace directory tree
 * - Providing workspace state information
 * - Determining whether a path belongs to the arena workspace
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { WorkspaceInfo, WorkspaceSubdirectory } from '../../shared/file-types';
import { WORKSPACE_SUBDIRS } from '../../shared/file-types';

/** Relative path from project root to the arena workspace. */
const ARENA_WORKSPACE_REL = path.join('.arena', 'workspace');

/**
 * Compute the set of system directories that must never be used as
 * workspace roots, normalised to lowercase on Windows so the
 * case-insensitive lookup against `resolved.toLowerCase()` matches.
 *
 * F4-Task7: previously the Windows list hardcoded `'C:\\Windows'`,
 * `'C:\\Program Files'`, and `'C:\\Program Files (x86)'`. That broke
 * for installs on non-C: drives, custom-named Windows directories, and
 * relocated `%ProgramFiles%`. The dynamic form reads the same env vars
 * that Windows itself uses (`%SystemRoot%`, `%ProgramFiles%`,
 * `%ProgramFiles(x86)%`) so the guard tracks the actual install layout.
 * If an env var is unset (stripped shell env) the corresponding entry
 * is omitted — the POSIX list and the surviving Windows entries still
 * cover the most common attack paths.
 */
function computeBlockedSystemDirs(): ReadonlySet<string> {
  if (process.platform === 'win32') {
    const candidates = [
      process.env.SystemRoot,
      process.env.ProgramFiles,
      process.env['ProgramFiles(x86)'],
    ];
    const entries = candidates
      .map((c) => (typeof c === 'string' ? c.trim() : ''))
      .filter((c) => c.length > 0)
      .map((c) => c.toLowerCase());
    return new Set(entries);
  }
  return new Set(['/', '/etc', '/usr', '/var', '/bin', '/sbin', '/lib', '/proc', '/sys']);
}

const BLOCKED_SYSTEM_DIRS: ReadonlySet<string> = computeBlockedSystemDirs();

export class WorkspaceService {
  private projectFolder: string | null = null;
  private arenaFolder: string | null = null;

  /**
   * Initialize the .arena/workspace/ directory and its subdirectories
   * inside the given project folder.
   *
   * This operation is idempotent -- calling it multiple times with the
   * same project folder is safe and will not destroy existing content.
   *
   * @param projectFolder - Absolute path to the user-selected project folder.
   * @returns WorkspaceInfo describing the created workspace.
   * @throws If projectFolder does not exist or is not a directory.
   */
  async initWorkspace(projectFolder: string): Promise<WorkspaceInfo> {
    const resolved = path.resolve(projectFolder);

    // Block system directories
    const normalized = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    if (BLOCKED_SYSTEM_DIRS.has(normalized)) {
      throw new Error(`Cannot use system directory as workspace: ${resolved}`);
    }

    // Verify the project folder exists and is a directory
    const stat = await fs.promises.stat(resolved);
    if (!stat.isDirectory()) {
      throw new Error(`Project path is not a directory: ${resolved}`);
    }

    const arena = path.join(resolved, ARENA_WORKSPACE_REL);

    // Create .arena/workspace/ and all subdirectories
    const subdirs: WorkspaceSubdirectory[] = [...WORKSPACE_SUBDIRS];
    for (const sub of subdirs) {
      await fs.promises.mkdir(path.join(arena, sub), { recursive: true });
    }

    this.projectFolder = resolved;
    this.arenaFolder = arena;

    return this.buildWorkspaceInfo();
  }

  /**
   * Return current workspace information, or null if no workspace
   * has been initialized in this service instance.
   */
  getWorkspaceInfo(): WorkspaceInfo | null {
    if (!this.projectFolder || !this.arenaFolder) {
      return null;
    }
    return this.buildWorkspaceInfo();
  }

  /** Return the project folder path, or null if not initialized. */
  getProjectFolder(): string | null {
    return this.projectFolder;
  }

  /** Return the arena workspace folder path, or null if not initialized. */
  getArenaFolder(): string | null {
    return this.arenaFolder;
  }

  /**
   * Check whether the given path resides inside the .arena/workspace/ directory.
   *
   * @param targetPath - The path to check (will be resolved to absolute).
   * @returns true if the path is inside .arena/workspace/.
   */
  isArenaPath(targetPath: string): boolean {
    if (!this.arenaFolder) {
      return false;
    }
    const resolved = path.resolve(targetPath);
    const arenaWithSep = this.arenaFolder + path.sep;
    return resolved === this.arenaFolder || resolved.startsWith(arenaWithSep);
  }

  /**
   * Clean up service state. Resets internal references but does NOT
   * delete any files on disk.
   */
  dispose(): void {
    this.projectFolder = null;
    this.arenaFolder = null;
  }

  /** Build a WorkspaceInfo snapshot from current state. */
  private buildWorkspaceInfo(): WorkspaceInfo {
    const arenaFolder = this.arenaFolder ?? '';
    const projectFolder = this.projectFolder ?? '';
    const exists = arenaFolder !== '' && fs.existsSync(arenaFolder);

    const subdirectories: WorkspaceSubdirectory[] = exists
      ? WORKSPACE_SUBDIRS.filter((sub) =>
          fs.existsSync(path.join(arenaFolder, sub)),
        )
      : [];

    return {
      projectFolder,
      arenaFolder,
      exists,
      subdirectories,
    };
  }
}
