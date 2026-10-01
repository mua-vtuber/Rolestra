import { ipcMain } from 'electron';
import type { ChannelService } from '../channels/channel-service';
import type { ChatRoomService } from '../channels/chat-room-service';
import type { OpinionRepository } from '../meetings/opinion-repository';
import { requireChatChannel, requireChatOpinionChannel, requireDm, requireGlobalGeneral } from './chat-channel-boundary';
import type { IpcMeta, IpcChannel, IpcChannelMap } from '../../shared/ipc-types';
import { CURRENT_SCHEMA_VERSION } from '../../shared/ipc-types';
import { validateCriticalPayload, v3ChannelSchemas } from '../../shared/ipc-schemas';
import { toTransportError } from './ipc-transport-error';
import { handlePing, handleGetInfo } from './handlers/app-handler';
import { handleArenaRootGet, handleArenaRootOpenFolder } from './handlers/arena-root-handler';
import {
  handleProviderList, handleProviderAdd, handleProviderRemove, handleProviderReplaceApiKey,
  handleProviderValidate, handleProviderListModels, handleProviderListInactiveCli,
} from './handlers/provider-handler';
import { handleProviderDetectCli } from './handlers/cli-detect-handler';
import { handleProviderAddLocal, handleProviderDetectLocal } from './handlers/local-ai-handler';
import {
  handleConfigUpdateSettings,
  handleConfigSetSecret, handleConfigDeleteSecret,
  handleConfigTakeStartupDiagnostics,
} from './handlers/config-handler';
import {
  handleChannelList, handleChannelGetGlobalGeneral,
  handleChannelDelete, handleChannelArchiveConversation,
  handleChannelListMembers, handleDmList, handleDmCreate,
} from './handlers/channel-handler';
import { handleChannelListSummaries, handleChannelMarkRead } from './handlers/channel-summary-handler';
import {
  handleRoomCreate, handleRoomList, handleRoomArchive,
  handleRoomDelete, handleRoomGetMembers,
} from './handlers/room-handler';
import {
  handleMessageAppend, handleMessageListByChannel, handleMessageSearch,
} from './handlers/message-handler';
import { handleChatPassTurn } from './handlers/chat-pass-handler';
import { handleChatListActiveRounds } from './handlers/chat-round-handler';
import {
  handleOpinionPostFromGeneral, handleOpinionListGeneralCards,
  handleOpinionToggleLightVote,
  handleOpinionStartVote, handleOpinionGetVote,
} from './handlers/opinion-handler';
import {
  handleMemberList, handleMemberGetProfile, handleMemberUpdateProfile,
  handleMemberRename,
  handleMemberReconnect, handleMemberListAvatars,
  handleMemberPickAvatarFile, handleMemberUploadAvatar,
} from './handlers/member-handler';
import {
  handleNotificationGetPrefs, handleNotificationUpdatePrefs,
  handleNotificationTest, handleNotificationSetLocale,
} from './handlers/notification-handler';

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
  registeredChannels.length = 0;
}

/** Validate metadata and every registered payload before dispatch. */
function handle<C extends IpcChannel>(
  channel: C,
  handler: (data: IpcChannelMap[C]['request']) => unknown,
): void {
  registeredChannels.push(channel);

  ipcMain.handle(channel, async (_event, envelope: IpcEnvelope<C>) => {
    await validateMeta(envelope.meta);
    checkSchemaVersion(envelope.meta, channel);

    // Critical channels: always validate payload (dev + production)
    validateCriticalPayload(channel, envelope.data);

    // Live IPC payloads cross a process boundary; validate in every build.
    if (channel in v3ChannelSchemas) {
      const schema = v3ChannelSchemas[channel as keyof typeof v3ChannelSchemas];
      schema.parse(envelope.data);
    }

    try {
      return await handler(envelope.data);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[IPC] Error in "${channel}":`, message);
      // Electron passes only the message; it carries the code and any known cause.
      throw toTransportError(err);
    }
  });
}

/** Register only chat and ordinary settings IPC. */
export function registerIpcHandlers(
  channels: Pick<ChannelService, 'get'>,
  opinions: Pick<OpinionRepository, 'get'>,
  rooms?: Pick<ChatRoomService, 'get'>,
): void {
  if (registered) {
    console.warn('[IPC] Handlers already registered, skipping duplicate call.');
    return;
  }
  registered = true;
  clearChannelRegistry();

  handle('app:ping', () => handlePing());
  handle('app:get-info', () => handleGetInfo());
  handle('arena-root:get', () => handleArenaRootGet());
  handle('arena-root:open-folder', () => handleArenaRootOpenFolder());

  handle('provider:list', () => handleProviderList());
  handle('provider:add', (data) => handleProviderAdd(data));
  handle('provider:remove', (data) => handleProviderRemove(data));
  handle('provider:replace-api-key', (data) => handleProviderReplaceApiKey(data));
  handle('provider:validate', (data) => handleProviderValidate(data));
  handle('provider:detect-cli', () => handleProviderDetectCli());
  handle('provider:detect-local', () => handleProviderDetectLocal());
  handle('provider:add-local', (data) => handleProviderAddLocal(data));
  handle('provider:list-inactive-cli', () => handleProviderListInactiveCli());
  handle('provider:list-models', (data) => handleProviderListModels(data));

  handle('config:update-settings', (data) => handleConfigUpdateSettings(data));
  handle('config:set-secret', (data) => handleConfigSetSecret(data));
  handle('config:delete-secret', (data) => handleConfigDeleteSecret(data));
  handle('config:take-startup-diagnostics', () => handleConfigTakeStartupDiagnostics());

  handle('channel:list', (data) => {
    if (data.projectId !== null) throw new Error('Project channels are archived');
    return handleChannelList(data);
  });
  handle('channel:get-global-general', () => handleChannelGetGlobalGeneral());
  handle('channel:delete', (data) => {
    requireDm(channels, data.id);
    return handleChannelDelete(data);
  });
  handle('channel:archive-conversation', (data) => {
    requireGlobalGeneral(channels, data.channelId);
    return handleChannelArchiveConversation(data);
  });
  handle('channel:list-members', (data) => {
    requireChatChannel(channels, data.channelId, rooms);
    return handleChannelListMembers(data);
  });
  handle('channel:list-summaries', () => handleChannelListSummaries());
  handle('channel:mark-read', (data) => {
    requireChatChannel(channels, data.channelId, rooms);
    return handleChannelMarkRead(data);
  });
  handle('room:create', (data) => handleRoomCreate(data));
  handle('room:list', () => handleRoomList());
  handle('room:archive', (data) => handleRoomArchive(data));
  handle('room:delete', (data) => handleRoomDelete(data));
  handle('room:get-members', (data) => handleRoomGetMembers(data));
  handle('dm:list', () => handleDmList());
  handle('dm:create', (data) => handleDmCreate(data));

  handle('message:append', (data) => {
    requireChatChannel(channels, data.channelId, rooms);
    if ((data as { meetingId?: unknown }).meetingId != null) {
      throw new Error('Meeting messages are archived');
    }
    return handleMessageAppend(data);
  });
  handle('message:list-by-channel', (data) => {
    requireChatChannel(channels, data.channelId, rooms);
    return handleMessageListByChannel(data);
  });
  handle('message:search', (data) => {
    const scope = data.scope as { kind: string; channelId?: string };
    if (scope.kind === 'chats') return handleMessageSearch(data);
    if (scope.kind !== 'channel' || scope.channelId === undefined) {
      throw new Error('Project search is archived');
    }
    requireChatChannel(channels, scope.channelId, rooms);
    return handleMessageSearch(data);
  });
  handle('chat:pass-turn', (data) => {
    requireChatChannel(channels, data.channelId, rooms);
    return handleChatPassTurn(data);
  });
  handle('chat:list-active-rounds', () => handleChatListActiveRounds());

  handle('opinion:postFromGeneral', (data) => {
    requireChatOpinionChannel(channels, data.channelId, rooms, true);
    if (data.authorProviderId !== null) throw new Error('User opinion author must be null');
    return handleOpinionPostFromGeneral(data);
  });
  handle('opinion:listGeneralCards', (data) => {
    requireChatOpinionChannel(channels, data.channelId, rooms, false);
    return handleOpinionListGeneralCards(data);
  });
  handle('opinion:toggleLightVote', (data) => {
    const opinion = opinions.get(data.opinionId);
    if (!opinion || opinion.meetingId !== null) {
      throw new Error(`Chat opinion not found: ${data.opinionId}`);
    }
    requireChatOpinionChannel(channels, opinion.channelId, rooms, true);
    return handleOpinionToggleLightVote(data);
  });
  handle('opinion:startVote', (data) => {
    const opinion = opinions.get(data.opinionId);
    if (!opinion || opinion.meetingId !== null ||
      !['self-raised', 'user-raised'].includes(opinion.kind)) {
      throw new Error(`Chat opinion not found: ${data.opinionId}`);
    }
    requireChatOpinionChannel(channels, opinion.channelId, rooms, true);
    return handleOpinionStartVote(data);
  });
  handle('opinion:getVote', (data) => {
    const opinion = opinions.get(data.opinionId);
    if (!opinion || opinion.meetingId !== null ||
      !['self-raised', 'user-raised'].includes(opinion.kind)) {
      throw new Error(`Chat opinion not found: ${data.opinionId}`);
    }
    requireChatOpinionChannel(channels, opinion.channelId, rooms, false);
    return handleOpinionGetVote(data);
  });

  handle('member:list', () => handleMemberList());
  handle('member:get-profile', (data) => handleMemberGetProfile(data));
  handle('member:update-profile', (data) => handleMemberUpdateProfile(data));
  handle('member:rename', (data) => handleMemberRename(data));
  handle('member:reconnect', (data) => handleMemberReconnect(data));
  handle('member:list-avatars', () => handleMemberListAvatars());
  handle('member:pick-avatar-file', () => handleMemberPickAvatarFile());
  handle('member:upload-avatar', (data) => handleMemberUploadAvatar(data));

  handle('notification:get-prefs', () => handleNotificationGetPrefs());
  handle('notification:update-prefs', (data) => handleNotificationUpdatePrefs(data));
  handle('notification:test', (data) => handleNotificationTest(data));
  handle('notification:set-locale', (data) => handleNotificationSetLocale(data));
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
