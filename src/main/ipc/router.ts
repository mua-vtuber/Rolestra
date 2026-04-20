/**
 * IPC Router — registers all typed IPC handlers on ipcMain.
 *
 * Design decisions:
 * - One call to registerIpcHandlers() in main/index.ts before window creation.
 * - Each channel in IpcChannelMap gets a corresponding ipcMain.handle().
 * - The envelope shape is { data, meta } where data is the typed payload
 *   and meta is IpcMeta (built by preload/typedInvoke).
 * - Critical channels (secrets, execution, remote) are validated with zod
 *   in BOTH development and production modes.
 * - Non-critical channels use zod validation in development mode only.
 * - Guard against double-registration with a module-level flag.
 */

import { ipcMain } from 'electron';
import type { IpcMeta, IpcChannel, IpcChannelMap } from '../../shared/ipc-types';
import { CURRENT_SCHEMA_VERSION } from '../../shared/ipc-types';
import { validateCriticalPayload, v3ChannelSchemas } from '../../shared/ipc-schemas';
import type { IpcErrorCode } from '../../shared/ipc-error';
import { handlePing, handleGetInfo } from './handlers/app-handler';
import {
  handleProviderList,
  handleProviderAdd,
  handleProviderRemove,
  handleProviderValidate,
  handleProviderListEmbeddingModels,
  handleProviderListModels,
} from './handlers/provider-handler';
import {
  handleChatSend,
  handleChatPause,
  handleChatResume,
  handleChatStop,
  handleChatSetRounds,
  handleChatDeepDebate,
  handleChatContinue,
  handleChatFork,
  handleChatListBranches,
  handleChatSwitchBranch,
  handleSessionModeTransitionRespond,
  handleSessionSelectWorker,
  handleSessionUserDecision,
  handleSessionStatus,
} from './handlers/chat-handler';
import {
  handleConsensusRespond,
  handleConsensusStatus,
  handleConsensusSetFacilitator,
} from './handlers/consensus-handler';
import {
  handleExecutionPreview,
  handleExecutionListPending,
  handleExecutionApprove,
  handleExecutionReject,
} from './handlers/execution-handler';
import {
  handlePermissionListPending,
  handlePermissionApprove,
  handlePermissionReject,
  handlePermissionListRules,
} from './handlers/permission-handler';
import { handleCliPermissionRespond } from './handlers/cli-permission-handler';
import {
  handleWorkspacePickFolder,
  handleWorkspaceInit,
  handleWorkspaceStatus,
  handleConsensusFolderStatus,
  handleConsensusFolderPick,
  handleConsensusFolderInit,
} from './handlers/workspace-handler';
import {
  handleMemoryPin,
  handleMemorySearch,
  handleMemoryReindex,
  handleMemoryGetNode,
  handleMemoryDeleteNode,
  handleMemoryGetPinned,
  handleMemoryExtractPreview,
  handleMemoryGetContext,
  handleMemoryExtractAndStore,
} from './handlers/memory-handler';
import {
  handleConfigGetSettings,
  handleConfigUpdateSettings,
  handleConfigSetSecret,
  handleConfigDeleteSecret,
  handleConfigListSecretKeys,
} from './handlers/config-handler';
import {
  handleRecoveryList,
  handleRecoveryRestore,
  handleRecoveryDiscard,
} from './handlers/recovery-handler';
import {
  handleRemoteGetPolicy,
  handleRemoteSetPolicy,
  handleRemoteGetSessions,
  handleRemoteTailscaleStatus,
  handleRemoteGenerateToken,
  handleRemoteListGrants,
  handleRemoteRevokeToken,
  handleRemoteStartServer,
  handleRemoteStopServer,
  handleRemoteServerStatus,
} from './handlers/remote-handler';
import { handleProviderDetectCli } from './handlers/cli-detect-handler';
import {
  handleConversationList,
  handleConversationLoad,
  handleConversationNew,
  handleConversationDelete,
} from './handlers/conversation-handler';
import {
  handleAuditList,
  handleAuditClear,
} from './handlers/audit-handler';
import {
  handleLogList,
  handleLogExport,
} from './handlers/log-handler';
import {
  handleDbExport,
  handleDbImport,
  handleDbStats,
} from './handlers/database-handler';
import {
  handleArenaRootGet,
  handleArenaRootSet,
  handleArenaRootStatus,
} from './handlers/arena-root-handler';
import {
  handleProjectList,
  handleProjectCreate,
  handleProjectLinkExternal,
  handleProjectImport,
  handleProjectUpdate,
  handleProjectArchive,
  handleProjectOpen,
  handleProjectSetAutonomy,
} from './handlers/project-handler';
import {
  handleChannelList,
  handleChannelCreate,
  handleChannelRename,
  handleChannelDelete,
  handleChannelAddMembers,
  handleChannelRemoveMembers,
  handleChannelStartMeeting,
} from './handlers/channel-handler';
import {
  handleMessageAppend,
  handleMessageListByChannel,
  handleMessageSearch,
} from './handlers/message-handler';
import { handleMeetingAbort } from './handlers/meeting-handler';
import {
  handleMemberList,
  handleMemberGetProfile,
  handleMemberUpdateProfile,
  handleMemberSetStatus,
  handleMemberReconnect,
  handleMemberListAvatars,
} from './handlers/member-handler';
import {
  handleApprovalList,
  handleApprovalDecide,
} from './handlers/approval-handler';
import {
  handleNotificationGetPrefs,
  handleNotificationUpdatePrefs,
  handleNotificationTest,
} from './handlers/notification-handler';
import {
  handleQueueList,
  handleQueueAdd,
  handleQueueReorder,
  handleQueueRemove,
  handleQueueCancel,
  handleQueuePause,
  handleQueueResume,
} from './handlers/queue-handler';
import { handleDashboardGetKpis } from './handlers/dashboard-handler';

/** Envelope shape sent by preload's typedInvoke. */
interface IpcEnvelope<C extends IpcChannel> {
  data: IpcChannelMap[C]['request'];
  meta: IpcMeta;
}

/** Whether handlers have already been registered. */
let registered = false;

/**
 * Validate IpcMeta at runtime.
 * Runs in all environments (dev + production) for security hardening.
 * Uses dynamic import so zod is tree-shaken if unused elsewhere.
 */
async function validateMeta(meta: unknown): Promise<IpcMeta> {
  const { z } = await import('zod');
  const metaSchema = z.object({
    requestId: z.string().uuid(),
    conversationId: z.string().optional(),
    sequence: z.number().int().nonnegative().optional(),
    schemaVersion: z.number().int().positive(),
    timestamp: z.number().positive(),
  });
  return metaSchema.parse(meta) as IpcMeta;
}

/**
 * Warn if the incoming schemaVersion differs from the current one.
 * This helps catch version mismatches during development.
 */
function checkSchemaVersion(meta: IpcMeta, channel: string): void {
  if (meta.schemaVersion !== CURRENT_SCHEMA_VERSION) {
    console.warn(
      `[IPC] Schema version mismatch on "${channel}": ` +
        `expected ${CURRENT_SCHEMA_VERSION}, got ${meta.schemaVersion}`,
    );
  }
}

/** Classify an error into a structured error code based on its message. */
function classifyError(err: unknown): IpcErrorCode {
  if (!(err instanceof Error)) return 'INTERNAL_ERROR';
  const msg = err.message.toLowerCase();
  if (msg.includes('not found') || msg.includes('not exist')) return 'NOT_FOUND';
  if (msg.includes('not initialized') || msg.includes('no active')) return 'INVALID_STATE';
  if (msg.includes('validation') || msg.includes('invalid')) return 'VALIDATION_ERROR';
  if (msg.includes('permission') || msg.includes('denied')) return 'PERMISSION_DENIED';
  if (msg.includes('network') || msg.includes('econnrefused') || msg.includes('timeout')) return 'NETWORK_ERROR';
  return 'INTERNAL_ERROR';
}

/** All registered channel names, used for unregisterIpcHandlers(). */
const registeredChannels: string[] = [];

/**
 * Channels that are still wired but scheduled for removal in R3 once
 * the renderer migrates to the v3 shape. Invocations keep working so
 * the app stays bootable — we only surface a console warning the first
 * time each channel is called, so ops can spot leftover callers in
 * logs without getting spammed on every invocation.
 *
 * Keep this list additive only: R3 removes, R2 annotates. Adding or
 * removing entries here MUST be paired with an IpcChannelMap change or
 * a handler removal to stay honest.
 */
const LEGACY_V2_CHANNELS: ReadonlySet<string> = new Set([
  // Chat / conversation UI still drives a v2-shaped session today.
  'chat:send',
  'chat:pause',
  'chat:resume',
  'chat:stop',
  'chat:set-rounds',
  'chat:deep-debate',
  'chat:continue',
  'chat:fork',
  'chat:list-branches',
  'chat:switch-branch',
  'conversation:list',
  'conversation:load',
  'conversation:new',
  'conversation:delete',
  // Workspace/consensus folder flow predates the Rolestra ArenaRoot.
  'workspace:pick-folder',
  'workspace:init',
  'workspace:status',
  'consensus-folder:status',
  'consensus-folder:pick',
  'consensus-folder:init',
  // Consensus + session v2 surface; replaced in v3 by approval + meeting.
  'consensus:respond',
  'consensus:status',
  'consensus:set-facilitator',
  'session:mode-transition-respond',
  'session:select-worker',
  'session:user-decision',
  'session:status',
]);

/** Channels we've already warned about — console is warned once per run. */
const legacyChannelsWarned = new Set<string>();

function warnOnceLegacy(channel: string): void {
  if (legacyChannelsWarned.has(channel)) return;
  legacyChannelsWarned.add(channel);
  console.warn(
    `[IPC] legacy v2 channel "${channel}" invoked — scheduled for removal in R11`,
  );
}

/**
 * Register a typed IPC handler with validation.
 *
 * - Critical channel payloads are always validated (dev + production).
 * - Meta is always validated (dev + production) for security hardening.
 */
function handle<C extends IpcChannel>(
  channel: C,
  isDev: boolean,
  handler: (data: IpcChannelMap[C]['request']) => unknown,
): void {
  registeredChannels.push(channel);

  ipcMain.handle(channel, async (_event, envelope: IpcEnvelope<C>) => {
    await validateMeta(envelope.meta);
    checkSchemaVersion(envelope.meta, channel);

    // Legacy v2 channel warning (once per channel per run). Keeps the
    // call working so the v2 renderer stays bootable; the log is a
    // migration signal for R3 cleanup.
    if (LEGACY_V2_CHANNELS.has(channel)) {
      warnOnceLegacy(channel);
    }

    // Critical channels: always validate payload (dev + production)
    validateCriticalPayload(channel, envelope.data);

    // v3 channels: validate payload in development only — production
    // trusts the TS types at the renderer boundary and skips the zod
    // cost. Errors throw and get translated into VALIDATION_ERROR by
    // the catch below.
    if (isDev && channel in v3ChannelSchemas) {
      const schema = v3ChannelSchemas[channel as keyof typeof v3ChannelSchemas];
      schema.parse(envelope.data);
    }

    try {
      return await handler(envelope.data);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const code: IpcErrorCode = classifyError(err);
      console.error(`[IPC] Error in "${channel}":`, message);
      // Throw a structured error so Electron serializes it with useful info
      const structured = new Error(`[${code}] ${message}`);
      structured.name = 'IpcError';
      throw structured;
    }
  });
}

/**
 * Register all IPC handlers defined in IpcChannelMap.
 *
 * Must be called exactly once, before any BrowserWindow is created.
 * Calling it more than once logs a warning and returns early.
 */
export function registerIpcHandlers(): void {
  if (registered) {
    console.warn('[IPC] Handlers already registered, skipping duplicate call.');
    return;
  }
  registered = true;
  registeredChannels.length = 0;

  const isDev = process.env.NODE_ENV === 'development' ||
    !!process.env.ELECTRON_RENDERER_URL;

  // ── App ────────────────────────────────────────────────────────────
  handle('app:ping', isDev, () => handlePing());
  handle('app:get-info', isDev, () => handleGetInfo());

  // ── Provider CRUD ──────────────────────────────────────────────────
  handle('provider:list', isDev, () => handleProviderList());
  handle('provider:add', isDev, (data) => handleProviderAdd(data));
  handle('provider:remove', isDev, (data) => handleProviderRemove(data));
  handle('provider:validate', isDev, (data) => handleProviderValidate(data));
  handle('provider:detect-cli', isDev, () => handleProviderDetectCli());
  handle('provider:list-models', isDev, (data) => handleProviderListModels(data));
  handle('provider:list-embedding-models', isDev, (data) => handleProviderListEmbeddingModels(data));

  // ── Chat ───────────────────────────────────────────────────────────
  handle('chat:send', isDev, (data) => handleChatSend(data));
  handle('chat:pause', isDev, () => handleChatPause());
  handle('chat:resume', isDev, () => handleChatResume());
  handle('chat:stop', isDev, () => handleChatStop());
  handle('chat:set-rounds', isDev, (data) => handleChatSetRounds(data));
  handle('chat:deep-debate', isDev, (data) => handleChatDeepDebate(data));
  handle('chat:continue', isDev, () => handleChatContinue());
  handle('chat:fork', isDev, (data) => handleChatFork(data));
  handle('chat:list-branches', isDev, () => handleChatListBranches());
  handle('chat:switch-branch', isDev, (data) => handleChatSwitchBranch(data));

  // -- Session (SSM user events) -------------------------------------------
  handle('session:mode-transition-respond', isDev, (data) => handleSessionModeTransitionRespond(data));
  handle('session:select-worker', isDev, (data) => handleSessionSelectWorker(data));
  handle('session:user-decision', isDev, (data) => handleSessionUserDecision(data));
  handle('session:status', isDev, () => handleSessionStatus());
  // ── Consensus ──────────────────────────────────────────────────────
  handle('consensus:respond', isDev, (data) => handleConsensusRespond(data));
  handle('consensus:status', isDev, () => handleConsensusStatus());
  handle('consensus:set-facilitator', isDev, (data) => handleConsensusSetFacilitator(data));

  // ── Execution ──────────────────────────────────────────────────────
  handle('execution:preview', isDev, (data) => handleExecutionPreview(data));
  handle('execution:list-pending', isDev, () => handleExecutionListPending());
  handle('execution:approve', isDev, (data) => handleExecutionApprove(data));
  handle('execution:reject', isDev, (data) => handleExecutionReject(data));

  // ── CLI Native Permission Requests ────────────────────────────────────
  handle('cli-permission:respond', isDev, (data) => handleCliPermissionRespond(data));

  // ── Runtime Permission Requests ───────────────────────────────────────
  handle('permission:list-pending', isDev, () => handlePermissionListPending());
  handle('permission:approve', isDev, (data) => handlePermissionApprove(data));
  handle('permission:reject', isDev, (data) => handlePermissionReject(data));
  handle('permission:list-rules', isDev, (data) => handlePermissionListRules(data));

  // ── Workspace / Files ──────────────────────────────────────────────
  handle('workspace:pick-folder', isDev, () => handleWorkspacePickFolder());
  handle('workspace:init', isDev, (data) => handleWorkspaceInit(data));
  handle('workspace:status', isDev, () => handleWorkspaceStatus());

  // ── Consensus Folder ──────────────────────────────────────────────
  handle('consensus-folder:status', isDev, () => handleConsensusFolderStatus());
  handle('consensus-folder:pick', isDev, () => handleConsensusFolderPick());
  handle('consensus-folder:init', isDev, (data) => handleConsensusFolderInit(data));

  // ── Memory ─────────────────────────────────────────────────────────
  handle('memory:pin', isDev, (data) => handleMemoryPin(data));
  handle('memory:search', isDev, (data) => handleMemorySearch(data));
  handle('memory:reindex', isDev, () => handleMemoryReindex());
  handle('memory:get-node', isDev, (data) => handleMemoryGetNode(data));
  handle('memory:delete-node', isDev, (data) => handleMemoryDeleteNode(data));
  handle('memory:get-pinned', isDev, (data) => handleMemoryGetPinned(data));
  handle('memory:extract-preview', isDev, (data) => handleMemoryExtractPreview(data));
  handle('memory:get-context', isDev, (data) => handleMemoryGetContext(data));
  handle('memory:extract-and-store', isDev, (data) => handleMemoryExtractAndStore(data));

  // ── Audit Log ──────────────────────────────────────────────────────
  handle('audit:list', isDev, (data) => handleAuditList(data));
  handle('audit:clear', isDev, () => handleAuditClear());

  // ── Structured Log ────────────────────────────────────────────────
  handle('log:list', isDev, (data) => handleLogList(data));
  handle('log:export', isDev, (data) => handleLogExport(data));

  // ── Config ─────────────────────────────────────────────────────────
  handle('config:get-settings', isDev, () => handleConfigGetSettings());
  handle('config:update-settings', isDev, (data) => handleConfigUpdateSettings(data));
  handle('config:set-secret', isDev, (data) => handleConfigSetSecret(data));
  handle('config:delete-secret', isDev, (data) => handleConfigDeleteSecret(data));
  handle('config:list-secret-keys', isDev, () => handleConfigListSecretKeys());

  // ── Recovery ───────────────────────────────────────────────────────
  handle('recovery:list', isDev, () => handleRecoveryList());
  handle('recovery:restore', isDev, (data) => handleRecoveryRestore(data));
  handle('recovery:discard', isDev, (data) => handleRecoveryDiscard(data));

  // ── Conversation History ───────────────────────────────────────────
  handle('conversation:list', isDev, (data) => handleConversationList(data));
  handle('conversation:load', isDev, (data) => handleConversationLoad(data));
  handle('conversation:new', isDev, () => handleConversationNew());
  handle('conversation:delete', isDev, (data) => handleConversationDelete(data));

  // ── Remote Access ──────────────────────────────────────────────────
  handle('remote:get-policy', isDev, () => handleRemoteGetPolicy());
  handle('remote:set-policy', isDev, (data) => handleRemoteSetPolicy(data));
  handle('remote:get-sessions', isDev, () => handleRemoteGetSessions());
  handle('remote:tailscale-status', isDev, () => handleRemoteTailscaleStatus());
  handle('remote:generate-token', isDev, (data) => handleRemoteGenerateToken(data));
  handle('remote:list-grants', isDev, () => handleRemoteListGrants());
  handle('remote:revoke-token', isDev, (data) => handleRemoteRevokeToken(data));
  handle('remote:start-server', isDev, () => handleRemoteStartServer());
  handle('remote:stop-server', isDev, () => handleRemoteStopServer());
  handle('remote:server-status', isDev, () => handleRemoteServerStatus());

  // ── Database Management ─────────────────────────────────────────
  handle('db:export', isDev, () => handleDbExport());
  handle('db:import', isDev, () => handleDbImport());
  handle('db:stats', isDev, () => handleDbStats());

  // ── v3: Arena Root ──────────────────────────────────────────────
  handle('arena-root:get', isDev, () => handleArenaRootGet());
  handle('arena-root:set', isDev, (data) => handleArenaRootSet(data));
  handle('arena-root:status', isDev, () => handleArenaRootStatus());

  // ── v3: Project ─────────────────────────────────────────────────
  handle('project:list', isDev, (data) => handleProjectList(data));
  handle('project:create', isDev, (data) => handleProjectCreate(data));
  handle('project:link-external', isDev, (data) => handleProjectLinkExternal(data));
  handle('project:import', isDev, (data) => handleProjectImport(data));
  handle('project:update', isDev, (data) => handleProjectUpdate(data));
  handle('project:archive', isDev, (data) => handleProjectArchive(data));
  handle('project:open', isDev, (data) => handleProjectOpen(data));
  handle('project:set-autonomy', isDev, (data) => handleProjectSetAutonomy(data));

  // ── v3: Channel ─────────────────────────────────────────────────
  handle('channel:list', isDev, (data) => handleChannelList(data));
  handle('channel:create', isDev, (data) => handleChannelCreate(data));
  handle('channel:rename', isDev, (data) => handleChannelRename(data));
  handle('channel:delete', isDev, (data) => handleChannelDelete(data));
  handle('channel:add-members', isDev, (data) => handleChannelAddMembers(data));
  handle('channel:remove-members', isDev, (data) => handleChannelRemoveMembers(data));
  handle('channel:start-meeting', isDev, (data) => handleChannelStartMeeting(data));

  // ── v3: Message ─────────────────────────────────────────────────
  handle('message:append', isDev, (data) => handleMessageAppend(data));
  handle('message:list-by-channel', isDev, (data) => handleMessageListByChannel(data));
  handle('message:search', isDev, (data) => handleMessageSearch(data));

  // ── v3: Meeting ─────────────────────────────────────────────────
  handle('meeting:abort', isDev, (data) => handleMeetingAbort(data));

  // ── v3: Member Profile ──────────────────────────────────────────
  handle('member:list', isDev, () => handleMemberList());
  handle('member:get-profile', isDev, (data) => handleMemberGetProfile(data));
  handle('member:update-profile', isDev, (data) => handleMemberUpdateProfile(data));
  handle('member:set-status', isDev, (data) => handleMemberSetStatus(data));
  handle('member:reconnect', isDev, (data) => handleMemberReconnect(data));
  handle('member:list-avatars', isDev, () => handleMemberListAvatars());

  // ── v3: Approval Inbox ──────────────────────────────────────────
  handle('approval:list', isDev, (data) => handleApprovalList(data));
  handle('approval:decide', isDev, (data) => handleApprovalDecide(data));

  // ── v3: Notification ────────────────────────────────────────────
  handle('notification:get-prefs', isDev, () => handleNotificationGetPrefs());
  handle('notification:update-prefs', isDev, (data) => handleNotificationUpdatePrefs(data));
  handle('notification:test', isDev, (data) => handleNotificationTest(data));

  // ── v3: Dashboard (R4) ──────────────────────────────────────────
  handle('dashboard:get-kpis', isDev, (data) => handleDashboardGetKpis(data));

  // ── v3: Queue ───────────────────────────────────────────────────
  handle('queue:list', isDev, (data) => handleQueueList(data));
  handle('queue:add', isDev, (data) => handleQueueAdd(data));
  handle('queue:reorder', isDev, (data) => handleQueueReorder(data));
  handle('queue:remove', isDev, (data) => handleQueueRemove(data));
  handle('queue:cancel', isDev, (data) => handleQueueCancel(data));
  handle('queue:pause', isDev, (data) => handleQueuePause(data));
  handle('queue:resume', isDev, (data) => handleQueueResume(data));
}

/**
 * Remove all registered IPC handlers.
 * Useful for testing to reset state between test runs.
 */
export function unregisterIpcHandlers(): void {
  if (!registered) return;
  for (const channel of registeredChannels) {
    ipcMain.removeHandler(channel);
  }
  registeredChannels.length = 0;
  registered = false;
}
