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
 * - `refresh()`는 현재 채널 기준 재조회. `loadOlder()`는 stable message ID
 *   cursor로 과거 페이지를 앞에 붙인다.
 *
 * channelId가 바뀌면 화면에서 이전 채널의 rows를 즉시 가리고, 뒤늦은
 * fetch/send/older 응답은 채널 및 요청 sequence로 무시한다.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { useThrowToBoundary } from '../components/ErrorBoundary';
import { invoke } from '../ipc/invoke';
import { USER_AUTHOR_LITERAL, isChatPassMessage, type Message } from '../../shared/message-types';
import type { StreamChannelMessagePayload } from '../../shared/stream-events';

export interface UseChannelMessagesOptions {
  /** 서버쪽 기본값이 우선이지만 원하면 override 가능(spec §6). */
  limit?: number;
  /** Legacy createdAt cursor for callers already using it. */
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
  loadOlder: () => Promise<void>;
  hasOlder: boolean;
  loadingOlder: boolean;
  /** 메시지를 보낸다. 성공 시 반환된 `Message`를 그대로 호출자에 전달한다. */
  send: (input: SendMessageInput) => Promise<Message>;
}

/** Optimistic rows carry `pending-<clientId>` until the server row replaces them. */
const PENDING_MESSAGE_ID_PREFIX = 'pending-';

/** True for an optimistic row not yet stored by main. */
export function isPendingMessageId(id: string): boolean {
  return id.startsWith(PENDING_MESSAGE_ID_PREFIX);
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
  const [dataChannelId, setDataChannelId] = useState(channelId);
  const [loading, setLoading] = useState<boolean>(channelId !== null);
  const [error, setError] = useState<Error | null>(null);
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);

  const mountedRef = useRef(true);
  const fetchedForRef = useRef<string | null | undefined>(undefined);
  const messagesChannelRef = useRef<string | null>(channelId);
  const activeChannelRef = useRef(channelId);
  const fetchSequenceRef = useRef(0);
  const olderSequenceRef = useRef(0);
  const olderPendingRef = useRef(false);
  const messagesRef = useRef(messages);
  useLayoutEffect(() => {
    activeChannelRef.current = channelId;
    messagesRef.current = messages;
  }, [channelId, messages]);
  const throwToBoundary = useThrowToBoundary();

  // opts 값은 렌더마다 새 객체로 올 수 있으므로 primitives만 의존성에 반영.
  const limit = opts?.limit;
  const beforeCreatedAt = opts?.beforeCreatedAt;
  const pageSize = Math.min(200, Math.max(1, Math.floor(limit ?? 50)));

  const runFetch = useCallback(
    async (isInitial: boolean): Promise<void> => {
      if (channelId === null || activeChannelRef.current !== channelId) return;
      const sequence = ++fetchSequenceRef.current;
      if (isInitial) {
        messagesChannelRef.current = channelId;
        setDataChannelId(channelId);
        olderSequenceRef.current += 1;
        olderPendingRef.current = false;
        setMessages((prev) => {
          const pending = prev?.filter((message) =>
            message.channelId === channelId && isPendingMessageId(message.id)) ?? [];
          return pending.length > 0 ? pending : null;
        });
        setHasOlder(false);
        setLoadingOlder(false);
      } else {
        olderSequenceRef.current += 1;
        olderPendingRef.current = false;
        setLoadingOlder(false);
        setHasOlder(false);
      }
      setLoading(true);
      if (!isInitial) setError(null);
      try {
        const request: { channelId: string; limit?: number; beforeCreatedAt?: number } = {
          channelId,
        };
        if (limit !== undefined) request.limit = limit;
        if (beforeCreatedAt !== undefined) request.beforeCreatedAt = beforeCreatedAt;
        const { messages: list } = await invoke('message:list-by-channel', request);
        if (!mountedRef.current || activeChannelRef.current !== channelId ||
          sequence !== fetchSequenceRef.current) return;
        // Repository returns newest-first (DESC) — the hook stores
        // chronological (oldest-first) so `send`'s `[...prev, optimistic]`
        // tail-append, the auto-scroll-to-bottom logic in Thread, and the
        // visual "newest at the bottom" expectation all line up.
        const chronological = [...list].reverse();
        // D8: a refetch may collide with an in-flight optimistic send.
        // We keep any pending row (id starting `pending-`) whose clientId
        // is NOT yet represented in the canonical list — this is the
        // "stream/refetch arrives before invoke resolves" case. If the
        // canonical list already includes a server row carrying the same
        // `meta.clientId`, the pending row is dropped to avoid duplication.
        setMessages((prev) => {
          if (prev === null) return chronological;
          const serverClientIds = new Set<string>();
          for (const m of chronological) {
            const cid = readClientId(m);
            if (cid !== null) serverClientIds.add(cid);
          }
          const stillPending = prev.filter((m) => {
            if (m.channelId !== channelId) return false;
            if (!isPendingMessageId(m.id)) return false;
            const cid = readClientId(m);
            return cid !== null && !serverClientIds.has(cid);
          });
          return [...chronological, ...stillPending];
        });
        setHasOlder(list.length >= pageSize);
        setError(null);
      } catch (reason) {
        if (!mountedRef.current || activeChannelRef.current !== channelId ||
          sequence !== fetchSequenceRef.current) return;
        setError(toError(reason));
        if (isInitial) setMessages(null);
      } finally {
        if (mountedRef.current && activeChannelRef.current === channelId &&
          sequence === fetchSequenceRef.current) setLoading(false);
      }
    },
    [channelId, limit, beforeCreatedAt, pageSize],
  );

  // R12-C2 P1.5 follow-up — stream:channel-message 구독으로 AI 응답이
  // 다른 surface (예: dm-auto-responder) 에서 append 될 때 자동 표시.
  // 이전에는 useChannelMessages 가 invalidation/stream 모두 X — 사용자가
  // 다른 탭 다녀와야 응답 메시지가 보였다 (dogfooding round 1 보고 #2).
  // user 메시지는 send() 의 optimistic + invoke resolve reconcile 에 맡기고
  // 본 stream 에서는 skip — server 가 meta.clientId 를 echo 안 하므로
  // stream payload 만으로는 임시 row 와 매칭할 키가 없어 중복 노출 위험.
  // P4 본격 일반 채널 흐름 land 시 토큰 단위 stream (typing indicator)
  // surface 정의 — 그 전까지는 *완성 메시지 단위* 자동 표시가 minimal.
  useEffect(() => {
    if (channelId === null) return;
    const bridge = typeof window !== 'undefined' ? window.arena : undefined;
    const onStream = bridge?.onStream;
    if (!onStream) return;

    const off = onStream(
      'stream:channel-message',
      (payload: StreamChannelMessagePayload) => {
        if (!mountedRef.current || activeChannelRef.current !== channelId ||
          messagesChannelRef.current !== channelId) return;
        const incoming = payload.message;
        if (incoming.channelId !== channelId) return;
        // A pass row (spec 2026-10-01 F1) has no optimistic copy to reconcile,
        // so it arrives through the stream like an AI message.
        if (incoming.authorKind === 'user' && !isChatPassMessage(incoming)) return;
        setMessages((prev) => {
          if (prev === null) return [incoming];
          if (prev.some((m) => m.id === incoming.id)) return prev;
          return [...prev, incoming];
        });
      },
    );
    return off;
  }, [channelId]);

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
    // The render path masks rows from another channel; the fetch resets the
    // backing state before its first await. StrictMode's second setup reuses
    // the in-flight request rather than issuing a duplicate.
    fetchedForRef.current = channelId;
    void runFetch(true);

    return () => {
      mountedRef.current = false;
    };
  }, [channelId, runFetch]);

  const refresh = useCallback(async (): Promise<void> => {
    await runFetch(false);
  }, [runFetch]);

  const loadOlder = useCallback(async (): Promise<void> => {
    if (channelId === null || activeChannelRef.current !== channelId ||
      messagesChannelRef.current !== channelId || !hasOlder || olderPendingRef.current) return;
    const oldest = messagesRef.current?.find((message) => !isPendingMessageId(message.id));
    if (!oldest) return;
    olderPendingRef.current = true;
    const sequence = ++olderSequenceRef.current;
    setLoadingOlder(true);
    try {
      const { messages: list } = await invoke('message:list-by-channel', {
        channelId, limit: pageSize, beforeMessageId: oldest.id,
      });
      if (!mountedRef.current || activeChannelRef.current !== channelId ||
        messagesChannelRef.current !== channelId || sequence !== olderSequenceRef.current) return;
      const older = [...list].reverse();
      setMessages((prev) => {
        if (prev === null) return older;
        const existingIds = new Set(prev.map((message) => message.id));
        return [...older.filter((message) => !existingIds.has(message.id)), ...prev];
      });
      setHasOlder(list.length >= pageSize);
      setError(null);
    } catch (reason) {
      if (mountedRef.current && activeChannelRef.current === channelId &&
        sequence === olderSequenceRef.current) setError(toError(reason));
    } finally {
      if (activeChannelRef.current === channelId && sequence === olderSequenceRef.current) {
        olderPendingRef.current = false;
        if (mountedRef.current) setLoadingOlder(false);
      }
    }
  }, [channelId, hasOlder, pageSize]);

  const send = useCallback(
    async (input: SendMessageInput): Promise<Message> => {
      if (channelId === null) {
        throw new Error('cannot send: no active channel');
      }
      const clientId = makeClientId();
      const tempId = `${PENDING_MESSAGE_ID_PREFIX}${clientId}`;
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
      if (activeChannelRef.current === channelId) {
        setMessages((prev) => (prev === null || messagesChannelRef.current !== channelId
          ? [optimistic] : [...prev, optimistic]));
      }

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
        if (!mountedRef.current || activeChannelRef.current !== channelId) return message;

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
        if (mountedRef.current && activeChannelRef.current === channelId) {
          setMessages((prev) =>
            prev === null ? prev : prev.filter((m) => m.id !== tempId),
          );
          setError(toError(reason));
        }
        if (activeChannelRef.current === channelId) throwToBoundary(reason);
        throw reason;
      }
    },
    [channelId, throwToBoundary],
  );

  // channelId=null은 idle. state에 이전 채널의 messages가 남아 있어도
  // 소비자에게는 비우고 전달한다(stale-flash 방지).
  if (channelId === null) {
    return { messages: null, loading: false, error: null, refresh, loadOlder,
      hasOlder: false, loadingOlder: false, send };
  }
  const current = dataChannelId === channelId;
  return { messages: current ? messages : null, loading: current ? loading : true,
    error: current ? error : null, refresh, loadOlder,
    hasOlder: current ? hasOlder : false, loadingOlder: current ? loadingOlder : false,
    send };
}
