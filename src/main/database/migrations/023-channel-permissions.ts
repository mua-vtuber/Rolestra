/**
 * Migration 023-channel-permissions — R12-W D3 채널 권한 wire-up.
 *
 * 회의 turn 페르소나 합성에 채널 단위 권한이 흘러들 수 있도록 channels 테이블에
 * 5 axis boolean 컬럼을 직접 추가한다. R12-W D1 결재 — 권한 단위 = 채널 1:1 —
 * 따라 별도 테이블 / 별도 도메인을 만들지 않고 channels row 위에 권한을 올린다.
 *
 * 추가 컬럼 (DEFAULT = D2 "안전 측" — 최소 읽기):
 *   - file_read     INTEGER NOT NULL DEFAULT 1 CHECK (0,1)
 *   - file_write    INTEGER NOT NULL DEFAULT 0 CHECK (0,1)
 *   - command_exec  INTEGER NOT NULL DEFAULT 0 CHECK (0,1)
 *   - web_search    INTEGER NOT NULL DEFAULT 0 CHECK (0,1)
 *   - db_read       INTEGER NOT NULL DEFAULT 0 CHECK (0,1)
 *
 * 기존 row backfill — 부서 채널 (role 컬럼 매칭) 은 SKILL_CATALOG.toolGrants
 * 정본을 그대로 박제한다. role IS NULL (system_general / system_approval /
 * system_minutes / DM) row 는 ALTER DEFAULT 값 그대로 (file_read=1, 나머지 0).
 *
 * 부서별 9 UPDATE 박제 — `BACKFILL_SQL` 별도 export 로 sanity 테스트가
 * 동일 SQL 을 다시 실행해 카탈로그 ↔ migration UPDATE drift 를 즉시 검출
 * 한다 (R12-W T3 plan 본문). axis 단위 묶음 대신 row 단위 매트릭스 박제는
 * drift 발생 시 어느 부서 어느 axis 가 잘못된지 직접 추적 가능.
 *
 * 카탈로그 매트릭스 (src/shared/skill-catalog.ts 정본):
 *   role               file_read file_write cmd_exec web_search db_read
 *   idea               1         0          0        1          1
 *   planning           1         0          0        1          1
 *   design.ui          1         0          0        0          1
 *   design.ux          1         0          0        1          1
 *   design.character   1         0          0        0          1
 *   design.background  1         0          0        0          1
 *   implement          1         1          1        0          1
 *   review             1         0          0        1          1
 *   audit              1         0          1        0          1
 *   general            0         0          0        0          0   (NO_TOOLS)
 *
 * 카탈로그 drift 정책: SKILL_CATALOG 가 갱신되면 본 마이그레이션은
 * 갱신하지 않는다 (forward-only + immutability). 그 시점 이후 새 채널은
 * T5 ChannelService 가 INSERT 시 카탈로그 default 를 채워주므로 신선
 * 값을 가지며, 기존 row 는 본 마이그레이션이 박제한 R12-W land 시점의
 * 카탈로그 값을 유지한다. 사용자가 채널 설정 모달에서 개별 row override
 * 가능 (T15).
 *
 * spec docs/specs/2026-04-18-rolestra-design.md §7.6 (R12-W §7.6.4 신설)
 * plan docs/R12_c2_2R/plans/2026-05-11-rolestra-r12-w-member-file-permission.md T3
 *
 * Forward-only: 새 컬럼 + 기존 row UPDATE 만 — DROP / RENAME / ALTER DROP X.
 * 한 번 land 후 immutable.
 */

import type { Migration } from '../migrator';

/**
 * Backfill UPDATE SQL — sanity 테스트가 import 해서 row 단위 결과를 카탈로그
 * `catalogDefaultFor(roleId)` 와 비교한다. 마이그레이션 본문과 동일 source.
 */
export const BACKFILL_SQL = `
UPDATE channels SET file_read=1, file_write=0, command_exec=0, web_search=1, db_read=1 WHERE role='idea';
UPDATE channels SET file_read=1, file_write=0, command_exec=0, web_search=1, db_read=1 WHERE role='planning';
UPDATE channels SET file_read=1, file_write=0, command_exec=0, web_search=0, db_read=1 WHERE role='design.ui';
UPDATE channels SET file_read=1, file_write=0, command_exec=0, web_search=1, db_read=1 WHERE role='design.ux';
UPDATE channels SET file_read=1, file_write=0, command_exec=0, web_search=0, db_read=1 WHERE role='design.character';
UPDATE channels SET file_read=1, file_write=0, command_exec=0, web_search=0, db_read=1 WHERE role='design.background';
UPDATE channels SET file_read=1, file_write=1, command_exec=1, web_search=0, db_read=1 WHERE role='implement';
UPDATE channels SET file_read=1, file_write=0, command_exec=0, web_search=1, db_read=1 WHERE role='review';
UPDATE channels SET file_read=1, file_write=0, command_exec=1, web_search=0, db_read=1 WHERE role='audit';
UPDATE channels SET file_read=0, file_write=0, command_exec=0, web_search=0, db_read=0 WHERE role='general';
`;

export const migration: Migration = {
  id: '023-channel-permissions',
  sql: `
ALTER TABLE channels ADD COLUMN file_read    INTEGER NOT NULL DEFAULT 1 CHECK (file_read    IN (0,1));
ALTER TABLE channels ADD COLUMN file_write   INTEGER NOT NULL DEFAULT 0 CHECK (file_write   IN (0,1));
ALTER TABLE channels ADD COLUMN command_exec INTEGER NOT NULL DEFAULT 0 CHECK (command_exec IN (0,1));
ALTER TABLE channels ADD COLUMN web_search   INTEGER NOT NULL DEFAULT 0 CHECK (web_search   IN (0,1));
ALTER TABLE channels ADD COLUMN db_read      INTEGER NOT NULL DEFAULT 0 CHECK (db_read      IN (0,1));

${BACKFILL_SQL}
`,
};
