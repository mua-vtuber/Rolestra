/**
 * ProjectRepository — thin data-access layer over the `projects` +
 * `project_members` tables introduced in migration 002-projects.
 *
 * Responsibilities:
 *   - Map the SQL snake_case columns to the shared camelCase `Project`
 *     interface (`src/shared/project-types.ts`).
 *   - Expose CRUD primitives the `ProjectService` composes into atomic
 *     transactions. The repository itself does NOT coordinate filesystem
 *     work — that lives in `ProjectService`.
 *   - Structurally satisfy `ProjectLookup` (see
 *     `src/main/files/permission-service.ts`) via `get(id)`.
 *
 * Update safety:
 *   `update(id, patch)` whitelists the columns a caller may change. `id` and
 *   `created_at` are immutable by design — the whitelist is the only thing
 *   standing between a future bug and silent primary-key drift, so keep it
 *   tight.
 */

import type Database from 'better-sqlite3';
import type {
  Project,
  ProjectKind,
  ProjectMember,
  ProjectStatus,
  PermissionMode,
  AutonomyMode,
} from '../../shared/project-types';

/** Snake-case row shape as returned by better-sqlite3. */
interface ProjectRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  kind: ProjectKind;
  external_link: string | null;
  permission_mode: PermissionMode;
  autonomy_mode: AutonomyMode;
  status: ProjectStatus;
  created_at: number;
  archived_at: number | null;
}

interface ProjectMemberRow {
  project_id: string;
  provider_id: string;
  role_at_project: string | null;
  added_at: number;
}

/**
 * Columns `update()` is allowed to mutate. `id` / `slug` / `created_at` are
 * structural invariants and stay read-only after insertion.
 */
const _UPDATABLE_COLUMNS = [
  'name',
  'description',
  'kind',
  'external_link',
  'permission_mode',
  'autonomy_mode',
  'status',
  'archived_at',
] as const;

type UpdatableColumn = (typeof _UPDATABLE_COLUMNS)[number];

/** Camel-case patch accepted by `update()`. */
export interface ProjectUpdatePatch {
  name?: string;
  description?: string;
  kind?: ProjectKind;
  externalLink?: string | null;
  permissionMode?: PermissionMode;
  autonomyMode?: AutonomyMode;
  status?: ProjectStatus;
  archivedAt?: number | null;
}

/**
 * camelCase patch key → snake_case column. Kept in sync with
 * `UPDATABLE_COLUMNS`. Any camelCase key not present here is silently
 * dropped by `update()` — defence in depth if the TS type is bypassed.
 */
const PATCH_KEY_TO_COLUMN: Record<keyof ProjectUpdatePatch, UpdatableColumn> = {
  name: 'name',
  description: 'description',
  kind: 'kind',
  externalLink: 'external_link',
  permissionMode: 'permission_mode',
  autonomyMode: 'autonomy_mode',
  status: 'status',
  archivedAt: 'archived_at',
};

function rowToProject(row: ProjectRow): Project {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description ?? '',
    kind: row.kind,
    externalLink: row.external_link,
    permissionMode: row.permission_mode,
    autonomyMode: row.autonomy_mode,
    status: row.status,
    createdAt: row.created_at,
    archivedAt: row.archived_at,
  };
}

function rowToMember(row: ProjectMemberRow): ProjectMember {
  return {
    projectId: row.project_id,
    providerId: row.provider_id,
    roleAtProject: row.role_at_project,
    addedAt: row.added_at,
  };
}

export class ProjectRepository {
  constructor(private readonly db: Database.Database) {}

  /**
   * Runs `fn` inside a better-sqlite3 transaction. Nested writes performed
   * through this repository (or any other SQL bound to the same handle)
   * are rolled back atomically if `fn` throws.
   *
   * Exposed so the service can compose `insert` + multiple `addMember`
   * calls into a single atomic write without the service poking at the
   * underlying Database handle. Synchronous by design — better-sqlite3
   * transactions cannot span awaits.
   */
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  /** Returns the project row, or `null` when the id is unknown. */
  get(id: string): Project | null {
    const row = this.db
      .prepare(
        `SELECT id, slug, name, description, kind, external_link,
                permission_mode, autonomy_mode, status, created_at, archived_at
         FROM projects WHERE id = ?`,
      )
      .get(id) as ProjectRow | undefined;
    return row ? rowToProject(row) : null;
  }

  /** Returns the project row by slug, or `null` when unknown. */
  getBySlug(slug: string): Project | null {
    const row = this.db
      .prepare(
        `SELECT id, slug, name, description, kind, external_link,
                permission_mode, autonomy_mode, status, created_at, archived_at
         FROM projects WHERE slug = ?`,
      )
      .get(slug) as ProjectRow | undefined;
    return row ? rowToProject(row) : null;
  }

  /**
   * Counts rows matching `status`. Used by the dashboard aggregator
   * (R4 §7.5 `activeProjects` KPI) — returning a raw number keeps the
   * hot path a single indexed SELECT COUNT rather than `list().length`
   * which would materialise every row.
   */
  countByStatus(status: ProjectStatus): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS n FROM projects WHERE status = ?')
      .get(status) as { n: number };
    return row.n;
  }

  /** Lists all projects ordered by `created_at` ascending (stable UI order). */
  list(): Project[] {
    const rows = this.db
      .prepare(
        `SELECT id, slug, name, description, kind, external_link,
                permission_mode, autonomy_mode, status, created_at, archived_at
         FROM projects ORDER BY created_at ASC`,
      )
      .all() as ProjectRow[];
    return rows.map(rowToProject);
  }

  /**
   * Inserts a fully-populated project row. Caller is responsible for
   * generating `id` (UUID) and `created_at`. No FS side-effects — the
   * service layer coordinates disk + DB.
   */
  insert(project: Project): void {
    this.db
      .prepare(
        `INSERT INTO projects (
           id, slug, name, description, kind, external_link,
           permission_mode, autonomy_mode, status, created_at, archived_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        project.id,
        project.slug,
        project.name,
        project.description,
        project.kind,
        project.externalLink,
        project.permissionMode,
        project.autonomyMode,
        project.status,
        project.createdAt,
        project.archivedAt,
      );
  }

  /**
   * Applies a whitelisted column patch. Keys absent from
   * `PATCH_KEY_TO_COLUMN` are dropped silently. Returns `true` when at
   * least one column was updated (ie. row with `id` existed AND patch had
   * at least one writable key).
   */
  update(id: string, patch: ProjectUpdatePatch): boolean {
    const assignments: string[] = [];
    const values: unknown[] = [];

    for (const [key, value] of Object.entries(patch) as [
      keyof ProjectUpdatePatch,
      ProjectUpdatePatch[keyof ProjectUpdatePatch],
    ][]) {
      if (value === undefined) continue;
      const column = PATCH_KEY_TO_COLUMN[key];
      if (!column) continue; // defensive — impossible with the TS type
      assignments.push(`${column} = ?`);
      values.push(value);
    }

    if (assignments.length === 0) return false;

    values.push(id);
    const result = this.db
      .prepare(`UPDATE projects SET ${assignments.join(', ')} WHERE id = ?`)
      .run(...values);
    return result.changes > 0;
  }

  /**
   * Hard-deletes a row. Only used in rollback scenarios — normal lifecycle
   * uses `archive` via the service. ON DELETE CASCADE tears down members.
   */
  delete(id: string): void {
    this.db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  }

  // ── project_members ─────────────────────────────────────────────────

  /** Inserts (or replaces) a member row. */
  addMember(
    projectId: string,
    providerId: string,
    roleAtProject: string | null,
    addedAt: number,
  ): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO project_members
           (project_id, provider_id, role_at_project, added_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(projectId, providerId, roleAtProject, addedAt);
  }

  /**
   * Removes a member. Returns `true` when a row was actually deleted (the
   * pair existed), `false` when it did not.
   */
  removeMember(projectId: string, providerId: string): boolean {
    const result = this.db
      .prepare(
        'DELETE FROM project_members WHERE project_id = ? AND provider_id = ?',
      )
      .run(projectId, providerId);
    return result.changes > 0;
  }

  /** Lists members of `projectId` ordered by join time (oldest first). */
  listMembers(projectId: string): ProjectMember[] {
    const rows = this.db
      .prepare(
        `SELECT project_id, provider_id, role_at_project, added_at
         FROM project_members WHERE project_id = ? ORDER BY added_at ASC`,
      )
      .all(projectId) as ProjectMemberRow[];
    return rows.map(rowToMember);
  }
}
