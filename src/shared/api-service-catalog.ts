/**
 * API 서비스 카탈로그 — F1 (spec `docs/specs/2026-09-29-ai-setup-and-character.md`
 * §F1-2).
 *
 * 공식 API 서비스(Claude/ChatGPT·Codex/Gemini)의 식별자 + 공식 연결 주소를
 * 한 곳에 둔다. renderer 는 main 을 import 할 수 없으므로("renderer → main
 * 금지" — 프로젝트 CLAUDE.md 절대 위반 금지 규칙), 두 프로세스가 같은 주소
 * 상수를 각자 재정의하면 언젠가 어긋난다. 이 모듈이 그 단일 출처다:
 *   - `src/main/providers/model-registry.ts` 가 여기서 주소를 가져와 정적
 *     카탈로그 키 + 실주소 fetch 에 쓴다.
 *   - renderer 의 `ProviderConnect.tsx` 가 여기서 서비스 목록(선택지 4개:
 *     공식 3개 + '기타')을 가져와 드롭다운을 만들고, 고른 서비스의 주소를
 *     자동으로 채운다.
 *
 * 서비스 기본 표시 이름은 여기 두지 않는다 — 사용자가 보는 문자열은 전부
 * i18n 을 거쳐야 한다는 프로젝트 규칙(§코딩-규칙, "하드코딩 UI 문자열
 * 금지") 때문에, 이름은 `providerConnect.service.<id>` 키로 renderer 가
 * 직접 번역한다. 이 모듈은 식별자 + 주소만 갖는다.
 */

/** 공식 지원 API 서비스 식별자. `'other'` 는 OpenAI 호환 주소 직접 입력. */
export type ApiServiceId = 'anthropic' | 'openai' | 'google';

/** 전체 서비스 선택지(공식 3개 + 기타). 드롭다운/라디오 순서가 이 배열 순서. */
export type ApiServiceChoice = ApiServiceId | 'other';

export const API_SERVICE_CHOICES: readonly ApiServiceChoice[] = [
  'anthropic',
  'openai',
  'google',
  'other',
] as const;

/**
 * 공식 서비스의 연결 주소. `'other'` 는 사용자가 직접 입력하므로 여기 없다.
 *
 * 값 자체(도메인/버전 경로)는 기존 `model-registry.ts` 의
 * `OPENAI_API_ENDPOINT` / `ANTHROPIC_API_ENDPOINT` / `GOOGLE_GENAI_API_ENDPOINT`
 * 리터럴을 그대로 옮긴 것 — 동작 변경 없음, 정의 위치만 이동.
 */
export const API_SERVICE_ENDPOINTS: Record<ApiServiceId, string> = {
  anthropic: 'https://api.anthropic.com/v1',
  openai: 'https://api.openai.com/v1',
  google: 'https://generativelanguage.googleapis.com/v1beta',
};

/** `API_SERVICE_ENDPOINTS` 의 키 집합 — 역방향 조회(주소 → 서비스 id)에 사용. */
const ENDPOINT_TO_SERVICE: ReadonlyMap<string, ApiServiceId> = new Map(
  (Object.entries(API_SERVICE_ENDPOINTS) as Array<[ApiServiceId, string]>).map(
    ([id, endpoint]) => [endpoint, id],
  ),
);

/** 주소가 공식 서비스 카탈로그의 주소와 정확히 일치하면 그 서비스 id, 아니면 `null`. */
export function serviceIdForEndpoint(endpoint: string): ApiServiceId | null {
  return ENDPOINT_TO_SERVICE.get(endpoint) ?? null;
}
