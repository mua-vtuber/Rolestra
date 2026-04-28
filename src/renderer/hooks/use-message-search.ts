/**
 * `useMessageSearch` — FTS5 기반 메시지 검색 hook (R10-Task2).
 *
 * 동작:
 * - `setQuery(q)` / `setScope(s)` 로 입력 변경 → `DEBOUNCE_MS` 동안 정숙
 *   → 마지막 값으로 `message:search` IPC 호출.
 * - `loading` 은 네트워크 왕복 중에만 true. 빈 쿼리는 요청을 보내지 않고
 *   결과를 즉시 `[]` 로 clear.
 * - 오류는 `error` 에만 저장, `hits` 는 직전 값을 유지(검색 중간 상태
 *   깜빡임 방지).
 * - React 19 strict-mode 에서 effect 두 번 실행되도 cancel token 으로
 *   out-of-order 응답을 드롭한다.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { invoke } from '../ipc/invoke';
import type { MessageSearchInput } from '../../shared/ipc-types';
import type { MessageSearchHit } from '../../shared/message-search-types';
import { DEFAULT_MESSAGE_SEARCH_LIMIT } from '../../shared/message-search-types';

export type MessageSearchScope = MessageSearchInput['scope'] | 'global';

export interface UseMessageSearchResult {
  query: string;
  setQuery: (q: string) => void;
  scope: MessageSearchScope;
  setScope: (s: MessageSearchScope) => void;
  hits: MessageSearchHit[];
  loading: boolean;
  error: Error | null;
  clear: () => void;
}

/** 입력 디바운스 — 사용자가 타이핑 멈춘 뒤 IPC 를 쏜다. */
const DEBOUNCE_MS = 200;

function toError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason));
}

/** Detects FTS5 syntax characters that we must not corrupt with prefix `*`. */
const FTS5_SYNTAX_PATTERN = /["()*:^-]|\s+(?:AND|OR|NOT|NEAR)\s+/i;

/**
 * Convert a user-facing query into an FTS5 MATCH expression.
 *
 * The repository forwards the query verbatim to SQLite's FTS5, whose
 * tokenizer (unicode61) splits on whitespace + punctuation but does NOT
 * tokenize within Korean syllable runs — `'안녕하세요 검색'` becomes
 * `['안녕하세요', '검색']`. A naive `'안녕'` query therefore returns
 * zero rows even though the user typed a clear prefix.
 *
 * To match the UX of "find as you type", we append the FTS5 prefix
 * operator `*` to each whitespace-separated token when the input is a
 * simple expression (no quotes, no boolean operators, no existing
 * `*`/`:`/parentheses). Anything more elaborate is passed verbatim so
 * power users can still drop their own FTS5 syntax in.
 */
function toFtsQuery(input: string): string {
  if (FTS5_SYNTAX_PATTERN.test(input)) {
    return input;
  }
  // Split into whitespace-separated tokens; append `*` to each so a
  // multi-word search like "릴리스 계획" still finds rows that contain
  // longer-token prefixes for both halves.
  return input
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .map((part) => `${part}*`)
    .join(' ');
}

export function useMessageSearch(
  initialScope: MessageSearchScope = 'global',
): UseMessageSearchResult {
  const [query, setQuery] = useState<string>('');
  const [scope, setScope] = useState<MessageSearchScope>(initialScope);
  const [hits, setHits] = useState<MessageSearchHit[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);

  // Monotonic token so older responses never overwrite newer state.
  const tokenRef = useRef(0);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      // 입력 비면 즉시 clear + 요청 스킵.
      tokenRef.current += 1;
      setHits([]);
      setLoading(false);
      setError(null);
      return;
    }

    const myToken = ++tokenRef.current;
    const timer = setTimeout(() => {
      void (async () => {
        setLoading(true);
        try {
          const ipcScope: MessageSearchInput['scope'] =
            scope === 'global'
              ? { kind: 'project', projectId: '' } // sentinel — replaced below
              : scope;
          // `scope === 'global'` 은 IPC discriminated union 에 정의되어 있지 않다.
          // 전체 검색은 channelId/projectId 를 동시에 생략해야 하는데 현재
          // IPC 스키마는 둘 중 하나 필수. Task 2 범위에서는 global 을 "현재
          // 채널/프로젝트 미지정" 대신 사용자가 project/channel 선택 UI 에서
          // 명시적으로 고르는 것으로 설계한다. global 을 고르면 여기서 throw.
          if (scope === 'global') {
            throw new Error('global scope requires channel or project');
          }

          const resp = await invoke('message:search', {
            query: toFtsQuery(trimmed),
            scope: ipcScope,
            limit: DEFAULT_MESSAGE_SEARCH_LIMIT,
          });
          if (myToken !== tokenRef.current) return;
          setHits(resp.hits);
          setError(null);
        } catch (reason) {
          if (myToken !== tokenRef.current) return;
          setError(toError(reason));
          // 이전 hits 는 유지 — 에러 시 깜빡임 방지.
        } finally {
          if (myToken === tokenRef.current) {
            setLoading(false);
          }
        }
      })();
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [query, scope]);

  const clear = useCallback((): void => {
    tokenRef.current += 1;
    setQuery('');
    setHits([]);
    setError(null);
    setLoading(false);
  }, []);

  return {
    query,
    setQuery,
    scope,
    setScope,
    hits,
    loading,
    error,
    clear,
  };
}
