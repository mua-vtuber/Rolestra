/**
 * approval-bypass — ExecutionService 우회 + 직접 fs.write 검출.
 *
 * 헌법: NoSilentFallback.
 * 절대 위반 금지 규칙 #3 (승인 없는 파일 반영 금지 — dryRun → 승인 → atomic
 * apply → rollback) 의 코드 표현.
 *
 * Phase 1 휴리스틱: src/main/ 안 fs.write* 호출이 *허가된 writer 모듈 밖*
 * 에서 등장하면 hit. 허가된 writer = ExecutionService / 설정 / DB / 노티
 * 로그 / 온보딩 state / 메모리 백업 등.
 *
 * 비교 대상 룰: path-guard-bypass (PathGuard 우회 별도) — 둘 모두 fs.write
 * 를 잡지만 cause 가 다름.
 */
import type { Inspector, Hit, ScannedFile } from './types';
import { iterLines } from './walker';

const FS_WRITE = /\b(?:writeFile|writeFileSync|appendFile|appendFileSync|outputFile|outputFileSync|mkdirSync|rmdirSync|rmSync|unlinkSync)\b/;

/** 합법적 writer 모듈 prefix — 이 안에서는 fs.write 사용 OK. */
const WRITER_ALLOWLIST: readonly string[] = [
  'src/main/execution/',
  'src/main/files/',
  'src/main/config/',
  'src/main/database/',
  'src/main/onboarding/',
  'src/main/notifications/',
  'src/main/llm/',
  'src/main/recovery/',
  'src/main/projects/',
  'src/main/arena/',
  'src/main/memory/',
  'src/main/providers/registry',
  'src/main/members/',
];

function isAllowed(rel: string): boolean {
  return WRITER_ALLOWLIST.some((p) => rel.startsWith(p));
}

const inspector: Inspector = {
  category: 'approval-bypass',
  constitution: 'NoSilentFallback',
  scope: 'safety',
  description:
    'src/main/ 안 fs.write* 가 허가된 writer 모듈 밖 — ExecutionService 경유 필요.',
  perFile(file: ScannedFile): Hit[] {
    if (file.isTest) return [];
    if (!file.isMainProcess) return [];
    if (isAllowed(file.rel)) return [];

    const hits: Hit[] = [];
    for (const { line, text } of iterLines(file.source)) {
      const match = FS_WRITE.exec(text);
      if (match === null) continue;
      const trimmed = text.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
      // import 라인 (named import 안 식별자 등장) skip
      if (/^\s*import\b/.test(text)) continue;
      hits.push({
        category: 'approval-bypass',
        constitution: 'NoSilentFallback',
        file: file.rel,
        line,
        severity: 'safety-error',
        message: `fs.${match[0] ?? ''} — 허가된 writer 모듈 밖 호출. ExecutionService 경유 필요.`,
        excerpt: trimmed.slice(0, 100),
      });
    }
    return hits;
  },
};

export default inspector;
