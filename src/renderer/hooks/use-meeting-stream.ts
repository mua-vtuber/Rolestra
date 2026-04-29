/**
 * `useMeetingStream` — subscribes to the v3 stream-bridge meeting events
 * for the currently-active channel and exposes a live view of AI turns.
 *
 * Contract:
 * - `channelId === null` → idle. No subscription, derived shape only.
 * - On each `stream:meeting-turn-start` the hook allocates a new
 *   `liveTurn` entry keyed by `messageId` with status='acknowledged'.
 * - On each `stream:meeting-turn-token` the cumulative buffer on the
 *   matching `liveTurn` is replaced by `payload.cumulative` so late
 *   subscribers jump straight to the current view without replay, and
 *   status flips to 'composing' the first time tokens arrive.
 * - On `stream:meeting-turn-done` the `liveTurn` is removed — the DB
 *   row is now authoritative and the Thread refetches via
 *   `useChannelMessages`.
 * - On `stream:meeting-turn-skipped` a transient liveTurn entry with
 *   status='skipped' is appended (keyed by `skipId` or a synthesised id)
 *   and auto-removed after `TRANSIENT_NOTICE_TTL_MS` so the Thread can
 *   show "{name} was offline" briefly without permanent clutter.
 * - On `stream:meeting-error` carrying a `messageId`, the matching
 *   liveTurn is flipped to status='failed' with the error message, and
 *   auto-removed after `TRANSIENT_NOTICE_TTL_MS`. Without `messageId`
 *   only the global `error` field is populated (legacy R6 behaviour).
 * - On `stream:meeting-state-changed` (fired by v3-side-effects) the
 *   SSM state is updated so `MeetingBanner` re-renders.
 *
 * Messages from OTHER channels (different `channelId`) are dropped at
 * the hook layer so multiple renders of the Thread component don't
 * cross-pollinate. This keeps the consumer (Thread) agnostic of
 * concurrent meetings.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { subscribeStream } from '../ipc/stream-subscribe';
import type {
  StreamMeetingStateChangedPayload,
  StreamMeetingTurnStartPayload,
  StreamMeetingTurnTokenPayload,
  StreamMeetingTurnDonePayload,
  StreamMeetingTurnSkippedPayload,
  StreamMeetingErrorPayload,
} from '../../shared/stream-events';

/** How long a `failed` / `skipped` notice lingers in the live buffer
 *  before the hook drops it. The Thread renders these as inline
 *  status rows; long enough to be noticed, short enough not to pile up
 *  across a multi-round meeting. */
const TRANSIENT_NOTICE_TTL_MS = 6_000;

export type LiveTurnStatus =
  | 'acknowledged'
  | 'composing'
  | 'failed'
  | 'skipped';

export interface LiveTurn {
  messageId: string;
  meetingId: string;
  speakerId: string;
  /** Display name when the source event carried one (skipped path). For
   *  `acknowledged` / `composing` / `failed` the renderer joins
   *  `speakerId` against the channel member roster instead. */
  participantName: string | null;
  cumulative: string;
  sequence: number;
  status: LiveTurnStatus;
  /** Human-readable error message — only set for `failed`. */
  errorMessage: string | null;
}

export interface UseMeetingStreamResult {
  /** Turns currently streaming tokens, keyed by messageId. */
  liveTurns: LiveTurn[];
  /** Most recent SSM state observed for any meeting in this channel. */
  ssmState: string | null;
  /** Most recent meetingId observed — tracks "which meeting is driving
   *  the banner" across reconnects. */
  activeMeetingId: string | null;
  /** Latest error (non-null when a `stream:meeting-error` was received). */
  error: { message: string; fatal: boolean } | null;
  /** Reset the error state; consumers call after acknowledging. */
  clearError: () => void;
}

const EMPTY_RESULT: UseMeetingStreamResult = {
  liveTurns: [],
  ssmState: null,
  activeMeetingId: null,
  error: null,
  clearError: () => {},
};

export function useMeetingStream(
  channelId: string | null,
): UseMeetingStreamResult {
  const [liveTurns, setLiveTurns] = useState<LiveTurn[]>([]);
  const [ssmState, setSsmState] = useState<string | null>(null);
  const [activeMeetingId, setActiveMeetingId] = useState<string | null>(null);
  const [error, setError] = useState<UseMeetingStreamResult['error']>(null);
  const mountedRef = useRef(true);
  // messageId → timeout id, so cleanup / channel-change can clear any
  // outstanding "remove this transient notice in 6s" timers.
  const transientTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const clearError = useCallback(() => setError(null), []);

  useEffect(() => {
    if (channelId === null) {
      // Idle — no subscription. State reset happens in the cleanup of
      // the previous channelId's effect (so the setState calls land in
      // the cleanup phase, not the effect body — this keeps React's
      // cascading-render guard happy).
      return () => {};
    }

    const timers = transientTimersRef.current;

    const scheduleRemoval = (key: string): void => {
      const existing = timers.get(key);
      if (existing) clearTimeout(existing);
      const handle = setTimeout(() => {
        if (!mountedRef.current) return;
        timers.delete(key);
        setLiveTurns((prev) => prev.filter((t) => t.messageId !== key));
      }, TRANSIENT_NOTICE_TTL_MS);
      timers.set(key, handle);
    };

    const cancelRemoval = (key: string): void => {
      const existing = timers.get(key);
      if (existing) {
        clearTimeout(existing);
        timers.delete(key);
      }
    };

    const onStart = (payload: StreamMeetingTurnStartPayload): void => {
      if (payload.channelId !== channelId) return;
      if (!mountedRef.current) return;
      cancelRemoval(payload.messageId);
      setActiveMeetingId(payload.meetingId);
      setLiveTurns((prev) => [
        ...prev.filter((t) => t.messageId !== payload.messageId),
        {
          messageId: payload.messageId,
          meetingId: payload.meetingId,
          speakerId: payload.speakerId,
          participantName: null,
          cumulative: '',
          sequence: -1,
          status: 'acknowledged',
          errorMessage: null,
        },
      ]);
    };

    const onToken = (payload: StreamMeetingTurnTokenPayload): void => {
      if (payload.channelId !== channelId) return;
      if (!mountedRef.current) return;
      setLiveTurns((prev) =>
        prev.map((t) =>
          t.messageId === payload.messageId
            ? {
                ...t,
                cumulative: payload.cumulative,
                sequence: payload.sequence,
                status: 'composing',
              }
            : t,
        ),
      );
    };

    const onDone = (payload: StreamMeetingTurnDonePayload): void => {
      if (payload.channelId !== channelId) return;
      if (!mountedRef.current) return;
      cancelRemoval(payload.messageId);
      setLiveTurns((prev) =>
        prev.filter((t) => t.messageId !== payload.messageId),
      );
    };

    const onSkipped = (payload: StreamMeetingTurnSkippedPayload): void => {
      if (payload.channelId !== channelId) return;
      if (!mountedRef.current) return;
      const key =
        payload.skipId ??
        `skipped-${payload.participantId}-${Date.now()}`;
      setLiveTurns((prev) => [
        ...prev.filter((t) => t.messageId !== key),
        {
          messageId: key,
          meetingId: payload.meetingId,
          speakerId: payload.participantId,
          participantName: payload.participantName,
          cumulative: '',
          sequence: -1,
          status: 'skipped',
          errorMessage: null,
        },
      ]);
      scheduleRemoval(key);
    };

    const onStateChanged = (
      payload: StreamMeetingStateChangedPayload,
    ): void => {
      if (payload.channelId !== channelId) return;
      if (!mountedRef.current) return;
      setActiveMeetingId(payload.meetingId);
      setSsmState(payload.state);
    };

    const onError = (payload: StreamMeetingErrorPayload): void => {
      if (payload.channelId !== channelId) return;
      if (!mountedRef.current) return;
      setError({ message: payload.error, fatal: payload.fatal });
      // R12 dogfooding: when the failure is tied to a specific in-flight
      // turn the Thread should flip that bubble to "AI failed to write"
      // instead of leaving it stuck on "writing…". Untargeted errors
      // (provider not found, fatal meeting collapse) only populate the
      // global `error` field — no liveTurn to flip.
      const targetId = payload.messageId;
      if (targetId) {
        setLiveTurns((prev) =>
          prev.map((t) =>
            t.messageId === targetId
              ? {
                  ...t,
                  status: 'failed',
                  errorMessage: payload.error,
                }
              : t,
          ),
        );
        scheduleRemoval(targetId);
      }
    };

    const unsubStart = subscribeStream('stream:meeting-turn-start', onStart);
    const unsubToken = subscribeStream('stream:meeting-turn-token', onToken);
    const unsubDone = subscribeStream('stream:meeting-turn-done', onDone);
    const unsubSkipped = subscribeStream(
      'stream:meeting-turn-skipped',
      onSkipped,
    );
    const unsubState = subscribeStream(
      'stream:meeting-state-changed',
      onStateChanged,
    );
    const unsubError = subscribeStream('stream:meeting-error', onError);

    return () => {
      unsubStart();
      unsubToken();
      unsubDone();
      unsubSkipped();
      unsubState();
      unsubError();
      // Drop any pending auto-removal timers — leaving them armed
      // would resolve to a setLiveTurns call after the next channel's
      // effect already initialised state.
      for (const handle of timers.values()) clearTimeout(handle);
      timers.clear();
      // Reset state here (in cleanup, not body) so a later resubscribe
      // doesn't show stale turns from a channel the user navigated away
      // from. The guarded `prev === x ? prev : x` pattern no-ops when
      // the state is already idle.
      setLiveTurns((prev) => (prev.length === 0 ? prev : []));
      setSsmState((prev) => (prev === null ? prev : null));
      setActiveMeetingId((prev) => (prev === null ? prev : null));
      setError((prev) => (prev === null ? prev : null));
    };
  }, [channelId]);

  if (channelId === null) {
    return { ...EMPTY_RESULT, clearError };
  }

  return {
    liveTurns,
    ssmState,
    activeMeetingId,
    error,
    clearError,
  };
}
