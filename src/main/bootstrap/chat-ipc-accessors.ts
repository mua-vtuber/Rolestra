import {
  setChannelMemberServiceAccessor,
  setChannelServiceAccessor,
  setDmChannelServiceAccessor,
} from '../ipc/handlers/channel-handler';
import { setArenaRootServiceAccessor } from '../ipc/handlers/arena-root-handler';
import { setChannelSummaryRepositoryAccessor } from '../ipc/handlers/channel-summary-handler';
import { setLoggerAccessor } from '../log/logger-accessor';
import {
  setAvatarStoreAccessor,
  setMemberProfileServiceAccessor,
} from '../ipc/handlers/member-handler';
import { setMessageServiceAccessor } from '../ipc/handlers/message-handler';
import { setChatPassServiceAccessor } from '../ipc/handlers/chat-pass-handler';
import { setChatRoundStateAccessor } from '../ipc/handlers/chat-round-handler';
import { ChatPassService } from '../channels/chat-pass-service';
import type { DmAutoResponder } from '../channels/dm-auto-responder';
import { setChatRoomServiceAccessor } from '../ipc/handlers/room-handler';
import { setNotificationServiceAccessor } from '../ipc/handlers/notification-handler';
import { setOpinionServiceAccessor, setChatVoteServiceAccessor } from '../ipc/handlers/opinion-handler';
import { setStreamBridgeInstance } from '../streams/stream-bridge-accessor';
import type { StreamBridge } from '../streams/stream-bridge';
import type { createLogger } from '../log/structured-logger';
import type { ChatServices } from './chat-services';

export function wireChatAccessors(
  services: ChatServices,
  logger: ReturnType<typeof createLogger>,
  streamBridge: StreamBridge,
  responder: Pick<DmAutoResponder, 'hasActiveRound' | 'activeRoundChannelIds'>,
): void {
  const chatPassService = new ChatPassService({
    channels: services.channelService, rooms: services.chatRoomService,
    messages: services.messageService, rounds: responder,
  });
  setLoggerAccessor(() => logger);
  setArenaRootServiceAccessor(() => services.arenaRoot);
  setChannelServiceAccessor(() => services.channelService);
  setChannelSummaryRepositoryAccessor(() => services.channelSummaryRepository);
  setDmChannelServiceAccessor(() => services.dmChannelService);
  setChannelMemberServiceAccessor(() => services.memberProfileService);
  setMessageServiceAccessor(() => services.messageService);
  setChatPassServiceAccessor(() => chatPassService);
  setChatRoundStateAccessor(() => responder);
  setChatRoomServiceAccessor(() => services.chatRoomService);
  setOpinionServiceAccessor(() => services.opinionService);
  setChatVoteServiceAccessor(() => services.chatVoteService);
  setMemberProfileServiceAccessor(() => services.memberProfileService);
  setAvatarStoreAccessor(() => services.avatarStore);
  setNotificationServiceAccessor(() => services.notificationService);
  setStreamBridgeInstance(streamBridge);
}
