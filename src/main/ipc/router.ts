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
import { validateCriticalPayload } from '../../shared/ipc-schemas';
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

    // Critical channels: always validate payload (dev + production)
    validateCriticalPayload(channel, envelope.data);

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
