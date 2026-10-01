/**
 * Provider Repository — DB persistence for provider configurations.
 *
 * Reads and writes provider data to the v3 `providers` SQLite table (schema
 * defined in src/main/database/migrations/001-core.ts — spec §5.2 001_core).
 * The registry (in-memory) and repository (DB) are synchronized by
 * provider-handler.ts during add/remove operations.
 *
 * R12-S (Task 5): roles + skill_overrides 두 컬럼 read/write 추가.
 * 두 필드는 JSON 문자열로 저장되며 parsing 은 provider-restore 에서
 * 수행한다 (silent fallback 금지 — JSON 깨지면 throw).
 *
 * R12-C2 (T36): is_department_head 컬럼도 read/write 한다. 018 에서 컬럼만
 * 생겨 있고 아무도 읽지 않아, 부서장을 지정해도 재시작하면 사라졌다.
 */

import { getDatabase } from '../database/connection';
import type { ProviderConfig, ProviderType } from '../../shared/provider-types';
import type { RoleId } from '../../shared/role-types';
import {
  serializeDepartmentHeadMap,
  type DepartmentHeadMap,
} from './department-head-map';

/** Row shape returned by SELECT from the v3 providers table. */
export interface ProviderRow {
  id: string;
  kind: ProviderType;
  displayName: string;
  persona: string | null;
  /** JSON-serialized ProviderConfig; model lives inside the config. */
  configJson: string;
  /** R12-S: JSON-serialized RoleId[]. */
  roles: string;
  /** R12-S: JSON-serialized Record<RoleId, string> | null. */
  skillOverrides: string | null;
  /** R12-C2 T36: JSON-serialized Partial<Record<RoleId, boolean>>. `'{}'` = 핀 없음. */
  isDepartmentHead: string;
}

/**
 * Save a provider to the database. Upserts (insert or replace).
 *
 * `isDepartmentHead` 는 기본값을 두지 않는다. 기본값 `{}` 를 두면 이 인자를
 * 잊은 호출 한 번에 기존 부서장 지정이 통째로 지워지고, 사용자는 다음 회의가
 * 엉뚱한 직원을 지목할 때까지 그 사실을 모른다. 핀을 건드리지 않는 호출이라면
 * 현재 row 의 값을 읽어 그대로 다시 넘겨야 한다.
 *
 * F3 STEP 3b (spec 2026-09-29-ai-setup-and-character.md, QA defect):
 * `persona` 는 더 이상 파라미터로 받지 않는다 — 캐릭터 설정이 유일한 편집
 * 가능 persona 자리가 되면서(034), 이 함수의 모든 호출자(provider:add,
 * member:rename)가 in-memory `BaseProvider.persona` 를 읽어 그대로 다시
 * 써넣는 배선이 죽었다(§persona-builder.ts buildChatPersona 문서, §채팅 경로
 * 어느 곳도 `providers.persona` 를 더는 읽지 않음). 컬럼 자체는 history 로
 * 남긴다(지운 적 없음, 마이그레이션 없음) — 그래서 이 UPDATE 는 `persona`
 * 를 SET 목록에서 아예 뺀다: INSERT 시 스키마 DEFAULT `''` 가 자동 적용되고,
 * UPDATE 시 기존 컬럼 값이 손대지지 않고 그대로 남는다. `is_department_head`
 * 위 주석의 "핀을 건드리지 않으려면 현재 값을 읽어 다시 넘겨야 한다" 규칙을,
 * `persona` 는 애초에 파라미터에서 빼는 방식으로 만족한다 — 호출자가 in-memory
 * 로 들고 다닐 값 자체가 없어지므로 "깜빡하고 빈 값을 넘기는" 사고 가능성도
 * 함께 없앤다.
 */
export function saveProvider(
  id: string,
  kind: ProviderType,
  displayName: string,
  config: ProviderConfig,
  roles: RoleId[],
  skillOverrides: Partial<Record<RoleId, string>> | null,
  isDepartmentHead: DepartmentHeadMap,
): void {
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT INTO providers (id, display_name, kind, config_json, roles, skill_overrides, is_department_head, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())
    ON CONFLICT(id) DO UPDATE SET
      display_name       = excluded.display_name,
      kind               = excluded.kind,
      config_json        = excluded.config_json,
      roles              = excluded.roles,
      skill_overrides    = excluded.skill_overrides,
      is_department_head = excluded.is_department_head,
      updated_at         = unixepoch()
  `);
  stmt.run(
    id,
    displayName,
    kind,
    JSON.stringify(config),
    JSON.stringify(roles),
    skillOverrides === null ? null : JSON.stringify(skillOverrides),
    serializeDepartmentHeadMap(isDepartmentHead),
  );
}

/** Remove a provider from the database by ID. */
export function removeProvider(id: string): void {
  const db = getDatabase();
  db.prepare('DELETE FROM providers WHERE id = ?').run(id);
}

/** Load all providers from the database. */
export function loadAllProviders(): ProviderRow[] {
  const db = getDatabase();
  return db
    .prepare(
      `SELECT id, kind, display_name AS displayName, persona, config_json AS configJson,
              roles, skill_overrides AS skillOverrides,
              is_department_head AS isDepartmentHead
         FROM providers`,
    )
    .all() as ProviderRow[];
}
