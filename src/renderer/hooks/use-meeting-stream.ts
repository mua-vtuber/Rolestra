/**
 * `useMeetingStream` — subscribes to the v3 stream-bridge meeting events
 * for the currently-active channel and exposes a live view of AI turns.
 *
 * Contract:
 * - `channelId === null` → idle. No subscription, derived shape only.
 * - On each `stream:meeting-turn-start` the hook allocates a new
 *   `liveTurn` entry keyed by `messageId`.
 * - On each `stream:meeting-turn-token` the cumulative buffer on the
 *   matching `liveTurn` is replaced by `payload.cumulative` so late
 *   subscribers jump straight to the current view without replay.
 * - On `stream:meeting-turn-done` the `liveTurn` is removed — the DB
 *   row is now authoritative and the Thread refetches via
 *   `useChannelMessages`.
 * - On `stream:meeting-state-changed` (fired by v3-side-effects) the
 *   SSM state is updated so `MeetingBanner` re-renders.
 * - `stream:meeting-error` populates `error`. Non-fatal errors leave the
 *   SSM state intact; fatal errors additionally set `fatal=true`.
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
  StreamMeetingErrorPayload,
} from '../../shared/stream-events';

export interface LiveTurn {
  messageId: string;
  meetingId: string;
  speakerId: string;
  cumulative: string;
  sequence: number;
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

    const onStart = (payload: StreamMeetingTurnStartPayload): void => {
      if (payload.channelId !== channelId) return;
      if (!mountedRef.current) return;
      setActiveMeetingId(payload.meetingId);
      setLiveTurns((prev) => [
        ...prev.filter((t) => t.messageId !== payload.messageId),
        {
          messageId: payload.messageId,
          meetingId: payload.meetingId,
          speakerId: payload.speakerId,
          cumulative: '',
          sequence: -1,
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
              }
            : t,
        ),
      );
    };

    const onDone = (payload: StreamMeetingTurnDonePayload): void => {
      if (payload.channelId !== channelId) return;
      if (!mountedRef.current) return;
      setLiveTurns((prev) =>
        prev.filter((t) => t.messageId !== payload.messageId),
      );
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
    };

    const unsubStart = subscribeStream('stream:meeting-turn-start', onStart);
    const unsubToken = subscribeStream('stream:meeting-turn-token', onToken);
    const unsubDone = subscribeStream('stream:meeting-turn-done', onDone);
    const unsubState = subscribeStream(
      'stream:meeting-state-changed',
      onStateChanged,
    );
    const unsubError = subscribeStream('stream:meeting-error', onError);

    return () => {
      unsubStart();
      unsubToken();
      unsubDone();
      unsubState();
      unsubError();
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
