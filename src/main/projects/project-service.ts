/**
 * ProjectService — 3-kind project lifecycle (new / external / imported).
 *
 * Responsibilities:
 *   - Create projects with **atomic DB + FS** semantics: DB INSERT and
 *     filesystem materialisation (mkdir / copy / symlink / meta.json) must
 *     both succeed or both be rolled back. Any partial filesystem state is
 *     torn down on failure.
 *   - Reject `kind='external' + permissionMode='auto'` before touching the
 *     filesystem (spec §7.3).
 *   - Persist `externalLink` as `fs.realpathSync(externalPath)` — this is
 *     the TOCTOU baseline that `PermissionService.resolveForCli()` uses to
 *     detect symlink swaps on subsequent CLI spawns (spec §7.6 CA-3).
 *   - Re-check the realpath of the junction/symlink after creation to catch
 *     races where the target was already swapped during materialisation.
 *   - Archive (soft-delete) via status change + `archived_at` timestamp.
 *     Hard delete is intentionally unavailable here; if a row must be
 *     purged, callers go through the repository directly.
 *   - On `list()`, synchronously probe each non-archived project's root
 *     directory; if it no longer exists, flip `status='folder_missing'`
 *     and return the updated state.
 *
 * Task 10 will inject a `ChannelService` stub via `opts.onProjectCreated`
 * so that system channels (#일반 / #승인-대기 / #회의록) can be created as
 * part of the same create flow. We stash the hook here now to avoid a
 * breaking-change constructor later.
 */

import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import type {
  ApprovalItem,
  ModeTransitionApprovalPayload,
} from '../../shared/approval-types';
import type {
  Project,
  ProjectCreateInput,
  ProjectMember,
  AutonomyMode,
  PermissionMode,
} from '../../shared/project-types';
import type { ArenaRootService } from '../arena/arena-root-service';
import type { CreateApprovalInput } from '../approvals/approval-service';
import { resolveProjectPaths } from '../arena/resolve-project-paths';
import { ProjectRepository } from './project-repository';
import { buildProjectMeta, writeProjectMeta } from './project-meta';
import { createLink, resolveLink } from './junction';

// ── Error hierarchy ────────────────────────────────────────────────────

/** Base class — lets callers `catch (e instanceof ProjectError)` discriminate. */
export class ProjectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectError';
  }
}

/** Raised when the resolved slug collides with an existing project. */
export class DuplicateSlugError extends ProjectError {
  constructor(slug: string) {
    super(`Project with slug "${slug}" already exists`);
    this.name = 'DuplicateSlugError';
  }
}

/**
 * Raised when `kind='external'` is combined with `permissionMode='auto'`.
 * Spec §7.3 forbids this combination: external projects may point at user
 * repos the AI should not silently modify.
 */
export class ExternalAutoForbiddenError extends ProjectError {
  constructor() {
    super(
      'external projects cannot use permissionMode="auto" (spec §7.3): ' +
        'external repositories may contain work the AI must not modify ' +
        'without explicit approval — use "hybrid" or "approval" instead.',
    );
    this.name = 'ExternalAutoForbiddenError';
  }
}

/**
 * Raised when the junction/symlink we just created does not realpath back
 * to the externalPath the caller provided. Indicates either an OS-level
 * race (another process swapped the link between `createLink` and the
 * verification) or a bug in the junction helper.
 */
export class JunctionTOCTOUMismatchError extends ProjectError {
  constructor(expected: string, actual: string) {
    super(
      `junction realpath mismatch after creation: expected ${expected}, got ${actual}`,
    );
    this.name = 'JunctionTOCTOUMismatchError';
  }
}

/**
 * Raised when input required by a specific `kind` is missing (external
 * needs `externalPath`, imported needs `sourcePath`).
 */
export class ProjectInputError extends ProjectError {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectInputError';
  }
}

/**
 * Raised when a permission-mode change is requested while the project has
 * an in-flight meeting. Spec §7.3 CB-3: mode transitions cannot interleave
 * with an active conversation because the CLI permission matrix changes
 * mid-turn. Caller must pause/end the meeting first, then retry.
 */
export class ActiveMeetingForbiddenError extends ProjectError {
  constructor(projectId: string) {
    super(
      `project ${projectId} has an active meeting — ` +
        'pause or end it before changing permission mode (spec §7.3 CB-3).',
    );
    this.name = 'ActiveMeetingForbiddenError';
  }
}

/**
 * Raised when the requested target mode equals the project's current mode.
 * No transition to request — surfaces as a friendly UX hint rather than a
 * silent noop so the approval inbox does not accumulate vacuous rows.
 */
export class SamePermissionModeError extends ProjectError {
  constructor(mode: PermissionMode) {
    super(`permission mode is already "${mode}" — nothing to change.`);
    this.name = 'SamePermissionModeError';
  }
}

/**
 * Raised when `requestPermissionModeChange` / `applyPermissionModeChange`
 * is called but the ProjectService was instantiated without an
 * `approvalService` dependency. Indicates a wiring bug in main/index.ts.
 */
export class ApprovalServiceUnavailableError extends ProjectError {
  constructor() {
    super(
      'ProjectService.opts.approvalService is not configured — ' +
        'wire it in main/index.ts before requesting a mode transition.',
    );
    this.name = 'ApprovalServiceUnavailableError';
  }
}

/**
 * Raised by `applyPermissionModeChange` when the approval row does not
 * carry `kind='mode_transition'` or its payload is missing / malformed.
 * The router filters kind upstream, so this surfaces only when something
 * writes a bad row through back doors (tests, migrations, bugs).
 */
export class ApprovalKindMismatchError extends ProjectError {
  constructor(approvalId: string, expected: string, actual: string) {
    super(
      `approval ${approvalId} has kind="${actual}" but "${expected}" was required`,
    );
    this.name = 'ApprovalKindMismatchError';
  }
}

// ── Error-mapping helpers ──────────────────────────────────────────────

/**
 * True when `err` is a better-sqlite3 SqliteError that specifically
 * reflects a UNIQUE violation on `projects.slug`. Matches both the
 * default ("UNIQUE constraint failed: projects.slug") and named-index
 * ("idx_projects_slug") phrasings so this keeps working if we add an
 * explicit index later.
 */
function isSlugUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: unknown; message?: unknown };
  if (e.code !== 'SQLITE_CONSTRAINT_UNIQUE') return false;
  if (typeof e.message !== 'string') return false;
  return (
    e.message.includes('projects.slug') ||
    e.message.includes('idx_projects_slug')
  );
}

// ── Options ────────────────────────────────────────────────────────────

/**
 * Narrow dep interface so tests can pass a fake ApprovalService without
 * wiring a real EventEmitter + repository stack. Matches the surface of
 * `ApprovalService` for the three methods the mode-transition flow needs.
 */
export interface ProjectApprovalServiceDep {
  create(input: CreateApprovalInput): ApprovalItem;
  get(id: string): ApprovalItem | null;
  supersede(id: string): void;
}

export interface ProjectServiceOptions {
  /**
   * Optional post-create hook used by Task 10's ChannelService to
   * auto-create the three system channels. Fires AFTER DB+FS atomicity is
   * finalised; exceptions propagate and become the caller's problem but
   * they do NOT roll back the newly-created project (system channels are
   * additive state).
   */
  onProjectCreated?: (project: Project) => void;
  /**
   * R7-Task8: ApprovalService backing the mode-transition flow. Optional
   * so existing callers (older tests) keep compiling — calls that require
   * it throw {@link ApprovalServiceUnavailableError} when absent.
   */
  approvalService?: ProjectApprovalServiceDep;
  /**
   * R7-Task8: active-meeting gate (spec §7.3 CB-3). Returns `true` when
   * the named project currently has any meeting with `ended_at IS NULL`.
   * Inlined as a closure so ProjectService does not need a MeetingRepository
   * import (keeps service boundaries thin).
   */
  hasActiveMeeting?: (projectId: string) => boolean;
}

// ── Helpers ────────────────────────────────────────────────────────────

const SLUG_MAX_LEN = 64;
const SLUG_FALLBACK_BYTES = 4; // 8 hex chars
/**
 * Slug pattern: keep ASCII lowercase, digits, and Korean Hangul
 * characters (end users name projects in Korean). Everything else becomes
 * a single hyphen.
 */
const SLUG_REPLACE_PATTERN = /[^a-z0-9가-힣]+/g;

/**
 * Derive a filesystem-safe slug from a display `name`. Lowercased,
 * non-allowed characters collapsed to `-`, trimmed, capped at 64 chars.
 * Falls back to a random 8-char hex string when the name would reduce to
 * an empty slug (e.g. entirely punctuation).
 */
export function generateSlug(name: string): string {
  const lowered = name.toLowerCase();
  const replaced = lowered.replace(SLUG_REPLACE_PATTERN, '-');
  const trimmed = replaced.replace(/^-+|-+$/g, '');
  const capped = trimmed.slice(0, SLUG_MAX_LEN);
  if (capped.length === 0) {
    return randomBytes(SLUG_FALLBACK_BYTES).toString('hex');
  }
  return capped;
}

// ── Event typing ──────────────────────────────────────────────────────

/**
 * R9-Task5: autonomy-mode change event. Emitted by {@link
 * ProjectService.setAutonomy} when the persisted mode actually flips.
 * StreamBridge re-emits this to the renderer as
 * `stream:autonomy-mode-changed` (spec §6 + shared/stream-events.ts).
 *
 * `reason` distinguishes user-initiated toggles (`'user'`) from
 * system-initiated downgrades (`'autonomy_gate_fail'` from AutonomyGate
 * when a rework/fail lands, `'circuit_breaker'` from v3-side-effects
 * when a tripwire fires). Default is `'user'` when omitted so legacy
 * call sites keep working.
 */
export type AutonomyChangeReason =
  | 'user'
  | 'circuit_breaker'
  | 'autonomy_gate_fail';

export const PROJECT_AUTONOMY_CHANGED_EVENT = 'autonomy-changed' as const;

export interface AutonomyChangedPayload {
  projectId: string;
  mode: AutonomyMode;
  reason: AutonomyChangeReason;
}

export interface ProjectServiceEvents {
  'autonomy-changed': (payload: AutonomyChangedPayload) => void;
}

// ── Service ────────────────────────────────────────────────────────────

export class ProjectService extends EventEmitter {
  constructor(
    private readonly repo: ProjectRepository,
    private readonly arenaRoot: ArenaRootService,
    private readonly opts: ProjectServiceOptions = {},
  ) {
    super();
  }

  /**
   * Create a project of the requested kind. DB + FS are applied atomically
   * — a failure at any point rolls back both (any partial directory is
   * `rm -rf`'d and the DB row is deleted).
   *
   * @throws {ProjectInputError}          missing external/imported input
   * @throws {ExternalAutoForbiddenError} external + permissionMode='auto'
   * @throws {DuplicateSlugError}         slug already registered
   * @throws {JunctionTOCTOUMismatchError} external link did not realpath
   *                                       back to `externalPath`
   */
  async create(input: ProjectCreateInput): Promise<Project> {
    // 1. Input-shape + policy rejections BEFORE any FS or DB state.
    if (input.kind === 'external' && !input.externalPath) {
      throw new ProjectInputError('externalPath required when kind="external"');
    }
    if (input.kind === 'imported' && !input.sourcePath) {
      throw new ProjectInputError('sourcePath required when kind="imported"');
    }
    if (input.kind === 'external' && input.permissionMode === 'auto') {
      throw new ExternalAutoForbiddenError();
    }

    // 2. Derive slug + check collision. The UNIQUE constraint on `slug`
    //    in SQL is the ultimate guard, but we front-run it so we can
    //    throw a specific error class and avoid any FS work.
    const slug = generateSlug(input.name);
    if (this.repo.getBySlug(slug) !== null) {
      throw new DuplicateSlugError(slug);
    }

    // 3. For external, capture the realpath BASELINE up front. This is
    //    what gets persisted in DB (spec §7.6 CA-3) and what the junction
    //    has to resolve back to after creation.
    let externalLink: string | null = null;
    if (input.kind === 'external') {
      // input.externalPath presence is guaranteed by the earlier guard;
      // assert the type for TS while keeping runtime behaviour identical.
      externalLink = fs.realpathSync(
        path.resolve(input.externalPath as string),
      );
    }

    // 4. Build the in-memory Project row (status='active'). The FS layout
    //    is only materialised after the DB INSERT succeeds so the FS
    //    never leads the DB.
    const now = Date.now();
    const project: Project = {
      id: randomUUID(),
      slug,
      name: input.name,
      description: input.description ?? '',
      kind: input.kind,
      externalLink,
      permissionMode: input.permissionMode,
      autonomyMode: input.autonomyMode ?? 'manual',
      status: 'active',
      createdAt: now,
      archivedAt: null,
    };

    const paths = resolveProjectPaths(project, this.arenaRoot.getPath());

    // 5. Atomic DB+FS:
    //    a. DB INSERT (transaction) — also inserts members if any.
    //    b. FS materialisation (mkdir / copy / symlink / meta.json).
    //    c. On any FS failure: `rm -rf rootPath` + DELETE FROM projects.
    //
    //    We use a manual try/catch rather than `db.transaction()` because
    //    the FS side is async and the DB handle should not stay locked
    //    across slow I/O (external copy / mklink spawn). Compensation on
    //    failure restores DB state to pre-create.
    this.insertProjectWithMembers(project, input.initialMemberProviderIds ?? []);

    try {
      await this.materialiseFs(project, paths, input);
      // Invariant: past this point materialisation succeeded — any earlier
      // failure would have thrown into the catch below and rolled back both
      // the FS root and the DB row before returning.
    } catch (err) {
      // FS rollback — best-effort rmdir, then DB row removal.
      try {
        fs.rmSync(paths.rootPath, { recursive: true, force: true });
      } catch {
        // Final state of disk may be dirty if rmSync itself races, but
        // the DB row will be gone so the slug is reusable.
      }
      this.repo.delete(project.id);
      throw err;
    }

    // 6. Fire the post-create hook (Task 10 will use this for system
    //    channels). Exceptions here do NOT undo the project — the hook is
    //    additive side-effects only.
    this.opts.onProjectCreated?.(project);

    return project;
  }

  /**
   * Soft-archive the project: flips `status='archived'` and records
   * `archived_at`. Does not touch the filesystem — archived projects
   * remain on disk so their artifacts stay readable. Hard deletion is
   * intentionally not exposed here.
   */
  archive(id: string): Project {
    const existing = this.repo.get(id);
    if (!existing) {
      throw new ProjectError(`archive: project not found: ${id}`);
    }
    const now = Date.now();
    this.repo.update(id, { status: 'archived', archivedAt: now });
    const next = this.repo.get(id);
    if (!next) {
      // Should be impossible — we just updated the row.
      throw new ProjectError(`archive: project disappeared after update: ${id}`);
    }
    return next;
  }

  /**
   * List every project, eagerly reconciling `folder_missing` status.
   *
   * For each non-archived row, we stat the project's root directory; if
   * missing, we flip the status in DB and return the updated row.
   * `archived` rows are left alone (their folder may legitimately have
   * been hand-cleaned by the user).
   */
  list(): Project[] {
    const rows = this.repo.list();
    return rows.map((project) => this.reconcileFolder(project));
  }

  /**
   * Per-project lookup. Structurally matches `ProjectLookup` in
   * `permission-service.ts` — do not rename without updating that
   * contract. Returns `null` when `id` is unknown.
   */
  get(id: string): Project | null {
    return this.repo.get(id);
  }

  /**
   * Apply a partial update. Only `name`, `description`, `permissionMode`,
   * and `autonomyMode` are patchable via IPC (`project:update`); slug /
   * kind / externalLink are structural and stay locked. Re-asserts the
   * external+auto guard (spec §7.3 CA-1) in case the caller flips the
   * permission mode on an `external` project.
   *
   * @throws {ProjectError}                  unknown id.
   * @throws {ExternalAutoForbiddenError}    permissionMode='auto' on an
   *                                         `external` project.
   */
  update(
    id: string,
    patch: {
      name?: string;
      description?: string;
      permissionMode?: PermissionMode;
      autonomyMode?: AutonomyMode;
    },
  ): Project {
    const existing = this.repo.get(id);
    if (!existing) {
      throw new ProjectError(`update: project not found: ${id}`);
    }
    if (
      existing.kind === 'external' &&
      patch.permissionMode === 'auto'
    ) {
      throw new ExternalAutoForbiddenError();
    }
    this.repo.update(id, patch);
    const next = this.repo.get(id);
    if (!next) {
      throw new ProjectError(`update: project disappeared after update: ${id}`);
    }
    return next;
  }

  /**
   * Change the autonomy mode only. Exposed as a distinct method because
   * the IPC surface (`project:set-autonomy`) drives it directly from the
   * autonomy toggle UI and the audit trail keeps this action separated
   * from full `project:update` calls.
   *
   * R9-Task5: emits `'autonomy-changed'` on every successful transition
   * (including no-op writes where the mode already matches — the event
   * still fires so UI listeners can reassure the user after a redundant
   * click). `reason` defaults to `'user'`; callers such as AutonomyGate
   * and the circuit-breaker handler pass `'autonomy_gate_fail'` /
   * `'circuit_breaker'` so the stream payload tells the renderer whether
   * the downgrade was their own click or a system-driven guard.
   *
   * @throws {ProjectError} unknown id.
   */
  setAutonomy(
    id: string,
    mode: AutonomyMode,
    opts: { reason?: AutonomyChangeReason } = {},
  ): Project {
    const next = this.update(id, { autonomyMode: mode });
    const reason = opts.reason ?? 'user';
    try {
      this.emit(PROJECT_AUTONOMY_CHANGED_EVENT, {
        projectId: id,
        mode: next.autonomyMode,
        reason,
      });
    } catch (err) {
      // Listener failures must not rewrite the contract of setAutonomy
      // (row saved, Project returned). Same pattern as MessageService /
      // ApprovalService — a single warn for observability.
      // TODO R2-log: swap console.warn for structured logger.
      const message = err instanceof Error ? err.message : String(err);
      console.warn('[rolestra.projects] autonomy-changed listener threw:', {
        projectId: id,
        name: err instanceof Error ? err.name : undefined,
        message,
      });
    }
    return next;
  }

  // ── typed EventEmitter overloads ───────────────────────────────────

  on<E extends keyof ProjectServiceEvents>(
    event: E,
    listener: ProjectServiceEvents[E],
  ): this;
  on(event: string | symbol, listener: (...args: unknown[]) => void): this;
  on(
    event: string | symbol,
    listener: (...args: unknown[]) => void,
  ): this {
    return super.on(event, listener);
  }

  off<E extends keyof ProjectServiceEvents>(
    event: E,
    listener: ProjectServiceEvents[E],
  ): this;
  off(event: string | symbol, listener: (...args: unknown[]) => void): this;
  off(
    event: string | symbol,
    listener: (...args: unknown[]) => void,
  ): this {
    return super.off(event, listener);
  }

  emit<E extends keyof ProjectServiceEvents>(
    event: E,
    ...args: Parameters<ProjectServiceEvents[E]>
  ): boolean;
  emit(event: string | symbol, ...args: unknown[]): boolean;
  emit(event: string | symbol, ...args: unknown[]): boolean {
    return super.emit(event, ...args);
  }

  /**
   * Marks a project as "opened" for the current session. Today this only
   * verifies the row exists and returns it — persistent active-project
   * state lives upstream (Task 20 SSM side-effects). Having a dedicated
   * method keeps the IPC contract stable if that policy changes later.
   *
   * @throws {ProjectError} unknown id or archived.
   */
  open(id: string): Project {
    const project = this.repo.get(id);
    if (!project) {
      throw new ProjectError(`open: project not found: ${id}`);
    }
    if (project.status === 'archived') {
      throw new ProjectError(`open: project is archived: ${id}`);
    }
    return project;
  }

  // ── R7-Task8: permission-mode transition (approval-gated) ───────────

  /**
   * Open an approval row asking the user to transition `projectId`'s
   * permission mode to `targetMode`. The DB write happens only later in
   * {@link applyPermissionModeChange}, after the user approves.
   *
   * Pre-flight rejections (fail-fast, no approval row created):
   *   - project not found               → {@link ProjectError}
   *   - already at `targetMode`          → {@link SamePermissionModeError}
   *   - external + auto                  → {@link ExternalAutoForbiddenError}
   *   - active meeting in project        → {@link ActiveMeetingForbiddenError}
   *
   * `channelId` and `meetingId` on the approval are left null — mode
   * transitions are project-scoped (§7.3) and not bound to a particular
   * channel or meeting. Dashboard widgets / inbox filter by `projectId`.
   */
  requestPermissionModeChange(
    projectId: string,
    targetMode: PermissionMode,
    reason?: string,
  ): ApprovalItem {
    if (!this.opts.approvalService) {
      throw new ApprovalServiceUnavailableError();
    }
    const project = this.repo.get(projectId);
    if (project === null) {
      throw new ProjectError(
        `requestPermissionModeChange: project not found: ${projectId}`,
      );
    }
    if (project.permissionMode === targetMode) {
      throw new SamePermissionModeError(targetMode);
    }
    if (project.kind === 'external' && targetMode === 'auto') {
      throw new ExternalAutoForbiddenError();
    }
    if (this.opts.hasActiveMeeting?.(projectId) ?? false) {
      throw new ActiveMeetingForbiddenError(projectId);
    }

    const payload: ModeTransitionApprovalPayload = {
      kind: 'mode_transition',
      currentMode: project.permissionMode,
      targetMode,
    };
    if (reason !== undefined) payload.reason = reason;

    return this.opts.approvalService.create({
      kind: 'mode_transition',
      projectId,
      channelId: null,
      meetingId: null,
      requesterId: null,
      payload,
    });
  }

  /**
   * Apply the mode transition carried by an approved approval row. Called
   * by {@link ApprovalDecisionRouter} on the 'decided' event when the user
   * picks `approve` or `conditional` (both collapse to
   * `approval_items.status='approved'`, spec §7.7).
   *
   * TOCTOU re-check: between `request` and `apply` the user may have
   * changed project kind or started a meeting — we re-run the same gates
   * here, and mark the approval `superseded` if any gate now fires. The
   * caller sees a thrown error; the approval inbox sees the superseded
   * status and stops showing the row.
   *
   * @throws {ApprovalServiceUnavailableError} approvalService not wired
   * @throws {ProjectError}                     approval or project missing
   * @throws {ApprovalKindMismatchError}        approval kind != mode_transition
   * @throws {ExternalAutoForbiddenError}       TOCTOU: project became external
   * @throws {ActiveMeetingForbiddenError}      TOCTOU: meeting now active
   */
  applyPermissionModeChange(approvalId: string): Project {
    if (!this.opts.approvalService) {
      throw new ApprovalServiceUnavailableError();
    }
    const item = this.opts.approvalService.get(approvalId);
    if (item === null) {
      throw new ProjectError(
        `applyPermissionModeChange: approval not found: ${approvalId}`,
      );
    }
    if (item.kind !== 'mode_transition') {
      throw new ApprovalKindMismatchError(
        approvalId,
        'mode_transition',
        item.kind,
      );
    }
    if (item.status !== 'approved') {
      throw new ProjectError(
        `applyPermissionModeChange: approval ${approvalId} is not in ` +
          `'approved' status (got '${item.status}')`,
      );
    }
    const payload = item.payload as ModeTransitionApprovalPayload | null;
    if (
      payload === null ||
      typeof payload !== 'object' ||
      payload.kind !== 'mode_transition'
    ) {
      throw new ProjectError(
        `applyPermissionModeChange: approval ${approvalId} payload missing ` +
          'or malformed',
      );
    }
    if (item.projectId === null) {
      throw new ProjectError(
        `applyPermissionModeChange: approval ${approvalId} has no projectId`,
      );
    }

    const approvalSvc = this.opts.approvalService;
    const supersedeAndRethrow = (err: Error): never => {
      try {
        approvalSvc.supersede(approvalId);
      } catch (supersedeErr) {
        // TODO R2-log: the supersede failure itself is worth logging but
        // must not mask the original TOCTOU reason the caller needs.
        console.warn(
          '[rolestra.projects.mode-transition] supersede on TOCTOU failed:',
          {
            approvalId,
            name:
              supersedeErr instanceof Error ? supersedeErr.name : undefined,
            message:
              supersedeErr instanceof Error
                ? supersedeErr.message
                : String(supersedeErr),
          },
        );
      }
      throw err;
    };

    // TOCTOU re-check against current DB state.
    const project = this.repo.get(item.projectId);
    if (project === null) {
      return supersedeAndRethrow(
        new ProjectError(
          `applyPermissionModeChange: project gone: ${item.projectId}`,
        ),
      );
    }
    if (project.kind === 'external' && payload.targetMode === 'auto') {
      return supersedeAndRethrow(new ExternalAutoForbiddenError());
    }
    if (this.opts.hasActiveMeeting?.(item.projectId) ?? false) {
      return supersedeAndRethrow(
        new ActiveMeetingForbiddenError(item.projectId),
      );
    }

    this.repo.update(item.projectId, {
      permissionMode: payload.targetMode,
    });
    const next = this.repo.get(item.projectId);
    if (next === null) {
      throw new ProjectError(
        `applyPermissionModeChange: project disappeared after update: ` +
          `${item.projectId}`,
      );
    }
    return next;
  }

  // ── Member management (thin pass-throughs to the repository) ─────────

  addMember(
    projectId: string,
    providerId: string,
    roleAtProject: string | null = null,
  ): ProjectMember {
    if (this.repo.get(projectId) === null) {
      throw new ProjectError(`addMember: project not found: ${projectId}`);
    }
    const addedAt = Date.now();
    this.repo.addMember(projectId, providerId, roleAtProject, addedAt);
    return {
      projectId,
      providerId,
      roleAtProject,
      addedAt,
    };
  }

  removeMember(projectId: string, providerId: string): boolean {
    return this.repo.removeMember(projectId, providerId);
  }

  listMembers(projectId: string): ProjectMember[] {
    return this.repo.listMembers(projectId);
  }

  // ── Internals ────────────────────────────────────────────────────────

  /**
   * Insert project row and any initial members in a single DB transaction.
   * Splitting this out lets us keep the async FS phase outside the
   * transaction scope while still guaranteeing DB atomicity.
   *
   * Race safety: `create()` pre-checks `getBySlug`, but two concurrent
   * creates on the same DB handle can both pass that check before either
   * INSERTs. The UNIQUE constraint on `projects.slug` catches the loser;
   * we translate the raw SqliteError into `DuplicateSlugError` so callers
   * see a single error class regardless of which path lost the race.
   */
  private insertProjectWithMembers(
    project: Project,
    memberProviderIds: string[],
  ): void {
    try {
      this.repo.transaction(() => {
        this.repo.insert(project);
        const addedAt = project.createdAt;
        for (const providerId of memberProviderIds) {
          this.repo.addMember(project.id, providerId, null, addedAt);
        }
      });
    } catch (err) {
      if (isSlugUniqueViolation(err)) {
        throw new DuplicateSlugError(project.slug);
      }
      throw err;
    }
  }

  /**
   * Materialise the filesystem layout for the given project.
   *
   * `new`       — mkdir rootPath + write meta.json.
   * `external`  — mkdir rootPath, create junction/symlink, re-check
   *               realpath == stored externalLink, write meta.json.
   * `imported`  — recursive copy from sourcePath into rootPath, then write
   *               meta.json. `fs.cpSync` requires Node >= 16.7 and is
   *               listed as stable in Node 20+ (package.json engines ≥20).
   */
  private async materialiseFs(
    project: Project,
    paths: ReturnType<typeof resolveProjectPaths>,
    input: ProjectCreateInput,
  ): Promise<void> {
    switch (project.kind) {
      case 'new': {
        fs.mkdirSync(paths.rootPath, { recursive: true });
        break;
      }
      case 'external': {
        fs.mkdirSync(paths.rootPath, { recursive: true });
        // createLink is idempotent — if stale `link` exists from a prior
        // failed attempt it will be removed and recreated.
        await createLink(paths.cwdPath, project.externalLink as string);
        // TOCTOU re-check: between realpathSync of externalPath at the
        // start of create() and the createLink call now, the target could
        // have been swapped. Verify the symlink resolves back to the
        // baseline.
        const resolved = resolveLink(paths.cwdPath);
        if (resolved !== project.externalLink) {
          throw new JunctionTOCTOUMismatchError(
            project.externalLink as string,
            resolved,
          );
        }
        break;
      }
      case 'imported': {
        // Recursive copy. `errorOnExist: true` is default-safe: the slug
        // collision check has already rejected existing dirs, and if one
        // appears here we want a hard failure rather than a merge.
        fs.cpSync(input.sourcePath as string, paths.rootPath, {
          recursive: true,
          errorOnExist: true,
          force: false,
        });
        break;
      }
    }

    writeProjectMeta(paths.rootPath, buildProjectMeta(project));
  }

  /**
   * Stat the project root and flip `status='folder_missing'` when the
   * directory has vanished. Archived rows are returned untouched.
   * Returns the (possibly-updated) Project row as a fresh value.
   */
  private reconcileFolder(project: Project): Project {
    if (project.status === 'archived') return project;
    const paths = resolveProjectPaths(project, this.arenaRoot.getPath());
    const exists = fs.existsSync(paths.rootPath);

    if (!exists && project.status !== 'folder_missing') {
      this.repo.update(project.id, { status: 'folder_missing' });
      return { ...project, status: 'folder_missing' };
    }
    // If the folder reappeared (e.g. user restored a backup) between the
    // last list() and this one, promote back to 'active'. This keeps the
    // DB synchronous with reality without forcing the user to manually
    // "re-activate" a project.
    if (exists && project.status === 'folder_missing') {
      this.repo.update(project.id, { status: 'active' });
      return { ...project, status: 'active' };
    }
    return project;
  }
}
