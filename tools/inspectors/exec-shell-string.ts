/**
 * exec-shell-string — child_process 셸 문자열 실행 검출.
 *
 * 헌법: Atomicity / SoC.
 * 절대 위반 금지 규칙 #4 (셸 문자열 실행 금지) 의 코드 표현.
 *
 * 차단 패턴:
 *  - child_process.exec / execSync (어떤 형태든)
 *  - spawn / spawnSync 호출 + 같은 호출 인자에 `shell: true`
 *
 * Allowlist: 테스트 / e2e / tools/cli-smoke. 본체 코드는 항상 execFile +
 * shell: false.
 */
import type { Inspector, Hit, ScannedFile } from './types';
import { iterLines } from './walker';

const EXEC_PATTERN = /\b(?:child_process\.)?(exec|execSync)\s*\(/;
const SPAWN_PATTERN = /\b(?:child_process\.)?(spawn|spawnSync)\s*\(/;
const SHELL_TRUE = /\bshell\s*:\s*true\b/;

const inspector: Inspector = {
  category: 'exec-shell-string',
  constitution: 'Atomicity',
  scope: 'safety',
  description:
    'child_process.exec / shell: true 검출 — execFile + shell: false 강제.',
  perFile(file: ScannedFile): Hit[] {
    if (file.isTest) return [];
    // tools/cli-smoke 는 의도적으로 셸 흉내 — 룰 적용 X
    if (file.rel.startsWith('tools/cli-smoke/')) return [];
    if (!file.rel.startsWith('src/')) return [];

    const hits: Hit[] = [];
    let pendingSpawnLine = -1;
    let pendingSpawnSnippet = '';

    for (const { line, text } of iterLines(file.source)) {
      const trimmed = text.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) {
        pendingSpawnLine = -1;
        continue;
      }

      const execMatch = EXEC_PATTERN.exec(text);
      if (execMatch !== null) {
        hits.push({
          category: 'exec-shell-string',
          constitution: 'Atomicity',
          file: file.rel,
          line,
          severity: 'safety-error',
          message: `child_process.${execMatch[1]} 사용 — execFile 로 교체 필요 (셸 문자열 회피).`,
          excerpt: trimmed.slice(0, 100),
        });
      }

      const spawnMatch = SPAWN_PATTERN.exec(text);
      if (spawnMatch !== null) {
        if (SHELL_TRUE.test(text)) {
          hits.push({
            category: 'exec-shell-string',
            constitution: 'Atomicity',
            file: file.rel,
            line,
            severity: 'safety-error',
            message: `${spawnMatch[1]} + shell: true — shell: false 로 교체 필요.`,
            excerpt: trimmed.slice(0, 100),
          });
        } else {
          pendingSpawnLine = line;
          pendingSpawnSnippet = trimmed.slice(0, 100);
        }
      } else if (pendingSpawnLine !== -1) {
        // spawn(...) 의 다음 줄들에서 shell: true 가 등장하는 옵션 객체 케이스
        if (SHELL_TRUE.test(text)) {
          hits.push({
            category: 'exec-shell-string',
            constitution: 'Atomicity',
            file: file.rel,
            line: pendingSpawnLine,
            severity: 'safety-error',
            message:
              'spawn(..) 옵션에 shell: true — shell: false 로 교체 필요.',
            excerpt: pendingSpawnSnippet,
          });
          pendingSpawnLine = -1;
        } else if (line - pendingSpawnLine > 8) {
          pendingSpawnLine = -1;
        }
      }
    }

    return hits;
  },
};

export default inspector;
