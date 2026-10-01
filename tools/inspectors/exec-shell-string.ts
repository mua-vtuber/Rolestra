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
 *
 * R12-C2 T41 정밀화 — `exec` 는 child_process 만 쓰는 이름이 아니다:
 *
 *   `db.exec(sql)`      better-sqlite3 의 SQL 실행. 셸을 안 거친다.
 *   `regex.exec(text)`  RegExp 매칭. 셸과 아무 관계가 없다.
 *
 * 옛 룰은 이름만 보고 다섯 건을 잡았고 전부 위 두 종류였다. 룰이 잡아야
 * 하는 것은 *child_process 에서 온* exec 이므로, 파일이 실제로
 * child_process 를 들여왔고 그 곳에서 온 이름으로 부를 때만 hit 로 센다.
 *
 * 판정 방법:
 *  1. 파일 안 `import ... from 'node:child_process' | 'child_process'` 와
 *     `require('child_process')` 를 훑어 셸 실행 이름 (exec / execSync /
 *     spawn / spawnSync) 이 어떤 지역 이름으로 들어왔는지 모은다.
 *     namespace import (`import * as cp`) 는 namespace 이름을 따로 모은다.
 *  2. 호출 라인에서 그 지역 이름 (또는 `<ns>.exec`) 으로 부른 것만 센다.
 *     수신자가 있는 `foo.exec(` 는 namespace 이름이 아니면 무시 —
 *     `db.exec` / `regex.exec` 가 여기서 걸러진다.
 *
 * child_process 를 안 들여온 파일은 셸을 실행할 방법이 없으므로 아예
 * 검사하지 않는다.
 */
import type { Inspector, Hit, ScannedFile } from './types';
import { iterLines } from './walker';

/** 셸 문자열을 실행할 수 있는 child_process 이름. */
const SHELL_EXEC_NAMES: readonly string[] = ['exec', 'execSync'];
const SPAWN_NAMES: readonly string[] = ['spawn', 'spawnSync'];

const SHELL_TRUE = /\bshell\s*:\s*true\b/;

/** 파일이 child_process 에서 들여온 이름 목록. */
interface ChildProcessBindings {
  /** 지역 이름 -> 원래 export 이름 (`exec` / `spawn` / ...). */
  named: Map<string, string>;
  /** namespace import / require 의 지역 이름 (`cp`, `childProcess`, ...). */
  namespaces: Set<string>;
}

/**
 * `import { exec as run, spawn } from 'node:child_process'` 같은 named
 * import 의 `{ ... }` 안을 지역 이름 -> 원래 이름으로 푼다.
 */
function collectNamedSpecifiers(
  clause: string,
  into: Map<string, string>,
): void {
  for (const raw of clause.split(',')) {
    const part = raw.trim();
    if (part.length === 0) continue;
    const aliased = /^(\w+)\s+as\s+(\w+)$/.exec(part);
    if (aliased !== null) {
      into.set(aliased[2] as string, aliased[1] as string);
      continue;
    }
    if (/^\w+$/.test(part)) into.set(part, part);
  }
}

/**
 * 파일 전체를 훑어 child_process 결합을 모은다. import 문은 여러 줄에
 * 걸칠 수 있어 원본 전체를 대상으로 정규식을 돌린다.
 */
function collectBindings(source: string): ChildProcessBindings {
  const named = new Map<string, string>();
  const namespaces = new Set<string>();

  // import { a, b as c } from 'node:child_process'
  const namedImport =
    /import\s*\{([^}]*)\}\s*from\s*['"](?:node:)?child_process['"]/g;
  let m: RegExpExecArray | null;
  while ((m = namedImport.exec(source)) !== null) {
    collectNamedSpecifiers(m[1] ?? '', named);
  }

  // import * as cp from 'node:child_process'
  const nsImport =
    /import\s*\*\s*as\s*(\w+)\s*from\s*['"](?:node:)?child_process['"]/g;
  while ((m = nsImport.exec(source)) !== null) {
    namespaces.add(m[1] as string);
  }

  // import cp from 'node:child_process'  (default / CJS interop)
  const defaultImport =
    /import\s+(\w+)\s*(?:,\s*\{[^}]*\}\s*)?from\s*['"](?:node:)?child_process['"]/g;
  while ((m = defaultImport.exec(source)) !== null) {
    namespaces.add(m[1] as string);
  }

  // const { exec } = require('child_process') / await import(...)
  const destructuredRequire =
    /(?:const|let|var)\s*\{([^}]*)\}\s*=\s*(?:await\s+import|require)\s*\(\s*['"](?:node:)?child_process['"]\s*\)/g;
  while ((m = destructuredRequire.exec(source)) !== null) {
    collectNamedSpecifiers(m[1] ?? '', named);
  }

  // const cp = require('child_process')
  const nsRequire =
    /(?:const|let|var)\s+(\w+)\s*=\s*(?:await\s+import|require)\s*\(\s*['"](?:node:)?child_process['"]\s*\)/g;
  while ((m = nsRequire.exec(source)) !== null) {
    namespaces.add(m[1] as string);
  }

  return { named, namespaces };
}

/**
 * `text` 안에서 child_process 에서 온 `names` 중 하나를 부르는 호출을
 * 찾는다. 수신자가 붙은 호출 (`x.exec(`) 은 `x` 가 namespace 일 때만 센다.
 *
 * 반환은 매칭된 *원래* 이름 (`exec` / `spawnSync` / ...) 또는 null.
 */
function findCall(
  text: string,
  names: readonly string[],
  bindings: ChildProcessBindings,
): string | null {
  for (const [local, original] of bindings.named) {
    if (!names.includes(original)) continue;
    // 앞에 `.` 이 오면 다른 객체의 메서드다 (`db.exec`).
    const pattern = new RegExp(`(?<![.\\w$])${local}\\s*\\(`);
    if (pattern.test(text)) return original;
  }
  for (const ns of bindings.namespaces) {
    for (const name of names) {
      const pattern = new RegExp(`(?<![.\\w$])${ns}\\.${name}\\s*\\(`);
      if (pattern.test(text)) return name;
    }
  }
  return null;
}

const inspector: Inspector = {
  category: 'exec-shell-string',
  constitution: 'Atomicity',
  scope: 'safety',
  description:
    'child_process 에서 온 exec / shell: true 검출 — execFile + shell: false 강제.',
  perFile(file: ScannedFile): Hit[] {
    if (file.isTest) return [];
    // tools/cli-smoke 는 의도적으로 셸 흉내 — 룰 적용 X
    if (file.rel.startsWith('tools/cli-smoke/')) return [];
    if (!file.rel.startsWith('src/')) return [];

    const bindings = collectBindings(file.source);
    if (bindings.named.size === 0 && bindings.namespaces.size === 0) {
      // child_process 를 안 들여온 파일은 셸을 실행할 수 없다.
      return [];
    }

    const hits: Hit[] = [];
    let pendingSpawnLine = -1;
    let pendingSpawnSnippet = '';

    for (const { line, text } of iterLines(file.source)) {
      const trimmed = text.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) {
        pendingSpawnLine = -1;
        continue;
      }
      if (/^\s*import\b/.test(text)) continue;

      const execName = findCall(text, SHELL_EXEC_NAMES, bindings);
      if (execName !== null) {
        hits.push({
          category: 'exec-shell-string',
          constitution: 'Atomicity',
          file: file.rel,
          line,
          severity: 'safety-error',
          message: `child_process.${execName} 사용 — execFile 로 교체 필요 (셸 문자열 회피).`,
          excerpt: trimmed.slice(0, 100),
        });
      }

      const spawnName = findCall(text, SPAWN_NAMES, bindings);
      if (spawnName !== null) {
        if (SHELL_TRUE.test(text)) {
          hits.push({
            category: 'exec-shell-string',
            constitution: 'Atomicity',
            file: file.rel,
            line,
            severity: 'safety-error',
            message: `${spawnName} + shell: true — shell: false 로 교체 필요.`,
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
