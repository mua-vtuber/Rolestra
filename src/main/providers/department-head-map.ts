/**
 * 부서장 핀 map (`providers.is_department_head`) 의 직렬화 / 역직렬화
 * — R12-C2 T36.
 *
 * 컬럼은 018-channels-role-purpose-handoff 에서 `TEXT NOT NULL DEFAULT '{}'`
 * 로 생겼다. 값은 능력(RoleId) 하나하나에 대해 "이 직원이 그 부서의
 * 부서장인가" 를 담는 JSON 객체다. 예:
 *
 *   {"design.ux": true, "planning": true}
 *
 * 어느 부서에도 핀이 없으면 `{}` 다. `{}` 는 정상 상태이지 "읽기 실패"
 * 가 아니다 — 그래서 파싱이 실패했을 때는 절대 `{}` 로 대체하지 않고
 * provider id 를 담은 오류를 던진다. 그러지 않으면 컬럼이 깨진 순간
 * 부서장 지정이 조용히 사라지고, 회의는 엉뚱한 직원을 지목하면서도
 * 아무 문제가 없는 것처럼 보인다.
 *
 * 모르는 key 도 오류로 본다. 능력 이름이 바뀌었는데 컬럼이 그대로면
 * resolver 가 그 핀을 영영 못 찾으므로, 조용히 넘기면 같은 종류의
 * 침묵하는 실패가 된다.
 */

import { isRoleId, type RoleId } from '../../shared/role-types';

/** 능력별 부서장 핀 여부. 없는 key = 그 부서의 부서장이 아님. */
export type DepartmentHeadMap = Partial<Record<RoleId, boolean>>;

/** 파싱 실패 원인을 provider id 와 함께 전달하는 오류. */
export class DepartmentHeadMapParseError extends Error {
  constructor(
    readonly providerId: string,
    readonly rawValue: string,
    reason: string,
  ) {
    super(
      `[department-head-map] failed to parse providers.is_department_head ` +
        `for ${providerId}: ${rawValue}. Cause: ${reason}`,
    );
    this.name = 'DepartmentHeadMapParseError';
  }
}

/**
 * DB 컬럼 문자열을 map 으로 바꾼다. 빈 객체 `'{}'` 는 정상이며 `{}` 를
 * 돌려준다. 그 밖의 손상 (JSON 아님 / 배열 / 모르는 능력 이름 / boolean
 * 아닌 값) 은 {@link DepartmentHeadMapParseError} 로 던진다.
 */
export function parseDepartmentHeadMap(
  raw: string,
  providerId: string,
): DepartmentHeadMap {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new DepartmentHeadMapParseError(
      providerId,
      raw,
      err instanceof Error ? err.message : String(err),
    );
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new DepartmentHeadMapParseError(
      providerId,
      raw,
      'value is not a JSON object',
    );
  }

  const map: DepartmentHeadMap = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!isRoleId(key)) {
      throw new DepartmentHeadMapParseError(
        providerId,
        raw,
        `unknown role id: ${key}`,
      );
    }
    if (typeof value !== 'boolean') {
      throw new DepartmentHeadMapParseError(
        providerId,
        raw,
        `value for ${key} is not a boolean`,
      );
    }
    map[key] = value;
  }
  return map;
}

/**
 * map 을 DB 컬럼 문자열로 바꾼다. `false` 항목은 "부서장이 아님" 이라
 * 저장할 이유가 없으므로 떨어뜨린다 — 컬럼이 커지지 않고, resolver 의
 * `=== true` 검사와도 결과가 같다.
 */
export function serializeDepartmentHeadMap(map: DepartmentHeadMap): string {
  const pinned: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(map)) {
    if (value === true) pinned[key] = true;
  }
  return JSON.stringify(pinned);
}
