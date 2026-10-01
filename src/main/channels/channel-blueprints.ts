import type { ChannelKind } from '../../shared/channel-types';
import type { ChannelRole } from '../../shared/channel-role-types';
import { DEPARTMENT_TEMPLATE_ROLES } from '../../shared/department-blueprint-roles';
import type { DepartmentTemplateRole } from '../../shared/department-blueprint-roles';

/**
 * Fixed blueprint for the per-project system channels.
 *
 * R12-C 변경: `system_general` 제거 — 일반 채널은 전역 1개로 옮겨졌고
 * `ensureGlobalGeneralChannel()` 가 boot 시점에 보장한다. 마이그레이션
 * 018 이 기존 프로젝트 종속 system_general row 를 정리한다.
 *
 * Order matters: `listByProject()` relies on the kind ordering but
 * this list also determines create order (affects `created_at`).
 */
export const SYSTEM_CHANNEL_BLUEPRINT: ReadonlyArray<{
  name: string;
  kind: ChannelKind;
  readOnly: boolean;
}> = [
  { name: '승인-대기', kind: 'system_approval', readOnly: true },
  { name: '회의록', kind: 'system_minutes', readOnly: true },
];

/**
 * 기본 부서 채널의 이름. role 순서는 shared 의 정본
 * `DEPARTMENT_TEMPLATE_ROLES` 이 정하고, 여기서는 각 role 이 어떤 이름의
 * 채널이 되는지만 정한다 — renderer 의 부서 드롭다운은 이름 대신 카탈로그
 * 라벨을 쓰므로 이름은 main 쪽에만 있다.
 *
 * 디자인 부서 = `design.ui + design.ux` 통합 부서라 채널 이름이 카탈로그
 * 라벨 ('디자인 (UX)') 과 다르다.
 */
const DEPARTMENT_CHANNEL_NAME: Record<DepartmentTemplateRole, string> = {
  idea: '아이디어',
  planning: '기획',
  // 디자인 부서는 design.ui + design.ux 통합이라 채널 이름은 카탈로그
  // 라벨 ('디자인 (UX)') 이 아니라 부서 이름을 쓴다.
  'design.ux': '디자인',
  implement: '구현',
  review: '리뷰',
  audit: '검토',
};

/**
 * R12-C — 디폴트 부서 채널. 프로젝트 생성 시 자동 생성.
 * `createDepartmentChannels()` 가 이 blueprint 를 사용한다.
 *
 * 디자인 부서 = `design.ui + design.ux` 통합 부서. 단일 RoleId 표면이라
 * `design.ux` 를 대표 role 로 두고, 디자인 워크플로우 (R12-C Task 14) 가
 * 채널 멤버 중 `design.ui` / `design.ux` 능력자를 모두 찾는다.
 *
 * R12-W 정정 (ruling R26): spec 2026-05-15 §3.6 은 리뷰 (role `review`,
 * 주관 평가, chain 외 선택) 와 검토 (role `audit`, 객관 검증, 구현 다음의
 * chain 끝) 를 서로 다른 부서로 나눈다. 여기서는 `검토` 채널이 role
 * `review` 로 잘못 연결돼 있어 검토 회의가 주관 평가 프롬프트로 돌아갔다.
 * 이름 ↔ role 을 카탈로그 라벨 (`SKILL_CATALOG.review.label.ko` = 리뷰,
 * `audit.label.ko` = 검토) 과 맞추고 `리뷰` 부서를 별도 항목으로 추가해
 * 여섯 부서가 됐다. 기존 프로젝트의 잘못된 row 는 마이그레이션 028 이
 * 정정한다.
 *
 * 순서는 shared 의 `DEPARTMENT_TEMPLATE_ROLES` 이 정본 — 채널 생성 모달의
 * 부서 드롭다운이 같은 파일을 본다.
 *
 * 옵션 부서 (캐릭터 / 배경 디자인) 는 사용자 명시 시 추가 — Task 4 input.
 */
export const DEFAULT_DEPARTMENT_BLUEPRINT: ReadonlyArray<{
  name: string;
  role: ChannelRole;
}> = DEPARTMENT_TEMPLATE_ROLES.map((role) => ({
  name: DEPARTMENT_CHANNEL_NAME[role],
  role,
}));

/** 옵션 부서 (사용자 추가 시) — 게임 / 일러스트 프로젝트용. */
export const OPTIONAL_DEPARTMENT_BLUEPRINT: ReadonlyArray<{
  name: string;
  role: ChannelRole;
}> = [
  { name: '디자인-캐릭터', role: 'design.character' },
  { name: '디자인-배경', role: 'design.background' },
];
