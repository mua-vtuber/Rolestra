/**
 * path-guard-bypass — PathGuard 우회 + ArenaRoot 밖 write 검출.
 *
 * 헌법: NoSilentFallback / SoC.
 * 절대 위반 금지 규칙 #3 (승인 없는 파일 반영 금지) 의 *경로 봉인* 측면.
 *
 * Phase 1 휴리스틱: src/main/ 안 fs.write* 호출이 있는 파일이 PathGuard
 * 모듈을 import 하지 않으면 hit. PathGuard 모듈 자체 / ArenaRoot 정의
 * 모듈 / 경로 검증 안 통과해도 안전한 곳 (DB lock 파일 등) 은 allowlist.
 *
 * approval-bypass 와 차이:
 *  - approval-bypass = fs.write 가 허가된 writer 모듈 밖 (경계 위반)
 *  - path-guard-bypass = fs.write 가 PathGuard 미사용 (경로 검증 누락)
 * 둘 다 hit 가능 = 진짜 심각 (위치 + 검증 모두 우회).
 */
import type { Inspector, Hit, ScannedFile } from './types';
import { iterLines } from './walker';

const FS_WRITE =
  /\b(?:writeFile|writeFileSync|appendFile|appendFileSync|outputFile|outputFileSync|mkdirSync|rmdirSync|rmSync|unlinkSync)\b/;
const PATH_GUARD_REF =
  /\b(?:pathGuard|assertInside|PathGuard|arenaRoot|ArenaRoot)\b/;

/** PathGuard / ArenaRoot 자체 / 검증 우회가 의도된 모듈. */
const ALLOWLIST_PREFIXES: readonly string[] = [
  'src/main/files/path-guard',
  'src/main/files/permission-flag-builder',
  'src/main/arena/',
  'src/main/database/', // SQLite 자체 file lock 은 better-sqlite3 가 관리
  'src/main/config/', // 설정 파일은 userData 안 — PathGuard 대상 아님
];

function isAllowed(rel: string): boolean {
  return ALLOWLIST_PREFIXES.some((p) => rel.startsWith(p));
}

const inspector: Inspector = {
  category: 'path-guard-bypass',
  constitution: 'NoSilentFallback',
  scope: 'safety',
  description:
    'src/main/ 안 fs.write* 가 PathGuard 미참조 — ArenaRoot 봉인 우회 의심.',
  perFile(file: ScannedFile): Hit[] {
    if (file.isTest) return [];
    if (!file.isMainProcess) return [];
    if (isAllowed(file.rel)) return [];
    if (PATH_GUARD_REF.test(file.source)) return [];

    const hits: Hit[] = [];
    for (const { line, text } of iterLines(file.source)) {
      const match = FS_WRITE.exec(text);
      if (match === null) continue;
      const trimmed = text.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
      if (/^\s*import\b/.test(text)) continue;
      hits.push({
        category: 'path-guard-bypass',
        constitution: 'NoSilentFallback',
        file: file.rel,
        line,
        severity: 'safety-error',
        message: `fs.${match[0] ?? ''} 가 PathGuard / ArenaRoot 참조 없음 — 경로 봉인 우회 의심.`,
        excerpt: trimmed.slice(0, 100),
      });
    }
    return hits;
  },
};

export default inspector;
