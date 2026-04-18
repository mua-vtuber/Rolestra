/**
 * Atomic patch applier for file operations.
 *
 * Supports three operations: create, modify, delete.
 * When dryRun is true, generates a diff preview without touching the filesystem.
 * When dryRun is false, applies all entries atomically (all-or-nothing)
 * with automatic rollback on failure.
 *
 * All target paths are validated against the workspace root to prevent
 * path traversal attacks (e.g., ../../etc/passwd).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  PatchSet,
  PatchEntry,
  ApplyResult,
  DiffEntry,
} from '../../shared/execution-types';

/** Snapshot of a file before modification, used for rollback. */
interface FileSnapshot {
  path: string;
  existed: boolean;
  content: string | null;
}

/**
 * Applies patch sets to the filesystem with atomic semantics.
 *
 * @param workspaceRoot - Absolute path to the allowed workspace directory.
 *   All target paths must resolve within this boundary.
 */
export class PatchApplier {
  private readonly workspaceRoot: string;

  constructor(workspaceRoot: string) {
    if (!path.isAbsolute(workspaceRoot)) {
      throw new Error(`workspaceRoot must be an absolute path: ${workspaceRoot}`);
    }
    this.workspaceRoot = path.resolve(workspaceRoot);
  }

  /**
   * Generate a diff preview without modifying files.
   *
   * @param patchSet - The patch set to preview.
   * @returns Array of diff entries showing before/after state.
   * @throws {Error} If any target path escapes the workspace root.
   */
  generateDiff(patchSet: PatchSet): DiffEntry[] {
    return patchSet.entries.map((entry) => {
      this.validatePath(entry.targetPath);
      const before = this.readFileOrNull(entry.targetPath);
      return {
        path: entry.targetPath,
        operation: entry.operation,
        before,
        after: entry.operation === 'delete' ? null : (entry.newContent ?? null),
      };
    });
  }

  /**
   * Apply a patch set to the filesystem.
   *
   * If dryRun is true, returns a diff preview only.
   * If dryRun is false, applies all entries atomically with rollback on failure.
   *
   * @param patchSet - The patch set to apply.
   * @returns The result of the apply operation.
   * @throws {Error} If any target path escapes the workspace root.
   */
  apply(patchSet: PatchSet): ApplyResult {
    if (patchSet.dryRun) {
      this.generateDiff(patchSet);
      return {
        success: true,
        appliedEntries: [],
        rolledBack: false,
      };
    }

    const snapshots: FileSnapshot[] = [];
    const appliedEntries: PatchEntry[] = [];

    for (const entry of patchSet.entries) {
      // Validate path before any filesystem access
      this.validatePath(entry.targetPath);

      const snapshot = this.captureSnapshot(entry.targetPath);
      snapshots.push(snapshot);

      try {
        this.applyEntry(entry);
        appliedEntries.push(entry);
      } catch (err) {
        this.rollback(snapshots.slice(0, -1));
        return {
          success: false,
          appliedEntries,
          error: err instanceof Error ? err.message : String(err),
          rolledBack: true,
        };
      }
    }

    return {
      success: true,
      appliedEntries,
      rolledBack: false,
    };
  }

  /**
   * Validate that a target path resolves within the workspace root.
   *
   * Prevents path traversal via:
   * - Relative paths with ".."
   * - Absolute paths outside workspace
   * - Symlink escapes (resolved via realpath)
   *
   * @throws {Error} If the path escapes the workspace boundary.
   */
  private validatePath(targetPath: string): void {
    const resolved = path.resolve(targetPath);
    const relative = path.relative(this.workspaceRoot, resolved);

    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(
        `Path traversal blocked: "${targetPath}" escapes workspace root "${this.workspaceRoot}"`,
      );
    }

    // For existing files, also check the real path (symlink resolution)
    try {
      const realPath = fs.realpathSync(resolved);
      const realRelative = path.relative(this.workspaceRoot, realPath);
      if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) {
        throw new Error(
          `Symlink escape blocked: "${targetPath}" resolves to "${realPath}" outside workspace`,
        );
      }
    } catch (err) {
      // ENOENT is expected for 'create' operations — file doesn't exist yet
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw err;
      }
    }
  }

  private applyEntry(entry: PatchEntry): void {
    switch (entry.operation) {
      case 'create':
        this.applyCreate(entry);
        break;
      case 'modify':
        this.applyModify(entry);
        break;
      case 'delete':
        this.applyDelete(entry);
        break;
    }
  }

  private applyCreate(entry: PatchEntry): void {
    if (fs.existsSync(entry.targetPath)) {
      throw new Error(
        `Cannot create file: already exists at ${entry.targetPath}`,
      );
    }
    if (entry.newContent === undefined) {
      throw new Error(
        `Cannot create file: no content provided for ${entry.targetPath}`,
      );
    }
    const dir = path.dirname(entry.targetPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(entry.targetPath, entry.newContent, 'utf-8');
  }

  private applyModify(entry: PatchEntry): void {
    if (!fs.existsSync(entry.targetPath)) {
      throw new Error(
        `Cannot modify file: does not exist at ${entry.targetPath}`,
      );
    }
    if (entry.newContent === undefined) {
      throw new Error(
        `Cannot modify file: no content provided for ${entry.targetPath}`,
      );
    }
    fs.writeFileSync(entry.targetPath, entry.newContent, 'utf-8');
  }

  private applyDelete(entry: PatchEntry): void {
    if (!fs.existsSync(entry.targetPath)) {
      throw new Error(
        `Cannot delete file: does not exist at ${entry.targetPath}`,
      );
    }
    fs.unlinkSync(entry.targetPath);
  }

  private captureSnapshot(filePath: string): FileSnapshot {
    const existed = fs.existsSync(filePath);
    return {
      path: filePath,
      existed,
      content: existed ? fs.readFileSync(filePath, 'utf-8') : null,
    };
  }

  private rollback(snapshots: FileSnapshot[]): void {
    for (let i = snapshots.length - 1; i >= 0; i--) {
      const snapshot = snapshots[i];
      try {
        if (snapshot.existed && snapshot.content !== null) {
          fs.writeFileSync(snapshot.path, snapshot.content, 'utf-8');
        } else if (!snapshot.existed) {
          if (fs.existsSync(snapshot.path)) {
            fs.unlinkSync(snapshot.path);
          }
        }
      } catch {
        // Best-effort rollback: continue with remaining snapshots
      }
    }
  }

  private readFileOrNull(filePath: string): string | null {
    try {
      return fs.readFileSync(filePath, 'utf-8');
    } catch {
      return null;
    }
  }
}
