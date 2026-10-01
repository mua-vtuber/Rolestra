/**
 * ui-string-hardcoded — t() 우회 + 평문 한글 검출 (renderer 한정).
 *
 * 헌법: Consistency.
 * 절대 위반 금지 규칙 #5 (하드코딩 UI 문자열 금지) 의 코드 표현.
 *
 * Phase 1 휴리스틱: renderer .tsx / .ts 안 *Hangul* 등장 라인 — 단,
 *  - i18n locale JSON / dictionary / *-labels.ts / theme/ 는 allowlist
 *  - 주석 라인 skip
 *  - import 경로 / 변수명 등은 그래도 hit (false positive 정리 phase 1 목적)
 */
import type { Inspector, Hit, ScannedFile } from './types';
import { iterLines } from './walker';

const HANGUL = /[가-힣]/;

const ALLOWLIST_PREFIXES: readonly string[] = [
  'src/renderer/i18n/',
  'src/renderer/theme/',
];

const ALLOWLIST_SUFFIXES: readonly string[] = [
  '-dictionary.ts',
  '-labels.ts',
  '.dictionary.ts',
  '.labels.ts',
];

function isAllowed(rel: string): boolean {
  if (ALLOWLIST_PREFIXES.some((p) => rel.startsWith(p))) return true;
  if (ALLOWLIST_SUFFIXES.some((s) => rel.endsWith(s))) return true;
  return false;
}

const inspector: Inspector = {
  category: 'ui-string-hardcoded',
  constitution: 'Consistency',
  scope: 'non-safety',
  description:
    'renderer .tsx 안 평문 한글 — t() / i18n dictionary 경유 필요 (false positive 정리 phase 1).',
  perFile(file: ScannedFile): Hit[] {
    if (file.isTest) return [];
    if (!file.isRenderer) return [];
    if (isAllowed(file.rel)) return [];

    const hits: Hit[] = [];
    for (const { line, text } of iterLines(file.source)) {
      if (!HANGUL.test(text)) continue;
      const trimmed = text.trim();
      // 주석 / JSDoc 은 skip
      if (
        trimmed.startsWith('//') ||
        trimmed.startsWith('/*') ||
        trimmed.startsWith('*')
      )
        continue;
      hits.push({
        category: 'ui-string-hardcoded',
        constitution: 'Consistency',
        file: file.rel,
        line,
        severity: 'report',
        message: '평문 한글 — t() 함수 경유 권장.',
        excerpt: trimmed.slice(0, 100),
      });
    }
    return hits;
  },
};

export default inspector;
