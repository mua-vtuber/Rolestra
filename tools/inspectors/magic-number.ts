/**
 * magic-number — 코드 안 매직넘버 검출 (보수적 phase 1 휴리스틱).
 *
 * 헌법: SSoT.
 *
 * Phase 1 휴리스틱: 다음 *모두* 만족하는 라인의 숫자 literal 만 hit:
 *  - literal >= 1000 (작은 수는 false positive 너무 많음)
 *  - 라인이 `const X = N` / `let X = N` / `enum` 안 / 객체 property `X: N`
 *    바인딩 형식이 *아님*
 *  - 라인이 SQL 문자열 / version 비교 / index 산술 등 명백한 안전 패턴이
 *    *아님*
 *
 * Allowlist 영역: src/main/database/ migrations/ + src/shared/timeouts.ts
 * (이미 SSoT 모음).
 */
import type { Inspector, Hit, ScannedFile } from './types';
import { iterLines } from './walker';

const NUMBER_LITERAL = /\b(\d{4,})\b/g;
const CONST_BINDING =
  /^\s*(?:export\s+)?(?:const|let|var|readonly|static)\s+\w+(?:\s*:[^=]+)?\s*=/;
const PROPERTY_BINDING = /^\s*\w+\s*:\s*\d/;
const ENUM_LINE = /^\s*\w+\s*=\s*\d+,?\s*$/;

const ALLOWLIST_PREFIXES: readonly string[] = [
  'src/shared/timeouts',
  'src/main/database/migrations/',
  'tools/cli-smoke/',
];

function isAllowed(rel: string): boolean {
  return ALLOWLIST_PREFIXES.some((p) => rel.startsWith(p));
}

const inspector: Inspector = {
  category: 'magic-number',
  constitution: 'SSoT',
  scope: 'non-safety',
  description:
    '숫자 literal >= 1000 이 const / property 바인딩 밖 등장 — SSoT 위반 의심.',
  perFile(file: ScannedFile): Hit[] {
    if (file.isTest) return [];
    if (!file.rel.startsWith('src/') && !file.rel.startsWith('tools/'))
      return [];
    if (isAllowed(file.rel)) return [];

    const hits: Hit[] = [];
    for (const { line, text } of iterLines(file.source)) {
      const trimmed = text.trim();
      if (
        trimmed.startsWith('//') ||
        trimmed.startsWith('*') ||
        trimmed.startsWith('/*')
      )
        continue;
      if (CONST_BINDING.test(text)) continue;
      if (PROPERTY_BINDING.test(text)) continue;
      if (ENUM_LINE.test(text)) continue;

      NUMBER_LITERAL.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = NUMBER_LITERAL.exec(text)) !== null) {
        const num = Number(match[1]);
        if (num < 1000) continue;
        hits.push({
          category: 'magic-number',
          constitution: 'SSoT',
          file: file.rel,
          line,
          severity: 'report',
          message: `매직넘버 ${num} — 명명 상수로 추출 권장.`,
          excerpt: trimmed.slice(0, 100),
        });
        break; // 한 라인 1 hit 로 제한 (noise 방지)
      }
    }
    return hits;
  },
};

export default inspector;
