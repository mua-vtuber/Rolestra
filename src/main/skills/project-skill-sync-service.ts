/**
 * ProjectSkillSyncService — R12-C Task 6.
 *
 * Writes 9 employee SKILL.md files into both:
 *   - `<projectRoot>/.claude/skills/<roleId>/SKILL.md` (Claude Code)
 *   - `<projectRoot>/.agents/skills/<roleId>/SKILL.md` (Codex / Gemini alias)
 *
 * The two paths are kept structurally identical so a future move (e.g.
 * Claude adopting `.agents/`) is a one-line change. Each provider auto-
 * loads SKILL.md from its corresponding root.
 *
 * Idempotency:
 *   - First write creates the directory + file
 *   - Subsequent writes diff against current content:
 *     * `force=true` overwrites unconditionally
 *     * unchanged content → skip + report 'unchanged'
 *     * differing content (sign of user customisation) →
 *       skip + report 'skipped' so the caller can prompt before overwrite
 *
 * Path safety:
 *   - `projectRoot` must be absolute (validated)
 *   - resolved skill path must remain inside `projectRoot` (escape guard)
 *   - meeting-summary (SystemSkillId) is intentionally excluded — system
 *     prompt only, never a directory-loaded skill.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  ALL_ROLE_IDS,
  type RoleId,
} from '../../shared/role-types';
import { renderSkillMd } from './skill-md-template';

/** Two skill roots to materialise per project. */
const SKILL_ROOT_DIRS = ['.claude/skills', '.agents/skills'] as const;
type SkillRootDir = (typeof SKILL_ROOT_DIRS)[number];

export interface SyncOptions {
  /** Overwrite even when on-disk content differs from the renderer output. */
  force?: boolean;
}

export interface SyncEntry {
  /** Absolute path of the SKILL.md file. */
  path: string;
  /** Role this entry belongs to. */
  roleId: RoleId;
  /** Skill root used (`.claude/skills` or `.agents/skills`). */
  rootDir: SkillRootDir;
}

export interface SyncResult {
  /** Files newly created or force-overwritten. */
  written: SyncEntry[];
  /** Files where on-disk content already matches the renderer output. */
  unchanged: SyncEntry[];
  /** Files left untouched because the user customised them (force=false). */
  skipped: SyncEntry[];
}

/**
 * Validates `projectRoot` and a candidate file `target` belongs inside it.
 * Throws `Error` on absolute-path / escape violations — defense in depth
 * against `..` segments slipping through the IPC boundary.
 */
function assertInsideProjectRoot(projectRoot: string, target: string): void {
  if (!path.isAbsolute(projectRoot)) {
    throw new Error(
      `ProjectSkillSyncService: projectRoot must be absolute, got '${projectRoot}'`,
    );
  }
  const normalisedRoot = path.resolve(projectRoot);
  const normalisedTarget = path.resolve(target);
  const rel = path.relative(normalisedRoot, normalisedTarget);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(
      `ProjectSkillSyncService: target '${target}' escapes projectRoot '${projectRoot}'`,
    );
  }
}

export class ProjectSkillSyncService {
  /**
   * Lays out the 9 employee SKILL.md files in both skill roots under
   * `projectRoot`. Returns a per-file classification (written / unchanged
   * / skipped). Idempotent — safe to call repeatedly on app boot.
   *
   * @param projectRoot Absolute path of the project directory.
   * @param options.force When true, overwrites files even when on-disk
   *   content differs from the renderer output (use after the user
   *   confirms they're OK with losing local SKILL.md edits).
   */
  async syncProjectSkills(
    projectRoot: string,
    options: SyncOptions = {},
  ): Promise<SyncResult> {
    if (!path.isAbsolute(projectRoot)) {
      throw new Error(
        `ProjectSkillSyncService.syncProjectSkills: projectRoot must be absolute, got '${projectRoot}'`,
      );
    }

    const result: SyncResult = { written: [], unchanged: [], skipped: [] };

    // Iterate employee roles only — SystemSkillId 'meeting-summary' is
    // intentionally excluded (system prompt only, never directory-loaded).
    for (const roleId of ALL_ROLE_IDS) {
      const body = renderSkillMd(roleId);
      for (const rootDir of SKILL_ROOT_DIRS) {
        const dirPath = path.join(projectRoot, rootDir, roleId);
        const filePath = path.join(dirPath, 'SKILL.md');
        assertInsideProjectRoot(projectRoot, filePath);

        const entry: SyncEntry = { path: filePath, roleId, rootDir };

        // Read existing content, if any.
        let existing: string | null = null;
        try {
          existing = await fs.readFile(filePath, 'utf-8');
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
          // File does not exist — first-time write.
        }

        if (existing !== null) {
          if (existing === body) {
            result.unchanged.push(entry);
            continue;
          }
          if (!options.force) {
            // User customised the file — skip without overwriting.
            result.skipped.push(entry);
            continue;
          }
          // force=true → fall through to write
        }

        await fs.mkdir(dirPath, { recursive: true });
        await fs.writeFile(filePath, body, 'utf-8');
        result.written.push(entry);
      }
    }

    return result;
  }
}
