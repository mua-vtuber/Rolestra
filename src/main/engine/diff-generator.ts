/**
 * DiffGenerator — tracks file changes between pre/post execution snapshots.
 *
 * Takes a snapshot of file contents before execution starts,
 * then generates unified-style diffs after execution completes.
 * Used to provide review context to reviewer AIs.
 *
 * Ignores .git/, node_modules/, and .arena/ directories.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import type { ReviewDiffEntry } from '../../shared/message-protocol-types';

const IGNORED_DIRS = new Set(['.git', 'node_modules', '.arena']);

export class DiffGenerator {
  private _snapshotHashes = new Map<string, string>();
  private _snapshotContents = new Map<string, string>();

  /** Take a snapshot of all files under projectPath. */
  snapshot(projectPath: string): void {
    this._snapshotHashes.clear();
    this._snapshotContents.clear();
    this.walkDir(projectPath, projectPath);
  }

  /** Generate diffs comparing current state to the snapshot. */
  async generateDiffs(projectPath: string): Promise<ReviewDiffEntry[]> {
    const currentHashes = new Map<string, string>();
    const currentContents = new Map<string, string>();
    this.walkDirInto(projectPath, projectPath, currentHashes, currentContents);

    const diffs: ReviewDiffEntry[] = [];

    // Check for modified and deleted files
    for (const [relPath, oldHash] of this._snapshotHashes) {
      const newHash = currentHashes.get(relPath);
      if (newHash === undefined) {
        // Deleted
        const oldContent = this._snapshotContents.get(relPath) ?? '';
        diffs.push({
          file: relPath,
          diff: this.formatDiff(relPath, oldContent, null),
        });
      } else if (newHash !== oldHash) {
        // Modified
        const oldContent = this._snapshotContents.get(relPath) ?? '';
        const newContent = currentContents.get(relPath) ?? '';
        diffs.push({
          file: relPath,
          diff: this.formatDiff(relPath, oldContent, newContent),
        });
      }
    }

    // Check for new files
    for (const [relPath] of currentHashes) {
      if (!this._snapshotHashes.has(relPath)) {
        const newContent = currentContents.get(relPath) ?? '';
        diffs.push({
          file: relPath,
          diff: this.formatDiff(relPath, null, newContent),
        });
      }
    }

    return diffs;
  }

  // ── Private ──────────────────────────────────────────────────────

  private walkDir(rootPath: string, currentPath: string): void {
    this.walkDirInto(rootPath, currentPath, this._snapshotHashes, this._snapshotContents);
  }

  private walkDirInto(
    rootPath: string,
    currentPath: string,
    hashes: Map<string, string>,
    contents: Map<string, string>,
  ): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        this.walkDirInto(rootPath, path.join(currentPath, entry.name), hashes, contents);
      } else if (entry.isFile()) {
        const fullPath = path.join(currentPath, entry.name);
        const relPath = path.relative(rootPath, fullPath);
        try {
          const content = fs.readFileSync(fullPath, 'utf-8');
          const hash = createHash('sha256').update(content).digest('hex');
          hashes.set(relPath, hash);
          contents.set(relPath, content);
        } catch {
          // Skip unreadable files
        }
      }
    }
  }

  private formatDiff(
    filePath: string,
    oldContent: string | null,
    newContent: string | null,
  ): string {
    const lines: string[] = [];

    if (oldContent === null && newContent !== null) {
      // New file
      lines.push(`--- /dev/null`);
      lines.push(`+++ b/${filePath}`);
      for (const line of newContent.split('\n')) {
        lines.push(`+${line}`);
      }
    } else if (oldContent !== null && newContent === null) {
      // Deleted file
      lines.push(`--- a/${filePath}`);
      lines.push(`+++ /dev/null`);
      for (const line of oldContent.split('\n')) {
        lines.push(`-${line}`);
      }
    } else if (oldContent !== null && newContent !== null) {
      // Modified file
      lines.push(`--- a/${filePath}`);
      lines.push(`+++ b/${filePath}`);
      const oldLines = oldContent.split('\n');
      const newLines = newContent.split('\n');
      for (const line of oldLines) {
        lines.push(`-${line}`);
      }
      for (const line of newLines) {
        lines.push(`+${line}`);
      }
    }

    return lines.join('\n');
  }
}
