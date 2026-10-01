/**
 * path-guard-bypass — PathGuard 우회 + ArenaRoot 밖 write 검출.
 *
 * 헌법: NoSilentFallback / SoC.
 * 절대 위반 금지 규칙 #3 (승인 없는 파일 반영 금지) 의 *경로 봉인* 측면.
 *
 * 휴리스틱: src/main/ 안 fs.write* 호출이 있는 파일이 경로 봉인 게이트를
 * 하나도 참조하지 않으면 hit.
 *
 * approval-bypass 와 차이:
 *  - approval-bypass = fs.write 가 허가된 writer 모듈 밖 (경계 위반)
 *  - path-guard-bypass = fs.write 가 경로 검증 없음 (검증 누락)
 * 둘 다 hit 가능 = 진짜 심각 (위치 + 검증 모두 우회).
 *
 * ── R12-C2 T41 정밀화: R12-X 가 만든 게이트 이름 인식 ──
 *
 * 옛 룰은 `pathGuard` / `assertInside` / `PathGuard` / `arenaRoot` /
 * `ArenaRoot` 다섯 이름만 봉인의 증거로 인정했다. R12-X (WP2~WP4) 가
 * 봉인 방식을 정리하면서 실제로 쓰이는 이름이 늘었는데 룰은 그대로여서,
 * *봉인을 지키는 코드가 봉인을 우회한다고* 잡히고 있었다:
 *
 *   ExecutionService  다섯 메서드 모두 `ensureAccess` (=
 *                     `PermissionService.validateAccess` 위임) 를 먼저
 *                     통과해야 fs 를 만진다. R12-X T6 에서 required 로
 *                     승격돼 게이트 없이 만들면 constructor 가 던진다.
 *   PatchApplier      `workspaceRoot` 기준 `path.relative` + realpath 재확인
 *                     으로 탈출을 막는다.
 *   isPathWithin      R12-X T5 가 만든 단일 봉인 helper. 회의록 / 스냅샷 /
 *                     합의 폴더 / workspace 판정이 모두 이것을 경유한다.
 *   ProjectSkillSync  `assertInsideProjectRoot` — 이름만 다른 같은 판정.
 *
 * 그래서 게이트 이름 목록을 R12-X 결과에 맞춰 넓힌다. 이것은 allowlist 로
 * 파일을 통째로 빼 주는 것과 다르다 — 파일이 게이트를 *실제로 참조할 때만*
 * 통과하므로, 게이트를 지우면 다음 실행에서 다시 잡힌다.
 *
 * ── userData 아래 쓰기 ──
 *
 * `src/main/config/` 는 이미 "설정 파일은 userData 안 — PathGuard 대상
 * 아님" 으로 빠져 있었다. 같은 근거가 적용되는 두 곳을 추가한다:
 *
 *   src/main/log/     구조적 로그. 경로는 호출자가 준 config 이고 기본값은
 *                     file 미지정 (`DEFAULT_LOGGER_CONFIG` 에 file 없음) —
 *                     production boot (`foundation.ts createLogger()`) 는
 *                     파일을 아예 안 만든다.
 *   src/main/remote/  TLS 인증서. `remote-manager.ts` 가
 *                     `app.getPath('userData')/.arena/certs` 를 만들어 넘긴다.
 *
 * ArenaRoot 는 *사용자 작업물* 의 봉인이다. userData 는 앱 자신의 저장소라
 * 대상이 다르다.
 */
import type { Inspector, Hit, ScannedFile } from './types';
import { iterLines } from './walker';

const FS_WRITE =
  /\b(?:writeFile|writeFileSync|appendFile|appendFileSync|outputFile|outputFileSync|mkdirSync|rmdirSync|rmSync|unlinkSync)\b/;

/**
 * 경로 봉인 게이트의 이름들. 파일이 이 중 하나라도 참조하면 봉인 판정을
 * 거치는 코드로 본다. 새 게이트를 만들면 여기에 이름을 더한다.
 */
const PATH_GUARD_REF =
  /\b(?:pathGuard|PathGuard|assertInside|assertInsideProjectRoot|arenaRoot|ArenaRoot|isPathWithin|validateAccess|ensureAccess|workspaceRoot)\b/;

/**
 * PathGuard / ArenaRoot 자체 / ArenaRoot 봉인 대상이 아닌 저장소.
 *
 * `src/main/config/`, `src/main/log/`, `src/main/remote/` 셋은 모두
 * Electron `userData` 아래에 쓴다 — 사용자 작업물 봉인의 대상이 아니다.
 */
const ALLOWLIST_PREFIXES: readonly string[] = [
  'src/main/files/path-guard',
  'src/main/files/path-within',
  'src/main/files/permission-flag-builder',
  'src/main/arena/',
  'src/main/database/', // SQLite 자체 file lock 은 better-sqlite3 가 관리
  'src/main/config/', // 설정 파일은 userData 안 — PathGuard 대상 아님
  'src/main/log/', // 구조적 로그도 userData 안 (기본값은 파일 미기록)
  'src/main/remote/', // TLS 인증서는 userData/.arena/certs
];

function isAllowed(rel: string): boolean {
  return ALLOWLIST_PREFIXES.some((p) => rel.startsWith(p));
}

const inspector: Inspector = {
  category: 'path-guard-bypass',
  constitution: 'NoSilentFallback',
  scope: 'safety',
  description:
    'src/main/ 안 fs.write* 가 경로 봉인 게이트 미참조 — ArenaRoot 봉인 우회 의심.',
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
        message: `fs.${match[0] ?? ''} 가 경로 봉인 게이트 참조 없음 — 봉인 우회 의심.`,
        excerpt: trimmed.slice(0, 100),
      });
    }
    return hits;
  },
};

export default inspector;
