import type { IpcRequest, IpcResponse } from '../../../shared/ipc-types';
import type { Channel } from '../../../shared/channel-types';
import type { DmSummary } from '../../../shared/dm-types';
import type { MemberView } from '../../../shared/member-profile-types';
import type { ChannelService } from '../../channels/channel-service';
import type { DmChannelService } from '../../channels/dm-channel-service';
import type { MemberProfileService } from '../../members/member-profile-service';
import { providerRegistry } from '../../providers/registry';
import { getChatRoomServiceOrNull } from './room-handler';

let channelAccessor: (() => ChannelService) | null = null;
let dmAccessor: (() => Pick<DmChannelService, 'delete'>) | null = null;
let memberAccessor: (() => MemberProfileService) | null = null;

export function setChannelServiceAccessor(fn: () => ChannelService): void {
  channelAccessor = fn;
}

export function setDmChannelServiceAccessor(fn: () => Pick<DmChannelService, 'delete'>): void {
  dmAccessor = fn;
}

function getDmChannels(): Pick<DmChannelService, 'delete'> {
  if (!dmAccessor) throw new Error('channel handler: DM service not initialized');
  return dmAccessor();
}

export function setChannelMemberServiceAccessor(
  fn: () => MemberProfileService,
): void {
  memberAccessor = fn;
}

function getChannel(): ChannelService {
  if (!channelAccessor) throw new Error('channel handler: service not initialized');
  return channelAccessor();
}

function getMemberSvc(): MemberProfileService {
  if (!memberAccessor) throw new Error('channel handler: member service not initialized');
  return memberAccessor();
}

/** Legacy project channels remain in storage; live IPC lists DMs only. */
export function handleChannelList(
  data: IpcRequest<'channel:list'>,
): IpcResponse<'channel:list'> {
  if (data.projectId !== null) throw new Error('Project channels are archived');
  return { channels: getChannel().listDms() };
}

export function handleChannelGetGlobalGeneral(): IpcResponse<'channel:get-global-general'> {
  try {
    return { channel: getChannel().getGlobalGeneralChannel() };
  } catch {
    return { channel: null };
  }
}

export function handleChannelListMembers(
  data: IpcRequest<'channel:list-members'>,
): IpcResponse<'channel:list-members'> {
  const roomService = getChatRoomServiceOrNull();
  const room = roomService?.get(data.channelId);
  if (room && roomService) {
    const members: MemberView[] = roomService.listMembers(data.channelId).map((member) => {
      let current: MemberView | null = null;
      try { current = getMemberSvc().getView(member.providerId); } catch { /* removed provider */ }
      return {
        providerId: member.providerId,
        displayName: member.displayName,
        characterSheet: member.characterSheet,
        avatarKind: current?.avatarKind ?? 'default',
        avatarData: current?.avatarData ?? null,
        statusOverride: current?.statusOverride ?? null,
        updatedAt: current?.updatedAt ?? room.createdAt,
        workStatus: current?.workStatus ?? 'offline-connection',
        connectionFailure: current?.connectionFailure ?? null,
        isRoomSnapshot: true,
        roomPersona: member.effectivePersona,
      };
    });
    return { members };
  }
  const members: MemberView[] = getChannel().listMembers(data.channelId).map(
    (member) => getMemberSvc().getView(member.providerId),
  );
  return { members };
}

/** DM delete also closes the conversation: in-flight reply, late write, CLI clone. */
export function handleChannelDelete(
  data: IpcRequest<'channel:delete'>,
): IpcResponse<'channel:delete'> {
  getDmChannels().delete(data.id);
  return { success: true };
}

export async function handleChannelArchiveConversation(
  data: IpcRequest<'channel:archive-conversation'>,
): Promise<IpcResponse<'channel:archive-conversation'>> {
  const result = await getChannel().archiveConversation(data.channelId);
  return { archivedPath: result.archivedPath, deletedCount: result.deletedCount };
}

export function handleDmList(): IpcResponse<'dm:list'> {
  const service = getChannel();
  const channelByProvider = new Map<string, Channel>();
  for (const channel of service.listDms()) {
    const member = service.listMembers(channel.id)[0];
    if (member) channelByProvider.set(member.providerId, channel);
  }
  const items: DmSummary[] = providerRegistry.listAll().map((provider) => {
    const channel = channelByProvider.get(provider.id) ?? null;
    return {
      providerId: provider.id,
      providerName: provider.displayName,
      channel,
      exists: channel !== null,
    };
  });
  return { items };
}

export function handleDmCreate(
  data: IpcRequest<'dm:create'>,
): IpcResponse<'dm:create'> {
  return { channel: getChannel().createDm(data.providerId) };
}
