/**
 * Main-process locale state — 결재 5번 (C, 2026-05-19) 다국어 매트릭스 도입.
 *
 * 배경: R9-Task11 (notification-labels) 이 main-process 자체 locale state +
 * dictionary 패턴을 도입. 그러나 다른 main 모듈 (planning-design-check
 * archive markdown + LLM prompt) 은 한국어 inline 만 사용 — 영어 사용자가
 * archive 파일을 열거나 LLM 이 영어 응답을 내야 할 때 단일 locale 한정.
 *
 * 본 모듈은 *모든* main-process dictionary 가 공유하는 단일 locale source.
 * `notification:set-locale` IPC handler 가 setMainLocale 도 같이 호출하면
 * notification + planning-design-check + 향후 신규 영역 모두 한 번에 갱신.
 *
 * Why not import i18next: renderer 의 i18next instance 를 main 으로 끌어
 * 오면 SSR-style hydration + 전체 locale plumbing 까지 main 에 묶임. R9 의
 * notification-labels 가 이미 별 dictionary 채택 (코멘트 참조) — 본 모듈은
 * 그 결정을 process-wide 로 확장.
 */

export type MainLocale = 'ko' | 'en';

const SUPPORTED_LOCALES: ReadonlySet<MainLocale> = new Set(['ko', 'en']);
const DEFAULT_LOCALE: MainLocale = 'ko';

let currentLocale: MainLocale = DEFAULT_LOCALE;

/** Returns the locale currently used by every main-process dictionary lookup. */
export function getMainLocale(): MainLocale {
  return currentLocale;
}

/**
 * Switches the active main-process locale. Unknown locales fall through to
 * the default silently — same invariant as `notification-labels.ts` so a
 * bad settings value never crashes a side-effect.
 *
 * Caller (typically `notification:set-locale` IPC handler) is responsible
 * for keeping notification-labels' locale in sync — both modules currently
 * hold their own state to avoid a circular import; the IPC handler updates
 * both setters in one call.
 */
export function setMainLocale(locale: MainLocale): void {
  if (SUPPORTED_LOCALES.has(locale)) {
    currentLocale = locale;
  } else {
    currentLocale = DEFAULT_LOCALE;
  }
}

/** Test-only helper to reset the locale between suites. */
export function __resetMainLocaleForTests(): void {
  currentLocale = DEFAULT_LOCALE;
}
