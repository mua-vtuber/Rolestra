/**
 * `[##본문]` 파서 — R12-C2 P4 T20 일반 채널 의견 카드 추출.
 *
 * 일반 채널 (`channel.kind === 'system_general'` 또는
 * `channel.kind === 'user' && channel.role === 'general'`) 메시지 본문 안에
 * `[##...]` 으로 감싼 segment 만 의견 카드로 등록한다. 그 외 텍스트는
 * 일반 잡담 — 자동 등록 X.
 *
 * spec docs/specs/2026-05-01-rolestra-channel-roles-design.md
 *  - §4 일반 부서 새 정의 — `[##본문]` 강제, 한 메시지 안 여러 개 가능
 *  - §11.13 SsmBox general row — kind='self-raised' / 'user-raised' 카드 list
 *
 * 룰 (단순 / 결정적):
 *   1. 패턴 = `[##` 시작, 첫 `]` 종결 (중첩 disallow — 첫 닫힘 우선).
 *   2. 본문 trim. trim 결과 빈 문자열이면 skip (의미 없는 빈 카드 차단).
 *   3. 닫히지 않은 `[##` (closing `]` 없음) 은 skip — 사용자가 입력 도중
 *      엔터 친 경우 / 잘못된 마크업 모두 노이즈로 간주.
 *   4. 한 메시지 안 N 회 등장 가능 — 등장 순서 유지해 배열 반환.
 *   5. `]` 가 본문 안에 들어가야 하는 경우 escape 룰 X (간단함 우선) —
 *      필요 시 사용자가 두 segment 로 나눠 작성.
 *
 * 본 파서는 *순수 함수* — IO / DB / IPC 의존 X. caller (main 측 general
 * channel flow / OpinionService) 가 매칭 결과를 opinion row 로 변환.
 */

/** 단일 `[##본문]` 매칭 결과. */
export interface DoubleHashMatch {
  /** trim 한 본문 (의견 content). 빈 문자열은 본 배열에 등장 X. */
  body: string;
  /** 원본 텍스트 안 `[##` 의 시작 인덱스 (UTF-16 단위). */
  start: number;
  /** 원본 텍스트 안 `]` 의 종료 인덱스 (exclusive, UTF-16 단위). */
  end: number;
}

/** `[##` 시작 + `]` 가 아닌 문자 0+ + `]` — 전역 매칭. */
const DOUBLE_HASH_PATTERN = /\[##([^\]]*)\]/g;

/**
 * 메시지 본문에서 `[##...]` segment 를 모두 추출한다.
 *
 * @param text 메시지 content (Message.content). `null` / `undefined` 는
 *             caller 가 차단 — 본 함수는 string 만 받는다.
 * @returns 매칭 0+ 개. 빈 배열 = 등록할 의견 카드 없음 (일반 잡담).
 */
export function parseDoubleHash(text: string): DoubleHashMatch[] {
  const matches: DoubleHashMatch[] = [];
  for (const m of text.matchAll(DOUBLE_HASH_PATTERN)) {
    const rawBody = m[1];
    const start = m.index;
    const rawMatch = m[0];
    if (
      rawBody === undefined ||
      start === undefined ||
      rawMatch === undefined
    ) {
      continue;
    }
    const body = rawBody.trim();
    if (body.length === 0) continue;
    matches.push({
      body,
      start,
      end: start + rawMatch.length,
    });
  }
  return matches;
}
