import type { ArenaRootService } from '../arena/arena-root-service';
import type { AbsolutePath } from '../../shared/absolute-path';
import { warmupOrThrow } from '../members/connection-check-error';
import { ChannelRepository } from '../channels/channel-repository';
import { ChannelService } from '../channels/channel-service';
import { ChannelSummaryRepository } from '../channels/channel-summary-repository';
import { ChatRoomRepository } from '../channels/chat-room-repository';
import { ChatRoomService } from '../channels/chat-room-service';
import { DmChannelService } from '../channels/dm-channel-service';
import { MessageRepository } from '../channels/message-repository';
import { MessageService } from '../channels/message-service';
import { getDatabase } from '../database/connection';
import { AvatarStore } from '../members/avatar-store';
import { MemberProfileRepository } from '../members/member-profile-repository';
import { MemberProfileService } from '../members/member-profile-service';
import { MemberWarmupService } from '../members/member-warmup-service';
import { OpinionRepository } from '../meetings/opinion-repository';
import { OpinionService } from '../meetings/opinion-service';
import { ChatVoteRepository } from '../meetings/chat-vote-repository';
import { ChatVoteService } from '../meetings/chat-vote-service';
import { ElectronNotifierAdapter } from '../notifications/electron-notifier-adapter';
import { NotificationRepository } from '../notifications/notification-repository';
import { NotificationService } from '../notifications/notification-service';
import { providerRegistry } from '../providers/registry';
import { createProvider } from '../providers/factory';
import { getConfigService } from '../config/instance';
import { buildChatPersona } from '../members/persona-builder';

export interface ChatServices {
  arenaRoot: ArenaRootService;
  /** Persona files for chat/vote CLI calls (`files/chat-cli-instructions.ts`). */
  chatCliInstructionsDir: AbsolutePath;
  channelService: ChannelService;
  /** Chat list rows and read markers (spec 2026-10-01 R4). */
  channelSummaryRepository: ChannelSummaryRepository;
  chatRoomService: ChatRoomService;
  dmChannelService: DmChannelService;
  messageService: MessageService;
  opinionService: OpinionService;
  opinionRepository: OpinionRepository;
  chatVoteService: ChatVoteService;
  memberProfileService: MemberProfileService;
  avatarStore: AvatarStore;
  notificationService: NotificationService;
}

/** Active Main composition. */
export function createChatServices(arenaRoot: ArenaRootService, chatCliInstructionsDir: AbsolutePath): ChatServices {
  const db = getDatabase();
  const messageRepository = new MessageRepository(db);
  const channelRepository = new ChannelRepository(db);
  const channelService = new ChannelService(
    channelRepository,
    {
      archiveMessages: messageRepository,
      archiveRoot: { getArenaRoot: () => arenaRoot.getPath() },
    },
  );
  channelService.ensureGlobalGeneralChannel();

  const memberProfileService = new MemberProfileService(
    new MemberProfileRepository(db),
    {
      get: (providerId) => {
        const provider = providerRegistry.get(providerId);
        return provider
          ? { id: provider.id, displayName: provider.displayName }
          : null;
      },
      // A failed check rejects with its cause (QA Medium-1), so the member
      // status turns offline-connection and keeps why.
      warmup: (providerId) => warmupOrThrow(providerRegistry.getOrThrow(providerId)),
      getRoles: (providerId) => providerRegistry.get(providerId)?.toInfo().roles ?? null,
      getSkillOverrides: (providerId) =>
        providerRegistry.get(providerId)?.toInfo().skill_overrides ?? null,
    },
  );
  const chatRoomService = new ChatRoomService(
    new ChatRoomRepository(db, channelRepository),
    channelRepository,
    providerRegistry,
    memberProfileService,
  );
  const messageService = new MessageService(messageRepository, {
    assertAppendAllowed: (channelId) => {
      channelService.assertAppendAllowed(channelId);
      chatRoomService.assertAppendAllowed(channelId);
    },
  });
  void new MemberWarmupService(memberProfileService)
    .warmAll(providerRegistry.listAll().map((provider) => provider.id))
    .catch((err: unknown) => {
      console.warn(
        '[member-warmup] boot batch threw',
        err instanceof Error ? err.message : String(err),
      );
    });

  const notificationService = new NotificationService(
    new NotificationRepository(db),
    new ElectronNotifierAdapter(),
  );
  notificationService.seedDefaultPrefsIfEmpty();
  const opinionRepository = new OpinionRepository(db);
  const assertChatCardChannel = (channelId: string, write: boolean): void => {
    const channel = channelService.get(channelId);
    const room = chatRoomService.get(channelId);
    if (!channel || !(channel.kind === 'system_general' && channel.projectId === null ||
      channel.kind === 'user' && channel.projectId === null && room)) {
      throw new Error(`Chat opinion channel not found: ${channelId}`);
    }
    if (write && (channel.readOnly || room?.archivedAt != null ||
      channelService.isConversationArchiving(channelId))) {
      throw new Error(`Chat room archived: ${channelId}`);
    }
  };
  const chatVoteService = new ChatVoteService(
    new ChatVoteRepository(db), opinionRepository, chatRoomService, messageService,
    providerRegistry,
    // F3 (QA defect 1): no `persona` passed — this clone is only ever used
    // for a single vote-turn streamCompletion call, whose actual persona
    // text is the `persona` PARAMETER the caller passes to streamCompletion
    // (see chat-vote-service.ts's `part.persona`, sourced from the
    // characterSheet-based `globalPersona` callback below) — no provider
    // implementation reads its own `this.persona` inside streamCompletion.
    (provider) => createProvider({
      id: provider.id, displayName: provider.displayName,
      config: provider.config, roles: provider.roles,
      skill_overrides: provider.skill_overrides,
      isDepartmentHead: provider.isDepartmentHead,
      resolveApiKey: async (ref) => {
        const secret = getConfigService().getSecret(ref);
        if (!secret) throw new Error(`API key not found: ${ref}`);
        return secret;
      },
    }),
    () => arenaRoot.consensusPath(),
    chatCliInstructionsDir,
    (channelId) => {
      const channel = channelService.get(channelId);
      return channel?.kind === 'system_general' && channel.projectId === null && !channel.readOnly &&
        !channelService.isConversationArchiving(channelId);
    },
    (provider) => {
      const profile = memberProfileService.getProfile(provider.id);
      return buildChatPersona({
        displayName: provider.displayName,
        characterSheet: profile.characterSheet,
      });
    },
    undefined,
    {
      append: (input) => messageService.append(input),
      assertWritable: (channelId) => assertChatCardChannel(channelId, true),
    },
  );
  chatRoomService.on('closed', ({ channelId }: { channelId: string }) => chatVoteService.interruptChannel(channelId));

  return {
    arenaRoot,
    chatCliInstructionsDir,
    channelService,
    channelSummaryRepository: new ChannelSummaryRepository(db),
    chatRoomService,
    dmChannelService: new DmChannelService(channelService),
    messageService,
    opinionService: new OpinionService(opinionRepository, assertChatCardChannel),
    opinionRepository,
    chatVoteService,
    memberProfileService,
    avatarStore: new AvatarStore(arenaRoot),
    notificationService,
  };
}
