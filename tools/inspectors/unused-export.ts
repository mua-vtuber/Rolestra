/**
 * unused-export — export 됐으나 import 0 건 검출.
 *
 * 헌법: SoC.
 *
 * Phase 1 휴리스틱:
 *  - 모든 src/ + tools/ ts/tsx 파일 안 `export const|function|class|interface
 *    |type|enum NAME` 패턴 수집
 *  - 모든 파일 안 `import { ... NAME ... }` 패턴 수집 (named import 만)
 *  - export 됐으나 어디서도 import 안 된 NAME = hit
 *
 * Allowlist:
 *  - default export / re-export / barrel index.ts 는 cross-file 검출 어려움
 *    → skip
 *  - test 파일 / migration / e2e 의 export 는 skip
 *  - 한 파일이 `export default X` 와 `export const X` 둘 다 가지면 매우
 *    헷갈림 — phase 1 에서는 named export 만 잡고 default 는 무시
 */
import type { Inspector, Hit, ScannedFile } from './types';
import { iterLines } from './walker';

const EXPORT_PATTERN =
  /^\s*export\s+(?:const|let|var|function|class|interface|type|enum|abstract\s+class)\s+([A-Z_$][\w$]*)/;
const IMPORT_NAMED = /import\s*(?:type\s+)?\{([^}]+)\}\s*from\s*['"]/g;
const RE_EXPORT_NAMED = /export\s*(?:type\s+)?\{([^}]+)\}\s*from\s*['"]/g;
const IDENTIFIER = /[A-Z_$][\w$]*/g;

interface ExportLoc {
  file: string;
  line: number;
}

const SKIP_FILE_BASENAMES: ReadonlySet<string> = new Set([
  'index.ts',
  'index.tsx',
]);

const inspector: Inspector = {
  category: 'unused-export',
  constitution: 'SoC',
  scope: 'non-safety',
  description:
    'named export 됐으나 어디서도 import 안 됨 (default + barrel 제외).',
  perProject(files: readonly ScannedFile[]): Hit[] {
    const exports = new Map<string, ExportLoc>();
    const importedNames = new Set<string>();

    for (const file of files) {
      const baseName = file.rel.split('/').pop() ?? '';
      const isBarrel = SKIP_FILE_BASENAMES.has(baseName);
      const skipExports = file.isTest || file.isMigration || isBarrel;

      // import 수집 — barrel / test 모두 포함 (외부 사용 흔적이라도 보존)
      const src = file.source;
      let m: RegExpExecArray | null;
      IMPORT_NAMED.lastIndex = 0;
      while ((m = IMPORT_NAMED.exec(src)) !== null) {
        const inside = m[1] ?? '';
        let id: RegExpExecArray | null;
        IDENTIFIER.lastIndex = 0;
        while ((id = IDENTIFIER.exec(inside)) !== null) {
          importedNames.add(id[0]);
        }
      }
      RE_EXPORT_NAMED.lastIndex = 0;
      while ((m = RE_EXPORT_NAMED.exec(src)) !== null) {
        const inside = m[1] ?? '';
        let id: RegExpExecArray | null;
        IDENTIFIER.lastIndex = 0;
        while ((id = IDENTIFIER.exec(inside)) !== null) {
          importedNames.add(id[0]);
        }
      }

      if (skipExports) continue;

      // export 수집 — 라인 단위
      for (const { line, text } of iterLines(file.source)) {
        const match = EXPORT_PATTERN.exec(text);
        if (match === null) continue;
        const name = match[1] ?? '';
        if (name === '') continue;
        // 같은 이름이 여러 파일에서 export 되는 경우 첫 번째만 추적 (phase 1 단순)
        if (!exports.has(name)) {
          exports.set(name, { file: file.rel, line });
        }
      }
    }

    const hits: Hit[] = [];
    for (const [name, loc] of exports) {
      if (importedNames.has(name)) continue;
      hits.push({
        category: 'unused-export',
        constitution: 'SoC',
        file: loc.file,
        line: loc.line,
        severity: 'report',
        message: `export ${name} 가 어디서도 import 안 됨 — 삭제 또는 사용 검토.`,
        excerpt: name,
      });
    }
    return hits;
  },
};

export default inspector;
