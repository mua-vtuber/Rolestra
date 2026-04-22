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
import type { RoundSetting, BranchInfo, ForkResult, ConversationSummary, ChatMessageData } from './engine-types';
import type { ConsensusInfo } from './consensus-types';
import type { AuditEntry, DiffEntry } from './execution-types';
import type { WorkspaceInfo, PermissionRequest, ConsensusFolderInfo } from './file-types';
import type { StructuredLogEntry } from './log-types';
import type { MemoryTopic, MemorySearchResult, KnowledgeNode, ExtractionResult, AssembledContext } from './memory-types';
import type { SettingsConfig } from './config-types';
import type { ConversationSnapshot, StateRecoveryData } from './recovery-types';
import type { RemoteAccessPolicy, RemoteAccessGrant, RemotePermissionSet, RemoteSession, TailscaleStatus } from './remote-types';
import type { SessionInfo } from './session-state-types';
import type {
  Project,
  ProjectCreateInput,
  AutonomyMode,
} from './project-types';
import type { Channel, ChannelKind } from './channel-types';
import type { Message, MessageSearchResult, RecentMessage } from './message-types';
import type { Meeting, ActiveMeetingSummary } from './meeting-types';
import type {
  ApprovalItem,
  ApprovalStatus,
  ApprovalDecision,
} from './approval-types';
import type { QueueItem } from './queue-types';
import type {
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

  // ── Chat ─────────────────────────────────────────────────────────
  'chat:send': {
    request: { content: string; activeProviderIds?: string[]; attachments?: string[] };
    response: undefined;
  };
  'chat:pause': {
    request: undefined;
    response: undefined;
  };
  'chat:resume': {
    request: undefined;
    response: undefined;
  };
  'chat:stop': {
    request: undefined;
    response: undefined;
  };
  'chat:set-rounds': {
    request: { rounds: RoundSetting };
    response: undefined;
  };
  'chat:deep-debate': {
    request: { facilitatorId?: string } | undefined;
    response: undefined;
  };
  'chat:continue': {
    request: undefined;
    response: undefined;
  };
  // ── Fork / Branch ─────────────────────────────────────────────────
  'chat:fork': {
    request: { messageId: string };
    response: ForkResult;
  };
  'chat:list-branches': {
    request: undefined;
    response: { branches: BranchInfo[]; currentBranchId: string };
  };
  'chat:switch-branch': {
    request: { branchId: string };
    response: undefined;
  };

  // ── Conversation History ──────────────────────────────────────────
  'conversation:list': {
    request: { limit?: number; offset?: number };
    response: { conversations: ConversationSummary[] };
  };
  'conversation:load': {
    request: { conversationId: string };
    response: { messages: ChatMessageData[] };
  };
  'conversation:new': {
    request: undefined;
    response: undefined;
  };
  'conversation:delete': {
    request: { conversationId: string };
    response: { success: true };
  };

  // ── Consensus ─────────────────────────────────────────────────────
  'consensus:respond': {
    request: {
      decision: 'AGREE' | 'DISAGREE' | 'BLOCK' | 'ABORT';
      comment?: string;
      blockReasonType?: 'security' | 'data_loss' | 'spec_conflict' | 'unknown';
      failureResolution?: 'retry' | 'stop' | 'reassign';
      reassignFacilitatorId?: string;
    };
    response: undefined;
  };
  'consensus:set-facilitator': {
    request: { facilitatorId: string };
    response: { success: true };
  };
  'consensus:status': {
    request: undefined;
    response: { consensus: ConsensusInfo | null };
  };

  // ── Session (mode transition / worker / review) ─────────────────
  'session:mode-transition-respond': {
    request: { approved: boolean };
    response: undefined;
  };
  'session:select-worker': {
    request: { workerId: string };
    response: undefined;
  };
  'session:user-decision': {
    request: { decision: 'accept' | 'rework' | 'reassign' | 'stop'; reassignWorkerId?: string };
    response: undefined;
  };
  'session:status': {
    request: undefined;
    response: { session: SessionInfo | null };
  };

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

  // ── Runtime Permission Requests ───────────────────────────────────────
  'permission:list-pending': {
    request: undefined;
    response: { requests: PermissionRequest[] };
  };
  'permission:approve': {
    request: { requestId: string };
    response: { success: boolean; error?: string };
  };
  'permission:reject': {
    request: { requestId: string };
    response: { success: boolean; error?: string };
  };
  'permission:list-rules': {
    request: { aiId?: string };
    response: { rules: Array<{ aiId: string; path: string; read: boolean; write: boolean; execute: boolean }> };
  };

  // ── Workspace / Files ───────────────────────────────────────────
  'workspace:pick-folder': {
    request: undefined;
    response: { folderPath: string | null };
  };
  'workspace:init': {
    request: { projectFolder: string };
    response: { workspace: WorkspaceInfo };
  };
  'workspace:status': {
    request: undefined;
    response: { workspace: WorkspaceInfo | null };
  };

  // ── Consensus Folder ──────────────────────────────────────────
  'consensus-folder:status': {
    request: undefined;
    response: { folder: ConsensusFolderInfo | null };
  };
  'consensus-folder:pick': {
    request: undefined;
    response: { folderPath: string | null };
  };
  'consensus-folder:init': {
    request: { folderPath?: string };
    response: { folder: ConsensusFolderInfo };
  };
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
    response: { results: MessageSearchResult[] };
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
  'meeting:list-active': {
    request: { limit?: number } | undefined;
    response: { meetings: ActiveMeetingSummary[] };
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
};

/** Helper: extract channel names as a union type. */
export type IpcChannel = keyof IpcChannelMap;

/** Helper: extract request payload type for a given channel. */
export type IpcRequest<C extends IpcChannel> = IpcChannelMap[C]['request'];

/** Helper: extract response payload type for a given channel. */
export type IpcResponse<C extends IpcChannel> = IpcChannelMap[C]['response'];

/** Current schema version. Bump when IPC payload shapes change. */
export const CURRENT_SCHEMA_VERSION = 1;
