/**
 * channel:get-permissions / channel:update-permissions handlers — R12-W T7.
 *
 * Renderer ↔ Main 권한 채널. 채널 생성/설정 모달의 [저장] 흐름이 본 IPC 를
 * 거치며, 변경 시 ChannelService 가 `'permission-changed'` event 를 발사해
 * 활성 회의 세션의 권한 캐시가 dirty 마킹된다 (T8).
 *
 * Accessor 패턴은 다른 channel:* handler 들 (channel-handler.ts) 과 동일 —
 * main bootstrap (`main/index.ts`) 에서 같은 ChannelService 인스턴스를
 * `setChannelPermissionServiceAccessor` 로 등록한다.
 *
 * Silent fallback 금지: 알려지지 않은 channelId 는 ChannelService.getPermissions
 * 가 `ChannelNotFoundError` 로 throw — IPC 응답이 명시 에러로 전파된다 (router
 * 의 try/catch 가 에러 메시지를 그대로 surface).
 */

import type { IpcRequest, IpcResponse } from '../../../shared/ipc-types';
import type { ChannelService } from '../../channels/channel-service';
import type { PermissionSet } from '../../../shared/permission-set-types';

let channelServiceAccessor: (() => ChannelService) | null = null;

/** Composition root 가 호출 — main/index.ts. */
export function setChannelPermissionServiceAccessor(
  fn: () => ChannelService,
): void {
  channelServiceAccessor = fn;
}

function getChannelService(): ChannelService {
  if (!channelServiceAccessor) {
    throw new Error(
      'channel-permission-handler: ChannelService accessor not initialized',
    );
  }
  return channelServiceAccessor();
}

/** channel:get-permissions */
export function handleChannelGetPermissions(
  data: IpcRequest<'channel:get-permissions'>,
): IpcResponse<'channel:get-permissions'> {
  const svc = getChannelService();
  const perm = svc.getPermissions(data.channelId);
  return {
    fileRead: perm.fileRead,
    fileWrite: perm.fileWrite,
    commandExec: perm.commandExec,
    webSearch: perm.webSearch,
    dbRead: perm.dbRead,
  };
}

/** channel:update-permissions */
export function handleChannelUpdatePermissions(
  data: IpcRequest<'channel:update-permissions'>,
): IpcResponse<'channel:update-permissions'> {
  const svc = getChannelService();
  const patch: PermissionSet = {
    fileRead: data.fileRead,
    fileWrite: data.fileWrite,
    commandExec: data.commandExec,
    webSearch: data.webSearch,
    dbRead: data.dbRead,
  };
  svc.updatePermissions(data.channelId, patch);
  return { ok: true };
}
