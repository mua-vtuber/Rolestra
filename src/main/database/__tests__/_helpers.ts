/**
 * Shared helpers for schema contract tests.
 *
 * Promoted from `schema-001-004.test.ts` (Task 1) so both 001-004 and 005-007
 * schema suites can share a single source of truth for fixture insertion and
 * sqlite_master probing.
 *
 * Keep this file dependency-light: importers should only need `better-sqlite3`
 * and the migration chain.
 */

import type Database from 'better-sqlite3';

/** Stable timestamp stamp for any columns that demand a non-null INTEGER. */
export const NOW = 1_700_000_000_000;

interface MasterRow {
  name: string;
}

/** Returns true if a table with `name` exists in sqlite_master. */
export function tableExists(db: Database.Database, name: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
    .get(name) as MasterRow | undefined;
  return row?.name === name;
}

/** Returns true if an index with `name` exists in sqlite_master. */
export function indexExists(db: Database.Database, name: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name = ?")
    .get(name) as MasterRow | undefined;
  return row?.name === name;
}

/** Returns true if a trigger with `name` exists in sqlite_master. */
export function triggerExists(db: Database.Database, name: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name = ?")
    .get(name) as MasterRow | undefined;
  return row?.name === name;
}

/** Inserts a single provider with the given id (and default display/kind). */
export function insertProvider(db: Database.Database, id: string): void {
  db.prepare(
    `INSERT INTO providers (id, display_name, kind, config_json, created_at, updated_at)
     VALUES (?, ?, 'api', '{}', ?, ?)`,
  ).run(id, `Provider ${id}`, NOW, NOW);
}

/** Inserts a regular (non-DM, non-external) project. */
export function insertProject(
  db: Database.Database,
  id: string,
  slug?: string,
): void {
  db.prepare(
    `INSERT INTO projects (id, slug, name, kind, permission_mode, created_at)
     VALUES (?, ?, ?, 'new', 'auto', ?)`,
  ).run(id, slug ?? id, `Project ${id}`, NOW);
}

/** Inserts a project_members row linking a project to a provider. */
export function insertProjectMember(
  db: Database.Database,
  projectId: string,
  providerId: string,
): void {
  db.prepare(
    `INSERT INTO project_members (project_id, provider_id, added_at)
     VALUES (?, ?, ?)`,
  ).run(projectId, providerId, NOW);
}

/** Inserts a channel belonging to a project. project_id=NULL means DM. */
export function insertChannel(
  db: Database.Database,
  id: string,
  projectId: string | null,
  kind: string = 'user',
  name: string = `channel-${id}`,
): void {
  db.prepare(
    `INSERT INTO channels (id, project_id, name, kind, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, projectId, name, kind, NOW);
}
