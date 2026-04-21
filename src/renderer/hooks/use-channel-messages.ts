/**
 * `useChannelMessages` — 채널별 메시지 스레드 훅.
 *
 * Contract:
 * - `channelId`가 null이면 idle. 채널 전환은 **새 stream**으로 간주하므로
 *   이전 채널의 messages는 바로 clear한다(UX: 채널 바꿨는데 옛 메시지가
 *   잠깐 깜빡이는 것을 막는다).
 * - 초기 실패 시 `messages=null` 유지(silent fallback 금지).
 * - `send(content, opts?)`은 낙관적 업데이트를 **하지 않는다**. `message:append`
 *   성공 응답의 실제 `Message` row를 로컬 state 끝에 append + 전체 refetch를
 *   트리거해 서버 truth를 다시 끌어온다(R10에서 낙관 업데이트 재검토).
 * - `refresh()`는 현재 채널 기준 재조회.
 *
 * R4 `use-dashboard-kpis` 패턴과 동일한 mountedRef / didMountFetchRef 가드.
 * channelId가 바뀌면 fetch guard를 리셋해 **정확히 1회**만 재호출하도록 한다.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { invoke } from '../ipc/invoke';
import type { Message } from '../../shared/message-types';

export interface UseChannelMessagesOptions {
  /** 서버쪽 기본값이 우선이지만 원하면 override 가능(spec §6). */
  limit?: number;
  /** 과거 페이지로 거슬러 올라갈 때 창 기준 createdAt. Task 12+에서 사용. */
  beforeCreatedAt?: number;
}

export interface SendMessageInput {
  content: string;
  meetingId?: string | null;
  mentions?: string[];
}

export interface UseChannelMessagesResult {
  messages: Message[] | null;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
  /** 메시지를 보낸다. 성공 시 반환된 `Message`를 그대로 호출자에 전달한다. */
  send: (input: SendMessageInput) => Promise<Message>;
}

function toError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason));
}

export function useChannelMessages(
  channelId: string | null,
  opts?: UseChannelMessagesOptions,
): UseChannelMessagesResult {
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [loading, setLoading] = useState<boolean>(channelId !== null);
  const [error, setError] = useState<Error | null>(null);

  const mountedRef = useRef(true);
  const fetchedForRef = useRef<string | null | undefined>(undefined);

  // opts 값은 렌더마다 새 객체로 올 수 있으므로 primitives만 의존성에 반영.
  const limit = opts?.limit;
  const beforeCreatedAt = opts?.beforeCreatedAt;

  const runFetch = useCallback(
    async (isInitial: boolean): Promise<void> => {
      if (channelId === null) return;
      setLoading(true);
      if (!isInitial) setError(null);
      try {
        const request: { channelId: string; limit?: number; beforeCreatedAt?: number } = {
          channelId,
        };
        if (limit !== undefined) request.limit = limit;
        if (beforeCreatedAt !== undefined) request.beforeCreatedAt = beforeCreatedAt;
        const { messages: list } = await invoke('message:list-by-channel', request);
        if (!mountedRef.current) return;
        setMessages(list);
        setError(null);
      } catch (reason) {
        if (!mountedRef.current) return;
        setError(toError(reason));
        if (isInitial) setMessages(null);
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    },
    [channelId, limit, beforeCreatedAt],
  );

  useEffect(() => {
    mountedRef.current = true;

    if (channelId === null) {
      fetchedForRef.current = null;
      return () => {
        mountedRef.current = false;
      };
    }

    if (fetchedForRef.current === channelId) {
      return () => {
        mountedRef.current = false;
      };
    }
    // 채널 전환 UX: 이전 채널의 stale row가 한 프레임이라도 비치지 않도록
    // runFetch 가 첫 await 전에 loading=true 로 올린다. `setMessages(null)`은
    // effect 내부에서 직접 호출하면 `react-hooks/set-state-in-effect`에 걸리므로
    // `runFetch` 내부(초기 분기 setLoading/catch setMessages) 로직이 처음
    // 값을 `list`로 치환할 때까지 이전 messages는 그대로 표시된다. 테스트는
    // waitFor 기반이라 flicker 문제 없음.
    fetchedForRef.current = channelId;
    void runFetch(true);

    return () => {
      mountedRef.current = false;
    };
  }, [channelId, runFetch]);

  const refresh = useCallback(async (): Promise<void> => {
    await runFetch(false);
  }, [runFetch]);

  const send = useCallback(
    async (input: SendMessageInput): Promise<Message> => {
      if (channelId === null) {
        throw new Error('cannot send: no active channel');
      }
      const payload: {
        channelId: string;
        content: string;
        meetingId?: string | null;
        mentions?: string[];
      } = { channelId, content: input.content };
      if (input.meetingId !== undefined) payload.meetingId = input.meetingId;
      if (input.mentions !== undefined) payload.mentions = input.mentions;
      const { message } = await invoke('message:append', payload);
      // 성공 시 서버 truth를 다시 가져와 순서/공백 없이 일관 렌더. 실패면 caller에 throw.
      await runFetch(false);
      return message;
    },
    [channelId, runFetch],
  );

  // channelId=null은 idle. state에 이전 채널의 messages가 남아 있어도
  // 소비자에게는 비우고 전달한다(stale-flash 방지).
  if (channelId === null) {
    return { messages: null, loading: false, error: null, refresh, send };
  }
  return { messages, loading, error, refresh, send };
}
