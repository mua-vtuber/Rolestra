/**
 * ChannelRepository — thin data-access layer over the `channels` +
 * `channel_members` tables introduced in migration 003-channels.
 *
 * Responsibilities:
 *   - Map the SQL snake_case columns to the shared camelCase `Channel` /
 *     `ChannelMember` interfaces (`src/shared/channel-types.ts`).
 *   - Expose CRUD primitives the {@link ChannelService} composes into
 *     atomic transactions. No filesystem work, no policy logic.
 *   - Preserve the `read_only` INTEGER ↔ boolean mapping at the boundary
 *     so the rest of the codebase sees a proper boolean.
 *
 * Update safety:
 *   `update(id, patch)` whitelists the columns a caller may change. `id` /
 *   `project_id` / `kind` / `created_at` are structural invariants and stay
 *   read-only after insertion — the whitelist is the only thing standing
 *   between a future bug and silent mutation of those fields.
 */

import type Database from 'better-sqlite3';
import type {
  Channel,
  ChannelKind,
  ChannelMember,
} from '../../shared/channel-types';

/** Snake-case row shape as returned by better-sqlite3. */
interface ChannelRow {
  id: string;
  project_id: string | null;
  name: string;
  kind: ChannelKind;
  read_only: number; // 0|1
  created_at: number;
}

interface ChannelMemberRow {
  channel_id: string;
  project_id: string | null;
  provider_id: string;
}

/**
 * Columns `update()` is allowed to mutate. Everything else — `id`,
 * `project_id`, `kind`, `created_at` — stays read-only after insertion.
 */
const _UPDATABLE_COLUMNS = ['name', 'read_only'] as const;

type UpdatableColumn = (typeof _UPDATABLE_COLUMNS)[number];

/** Camel-case patch accepted by `update()`. */
export interface ChannelUpdatePatch {
  name?: string;
  readOnly?: boolean;
}

/**
 * camelCase patch key → snake_case column. Kept in sync with
 * `UPDATABLE_COLUMNS`. Any camelCase key not in this map is silently
 * dropped by `update()` — defence in depth if the TS type is bypassed.
 */
const PATCH_KEY_TO_COLUMN: Record<keyof ChannelUpdatePatch, UpdatableColumn> = {
  name: 'name',
  readOnly: 'read_only',
};

function rowToChannel(row: ChannelRow): Channel {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    kind: row.kind,
    readOnly: row.read_only === 1,
    createdAt: row.created_at,
  };
}

function rowToMember(row: ChannelMemberRow): ChannelMember {
  return {
    channelId: row.channel_id,
    projectId: row.project_id,
    providerId: row.provider_id,
  };
}

export class ChannelRepository {
  constructor(private readonly db: Database.Database) {}

  /**
   * Runs `fn` inside a better-sqlite3 transaction. Synchronous by design
   * — better-sqlite3 transactions cannot span awaits. Exposed so the
   * service can compose `insert` + multiple `addMember` calls into a
   * single atomic write.
   */
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  /** Returns the channel row, or `null` when the id is unknown. */
  get(id: string): Channel | null {
    const row = this.db
      .prepare(
        `SELECT id, project_id, name, kind, read_only, created_at
         FROM channels WHERE id = ?`,
      )
      .get(id) as ChannelRow | undefined;
    return row ? rowToChannel(row) : null;
  }

  /**
   * Lists channels belonging to the given project. System channels first
   * (ordered by their kind — `system_general` < `system_approval` <
   * `system_minutes`), then user channels by `created_at` ascending.
   *
   * The `kind_order` expression is a CASE-based secondary ordering; SQLite
   * has no ENUM type so we manually assign sort positions here.
   */
  listByProject(projectId: string): Channel[] {
    const rows = this.db
      .prepare(
        `SELECT id, project_id, name, kind, read_only, created_at,
                CASE kind
                  WHEN 'system_general'  THEN 0
                  WHEN 'system_approval' THEN 1
                  WHEN 'system_minutes'  THEN 2
                  WHEN 'user'            THEN 3
                  ELSE 4
                END AS kind_order
         FROM channels
         WHERE project_id = ?
         ORDER BY kind_order ASC, created_at ASC`,
      )
      .all(projectId) as ChannelRow[];
    return rows.map(rowToChannel);
  }

  /** Lists every DM channel (project_id IS NULL, kind = 'dm'). */
  listDms(): Channel[] {
    const rows = this.db
      .prepare(
        `SELECT id, project_id, name, kind, read_only, created_at
         FROM channels
         WHERE project_id IS NULL AND kind = 'dm'
         ORDER BY created_at ASC`,
      )
      .all() as ChannelRow[];
    return rows.map(rowToChannel);
  }

  /**
   * Returns the DM channel for the given provider, or `null` when no DM
   * exists. Relies on the partial unique index `idx_dm_unique_per_provider`
   * which guarantees at most one row.
   */
  getDmByProvider(providerId: string): Channel | null {
    const row = this.db
      .prepare(
        `SELECT c.id, c.project_id, c.name, c.kind, c.read_only, c.created_at
         FROM channels c
         JOIN channel_members cm ON cm.channel_id = c.id
         WHERE c.project_id IS NULL
           AND c.kind = 'dm'
           AND cm.provider_id = ?`,
      )
      .get(providerId) as ChannelRow | undefined;
    return row ? rowToChannel(row) : null;
  }

  /**
   * Inserts a fully-populated channel row. Caller is responsible for
   * generating `id` (UUID) and `created_at`. No side-effects on
   * channel_members — wire that up with {@link addMember} inside the
   * same transaction.
   */
  insert(channel: Channel): void {
    this.db
      .prepare(
        `INSERT INTO channels (id, project_id, name, kind, read_only, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        channel.id,
        channel.projectId,
        channel.name,
        channel.kind,
        channel.readOnly ? 1 : 0,
        channel.createdAt,
      );
  }

  /**
   * Applies a whitelisted column patch. Keys absent from
   * `PATCH_KEY_TO_COLUMN` are dropped silently. Returns `true` when at
   * least one column was updated (ie. row with `id` existed AND patch had
   * at least one writable key).
   */
  update(id: string, patch: ChannelUpdatePatch): boolean {
    const assignments: string[] = [];
    const values: unknown[] = [];

    for (const [key, value] of Object.entries(patch) as [
      keyof ChannelUpdatePatch,
      ChannelUpdatePatch[keyof ChannelUpdatePatch],
    ][]) {
      if (value === undefined) continue;
      const column = PATCH_KEY_TO_COLUMN[key];
      if (!column) continue; // defensive — impossible with the TS type
      assignments.push(`${column} = ?`);
      values.push(typeof value === 'boolean' ? (value ? 1 : 0) : value);
    }

    if (assignments.length === 0) return false;

    values.push(id);
    const result = this.db
      .prepare(`UPDATE channels SET ${assignments.join(', ')} WHERE id = ?`)
      .run(...values);
    return result.changes > 0;
  }

  /**
   * Hard-deletes a row. ON DELETE CASCADE tears down channel_members.
   * The caller (service layer) is responsible for enforcing the
   * "system channels cannot be deleted" policy before invoking this.
   */
  delete(id: string): boolean {
    const result = this.db.prepare('DELETE FROM channels WHERE id = ?').run(id);
    return result.changes > 0;
  }

  // ── channel_members ────────────────────────────────────────────────

  /**
   * Inserts a member row. The composite FK `(project_id, provider_id) →
   * project_members` is enforced by SQLite when `project_id` is non-null.
   * For DM channels both `channelProjectId` and the DM row itself are
   * NULL, so the composite FK is skipped (SQL-92 behaviour: any NULL in
   * the referenced set suppresses the check).
   *
   * Uses plain `INSERT` (not `INSERT OR IGNORE`) because the DM
   * partial-unique index (`idx_dm_unique_per_provider`) must surface as
   * a constraint violation for the service layer to translate into
   * {@link DuplicateDmError}. Idempotency is the service layer's job
   * when it needs it — see `ChannelService.addMember`.
   */
  addMember(
    channelId: string,
    channelProjectId: string | null,
    providerId: string,
  ): void {
    this.db
      .prepare(
        `INSERT INTO channel_members (channel_id, project_id, provider_id)
         VALUES (?, ?, ?)`,
      )
      .run(channelId, channelProjectId, providerId);
  }

  /**
   * Removes a member. Returns `true` when a row was actually deleted
   * (the pair existed), `false` when it did not.
   */
  removeMember(channelId: string, providerId: string): boolean {
    const result = this.db
      .prepare(
        'DELETE FROM channel_members WHERE channel_id = ? AND provider_id = ?',
      )
      .run(channelId, providerId);
    return result.changes > 0;
  }

  /** Lists members of `channelId`. Order is by `provider_id` for stability. */
  listMembers(channelId: string): ChannelMember[] {
    const rows = this.db
      .prepare(
        `SELECT channel_id, project_id, provider_id
         FROM channel_members
         WHERE channel_id = ?
         ORDER BY provider_id ASC`,
      )
      .all(channelId) as ChannelMemberRow[];
    return rows.map(rowToMember);
  }
}
