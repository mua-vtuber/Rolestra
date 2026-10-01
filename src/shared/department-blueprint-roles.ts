/**
 * 기본 부서 template 의 role 순서 — main / renderer 공유 (R12-W T14).
 *
 * main 의 `DEFAULT_DEPARTMENT_BLUEPRINT` (프로젝트 생성 시 자동으로 만드는
 * 부서 채널) 과 renderer 의 채널 생성 모달 드롭다운이 같은 부서를 같은
 * 순서로 보여야 한다. 둘이 갈라지면 사용자가 모달에서 고른 부서와 프로젝트가
 * 자동 생성한 부서가 서로 달라진다. renderer 는 main 모듈을 import 할 수
 * 없으므로 (IPC 경계) 순서 목록만 shared 로 올려 한 군데서 읽는다.
 *
 * 채널 *이름* 은 blueprint 쪽에만 있다 — 자동 생성 채널의 이름은 카탈로그
 * 라벨과 달라도 되는 사용자 표면이라 여기로 올리지 않는다.
 *
 * ruling R26 — `review` (리뷰, 주관 평가) 와 `audit` (검토, 객관 검증) 은
 * 서로 다른 부서다.
 */

import type { RoleId } from './role-types';

export const DEPARTMENT_TEMPLATE_ROLES = [
  'idea',
  'planning',
  'design.ux',
  'implement',
  'review',
  'audit',
] as const satisfies ReadonlyArray<RoleId>;

/** 기본 부서 role 하나. `DEPARTMENT_TEMPLATE_ROLES` 의 멤버로 좁혀진다. */
export type DepartmentTemplateRole = (typeof DEPARTMENT_TEMPLATE_ROLES)[number];
