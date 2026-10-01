/**
 * 메시지 검색 도메인 타입 — R10-Task1 (MessageSearchView + message:search IPC).
 *
 * R2 migration 005 가 이미 `messages_fts` virtual table + 3 trigger 를 land
 * 했고 R5 의 `MessageRepository.searchInChannel/searchInProject` 도 구현되어
 * 있다. 입력 타입 {@link MessageSearchInput} 과 raw 결과 {@link MessageSearchResult}
 * 는 각각 `ipc-types.ts` 와 `message-types.ts` 에 이미 있다.
 *
 * 이 파일은 R10 에서 추가로 필요한 (a) 하이라이팅된 snippet 를 포함한
 * hit row, (b) UI 쪽에서 참조하는 상수(결과 limit / snippet 길이) 만 모은
 * 얇은 aggregator 다. renderer 쪽은 이 파일을 import 해서 사용한다.
 */
import type { MessageSearchResult } from './message-types';

/**
 * FTS5 snippet 및 채널/프로젝트 메타를 포함한 검색 결과 row.
 *
 * R5 의 {@link MessageSearchResult} 가 Message + rank 만 담는다면, UI 용
 * {@link MessageSearchHit} 는 보낸 채널/프로젝트 이름과 FTS5 `snippet()` 가
 * 생성한 `<mark>` 태그 섞인 짧은 조각까지 함께 실어 renderer 가 추가 조회
 * 없이 한 번에 렌더할 수 있게 한다.
 */
export interface MessageSearchHit extends MessageSearchResult {
  channelName: string;
  /** 채널이 project 에 속하면 그 project 이름, DM 이면 null. */
  projectName: string | null;
  /** FTS5 `snippet()` 출력 — `<mark>` HTML 태그가 섞인 원문 조각. */
  snippet: string;
}

/** `message:search` response (최종 형태). */
export interface MessageSearchResponse {
  hits: MessageSearchHit[];
}

/**
 * 입력의 `limit` 생략 시 서버가 적용하는 기본값. SSM 이 아닌 단순 검색
 * 이므로 상대적으로 후하게 잡는다(최대 500).
 */
export const DEFAULT_MESSAGE_SEARCH_LIMIT = 50;

/** FTS5 snippet 에 넘길 앞/뒤 컨텍스트 토큰 개수(각각). */
export const MESSAGE_SEARCH_SNIPPET_CONTEXT = 8;
