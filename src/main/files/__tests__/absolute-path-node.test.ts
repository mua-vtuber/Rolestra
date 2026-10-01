/**
 * `absolute-path-node.ts` 단위 시험 — R12-X T2.
 *
 * 이 두 helper 의 계약은 "브랜드된 절대경로를 받아 브랜드된 절대경로를
 * 돌려준다" 한 가지다. 정규화가 검증을 대신하지 않는다는 것 (= 상대 경로가
 * cwd 로 채워져 승격되는 통로가 없다는 것) 이 시험의 핵심이다.
 */

import { describe, it, expect } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import { asAbsolutePath } from '../../../shared/absolute-path';
import { joinAbsolute, normalizeAbsolute } from '../absolute-path-node';

describe('absolute-path-node', () => {
  const root = asAbsolutePath(
    path.resolve(os.tmpdir(), 'rolestra-abs-node'),
    'test.root',
  );

  it('joinAbsolute 는 뿌리 아래로 segment 를 잇는다', () => {
    expect(joinAbsolute(root, 'a', 'b.md')).toBe(path.join(root, 'a', 'b.md'));
  });

  it('joinAbsolute 는 segment 가 없어도 뿌리를 그대로 돌려준다', () => {
    expect(joinAbsolute(root)).toBe(root);
  });

  it('normalizeAbsolute 는 `..` 이 섞인 철자를 하나로 다듬는다', () => {
    const messy = asAbsolutePath(
      path.join(root, 'child', '..', 'sibling'),
      'test.messy',
    );
    expect(normalizeAbsolute(messy)).toBe(path.join(root, 'sibling'));
  });

  it('normalizeAbsolute 는 이미 정규화된 경로를 바꾸지 않는다', () => {
    expect(normalizeAbsolute(root)).toBe(root);
  });

  it('상대 경로는 브랜드 단계에서 막혀 normalizeAbsolute 까지 오지 못한다', () => {
    // 이 시험이 지키는 것: 정규화 helper 가 raw string 을 받는 형태로
    // 되돌아가면 `path.resolve('relative/arena')` 가 앱 실행 폴더를 뿌리로
    // 승격시킨다. 입력 타입이 `AbsolutePath` 라서 유일한 진입로가
    // `asAbsolutePath` 이고, 거기서 실패한다.
    expect(() => asAbsolutePath('relative/arena', 'test.relative')).toThrow();
  });
});
