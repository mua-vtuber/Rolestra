import { BrowserWindow } from 'electron';
import { CHAT_ACTIVITY_EVENT, CHAT_ROUND_EVENT, DmAutoResponder } from '../channels/dm-auto-responder';
import { ChatSessionCoordinator } from '../channels/chat-session-coordinator';
import { ChatSessionRepository } from '../channels/chat-session-repository';
import { ChatWhisperRoundRepository } from '../channels/chat-whisper-round-repository';
import type { DmClosedEvent } from '../channels/dm-channel-service';
import { getDatabase } from '../database/connection';
import { GeneralChannelOpinionFlow } from '../channels/general-channel-opinion-flow';
import { tryGetLogger } from '../log/logger-accessor';
import { providerRegistry } from '../providers/registry';
import { StreamBridge } from '../streams/stream-bridge';
import type { ChatServices } from './chat-services';

/** Subscribe only free chat channels. Archived project messages cannot start work. */
export function wireChatMessageFlows(services: ChatServices): DmAutoResponder {
  const chatRoomService = services.chatRoomService;
  const roundRepository = new ChatWhisperRoundRepository(getDatabase());
  roundRepository.interruptRunning();
  const responder = new DmAutoResponder({
    channelService: services.channelService,
    messageService: services.messageService,
    providerLookup: providerRegistry,
    memberProfileLookup: services.memberProfileService,
    // Chat CLIs run in the fixed `<ArenaRoot>/consensus` folder, never in the
    // ArenaRoot itself (db/, logs/ and avatars/ stay out of their cwd).
    consensusPath: () => services.arenaRoot.consensusPath(),
    roomService: chatRoomService,
    roundRepository,
    cliSessionCoordinator: chatRoomService
      ? new ChatSessionCoordinator(new ChatSessionRepository(getDatabase()), services.chatCliInstructionsDir)
      : undefined,
  });
  chatRoomService?.on('closed', ({ channelId }: { channelId: string }) => responder.closeRoom(channelId));
  // A deleted DM takes the same close path as an archived or deleted room.
  services.dmChannelService.on('closed', ({ channelId }: DmClosedEvent) => responder.closeRoom(channelId));
  services.channelService.setConversationArchiveLifecycle({
    pause: (channelId) => {
      // Both guards take effect before archiveConversation's first await.
      services.chatVoteService.interruptChannel(channelId);
      return responder.pauseRoom(channelId);
    },
    resume: (channelId) => responder.resumeRoom(channelId),
  });
  const opinionFlow = new GeneralChannelOpinionFlow({
    channelService: services.channelService,
    opinionService: services.opinionService,
    messageService: services.messageService,
    roomService: chatRoomService,
  });

  // D2 (2026-09-28) — listener isolation: `MessageService` is a plain
  // node:events EventEmitter, so `emit()` calls every 'message' listener
  // in registration order and a *synchronous* throw from one listener
  // stops the rest from running (Node's EventEmitter does not isolate
  // listeners from each other; `MessageService.append()`'s own
  // try/catch around `this.emit(...)` only protects append()'s return
  // contract, not sibling listeners). This app registers this chat-flow
  // listener BEFORE the stream-bridge listener
  // (`wireChatMessageFlows` runs before `createChatStreamBridge` in
  // src/main/index.ts), so an uncaught throw here — e.g. from
  // `services.channelService.get()` or `opinionFlow.onMessage()` — would
  // silently stop the stream-bridge listener from firing and the message
  // would never reach the renderer. The wrapping try/catch below makes
  // that impossible: any synchronous failure in this listener body is
  // logged and swallowed, so the stream-bridge listener registered after
  // it always runs.
  services.messageService.on('message', (message) => {
    try {
      const channel = services.channelService.get(message.channelId);
      if (!channel) return;
      if (
        message.authorKind === 'user' &&
        message.role === 'user' &&
        (channel.kind === 'system_general' || channel.kind === 'dm' ||
          chatRoomService?.get(channel.id)?.archivedAt === null)
      ) {
        void responder.handle(message, channel).catch((err: unknown) => {
          tryGetLogger()?.error({
            component: 'chat-auto-responder',
            action: 'listener-error',
            result: 'failure',
            metadata: {
              channelId: channel.id,
              error: err instanceof Error ? err.message : String(err),
            },
          });
        });
      }
      if (channel.kind === 'system_general' || chatRoomService?.get(channel.id)?.archivedAt === null) {
        opinionFlow.onMessage(message);
      }
    } catch (err) {
      tryGetLogger()?.error({
        component: 'chat-message-flow',
        action: 'listener-error',
        result: 'failure',
        metadata: {
          messageId: message.id,
          channelId: message.channelId,
          error: err instanceof Error ? err.message : String(err),
        },
      });
    }
  });
  return responder;
}

export function createChatStreamBridge(services: ChatServices, responder: DmAutoResponder): StreamBridge {
  const bridge = new StreamBridge();
  bridge.connect({
    messages: services.messageService,
    notifications: services.notificationService,
    members: services.memberProfileService,
    chatResponder: { source: responder, activityEvent: CHAT_ACTIVITY_EVENT, roundEvent: CHAT_ROUND_EVENT },
  });
  bridge.onOutbound((event) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.webContents && !window.webContents.isDestroyed()) {
        window.webContents.send(event.type, event.payload);
      }
    }
  });
  return bridge;
}
