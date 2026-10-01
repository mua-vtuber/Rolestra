/**
 * mock-fixture-import — production code 가 test fixture import 검출.
 *
 * 헌법: NoSilentFallback.
 * 절대 위반 금지 규칙 (mock 데이터 / fallback 금지) 의 코드 표현.
 *
 * 차단 패턴: production 파일 안 import 경로가 다음을 포함:
 *  - `__tests__/`
 *  - `test-utils/`
 *  - `.test.ts` / `.test.tsx` / `.spec.ts`
 *  - `*-fixtures.ts` / `*-mocks.ts`
 *
 * Allowlist X — production code 가 fixture 를 import 하면 무조건 hit.
 */
import type { Inspector, Hit, ScannedFile } from './types';
import { iterLines } from './walker';

const IMPORT_LINE = /^\s*(?:import|export)\s+[^'"]*from\s+['"]([^'"]+)['"]/;

const FIXTURE_PATTERNS: readonly RegExp[] = [
  /__tests__\//,
  /test-utils\//,
  /\.test(?:\.|['"])/,
  /\.spec(?:\.|['"])/,
  /-fixtures(?:\.|['"])/,
  /-mocks(?:\.|['"])/,
];

const inspector: Inspector = {
  category: 'mock-fixture-import',
  constitution: 'NoSilentFallback',
  scope: 'non-safety',
  description:
    'production 파일이 __tests__/ / test-utils/ / *-fixtures.ts import.',
  perFile(file: ScannedFile): Hit[] {
    if (file.isTest) return [];

    const hits: Hit[] = [];
    for (const { line, text } of iterLines(file.source)) {
      const match = IMPORT_LINE.exec(text);
      if (match === null) continue;
      const importPath = match[1] ?? '';
      if (!FIXTURE_PATTERNS.some((p) => p.test(importPath))) continue;
      hits.push({
        category: 'mock-fixture-import',
        constitution: 'NoSilentFallback',
        file: file.rel,
        line,
        severity: 'report',
        message: `production 파일이 fixture / test 모듈 import: ${importPath}`,
        excerpt: text.trim().slice(0, 100),
      });
    }
    return hits;
  },
};

export default inspector;
