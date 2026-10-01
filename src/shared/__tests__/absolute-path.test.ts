/**
 * absolute-path — R12-X T1 acceptance.
 *
 * `asAbsolutePath` 가 상대경로를 확실히 거부하는지, 그리고 POSIX /
 * Windows 드라이브 / UNC 세 형태를 모두 통과시키는지 검증한다. 판정이
 * `node:path` 없이 순수 문자열로 이뤄지므로 (renderer 번들 제약) 플랫폼과
 * 무관하게 같은 결과가 나와야 한다 — Windows 케이스도 POSIX 러너에서
 * 그대로 통과해야 한다.
 */

import { describe, it, expect } from 'vitest';
import {
  asAbsolutePath,
  unsafeMarkAbsolute,
  isAbsolutePathString,
  AbsolutePathError,
} from '../absolute-path';

describe('asAbsolutePath', () => {
  const rejected: Array<[label: string, value: string]> = [
    ['빈 문자열', ''],
    ['현재 폴더', '.'],
    ['현재 폴더 슬래시', './'],
    ['현재 폴더 하위', './foo'],
    ['상위 폴더', '../foo'],
    ['상대 경로', 'relative/path'],
    ['공백만', '   '],
    ['Windows 드라이브 상대 경로', 'C:foo'],
    ['Windows 루트 상대 경로', '\\foo'],
    ['이름만', 'foo.txt'],
  ];

  for (const [label, value] of rejected) {
    it(`${label} 은 throw — ${JSON.stringify(value)}`, () => {
      expect(() => asAbsolutePath(value, 'test.ctx')).toThrow(
        AbsolutePathError,
      );
    });
  }

  const accepted: Array<[label: string, value: string]> = [
    ['POSIX 절대경로', '/abs/path'],
    ['POSIX 루트', '/'],
    ['Windows 역슬래시', 'C:\\Users\\taniar\\project'],
    ['Windows 슬래시', 'C:/Users/taniar/project'],
    ['Windows 드라이브 루트', 'D:\\'],
    ['Windows 소문자 드라이브', 'd:/work'],
    ['UNC 경로', '\\\\server\\share\\folder'],
  ];

  for (const [label, value] of accepted) {
    it(`${label} 은 통과 — ${JSON.stringify(value)}`, () => {
      expect(asAbsolutePath(value, 'test.ctx')).toBe(value);
    });
  }

  it('실패 message 에 맥락과 원본 값이 모두 들어간다', () => {
    let caught: unknown;
    try {
      asAbsolutePath('./foo', 'SsmContext.projectPath');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AbsolutePathError);
    const error = caught as AbsolutePathError;
    expect(error.context).toBe('SsmContext.projectPath');
    expect(error.value).toBe('./foo');
    expect(error.message).toContain('SsmContext.projectPath');
    expect(error.message).toContain('./foo');
  });
});

describe('isAbsolutePathString', () => {
  it('절대경로 판정이 asAbsolutePath 와 일치한다', () => {
    expect(isAbsolutePathString('/abs')).toBe(true);
    expect(isAbsolutePathString('C:\\abs')).toBe(true);
    expect(isAbsolutePathString('relative')).toBe(false);
    expect(isAbsolutePathString('')).toBe(false);
  });
});

describe('unsafeMarkAbsolute', () => {
  it('검증 없이 값을 그대로 돌려준다 (탈출구)', () => {
    expect(unsafeMarkAbsolute('any')).toBe('any');
  });
});
