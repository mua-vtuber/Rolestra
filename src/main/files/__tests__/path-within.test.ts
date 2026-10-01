/**
 * `isPathWithin` 단위 시험 — R12-X T5.
 *
 * 이 helper 는 봉인 판정의 유일한 구현이다 (PermissionService.validateAccess /
 * 회의록 저장 경로 / 디자인 스냅샷 저장 경로가 모두 여기로 들어온다). 그래서
 * 검증도 실제 파일 시스템 위에서 한다 — realpath 를 쓰는 helper 를 가짜 fs 로
 * 시험하면 정작 지키려는 링크 우회를 못 본다.
 *
 * 다루는 것:
 *   - 같은 경로 / 하위 경로 / 아직 없는 하위 경로
 *   - `..` 로 빠져나가는 경로
 *   - 뒤에 붙은 구분자
 *   - 루트가 없을 때 (증명 불가 → false)
 *   - 형제 폴더로 나가는 링크 (문자열 prefix 비교가 놓치던 경우)
 *   - macOS `/var` ↔ `/private/var` 처럼 루트 자체가 링크인 경우
 *   - Windows 드라이브 문자 대소문자
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isPathWithin } from '../path-within';

let tmpRoot: string;
let sealedRoot: string;
let outsideDir: string;

beforeAll(() => {
  // mkdtemp 결과를 realpath 로 한 번 접어 둔다. macOS 의 os.tmpdir() 은
  // `/var/folders/...` 를 돌려주는데 그 `/var` 자체가 `/private/var` 링크라,
  // 기대값을 raw 경로로 두면 시험이 플랫폼마다 다른 것을 재게 된다.
  tmpRoot = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'rolestra-path-within-')),
  );
  sealedRoot = path.join(tmpRoot, 'sealed');
  outsideDir = path.join(tmpRoot, 'outside');
  fs.mkdirSync(path.join(sealedRoot, 'nested'), { recursive: true });
  fs.mkdirSync(outsideDir, { recursive: true });
  fs.writeFileSync(path.join(outsideDir, 'secret.txt'), 'x', 'utf-8');
});

afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('isPathWithin — 기본 판정', () => {
  it('루트 자기 자신은 안에 있는 것으로 본다', () => {
    expect(isPathWithin(sealedRoot, sealedRoot)).toBe(true);
  });

  it('이미 존재하는 하위 경로는 통과한다', () => {
    expect(isPathWithin(sealedRoot, path.join(sealedRoot, 'nested'))).toBe(true);
  });

  it('아직 만들지 않은 하위 경로도 통과한다 (쓰기 전 검사 용도)', () => {
    const notYet = path.join(sealedRoot, 'meetings', 'm-1', 'minutes.md');
    expect(fs.existsSync(notYet)).toBe(false);
    expect(isPathWithin(sealedRoot, notYet)).toBe(true);
  });

  it('형제 폴더는 거부한다', () => {
    expect(isPathWithin(sealedRoot, outsideDir)).toBe(false);
  });

  it('`..` 로 빠져나가는 경로는 거부한다', () => {
    const escape = path.join(sealedRoot, '..', 'outside', 'secret.txt');
    expect(isPathWithin(sealedRoot, escape)).toBe(false);
  });

  it('회의 id 자리에 `..` 가 들어와도 거부한다 (회의록 / 스냅샷 경로 형태)', () => {
    const target = path.resolve(sealedRoot, 'meetings', '../../../etc');
    expect(isPathWithin(sealedRoot, target)).toBe(false);
  });
});

describe('isPathWithin — 구분자 / 루트 존재 여부', () => {
  it('루트 뒤에 구분자가 붙어도 같은 판정이 나온다', () => {
    const rootWithSep = sealedRoot + path.sep;
    expect(isPathWithin(rootWithSep, path.join(sealedRoot, 'nested'))).toBe(
      true,
    );
    expect(isPathWithin(rootWithSep, outsideDir)).toBe(false);
  });

  it('대상 뒤에 구분자가 붙어도 같은 판정이 나온다', () => {
    expect(
      isPathWithin(sealedRoot, path.join(sealedRoot, 'nested') + path.sep),
    ).toBe(true);
  });

  it('이름은 비슷하지만 형제인 폴더를 하위로 착각하지 않는다', () => {
    // `<root>-evil` 은 `<root>` 로 시작하는 문자열이지만 하위 폴더가 아니다.
    const lookAlike = `${sealedRoot}-evil`;
    fs.mkdirSync(lookAlike, { recursive: true });
    expect(isPathWithin(sealedRoot, lookAlike)).toBe(false);
  });

  it('루트가 존재하지 않으면 아무것도 안에 있다고 말하지 않는다', () => {
    const missingRoot = path.join(tmpRoot, 'no-such-root');
    expect(fs.existsSync(missingRoot)).toBe(false);
    expect(isPathWithin(missingRoot, path.join(missingRoot, 'child'))).toBe(
      false,
    );
  });
});

describe('isPathWithin — 링크 (문자열 비교가 놓치던 경우)', () => {
  const linkName = 'linked';

  /**
   * 링크를 만들어 보고, 못 만들면 그 이유를 돌려준다. 호출자는 이유를
   * `ctx.skip` 에 그대로 실어 건너뛴 사실이 결과에 남게 한다 — 그냥
   * `return` 하면 vitest 는 통과로 세므로, 링크를 못 만드는 CI 계정에서
   * 링크 우회 검사가 돌지 않았다는 사실이 초록에 묻힌다.
   */
  function tryCreateLink(target: string, linkPath: string): string | null {
    try {
      fs.symlinkSync(target, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  }

  it('봉인 폴더 안의 링크가 밖을 가리키면 거부한다', (ctx) => {
    const linkPath = path.join(sealedRoot, linkName);
    const linkFailure = tryCreateLink(outsideDir, linkPath);
    if (linkFailure !== null) {
      // 링크를 못 만드는 환경 (권한 없는 Windows 계정 등) 에서는 이 성질을
      // 확인할 수 없다. 통과로 세지 않고 이유와 함께 건너뛴다.
      ctx.skip(
        `symlink/junction 생성 실패 — 링크 우회 검사는 이 환경에서 확인 불가: ${linkFailure}`,
      );
      return;
    }
    try {
      // 문자열 prefix 비교라면 `<sealed>/linked/secret.txt` 는 `<sealed>` 로
      // 시작하므로 통과했을 것이다. realpath 를 보면 `<outside>` 다.
      expect(
        isPathWithin(sealedRoot, path.join(linkPath, 'secret.txt')),
      ).toBe(false);
      expect(isPathWithin(sealedRoot, linkPath)).toBe(false);
    } finally {
      fs.rmSync(linkPath, { recursive: true, force: true });
    }
  });

  it('링크로 쓴 루트 안의 경로는 통과한다 — 단 두 인자의 표기가 같아야 한다', (ctx) => {
    // macOS 의 os.tmpdir() 이 `/var/folders/...` 를 주고 `/var` 가
    // `/private/var` 링크인 상황과 같은 모양을 직접 만든다.
    //
    // helper 는 realpath 를 보기 *전에* 먼저 문자열 관계로 `..` 탈출을 거른다
    // (파일 시스템을 만지지 않고 막기 위한 순서). 그래서 루트를 링크 표기로,
    // 대상을 실제 표기로 섞어 주면 1 단계에서 걸린다. 두 인자를 같은 표기에서
    // 유도하면 2 단계가 링크를 풀어 정상 판정한다.
    const linkedRoot = path.join(tmpRoot, 'sealed-link');
    const linkFailure = tryCreateLink(sealedRoot, linkedRoot);
    if (linkFailure !== null) {
      ctx.skip(
        `symlink/junction 생성 실패 — 링크 루트 검사는 이 환경에서 확인 불가: ${linkFailure}`,
      );
      return;
    }
    try {
      // 같은 표기에서 유도한 쌍 — 링크를 통해 들어가도 안이다.
      expect(isPathWithin(linkedRoot, path.join(linkedRoot, 'nested'))).toBe(
        true,
      );
      // 표기를 섞은 쌍 — 같은 폴더를 가리키지만 1 단계에서 거른다.
      // production 호출자는 루트와 대상을 모두 한 문자열에서 유도하므로 이
      // 상황을 만들지 않는다. 새 호출자가 두 출처를 섞으면 여기서 막힌다는
      // 사실을 시험으로 고정해 둔다.
      expect(isPathWithin(linkedRoot, path.join(sealedRoot, 'nested'))).toBe(
        false,
      );
      expect(isPathWithin(sealedRoot, path.join(linkedRoot, 'nested'))).toBe(
        false,
      );
    } finally {
      fs.rmSync(linkedRoot, { recursive: true, force: true });
    }
  });
});

describe('isPathWithin — Windows 드라이브 문자 대소문자', () => {
  const isWindows = process.platform === 'win32';

  it.runIf(isWindows)('드라이브 문자 대소문자가 달라도 같은 루트로 본다', () => {
    const lower = sealedRoot.charAt(0).toLowerCase() + sealedRoot.slice(1);
    const upper = sealedRoot.charAt(0).toUpperCase() + sealedRoot.slice(1);
    expect(isPathWithin(lower, path.join(upper, 'nested'))).toBe(true);
    expect(isPathWithin(upper, path.join(lower, 'nested'))).toBe(true);
  });

  it.runIf(!isWindows)(
    'POSIX 에서는 대소문자가 다른 경로를 같은 것으로 보지 않는다',
    () => {
      // 대소문자를 구분하는 파일 시스템에서 이름을 접으면 봉인이 약해진다.
      const shouted = path.join(sealedRoot, 'NESTED');
      expect(fs.existsSync(shouted)).toBe(false);
      // 존재하지 않는 하위 경로이므로 여전히 "안" 이다 — 판정 기준은 이름
      // 접기가 아니라 경로 관계다.
      expect(isPathWithin(sealedRoot, shouted)).toBe(true);
      // 반대로 루트 이름을 접으면 다른 폴더가 되어 루트가 없는 것과 같다.
      expect(
        isPathWithin(sealedRoot.toUpperCase(), path.join(sealedRoot, 'nested')),
      ).toBe(false);
    },
  );
});
