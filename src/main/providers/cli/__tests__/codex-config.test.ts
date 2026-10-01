/**
 * codex-config `buildResumeArgs` 계약 검증.
 *
 * resume argv 는 `exec` 뒤에 `resume <sessionId>` 를 끼워 넣고 `-C <cwd>`
 * 쌍만 제거한다. 특히 `--skip-git-repo-check` 는 resume 에서도 그대로
 * 보존되어야 한다 — git 저장소가 아닌 프로젝트 폴더에서 첫 턴이 성공한
 * 뒤 이어 말하기가 `Not inside a trusted directory` 로 실패하면 안 되기
 * 때문.
 */

import { describe, expect, it } from 'vitest';

import { CODEX_CLI_CONFIG } from '../codex-config';

const CWD = '/tmp/proj';

function resume(sessionId: string, baseArgs: string[]): string[] {
  const build = CODEX_CLI_CONFIG.buildResumeArgs;
  if (!build) throw new Error('CODEX_CLI_CONFIG.buildResumeArgs is missing');
  return build(sessionId, baseArgs);
}

describe('CODEX_CLI_CONFIG.buildResumeArgs', () => {
  it('read-only argv: -C 쌍만 제거하고 --skip-git-repo-check 는 보존', () => {
    expect(
      resume('sess-1', [
        '-a',
        'never',
        '--sandbox',
        'read-only',
        'exec',
        '-C',
        CWD,
        '--skip-git-repo-check',
        '--json',
      ]),
    ).toEqual([
      '-a',
      'never',
      '--sandbox',
      'read-only',
      'exec',
      'resume',
      'sess-1',
      '--skip-git-repo-check',
      '--json',
    ]);
  });

  it('hybrid argv: --skip-git-repo-check + --full-auto 순서 보존', () => {
    expect(
      resume('sess-2', [
        'exec',
        '-C',
        CWD,
        '--skip-git-repo-check',
        '--full-auto',
        '--json',
      ]),
    ).toEqual([
      'exec',
      'resume',
      'sess-2',
      '--skip-git-repo-check',
      '--full-auto',
      '--json',
    ]);
  });

  it('--cd 형태의 cwd 옵션도 제거', () => {
    expect(resume('sess-3', ['exec', '--cd', CWD, '--json'])).toEqual([
      'exec',
      'resume',
      'sess-3',
      '--json',
    ]);
  });

  it('exec 이 없는 argv 는 최소 resume 형태로 대체', () => {
    expect(resume('sess-4', [])).toEqual(['exec', 'resume', 'sess-4', '--json']);
  });
});
