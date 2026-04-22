/**
 * `useMemberProfile` + `useUpdateMemberProfile` — single-member fetch + edit
 * mutation (R8-Task4).
 *
 * Distinct from {@link useMembers} which lists the entire roster — this one
 * is for the EditModal which only cares about a single providerId. Mount
 * fetch is strict-mode-safe (single-fetch guard).
 *
 * The mutation hook deliberately does NOT trigger a refetch — the EditModal
 * closes on success, and the surrounding surfaces (PeopleWidget, MemberRow)
 * pick up the new state on their next mount fetch (R8-D8: invalidation,
 * not stream broadcast).
 *
 * The hook splits read / write into two hooks (rather than returning a
 * combined `{profile, mutate}`) so the EditModal can compose them
 * independently — `useMemberProfile` mounts once when the modal opens,
 * `useUpdateMemberProfile` is called on save click. Splitting keeps the
 * mutation state (loading/error) from contaminating the read state.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { invoke } from '../ipc/invoke';
import type {
  MemberProfile,
  MemberView,
} from '../../shared/member-profile-types';

function toError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason));
}

export interface UseMemberProfileResult {
  /**
   * Persisted `member_profiles` row. `null` until the first IPC resolves
   * OR when the providerId is empty (no fetch fired).
   */
  profile: MemberProfile | null;
  loading: boolean;
  error: Error | null;
  /** Manual refetch (rare — the EditModal does not need it). */
  refresh: () => Promise<void>;
}

/**
 * Fetch a single member's profile via `member:get-profile`.
 *
 * Pass an empty `providerId` to disable the fetch entirely (used when the
 * modal is closed and we want to avoid a stray IPC).
 */
export function useMemberProfile(providerId: string): UseMemberProfileResult {
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [loading, setLoading] = useState<boolean>(providerId !== '');
  const [error, setError] = useState<Error | null>(null);

  const didMountFetchRef = useRef<string | null>(null);
  const mountedRef = useRef(true);

  const runFetch = useCallback(
    async (id: string, isInitial: boolean): Promise<void> => {
      if (id === '') return;
      setLoading(true);
      if (!isInitial) setError(null);
      try {
        const { profile: p } = await invoke('member:get-profile', {
          providerId: id,
        });
        if (!mountedRef.current) return;
        setProfile(p);
        setError(null);
      } catch (reason) {
        if (!mountedRef.current) return;
        setError(toError(reason));
        if (isInitial) setProfile(null);
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    mountedRef.current = true;
    if (providerId === '') {
      return () => {
        mountedRef.current = false;
      };
    }
    if (didMountFetchRef.current === providerId) {
      return () => {
        mountedRef.current = false;
      };
    }
    didMountFetchRef.current = providerId;
    void runFetch(providerId, true);
    return () => {
      mountedRef.current = false;
    };
  }, [providerId, runFetch]);

  const refresh = useCallback(async (): Promise<void> => {
    await runFetch(providerId, false);
  }, [providerId, runFetch]);

  return { profile, loading, error, refresh };
}

/**
 * Patch shape accepted by {@link useUpdateMemberProfile.mutate}. Mirrors
 * `MemberProfileService.updateProfile` whitelist — `providerId`, `updatedAt`,
 * and `statusOverride` are deliberately omitted.
 */
export interface MemberProfileEditPatch {
  role?: string;
  personality?: string;
  expertise?: string;
  avatarKind?: MemberProfile['avatarKind'];
  avatarData?: string | null;
}

export interface UseUpdateMemberProfileResult {
  mutate(
    providerId: string,
    patch: MemberProfileEditPatch,
  ): Promise<MemberProfile>;
  loading: boolean;
  error: Error | null;
  reset(): void;
}

/**
 * Edit-mutation hook for `member:update-profile`. Surfaces typed
 * loading/error so the EditModal can render banners + disable the save
 * button while in flight.
 */
export function useUpdateMemberProfile(): UseUpdateMemberProfileResult {
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const mutate = useCallback(
    async (
      providerId: string,
      patch: MemberProfileEditPatch,
    ): Promise<MemberProfile> => {
      setLoading(true);
      setError(null);
      try {
        const { profile } = await invoke('member:update-profile', {
          providerId,
          patch,
        });
        return profile;
      } catch (reason) {
        const err = toError(reason);
        if (mountedRef.current) setError(err);
        throw err;
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    },
    [],
  );

  const reset = useCallback(() => {
    setError(null);
  }, []);

  return { mutate, loading, error, reset };
}

/**
 * Convenience helper: returns a stable `MemberView`-like fallback when the
 * EditModal has only a `MemberProfile` from `member:get-profile` and needs
 * to feed AvatarPicker `currentKind`/`currentData`.
 *
 * (Kept here rather than co-located in EditModal so other surfaces can use
 * the same projection.)
 */
export function fallbackMemberView(
  profile: MemberProfile,
  fallbackName: string,
): MemberView {
  return {
    ...profile,
    displayName: fallbackName,
    persona: '',
    workStatus: 'offline-connection',
  };
}
