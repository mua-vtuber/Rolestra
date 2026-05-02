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
import { promises as fsPromises } from 'node:fs';
import path from 'node:path';
import type { Channel, ChannelKind } from '../../shared/channel-types';
import type {
  ChannelPurpose,
  ChannelRole,
  HandoffMode,
} from '../../shared/channel-role-types';
import { DEFAULT_HANDOFF_MODE } from '../../shared/channel-role-types';
import type { ProjectMember } from '../../shared/project-types';
import type { Message } from '../../shared/message-types';
import { SKILL_CATALOG } from '../../shared/skill-catalog';
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
 * Fixed blueprint for the per-project system channels.
 *
 * R12-C 변경: `system_general` 제거 — 일반 채널은 전역 1개로 옮겨졌고
 * `ensureGlobalGeneralChannel()` 가 boot 시점에 보장한다. 마이그레이션
 * 018 이 기존 프로젝트 종속 system_general row 를 정리한다.
 *
 * Order matters: `listByProject()` relies on the kind ordering but
 * this list also determines create order (affects `created_at`).
 */
const SYSTEM_CHANNEL_BLUEPRINT: ReadonlyArray<{
  name: string;
  kind: ChannelKind;
  readOnly: boolean;
}> = [
  { name: '승인-대기', kind: 'system_approval', readOnly: true },
  { name: '회의록', kind: 'system_minutes', readOnly: true },
];

/**
 * R12-C — 디폴트 부서 채널 5종. 프로젝트 생성 시 자동 생성.
 * `createDepartmentChannels()` 가 이 blueprint 를 사용한다.
 *
 * 디자인 부서 = `design.ui + design.ux` 통합 부서. 단일 RoleId 표면이라
 * `design.ux` 를 대표 role 로 두고, 디자인 워크플로우 (R12-C Task 14) 가
 * 채널 멤버 중 `design.ui` / `design.ux` 능력자를 모두 찾는다.
 *
 * 옵션 부서 (캐릭터 / 배경 디자인) 는 사용자 명시 시 추가 — Task 4 input.
 */
export const DEFAULT_DEPARTMENT_BLUEPRINT: ReadonlyArray<{
  name: string;
  role: ChannelRole;
}> = [
  { name: '아이디어', role: 'idea' },
  { name: '기획', role: 'planning' },
  { name: '디자인', role: 'design.ux' },
  { name: '구현', role: 'implement' },
  { name: '검토', role: 'review' },
];

/** 옵션 부서 (사용자 추가 시) — 게임 / 일러스트 프로젝트용. */
export const OPTIONAL_DEPARTMENT_BLUEPRINT: ReadonlyArray<{
  name: string;
  role: ChannelRole;
}> = [
  { name: '디자인-캐릭터', role: 'design.character' },
  { name: '디자인-배경', role: 'design.background' },
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
  /** R12-C — 부서 매핑. 사용자 자유 채널 = null (기존), 부서 채널 = RoleId. */
  role?: ChannelRole;
  /** R12-C — 사용자 작성 자유 텍스트. */
  purpose?: ChannelPurpose;
  /** R12-C — 부서 인계 confirm 모드. 디폴트 'check'. */
  handoffMode?: HandoffMode;
}

// ── Service ────────────────────────────────────────────────────────────

/**
 * R12-C T9 — archive 의존. archiveConversation 를 사용하려면 messages 를
 * 읽고 지우는 어댑터 + ArenaRoot 경로 helper 가 필요하다. 여기에 직접
 * MessageRepository / ArenaRootService 를 import 하지 않고 좁은 인터페이스
 * 두 개로만 받아서 채널 service 의 의존을 최소화한다 (단위 테스트도 가벼움).
 */
export interface ArchiveMessageAdapter {
  /** 채널의 모든 메시지를 oldest-first 로 반환. */
  listAllByChannel(channelId: string): Message[];
  /** 채널의 모든 메시지를 삭제. 삭제된 row 수 반환. */
  deleteByChannel(channelId: string): number;
}

export interface ArchiveRootProvider {
  /** ArenaRoot 절대 경로. */
  getArenaRoot(): string;
}

export interface ChannelServiceDeps {
  archiveMessages?: ArchiveMessageAdapter;
  archiveRoot?: ArchiveRootProvider;
}

export class ChannelService {
  private readonly archiveMessages: ArchiveMessageAdapter | null;
  private readonly archiveRoot: ArchiveRootProvider | null;

  constructor(
    private readonly repo: ChannelRepository,
    private readonly projectMembers: ProjectMemberLookup,
    deps?: ChannelServiceDeps,
  ) {
    this.archiveMessages = deps?.archiveMessages ?? null;
    this.archiveRoot = deps?.archiveRoot ?? null;
  }

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
      // R12-C — input 에 명시 시 우선, 없으면 NULL/check default.
      role: input.role ?? null,
      purpose: input.purpose ?? null,
      handoffMode: input.handoffMode ?? DEFAULT_HANDOFF_MODE,
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
   * Create the per-project system channels for `projectId` in lock-step.
   * All channels + their member rows live in a single transaction — if any
   * fails, none are inserted.
   *
   * R12-C 변경: 2 channels (`system_approval` + `system_minutes`) 만
   * 생성. `system_general` 은 전역 1개로 분리되어 `ensureGlobalGeneralChannel()`
   * 가 boot 시점에 책임진다.
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
      // R12-C — Task 2 임시 default. system 채널은 role NULL.
      role: null,
      purpose: null,
      handoffMode: 'check',
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
      // R12-C — Task 2 임시 default. DM 은 role NULL (부서 X).
      role: null,
      purpose: null,
      handoffMode: 'check',
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

    // R12-C round 3 (#1-4) — 사용자가 부서 채널 이름을 모두 지우고 저장하면
    // SKILL_CATALOG 의 부서 라벨로 자동 복원한다. UNIQUE(project_id, name)
    // 충돌을 막으면서도 사용자 의도 ("작명을 비우고 라벨만 보기") 와 동일한
    // 시각 결과 — 사이드바에서 부서 row 가 라벨만 표시하므로 빈 작명은
    // 의미가 자동 라벨이다.
    let resolvedName = newName.trim();
    if (resolvedName.length === 0) {
      if (existing.role === null) {
        throw new ChannelError(
          'rename: 자유 user 채널 이름은 비워둘 수 없습니다.',
        );
      }
      resolvedName = SKILL_CATALOG[existing.role].label.ko;
    }

    try {
      this.repo.update(id, { name: resolvedName });
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

  // ── R12-C 신규 메서드 ─────────────────────────────────────────────────

  /**
   * R12-C — Update the channel's `role` field. Used when a user reassigns
   * a channel to a different department or clears the role on a free user
   * channel.
   *
   * @throws {ChannelNotFoundError} when `id` is unknown.
   */
  updateRole(id: string, role: ChannelRole): Channel {
    const existing = this.repo.get(id);
    if (!existing) throw new ChannelNotFoundError(id);
    this.repo.update(id, { role });
    const next = this.repo.get(id);
    if (!next) {
      throw new ChannelError(`updateRole: channel disappeared after update: ${id}`);
    }
    return next;
  }

  /**
   * R12-C — Update the channel's `handoff_mode`. 'check' (디폴트) shows a
   * confirm modal before the next department picks up the work; 'auto'
   * skips confirmation.
   *
   * @throws {ChannelNotFoundError} when `id` is unknown.
   */
  updateHandoffMode(id: string, handoffMode: HandoffMode): Channel {
    const existing = this.repo.get(id);
    if (!existing) throw new ChannelNotFoundError(id);
    this.repo.update(id, { handoffMode });
    const next = this.repo.get(id);
    if (!next) {
      throw new ChannelError(
        `updateHandoffMode: channel disappeared after update: ${id}`,
      );
    }
    return next;
  }

  /**
   * R12-C — Reorder participating members. `providerOrderedIds[i]` gets
   * `drag_order = i`. Used as the fallback signal for the designated-worker
   * resolver when no department-head pin is set.
   *
   * @throws {ChannelNotFoundError} when `channelId` is unknown.
   * @throws Error when any provider in the list is not a current member.
   */
  reorderMembers(channelId: string, providerOrderedIds: string[]): void {
    const existing = this.repo.get(channelId);
    if (!existing) throw new ChannelNotFoundError(channelId);
    this.repo.reorderMembers(channelId, providerOrderedIds);
  }

  /**
   * R12-C — Returns the global general channel (project_id IS NULL,
   * kind = 'system_general'). After migration 018 + ProjectService boot
   * (`ensureGlobalGeneralChannel`) this row always exists.
   *
   * Throws when no row exists yet — callers should treat this as a boot
   * sequencing bug rather than silently fall back to a per-project
   * channel (would break the R12-C global-general invariant).
   */
  getGlobalGeneralChannel(): Channel {
    const row = this.repo.getGlobalGeneralChannel();
    if (!row) {
      throw new ChannelError(
        'getGlobalGeneralChannel: no global system_general row. ' +
          'Did ensureGlobalGeneralChannel() run on app boot?',
      );
    }
    return row;
  }

  /**
   * R12-C T9 — 전역 일반 채널 "새 대화 시작": 모든 메시지를 archive 폴더로
   * dump 한 후 channel_messages 행을 삭제한다.
   *
   * 허용 대상:
   * - kind === 'system_general' 만 (전역 일반 채널). 그 외 channelId 는
   *   `ChannelError` throw — UI 가 일반 채널 외에는 GeneralChannelControls
   *   를 보여주지 않으므로 통상 도달하지 않지만 defence-in-depth.
   *
   * Archive 위치 = `<ArenaRoot>/conversations-archive/<ISO>-<channelId>.json`.
   * 빈 메시지 채널이면 dump 파일은 빈 messages 배열로 작성된다 (사용자가
   * 매 클릭마다 마커가 남는 게 더 안전 — 실수 클릭 시 복구 가능).
   */
  async archiveConversation(channelId: string): Promise<{
    archivedPath: string;
    deletedCount: number;
  }> {
    if (this.archiveMessages === null || this.archiveRoot === null) {
      throw new ChannelError(
        'archiveConversation: archive deps not wired. ' +
          'main/index.ts must construct ChannelService with deps.archiveMessages + deps.archiveRoot.',
      );
    }
    const channel = this.repo.get(channelId);
    if (!channel) {
      throw new ChannelNotFoundError(channelId);
    }
    if (channel.kind !== 'system_general') {
      throw new ChannelError(
        `archiveConversation: 일반 채널 (system_general) 만 archive 가능. 현재 kind=${channel.kind}`,
      );
    }
    const messages = this.archiveMessages.listAllByChannel(channelId);
    const archiveRootDir = path.join(
      this.archiveRoot.getArenaRoot(),
      'conversations-archive',
    );
    await fsPromises.mkdir(archiveRootDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${ts}-${channelId}.json`;
    const archivedPath = path.join(archiveRootDir, filename);
    const dump = {
      channelId: channel.id,
      channelName: channel.name,
      channelKind: channel.kind,
      archivedAt: Date.now(),
      messageCount: messages.length,
      messages,
    };
    await fsPromises.writeFile(
      archivedPath,
      JSON.stringify(dump, null, 2),
      'utf8',
    );
    const deletedCount = this.archiveMessages.deleteByChannel(channelId);
    return { archivedPath, deletedCount };
  }

  /**
   * R12-C — Boot-time idempotent: ensure exactly one global
   * `system_general` row exists (project_id IS NULL). Called from
   * the main process startup sequence (after migrations run). Returns
   * the row whether it was just created or already existed.
   *
   * Migration 018 already collapsed any pre-existing per-project
   * system_general rows down to one (oldest survives, project_id
   * becomes NULL). This method handles fresh installs where no
   * system_general row existed yet.
   */
  ensureGlobalGeneralChannel(): Channel {
    const existing = this.repo.getGlobalGeneralChannel();
    if (existing) return existing;
    const channel: Channel = {
      id: randomUUID(),
      projectId: null,
      name: '일반',
      kind: 'system_general',
      readOnly: false,
      createdAt: Date.now(),
      role: null,
      purpose: null,
      handoffMode: DEFAULT_HANDOFF_MODE,
    };
    this.repo.insert(channel);
    return channel;
  }

  /**
   * R12-C — Create the default 5 department channels (idea / planning /
   * design / implement / review) for a project, plus optional 2
   * (design.character / design.background) when `includeOptional` is true.
   *
   * Each department channel:
   *   - kind = 'user' (the schema treats role-bearing channels as user channels)
   *   - role = blueprint role (RoleId)
   *   - handoff_mode = 'check' default
   *   - members = current project_members (materialised at create time)
   *
   * @throws {DuplicateChannelNameError} when a department channel name
   *   already exists for this project (idempotency guard — call once
   *   per project lifetime).
   */
  createDepartmentChannels(
    projectId: string,
    options?: { includeOptional?: boolean },
  ): Channel[] {
    const blueprint = options?.includeOptional
      ? [...DEFAULT_DEPARTMENT_BLUEPRINT, ...OPTIONAL_DEPARTMENT_BLUEPRINT]
      : DEFAULT_DEPARTMENT_BLUEPRINT;
    const members = this.projectMembers.listMembers(projectId);
    // Department channels go AFTER system channels in `created_at` so
    // listByProject 정렬이 system → department 자연 순.
    const createdAt = Date.now() + 1000;
    const channels: Channel[] = blueprint.map((spec, idx) => ({
      id: randomUUID(),
      projectId,
      name: spec.name,
      kind: 'user' as const,
      readOnly: false,
      createdAt: createdAt + idx,
      role: spec.role,
      purpose: null,
      handoffMode: DEFAULT_HANDOFF_MODE,
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
        throw new DuplicateChannelNameError(projectId, '<department>');
      }
      throw err;
    }

    return channels;
  }
}
