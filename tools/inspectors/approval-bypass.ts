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

/**
 * 합법적 writer 모듈 prefix — 이 안에서는 fs.write 사용 OK.
 *
 * ── R12-C2 T41 정밀화: 이 룰이 실제로 무엇을 지키는가 ──
 *
 * 규칙 #3 이 막는 것은 *AI 가 사용자 코드를 승인 없이 고치는 것* 이다.
 * 그 경로는 ExecutionService 하나뿐이고, R12-X T6 이후 다섯 메서드 모두
 * required `ensureAccess` 게이트를 통과한다 (게이트 없이 만들면
 * constructor 가 던진다).
 *
 * 반면 앱이 *자기 산출물* 을 저장하는 쓰기는 승인 대상이 아니다 —
 * 사용자가 이미 그 동작을 시켰고, 대상도 앱 소유 폴더다. 아래 목록에
 * 추가되는 다섯 모듈이 모두 그 종류다:
 *
 *   src/main/consensus/  합의 폴더 문서 + lock. ArenaRoot/consensus 안,
 *                        isConsensusPath (= isPathWithin) 로 봉인.
 *   src/main/meetings/   회의록 markdown. isPathWithin(consensusPath(), …)
 *                        로 봉인 + tmp -> rename atomic 저장 (R12-X T5).
 *   src/main/channels/   대화 archive dump. ArenaRoot/conversations-archive
 *                        안, 경로를 arenaRoot 에서 join 해 만든다.
 *   src/main/skills/     SKILL.md 배치. assertInsideProjectRoot 로 봉인.
 *   src/main/log/        구조적 로그 — userData 안 (기본값은 파일 미기록).
 *   src/main/remote/     TLS 인증서 — userData/.arena/certs 안.
 *
 * 이 여섯이 빠져도 룰은 여전히 일한다: 위 목록 밖 main 모듈이 fs.write 를
 * 부르면 그대로 잡힌다. 목록을 넓히는 것과 룰을 끄는 것은 다르다.
 */
const WRITER_ALLOWLIST: readonly string[] = [
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
  // R12-C2 T16c — design-workflow generating_snapshot 의 본체. 회의 #2 합의
  // PNG (desktop + mobile) 를 ArenaRoot/consensus 안 atomic 저장. PathGuard
  // 봉인 + atomic write 패턴은 meeting-minutes-service 와 동일 — 디자인
  // mockup 도 회의 산출물이라 같은 service-owned write surface 로 분류.
  'src/main/snapshot/',
  // R12-C2 T41 — 위 주석의 여섯 모듈. 모두 앱 자기 산출물의 저장이며
  // 각자 봉인 판정을 거친다 (또는 userData 안이라 봉인 대상이 아니다).
  'src/main/consensus/',
  'src/main/meetings/',
  'src/main/channels/',
  'src/main/skills/',
  'src/main/log/',
  'src/main/remote/',
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
