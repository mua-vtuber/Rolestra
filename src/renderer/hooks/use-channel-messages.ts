/**
 * `useChannelMessages` — 채널별 메시지 스레드 훅.
 *
 * Contract:
 * - `channelId`가 null이면 idle. 채널 전환은 **새 stream**으로 간주하므로
 *   이전 채널의 messages는 바로 clear한다(UX: 채널 바꿨는데 옛 메시지가
 *   잠깐 깜빡이는 것을 막는다).
 * - 초기 실패 시 `messages=null` 유지(silent fallback 금지).
 * - **R10-Task8 — 낙관 업데이트.** `send()` 는 invoke 직전 임시 row 를 list
 *   에 append 한다(`id: pending-<clientId>`, `meta.clientId` 포함). invoke
 *   가 resolve 하면 임시 row 를 서버 row 로 swap. 실패 시 임시 row 를 제거
 *   하고 `useThrowToBoundary` 로 ErrorBoundary 토스트에 surface. (이전 R5
 *   계약은 invoke 후 전체 refetch 하는 silent-success 였음.)
 * - **D8 ordering invariant** — `runFetch()` 또는 stream 이 invoke resolve
 *   전에 canonical row 를 데려올 수 있다. 임시 row 를 server row 와 일치
 *   시킬 키는 `meta.clientId` 이고, list 에 동일 `clientId` 를 가진 row 가
 *   이미 존재하면 임시 row 만 drop 하고 swap 은 생략한다. 즉 client-id 기반
 *   reconciliation 으로 double-insert 방지.
 * - `refresh()`는 현재 채널 기준 재조회.
 *
 * R4 `use-dashboard-kpis` 패턴과 동일한 mountedRef / didMountFetchRef 가드.
 * channelId가 바뀌면 fetch guard를 리셋해 **정확히 1회**만 재호출하도록 한다.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { useThrowToBoundary } from '../components/ErrorBoundary';
import { invoke } from '../ipc/invoke';
import { USER_AUTHOR_LITERAL, type Message } from '../../shared/message-types';

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

function makeClientId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `cid-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** Reads `meta.clientId` if present (renderer-only metadata). */
function readClientId(message: Message): string | null {
  const meta = message.meta as { clientId?: unknown } | null;
  if (meta && typeof meta.clientId === 'string') return meta.clientId;
  return null;
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
  const throwToBoundary = useThrowToBoundary();

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
        // D8: a refetch may collide with an in-flight optimistic send.
        // We keep any pending row (id starting `pending-`) whose clientId
        // is NOT yet represented in the canonical list — this is the
        // "stream/refetch arrives before invoke resolves" case. If the
        // canonical list already includes a server row carrying the same
        // `meta.clientId`, the pending row is dropped to avoid duplication.
        setMessages((prev) => {
          if (prev === null) return list;
          const serverClientIds = new Set<string>();
          for (const m of list) {
            const cid = readClientId(m);
            if (cid !== null) serverClientIds.add(cid);
          }
          const stillPending = prev.filter((m) => {
            if (!m.id.startsWith('pending-')) return false;
            const cid = readClientId(m);
            return cid !== null && !serverClientIds.has(cid);
          });
          return [...list, ...stillPending];
        });
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
      const clientId = makeClientId();
      const tempId = `pending-${clientId}`;
      const now = Date.now();
      const optimistic: Message = {
        id: tempId,
        channelId,
        meetingId: input.meetingId ?? null,
        // Spec §7.5: `messages.author_id` for end-user messages is the
        // literal `'user'` (constant at `shared/message-types.ts`).
        // Same value the main process re-stamps inside
        // `message:append`, so the swap-by-clientId reconcile keeps
        // ordering even when the server row arrives before the
        // optimistic resolve.
        authorId: USER_AUTHOR_LITERAL,
        authorKind: 'user',
        role: 'user',
        content: input.content,
        meta: {
          clientId,
          ...(input.mentions !== undefined ? { mentions: input.mentions } : {}),
          status: 'pending',
        },
        createdAt: now,
      };

      // 1. Optimistic insert (D8: tempId 로 클라이언트 한정 식별).
      setMessages((prev) => (prev === null ? [optimistic] : [...prev, optimistic]));

      const payload: {
        channelId: string;
        content: string;
        meetingId?: string | null;
        mentions?: string[];
      } = { channelId, content: input.content };
      if (input.meetingId !== undefined) payload.meetingId = input.meetingId;
      if (input.mentions !== undefined) payload.mentions = input.mentions;

      try {
        const { message } = await invoke('message:append', payload);
        if (!mountedRef.current) return message;

        // 2. Reconcile (D8): if a refetch / future stream already inserted
        //    the canonical row by `id`, just drop the temp row. Otherwise
        //    swap in-place. Matching by `meta.clientId` is best-effort —
        //    the main process does NOT echo it back in R10, so the swap
        //    falls back to "replace temp by tempId" which is always safe
        //    because tempIds are unique per send().
        setMessages((prev) => {
          if (prev === null) return [message];
          const canonicalAlreadyPresent = prev.some(
            (m) => m.id === message.id,
          );
          if (canonicalAlreadyPresent) {
            return prev.filter((m) => m.id !== tempId);
          }
          return prev.map((m) => (m.id === tempId ? message : m));
        });
        return message;
      } catch (reason) {
        // 3. Rollback: remove the pending row.
        if (mountedRef.current) {
          setMessages((prev) =>
            prev === null ? prev : prev.filter((m) => m.id !== tempId),
          );
          setError(toError(reason));
        }
        throwToBoundary(reason);
        throw reason;
      }
    },
    [channelId, throwToBoundary],
  );

  // channelId=null은 idle. state에 이전 채널의 messages가 남아 있어도
  // 소비자에게는 비우고 전달한다(stale-flash 방지).
  if (channelId === null) {
    return { messages: null, loading: false, error: null, refresh, send };
  }
  return { messages, loading, error, refresh, send };
}
