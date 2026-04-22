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

import { dialog } from 'electron';

import type { IpcRequest, IpcResponse } from '../../../shared/ipc-types';
import type { MemberProfileService } from '../../members/member-profile-service';
import type { AvatarStore } from '../../members/avatar-store';
import { AvatarValidationError } from '../../members/avatar-store';
import { providerRegistry } from '../../providers/registry';
import { DEFAULT_AVATARS } from '../../members/default-avatars';
import {
  ALLOWED_AVATAR_EXTENSIONS,
  type MemberView,
} from '../../../shared/member-profile-types';

let memberAccessor: (() => MemberProfileService) | null = null;
let avatarStoreAccessor: (() => AvatarStore) | null = null;

export function setMemberProfileServiceAccessor(
  fn: () => MemberProfileService,
): void {
  memberAccessor = fn;
}

/**
 * Inject the AvatarStore accessor (R8-Task5). Wired by `main/index.ts`
 * boot (R8-Task8) — until then the upload handler throws the same
 * "service not initialized" pattern used by {@link getService}.
 */
export function setAvatarStoreAccessor(fn: () => AvatarStore): void {
  avatarStoreAccessor = fn;
}

function getService(): MemberProfileService {
  if (!memberAccessor) {
    throw new Error('member handler: service not initialized');
  }
  return memberAccessor();
}

function getAvatarStore(): AvatarStore {
  if (!avatarStoreAccessor) {
    throw new Error('member handler: avatar store not initialized');
  }
  return avatarStoreAccessor();
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

/**
 * member:pick-avatar-file (R8-Task5) — opens the OS file picker filtered
 * to allowed image extensions. Returns `{ sourcePath: null }` on cancel.
 *
 * The dialog filter is the FIRST line of defence — the user cannot even
 * select a `.txt`. AvatarStore.copy() then validates again (defence in
 * depth) so direct IPC callers (tests, malicious renderer) cannot bypass.
 */
export async function handleMemberPickAvatarFile(): Promise<
  IpcResponse<'member:pick-avatar-file'>
> {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [
      {
        name: 'Image',
        // Electron expects the extension list without the leading dot.
        extensions: [...ALLOWED_AVATAR_EXTENSIONS],
      },
    ],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { sourcePath: null };
  }
  return { sourcePath: result.filePaths[0] };
}

/**
 * member:upload-avatar (R8-Task5) — copies the picked source file into
 * `<ArenaRoot>/avatars/<providerId>.<ext>` via {@link AvatarStore}.
 *
 * Validation errors are wrapped in {@link AvatarValidationError} which
 * keeps a stable `code` for renderer i18n mapping. Other I/O errors
 * (EPERM, EACCES) bubble unchanged.
 *
 * NOTE: this handler does NOT update `member_profiles.avatar_data` —
 * that is the renderer's job (it calls `member:update-profile` after
 * receiving the relativePath response). Splitting the two keeps each
 * IPC single-purpose.
 */
export function handleMemberUploadAvatar(
  data: IpcRequest<'member:upload-avatar'>,
): IpcResponse<'member:upload-avatar'> {
  return getAvatarStore().copy(data.providerId, data.sourcePath);
}

// Re-export for test wiring + main/index.ts boot sequence.
export { AvatarValidationError };
