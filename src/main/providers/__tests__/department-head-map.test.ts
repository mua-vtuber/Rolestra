/**
 * department-head-map — R12-C2 T36 부서장 핀 컬럼 직렬화 / 파싱.
 *
 * 핵심은 "깨진 값을 조용히 {} 로 바꾸지 않는다" 다. 그렇게 하면 부서장
 * 지정이 사라진 채로 앱이 정상 기동하고, 사용자는 회의가 엉뚱한 직원을
 * 지목할 때까지 아무것도 모른다.
 */

import { describe, it, expect } from 'vitest';

import {
  DepartmentHeadMapParseError,
  parseDepartmentHeadMap,
  serializeDepartmentHeadMap,
} from '../department-head-map';

describe('parseDepartmentHeadMap', () => {
  it('빈 map 컬럼 기본값을 그대로 읽는다', () => {
    expect(parseDepartmentHeadMap('{}', 'p1')).toEqual({});
  });

  it('능력별 핀을 읽는다', () => {
    expect(
      parseDepartmentHeadMap('{"planning":true,"design.ux":false}', 'p1'),
    ).toEqual({ planning: true, 'design.ux': false });
  });

  it('JSON 이 아니면 provider id 를 담아 던진다', () => {
    expect(() => parseDepartmentHeadMap('not json', 'p-broken')).toThrow(
      DepartmentHeadMapParseError,
    );
    expect(() => parseDepartmentHeadMap('not json', 'p-broken')).toThrow(
      /p-broken/,
    );
  });

  it('배열은 거부한다', () => {
    expect(() => parseDepartmentHeadMap('["planning"]', 'p1')).toThrow(
      /not a JSON object/,
    );
  });

  it('null 은 거부한다', () => {
    expect(() => parseDepartmentHeadMap('null', 'p1')).toThrow(
      /not a JSON object/,
    );
  });

  it('모르는 능력 이름은 거부한다', () => {
    expect(() =>
      parseDepartmentHeadMap('{"not_a_role":true}', 'p1'),
    ).toThrow(/unknown role id: not_a_role/);
  });

  it('boolean 이 아닌 값은 거부한다', () => {
    expect(() => parseDepartmentHeadMap('{"planning":"yes"}', 'p1')).toThrow(
      /not a boolean/,
    );
  });
});

describe('serializeDepartmentHeadMap', () => {
  it('켜진 핀만 저장한다', () => {
    expect(
      serializeDepartmentHeadMap({ planning: true, 'design.ux': false }),
    ).toBe('{"planning":true}');
  });

  it('핀이 없으면 빈 객체를 저장한다', () => {
    expect(serializeDepartmentHeadMap({})).toBe('{}');
    expect(serializeDepartmentHeadMap({ planning: false })).toBe('{}');
  });

  it('직렬화한 뒤 다시 읽으면 켜진 핀이 보존된다', () => {
    const raw = serializeDepartmentHeadMap({
      planning: true,
      'design.ui': true,
      idea: false,
    });
    expect(parseDepartmentHeadMap(raw, 'p1')).toEqual({
      planning: true,
      'design.ui': true,
    });
  });
});
