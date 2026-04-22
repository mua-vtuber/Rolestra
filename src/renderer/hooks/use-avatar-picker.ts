/**
 * `useAvatarPicker` — fetches the catalogue + drives custom upload
 * (R8-Task3, spec §7.1).
 *
 * Two surfaces:
 *
 *   1. `avatars` — the cached `member:list-avatars` response (`{ key, label }[]`).
 *      Mirrors {@link useMembers} fetch ergonomics so the AvatarPicker grid
 *      can render the 8 default options without per-render IPC.
 *
 *   2. `uploadCustom(providerId)` — a single mutation that:
 *        a. opens the OS file picker via `member:pick-avatar-file` (Main
 *           handles the dialog with image-extension filter so the user can
 *           never pick a `.txt` to begin with — defence in depth on top of
 *           AvatarStore's ext check).
 *        b. on cancel, returns `null` (no error).
 *        c. on selection, calls `member:upload-avatar` with the picked path
 *           and returns `{ relativePath, absolutePath }` for the picker to
 *           hand to the EditModal's `onChange`.
 *      The mutation surfaces its own loading + error state — the avatar
 *      catalogue fetch is independent.
 *
 * The hook is intentionally headless (no UI). The picker (Task 3
 * component) renders the catalogue grid + an "사진 업로드" button that
 * calls `uploadCustom`.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { invoke } from '../ipc/invoke';
import type { AvatarUploadResponse } from '../../shared/member-profile-types';

export interface AvatarOption {
  key: string;
  label: string;
}

function toError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason));
}

export interface UseAvatarPickerResult {
  /** `null` until the first `member:list-avatars` resolves. */
  avatars: AvatarOption[] | null;
  /** Catalogue fetch state — independent of upload mutation. */
  loading: boolean;
  error: Error | null;
  /** Opens the OS picker + uploads. `null` resolution = user cancelled. */
  uploadCustom(providerId: string): Promise<AvatarUploadResponse | null>;
  /** Upload-mutation state — distinct from catalogue `loading`. */
  uploading: boolean;
  uploadError: Error | null;
  /** Re-fetch the catalogue (rare — catalogue is static, kept for parity). */
  refresh(): Promise<void>;
}

export function useAvatarPicker(): UseAvatarPickerResult {
  const [avatars, setAvatars] = useState<AvatarOption[] | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  const [uploading, setUploading] = useState<boolean>(false);
  const [uploadError, setUploadError] = useState<Error | null>(null);

  const didMountFetchRef = useRef(false);
  const mountedRef = useRef(true);

  const runFetch = useCallback(async (isInitial: boolean): Promise<void> => {
    setLoading(true);
    if (!isInitial) setError(null);
    try {
      const { avatars: list } = await invoke('member:list-avatars', undefined);
      if (!mountedRef.current) return;
      setAvatars(list);
      setError(null);
    } catch (reason) {
      if (!mountedRef.current) return;
      setError(toError(reason));
      if (isInitial) setAvatars(null);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    if (didMountFetchRef.current) {
      return () => {
        mountedRef.current = false;
      };
    }
    didMountFetchRef.current = true;
    void runFetch(true);
    return () => {
      mountedRef.current = false;
    };
  }, [runFetch]);

  const refresh = useCallback(async (): Promise<void> => {
    await runFetch(false);
  }, [runFetch]);

  const uploadCustom = useCallback(
    async (providerId: string): Promise<AvatarUploadResponse | null> => {
      setUploading(true);
      setUploadError(null);
      try {
        const { sourcePath } = await invoke('member:pick-avatar-file', undefined);
        if (sourcePath === null) {
          return null;
        }
        const response = await invoke('member:upload-avatar', {
          providerId,
          sourcePath,
        });
        return response;
      } catch (reason) {
        const err = toError(reason);
        if (mountedRef.current) setUploadError(err);
        throw err;
      } finally {
        if (mountedRef.current) setUploading(false);
      }
    },
    [],
  );

  return {
    avatars,
    loading,
    error,
    uploadCustom,
    uploading,
    uploadError,
    refresh,
  };
}
