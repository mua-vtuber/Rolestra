/**
 * i18n 도메인 네임스페이스 상수.
 *
 * spec §7.11 에 정의된 15 도메인 top-level 키. 각 도메인은 현재 `_placeholder`
 * 리프 하나만 가지고 있어 i18next-parser 가 객체 자체를 제거하지 않도록
 * 유지한다(i18next-parser.config.js 의 keepRemoved regex 로 보호).
 *
 * R4 이후 각 Phase 에서 해당 도메인 아래 실제 UI 문자열을 채워 넣는다.
 */
export const I18N_NAMESPACES = [
  'dashboard',
  'messenger',
  'channel',
  'member',
  'project',
  'approval',
  'queue',
  'notification',
  'settings',
  'onboarding',
  'common',
  'error',
  'shell',
  'theme',
  'app',
] as const;

export type I18nNamespace = (typeof I18N_NAMESPACES)[number];
