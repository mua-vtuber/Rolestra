/**
 * Re-export of the {@link DEFAULT_AVATARS} catalogue (R8-Task2 moved the
 * source to `shared/` so the renderer can read color/emoji without an IPC
 * round-trip per render). This shim keeps R2 import paths
 * (`from '../members/default-avatars'`) working without churning every
 * caller across `src/main/`.
 *
 * Do not add new exports here — extend `src/shared/default-avatars.ts`
 * instead.
 */
export { DEFAULT_AVATARS, findDefaultAvatar } from '../../shared/default-avatars';
export type { DefaultAvatarKey } from '../../shared/default-avatars';
