/**
 * ChannelService — Channel CRUD with system-channel auto-provisioning.
 *
 * Responsibilities (spec §7.4 + R2 Task 10):
 *   - `create({projectId, name, kind:'user', memberProviderIds})` — insert
 *     a channel row + member rows in a single transaction. Composite FK
 *     `(project_id, provider_id) → project_members` enforces the subset
 *     invariant (CD-3): a channel member must also be a project member.
 *   - `createSystemChannels(projectId)` — create the three lock-step
 *     system channels (#일반 / #승인-대기 / #회의록) in a single
 *     transaction. Order is preserved across migrations.
 *   - `createDm(providerId)` — create a DM channel (project_id=NULL,
 *     kind='dm') + one `channel_members` row for the provider. The
 *     partial unique index `idx_dm_unique_per_provider` enforces the
 *     "one DM per provider" invariant.
 *   - `rename(id, name)` — user channels only. System channels throw
 *     {@link SystemChannelProtectedError} even though spec §7.4 notes
 *     "#일반 이름변경 가능". We err on the safe side here: R2 locks all
 *     three system channels to keep the default layout stable, and a
 *     later task can relax #일반 specifically once rename UI lands.
 *   - `delete(id)` — user + DM only. System channels throw.
 *
 * System-channel member semantics:
 *   Spec §7.4 says system channels are "project-wide visibility". We
 *   materialise `channel_members` rows for each current `project_members`
 *   entry at `createSystemChannels` time. This is the simplest correct
 *   approach: explicit rows mean uniform query paths (no special-case
 *   "is this a system channel, if so imply membership" branch) and the
 *   composite FK keeps the subset invariant honest. When a new project
 *   member is added later, the IPC layer will also insert the implied
 *   system-channel rows (that wiring belongs to Task 11+).
 *
 * Naming:
 *   DM channels use `name = `dm:${providerId}`` so the UNIQUE (project_id,
 *   name) constraint serves as a second line of defence alongside the
 *   partial unique index on members.
 *
 * Error mapping:
 *   All domain errors extend {@link ChannelError}. SQLite UNIQUE / FK
 *   violations are caught at the call sites that can identify the cause
 *   unambiguously and translated into specific error classes:
 *     - UNIQUE (project_id, name)               → DuplicateChannelNameError
 *     - idx_dm_unique_per_provider              → DuplicateDmError
 *     - FK (project_id, provider_id)            → ChannelMemberFkError
 *   Anything else bubbles as the raw SqliteError.
 */

import { randomUUID } from 'node:crypto';
import type { Channel, ChannelKind } from '../../shared/channel-types';
import type { ProjectMember } from '../../shared/project-types';
import { ChannelRepository } from './channel-repository';

// ── Error hierarchy ────────────────────────────────────────────────────

/** Base class — lets callers `catch (e instanceof ChannelError)` discriminate. */
export class ChannelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChannelError';
  }
}

/** UNIQUE(project_id, name) violation for non-DM channels. */
export class DuplicateChannelNameError extends ChannelError {
  constructor(projectId: string | null, name: string) {
    super(
      `channel name "${name}" already exists in ${
        projectId === null ? 'DM scope' : `project ${projectId}`
      }`,
    );
    this.name = 'DuplicateChannelNameError';
  }
}

/**
 * Raised when a caller tries to delete or rename a system channel
 * (`kind` starting with `system_`). System channels are part of the
 * default project layout and can only be modified via migrations.
 */
export class SystemChannelProtectedError extends ChannelError {
  constructor(channelId: string, kind: ChannelKind, op: 'delete' | 'rename') {
    super(
      `cannot ${op} system channel (id=${channelId}, kind=${kind}): ` +
        `system channels are locked as part of the default project layout`,
    );
    this.name = 'SystemChannelProtectedError';
  }
}

/**
 * Raised by `createDm(providerId)` when a DM already exists for the
 * provider. Enforced at the SQL layer by `idx_dm_unique_per_provider`
 * so this class is the translation of that partial-unique violation.
 */
export class DuplicateDmError extends ChannelError {
  constructor(providerId: string) {
    super(
      `DM channel for provider "${providerId}" already exists (one DM per provider)`,
    );
    this.name = 'DuplicateDmError';
  }
}

/**
 * Raised when `addMember` on a non-DM channel is called with a
 * `(project_id, provider_id)` pair that does not exist in
 * `project_members`. Triggered by the composite FK defined in
 * migration 003-channels.
 */
export class ChannelMemberFkError extends ChannelError {
  constructor(projectId: string, providerId: string) {
    super(
      `channel member (${providerId}) is not a member of project ${projectId} ` +
        `— add them to project_members first`,
    );
    this.name = 'ChannelMemberFkError';
  }
}

/** Raised when a channel id is not found. */
export class ChannelNotFoundError extends ChannelError {
  constructor(id: string) {
    super(`channel not found: ${id}`);
    this.name = 'ChannelNotFoundError';
  }
}

// ── Error-mapping helpers ──────────────────────────────────────────────

interface SqliteErrorLike {
  code?: unknown;
  message?: unknown;
}

function asSqliteErr(err: unknown): SqliteErrorLike | null {
  if (!err || typeof err !== 'object') return null;
  return err as SqliteErrorLike;
}

function isChannelNameUniqueViolation(err: unknown): boolean {
  const e = asSqliteErr(err);
  if (!e) return false;
  if (e.code !== 'SQLITE_CONSTRAINT_UNIQUE') return false;
  if (typeof e.message !== 'string') return false;
  // SQLite reports either "channels.project_id, channels.name" or the
  // index name depending on whether an explicit index exists. The base
  // table-constraint form is what migration 003 produces.
  return (
    e.message.includes('channels.project_id') &&
    e.message.includes('channels.name')
  );
}

function isDmUniqueViolation(err: unknown): boolean {
  const e = asSqliteErr(err);
  if (!e) return false;
  if (e.code !== 'SQLITE_CONSTRAINT_UNIQUE') return false;
  if (typeof e.message !== 'string') return false;
  // SQLite reports the partial unique index violation as either the
  // index name ("idx_dm_unique_per_provider") OR the column form
  // ("channel_members.provider_id") depending on version/flags. Both
  // phrasings mean the same thing here since the index is the ONLY
  // uniqueness constraint that mentions `channel_members.provider_id`
  // — the table's own PK is the composite `(channel_id, provider_id)`
  // which reports both columns.
  return (
    e.message.includes('idx_dm_unique_per_provider') ||
    e.message === 'UNIQUE constraint failed: channel_members.provider_id'
  );
}

function isMemberFkViolation(err: unknown): boolean {
  const e = asSqliteErr(err);
  if (!e) return false;
  // better-sqlite3 reports plain `SQLITE_CONSTRAINT_FOREIGNKEY` — it
  // does not disambiguate which FK failed. For `addMember` there is
  // exactly one FK that can fail (the composite project_members FK;
  // the `channels(id)` FK would only fail if `channelId` were bogus,
  // which we've pre-checked), so attribution is unambiguous at the
  // call site.
  return e.code === 'SQLITE_CONSTRAINT_FOREIGNKEY';
}

// ── System channel blueprint ──────────────────────────────────────────

/**
 * Fixed blueprint for the three auto-provisioned system channels.
 * Order matters: `listByProject()` relies on the kind ordering but
 * this list also determines create order (affects `created_at`).
 */
const SYSTEM_CHANNEL_BLUEPRINT: ReadonlyArray<{
  name: string;
  kind: ChannelKind;
  readOnly: boolean;
}> = [
  { name: '일반', kind: 'system_general', readOnly: false },
  { name: '승인-대기', kind: 'system_approval', readOnly: true },
  { name: '회의록', kind: 'system_minutes', readOnly: true },
];

// ── Lookup dependency ─────────────────────────────────────────────────

/**
 * Minimum surface of `ProjectRepository` that the channel service needs.
 * We inject this structurally so tests can pass in lightweight fakes and
 * so we don't widen the coupling between channels/ and projects/.
 */
export interface ProjectMemberLookup {
  listMembers(projectId: string): ProjectMember[];
}

// ── Input shapes ──────────────────────────────────────────────────────

export interface CreateUserChannelInput {
  projectId: string;
  name: string;
  memberProviderIds?: string[];
}

// ── Service ────────────────────────────────────────────────────────────

export class ChannelService {
  constructor(
    private readonly repo: ChannelRepository,
    private readonly projectMembers: ProjectMemberLookup,
  ) {}

  /**
   * Create a user channel under a project. All inserts happen in a
   * single transaction — if any `addMember` fails (e.g. composite FK),
   * the channel row is rolled back too.
   *
   * @throws {DuplicateChannelNameError} on UNIQUE (project_id, name).
   * @throws {ChannelMemberFkError}     on composite-FK violation.
   */
  create(input: CreateUserChannelInput): Channel {
    const channel: Channel = {
      id: randomUUID(),
      projectId: input.projectId,
      name: input.name,
      kind: 'user',
      readOnly: false,
      createdAt: Date.now(),
    };

    try {
      this.repo.transaction(() => {
        this.repo.insert(channel);
        for (const providerId of input.memberProviderIds ?? []) {
          this.repo.addMember(channel.id, channel.projectId, providerId);
        }
      });
    } catch (err) {
      if (isChannelNameUniqueViolation(err)) {
        throw new DuplicateChannelNameError(input.projectId, input.name);
      }
      if (isMemberFkViolation(err)) {
        // We don't know WHICH providerId failed without re-running the
        // inserts one by one; the composite FK takes precedence over
        // looking nice. Surface the project id and let the caller
        // provide the offending providerId in their own error context
        // if needed.
        throw new ChannelMemberFkError(input.projectId, '<unknown>');
      }
      throw err;
    }

    return channel;
  }

  /**
   * Create the three system channels for `projectId` in lock-step. All
   * channels + their member rows live in a single transaction — if any
   * fails, none are inserted.
   *
   * System channels materialise `channel_members` rows for every current
   * project member so that downstream queries treat membership uniformly
   * (see header comment). Projects with no members at create time simply
   * get empty member lists; the IPC layer will add rows for future
   * members in the same call that updates `project_members`.
   */
  createSystemChannels(projectId: string): Channel[] {
    const members = this.projectMembers.listMembers(projectId);
    const createdAt = Date.now();
    const channels: Channel[] = SYSTEM_CHANNEL_BLUEPRINT.map((spec, idx) => ({
      id: randomUUID(),
      projectId,
      name: spec.name,
      kind: spec.kind,
      readOnly: spec.readOnly,
      // Offset by index so the `created_at ASC` secondary ordering in
      // `listByProject` matches the blueprint order even when the three
      // inserts happen within the same millisecond.
      createdAt: createdAt + idx,
    }));

    try {
      this.repo.transaction(() => {
        for (const channel of channels) {
          this.repo.insert(channel);
          for (const member of members) {
            this.repo.addMember(channel.id, projectId, member.providerId);
          }
        }
      });
    } catch (err) {
      if (isChannelNameUniqueViolation(err)) {
        // Idempotency vs. safety: if the caller invokes this twice, we
        // surface the collision rather than silently no-op. Upstream
        // should call this exactly once per project (wired via the
        // `onProjectCreated` hook).
        throw new DuplicateChannelNameError(projectId, '<system>');
      }
      throw err;
    }

    return channels;
  }

  /**
   * Create a DM channel for the given provider. `project_id` is NULL
   * and the DB index `idx_dm_unique_per_provider` is the source of
   * truth for "one DM per provider".
   *
   * @throws {DuplicateDmError} when a DM for this provider already exists.
   */
  createDm(providerId: string): Channel {
    const channel: Channel = {
      id: randomUUID(),
      projectId: null,
      name: `dm:${providerId}`,
      kind: 'dm',
      readOnly: false,
      createdAt: Date.now(),
    };

    try {
      this.repo.transaction(() => {
        this.repo.insert(channel);
        // DM members have project_id = NULL too so the composite FK is
        // skipped (SQL-92: any NULL in referencing set suppresses check).
        this.repo.addMember(channel.id, null, providerId);
      });
    } catch (err) {
      if (isDmUniqueViolation(err)) {
        throw new DuplicateDmError(providerId);
      }
      if (isChannelNameUniqueViolation(err)) {
        // UNIQUE(project_id, name) with project_id=NULL is not enforced
        // by SQLite (NULLs compare unequal), so this branch shouldn't
        // fire for DMs — but keep it defensive for forward compatibility.
        throw new DuplicateDmError(providerId);
      }
      throw err;
    }

    return channel;
  }

  /**
   * Rename a user channel. System channels are locked; DMs are allowed
   * to be renamed (their generated name is an implementation detail but
   * callers can override for display purposes — spec §7.4 treats DMs as
   * scratch conversations).
   *
   * @throws {ChannelNotFoundError}        unknown id.
   * @throws {SystemChannelProtectedError} channel.kind startsWith system_.
   * @throws {DuplicateChannelNameError}   UNIQUE(project_id, name).
   */
  rename(id: string, newName: string): Channel {
    const existing = this.repo.get(id);
    if (!existing) throw new ChannelNotFoundError(id);
    if (existing.kind.startsWith('system_')) {
      throw new SystemChannelProtectedError(id, existing.kind, 'rename');
    }

    try {
      this.repo.update(id, { name: newName });
    } catch (err) {
      if (isChannelNameUniqueViolation(err)) {
        throw new DuplicateChannelNameError(existing.projectId, newName);
      }
      throw err;
    }

    const next = this.repo.get(id);
    if (!next) {
      // Should be impossible — we just updated the row.
      throw new ChannelError(`rename: channel disappeared after update: ${id}`);
    }
    return next;
  }

  /**
   * Delete a user or DM channel. System channels are locked.
   *
   * @throws {ChannelNotFoundError}        unknown id.
   * @throws {SystemChannelProtectedError} channel.kind startsWith system_.
   */
  delete(id: string): void {
    const existing = this.repo.get(id);
    if (!existing) throw new ChannelNotFoundError(id);
    if (existing.kind.startsWith('system_')) {
      throw new SystemChannelProtectedError(id, existing.kind, 'delete');
    }
    this.repo.delete(id);
  }

  /**
   * Add a member to a non-DM channel. Composite FK `(project_id,
   * provider_id) → project_members` is enforced by SQLite; we translate
   * the raw violation into {@link ChannelMemberFkError} here because
   * this call site can name the offending `providerId` unambiguously
   * (unlike `create`, which runs multiple inserts in one transaction).
   *
   * Idempotent on the PK `(channel_id, provider_id)`: calling this a
   * second time for the same pair is a no-op (caller sees no error).
   * That matches UI expectations — clicking "add" twice should not
   * surface a scary duplicate-key error.
   *
   * @throws {ChannelNotFoundError}     unknown channel id.
   * @throws {ChannelMemberFkError}     composite FK violation.
   */
  addMember(channelId: string, providerId: string): void {
    const channel = this.repo.get(channelId);
    if (!channel) throw new ChannelNotFoundError(channelId);

    // Idempotency guard on the PK. Done in the service (not the repo)
    // because `INSERT OR IGNORE` in the repo would mask the DM partial
    // unique index violation we rely on for `DuplicateDmError`.
    const existing = this.repo
      .listMembers(channelId)
      .find((m) => m.providerId === providerId);
    if (existing) return;

    try {
      this.repo.addMember(channelId, channel.projectId, providerId);
    } catch (err) {
      if (isMemberFkViolation(err)) {
        throw new ChannelMemberFkError(
          channel.projectId ?? '<dm>',
          providerId,
        );
      }
      throw err;
    }
  }

  /**
   * Remove a member from a channel. Returns `true` when a row was
   * actually deleted.
   */
  removeMember(channelId: string, providerId: string): boolean {
    return this.repo.removeMember(channelId, providerId);
  }

  /** Returns channel-members for `channelId` ordered by provider id. */
  listMembers(channelId: string) {
    return this.repo.listMembers(channelId);
  }

  /**
   * List channels of a project: system first (by fixed kind ordering),
   * then user channels by `created_at` ascending.
   */
  listByProject(projectId: string): Channel[] {
    return this.repo.listByProject(projectId);
  }

  /** List every DM channel. */
  listDms(): Channel[] {
    return this.repo.listDms();
  }

  /** Per-channel lookup. Returns `null` when `id` is unknown. */
  get(id: string): Channel | null {
    return this.repo.get(id);
  }
}
