/**
 * Migration 028-department-audit-role — R12-W ruling R26 기본 부서 정정.
 *
 * spec docs/specs/2026-05-15-r12-c2-card-minutes-review-ux.md §3.6 은
 * 리뷰 (role `review`, 주관 평가, chain 외 선택) 와 검토 (role `audit`,
 * 객관 검증, 구현 다음의 chain 끝) 를 서로 다른 부서로 나눈다. 그런데
 * `DEFAULT_DEPARTMENT_BLUEPRINT` 이 `검토` 채널을 role `review` 로 연결해
 * 둬서, 이미 만들어진 프로젝트의 `검토` 채널이 주관 평가 프롬프트로
 * 회의를 돌리고 있었다. blueprint 는 코드에서 고쳤고, 이 마이그레이션이
 * 기존 DB row 를 같은 상태로 맞춘다.
 *
 * 두 단계:
 *   1. `role='review' AND name='검토'` row 의 role 을 'audit' 로 정정.
 *   2. 그 중 권한 5컬럼이 *리뷰 카탈로그 default 그대로* 인 row 만 검토
 *      카탈로그 default 로 옮긴다. 사용자가 채널 설정 모달에서 직접 조정한
 *      row (한 축이라도 다른 값) 는 손대지 않는다 — 사용자 의도가 우선.
 *
 * 권한 리터럴 (작성 시점 SKILL_CATALOG 정본, 축 순서 file_read /
 * file_write / command_exec / web_search / db_read):
 *   review  1 0 0 1 1
 *   audit   1 0 1 0 1
 *
 * 위 리터럴이 카탈로그와 어긋나면 `migration-028.test.ts` 의 sanity 케이스가
 * 즉시 fail 한다 (023 의 BACKFILL_SQL sanity 와 같은 방식).
 *
 * 리뷰 부서 채널을 기존 프로젝트에 새로 INSERT 하지는 않는다. 이름 충돌 /
 * 멤버 구성 / created_at 순서를 마이그레이션이 결정해 버리면 사용자 환경을
 * 예측 불가능하게 흔들기 때문이다. 리뷰 부서가 필요한 사용자는 채널 생성
 * 모달에서 부서 template 으로 직접 만든다.
 *
 * Forward-only + 멱등: 1 단계가 대상 row 의 role 을 바꾸면 두 번째 실행에는
 * `role='review' AND name='검토'` 에 걸리는 row 가 없다. 2 단계도 같은
 * WHERE 로 좁히므로 재실행이 값을 되돌리지 않는다.
 */

import type { Migration } from '../migrator';

/**
 * 권한 이전 UPDATE — sanity 테스트가 import 해서 카탈로그 default 와 비교한다.
 * role 정정 UPDATE 보다 *먼저* 실행돼야 한다 (아직 role='review' 인 상태에서
 * 대상을 좁히기 때문).
 */
export const PERMISSION_MIGRATE_SQL = `
UPDATE channels
   SET command_exec = 1,
       web_search   = 0
 WHERE role = 'review'
   AND name = '검토'
   AND file_read    = 1
   AND file_write   = 0
   AND command_exec = 0
   AND web_search   = 1
   AND db_read      = 1;
`;

/** role 정정 UPDATE. 권한 이전 뒤에 실행. */
export const ROLE_MIGRATE_SQL = `
UPDATE channels
   SET role = 'audit'
 WHERE role = 'review'
   AND name = '검토';
`;

export const migration: Migration = {
  id: '028-department-audit-role',
  sql: `
${PERMISSION_MIGRATE_SQL}
${ROLE_MIGRATE_SQL}
`,
};
