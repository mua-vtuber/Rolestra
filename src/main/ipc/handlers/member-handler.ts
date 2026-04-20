/**
 * member:* IPC handlers.
 *
 * Wire member profile + runtime work-status operations to {@link
 * MemberProfileService}. `member:list` iterates the live provider
 * registry (singleton from providers/registry.ts) and calls `getView`
 * for each — this is the fused shape the sidebar renders (profile +
 * displayName + workStatus).
 *
 * Default avatars come from a static catalogue (spec §7.1) so the
 * renderer can render the palette without an IPC round-trip per picker
 * render.
 */

import type { IpcRequest, IpcResponse } from '../../../shared/ipc-types';
import type { MemberProfileService } from '../../members/member-profile-service';
import { providerRegistry } from '../../providers/registry';
import { DEFAULT_AVATARS } from '../../members/default-avatars';
import type { MemberView } from '../../../shared/member-profile-types';

let memberAccessor: (() => MemberProfileService) | null = null;

export function setMemberProfileServiceAccessor(
  fn: () => MemberProfileService,
): void {
  memberAccessor = fn;
}

function getService(): MemberProfileService {
  if (!memberAccessor) {
    throw new Error('member handler: service not initialized');
  }
  return memberAccessor();
}

/** Labels for default-avatar palette entries. UI may re-translate via i18n. */
const AVATAR_LABELS: Record<string, string> = {
  'blue-dev': '개발',
  'green-design': '디자인',
  'purple-science': '연구',
  'amber-writer': '작가',
  'rose-mentor': '멘토',
  'cyan-analyst': '분석가',
  'slate-ops': '운영',
  'pink-product': '프로덕트',
};

/** member:list */
export function handleMemberList(): IpcResponse<'member:list'> {
  const svc = getService();
  const members: MemberView[] = [];
  for (const info of providerRegistry.listAll()) {
    members.push(svc.getView(info.id));
  }
  return { members };
}

/** member:get-profile */
export function handleMemberGetProfile(
  data: IpcRequest<'member:get-profile'>,
): IpcResponse<'member:get-profile'> {
  const profile = getService().getProfile(data.providerId);
  return { profile };
}

/** member:update-profile */
export function handleMemberUpdateProfile(
  data: IpcRequest<'member:update-profile'>,
): IpcResponse<'member:update-profile'> {
  const profile = getService().updateProfile(data.providerId, data.patch);
  return { profile };
}

/** member:set-status */
export function handleMemberSetStatus(
  data: IpcRequest<'member:set-status'>,
): IpcResponse<'member:set-status'> {
  getService().setStatus(data.providerId, data.status);
  return { success: true };
}

/** member:reconnect */
export async function handleMemberReconnect(
  data: IpcRequest<'member:reconnect'>,
): Promise<IpcResponse<'member:reconnect'>> {
  const status = await getService().reconnect(data.providerId);
  return { status };
}

/** member:list-avatars */
export function handleMemberListAvatars(): IpcResponse<'member:list-avatars'> {
  return {
    avatars: DEFAULT_AVATARS.map((a) => ({
      key: a.key,
      label: AVATAR_LABELS[a.key] ?? a.key,
    })),
  };
}
