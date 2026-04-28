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
  handleExecutionPreview,
  handleExecutionListPending,
  handleExecutionApprove,
  handleExecutionReject,
  handleExecutionDryRunPreview,
} from './handlers/execution-handler';
import { handlePermissionDryRunFlags } from './handlers/permission-handler';
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
  handleConfigTakeStartupDiagnostics,
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
  handleProjectPickFolder,
  handleProjectList,
  handleProjectCreate,
  handleProjectLinkExternal,
  handleProjectImport,
  handleProjectUpdate,
  handleProjectArchive,
  handleProjectOpen,
  handleProjectSetAutonomy,
  handleProjectRequestPermissionModeChange,
} from './handlers/project-handler';
import {
  handleChannelList,
  handleChannelCreate,
  handleChannelRename,
  handleChannelDelete,
  handleChannelAddMembers,
  handleChannelRemoveMembers,
  handleChannelStartMeeting,
  handleDmList,
  handleDmCreate,
} from './handlers/channel-handler';
import {
  handleMessageAppend,
  handleMessageListByChannel,
  handleMessageListRecent,
  handleMessageSearch,
} from './handlers/message-handler';
import {
  handleMeetingAbort,
  handleMeetingListActive,
  handleMeetingVotingHistory,
} from './handlers/meeting-handler';
import {
  handleMemberList,
  handleMemberGetProfile,
  handleMemberUpdateProfile,
  handleMemberSetStatus,
  handleMemberReconnect,
  handleMemberListAvatars,
  handleMemberPickAvatarFile,
  handleMemberUploadAvatar,
} from './handlers/member-handler';
import {
  handleApprovalList,
  handleApprovalDecide,
  handleApprovalDetailFetch,
  handleApprovalCount,
} from './handlers/approval-handler';
import {
  handleNotificationGetPrefs,
  handleNotificationUpdatePrefs,
  handleNotificationTest,
  handleNotificationSetLocale,
} from './handlers/notification-handler';
import { handleDevTripCircuitBreaker } from './handlers/dev-hooks-handler';
import {
  handleOnboardingGetState,
  handleOnboardingSetState,
  handleOnboardingComplete,
  handleOnboardingApplyStaffSelection,
  handleProviderDetect,
} from './handlers/onboarding-handler';
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
import { handleLlmCostSummary } from './handlers/llm-handler';

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
 * Reset the channel registry to empty without re-allocating the array.
 * Single-source helper so both `registerIpcHandlers` (defensive
 * pre-fill clear) and `unregisterIpcHandlers` (post-removal flush)
 * speak through the same surface — mutating `length = 0` directly in
 * two places drifts more easily than calling a named helper.
 */
function clearChannelRegistry(): void {
  clearChannelRegistry();
}

/**
 * Register a typed IPC handler with validation.
 *
 * - Critical channel payloads are always validated (dev + production).
 * - Meta is always validated (dev + production) for security hardening.
 *
 * R11-Task2 retired the v2 channel warning helper that used to wrap
 * every invocation: the 27-entry `LEGACY_V2_CHANNELS` set + the four
 * runtime `permission:list-pending|approve|reject|list-rules` handlers
 * are gone, along with their typedefs and IPC registrations. The
 * appendix `appendix-legacy-channels.md` and the renderer-side
 * `legacy-channel-isolation.test.ts` guard were removed in the same
 * commit because there is no longer a v2 surface to guard against.
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
  clearChannelRegistry();

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

  // ── Execution ──────────────────────────────────────────────────────
  handle('execution:preview', isDev, (data) => handleExecutionPreview(data));
  handle('execution:list-pending', isDev, () => handleExecutionListPending());
  handle('execution:approve', isDev, (data) => handleExecutionApprove(data));
  handle('execution:reject', isDev, (data) => handleExecutionReject(data));
  // R11-Task7: read-only approval projection — never mutates the FS.
  handle('execution:dry-run-preview', isDev, (data) =>
    handleExecutionDryRunPreview(data),
  );

  // ── CLI Native Permission Requests ────────────────────────────────────
  // R7-Task4 removed — ApprovalService now owns the full CLI permission
  // lifecycle (approval:list + approval:decide already registered below).

  // ── Runtime Permission Requests ───────────────────────────────────────
  // R11-Task2 retired the v2 list-pending/approve/reject/list-rules
  // surface. Only the R10-Task5 dry-run preview remains.
  handle('permission:dry-run-flags', isDev, (data) => handlePermissionDryRunFlags(data));

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
  handle('config:take-startup-diagnostics', isDev, () => handleConfigTakeStartupDiagnostics());

  // ── Recovery ───────────────────────────────────────────────────────
  handle('recovery:list', isDev, () => handleRecoveryList());
  handle('recovery:restore', isDev, (data) => handleRecoveryRestore(data));
  handle('recovery:discard', isDev, (data) => handleRecoveryDiscard(data));

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
  handle('project:pick-folder', isDev, () => handleProjectPickFolder());
  handle('project:list', isDev, (data) => handleProjectList(data));
  handle('project:create', isDev, (data) => handleProjectCreate(data));
  handle('project:link-external', isDev, (data) => handleProjectLinkExternal(data));
  handle('project:import', isDev, (data) => handleProjectImport(data));
  handle('project:update', isDev, (data) => handleProjectUpdate(data));
  handle('project:archive', isDev, (data) => handleProjectArchive(data));
  handle('project:open', isDev, (data) => handleProjectOpen(data));
  handle('project:set-autonomy', isDev, (data) => handleProjectSetAutonomy(data));
  handle(
    'project:request-permission-mode-change',
    isDev,
    (data) => handleProjectRequestPermissionModeChange(data),
  );

  // ── v3: Channel ─────────────────────────────────────────────────
  handle('channel:list', isDev, (data) => handleChannelList(data));
  handle('channel:create', isDev, (data) => handleChannelCreate(data));
  handle('channel:rename', isDev, (data) => handleChannelRename(data));
  handle('channel:delete', isDev, (data) => handleChannelDelete(data));
  handle('channel:add-members', isDev, (data) => handleChannelAddMembers(data));
  handle('channel:remove-members', isDev, (data) => handleChannelRemoveMembers(data));
  handle('channel:start-meeting', isDev, (data) => handleChannelStartMeeting(data));

  // ── R10-Task3: DM (사용자↔AI 1:1) ───────────────────────────────
  handle('dm:list', isDev, () => handleDmList());
  handle('dm:create', isDev, (data) => handleDmCreate(data));

  // ── v3: Message ─────────────────────────────────────────────────
  handle('message:append', isDev, (data) => handleMessageAppend(data));
  handle('message:list-by-channel', isDev, (data) => handleMessageListByChannel(data));
  handle('message:list-recent', isDev, (data) => handleMessageListRecent(data));
  handle('message:search', isDev, (data) => handleMessageSearch(data));

  // ── v3: Meeting ─────────────────────────────────────────────────
  handle('meeting:abort', isDev, (data) => handleMeetingAbort(data));
  handle('meeting:list-active', isDev, (data) => handleMeetingListActive(data));
  // R11-Task7: voting context for the Approval detail panel — read-only
  // projection of meeting.state_snapshot_json. Empty context on miss so
  // the panel can still render headers.
  handle('meeting:voting-history', isDev, (data) =>
    handleMeetingVotingHistory(data),
  );

  // ── v3: Member Profile ──────────────────────────────────────────
  handle('member:list', isDev, () => handleMemberList());
  handle('member:get-profile', isDev, (data) => handleMemberGetProfile(data));
  handle('member:update-profile', isDev, (data) => handleMemberUpdateProfile(data));
  handle('member:set-status', isDev, (data) => handleMemberSetStatus(data));
  handle('member:reconnect', isDev, (data) => handleMemberReconnect(data));
  handle('member:list-avatars', isDev, () => handleMemberListAvatars());
  handle('member:pick-avatar-file', isDev, () => handleMemberPickAvatarFile());
  handle('member:upload-avatar', isDev, (data) => handleMemberUploadAvatar(data));

  // ── v3: Approval Inbox ──────────────────────────────────────────
  handle('approval:list', isDev, (data) => handleApprovalList(data));
  handle('approval:decide', isDev, (data) => handleApprovalDecide(data));
  // R11-Task7: detail panel — composes approval row + dryRunPreview +
  // voting context into one round-trip.
  handle('approval:detail-fetch', isDev, (data) =>
    handleApprovalDetailFetch(data),
  );
  // F6-T1: tab-badge counts (pending/approved/rejected + all). Replaces
  // the R11-Task7 placeholder that only knew the active filter's count.
  handle('approval:count', isDev, (data) => handleApprovalCount(data));

  // ── v3: Notification ────────────────────────────────────────────
  handle('notification:get-prefs', isDev, () => handleNotificationGetPrefs());
  handle('notification:update-prefs', isDev, (data) => handleNotificationUpdatePrefs(data));
  handle('notification:test', isDev, (data) => handleNotificationTest(data));
  handle('notification:set-locale', isDev, (data) => handleNotificationSetLocale(data));

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

  // ── R11-Task6: Onboarding wizard + provider auto-detection ──────
  handle('onboarding:get-state', isDev, () => handleOnboardingGetState());
  handle('onboarding:set-state', isDev, (data) => handleOnboardingSetState(data));
  handle('onboarding:complete', isDev, () => handleOnboardingComplete());
  handle('onboarding:apply-staff-selection', isDev, (data) =>
    handleOnboardingApplyStaffSelection(data),
  );
  handle('provider:detect', isDev, () => handleProviderDetect());

  // ── R11-Task8: LLM 누적 비용 요약 (Settings 카드) ────────────────
  handle('llm:cost-summary', isDev, (data) => handleLlmCostSummary(data));

  // ── R11-Task4: dev hooks (E2E only) ─────────────────────────────
  // Gated on ROLESTRA_E2E=1 so production builds never expose the trip
  // surface. Renderer side is gated by the same env in `src/preload/
  // index.ts`, so the channel is unreachable from a production renderer
  // even if a malicious actor poked at the typed IPC bridge directly.
  if (process.env.ROLESTRA_E2E === '1') {
    handle('dev:trip-circuit-breaker', isDev, (data) =>
      handleDevTripCircuitBreaker(data),
    );
    console.info('[rolestra] dev hooks IPC registered (ROLESTRA_E2E=1)');
  }
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
  clearChannelRegistry();
  registered = false;
}
