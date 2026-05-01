/**
 * IPC type definitions for typed IPC communication.
 *
 * All IPC messages carry IpcMeta for request tracking, versioning,
 * and streaming sequence detection.
 *
 * IpcChannelMap defines the contract between renderer and main process.
 * Adding a new channel here automatically provides type safety in both
 * the handler (main) and the caller (renderer/preload).
 */

import type { ProviderConfig, ProviderInfo, ProviderType } from './provider-types';
import type { RoleId, SkillId, SkillTemplate } from './role-types';
import type { AuditEntry, DiffEntry } from './execution-types';
import type { StructuredLogEntry } from './log-types';
import type { MemoryTopic, MemorySearchResult, KnowledgeNode, ExtractionResult, AssembledContext } from './memory-types';
import type { SettingsConfig, SettingsCorruptionInfo } from './config-types';
import type { ConversationSnapshot, StateRecoveryData } from './recovery-types';
import type { RemoteAccessPolicy, RemoteAccessGrant, RemotePermissionSet, RemoteSession, TailscaleStatus } from './remote-types';
import type {
  Project,
  ProjectCreateInput,
  AutonomyMode,
  PermissionMode,
} from './project-types';
import type { Channel, ChannelKind } from './channel-types';
import type { Message, RecentMessage } from './message-types';
import type { Meeting, ActiveMeetingSummary } from './meeting-types';
import type {
  ApprovalItem,
  ApprovalStatus,
  ApprovalDecision,
} from './approval-types';
import type { QueueItem } from './queue-types';
import type {
  AvatarUploadRequest,
  AvatarUploadResponse,
  MemberProfile,
  MemberView,
  WorkStatus,
} from './member-profile-types';
import type {
  NotificationPrefs,
  NotificationKind,
} from './notification-types';
import type { ArenaRootStatus } from './arena-root-types';
import type { KpiSnapshot, DashboardGetKpisInput } from './dashboard-types';
import type { DmCreateRequest, DmListResponse } from './dm-types';
import type {
  PermissionFlagInput,
  PermissionFlagOutput,
} from './permission-flag-types';
import type { MessageSearchResponse } from './message-search-types';
import type {
  OnboardingState,
  ProviderDetectionSnapshot,
} from './onboarding-types';
import type { LlmCostSummary } from './llm-cost-types';
import type {
  ApprovalDetail,
  ApprovalConsensusContext,
  ApprovalImpactedFile,
  ApprovalDiffPreview,
} from './approval-detail-types';

/** Common metadata attached to every IPC message. */
export interface IpcMeta {
  /** Unique request tracking ID (UUID v4). */
  requestId: string;
  /** Conversation session ID, if the call is scoped to a conversation. */
  conversationId?: string;
  /** Monotonic sequence number for streaming duplicate/gap detection. */
  sequence?: number;
  /** Schema version for forward-compatible payload evolution. */
  schemaVersion: number;
  /** Message creation timestamp (Date.now()). */
  timestamp: number;
}

/**
 * F1 (mock/fallback cleanup): `onboarding:apply-staff-selection` 응답의
 * skipped 배열 entry. main 이 사용자 선택 provider id 를 등록하지 못한 사유를
 * 코드로 분류해 호출자가 사용자에게 적절한 안내를 표시할 수 있게 한다.
 *
 *   - `already-registered` — 같은 id 의 provider 가 이미 registry 에 있어
 *     finish 흐름이 register 를 시도하지 않고 skip. 정상 케이스 (이전 부팅
 *     에서 Settings 로 수동 등록 등).
 *   - `not-detected` — detect-cli 결과에 매칭되는 binary 가 없어 등록 불가.
 *     (사용자가 step2 진입 후 PATH 변동 또는 staff 배열에 알려지지 않은 id).
 *   - `unsupported-kind` — provider id 는 알려졌으나 wizard 가 자동 등록을
 *     지원하지 않는 type (api / local). Settings 에서 수동 등록 권장.
 *   - `create-failed` — factory.createProvider / registry.register / DB
 *     persist 중 실패. detail 에 message.
 */
export interface OnboardingApplySkip {
  providerId: string;
  reason: 'already-registered' | 'not-detected' | 'unsupported-kind' | 'create-failed';
  detail?: string;
}

/** Detected CLI tool info returned by provider:detect-cli. */
export interface DetectedCli {
  command: string;
  displayName: string;
  version?: string;
  path: string;
  /** WSL distro name if the CLI was found inside WSL (undefined = native). */
  wslDistro?: string;
}

// ── v3 IPC input shapes ──────────────────────────────────────────
// These live inline here rather than in each domain-types file because
// they represent the IPC wire contract rather than a persisted model.

/** project:link-external input (CA-1/CA-3: external + auto forbidden). */
export interface ProjectLinkExternalInput {
  name: string;
  externalPath: string;
  description?: string;
  permissionMode: 'hybrid' | 'approval';
  autonomyMode?: AutonomyMode;
  initialMemberProviderIds?: string[];
}

/** project:import input. */
export interface ProjectImportInput {
  name: string;
  sourcePath: string;
  description?: string;
  permissionMode: 'auto' | 'hybrid' | 'approval';
  autonomyMode?: AutonomyMode;
  initialMemberProviderIds?: string[];
}

/** project:update input (partial patch). */
export interface ProjectUpdateInput {
  name?: string;
  description?: string;
  permissionMode?: 'auto' | 'hybrid' | 'approval';
  autonomyMode?: AutonomyMode;
}

/** channel:create input. */
export interface ChannelCreateInput {
  projectId: string | null;
  name: string;
  kind: ChannelKind;
  memberProviderIds: string[];
}

/** message:append input (user or system-origin messages from renderer). */
export interface MessageAppendInput {
  channelId: string;
  meetingId?: string | null;
  content: string;
  mentions?: string[];
}

/** message:search input. */
export interface MessageSearchInput {
  query: string;
  scope:
    | { kind: 'channel'; channelId: string }
    | { kind: 'project'; projectId: string };
  limit?: number;
}

/** queue:add input. */
export interface QueueAddInput {
  projectId: string;
  prompt: string;
  targetChannelId?: string | null;
}

/** queue:reorder input. */
export interface QueueReorderInput {
  projectId: string;
  orderedIds: string[];
}

/** notification:update-prefs input (partial per-kind update). */
export type NotificationPrefsPatch = Partial<{
  [K in NotificationKind]: Partial<{ enabled: boolean; soundEnabled: boolean }>;
}>;

/**
 * Central channel map.
 * Key   = channel name (kebab-case, colon-separated namespace).
 * Value = { request: payload sent by caller, response: payload returned by handler }.
 */
export type IpcChannelMap = {
  // ── App ──────────────────────────────────────────────────────────
  'app:ping': {
    request: undefined;
    response: { pong: true; timestamp: number };
  };
  'app:get-info': {
    request: undefined;
    response: { name: string; version: string };
  };

  // ── Provider CRUD ────────────────────────────────────────────────
  'provider:list': {
    request: undefined;
    response: { providers: ProviderInfo[] };
  };
  'provider:add': {
    request: { displayName: string; persona?: string; config: ProviderConfig };
    response: { provider: ProviderInfo };
  };
  'provider:remove': {
    request: { id: string };
    response: { success: true };
  };
  'provider:validate': {
    request: { id: string };
    response: { valid: boolean; message?: string };
  };
  'provider:detect-cli': {
    request: undefined;
    response: { detected: DetectedCli[] };
  };
  'provider:list-models': {
    request: { type: ProviderType; key: string; apiKeyRef?: string };
    response: { models: string[] };
  };
  'provider:list-embedding-models': {
    request: { type: ProviderType; key: string; apiKeyRef?: string };
    response: { models: string[] };
  };

  // ── R12-S Persona / Skill (능력 부여 + 카탈로그 조회) ────────────
  'skill:list': {
    request: undefined;
    response: { skills: SkillTemplate[] };
  };
  'skill:getTemplate': {
    request: { id: SkillId };
    response: { skill: SkillTemplate };
  };
  'provider:updateRoles': {
    request: {
      providerId: string;
      roles: RoleId[];
      skill_overrides: Partial<Record<RoleId, string>> | null;
    };
    response: { provider: ProviderInfo };
  };

  // ── Chat / Conversation / Consensus / Session (v2) ──────────────
  // R11-Task2 retired the 21 v2 channels (`chat:*` × 10, `conversation:*` × 4,
  // `consensus:*` × 3, `session:*` × 4). The v3 surface is `meeting:*` +
  // `approval:*` + `member:*` + the new dashboard / channel / message
  // handlers below.

  // ── Execution ───────────────────────────────────────────────────
  'execution:preview': {
    request: { operationId: string };
    response: { diffs: DiffEntry[] };
  };
  'execution:list-pending': {
    request: undefined;
    response: { operations: Array<{ operationId: string; diffs: DiffEntry[] }> };
  };
  'execution:approve': {
    request: { operationId: string };
    response: { success: boolean; error?: string };
  };
  'execution:reject': {
    request: { operationId: string };
    response: { success: boolean; error?: string };
  };

  // ── CLI Native Permission Requests ──────────────────────────────────
  // R7-Task4 removed `cli-permission:respond` — the v3 flow uses
  // `approval:decide` (ApprovalService) for every CLI permission decision.

  // ── Runtime Permission Requests / Workspace / Consensus Folder (v2) ──
  // R11-Task2 retired the v2 runtime permission channels
  // (`permission:list-pending` / `:approve` / `:reject` / `:list-rules`),
  // the workspace IPC (`workspace:pick-folder` / `:init` / `:status`), and
  // the consensus-folder IPC (`consensus-folder:status` / `:pick` / `:init`).
  // The v3 path uses `approval:list` + `approval:decide` for runtime
  // permission prompts (R7+) and `arena-root:*` + project-level services
  // for filesystem boundaries. Only the R10-Task5
  // `permission:dry-run-flags` preview survives.

  // ── Memory ──────────────────────────────────────────────────────────
  'memory:pin': {
    request: { messageId: string; topic: MemoryTopic };
    response: { success: true; nodeId: string };
  };
  'memory:search': {
    request: { query: string; topic?: MemoryTopic; limit?: number };
    response: { results: MemorySearchResult[] };
  };
  'memory:reindex': {
    request: undefined;
    response: { reindexed: number };
  };
  'memory:get-node': {
    request: { id: string };
    response: { node: KnowledgeNode | null };
  };
  'memory:delete-node': {
    request: { id: string };
    response: { deleted: boolean };
  };
  'memory:get-pinned': {
    request: { topic?: MemoryTopic };
    response: { nodes: KnowledgeNode[] };
  };
  'memory:extract-preview': {
    request: { messages: Array<{ content: string; participantId: string }> };
    response: ExtractionResult;
  };
  'memory:get-context': {
    request: { query: string; topic?: MemoryTopic };
    response: AssembledContext;
  };
  'memory:extract-and-store': {
    request: { messages: Array<{ content: string; participantId: string }>; conversationId?: string };
    response: { stored: number; skipped: number; mentions: number; conflicts: number };
  };

  // ── Audit Log ──────────────────────────────────────────────────────
  'audit:list': {
    request: { aiId?: string; action?: string; result?: string; since?: number; until?: number; limit?: number };
    response: { entries: AuditEntry[] };
  };
  'audit:clear': {
    request: undefined;
    response: { cleared: number };
  };

  // ── Structured Log ────────────────────────────────────────────────
  'log:list': {
    request: { component?: string; level?: string; result?: string; startTime?: number; endTime?: number; limit?: number };
    response: { entries: StructuredLogEntry[] };
  };
  'log:export': {
    request: { format: 'json' | 'markdown'; maskSecrets: boolean; component?: string; result?: string; startTime?: number; endTime?: number };
    response: { content: string; filename: string };
  };

  // ── Config ────────────────────────────────────────────────────────
  'config:get-settings': {
    request: undefined;
    response: { settings: SettingsConfig };
  };
  'config:update-settings': {
    request: { patch: Partial<SettingsConfig> };
    response: { settings: SettingsConfig };
  };
  'config:set-secret': {
    request: { key: string; value: string };
    response: { success: true };
  };
  'config:delete-secret': {
    request: { key: string };
    response: { success: true };
  };
  'config:list-secret-keys': {
    request: undefined;
    response: { keys: string[] };
  };
  // R12-S: 회의록 자동 정리 모델. providerId=null = 자동 선택.
  'settings:setSummaryModel': {
    request: { providerId: string | null };
    response: { settings: SettingsConfig };
  };
  // R12-S: 현재 자동 선택 결과 미리보기 — UI 카드가 "현재: Claude Haiku" 표시용.
  'settings:getResolvedSummaryModel': {
    request: undefined;
    response: { provider: ProviderInfo | null };
  };
  'config:take-startup-diagnostics': {
    request: undefined;
    response: { settingsCorruption: SettingsCorruptionInfo | null };
  };

  // ── Recovery ──────────────────────────────────────────────────────
  'recovery:list': {
    request: undefined;
    response: { conversations: StateRecoveryData[] };
  };
  'recovery:restore': {
    request: { conversationId: string };
    response: { success: boolean; error?: string; snapshot?: ConversationSnapshot };
  };
  'recovery:discard': {
    request: { conversationId: string };
    response: { success: true };
  };

  // ── Remote Access (Phase 5 handlers) ──────────────────────────────
  'remote:get-policy': {
    request: undefined;
    response: { policy: RemoteAccessPolicy };
  };
  'remote:set-policy': {
    request: { policy: RemoteAccessPolicy };
    response: { success: true };
  };
  'remote:get-sessions': {
    request: undefined;
    response: { sessions: RemoteSession[] };
  };
  'remote:tailscale-status': {
    request: undefined;
    response: { status: TailscaleStatus };
  };
  'remote:generate-token': {
    request: { permissions: RemotePermissionSet; description?: string; expiresAt?: number };
    response: { token: string; grantId: string };
  };
  'remote:list-grants': {
    request: undefined;
    response: { grants: RemoteAccessGrant[] };
  };
  'remote:revoke-token': {
    request: { grantId: string };
    response: { success: true };
  };
  'remote:start-server': {
    request: undefined;
    response: { success: true };
  };
  'remote:stop-server': {
    request: undefined;
    response: { success: true };
  };
  'remote:server-status': {
    request: undefined;
    response: { running: boolean; port: number };
  };

  // ── v3: Arena Root ──────────────────────────────────────────────
  'arena-root:get': {
    request: undefined;
    response: { path: string };
  };
  'arena-root:set': {
    request: { path: string };
    response: { success: true; requiresRestart: true };
  };
  'arena-root:status': {
    request: undefined;
    response: { status: ArenaRootStatus };
  };

  // ── v3: Project ─────────────────────────────────────────────────
  /**
   * v3 replacement for the legacy `workspace:pick-folder` channel.
   * Opens the OS directory picker and returns the selected absolute
   * path (or `null` when the user cancels). Used by the project
   * create/link/import modal to pick `externalPath` / `sourcePath`.
   */
  'project:pick-folder': {
    request: undefined;
    response: { folderPath: string | null };
  };
  'project:list': {
    request: { includeArchived?: boolean } | undefined;
    response: { projects: Project[] };
  };
  'project:create': {
    request: ProjectCreateInput;
    response: { project: Project };
  };
  'project:link-external': {
    request: ProjectLinkExternalInput;
    response: { project: Project };
  };
  'project:import': {
    request: ProjectImportInput;
    response: { project: Project };
  };
  'project:update': {
    request: { id: string; patch: ProjectUpdateInput };
    response: { project: Project };
  };
  'project:archive': {
    request: { id: string };
    response: { success: true };
  };
  'project:open': {
    request: { id: string };
    response: { success: true };
  };
  'project:set-autonomy': {
    request: { id: string; mode: AutonomyMode };
    response: { project: Project };
  };
  /**
   * R7-Task8: requests a spec §7.3 CB-3 mode transition. Opens an
   * `approval_items` row of `kind='mode_transition'`; the actual DB write
   * on the project row happens later when ApprovalDecisionRouter sees the
   * user's decision. Pre-flight rejects `external + auto` and any project
   * with an active meeting — see ProjectService errors.
   */
  'project:request-permission-mode-change': {
    request: {
      id: string;
      targetMode: PermissionMode;
      reason?: string;
    };
    response: { approval: ApprovalItem };
  };

  // ── v3: Channel ─────────────────────────────────────────────────
  'channel:list': {
    request: { projectId: string | null };
    response: { channels: Channel[] };
  };
  'channel:create': {
    request: ChannelCreateInput;
    response: { channel: Channel };
  };
  'channel:rename': {
    request: { id: string; name: string };
    response: { channel: Channel };
  };
  'channel:delete': {
    request: { id: string };
    response: { success: true };
  };
  'channel:add-members': {
    request: { id: string; providerIds: string[] };
    response: { success: true };
  };
  'channel:remove-members': {
    request: { id: string; providerIds: string[] };
    response: { success: true };
  };
  'channel:start-meeting': {
    request: { channelId: string; topic: string };
    response: { meeting: Meeting };
  };

  // ── v3: Message ─────────────────────────────────────────────────
  'message:append': {
    request: MessageAppendInput;
    response: { message: Message };
  };
  'message:list-by-channel': {
    request: { channelId: string; limit?: number; beforeCreatedAt?: number };
    response: { messages: Message[] };
  };
  'message:search': {
    request: MessageSearchInput;
    response: MessageSearchResponse;
  };
  'message:list-recent': {
    request: { limit?: number } | undefined;
    response: { messages: RecentMessage[] };
  };

  // ── v3: Meeting ─────────────────────────────────────────────────
  'meeting:abort': {
    request: { meetingId: string };
    response: { success: true };
  };
  /**
   * D-A T2: 진행 중 회의 종료 요청 (사용자 hover [회의 종료] 클릭).
   *
   * `meeting:abort` 와 다른 점 — abort 는 즉시 강제 중단 + 회의록 미생성,
   * request-stop 은 graceful: orchestrator 가 다음 turn 경계에서 중단 신호를
   * 받아 합의/논쟁/미결 3 섹션 partial 회의록을 생성한다 (T9 에서 wired).
   * 응답의 `stoppedAt` 은 종료 표시 시각 ms epoch — 실제 회의 종료까지는
   * 약간의 지연이 있을 수 있다.
   */
  'meeting:request-stop': {
    request: { meetingId: string };
    response: { stoppedAt: number };
  };
  /**
   * D-A T2: 회의 주제 inline 편집 (ChannelHeader MeetingTopicEditor).
   * 200 자 이내. 호출 즉시 DB 갱신 + meeting:list-active stream 재방출.
   */
  'meeting:edit-topic': {
    request: { meetingId: string; topic: string };
    response: { topic: string };
  };
  /**
   * D-A T2: 회의 일시정지. orchestrator 가 다음 turn 경계에서 PAUSED state
   * 로 진입하고 paused_at 을 DB 에 기록. 응답의 `pausedAt` 은 같은 ms epoch.
   */
  'meeting:pause': {
    request: { meetingId: string };
    response: { pausedAt: number };
  };
  /**
   * D-A T2: 일시정지된 회의 재개. paused_at 을 NULL 로 되돌리고 orchestrator
   * 가 다음 turn 부터 정상 진행. 응답의 `resumedAt` 은 재개 시각 ms epoch.
   */
  'meeting:resume': {
    request: { meetingId: string };
    response: { resumedAt: number };
  };
  'meeting:list-active': {
    request: { limit?: number } | undefined;
    response: { meetings: ActiveMeetingSummary[] };
  };
  /**
   * R10-Task11: LLM 1단락 회의록 요약. `providerId` 를 명시하면 해당 provider
   * 의 summarize capability 로 실행, 생략 시 `summarize: true` 인 첫 provider
   * fallback chain(Decision D7). provider 가 없거나 호출이 throw 하면
   * `{ summary: null, providerUsed: null, reason }` 로 응답.
   */
  'meeting:llm-summarize': {
    request: { meetingId: string; providerId?: string };
    response: {
      summary: string | null;
      providerUsed: string | null;
      reason: 'ok' | 'no_provider' | 'provider_error' | 'disabled';
    };
  };

  // ── v3: DM (R10-Task1) ──────────────────────────────────────────
  /**
   * R10-Task3: 사용자↔AI 1:1 DM 채널 목록. 아직 DM 이 없는 provider 도
   * `channel=null, exists=false` 로 포함해 renderer 에서 "새 DM 생성" 모달이
   * 비활성 여부를 한 번의 응답으로 결정할 수 있게 한다.
   */
  'dm:list': {
    request: undefined;
    response: DmListResponse;
  };
  /**
   * R10-Task3: 지정 provider 와 1:1 DM 채널 생성. `idx_dm_unique_per_provider`
   * 가 중복 방지를 보장하므로 이미 있는 provider 를 넘기면 UNIQUE 위반
   * throw — 호출자는 먼저 `dm:list` 로 존재 여부를 확인한다.
   */
  'dm:create': {
    request: DmCreateRequest;
    response: { channel: Channel };
  };

  // ── v3: Permission Flag Builder (R10-Task5) ────────────────────
  /**
   * R10-Task5: 설정 UI 의 CLI 탭이 "현재 조합에 어떤 플래그가 붙는가"를
   * 미리 보여주도록 PermissionFlagBuilder 를 dry-run 으로 호출한다.
   * Service 를 실제로 spawn 하지는 않고 argv 배열만 반환.
   */
  'permission:dry-run-flags': {
    request: PermissionFlagInput;
    response: PermissionFlagOutput;
  };

  // ── v3: Member Profile ──────────────────────────────────────────
  'member:list': {
    request: undefined;
    response: { members: MemberView[] };
  };
  'member:get-profile': {
    request: { providerId: string };
    response: { profile: MemberProfile };
  };
  'member:update-profile': {
    request: { providerId: string; patch: Partial<MemberProfile> };
    response: { profile: MemberProfile };
  };
  'member:set-status': {
    request: { providerId: string; status: 'online' | 'offline-manual' };
    response: { success: true };
  };
  'member:reconnect': {
    request: { providerId: string };
    response: { status: WorkStatus };
  };
  'member:list-avatars': {
    request: undefined;
    response: { avatars: Array<{ key: string; label: string }> };
  };
  'member:upload-avatar': {
    request: AvatarUploadRequest;
    response: AvatarUploadResponse;
  };
  'member:pick-avatar-file': {
    request: undefined;
    response: { sourcePath: string | null };
  };

  // ── v3: Approval Inbox ──────────────────────────────────────────
  'approval:list': {
    request: { status?: ApprovalStatus; projectId?: string } | undefined;
    response: { items: ApprovalItem[] };
  };
  'approval:decide': {
    request: {
      id: string;
      decision: ApprovalDecision;
      comment?: string;
    };
    response: { success: true };
  };
  /**
   * F6-T1: tab-badge counts for the inbox view. Returns one number per
   * status bucket (`pending`/`approved`/`rejected`) plus the union of
   * all three as `all` so the renderer can populate the tab badges in
   * a single round-trip — `approval:list` is single-status and the
   * naive 4-call workaround returns 0 for inactive tabs. `projectId`
   * scopes the count when supplied; omit for cross-project totals.
   *
   * `expired` / `superseded` rows are deliberately excluded because the
   * inbox UI does not surface them (they are retirement transitions,
   * not user-facing decisions). `all` therefore reflects the sum of the
   * three visible buckets, not the raw row count.
   */
  'approval:count': {
    request: { projectId?: string } | undefined;
    response: {
      pending: number;
      approved: number;
      rejected: number;
      all: number;
    };
  };

  // ── v3: Notification ────────────────────────────────────────────
  'notification:get-prefs': {
    request: undefined;
    response: { prefs: NotificationPrefs };
  };
  'notification:update-prefs': {
    request: { patch: NotificationPrefsPatch };
    response: { prefs: NotificationPrefs };
  };
  'notification:test': {
    request: { kind: NotificationKind };
    response: { success: true };
  };
  /**
   * R10-Task12: switch the main-process notification label dictionary
   * (`notification-labels.ts`) to the supplied locale. Renderer-side
   * i18next is updated via `i18n.changeLanguage(...)` separately — this
   * IPC keeps the OS notification copy + system message labels in sync.
   */
  'notification:set-locale': {
    request: { locale: 'ko' | 'en' };
    response: { locale: 'ko' | 'en' };
  };

  // ── v3: Queue (CD-2) ────────────────────────────────────────────
  'queue:list': {
    request: { projectId: string };
    response: { items: QueueItem[] };
  };
  'queue:add': {
    request: QueueAddInput;
    response: { item: QueueItem };
  };
  'queue:reorder': {
    request: QueueReorderInput;
    response: { success: true };
  };
  'queue:remove': {
    request: { id: string };
    response: { success: true };
  };
  'queue:cancel': {
    request: { id: string };
    response: { success: true };
  };
  'queue:pause': {
    request: { projectId: string };
    response: { success: true };
  };
  'queue:resume': {
    request: { projectId: string };
    response: { success: true };
  };

  // ── v3: Dashboard (R4) ──────────────────────────────────────────
  'dashboard:get-kpis': {
    request: DashboardGetKpisInput;
    response: { snapshot: KpiSnapshot };
  };

  // ── Database Management ─────────────────────────────────────────
  'db:export': {
    request: undefined;
    response: { success: boolean; path?: string };
  };
  'db:import': {
    request: undefined;
    response: { success: boolean; requiresRestart: boolean };
  };
  'db:stats': {
    request: undefined;
    response: { tables: Array<{ name: string; count: number }>; sizeBytes: number };
  };

  // ── R11-Task5: Onboarding wizard (single-window) ────────────────
  /**
   * R11-Task5/6: 첫 부팅 wizard 의 마지막 저장 상태를 한 번에 읽어 온다.
   * 마이그레이션 013 의 `onboarding_state` 단일행 테이블이 source-of-truth.
   * 처음 부팅이라 row 가 없으면 service 가 `completed=false, currentStep=1`
   * 의 default 를 만들어 응답한다.
   */
  'onboarding:get-state': {
    request: undefined;
    response: { state: OnboardingState };
  };
  /**
   * R11-Task5/6: 진행 중 step 별 부분 patch. `partial.completed=true` 가
   * 들어와도 service 는 무시 (`onboarding:complete` 채널만 완료 처리).
   * 응답은 patch 적용 후의 전체 state.
   */
  'onboarding:set-state': {
    request: { partial: Partial<OnboardingState> };
    response: { state: OnboardingState };
  };
  /**
   * R11-Task5/6: wizard 마무리 — `completed=true + updatedAt=now` 로 row 갱신.
   * 호출 후 ShellTopBar 의 "Restart onboarding" CTA 외에는 wizard 진입 경로가
   * 없다.
   */
  'onboarding:complete': {
    request: undefined;
    response: { success: true };
  };

  /**
   * F1 (mock/fallback cleanup): wizard 가 step 2 에서 사용자가 선택한 staff
   * provider id 목록을 받아 main 측에서 (i) detect-cli 를 다시 한 번 실행해
   * binary path / wslDistro 를 도출하고, (ii) 해당 provider 가 registry 에
   * 아직 등록 안 됐다면 createProvider + saveProvider 흐름으로 영속화한다.
   * 호출자 (App.tsx) 는 응답의 `added` 와 `skipped` 를 검사해 사용자에게
   * 필요한 추가 안내 (예: API/local 은 Settings 에서 수동 등록) 를 제시한다.
   */
  'onboarding:apply-staff-selection': {
    request: { providerIds: string[] };
    response: {
      added: ProviderInfo[];
      skipped: OnboardingApplySkip[];
    };
  };

  // ── R11-Task5: Provider auto-detection (Onboarding step 2) ──────
  /**
   * R11-Task5/6: 로컬에 설치된 provider (CLI binary / API key) 를 한 번에
   * 스캔. wizard 의 step 2 가 결과를 그대로 카드 grid 로 렌더한다. 호출자는
   * 결과 capabilities snapshot 의 'summarize' 여부로 디폴트 선택을 정한다.
   */
  'provider:detect': {
    request: undefined;
    response: { snapshots: ProviderDetectionSnapshot[] };
  };

  // ── R11-Task5: LLM cost summary (Settings 누적 카드) ────────────
  /**
   * R11-Task5/8: Settings 의 "누적 비용" 카드용 집계. periodDays 미지정 시
   * service default (R11 default = 30일) 를 사용한다. estimatedUsd 는
   * 사용자가 Settings 에서 단가를 입력한 provider 만 채워지고 나머지는 null.
   */
  'llm:cost-summary': {
    request: { periodDays?: number };
    response: { summary: LlmCostSummary };
  };

  // ── R11-Task5: Approval 상세 패널 (R11-Task7 의존) ──────────────
  /**
   * R11-Task5/7: ExecutionService 의 dry-run preview 결과만 반환한다 — 실제
   * apply 는 하지 않는다. Approval 상세 패널의 "변경 미리보기" 카드용.
   */
  'execution:dry-run-preview': {
    request: { approvalId: string };
    response: {
      impactedFiles: ApprovalImpactedFile[];
      diffPreviews: ApprovalDiffPreview[];
    };
  };
  /**
   * R11-Task5/7: 카드 한 장에 필요한 모든 라운드트립을 1건으로 합친다 —
   * (approval row + impacted files + diff preview + consensus context).
   */
  'approval:detail-fetch': {
    request: { approvalId: string };
    response: { detail: ApprovalDetail };
  };
  /**
   * R11-Task5/7: 패널의 "회의 맥락" 카드 — 합의 turn 의 투표 결과를 따로
   * 조회하기 위한 별도 채널. detail-fetch 로도 받아오지만 갱신 시 부분
   * refresh 가 가능하도록 분리.
   */
  'meeting:voting-history': {
    request: { meetingId: string };
    response: { context: ApprovalConsensusContext };
  };

  // ── R11-Task4: dev hooks (E2E only, gated by ROLESTRA_E2E=1) ────
  // Registered by router.ts only when `process.env.ROLESTRA_E2E === '1'`
  // and exposed to the renderer through `__rolestraDevHooks` in preload.
  // Not part of the production surface — production builds boot without
  // the channel and the renderer-side helper, so a renderer bug or
  // DevTools console session cannot accidentally trigger an autonomy
  // downgrade.
  'dev:trip-circuit-breaker': {
    request:
      | {
          tripwire: 'files_per_turn';
          count: number;
          projectId?: string;
        }
      | {
          tripwire: 'cumulative_cli_ms';
          ms: number;
          projectId?: string;
        }
      | {
          tripwire: 'queue_streak';
          count: number;
          projectId?: string;
        }
      | {
          tripwire: 'same_error';
          category: string;
          count: number;
          projectId?: string;
        };
    response: {
      ok: boolean;
      projectId: string | null;
      tripwire:
        | 'files_per_turn'
        | 'cumulative_cli_ms'
        | 'queue_streak'
        | 'same_error';
    };
  };
};

/** Helper: extract channel names as a union type. */
export type IpcChannel = keyof IpcChannelMap;

/** Helper: extract request payload type for a given channel. */
export type IpcRequest<C extends IpcChannel> = IpcChannelMap[C]['request'];

/** Helper: extract response payload type for a given channel. */
export type IpcResponse<C extends IpcChannel> = IpcChannelMap[C]['response'];

/** Current schema version. Bump when IPC payload shapes change. */
export const CURRENT_SCHEMA_VERSION = 1;
