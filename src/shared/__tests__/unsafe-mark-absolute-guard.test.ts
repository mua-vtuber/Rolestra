/**
 * `unsafeMarkAbsolute` 주석 가드 시험 — R12-X T11.
 *
 * `AbsolutePath` brand 의 가치는 "값을 얻으려면 검증을 통과해야 한다" 는 데
 * 있고, `unsafeMarkAbsolute` 는 그 검증을 건너뛰는 유일한 통로다. 그래서
 * 호출마다 "어느 경계가 이미 절대경로임을 보장했는지" 를 주석으로 남기게
 * 하는 ESLint 규칙을 두었다 (`eslint-rules/unsafe-mark-absolute-needs-comment.mjs`).
 *
 * 이 시험은 그 규칙을 실제 ESLint 로 돌려 두 가지를 고정한다:
 *   1. 주석 없는 호출은 오류가 된다 (규칙이 살아 있다).
 *   2. 주석이 있는 호출은 통과한다 (정당한 사용까지 막지 않는다).
 *
 * 규칙 모듈만 부르는 게 아니라 저장소의 `eslint.config.mjs` 를 그대로 써서
 * 검사한다 — 규칙 파일은 남아 있는데 config 배선이 빠지는 회귀가 가장 흔한
 * 형태이고, 그 경우를 잡으려면 config 를 거쳐야 한다.
 */

import { describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '..', '..', '..');

/**
 * `src/main` 안의 가상 파일로 검사한다. 실제로 파일을 만들지는 않는다 —
 * `lintText` 의 `filePath` 는 config 의 `files` / `ignores` glob 판정에만
 * 쓰인다. `__tests__` 밖 경로여야 규칙이 적용된다.
 */
async function lint(source: string): Promise<ESLint.LintResult[]> {
  const eslint = new ESLint({ cwd: repoRoot });
  return await eslint.lintText(source, {
    filePath: path.join(repoRoot, 'src', 'main', 'unsafe-mark-absolute-probe.ts'),
  });
}

function guardMessages(results: ESLint.LintResult[]): string[] {
  return results
    .flatMap((r) => r.messages)
    .filter((m) => m.ruleId === 'rolestra/unsafe-mark-absolute-needs-comment')
    .map((m) => `${String(m.line)}: ${m.message}`);
}

const IMPORT_LINE = "import { unsafeMarkAbsolute } from '../shared/absolute-path';\n";

describe('unsafeMarkAbsolute 주석 가드 (ESLint)', () => {
  it('주석 없는 호출을 오류로 잡는다', async () => {
    const results = await lint(
      `${IMPORT_LINE}export const p = unsafeMarkAbsolute('/tmp/x');\n`,
    );
    expect(guardMessages(results)).toHaveLength(1);
  });

  it('바로 윗줄 주석이 있으면 통과시킨다', async () => {
    const results = await lint(
      `${IMPORT_LINE}// Electron app.getPath 가 절대경로를 보장한다.\nexport const p = unsafeMarkAbsolute('/tmp/x');\n`,
    );
    expect(guardMessages(results)).toEqual([]);
  });

  it('같은 줄 끝 주석도 통과시킨다', async () => {
    const results = await lint(
      `${IMPORT_LINE}export const p = unsafeMarkAbsolute('/tmp/x'); // DB 가 검증 후 기록한 값\n`,
    );
    expect(guardMessages(results)).toEqual([]);
  });

  it('다른 표현식 안에 들어간 호출도 주석 없으면 잡는다', async () => {
    const results = await lint(
      `${IMPORT_LINE}export const cfg = { root: unsafeMarkAbsolute('/tmp/x') };\n`,
    );
    expect(guardMessages(results)).toHaveLength(1);
  });

  it('다른 표현식 안에 들어간 호출도 주석이 있으면 통과시킨다', async () => {
    const results = await lint(
      `${IMPORT_LINE}export const cfg = {\n  // ArenaRootService 가 절대경로로 만든 값.\n  root: unsafeMarkAbsolute('/tmp/x'),\n};\n`,
    );
    expect(guardMessages(results)).toEqual([]);
  });

  it('시험 파일에는 규칙을 적용하지 않는다 (탈출구 자체를 시험할 수 있어야 한다)', async () => {
    const eslint = new ESLint({ cwd: repoRoot });
    const results = await eslint.lintText(
      `${IMPORT_LINE}export const p = unsafeMarkAbsolute('/tmp/x');\n`,
      {
        filePath: path.join(
          repoRoot,
          'src',
          'main',
          '__tests__',
          'probe.test.ts',
        ),
      },
    );
    expect(guardMessages(results)).toEqual([]);
  });
});
