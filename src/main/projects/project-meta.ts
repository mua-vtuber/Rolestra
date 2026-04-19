/**
 * `.arena/meta.json` reader/writer.
 *
 * The DB (`projects` row) is the source of truth; `meta.json` is a portable
 * copy written next to the project folder so the content can be recognised
 * when copied to another machine. See spec §5 ("권한·접근 진실의 원천 …
 * `.arena/meta.json`은 포터블 참조일 뿐. 불일치 시 DB 우선.").
 *
 * Write strategy — atomic:
 *   1. Ensure `<rootPath>/.arena/` exists.
 *   2. Write the serialised JSON to a unique `meta.json.tmp-<pid>-<rand>`.
 *   3. `fs.renameSync` the tmp file over the final path.
 *
 * `fs.renameSync` is atomic on the same filesystem on both POSIX and
 * Windows, so readers either see the old file or the complete new one —
 * never a half-written one.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { Project, ProjectMeta } from '../../shared/project-types';

/** Subdirectory (relative to a project root) that holds meta.json. */
const ARENA_DIR = '.arena';
/** File name of the project metadata document. */
const META_FILENAME = 'meta.json';
/** Schema version baked into every meta.json this code writes. */
const META_SCHEMA_VERSION = 1 as const;

/**
 * Build the `ProjectMeta` snapshot from a persisted `Project` row.
 * External projects include the `externalLink` real path; other kinds omit
 * it entirely (rather than emitting `null`) so the file stays compact.
 */
export function buildProjectMeta(project: Project): ProjectMeta {
  const base: ProjectMeta = {
    id: project.id,
    name: project.name,
    kind: project.kind,
    permissionMode: project.permissionMode,
    autonomyMode: project.autonomyMode,
    schemaVersion: META_SCHEMA_VERSION,
  };
  if (project.kind === 'external' && project.externalLink !== null) {
    base.externalLink = project.externalLink;
  }
  return base;
}

/**
 * Atomically write `meta.json` under `<rootPath>/.arena/meta.json`.
 *
 * The `rootPath` directory itself must already exist (the caller creates it
 * as part of the project-create transaction). The `.arena/` subdir is
 * created on demand.
 *
 * Uses `tmp + renameSync` so a crash mid-write cannot leave a truncated or
 * half-serialised meta.json on disk.
 */
export function writeProjectMeta(rootPath: string, meta: ProjectMeta): void {
  const arenaDir = path.join(rootPath, ARENA_DIR);
  fs.mkdirSync(arenaDir, { recursive: true });

  const finalPath = path.join(arenaDir, META_FILENAME);
  const payload = `${JSON.stringify(meta, null, 2)}\n`;

  // pid + 8 random hex chars — avoids collisions between parallel creations
  // of the same project slug from two processes sharing the same tmp dir.
  const tmpName = `${META_FILENAME}.tmp-${process.pid}-${randomBytes(4).toString(
    'hex',
  )}`;
  const tmpPath = path.join(arenaDir, tmpName);

  try {
    fs.writeFileSync(tmpPath, payload, 'utf-8');
    fs.renameSync(tmpPath, finalPath);
  } catch (err) {
    // Best-effort cleanup so a failed rename cannot leave orphaned .tmp
    // files polluting the user's project folder.
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      // ignore — tmp may never have been created
    }
    throw err;
  }
}

/**
 * Read `meta.json` from a project folder. Returns `null` when the file does
 * not exist (e.g. freshly-mounted external project without prior
 * initialisation). Malformed JSON throws — a corrupt meta.json is a bug,
 * not a recoverable state.
 */
export function readProjectMeta(rootPath: string): ProjectMeta | null {
  const metaPath = path.join(rootPath, ARENA_DIR, META_FILENAME);
  if (!fs.existsSync(metaPath)) return null;
  const raw = fs.readFileSync(metaPath, 'utf-8');
  return JSON.parse(raw) as ProjectMeta;
}
