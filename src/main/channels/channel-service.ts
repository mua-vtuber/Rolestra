/**
 * ChannelService — DM channel creation + the global general channel.
 *
 * D1 (2026-09-28): this service used to also own project-scoped channel
 * CRUD (create/rename/delete/addMember/removeMember/listByProject),
 * department-channel provisioning (createSystemChannels/
 * createDepartmentChannels), and per-channel permission read/write
 * (getPermissions/updatePermissions/the 'permission-changed' event,
 * which existed only for a MeetingSession class that no longer exists
 * in this codebase). None of those methods had an IPC channel wired to
 * them — `channel-handler.ts` only ever calls `listDms`,
 * `getGlobalGeneralChannel`, `listMembers`, `archiveConversation`, and
 * `createDm` on this service (see channel:list/get-global-general/
 * list-members/archive-conversation/dm:create in router.ts). They were
 * removed along with their now-unreferenced imports (channel blueprints,
 * SKILL_CATALOG, MEETING_DEFAULT_MAX_ROUNDS, catalogDefaultFor,
 * ALL_ROLE_IDS-backed role schema).
 *
 * D1 follow-up (2026-09-29): the constructor's second parameter
 * (`projectMembers: ProjectMemberLookup`) was residue from the same
 * removal — its only readers were the deleted createSystemChannels/
 * createDepartmentChannels methods, and grepping this file found zero
 * reads of `this.projectMembers`. Removed along with the
 * `ProjectMemberLookup` interface (unreferenced outside this file) and
 * the now-dead `ProjectMember` type import. The constructor is now
 * `(repo, deps?)`; `bootstrap/chat-services.ts` no longer builds a
 * `ProjectRepository` just to satisfy this parameter.
 *
 * Responsibilities that remain:
 *   - `createDm(providerId)` — create a DM channel (project_id=NULL,
 *     kind='dm') + one `channel_members` row for the provider. The
 *     partial unique index `idx_dm_unique_per_provider` enforces the
 *     "one DM per provider" invariant.
 *   - `listDms()` / `listMembers(channelId)` / `get(id)` — reads used by
 *     the chat handlers and the whisper/opinion flows.
 *   - `getGlobalGeneralChannel()` / `ensureGlobalGeneralChannel()` — the
 *     single global #일반 channel (project_id IS NULL).
 *   - `archiveConversation(channelId)` — dumps the global general
 *     channel's messages to disk and clears them ("새 대화 시작").
 *
 * Naming:
 *   DM channels use `name = `dm:${providerId}`` so the UNIQUE (project_id,
 *   name) constraint serves as a second line of defence alongside the
 *   partial unique index on members.
 *
 * Error mapping:
 *   All domain errors extend {@link ChannelError}. SQLite UNIQUE / FK
 *   violations are caught at the call sites that can identify the cause
 *   unambiguously and translated into specific error classes.
 */

import { randomUUID } from 'node:crypto';
import { promises as fsPromises } from 'node:fs';
import path from 'node:path';
import type { Channel } from '../../shared/channel-types';
import type { Message } from '../../shared/message-types';
import { catalogDefaultForNullRole } from '../../shared/permission-set-types';
import { providerRegistry } from '../providers/registry';
import { ChannelRepository } from './channel-repository';
import {
  ChannelError,
  ChannelNotFoundError,
  DuplicateDmError,
  SystemChannelProtectedError,
} from './channel-errors';
import {
  isChannelNameUniqueViolation,
  isDmUniqueViolation,
} from './channel-sqlite-errors';

export {
  ChannelError,
  ChannelNotFoundError,
  DuplicateDmError,
  SystemChannelProtectedError,
} from './channel-errors';

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

export interface ConversationArchiveLifecycle {
  /** Mark the room inactive synchronously, then drain its in-flight work. */
  pause(channelId: string): Promise<void>;
  resume(channelId: string): void;
}

export class ChannelService {
  private readonly archiveMessages: ArchiveMessageAdapter | null;
  private readonly archiveRoot: ArchiveRootProvider | null;
  private readonly archivingConversations = new Set<string>();
  private archiveLifecycle: ConversationArchiveLifecycle | null = null;

  constructor(
    private readonly repo: ChannelRepository,
    deps?: ChannelServiceDeps,
  ) {
    this.archiveMessages = deps?.archiveMessages ?? null;
    this.archiveRoot = deps?.archiveRoot ?? null;
  }

  setConversationArchiveLifecycle(lifecycle: ConversationArchiveLifecycle): void {
    this.archiveLifecycle = lifecycle;
  }

  isConversationArchiving(channelId: string): boolean {
    return this.archivingConversations.has(channelId);
  }

  assertAppendAllowed(channelId: string): void {
    if (this.isConversationArchiving(channelId)) {
      throw new ChannelError(`Conversation archive in progress: ${channelId}`);
    }
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
      // R12-C2 — DM 은 회의 X (개별 지시 방) 라 NULL.
      maxRounds: null,
      // R12-W T5 — DM 도 회의 X 라 권한 단락이 surface 되지 않지만 schema
      // 일관성 위해 D2 안전 측 값 (읽기만) 으로 채움.
      permissions: catalogDefaultForNullRole(),
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

  /** Returns channel-members for `channelId` ordered by provider id. */
  listMembers(channelId: string) {
    // R12-C2 P1.5 follow-up — 일반 채널 (전역 system_general) 은 모든
    // 등록 직원이 자동 멤버. spec §11.3 + 메모리 r12-meeting-system
    // -redesign §3 결정: "general 능력 모든 직원 자동 부여 / 모든 직원이
    // 일반 능력 자동 부여". channel_members 테이블 sync (boot reconcile +
    // 직원 등록/삭제 hook) 대신 ProviderRegistry 동적 합성 — DB write 0
    // + 직원 등록 시점에 hook 불필요 + 직원 삭제 시 cleanup 불필요. 일반
    // 채널의 *프로젝트 외부 전역 1개* 정체성과 일치.
    const channel = this.repo.get(channelId);
    if (channel?.kind === 'system_general') {
      return providerRegistry.listAll().map((p, idx) => ({
        channelId,
        projectId: null,
        providerId: p.id,
        dragOrder: idx,
      }));
    }
    return this.repo.listMembers(channelId);
  }

  /** List every DM channel. */
  listDms(): Channel[] {
    return this.repo.listDms();
  }

  /** Per-channel lookup. Returns `null` when `id` is unknown. */
  get(id: string): Channel | null {
    return this.repo.get(id);
  }

  /**
   * Delete a channel row. System channels are locked — this exists for
   * {@link DmChannelService.delete}, which already asserts
   * `channel.kind === 'dm'` before calling here, so the system-channel
   * guard below is defence-in-depth rather than a reachable branch on
   * that call path.
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
   *   `ChannelError` throw — defence-in-depth.
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
    if (this.archivingConversations.has(channelId)) {
      throw new ChannelError(`Conversation archive already in progress: ${channelId}`);
    }
    this.archivingConversations.add(channelId);
    try {
      await this.archiveLifecycle?.pause(channelId);
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
      await fsPromises.writeFile(archivedPath, JSON.stringify(dump, null, 2), 'utf8');
      const deletedCount = this.archiveMessages.deleteByChannel(channelId);
      return { archivedPath, deletedCount };
    } finally {
      try { this.archiveLifecycle?.resume(channelId); }
      finally { this.archivingConversations.delete(channelId); }
    }
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
      handoffMode: 'check',
      // R12-C2 — 일반 채널 (system_general, 전역) 은 회의 X (잡담 정체성) 라 NULL.
      maxRounds: null,
      // R12-W T5 — system 채널은 회의 컨텍스트 X. D2 안전 측 default.
      permissions: catalogDefaultForNullRole(),
    };
    this.repo.insert(channel);
    return channel;
  }
}
