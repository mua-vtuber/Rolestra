import { useCallback, useEffect, useRef, useState } from 'react';

import type { ChatVote } from '../../shared/chat-vote-types';
import { invoke } from '../ipc/invoke';

interface VoteState {
  opinionId: string;
  vote: ChatVote | null;
  loading: boolean;
  starting: boolean;
  sending: boolean;
  error: Error | null;
  sendError: Error | null;
}

function asError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason));
}

export function useChatVote(opinionId: string): VoteState & {
  start: () => Promise<void>;
  sendResult: () => Promise<void>;
} {
  const [state, setState] = useState<VoteState>({
    opinionId, vote: null, loading: true, starting: false, sending: false, error: null, sendError: null,
  });
  const generation = useRef(0);
  const starting = useRef(false);
  const sending = useRef(false);

  useEffect(() => {
    const current = ++generation.current;
    starting.current = false;
    sending.current = false;
    setState({ opinionId, vote: null, loading: true, starting: false, sending: false, error: null, sendError: null });
    void invoke('opinion:getVote', { opinionId }).then(
      ({ result }) => {
        if (generation.current !== current) return;
        setState({ opinionId, vote: result, loading: false, starting: false, sending: false, error: null, sendError: null });
      },
      (reason: unknown) => {
        if (generation.current !== current) return;
        setState({ opinionId, vote: null, loading: false, starting: false, sending: false, error: asError(reason), sendError: null });
      },
    );
    return () => { generation.current += 1; };
  }, [opinionId]);

  useEffect(() => {
    if (state.opinionId !== opinionId || state.vote?.status !== 'running') return;
    const current = generation.current;
    let busy = false;
    const timer = setInterval(() => {
      if (busy) return;
      busy = true;
      void invoke('opinion:getVote', { opinionId }).then(
        ({ result }) => {
          if (generation.current !== current || result === null) return;
          setState((prev) => prev.opinionId === opinionId
            ? { ...prev, vote: result, error: null } : prev);
        },
        (reason: unknown) => {
          if (generation.current !== current) return;
          setState((prev) => prev.opinionId === opinionId
            ? { ...prev, error: asError(reason) } : prev);
        },
      ).finally(() => { busy = false; });
    }, 1000);
    return () => clearInterval(timer);
  }, [opinionId, state.opinionId, state.vote?.status]);

  const start = useCallback(async (): Promise<void> => {
    if (starting.current || state.opinionId !== opinionId || state.loading || state.vote !== null) return;
    const current = generation.current;
    starting.current = true;
    setState((prev) => ({ ...prev, starting: true, error: null }));
    try {
      const { result } = await invoke('opinion:startVote', { opinionId });
      if (generation.current !== current) return;
      setState((prev) => prev.opinionId === opinionId
        ? { ...prev, vote: result, starting: false, error: null } : prev);
    } catch (reason) {
      if (generation.current !== current) return;
      setState((prev) => prev.opinionId === opinionId
        ? { ...prev, starting: false, error: asError(reason) } : prev);
    } finally {
      if (generation.current === current) starting.current = false;
    }
  }, [opinionId, state.loading, state.opinionId, state.vote]);

  const sendResult = useCallback(async (): Promise<void> => {
    if (sending.current || state.opinionId !== opinionId || state.loading ||
      state.vote?.status !== 'completed' || state.vote.resultMessageId !== null) return;
    const current = generation.current;
    sending.current = true;
    setState((prev) => ({ ...prev, sending: true, sendError: null }));
    try {
      const { result } = await invoke('opinion:sendVoteResult', { opinionId });
      if (generation.current !== current) return;
      setState((prev) => prev.opinionId === opinionId
        ? { ...prev, vote: result, sending: false, sendError: null } : prev);
    } catch (reason) {
      if (generation.current !== current) return;
      setState((prev) => prev.opinionId === opinionId
        ? { ...prev, sending: false, sendError: asError(reason) } : prev);
    } finally {
      if (generation.current === current) sending.current = false;
    }
  }, [opinionId, state.loading, state.opinionId, state.vote]);

  return state.opinionId === opinionId
    ? { ...state, start, sendResult }
    : { opinionId, vote: null, loading: true, starting: false, sending: false, error: null, sendError: null, start, sendResult };
}
