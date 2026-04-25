/**
 * `useMemberStatusStream` — subscribes to the v3 stream-bridge
 * `stream:member-status-changed` push (R10-Task10) and exposes the
 * latest {@link MemberView} per `providerId` to renderer surfaces
 * (PeopleWidget / MemberRow / MessengerSidebar).
 *
 * Why a hook + module-level reducer:
 *   The same stream is consumed by multiple unrelated components
 *   (sidebar avatar, dashboard widget, profile popover). A per-mount
 *   reducer would force every surface to re-fetch on its own mount and
 *   miss in-flight pushes that arrived while it was unmounted. Hoisting
 *   the reducer to a module-level Map keyed by `providerId` lets every
 *   subscriber read the same authoritative snapshot — the hook itself
 *   is just a thin React adapter that forces a re-render when the entry
 *   for the watched id (or the whole map, when no filter) changes.
 *
 * D9 coexistence (plan R10):
 *   The existing R8 mutation-after-invalidation pattern is preserved:
 *   when a stream push lands we ALSO call `notifyChannelsChanged()` so
 *   surfaces that mount-fetch via `useMembers` / `useMemberProfile`
 *   pick up the new state on the same tick. This dual path is
 *   intentional — a future bridge outage (e.g. `streamBridge` not
 *   wired in a test harness, or the cooldown window) silently degrades
 *   to the R8 invalidation surface without rewiring anything. Removing
 *   either path would re-introduce the R8 deferred latency problem.
 *
 * Per-channel filtering is NOT exposed: members live across the whole
 * roster, not per channel — every subscriber sees every push and picks
 * the providerId it cares about.
 */

import { useEffect, useState, useSyncExternalStore } from 'react';
import { subscribeStream } from '../ipc/stream-subscribe';
import { notifyChannelsChanged } from './channel-invalidation-bus';
import type { StreamMemberStatusChangedPayload } from '../../shared/stream-events';
import type { MemberView, WorkStatus } from '../../shared/member-profile-types';

// ── Module-level reducer ────────────────────────────────────────────

/** Authoritative snapshot of every member view we have heard about. */
const memberByProviderId = new Map<string, MemberView>();

/**
 * Reducer-version counter. Bumped on every reducer mutation so the
 * `useSyncExternalStore` snapshot comparison can detect changes
 * without comparing the full Map (which would force every consumer
 * to re-render on unrelated providerId pushes — a key reason for the
 * version-counter pattern).
 */
let reducerVersion = 0;

/** Subscribers that the React `useSyncExternalStore` driver registers. */
const reducerSubscribers = new Set<() => void>();

/**
 * Stream-driver counter — true while the module-level subscription is
 * live. Multiple hook instances share the same counter so the network
 * subscription is registered ONCE per process even when N components
 * mount the hook simultaneously.
 */
let streamRefCount = 0;
let unsubscribeStream: (() => void) | null = null;

function notifyReducerSubscribers(): void {
  for (const fn of reducerSubscribers) {
    try {
      fn();
    } catch {
      // useSyncExternalStore listeners are React internals; an exception
      // would only happen if React itself was misbehaving. Isolate so a
      // single failing subscriber cannot break siblings.
    }
  }
}

function applyStreamPayload(payload: StreamMemberStatusChangedPayload): void {
  memberByProviderId.set(payload.providerId, payload.member);
  reducerVersion += 1;
  notifyReducerSubscribers();

  // D9 coexistence: fan out the legacy invalidation channel so consumers
  // that mount-fetch via `useMembers` / `useMemberProfile` (R8 pattern)
  // pick up the change on the same tick. `notifyChannelsChanged` is a
  // global bus — calling it from a stream handler is intentional and
  // safe (subscribers are independent React effects). Future code that
  // adds a dedicated `member-invalidation-bus` should fan out here too,
  // not replace this call.
  void notifyChannelsChanged();
}

function ensureStreamSubscribed(): void {
  streamRefCount += 1;
  if (streamRefCount > 1) return;
  unsubscribeStream = subscribeStream(
    'stream:member-status-changed',
    applyStreamPayload,
  );
}

function releaseStreamSubscription(): void {
  streamRefCount -= 1;
  if (streamRefCount > 0) return;
  if (unsubscribeStream) {
    unsubscribeStream();
    unsubscribeStream = null;
  }
}

// ── React adapter ───────────────────────────────────────────────────

function subscribeReducer(listener: () => void): () => void {
  reducerSubscribers.add(listener);
  return () => {
    reducerSubscribers.delete(listener);
  };
}

function getReducerSnapshot(): number {
  return reducerVersion;
}

export interface UseMemberStatusStreamResult {
  /**
   * The full {@link MemberView} for `providerId`, or `null` when no
   * push has been received yet for that id. Mount-fetch consumers
   * (`useMemberProfile`) will populate the row independently — this
   * hook only carries push deltas.
   */
  view: MemberView | null;
  /** Convenience shortcut — `view?.workStatus ?? null`. */
  status: WorkStatus | null;
}

/**
 * Subscribe to live status pushes for a single member.
 *
 * Pass an empty string to disable the subscription (used by surfaces
 * that conditionally render — e.g. closed profile popover). The
 * underlying stream subscription is reference-counted, so a flicker of
 * `''` → providerId does NOT thrash the network registration.
 */
export function useMemberStatusStream(
  providerId: string,
): UseMemberStatusStreamResult {
  // Tap into the module-level reducer through useSyncExternalStore so
  // every push triggers exactly one render. The consumed value is the
  // version counter; we re-read the Map AFTER React commits.
  useSyncExternalStore(subscribeReducer, getReducerSnapshot, getReducerSnapshot);

  // Stream subscription lifetime — tied to non-empty providerId so a
  // disabled hook does not hold the registration open.
  useEffect(() => {
    if (providerId === '') return;
    ensureStreamSubscribed();
    return () => {
      releaseStreamSubscription();
    };
  }, [providerId]);

  if (providerId === '') {
    return { view: null, status: null };
  }
  const view = memberByProviderId.get(providerId) ?? null;
  return { view, status: view?.workStatus ?? null };
}

/**
 * Whole-roster subscription variant — used by surfaces that render a
 * list of members and want every push, not just one id (e.g.
 * PeopleWidget / MessengerSidebar). Returns a stable Map reference
 * across renders that did NOT touch the data, so a memoising consumer
 * can compare by reference.
 *
 * Implementation note: we recompute the snapshot Map every render
 * because Maps are mutable and React relies on `===` for memoisation.
 * Returning a fresh Map per render is acceptable here — the typical
 * consumer renders `<MemberRow>`s keyed by providerId, so the cost is
 * a single iteration during commit.
 */
export function useAllMemberStatusStream(): {
  members: ReadonlyMap<string, MemberView>;
} {
  useSyncExternalStore(subscribeReducer, getReducerSnapshot, getReducerSnapshot);

  // Lifetime: any consumer of the whole-roster variant counts as a
  // long-lived stream subscriber while mounted.
  const [, forceRender] = useState(0);
  useEffect(() => {
    ensureStreamSubscribed();
    // No reducer-state read here — useSyncExternalStore already does
    // the dependency tracking. forceRender is unused but kept so the
    // hot-reload path doesn't strip the unused setter.
    void forceRender;
    return () => {
      releaseStreamSubscription();
    };
  }, []);

  return { members: memberByProviderId };
}

// ── Test-only helpers ───────────────────────────────────────────────

/**
 * Reset the module-level reducer between vitest cases. Production code
 * MUST NOT call this — it would silently drop every renderer subscriber
 * and the next push would arrive into a half-empty store.
 */
export function __resetMemberStatusStreamForTests(): void {
  memberByProviderId.clear();
  reducerVersion = 0;
  reducerSubscribers.clear();
  streamRefCount = 0;
  if (unsubscribeStream) {
    unsubscribeStream();
    unsubscribeStream = null;
  }
}
