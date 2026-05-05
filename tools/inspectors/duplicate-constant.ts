/**
 * duplicate-constant — 같은 문자열 literal 이 3+ 파일 등장 검출.
 *
 * 헌법: SSoT.
 *
 * Phase 1 휴리스틱: literal 길이 >= 12 자 (짧은 건 noise) + 3+ 파일 등장.
 * 본문 안 일반 문자열이 SSoT 위반인지 / dictionary 가 의도적 중복인지 분간
 * 어려워 비안전 영역으로 분류.
 *
 * Allowlist 영역: i18n locale JSON / dictionary / -labels.ts / migration /
 * test 는 제외.
 */
import type { Inspector, Hit, ScannedFile } from './types';
import { iterLines } from './walker';

const STRING_LITERAL = /(['"`])((?:[^\\\n]|\\.){12,200}?)\1/g;

const SKIP_PREFIXES: readonly string[] = [
  'src/renderer/i18n/',
  'src/main/database/migrations/',
];
const SKIP_SUFFIXES: readonly string[] = [
  '-dictionary.ts',
  '-labels.ts',
  '.dictionary.ts',
  '.labels.ts',
];

function isSkipped(rel: string): boolean {
  if (SKIP_PREFIXES.some((p) => rel.startsWith(p))) return true;
  if (SKIP_SUFFIXES.some((s) => rel.endsWith(s))) return true;
  return false;
}

interface Occurrence {
  file: string;
  line: number;
}

const inspector: Inspector = {
  category: 'duplicate-constant',
  constitution: 'SSoT',
  scope: 'non-safety',
  description:
    '문자열 literal (12+ 자) 이 3+ 파일에 중복 등장 — SSoT 위반 의심.',
  perProject(files: readonly ScannedFile[]): Hit[] {
    const occurrences = new Map<string, Occurrence[]>();

    for (const file of files) {
      if (file.isTest) continue;
      if (isSkipped(file.rel)) continue;
      for (const { line, text } of iterLines(file.source)) {
        const trimmed = text.trim();
        if (
          trimmed.startsWith('//') ||
          trimmed.startsWith('*') ||
          trimmed.startsWith('/*')
        )
          continue;
        STRING_LITERAL.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = STRING_LITERAL.exec(text)) !== null) {
          const value = match[2];
          if (value === undefined) continue;
          // import path / url / 경로 같은 안전 패턴은 noise 줄이기 위해 skip
          if (value.includes('/') || value.includes('\\')) continue;
          if (/^https?:|^data:|^file:/i.test(value)) continue;
          let arr = occurrences.get(value);
          if (arr === undefined) {
            arr = [];
            occurrences.set(value, arr);
          }
          arr.push({ file: file.rel, line });
        }
      }
    }

    const hits: Hit[] = [];
    for (const [literal, occs] of occurrences) {
      const distinctFiles = new Set(occs.map((o) => o.file));
      if (distinctFiles.size < 3) continue;
      // 같은 literal 의 첫 등장 1 회만 hit (noise 방지)
      const first = occs[0];
      if (first === undefined) continue;
      hits.push({
        category: 'duplicate-constant',
        constitution: 'SSoT',
        file: first.file,
        line: first.line,
        severity: 'report',
        message: `중복 literal "${literal.slice(0, 40)}${literal.length > 40 ? '…' : ''}" 가 ${distinctFiles.size} 파일에 등장 — 공통 상수로 추출 권장.`,
        excerpt: `등장 파일 ${distinctFiles.size} 개`,
      });
    }
    return hits;
  },
};

export default inspector;
