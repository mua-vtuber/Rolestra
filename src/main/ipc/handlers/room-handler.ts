import type { IpcRequest, IpcResponse } from '../../../shared/ipc-types';
import type { ChatRoomService } from '../../channels/chat-room-service';

let accessor: (() => ChatRoomService) | null = null;

export function setChatRoomServiceAccessor(fn: () => ChatRoomService): void {
  accessor = fn;
}

export function getChatRoomService(): ChatRoomService {
  if (!accessor) throw new Error('room handler: service not initialized');
  return accessor();
}

export function getChatRoomServiceOrNull(): ChatRoomService | null {
  return accessor?.() ?? null;
}

export function handleRoomCreate(data: IpcRequest<'room:create'>): IpcResponse<'room:create'> {
  return { room: getChatRoomService().create(data) };
}

export function handleRoomList(): IpcResponse<'room:list'> {
  return { rooms: getChatRoomService().list() };
}

export function handleRoomArchive(data: IpcRequest<'room:archive'>): IpcResponse<'room:archive'> {
  return { room: getChatRoomService().archive(data.channelId) };
}

export function handleRoomDelete(data: IpcRequest<'room:delete'>): IpcResponse<'room:delete'> {
  getChatRoomService().delete(data.channelId);
  return { success: true };
}

export function handleRoomGetMembers(data: IpcRequest<'room:get-members'>): IpcResponse<'room:get-members'> {
  return { members: getChatRoomService().listMembers(data.channelId) };
}
