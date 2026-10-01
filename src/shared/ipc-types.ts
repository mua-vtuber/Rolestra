/** Typed IPC contract for the live chat runtime. */
import type {
  ApiKeyCleanup, ApiProviderConfig, CliProviderConfig, ProviderInfo, InactiveCliProviderInfo,
  ModelListFailureReason, ModelListType,
} from './provider-types';
import type { SettingsConfig, SettingsCorruptionInfo } from './config-types';
import type { Channel } from './channel-types';
import type { ChannelSummary } from './channel-summary-types';
import type { LocalAiDetection } from './local-ai-types';
import type { ChatRoom, ChatRoomMember, CreateChatRoomInput } from './chat-room-types';
import type { Message } from './message-types';
import type { ChatVote } from './chat-vote-types';
import type {
  AvatarUploadRequest, AvatarUploadResponse, MemberProfile, MemberView, WorkStatus,
} from './member-profile-types';
import type { NotificationPrefs, ChatNotificationKind } from './notification-types';
import type { MessageSearchResponse } from './message-search-types';
import type {
  ListGeneralCardsResult, PostFromGeneralChannelInput,
  PostFromGeneralChannelResult, ToggleLightVoteResult,
} from './opinion-types';
import type { DmIpcChannelMap } from './ipc/domains/dm-types';

export interface IpcMeta {
  requestId: string;
  conversationId?: string;
  sequence?: number;
  schemaVersion: number;
  timestamp: number;
}

export interface DetectedCli {
  command: string;
  displayName: string;
  version?: string;
  path: string;
  wslDistro?: string;
}

export interface MessageAppendInput {
  channelId: string;
  content: string;
  mentions?: string[];
}

/**
 * The settings the renderer may change: the language only. The Ollama
 * address main detects with is never renderer-writable (QA Minor 1) — it
 * comes from the settings file or `OLLAMA_HOST`.
 */
export type ChatSettingsPatch = Partial<Pick<SettingsConfig, 'language'>>;

export interface MessageSearchInput {
  query: string;
  /**
   * `channel`: one conversation (the in-room search). `chats`: every
   * conversation the user sees — general, rooms (archived too), DMs — for
   * the chat list's search field (spec 2026-10-01-messenger-redesign.md R2-2).
   */
  scope: { kind: 'channel'; channelId: string } | { kind: 'chats' };
  limit?: number;
}

export type NotificationPrefsPatch = Partial<{
  [K in ChatNotificationKind]: Partial<{ enabled: boolean; soundEnabled: boolean }>;
}>;

export type IpcChannelMap = {
  'app:ping': {
    request: undefined;
    response: { pong: true; timestamp: number };
  };
  'app:get-info': {
    request: undefined;
    response: { name: string; version: string };
  };
  'arena-root:get': {
    request: undefined;
    response: { path: string };
  };
  /**
   * Opens the ArenaRoot (conversation-log folder) in the OS file manager.
   * No path in the request — main opens only the folder it resolved
   * (spec 2026-10-01-messenger-redesign.md R5-3).
   */
  'arena-root:open-folder': {
    request: undefined;
    response: { success: true };
  };
  'provider:list': {
    request: undefined;
    response: { providers: ProviderInfo[] };
  };
  'provider:add': {
    // F3 (QA defect 1, spec 2026-09-29-ai-setup-and-character.md): `persona`
    // was removed — the character sheet (MemberProfile.characterSheet,
    // migration 034) is the ONLY editable persona surface now. A new
    // provider's `providers.persona` column stays empty (the column
    // itself is kept for history; `provider:add` just never populates it).
    /** CLI or API only — a local AI is added through `provider:add-local`. */
    request: { displayName: string; config: ApiProviderConfig | CliProviderConfig };
    response: { provider: ProviderInfo };
  };
  'provider:remove': {
    request: { id: string };
    /** `apiKeyCleanup` is null for an AI without an API key (CLI / local). */
    response: { success: true; apiKeyCleanup: ApiKeyCleanup | null };
  };
  /**
   * Points an API AI at a key stored under `apiKeyRef` (via
   * `config:set-secret`) and releases the previous key unless another AI
   * shares it. Only refs cross IPC, never key text.
   */
  'provider:replace-api-key': {
    request: { id: string; apiKeyRef: string };
    response: { provider: ProviderInfo; previousKeyCleanup: ApiKeyCleanup };
  };
  'provider:validate': {
    request: { id: string };
    response: { valid: boolean; message?: string };
  };
  'provider:detect-cli': {
    request: undefined;
    response: { detected: DetectedCli[] };
  };
  /**
   * Local Ollama status for the AI add dialog (spec 2026-10-01 R6-3). Main
   * resolves the address (settings → OLLAMA_HOST → default); the request
   * carries none. Failures are statuses with causes, never an empty list.
   */
  'provider:detect-local': {
    request: undefined;
    response: { detection: LocalAiDetection };
  };
  /**
   * Adds an installed Ollama model as a local AI at the address main
   * resolves and re-checks; only this channel marks the AI as confirmed
   * Ollama (`LocalProviderConfig.confirmedServer`).
   */
  'provider:add-local': {
    request: { displayName: string; model: string };
    response: { provider: ProviderInfo };
  };
  'provider:list-inactive-cli': {
    request: undefined;
    response: { inactive: InactiveCliProviderInfo[] };
  };
  'provider:list-models': {
    request: { type: ModelListType; key: string; apiKeyRef?: string };
    // F1-6: a live-fetch failure is a FIRST-CLASS success response (never a
    // thrown/rejected promise) so the renderer distinguishes "wrong key"
    // from "service unreachable" from "bad response body" instead of
    // falling back to an empty list — main stores only the reason CODE,
    // never a sentence (ModelListFailureReason, provider-types.ts).
    response:
      | { ok: true; models: string[] }
      | { ok: false; reason: ModelListFailureReason };
  };
  'config:update-settings': {
    request: { patch: ChatSettingsPatch };
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
  'config:take-startup-diagnostics': {
    request: undefined;
    response: { settingsCorruption: SettingsCorruptionInfo | null };
  };
  'channel:list': {
    request: { projectId: string | null };
    response: { channels: Channel[] };
  };
  'channel:get-global-general': {
    request: undefined;
    response: { channel: Channel | null };
  };
  'channel:delete': {
    request: { id: string };
    response: { success: true };
  };
  'channel:archive-conversation': {
    request: { channelId: string };
    response: { archivedPath: string; deletedCount: number };
  };
  'channel:list-members': {
    request: { channelId: string };
    response: { members: MemberView[] };
  };
  /**
   * Chat list rows (spec 2026-10-01-messenger-redesign.md R4): every
   * conversation the user sees with its last message (observer view,
   * whispers as names only, codes as codes), last activity and unread count.
   */
  'channel:list-summaries': {
    request: undefined;
    response: { summaries: ChannelSummary[] };
  };
  /** Moves a chat channel's read marker up to `messageId` (never back). */
  'channel:mark-read': {
    request: { channelId: string; messageId: string };
    response: { success: true };
  };
  'room:create': {
    request: CreateChatRoomInput;
    response: { room: ChatRoom };
  };
  'room:list': {
    request: undefined;
    response: { rooms: ChatRoom[] };
  };
  'room:archive': {
    request: { channelId: string };
    response: { room: ChatRoom };
  };
  'room:delete': {
    request: { channelId: string };
    response: { success: true };
  };
  'room:get-members': {
    request: { channelId: string };
    response: { members: ChatRoomMember[] };
  };
  'message:append': {
    request: MessageAppendInput;
    response: { message: Message };
  };
  'message:list-by-channel': {
    request: { channelId: string; limit?: number; beforeCreatedAt?: number; beforeMessageId?: string };
    response: { messages: Message[] };
  };
  'message:search': {
    request: MessageSearchInput;
    response: MessageSearchResponse;
  };
  /**
   * Pass button (spec 2026-10-01 F1): stores a code-only pass row that starts
   * one round without user text. Rooms and the general channel only; a DM,
   * an archived room or a channel with a running or waiting round is refused
   * with a named code (`chat-pass-types.ts`).
   */
  'chat:pass-turn': {
    request: { channelId: string };
    response: { message: Message };
  };
  /**
   * Channels with a round running or waiting right now (QA M1): the state
   * `stream:chat-round` last reported. A reloaded renderer starts from it.
   */
  'chat:list-active-rounds': {
    request: undefined;
    response: { channelIds: string[] };
  };
  'opinion:postFromGeneral': {
    request: PostFromGeneralChannelInput;
    response: { result: PostFromGeneralChannelResult };
  };
  'opinion:listGeneralCards': {
    request: { channelId: string };
    response: { result: ListGeneralCardsResult };
  };
  'opinion:toggleLightVote': {
    request: { opinionId: string; vote: 'agree' | 'oppose' };
    response: { result: ToggleLightVoteResult };
  };
  'opinion:startVote': {
    request: { opinionId: string };
    response: { result: ChatVote };
  };
  'opinion:getVote': {
    request: { opinionId: string };
    response: { result: ChatVote | null };
  };
  'member:list': {
    request: undefined;
    response: { members: MemberView[] };
  };
  'member:get-profile': {
    request: { providerId: string };
    response: { profile: MemberProfile };
  };
  'member:update-profile': {
    request: { providerId: string; patch: Partial<Pick<MemberProfile,
      'characterSheet' | 'avatarKind' | 'avatarData'
    >> };
    response: { profile: MemberProfile };
  };
  'member:rename': {
    request: { providerId: string; displayName: string };
    response: { provider: ProviderInfo };
  };
  'member:reconnect': {
    request: { providerId: string };
    response: { status: WorkStatus };
  };
  'member:list-avatars': {
    request: undefined;
    response: { avatars: Array<{ key: string; label: string }> };
  };
  'member:pick-avatar-file': {
    request: undefined;
    response: { sourcePath: string | null };
  };
  'member:upload-avatar': {
    request: AvatarUploadRequest;
    response: AvatarUploadResponse;
  };
  'notification:get-prefs': {
    request: undefined;
    response: { prefs: NotificationPrefs };
  };
  'notification:update-prefs': {
    request: { patch: NotificationPrefsPatch };
    response: { prefs: NotificationPrefs };
  };
  'notification:test': {
    request: { kind: ChatNotificationKind };
    response: { success: true };
  };
  'notification:set-locale': {
    request: { locale: 'ko' | 'en' };
    response: { locale: 'ko' | 'en' };
  };
} & DmIpcChannelMap;

export const LIVE_IPC_CHANNELS = [
  "app:ping",
  "app:get-info",
  "arena-root:get",
  "arena-root:open-folder",
  "provider:list",
  "provider:add",
  "provider:remove",
  "provider:replace-api-key",
  "provider:validate",
  "provider:detect-cli",
  "provider:detect-local",
  "provider:add-local",
  "provider:list-inactive-cli",
  "provider:list-models",
  "config:update-settings",
  "config:set-secret",
  "config:delete-secret",
  "config:take-startup-diagnostics",
  "channel:list",
  "channel:get-global-general",
  "channel:delete",
  "channel:archive-conversation",
  "channel:list-members",
  "channel:list-summaries",
  "channel:mark-read",
  "room:create",
  "room:list",
  "room:archive",
  "room:delete",
  "room:get-members",
  "dm:list",
  "dm:create",
  "message:append",
  "message:list-by-channel",
  "message:search",
  "chat:pass-turn",
  "chat:list-active-rounds",
  "opinion:postFromGeneral",
  "opinion:listGeneralCards",
  "opinion:toggleLightVote",
  "opinion:startVote",
  "opinion:getVote",
  "member:list",
  "member:get-profile",
  "member:update-profile",
  "member:rename",
  "member:reconnect",
  "member:list-avatars",
  "member:pick-avatar-file",
  "member:upload-avatar",
  "notification:get-prefs",
  "notification:update-prefs",
  "notification:test",
  "notification:set-locale"
] as const satisfies readonly (keyof IpcChannelMap)[];
export type IpcChannel = (typeof LIVE_IPC_CHANNELS)[number];
export type IpcRequest<C extends IpcChannel> = IpcChannelMap[C]['request'];
export type IpcResponse<C extends IpcChannel> = IpcChannelMap[C]['response'];
export const CURRENT_SCHEMA_VERSION = 1;
