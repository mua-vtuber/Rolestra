# Rolestra Phase R2 — v3 DB 스키마 + Main 레이어 + IPC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** v3 DB 마이그레이션 체인(001~011) + 12개 Main 서비스 + 확장 IPC 채널을 통합하여, R1에서 검증된 CLI 권한·경로 로직을 실제 앱 데이터 경로와 연결하고, Renderer 변경 없이 v3 백엔드 레이어를 완성한다.

**Architecture:** 기존 `src/main/database/migrator.ts`(forward-only runner)는 그대로 재사용하되 v2 마이그레이션 007개는 `_legacy/migrations-v2/`로 이동하고, v3 신규 체인 11개를 작성한다. Main 서비스는 R1 `tools/cli-smoke/` 참조 구현을 이식하되 DB 연동·Electron 런타임과 통합한다. IPC는 기존 `IpcChannelMap` + `typedInvoke` 구조를 유지하고 9개 도메인 채널 + 8개 stream 이벤트를 추가한다. v2 Renderer는 이 Phase에서 건드리지 않으며, 서비스 호환이 깨지면 **임시 비활성**(스크립트 기반 통합 테스트로만 검증)한다.

**Tech Stack:** TypeScript strict / Electron (better-sqlite3) / Vitest / zod / R1 산출물(`tools/cli-smoke/src/*.ts`) 이식 / v2 memory·audit·remote 테이블 이식.

**참조:**
- Spec: `docs/superpowers/specs/2026-04-18-rolestra-design.md` §4.2.1(경로), §5.2(DB), §6(IPC), §7.1·§7.2·§7.3·§7.4·§7.6(기능), §8(SSM 확장), §9(Consensus), §10 R2
- R1 참조 구현: `tools/cli-smoke/src/{arena-root,project-service,path-guard,junction,resolve-project-paths,cli-spawn,permission-adapter}.ts`
- R1 매트릭스 결과: `docs/superpowers/specs/appendix-cli-matrix.md`
- v2 마이그레이션(이식 원본): `src/main/database/migrations/001-initial-schema.ts` ~ `007-session-mode-columns.ts`
- v2 PersonaBuilder: `src/main/engine/persona-builder.ts` (위치 확인 필요, R2 태스크 9에서 재확인)

---

## Scope Boundary

**R2에 포함:**
- DB 마이그레이션 001~011 (v2 memory/audit/remote는 이식)
- 12개 신규 서비스: ArenaRootService, ProjectService, ChannelService, MessageService, MeetingService, ApprovalService, QueueService, MemberProfileService, NotificationService, ConsensusFolderService, CircuitBreaker, 재설계된 PermissionService
- CLI 레이어 이식: CliPermissionAdapter, CliSpawn, shell-env 기반 macOS PATH 병합
- IPC: 9개 도메인 채널 세트 + 8개 stream 이벤트 + zod 스키마
- SSM ctx 확장 + circuit breaker 런타임 + 사이드이펙트 리스너
- 통합 smoke 테스트 (Vitest, 실제 Electron 구동 아님)

**R2에 포함하지 않음 (다른 Phase):**
- Renderer 변경 (R3~R10)
- Design System / i18n (R3)
- Dashboard UI (R4)
- E2E Playwright Electron 구동 (R3 이후, 필요 시점까지)
- `_legacy/renderer-v1/` 이동 (R3)
- Memory FTS/embedding 로직 확장 (v2 그대로 이식만, 확장은 별도 Phase)

**호환성 원칙:**
- v2 Renderer → v3 Main 호출 시 기존 IPC 채널은 **depreciated 상태로 유지**(동작은 하지만 로그 경고). 새 채널만 v3 서비스 바인딩.
- 호환 불가로 판정된 기존 핸들러(예: 이전 프로젝트 모델 기반)는 `cli-permission-handler`, `workspace-handler` 위주로 임시 shim 제공. R3에서 제거.

---

## File Structure

```
src/main/
├── database/
│   ├── migrations/                        # v3 신규 (기존 001~007 → _legacy/)
│   │   ├── 001-core.ts
│   │   ├── 002-projects.ts
│   │   ├── 003-channels.ts
│   │   ├── 004-meetings.ts
│   │   ├── 005-messages.ts
│   │   ├── 006-approval-inbox.ts
│   │   ├── 007-queue.ts
│   │   ├── 008-memory.ts                  # v2 004-memory-enhancement.ts 이식
│   │   ├── 009-audit.ts                   # v2 001-initial-schema.ts 중 audit_log 추출
│   │   ├── 010-remote.ts                  # v2 003-remote-tables.ts 이식
│   │   ├── 011-notifications.ts
│   │   └── index.ts
│   └── [connection.ts, migrator.ts, database-manager.ts 유지]
├── arena/                                 # 신규
│   ├── arena-root-service.ts
│   ├── resolve-project-paths.ts
│   └── __tests__/
├── projects/                              # 신규
│   ├── project-service.ts
│   ├── project-repository.ts
│   ├── project-meta.ts                    # .arena/meta.json 입출력
│   ├── junction.ts
│   └── __tests__/
├── channels/                              # 신규
│   ├── channel-service.ts
│   ├── channel-repository.ts
│   ├── message-service.ts
│   ├── message-repository.ts
│   └── __tests__/
├── meetings/                              # 신규
│   ├── meeting-service.ts
│   ├── meeting-repository.ts
│   └── __tests__/
├── approvals/                             # 신규
│   ├── approval-service.ts
│   ├── approval-repository.ts
│   └── __tests__/
├── queue/                                 # 신규
│   ├── queue-service.ts
│   ├── queue-repository.ts
│   ├── circuit-breaker.ts
│   └── __tests__/
├── members/                               # 신규
│   ├── member-profile-service.ts
│   ├── member-profile-repository.ts
│   ├── persona-builder.ts                 # v2에서 이식·확장
│   └── __tests__/
├── notifications/                         # 신규
│   ├── notification-service.ts
│   ├── notification-repository.ts
│   └── __tests__/
├── consensus/                             # 신규
│   ├── consensus-folder-service.ts
│   └── __tests__/
├── files/
│   └── permission-service.ts              # 재설계 (path-guard 단순화)
├── providers/
│   └── cli/
│       ├── permission-adapter.ts          # R1 이식
│       ├── cli-spawn.ts                   # R1 이식 + shell-env
│       ├── shell-env.ts                   # 신규 (macOS PATH 병합)
│       └── __tests__/
├── ipc/
│   ├── router.ts                          # 기존 유지
│   └── handlers/
│       ├── arena-root-handler.ts          # 신규
│       ├── project-handler.ts             # 신규
│       ├── channel-handler.ts             # 신규
│       ├── message-handler.ts             # 신규
│       ├── meeting-handler.ts             # 신규
│       ├── member-handler.ts              # 신규
│       ├── approval-handler.ts            # 신규
│       ├── notification-handler.ts        # 신규
│       └── queue-handler.ts               # 신규
├── streams/                               # 신규
│   ├── stream-bridge.ts
│   └── __tests__/
└── engine/
    └── [SsmContext 확장 — 기존 파일 수정]

src/shared/                                # 신규 타입 + ipc-types.ts 확장
├── arena-root-types.ts
├── project-types.ts
├── channel-types.ts
├── message-types.ts
├── meeting-types.ts
├── approval-types.ts
├── queue-types.ts
├── member-profile-types.ts
├── notification-types.ts
├── ipc-types.ts                           # 확장
└── ipc-schemas.ts                         # 확장

_legacy/
└── migrations-v2/                         # 기존 001~007 이동 대상
    ├── 001-initial-schema.ts
    ├── 002-recovery-tables.ts
    ├── 003-remote-tables.ts
    ├── 004-memory-enhancement.ts
    ├── 005-consensus-records.ts
    ├── 006-consensus-summary.ts
    └── 007-session-mode-columns.ts
```

**프로젝트 루트 변경:**
- `tsconfig.json` / `vitest.config.ts` include — `src/main/{arena,projects,channels,meetings,approvals,queue,members,notifications,consensus,streams}/__tests__/**` 자동 포함 확인 (기존 glob에 포함되면 무수정).
- `package.json` scripts 변경 없음.
- **DB 파일 경로 이동**: ArenaRootService 도입으로 기존 `userData/arena.sqlite` → `<ArenaRoot>/db/arena.sqlite`로 변경 (Task 5에서 `connection.ts` 수정).

---

## Task 0: v2 마이그레이션을 `_legacy/`로 이동 + 빈 v3 체인 준비

**Goal:** 기존 v2 마이그레이션 7개를 `_legacy/migrations-v2/`로 이동하고, v3 신규 체인을 위한 빈 `migrations/index.ts`를 준비한다. migrator 러너는 그대로 유지.

**Files:**
- Move: `src/main/database/migrations/001-initial-schema.ts` → `_legacy/migrations-v2/001-initial-schema.ts`
- Move: `src/main/database/migrations/002-recovery-tables.ts` → `_legacy/migrations-v2/002-recovery-tables.ts`
- Move: `src/main/database/migrations/003-remote-tables.ts` → `_legacy/migrations-v2/003-remote-tables.ts`
- Move: `src/main/database/migrations/004-memory-enhancement.ts` → `_legacy/migrations-v2/004-memory-enhancement.ts`
- Move: `src/main/database/migrations/005-consensus-records.ts` → `_legacy/migrations-v2/005-consensus-records.ts`
- Move: `src/main/database/migrations/006-consensus-summary.ts` → `_legacy/migrations-v2/006-consensus-summary.ts`
- Move: `src/main/database/migrations/007-session-mode-columns.ts` → `_legacy/migrations-v2/007-session-mode-columns.ts`
- Rewrite: `src/main/database/migrations/index.ts` (import 목록을 빈 배열로)
- Create: `_legacy/migrations-v2/README.md` (이동 사유·이식 매핑 기록)
- Modify: `src/main/database/migrator.ts` — 앱 부팅 시 기존 v2 DB를 감지하면 **fresh-install 가이드 다이얼로그** 경로만 남기고 자동 migrate 하지 않음 (실제 다이얼로그 UI는 R3, 여기선 `logger.error` + throw로 차단). 이건 추가 함수 `assertNoLegacyMigrations(db)` 형태.

**Acceptance Criteria:**
- [ ] `src/main/database/migrations/` 디렉토리에 `index.ts` 1개만 존재
- [ ] `index.ts`의 `export const migrations: Migration[] = []` (빈 배열)
- [ ] 기존 v2 migrator 단위 테스트가 "no migrations" 조건에서도 통과
- [ ] `_legacy/migrations-v2/`에 7개 TS 파일 그대로 위치, 해당 파일은 import되지 않아 tree-shaking 대상
- [ ] `assertNoLegacyMigrations(db)`: `migrations` 테이블에 v2 id(`001-initial-schema` 등)가 있으면 throw

**Verify:** `npx vitest run src/main/database/__tests__/migrator.test.ts` → PASS, `npx tsc --noEmit` → 에러 없음

**Steps:**

- [ ] **Step 1: 레거시 디렉토리 생성 + 파일 이동**

```bash
mkdir -p _legacy/migrations-v2
git mv src/main/database/migrations/001-initial-schema.ts _legacy/migrations-v2/
git mv src/main/database/migrations/002-recovery-tables.ts _legacy/migrations-v2/
git mv src/main/database/migrations/003-remote-tables.ts _legacy/migrations-v2/
git mv src/main/database/migrations/004-memory-enhancement.ts _legacy/migrations-v2/
git mv src/main/database/migrations/005-consensus-records.ts _legacy/migrations-v2/
git mv src/main/database/migrations/006-consensus-summary.ts _legacy/migrations-v2/
git mv src/main/database/migrations/007-session-mode-columns.ts _legacy/migrations-v2/
```

- [ ] **Step 2: `_legacy/migrations-v2/README.md` 작성**

```markdown
# Legacy v2 Migrations (archived 2026-04-19)

이 디렉토리는 AI Chat Arena v2의 마이그레이션 원본이다. v3(Rolestra)는 새 체인 `src/main/database/migrations/001-core.ts` ~ `011-notifications.ts`를 사용한다.

이식 매핑:
- `001-initial-schema.ts` → v3 `009-audit.ts` (audit_log 부분만)
- `003-remote-tables.ts` → v3 `010-remote.ts`
- `004-memory-enhancement.ts` → v3 `008-memory.ts`
- `005-consensus-records.ts`, `006-consensus-summary.ts`, `007-session-mode-columns.ts` → 폐기 (합의 로직은 v3 `consensus-folder-service` + `meetings`로 재설계)
- `002-recovery-tables.ts` → 폐기 (recovery는 v3에서 approval_items + queue_items로 대체)

이 파일들은 import되지 않으며 Phase R11에서 완전 삭제 예정.
```

- [ ] **Step 3: `src/main/database/migrations/index.ts` 재작성**

```typescript
import type { Migration } from '../migrator';

/**
 * v3 migration chain (Rolestra).
 * Files 001~011 are populated in Phase R2 Tasks 1-3.
 * v2 migrations archived under _legacy/migrations-v2/ (see README).
 */
export const migrations: Migration[] = [];
```

- [ ] **Step 4: `migrator.ts`에 `assertNoLegacyMigrations` 함수 추가**

```typescript
// ... 기존 imports 아래에 추가
const LEGACY_V2_IDS = new Set([
  '001-initial-schema',
  '002-recovery-tables',
  '003-remote-tables',
  '004-memory-enhancement',
  '005-consensus-records',
  '006-consensus-summary',
  '007-session-mode-columns',
]);

/**
 * Refuses to boot against a v2 database. v3 expects a fresh schema chain.
 * Throws with guidance if any v2 migration row is present.
 */
export function assertNoLegacyMigrations(db: Database.Database): void {
  ensureMigrationsTable(db);
  const rows = db.prepare('SELECT id FROM migrations').all() as Array<{ id: string }>;
  const hit = rows.find((r) => LEGACY_V2_IDS.has(r.id));
  if (hit) {
    throw new Error(
      `Legacy v2 migration detected: ${hit.id}. ` +
      `Rolestra v3 requires a fresh DB. Move <ArenaRoot>/db/arena.sqlite aside or create a new ArenaRoot.`,
    );
  }
}
```

`runMigrations()` 첫 줄에서 `assertNoLegacyMigrations(db)` 호출. 신규 설치엔 `migrations` 테이블이 비어있으니 영향 없음.

- [ ] **Step 5: 기존 `migrator.test.ts` 보강 — legacy guard 테스트 추가**

`src/main/database/__tests__/migrator.test.ts`에 테스트 추가:

```typescript
describe('assertNoLegacyMigrations', () => {
  it('throws when a v2 migration id is present', () => {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE migrations (id TEXT PRIMARY KEY, applied_at DATETIME)');
    db.prepare('INSERT INTO migrations(id) VALUES(?)').run('001-initial-schema');
    expect(() => assertNoLegacyMigrations(db)).toThrow(/Legacy v2 migration detected/);
  });

  it('passes on a fresh DB', () => {
    const db = new Database(':memory:');
    expect(() => assertNoLegacyMigrations(db)).not.toThrow();
  });
});
```

- [ ] **Step 6: v3 빈 체인 상태에서 vitest 통과 확인**

```bash
npx vitest run src/main/database/__tests__/migrator.test.ts
```

기대: 기존 테스트가 "no migrations"에서도 정상, legacy guard 테스트 PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore(rolestra): archive v2 migrations to _legacy, prepare empty v3 chain

- Move 001~007 to _legacy/migrations-v2/ with ingestion map in README
- Rewrite migrations/index.ts as empty v3 chain
- Add assertNoLegacyMigrations guard (throws on v2 DB detection)
- Update migrator tests for guard + empty chain"
```

---

## Task 1: v3 마이그레이션 001~004 (core + projects + channels + meetings)

**Goal:** v3 DB 스키마의 상위 4개 테이블 그룹을 작성하고, 단위 테스트로 스키마(컬럼, CHECK, FK, UNIQUE, 트리거)가 모두 올바르게 생성됨을 증명한다.

**Files:**
- Create: `src/main/database/migrations/001-core.ts`
- Create: `src/main/database/migrations/002-projects.ts`
- Create: `src/main/database/migrations/003-channels.ts`
- Create: `src/main/database/migrations/004-meetings.ts`
- Modify: `src/main/database/migrations/index.ts` (위 4개 import + 배열 push)
- Create: `src/main/database/__tests__/schema-001-004.test.ts`

**Acceptance Criteria:**
- [ ] 4개 TS 파일 각각 `{ id, sql }` export (id 형식: `001-core`, `002-projects` 등)
- [ ] SQL은 spec §5.2 001~004번과 **문자별로 동일** (CHECK 제약, UNIQUE 인덱스, DM partial index, 복합 FK 포함)
- [ ] `runMigrations()` 호출 후 모든 테이블/인덱스가 sqlite_master에 존재
- [ ] `PRAGMA foreign_keys=ON` 상태에서 FK 위반 시 INSERT가 실패
- [ ] CHECK 제약 위반 INSERT 실패 (예: `projects.permission_mode='invalid'`)
- [ ] DM 중복 방지 partial unique index 동작 (같은 provider로 DM 두 개 생성 시 실패)

**Verify:** `npx vitest run src/main/database/__tests__/schema-001-004.test.ts` → 모든 테스트 PASS

**Steps:**

- [ ] **Step 1: `001-core.ts` 작성** — spec §5.2 001의 DDL을 `{id, sql}`로 랩핑

```typescript
import type { Migration } from '../migrator';

export const migration: Migration = {
  id: '001-core',
  sql: `
CREATE TABLE providers (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('api','cli','local')),
  config_json TEXT NOT NULL,
  persona TEXT DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE member_profiles (
  provider_id TEXT PRIMARY KEY REFERENCES providers(id) ON DELETE CASCADE,
  role TEXT DEFAULT '',
  personality TEXT DEFAULT '',
  expertise TEXT DEFAULT '',
  avatar_kind TEXT DEFAULT 'default',
  avatar_data TEXT DEFAULT NULL,
  status_override TEXT DEFAULT NULL,
  updated_at INTEGER NOT NULL
);
`,
};
```

- [ ] **Step 2: `002-projects.ts` 작성** — spec §5.2 002 그대로

```typescript
import type { Migration } from '../migrator';

export const migration: Migration = {
  id: '002-projects',
  sql: `
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  kind TEXT NOT NULL CHECK(kind IN ('new','external','imported')),
  external_link TEXT DEFAULT NULL,
  permission_mode TEXT NOT NULL CHECK(permission_mode IN ('auto','hybrid','approval')),
  autonomy_mode TEXT NOT NULL DEFAULT 'manual' CHECK(autonomy_mode IN ('manual','auto_toggle','queue')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','folder_missing','archived')),
  created_at INTEGER NOT NULL,
  archived_at INTEGER DEFAULT NULL
);

CREATE TABLE project_members (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  role_at_project TEXT DEFAULT NULL,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, provider_id)
);
`,
};
```

- [ ] **Step 3: `003-channels.ts` 작성** — spec §5.2 003 (DM partial unique index 포함)

```typescript
import type { Migration } from '../migrator';

export const migration: Migration = {
  id: '003-channels',
  sql: `
CREATE TABLE channels (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('system_general','system_approval','system_minutes','user','dm')),
  read_only INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE(project_id, name)
);

CREATE TABLE channel_members (
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  PRIMARY KEY (channel_id, provider_id),
  FOREIGN KEY (project_id, provider_id) REFERENCES project_members(project_id, provider_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX idx_dm_unique_per_provider
  ON channel_members(provider_id)
  WHERE project_id IS NULL;

CREATE INDEX idx_channels_project ON channels(project_id);
CREATE INDEX idx_channel_members_channel ON channel_members(channel_id);
CREATE INDEX idx_channel_members_provider ON channel_members(provider_id);
`,
};
```

- [ ] **Step 4: `004-meetings.ts` 작성** — spec §5.2 004

```typescript
import type { Migration } from '../migrator';

export const migration: Migration = {
  id: '004-meetings',
  sql: `
CREATE TABLE meetings (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  topic TEXT DEFAULT '',
  state TEXT NOT NULL,
  state_snapshot_json TEXT,
  started_at INTEGER NOT NULL,
  ended_at INTEGER DEFAULT NULL,
  outcome TEXT DEFAULT NULL CHECK(outcome IN ('accepted','rejected','aborted') OR outcome IS NULL)
);

CREATE INDEX idx_meetings_channel ON meetings(channel_id);
CREATE UNIQUE INDEX idx_meetings_active_per_channel
  ON meetings(channel_id) WHERE ended_at IS NULL;
`,
};
```

- [ ] **Step 5: `migrations/index.ts` 업데이트**

```typescript
import type { Migration } from '../migrator';
import { migration as m001 } from './001-core';
import { migration as m002 } from './002-projects';
import { migration as m003 } from './003-channels';
import { migration as m004 } from './004-meetings';

export const migrations: Migration[] = [m001, m002, m003, m004];
```

- [ ] **Step 6: 스키마 테스트 작성** — `src/main/database/__tests__/schema-001-004.test.ts`

테스트 항목:
1. `runMigrations(db)` 후 `sqlite_master`에 `providers`, `member_profiles`, `projects`, `project_members`, `channels`, `channel_members`, `meetings` 존재.
2. `PRAGMA foreign_keys=ON` 상태에서 존재하지 않는 `provider_id`로 `member_profiles` INSERT → throws.
3. `projects.permission_mode` CHECK: `'invalid'` 삽입 시도 → throws.
4. DM partial unique: 같은 `provider_id` 두 번 `channel_members(channel_id, provider_id, project_id=NULL)` INSERT → 두 번째 throws.
5. `meetings` active unique: 같은 `channel_id`로 `ended_at IS NULL` 레코드 두 번 → 두 번째 throws.
6. `channel_members` 복합 FK: `project_id` 있는데 `project_members`에 해당 쌍이 없으면 INSERT throws.

구체 코드 (핵심 부분):

```typescript
import Database from 'better-sqlite3';
import { describe, it, expect, beforeEach } from 'vitest';
import { runMigrations } from '../migrator';
import { migrations } from '../migrations';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  return db;
}

describe('v3 schema 001-004', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = makeDb();
    runMigrations(db, migrations);  // runMigrations는 2-arg overload 필요 — Task 0에서 확인·추가
  });

  it('creates all expected tables', () => {
    const names = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{name:string}>).map(r=>r.name);
    for (const t of ['providers','member_profiles','projects','project_members','channels','channel_members','meetings']) {
      expect(names).toContain(t);
    }
  });

  it('rejects unknown permission_mode', () => {
    const now = Date.now();
    expect(() => db.prepare(
      `INSERT INTO projects(id,slug,name,kind,permission_mode,created_at) VALUES(?,?,?,?,?,?)`
    ).run('p1','p1','P1','new','invalid',now)).toThrow();
  });

  it('enforces DM partial unique per provider', () => {
    const now = Date.now();
    db.prepare(`INSERT INTO providers(id,display_name,kind,config_json,created_at,updated_at) VALUES('pr1','X','cli','{}',?,?)`).run(now,now);
    db.prepare(`INSERT INTO channels(id,project_id,name,kind,created_at) VALUES(?,?,?,?,?)`).run('c1',null,'DM1','dm',now);
    db.prepare(`INSERT INTO channels(id,project_id,name,kind,created_at) VALUES(?,?,?,?,?)`).run('c2',null,'DM2','dm',now);
    db.prepare(`INSERT INTO channel_members(channel_id,project_id,provider_id) VALUES(?,?,?)`).run('c1',null,'pr1');
    expect(()=>db.prepare(`INSERT INTO channel_members(channel_id,project_id,provider_id) VALUES(?,?,?)`).run('c2',null,'pr1')).toThrow();
  });
});
```

> **Note:** `runMigrations(db, migrations)` 2-arg overload가 기존에 없다면 Task 0 Step 4에서 같이 추가(테스트 friendliness).

- [ ] **Step 7: Test 실행 + Commit**

```bash
npx vitest run src/main/database/__tests__/schema-001-004.test.ts
# PASS 확인 후
git add src/main/database/migrations/001-core.ts src/main/database/migrations/002-projects.ts src/main/database/migrations/003-channels.ts src/main/database/migrations/004-meetings.ts src/main/database/migrations/index.ts src/main/database/__tests__/schema-001-004.test.ts
git commit -m "feat(rolestra): v3 migrations 001-004 (core/projects/channels/meetings)"
```

---

## Task 2: v3 마이그레이션 005~007 (messages+FTS5 / approval / queue)

**Goal:** 메시지 본체 + FTS5 트리거 3종 + conditional FK 트리거 + approval_items + queue_items를 작성하고, FTS 검색과 author_id 트리거 동작을 테스트한다.

**Files:**
- Create: `src/main/database/migrations/005-messages.ts`
- Create: `src/main/database/migrations/006-approval-inbox.ts`
- Create: `src/main/database/migrations/007-queue.ts`
- Modify: `src/main/database/migrations/index.ts` (import 3개 추가)
- Create: `src/main/database/__tests__/schema-005-007.test.ts`

**Acceptance Criteria:**
- [ ] `005-messages.ts` SQL이 spec §5.2 005와 동일 (INSERT/UPDATE/DELETE 트리거 3종 + `messages_author_fk_check` 트리거 + FTS5 `content_rowid='rowid'` 설정)
- [ ] FTS 검색 `SELECT m.* FROM messages m JOIN messages_fts f ON f.rowid=m.rowid WHERE messages_fts MATCH 'query'` 동작
- [ ] `author_kind='member'`인데 존재하지 않는 `author_id` INSERT → 트리거에 의해 throws
- [ ] `author_kind='user'`인데 `author_id != 'user'` INSERT → throws
- [ ] `approval_items.status` CHECK 동작 (`'invalid'` 거부)
- [ ] `queue_items.order_index` 중복 허용 (PRIMARY KEY 아님) + `(project_id, status, order_index)` 인덱스 존재

**Verify:** `npx vitest run src/main/database/__tests__/schema-005-007.test.ts` → PASS

**Steps:**

- [ ] **Step 1: `005-messages.ts` 작성** — spec §5.2 005 DDL 전체 복붙 (`messages`, `messages_author_fk_check`, `messages_fts`, FTS 3 트리거)

(SQL 본문은 spec §5.2 005 참조 — 복사 시 일관된 들여쓰기 유지, CREATE 순서 동일)

- [ ] **Step 2: `006-approval-inbox.ts` 작성** — spec §5.2 006

- [ ] **Step 3: `007-queue.ts` 작성** — spec §5.2 007

- [ ] **Step 4: `migrations/index.ts` 확장**

```typescript
import { migration as m005 } from './005-messages';
import { migration as m006 } from './006-approval-inbox';
import { migration as m007 } from './007-queue';
// ... migrations 배열에 push
export const migrations: Migration[] = [m001, m002, m003, m004, m005, m006, m007];
```

- [ ] **Step 5: 테스트 작성** — `schema-005-007.test.ts`

핵심 테스트 케이스:
1. FTS 검색: 3개 메시지 INSERT → `messages_fts MATCH 'foo'` → 해당 메시지만 반환, 메시지 삭제 후 검색 결과에서 제외, UPDATE 후 content 변경 반영.
2. author trigger: `author_kind='member', author_id='ghost'` → throws; `author_kind='user', author_id='bob'` → throws; 정상 케이스는 통과.
3. approval_items CHECK: `kind='invalid'` 거부; `status='pending'` 정상.
4. queue_items: 같은 `(project_id, order_index)` 2회 INSERT 허용 (order_index는 unique 아님), status CHECK 동작.

- [ ] **Step 6: Run + Commit**

```bash
npx vitest run src/main/database/__tests__/schema-005-007.test.ts
git commit -m "feat(rolestra): v3 migrations 005-007 (messages+FTS5, approval, queue)"
```

---

## Task 3: v3 마이그레이션 008~011 (memory/audit/remote/notifications — v2 이식 포함)

**Goal:** v2의 memory·audit·remote 테이블을 v3 스키마 슬롯에 이식하고, notifications 테이블을 신규 작성한다. 이식은 DDL 그대로 복사하되 ON DELETE 동작이 `SET NULL` 또는 없음임을 보장한다(감사 유실 방지).

**Files:**
- Create: `src/main/database/migrations/008-memory.ts` (v2 `004-memory-enhancement.ts` DDL 이식)
- Create: `src/main/database/migrations/009-audit.ts` (v2 `001-initial-schema.ts`의 `audit_log` 부분만 추출)
- Create: `src/main/database/migrations/010-remote.ts` (v2 `003-remote-tables.ts` 이식)
- Create: `src/main/database/migrations/011-notifications.ts` (spec §5.2 011)
- Modify: `src/main/database/migrations/index.ts`
- Create: `src/main/database/__tests__/schema-008-011.test.ts`

**Acceptance Criteria:**
- [ ] 4개 TS 파일 존재, DDL은 소스 원본과 컬럼/타입/제약이 일치
- [ ] audit_log, remote_* 테이블의 FK `ON DELETE` 동작이 `SET NULL` 또는 없음 (audit 유실 방지)
- [ ] memory 테이블들이 FTS5 포함하여 정상 생성
- [ ] notification_prefs CHECK(`key IN (...)`) 동작
- [ ] 전체 `runMigrations` 11개 체인이 재실행 시 에러 없음 (idempotent via migrations 테이블)

**Verify:** `npx vitest run src/main/database/__tests__/schema-008-011.test.ts` + 전체 `npx vitest run src/main/database/__tests__/` → PASS

**Steps:**

- [ ] **Step 1: v2 DDL 원본 추출**

```bash
# 원본 확인 (수정 금지)
cat _legacy/migrations-v2/001-initial-schema.ts | sed -n '/audit_log/,/^\`/p'
cat _legacy/migrations-v2/003-remote-tables.ts
cat _legacy/migrations-v2/004-memory-enhancement.ts
```

`audit_log`만 떼어내 v3 `009-audit.ts`에 복사. v2 `001-initial-schema.ts`의 나머지 테이블은 버린다(대체됨).

- [ ] **Step 2~5: 4개 마이그레이션 작성**

각 파일: `{ id: '008-memory', sql: `...` }` 형태. SQL은 원본 복붙 + `ON DELETE` 검증.

- [ ] **Step 6: `migrations/index.ts` 완성**

```typescript
export const migrations: Migration[] = [m001, m002, m003, m004, m005, m006, m007, m008, m009, m010, m011];
```

- [ ] **Step 7: 테스트 작성**

1. 11개 테이블 그룹 모두 sqlite_master에 존재 (audit_log, notification_prefs, notification_log, remote_*, memory_*).
2. audit_log에 레코드 삽입 후 관련 parent row DELETE → audit row는 유지되거나 FK가 SET NULL (하드 DELETE 없음 확인).
3. 재실행 테스트: 같은 DB에 `runMigrations` 두 번 호출 → 두 번째는 no-op.
4. notification_prefs CHECK: 허용되지 않은 key 거부.

- [ ] **Step 8: Commit**

```bash
git commit -m "feat(rolestra): v3 migrations 008-011 (memory/audit/remote/notifications)

- Port v2 memory_enhancement / audit_log / remote_* DDL intact
- Add notification_prefs + notification_log per spec §5.2 011
- Idempotency verified via full-chain reruns"
```

---

## Task 4: Shared 타입 정의 (arena/project/channel/message/meeting/approval/queue/member/notification)

**Goal:** Main·Renderer가 공유할 도메인 타입 9개 파일을 `src/shared/`에 정의하고, `provider-types.ts` 등 기존 타입과 충돌하지 않게 배치한다.

**Files:**
- Create: `src/shared/arena-root-types.ts`
- Create: `src/shared/project-types.ts`
- Create: `src/shared/channel-types.ts`
- Create: `src/shared/message-types.ts`
- Create: `src/shared/meeting-types.ts`
- Create: `src/shared/approval-types.ts`
- Create: `src/shared/queue-types.ts`
- Create: `src/shared/member-profile-types.ts`
- Create: `src/shared/notification-types.ts`

**Acceptance Criteria:**
- [ ] 각 파일 export 타입/인터페이스가 DB 컬럼과 **1:1 일치** (camelCase 매핑)
- [ ] `discriminated union` 적절히 사용: `Channel.kind`, `ApprovalItem.kind`, `Project.kind`
- [ ] 모든 타입은 JSON-직렬화 가능 (Date 대신 `number` epoch ms, 정책: spec §5.2와 일치)
- [ ] `tsc --noEmit` 통과
- [ ] 순환 import 없음: shared 내부는 다른 shared만 참조, main/renderer 절대 참조 금지

**Verify:** `npx tsc --noEmit` → 오류 없음

**Steps:**

- [ ] **Step 1: `arena-root-types.ts`**

```typescript
export interface ArenaRootStatus {
  path: string;
  exists: boolean;
  writable: boolean;
  consensusReady: boolean;
  projectsCount: number;
}

export interface ProjectPaths {
  /** resolveProjectPaths() 결과. external은 link 하위 포함 */
  rootPath: string;       // <ArenaRoot>/projects/<slug>
  cwdPath: string;        // new/imported: rootPath / external: rootPath + '/link'
  metaPath: string;       // rootPath + '/.arena/meta.json'
  consensusPath: string;  // <ArenaRoot>/consensus
}
```

- [ ] **Step 2: `project-types.ts`**

```typescript
export type ProjectKind = 'new' | 'external' | 'imported';
export type PermissionMode = 'auto' | 'hybrid' | 'approval';
export type AutonomyMode = 'manual' | 'auto_toggle' | 'queue';
export type ProjectStatus = 'active' | 'folder_missing' | 'archived';

export interface Project {
  id: string;
  slug: string;
  name: string;
  description: string;
  kind: ProjectKind;
  externalLink: string | null;
  permissionMode: PermissionMode;
  autonomyMode: AutonomyMode;
  status: ProjectStatus;
  createdAt: number;
  archivedAt: number | null;
}

export interface ProjectMember {
  projectId: string;
  providerId: string;
  roleAtProject: string | null;
  addedAt: number;
}

export interface ProjectMeta {
  id: string;
  name: string;
  kind: ProjectKind;
  permissionMode: PermissionMode;
  autonomyMode: AutonomyMode;
  externalLink?: string;
  schemaVersion: 1;
}

export interface ProjectCreateInput {
  name: string;
  description?: string;
  kind: ProjectKind;
  externalPath?: string;       // kind=external 필수
  sourcePath?: string;         // kind=imported 필수
  permissionMode: PermissionMode;
  autonomyMode?: AutonomyMode;
  initialMemberProviderIds?: string[];
}
```

- [ ] **Step 3: `channel-types.ts`**

```typescript
export type ChannelKind = 'system_general' | 'system_approval' | 'system_minutes' | 'user' | 'dm';

export interface Channel {
  id: string;
  projectId: string | null; // DM은 null
  name: string;
  kind: ChannelKind;
  readOnly: boolean;
  createdAt: number;
}

export interface ChannelMember {
  channelId: string;
  projectId: string | null;
  providerId: string;
}
```

- [ ] **Step 4: `message-types.ts`**

```typescript
export type MessageAuthorKind = 'user' | 'member' | 'system';
export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

export interface MessageMeta {
  toolCalls?: unknown[];
  approvalRef?: string;
  mentions?: string[];
  [k: string]: unknown;
}

export interface Message {
  id: string;
  channelId: string;
  meetingId: string | null;
  authorId: string;               // providerId 또는 literal 'user'
  authorKind: MessageAuthorKind;
  role: MessageRole;
  content: string;
  meta: MessageMeta | null;
  createdAt: number;
}

export interface MessageSearchResult extends Message {
  /** FTS rank (작을수록 정밀), SQLite bm25 음수값 */
  rank: number;
}
```

- [ ] **Step 5: `meeting-types.ts`**

```typescript
export type MeetingOutcome = 'accepted' | 'rejected' | 'aborted';

export interface Meeting {
  id: string;
  channelId: string;
  topic: string;
  state: string;                    // SSM 상태 이름
  stateSnapshotJson: string | null;
  startedAt: number;
  endedAt: number | null;
  outcome: MeetingOutcome | null;
}
```

- [ ] **Step 6: `approval-types.ts`**

```typescript
export type ApprovalKind =
  | 'cli_permission'
  | 'mode_transition'
  | 'consensus_decision'
  | 'review_outcome'
  | 'failure_report';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired' | 'superseded';
export type ApprovalDecision = 'approve' | 'reject' | 'conditional';

export interface ApprovalItem {
  id: string;
  kind: ApprovalKind;
  projectId: string | null;
  channelId: string | null;
  meetingId: string | null;
  requesterId: string | null;
  payload: unknown;
  status: ApprovalStatus;
  decisionComment: string | null;
  createdAt: number;
  decidedAt: number | null;
}
```

- [ ] **Step 7: `queue-types.ts`**

```typescript
export type QueueItemStatus = 'pending' | 'in_progress' | 'done' | 'failed' | 'cancelled' | 'paused';

export interface QueueItem {
  id: string;
  projectId: string;
  targetChannelId: string | null;
  orderIndex: number;
  prompt: string;
  status: QueueItemStatus;
  startedMeetingId: string | null;
  startedAt: number | null;
  finishedAt: number | null;
  lastError: string | null;
  createdAt: number;
}

export interface CircuitBreakerLimits {
  filesChangedPerTurn: number;   // 기본 20
  cumulativeCliMs: number;        // 기본 30분
  consecutiveQueueRuns: number;   // 기본 5
  sameErrorRepeats: number;       // 기본 3
}

export interface CircuitBreakerState {
  filesChangedThisTurn: number;
  cumulativeCliMs: number;
  consecutiveQueueRuns: number;
  recentErrorCategory: string | null;
  recentErrorCount: number;
}
```

- [ ] **Step 8: `member-profile-types.ts`**

```typescript
export type WorkStatus = 'online' | 'connecting' | 'offline-connection' | 'offline-manual';
export type StatusOverride = 'offline-manual' | null;
export type AvatarKind = 'default' | 'custom';

export interface MemberProfile {
  providerId: string;
  role: string;
  personality: string;
  expertise: string;
  avatarKind: AvatarKind;
  avatarData: string | null;     // default: palette key, custom: relative path or base64
  statusOverride: StatusOverride;
  updatedAt: number;
}

export interface MemberView extends MemberProfile {
  displayName: string;       // providers.display_name
  persona: string;           // providers.persona (legacy fallback)
  workStatus: WorkStatus;    // runtime 판정
}
```

- [ ] **Step 9: `notification-types.ts`**

```typescript
export type NotificationKind =
  | 'new_message'
  | 'approval_pending'
  | 'work_done'
  | 'error'
  | 'queue_progress'
  | 'meeting_state';

export interface NotificationPrefs {
  [K in NotificationKind]: { enabled: boolean; soundEnabled: boolean };
}

export interface NotificationLogEntry {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  channelId: string | null;
  clicked: boolean;
  createdAt: number;
}
```

> **Note:** TypeScript의 mapped-type을 쓰려면 `NotificationPrefs`는 다음처럼:
> ```typescript
> export type NotificationPrefs = { [K in NotificationKind]: { enabled: boolean; soundEnabled: boolean } };
> ```

- [ ] **Step 10: `tsc --noEmit` + Commit**

```bash
npx tsc --noEmit
git add src/shared/{arena-root,project,channel,message,meeting,approval,queue,member-profile,notification}-types.ts
git commit -m "feat(rolestra): shared domain types for v3 (arena/project/channel/message/meeting/approval/queue/member/notification)"
```

---

## Task 5: ArenaRootService + resolveProjectPaths (R1 이식 + DB 경로 이동)

**Goal:** R1 `tools/cli-smoke/src/arena-root.ts` + `resolve-project-paths.ts` 를 `src/main/arena/`로 이식하고, `database/connection.ts`가 ArenaRoot 기반으로 DB 파일 경로를 결정하도록 수정한다.

**Files:**
- Create: `src/main/arena/arena-root-service.ts`
- Create: `src/main/arena/resolve-project-paths.ts`
- Create: `src/main/arena/__tests__/arena-root-service.test.ts`
- Create: `src/main/arena/__tests__/resolve-project-paths.test.ts`
- Modify: `src/main/database/connection.ts` (DB 경로 로직 교체)
- Modify: `src/main/index.ts` (앱 부팅 시 ArenaRootService 초기화)

**Acceptance Criteria:**
- [ ] ArenaRootService가 `~/Documents/arena/`(기본) 또는 설정값을 읽고 부재 시 생성
- [ ] 하위 디렉토리 보장: `consensus/documents`, `consensus/meetings`, `consensus/scratch`, `projects`, `db`, `logs`
- [ ] `getStatus()` → `ArenaRootStatus` (exists/writable/consensusReady/projectsCount)
- [ ] `setPath(newPath)`는 디스크를 건드리지 않고 설정에만 반영 (재시작 필요) + 이벤트 emit
- [ ] `resolveProjectPaths(project)` 순수 함수 — kind별 분기 정확
- [ ] `connection.ts`가 ArenaRoot에서 `db/arena.sqlite` 경로 해석, **fallback으로 기존 userData 경로 탐지 시 에러**(v2→v3 수동 이동 강제)
- [ ] 단위 테스트로 new/external/imported 3종 경로 모두 검증

**Verify:** `npx vitest run src/main/arena/__tests__/` → PASS

**Steps:**

- [ ] **Step 1: R1 참조 구현 복사** (수정 없이 먼저 이식)

```bash
cp tools/cli-smoke/src/arena-root.ts src/main/arena/arena-root-service.ts
cp tools/cli-smoke/src/resolve-project-paths.ts src/main/arena/resolve-project-paths.ts
```

- [ ] **Step 2: import 경로 조정 + 설정 연동**

`arena-root-service.ts` 상단 수정:
- shared 타입: `import { ArenaRootStatus } from '../../shared/arena-root-types'`
- 설정 연동: 기존 `src/main/config/` 모듈에서 `ArenaRoot`를 읽고 저장하도록 함수 추가 (이미 없다면 `config.settings.arenaRoot` 경로 추가).
- `getDefaultArenaRoot()`: `path.join(os.homedir(), 'Documents', 'arena')`
- `EventEmitter` 기반 `onPathChanged` 이벤트 노출.

핵심 인터페이스:

```typescript
export class ArenaRootService extends EventEmitter {
  private currentPath: string;
  constructor(private config: ConfigService) {
    super();
    this.currentPath = config.get('arenaRoot') ?? getDefaultArenaRoot();
  }
  async ensure(): Promise<void> { /* mkdir recursive 6개 하위 */ }
  getPath(): string { return this.currentPath; }
  getStatus(): Promise<ArenaRootStatus> { /* stat + writable test + projects 수 */ }
  setPath(newPath: string): void { this.config.set('arenaRoot', newPath); this.emit('pathChanged', newPath); }
  consensusPath(): string { return path.join(this.currentPath, 'consensus'); }
  dbPath(): string { return path.join(this.currentPath, 'db', 'arena.sqlite'); }
  projectsRoot(): string { return path.join(this.currentPath, 'projects'); }
  logsPath(): string { return path.join(this.currentPath, 'logs'); }
}
```

- [ ] **Step 3: `resolve-project-paths.ts` 이식**

```typescript
import * as path from 'path';
import type { Project } from '../../shared/project-types';
import type { ProjectPaths } from '../../shared/arena-root-types';

export function resolveProjectPaths(project: Project, arenaRoot: string): ProjectPaths {
  const rootPath = path.join(arenaRoot, 'projects', project.slug);
  const cwdPath = project.kind === 'external' ? path.join(rootPath, 'link') : rootPath;
  return {
    rootPath,
    cwdPath,
    metaPath: path.join(rootPath, '.arena', 'meta.json'),
    consensusPath: path.join(arenaRoot, 'consensus'),
  };
}
```

- [ ] **Step 4: `connection.ts` 수정**

기존 `getDatabase()`가 Electron `app.getPath('userData')` 기반이라면 수정:

```typescript
import { ArenaRootService } from '../arena/arena-root-service';

let dbInstance: Database.Database | null = null;
let arenaRoot: ArenaRootService | null = null;

export function initDatabaseRoot(svc: ArenaRootService): void {
  arenaRoot = svc;
}

export function getDatabase(): Database.Database {
  if (dbInstance) return dbInstance;
  if (!arenaRoot) throw new Error('Database access before ArenaRootService initialization');
  const dbPath = arenaRoot.dbPath();
  // fs.mkdirSync(dirname(dbPath), {recursive:true}); — ensure() 가 보장
  dbInstance = new Database(dbPath);
  dbInstance.pragma('journal_mode = WAL');
  dbInstance.pragma('foreign_keys = ON');
  return dbInstance;
}
```

기존 호출부(`app.getPath`)를 찾아서 모두 교체. 이 과정에서 기존 호출부가 깨지면 v2 Renderer와 연결된 경로(예: `conversation-repository.ts`)도 수정 대상. 단 R2 범위상 v2 Renderer 호환은 포기해도 됨(Task 21에서 일괄 처리).

- [ ] **Step 5: 앱 부팅 시 초기화** — `src/main/index.ts`

```typescript
import { ArenaRootService } from './arena/arena-root-service';
import { initDatabaseRoot } from './database/connection';
import { runMigrations } from './database/migrator';
import { migrations } from './database/migrations';

app.whenReady().then(async () => {
  const configService = new ConfigService(/* ... */);
  const arenaRoot = new ArenaRootService(configService);
  await arenaRoot.ensure();
  initDatabaseRoot(arenaRoot);
  const db = getDatabase();
  runMigrations(db, migrations);
  // ... 나머지 서비스 초기화 (Task 6 이후)
});
```

- [ ] **Step 6: 테스트 작성**

`arena-root-service.test.ts`: temp dir에 ensure → 6개 하위 폴더 존재 확인, setPath → event emit, getStatus의 projectsCount가 폴더 수와 일치.

`resolve-project-paths.test.ts`: R1 테스트를 그대로 이식하되 shared 타입 기반으로. new/external/imported 3종 경로 assertion.

- [ ] **Step 7: Commit**

```bash
git commit -m "feat(rolestra): ArenaRootService + resolveProjectPaths (R1 port)

- Port tools/cli-smoke arena utilities to src/main/arena
- Move DB path from userData to <ArenaRoot>/db/arena.sqlite
- Initialize ArenaRoot + migrations in main bootstrap"
```

---

## Task 6: PermissionService 재설계 (path-guard + realpath 재검증)

**Goal:** R1 `tools/cli-smoke/src/path-guard.ts`를 `src/main/files/permission-service.ts`로 이식하고, 기존 v2 PermissionService API는 deprecated로 내부 위임한다. path-guard의 방어 범위는 spec §7.6.1·§7.6.4에 명시된 "Main 경유 I/O만" 범위.

**Files:**
- Modify(overwrite): `src/main/files/permission-service.ts`
- Create: `src/main/files/__tests__/permission-service-v3.test.ts`
- (기존 v2 `files/` 내 다른 유틸은 유지, 호출부는 필요 시 수정)

**Acceptance Criteria:**
- [ ] `validateAccess(path)`: allowedRoots = [consensusPath, activeProject cwdPath]
- [ ] symlink/junction traversal: 실행 직전 `fs.realpathSync(path)`로 경계 재검증
- [ ] external 프로젝트의 `link`는 `realpathSync(link)`가 `projects.external_link`와 **정확 일치**해야 통과 (TOCTOU CA-3)
- [ ] `resolveForCli(projectId)`: 해당 프로젝트가 `folder_missing` 상태면 throw + audit log
- [ ] 단위 테스트: 허용 경로 통과, traversal 차단, symlink escape 차단, external 끊김 시 거부

**Verify:** `npx vitest run src/main/files/__tests__/permission-service-v3.test.ts` → PASS

**Steps:**

- [ ] **Step 1: R1 path-guard 이식** — 파일 복사 후 Main 환경에 맞게 확장

```typescript
import * as fs from 'fs';
import * as path from 'path';
import type { Project } from '../../shared/project-types';
import { resolveProjectPaths } from '../arena/resolve-project-paths';
import { ArenaRootService } from '../arena/arena-root-service';
import { ProjectRepository } from '../projects/project-repository'; // Task 8에서 생성 — 여기선 import 포워드 선언

export class PermissionService {
  constructor(
    private arenaRoot: ArenaRootService,
    private projectRepo: ProjectRepository,
  ) {}

  /** Main-routed I/O에 대해 경계 검증. CLI 내부 fs는 §7.6.1 범위 밖 */
  validateAccess(targetPath: string, activeProjectId: string | null): void {
    const realTarget = fs.realpathSync(targetPath);
    const allowed = this.getAllowedRoots(activeProjectId);
    for (const root of allowed) {
      const realRoot = fs.realpathSync(root);
      if (isPathWithin(realRoot, realTarget)) return;
    }
    throw new PermissionBoundaryError(`Access denied: ${targetPath}`);
  }

  /** CLI spawn 직전 경로 재검증 (TOCTOU CA-3) */
  resolveForCli(projectId: string): { cwd: string; consensusPath: string; project: Project } {
    const project = this.projectRepo.get(projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);
    if (project.status === 'folder_missing') {
      throw new PermissionBoundaryError(`Project folder missing: ${project.slug}`);
    }
    const paths = resolveProjectPaths(project, this.arenaRoot.getPath());
    if (project.kind === 'external') {
      if (!fs.existsSync(paths.cwdPath)) throw new PermissionBoundaryError(`External link missing: ${paths.cwdPath}`);
      const realLink = fs.realpathSync(paths.cwdPath);
      if (realLink !== project.externalLink) {
        throw new PermissionBoundaryError(`External link TOCTOU mismatch: expected ${project.externalLink}, got ${realLink}`);
      }
    }
    return { cwd: paths.cwdPath, consensusPath: paths.consensusPath, project };
  }

  private getAllowedRoots(activeProjectId: string | null): string[] {
    const roots = [this.arenaRoot.consensusPath()];
    if (activeProjectId) {
      const { cwd } = this.resolveForCli(activeProjectId);
      roots.push(cwd);
    }
    return roots;
  }
}

export class PermissionBoundaryError extends Error {}
```

`isPathWithin`은 R1 `path-guard.ts`의 구현을 보조 함수로 가져와 재사용.

- [ ] **Step 2: 테스트**

1. Arena temp root + new 프로젝트 → `validateAccess(consensus/doc.md)` 통과.
2. `validateAccess('/etc/passwd')` 차단.
3. temp external 경로 + 프로젝트 + junction → `resolveForCli` 통과, junction 교체 시 TOCTOU throw.
4. `projects.status='folder_missing'` 상태에서 throw.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(rolestra): PermissionService redesign with path-guard + realpath revalidation (R1 port)"
```

---

## Task 7: CliPermissionAdapter + CliSpawn + shell-env PATH 병합

**Goal:** R1 `permission-adapter.ts` + `cli-spawn.ts`를 `src/main/providers/cli/`로 이식하고, macOS GUI Electron 앱의 PATH 상속 문제(CA-4)를 `shell-env` 패키지로 해결한다.

**Files:**
- Create: `src/main/providers/cli/permission-adapter.ts` (R1 이식)
- Create: `src/main/providers/cli/cli-spawn.ts` (R1 이식 + shell-env 병합)
- Create: `src/main/providers/cli/shell-env.ts` (macOS PATH dump)
- Create: `src/main/providers/cli/__tests__/permission-adapter.test.ts`
- Create: `src/main/providers/cli/__tests__/cli-spawn.test.ts`
- Modify: `package.json` (dep `shell-env` 추가)
- Modify: 기존 `src/main/providers/cli/` CliProvider가 이 adapter를 사용하도록 연결 (호환성 점검은 Task 21)

**Acceptance Criteria:**
- [ ] 3 CLI adapter가 R1과 동일 arg list 생성 (Claude/Codex/Gemini × auto/hybrid/approval/read-only)
- [ ] `external + auto` 조합은 `assertExternalNotAuto`로 throw
- [ ] CliSpawn: `cwd` 강제, 환경변수 병합 순서 `process.env ← shell-env dump ← Rolestra 고정값`
- [ ] macOS가 아닌 환경에서는 `shell-env` 호출 생략 (Windows/Linux는 PATH 이미 정상)
- [ ] Windows: `cmd.exe` metacharacter 안전 처리 (`quoteWindowsCmdArg` 재사용)

**Verify:** `npx vitest run src/main/providers/cli/__tests__/` → PASS

**Steps:**

- [ ] **Step 1: deps 추가**

```bash
npm install shell-env
```

- [ ] **Step 2: R1 파일 복사**

```bash
cp tools/cli-smoke/src/permission-adapter.ts src/main/providers/cli/permission-adapter.ts
cp tools/cli-smoke/src/cli-spawn.ts src/main/providers/cli/cli-spawn.ts
```

import 경로 조정: shared types 사용, R1 내부 types.ts 의존성은 shared로 대체.

- [ ] **Step 3: `shell-env.ts` 작성**

```typescript
import shellEnv from 'shell-env';

let cached: NodeJS.ProcessEnv | null = null;

export async function getShellEnv(): Promise<NodeJS.ProcessEnv> {
  if (process.platform !== 'darwin') return {};
  if (cached) return cached;
  try {
    cached = await shellEnv();
  } catch (err) {
    console.warn('shell-env failed, falling back to process.env', err);
    cached = {};
  }
  return cached;
}
```

- [ ] **Step 4: `cli-spawn.ts` 수정 — env 병합 순서**

```typescript
export async function buildSpawnEnv(rolestraOverrides: Record<string, string>): Promise<NodeJS.ProcessEnv> {
  const shellVars = await getShellEnv();
  return { ...process.env, ...shellVars, ...rolestraOverrides };
}
```

`spawnCli(...)` 함수 내부에서 `buildSpawnEnv`를 await하고 `execFile` 옵션에 넘김. `shell: false` 유지.

- [ ] **Step 5: 테스트**

permission-adapter.test.ts — R1 테스트 이식, 3 CLI × 3 mode 모두 arg list assertion.

cli-spawn.test.ts:
1. `cwd`가 다른 경로로 spawn하면 프로세스 cwd가 정확히 강제됨 (echo pwd로 확인, mock).
2. env 병합: rolestraOverrides가 process.env + shell-env보다 우선.
3. Windows 환경(process.platform mock)에서 shell-env 호출 생략.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(rolestra): CLI layer port — permission adapter, spawn wrapper, macOS shell-env PATH merge

- 3 CLI × 3 mode adapter per spec §7.6.3 (R1 matrix validated)
- buildSpawnEnv: process.env ← shell-env dump ← rolestra overrides
- macOS-only shell-env invocation with fallback"
```

---

## Task 8: ProjectService + ProjectRepository + junction + meta.json

**Goal:** 프로젝트 3종 생성(new/external/imported) CRUD + `.arena/meta.json` 입출력 + Windows junction / POSIX symlink 생성. DB와 파일시스템 동시 일관성을 보장한다.

**Files:**
- Create: `src/main/projects/project-repository.ts`
- Create: `src/main/projects/project-service.ts`
- Create: `src/main/projects/project-meta.ts`
- Create: `src/main/projects/junction.ts` (R1 이식)
- Create: `src/main/projects/__tests__/project-service.test.ts`
- Create: `src/main/projects/__tests__/junction.test.ts`

**Acceptance Criteria:**
- [ ] `project:create` (new): slug 생성, folder mkdir, `.arena/meta.json` 쓰기, DB INSERT 트랜잭션
- [ ] `project:link-external`: external 경로 `realpathSync` → DB external_link, junction/symlink 생성 + TOCTOU 재검증, **permissionMode='auto' 거부**
- [ ] `project:import`: sourcePath 전체 복사 → new와 동일 구조
- [ ] `project:archive`: `status='archived'`, `archived_at` 기록 (hard delete 없음)
- [ ] `project:open`: 활성 프로젝트 id 설정 (ConfigService 또는 런타임 state)
- [ ] folder_missing 감지: `list` 시 폴더 부재면 `status='folder_missing'`로 업데이트
- [ ] slug 중복 방지: kebab-case 변환 + UNIQUE index 활용
- [ ] Windows/POSIX 각각 junction/symlink 테스트 (플랫폼별 skip)

**Verify:** `npx vitest run src/main/projects/__tests__/` → PASS

**Steps:**

- [ ] **Step 1: R1 junction 이식**

```bash
cp tools/cli-smoke/src/junction.ts src/main/projects/junction.ts
```

(수정 없음, 순수 파일시스템 유틸리티)

- [ ] **Step 2: `project-meta.ts` 작성**

```typescript
import * as fs from 'fs';
import * as path from 'path';
import type { ProjectMeta } from '../../shared/project-types';

export function writeProjectMeta(metaPath: string, meta: ProjectMeta): void {
  fs.mkdirSync(path.dirname(metaPath), { recursive: true });
  const tmp = `${metaPath}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
  fs.writeFileSync(tmp, JSON.stringify(meta, null, 2), 'utf8');
  fs.renameSync(tmp, metaPath);
}

export function readProjectMeta(metaPath: string): ProjectMeta | null {
  if (!fs.existsSync(metaPath)) return null;
  return JSON.parse(fs.readFileSync(metaPath, 'utf8')) as ProjectMeta;
}
```

- [ ] **Step 3: `project-repository.ts` 작성**

```typescript
import type Database from 'better-sqlite3';
import type { Project, ProjectStatus } from '../../shared/project-types';

export class ProjectRepository {
  constructor(private db: Database.Database) {}

  list(): Project[] { /* SELECT * + rowToProject mapping */ }
  get(id: string): Project | null { /* ... */ }
  getBySlug(slug: string): Project | null { /* ... */ }
  insert(p: Project): void { /* INSERT */ }
  updateStatus(id: string, status: ProjectStatus): void { /* UPDATE */ }
  archive(id: string, archivedAt: number): void { /* UPDATE status + archived_at */ }
  update(id: string, patch: Partial<Project>): Project { /* UPDATE with whitelist */ }
  addMember(projectId: string, providerId: string, roleAtProject: string | null, addedAt: number): void {}
  removeMember(projectId: string, providerId: string): void {}
  listMembers(projectId: string): Array<{ providerId: string; roleAtProject: string | null; addedAt: number }> { /* ... */ }
}
```

- [ ] **Step 4: `project-service.ts` 작성**

```typescript
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { Project, ProjectCreateInput } from '../../shared/project-types';
import { ProjectRepository } from './project-repository';
import { ArenaRootService } from '../arena/arena-root-service';
import { writeProjectMeta } from './project-meta';
import { createJunction } from './junction';
import { resolveProjectPaths } from '../arena/resolve-project-paths';

export class ProjectService {
  constructor(private repo: ProjectRepository, private arenaRoot: ArenaRootService) {}

  create(input: ProjectCreateInput): Project {
    if (input.kind === 'external' && input.permissionMode === 'auto') {
      throw new Error('external + auto is forbidden (spec §7.3)');
    }
    const slug = slugify(input.name);
    if (this.repo.getBySlug(slug)) throw new Error(`Duplicate slug: ${slug}`);
    const project: Project = {
      id: randomUUID(),
      slug,
      name: input.name,
      description: input.description ?? '',
      kind: input.kind,
      externalLink: input.kind === 'external' ? fs.realpathSync(input.externalPath!) : null,
      permissionMode: input.permissionMode,
      autonomyMode: input.autonomyMode ?? 'manual',
      status: 'active',
      createdAt: Date.now(),
      archivedAt: null,
    };
    const paths = resolveProjectPaths(project, this.arenaRoot.getPath());
    fs.mkdirSync(paths.rootPath, { recursive: true });

    if (input.kind === 'external') {
      createJunction(paths.cwdPath, project.externalLink!);
      const realLink = fs.realpathSync(paths.cwdPath);
      if (realLink !== project.externalLink) throw new Error(`Junction TOCTOU: ${realLink} != ${project.externalLink}`);
    } else if (input.kind === 'imported') {
      copyRecursive(input.sourcePath!, paths.cwdPath);
    }

    writeProjectMeta(paths.metaPath, {
      id: project.id,
      name: project.name,
      kind: project.kind,
      permissionMode: project.permissionMode,
      autonomyMode: project.autonomyMode,
      externalLink: project.externalLink ?? undefined,
      schemaVersion: 1,
    });

    this.repo.insert(project);
    if (input.initialMemberProviderIds) {
      for (const pid of input.initialMemberProviderIds) {
        this.repo.addMember(project.id, pid, null, Date.now());
      }
    }
    return project;
  }

  list(): Project[] {
    const projects = this.repo.list();
    for (const p of projects) {
      const paths = resolveProjectPaths(p, this.arenaRoot.getPath());
      if (!fs.existsSync(paths.rootPath)) this.repo.updateStatus(p.id, 'folder_missing');
    }
    return this.repo.list();
  }

  archive(id: string): void { this.repo.archive(id, Date.now()); }
  // update(), addMember(), removeMember() 등 위임
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9가-힣]+/g, '-').replace(/^-|-$/g, '').slice(0, 64) || randomUUID().slice(0,8);
}

function copyRecursive(src: string, dst: string): void { /* fs.cpSync(src, dst, { recursive: true }) Node 18+ */ }
```

- [ ] **Step 5: 테스트** — project-service.test.ts

temp ArenaRoot 생성 후:
1. `create({kind:'new', name:'My Proj', permissionMode:'hybrid'})` → DB row + 폴더 + meta.json 모두 확인.
2. 같은 이름 재시도 → throws (duplicate slug).
3. `kind:'external' + permissionMode:'auto'` → throws.
4. external 경로 지정 → junction/symlink 생성 + realpath 일치.
5. `archive` 후 `list()` 결과에 포함되지만 status='archived'.
6. 프로젝트 폴더 삭제 후 `list()` → status 자동 `folder_missing`.

junction.test.ts: R1 테스트 이식.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(rolestra): ProjectService (new/external/imported) + junction + .arena/meta.json"
```

---

## Task 9: MemberProfileService + 출근 상태 머신 + PersonaBuilder 확장

**Goal:** Provider와 연결된 구조화 프로필(role/personality/expertise/avatar) 관리 + 4종 출근 상태(`online|connecting|offline-connection|offline-manual`) 런타임 머신 + PersonaBuilder 확장.

**Files:**
- Create: `src/main/members/member-profile-repository.ts`
- Create: `src/main/members/member-profile-service.ts`
- Create: `src/main/members/persona-builder.ts` (v2 기존 파일이 있으면 이식·확장)
- Create: `src/main/members/__tests__/member-profile-service.test.ts`
- Create: `src/main/members/__tests__/persona-builder.test.ts`

**Acceptance Criteria:**
- [ ] `getProfile(providerId)` → MemberProfile (없으면 default 값으로 생성)
- [ ] `updateProfile(providerId, patch)` → 업데이트된 레코드 + `updated_at` 갱신
- [ ] `setStatus(providerId, 'online' | 'offline-manual')` → `status_override` 업데이트
- [ ] `reconnect(providerId)` → provider warmup 호출, 결과에 따라 workStatus 반환
- [ ] workStatus 판정: `status_override='offline-manual'`이면 그대로, 그 외는 runtime warmup 결과(`online|connecting|offline-connection`)
- [ ] PersonaBuilder가 structured 필드로 system prompt 생성 (spec §7.1 포맷)
- [ ] 기본 아바타 풀 8종 상수 (`member:list-avatars`용)

**Verify:** `npx vitest run src/main/members/__tests__/` → PASS

**Steps:**

- [ ] **Step 1: `member-profile-repository.ts` 작성**

```typescript
export class MemberProfileRepository {
  constructor(private db: Database.Database) {}
  get(providerId: string): MemberProfile | null {}
  upsert(profile: MemberProfile): void {}
  setStatusOverride(providerId: string, override: StatusOverride): void {}
}
```

- [ ] **Step 2: `member-profile-service.ts` 작성**

```typescript
import { ProviderRegistry } from '../providers/registry';

export class MemberProfileService {
  private runtimeStatus = new Map<string, WorkStatus>();  // provider_id → latest warmup status
  constructor(
    private repo: MemberProfileRepository,
    private providers: ProviderRegistry,
  ) {}

  getProfile(providerId: string): MemberProfile {
    return this.repo.get(providerId) ?? this.defaultProfile(providerId);
  }

  updateProfile(providerId: string, patch: Partial<MemberProfile>): MemberProfile { /* upsert */ }

  setStatus(providerId: string, target: 'online' | 'offline-manual'): void {
    const override = target === 'offline-manual' ? 'offline-manual' : null;
    this.repo.setStatusOverride(providerId, override);
  }

  async reconnect(providerId: string): Promise<WorkStatus> {
    this.runtimeStatus.set(providerId, 'connecting');
    try {
      await this.providers.warmup(providerId);
      this.runtimeStatus.set(providerId, 'online');
    } catch {
      this.runtimeStatus.set(providerId, 'offline-connection');
    }
    return this.getWorkStatus(providerId);
  }

  getWorkStatus(providerId: string): WorkStatus {
    const profile = this.repo.get(providerId);
    if (profile?.statusOverride === 'offline-manual') return 'offline-manual';
    return this.runtimeStatus.get(providerId) ?? 'offline-connection';
  }

  private defaultProfile(providerId: string): MemberProfile { /* ... */ }
}

export const DEFAULT_AVATARS = [
  { key: 'blue-dev', color: '#3b82f6', emoji: '🧑‍💻' },
  { key: 'green-design', color: '#10b981', emoji: '🎨' },
  { key: 'purple-science', color: '#8b5cf6', emoji: '🔬' },
  { key: 'amber-writer', color: '#f59e0b', emoji: '✍️' },
  { key: 'rose-mentor', color: '#ef4444', emoji: '🧑‍🏫' },
  { key: 'cyan-analyst', color: '#06b6d4', emoji: '📊' },
  { key: 'slate-ops', color: '#64748b', emoji: '⚙️' },
  { key: 'pink-product', color: '#ec4899', emoji: '💡' },
];
```

- [ ] **Step 3: `persona-builder.ts` 작성**

```typescript
export interface PersonaParts {
  displayName: string;
  role: string;
  personality: string;
  expertise: string;
  legacyPersona?: string;        // 비어있으면 새 포맷만, 있으면 하단에 append (하위호환)
}

const BASE_RULES = `[Base Conversation Rules]
You are working in a multi-AI office (Rolestra). Respect channel boundaries. Write outputs to the project cwd only. Consensus documents must be written via the Main IPC bridge, not directly.`;

const TOOL_RULES = `[Tool Usage Rules]
Use read/edit/search tools directly on files in the active project cwd. For shell commands, follow the current permission mode.`;

export function buildEffectivePersona(parts: PersonaParts): string {
  const identity = [
    '[Your Identity]',
    `Name: ${parts.displayName}`,
    parts.role && `Role: ${parts.role}`,
    parts.personality && `Personality: ${parts.personality}`,
    parts.expertise && `Expertise: ${parts.expertise}`,
  ].filter(Boolean).join('\n');

  const sections = [BASE_RULES, identity, TOOL_RULES];
  if (parts.legacyPersona) sections.push(`[Legacy Persona]\n${parts.legacyPersona}`);
  return sections.join('\n\n');
}
```

- [ ] **Step 4: 테스트**

member-profile-service.test.ts: getProfile default 생성, updateProfile, setStatus→ override 저장, reconnect mock warmup 성공/실패 케이스별 workStatus.

persona-builder.test.ts: parts 필드 조합별 output snapshot 검증.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(rolestra): MemberProfileService + work status machine + PersonaBuilder"
```

---

## Task 10: ChannelService + 시스템 채널 자동 생성

**Goal:** Channel CRUD + 프로젝트 생성 시 `#일반`, `#승인-대기`, `#회의록` 자동 생성 + DM 생성·삭제·구성원 관리.

**Files:**
- Create: `src/main/channels/channel-repository.ts`
- Create: `src/main/channels/channel-service.ts`
- Create: `src/main/channels/__tests__/channel-service.test.ts`
- Modify: `src/main/projects/project-service.ts` (create 직후 ChannelService에 시스템 채널 생성 위임)

**Acceptance Criteria:**
- [ ] `create({projectId, name, kind:'user', members})` → channel row + member 관계 저장
- [ ] `createSystemChannels(projectId)` → 3종 시스템 채널 자동 생성, kind 각각 `system_general|system_approval|system_minutes`
- [ ] 시스템 채널 삭제 시도 → throw (`cannot delete system channel`)
- [ ] DM 생성 `createDm(providerId)` → 같은 provider로 중복 시도 partial unique index에 의해 throw + 의미 있는 에러 메시지
- [ ] 멤버 추가/제거 시 complex FK 확인 (project 채널은 project_members에 해당 쌍 존재 필수)
- [ ] `channel:rename`: 시스템 채널은 이름 변경 불가

**Verify:** `npx vitest run src/main/channels/__tests__/channel-service.test.ts` → PASS

**Steps:**

- [ ] **Step 1: Repository** — 기본 CRUD + UNIQUE(project_id,name) 충돌시 DuplicateChannelError

- [ ] **Step 2: `ChannelService.createSystemChannels`**

```typescript
const SYSTEM_CHANNELS: Array<{ name: string; kind: Channel['kind']; readOnly: boolean }> = [
  { name: '일반', kind: 'system_general', readOnly: false },
  { name: '승인-대기', kind: 'system_approval', readOnly: true },
  { name: '회의록', kind: 'system_minutes', readOnly: true },
];

createSystemChannels(projectId: string): Channel[] {
  return SYSTEM_CHANNELS.map(s => this.createInternal({ projectId, name: s.name, kind: s.kind, readOnly: s.readOnly }));
}
```

- [ ] **Step 3: `ProjectService.create` 연동**

Task 8의 `create` 로직 끝에서 `this.channelService.createSystemChannels(project.id)` 호출. (ProjectService 생성자에 ChannelService 주입)

- [ ] **Step 4: DM 중복 에러 메시지화**

```typescript
try {
  // INSERT channel_members(project_id=NULL, provider_id=X)
} catch (e: any) {
  if (/UNIQUE constraint failed: idx_dm_unique_per_provider/.test(e.message)) {
    throw new DuplicateDmError(`DM already exists with provider ${providerId}`);
  }
  throw e;
}
```

- [ ] **Step 5: 테스트**

1. Project 생성 → 3개 시스템 채널 존재 확인
2. 시스템 채널 삭제 시도 → throw
3. DM 생성 + 같은 provider 재시도 → DuplicateDmError
4. User 채널 rename 가능, 시스템 rename throw
5. project_members에 없는 provider로 add-members → FK throw

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(rolestra): ChannelService + system channel auto-provision (#일반/#승인-대기/#회의록)"
```

---

## Task 11: MessageService + FTS5 검색

**Goal:** 메시지 저장 (트리거 자동화된 FTS 인덱싱) + 채널/회의별 조회 + FTS 검색 API.

**Files:**
- Create: `src/main/channels/message-repository.ts`
- Create: `src/main/channels/message-service.ts`
- Create: `src/main/channels/__tests__/message-service.test.ts`

**Acceptance Criteria:**
- [ ] `append({channelId, meetingId?, authorId, authorKind, role, content, meta?})` → INSERT 후 저장된 Message 반환
- [ ] trigger(`messages_author_fk_check`) 위반 시 의미 있는 에러 (`user author must use literal "user"`)
- [ ] `listByChannel(channelId, {limit, beforeCreatedAt?})` → 역순 페이지네이션
- [ ] `search({channelId?, projectId?, query, limit})` → FTS bm25 rank 기준 정렬, rank 필드 포함
- [ ] 메시지 삭제 시 FTS 트리거에 의해 `messages_fts`에서도 제거 (스키마 테스트에서 이미 검증됨, 여기선 service 레벨 확인)
- [ ] 메시지 저장 시 `stream:channel-message` 이벤트 emit (Task 19 stream-bridge 도입 전에는 직접 EventEmitter로 내부 발행, Task 19에서 bridge로 교체)

**Verify:** `npx vitest run src/main/channels/__tests__/message-service.test.ts` → PASS

**Steps:**

- [ ] **Step 1: Repository**

```typescript
export class MessageRepository {
  constructor(private db: Database.Database) {}
  insert(m: Omit<Message, 'createdAt'> & { createdAt?: number }): Message { /* ... */ }
  listByChannel(channelId: string, limit: number, beforeCreatedAt?: number): Message[] {}
  search(query: string, opts: { channelId?: string; projectId?: string; limit: number }): MessageSearchResult[] {
    // JOIN messages_fts + optional scope filter via channels → project_id
  }
}
```

- [ ] **Step 2: Service**

```typescript
export class MessageService extends EventEmitter {
  constructor(private repo: MessageRepository) { super(); }
  append(input: MessageAppendInput): Message {
    if (input.authorKind === 'user' && input.authorId !== 'user')
      throw new Error('user author must use literal "user"');
    const msg = this.repo.insert({
      id: randomUUID(),
      createdAt: Date.now(),
      ...input,
    });
    this.emit('message', msg);
    return msg;
  }
  list(channelId: string, opts: {limit?: number; before?: number} = {}): Message[] {
    return this.repo.listByChannel(channelId, opts.limit ?? 50, opts.before);
  }
  search(query: string, opts: {channelId?: string; projectId?: string; limit?: number} = {}): MessageSearchResult[] {
    return this.repo.search(query, { ...opts, limit: opts.limit ?? 30 });
  }
}
```

- [ ] **Step 3: 테스트**

1. append 정상 → INSERT 반영 + event 발행.
2. user author 리터럴 체크.
3. 3건 append 후 list → 최신순 3건.
4. FTS 검색: "foo bar"를 포함한 메시지만 반환.
5. 채널 필터: channelId로 scope.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(rolestra): MessageService + FTS5 search (channel + project scope)"
```

---

## Task 12: MeetingService + SsmContext 확장 통합 지점

**Goal:** Meeting CRUD + 채널당 1 active 보장 + SSM 엔진에 v3 ctx 필드 주입.

**Files:**
- Create: `src/main/meetings/meeting-repository.ts`
- Create: `src/main/meetings/meeting-service.ts`
- Create: `src/main/meetings/__tests__/meeting-service.test.ts`
- Modify: `src/main/engine/` (SsmContext 타입 정의 파일 — 구체 위치는 Grep으로 확인 후 수정)

**Acceptance Criteria:**
- [ ] `start({channelId, topic})` → 같은 채널 active meeting 존재 시 throw
- [ ] `finish(id, outcome, snapshotJson)` → `ended_at`, `outcome`, `state_snapshot_json` 기록
- [ ] `getActive(channelId)` → `Meeting | null`
- [ ] `updateState(id, state, snapshotJson)` → 매 SSM transition마다 호출 가능
- [ ] `SsmContext`에 `meetingId/channelId/projectId/projectPath/permissionMode/autonomyMode` 6개 필드 추가 (선택 아닌 필수)
- [ ] 기존 SSM 엔진 호출부가 새 ctx 필드 없이는 컴파일 에러 — 모두 수정 (R2 내 일괄)

**Verify:** `npx vitest run src/main/meetings/__tests__/` → PASS, `npx tsc --noEmit` 전체 통과

**Steps:**

- [ ] **Step 1: Meeting Repository/Service** — active unique index 활용, 위반 시 AlreadyActiveMeetingError

- [ ] **Step 2: SsmContext 타입 확장**

Grep으로 기존 ctx 정의 위치 확인:
```bash
grep -rn "SsmContext\|SSMContext" src/main/engine src/shared
```

기존 interface에 6개 필드 추가:
```typescript
meetingId: string;
channelId: string;
projectId: string;
projectPath: string;
permissionMode: PermissionMode;
autonomyMode: AutonomyMode;
```

기존 SSM 호출부에서 이 필드를 만들어 전달하도록 모두 수정. (컴파일 에러가 안내)

- [ ] **Step 3: 테스트**

1. start 성공 후 같은 channel 두 번 start → throw.
2. finish 후 getActive → null.
3. updateState → state_snapshot_json 반영.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(rolestra): MeetingService + SsmContext v3 fields (projectId/channelId/meetingId/projectPath/permissionMode/autonomyMode)"
```

---

## Task 13: ApprovalService (5종 kind)

**Goal:** 승인 항목 5종(cli_permission/mode_transition/consensus_decision/review_outcome/failure_report) 생성·결정·조회 + 감사 유실 방지(`hard DELETE 금지`, `expired/superseded`만 사용).

**Files:**
- Create: `src/main/approvals/approval-repository.ts`
- Create: `src/main/approvals/approval-service.ts`
- Create: `src/main/approvals/__tests__/approval-service.test.ts`

**Acceptance Criteria:**
- [ ] `create({kind, projectId?, channelId?, meetingId?, requesterId?, payload})` → 새 레코드, status='pending'
- [ ] `decide(id, 'approve'|'reject'|'conditional', comment?)` → status 업데이트 + decision_comment + decided_at
- [ ] `list({status?, projectId?})` → 필터링된 배열
- [ ] `expire(id)` / `supersede(id)` → hard delete 대체 (예: 같은 대상에 대한 새 요청 발행 시 이전 요청 supersede)
- [ ] `ApprovalRepository.delete`는 **존재하지 않음** (컴파일 타임에 방어)
- [ ] 이미 decided된 항목에 `decide` 재호출 → throw
- [ ] 서비스 이벤트: `approval:created`, `approval:decided` (Task 19에서 stream으로 교체)

**Verify:** `npx vitest run src/main/approvals/__tests__/` → PASS

**Steps:**

- [ ] **Step 1: Repository**

```typescript
export class ApprovalRepository {
  constructor(private db: Database.Database) {}
  insert(item: ApprovalItem): void {}
  updateStatus(id: string, status: ApprovalStatus, comment: string | null, decidedAt: number | null): void {}
  list(filter: { status?: ApprovalStatus; projectId?: string }): ApprovalItem[] {}
  get(id: string): ApprovalItem | null {}
  // delete: 의도적 미구현
}
```

- [ ] **Step 2: Service**

```typescript
export class ApprovalService extends EventEmitter {
  constructor(private repo: ApprovalRepository) { super(); }

  create(input: Omit<ApprovalItem, 'id'|'status'|'createdAt'|'decidedAt'|'decisionComment'>): ApprovalItem {
    const item: ApprovalItem = {
      ...input,
      id: randomUUID(),
      status: 'pending',
      decisionComment: null,
      createdAt: Date.now(),
      decidedAt: null,
    };
    this.repo.insert(item);
    this.emit('created', item);
    return item;
  }

  decide(id: string, decision: ApprovalDecision, comment?: string): ApprovalItem {
    const item = this.repo.get(id);
    if (!item) throw new Error(`Approval not found: ${id}`);
    if (item.status !== 'pending') throw new Error(`Already decided: ${id}`);
    const newStatus: ApprovalStatus = decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : 'approved';
    this.repo.updateStatus(id, newStatus, comment ?? null, Date.now());
    const updated = this.repo.get(id)!;
    this.emit('decided', { item: updated, decision, comment });
    return updated;
  }

  expire(id: string): void { this.repo.updateStatus(id, 'expired', null, Date.now()); }
  supersede(id: string): void { this.repo.updateStatus(id, 'superseded', null, Date.now()); }
}
```

`conditional`은 `decision='conditional'`이나 status는 `approved`로 치환(spec §7.7 "허가는 되고 조건이 시스템 메시지로 주입"). comment는 그대로 저장, decided 이벤트에 `decision`을 함께 실어 후속 리스너가 시스템 메시지 주입.

- [ ] **Step 3: 테스트**

1. create → list(status='pending') 반환.
2. decide approve → status='approved', decided_at 설정.
3. 이미 decided 재호출 → throw.
4. supersede → status='superseded', audit 보존(레코드 존재 유지).

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(rolestra): ApprovalService with 5 kinds + supersede/expire (no hard delete)"
```

---

## Task 14: ConsensusFolderService (atomic rename + advisory lock)

**Goal:** `<ArenaRoot>/consensus/` 동시 쓰기 race 방지. spec §9: atomic rename + advisory lock + 타임아웃 10s + stale lock 자동 제거.

**Files:**
- Create: `src/main/consensus/consensus-folder-service.ts`
- Create: `src/main/consensus/__tests__/consensus-folder-service.test.ts`

**Acceptance Criteria:**
- [ ] `writeDocument(name, content)`: `.tmp.<pid>-<rnd>` → fsync → rename
- [ ] `withLock(name, fn)`: `name.lock` sentinel (mkdir-based) 획득 후 fn 실행, 종료 시 해제
- [ ] 다른 프로세스가 같은 name에 lock 보유 시 10s 대기 후 throw (타임아웃)
- [ ] stale lock(소유 pid 프로세스 없음 + mtime > 30s) 자동 제거
- [ ] 동시 2개 write가 직렬화되어 한 파일만 최종 저장 (마지막 승자)
- [ ] 테스트: child_process로 2개 writer 동시 실행 → 둘 다 성공(직렬), 결과 파일 존재

**Verify:** `npx vitest run src/main/consensus/__tests__/` → PASS

**Steps:**

- [ ] **Step 1: 구현**

```typescript
import * as fs from 'fs';
import * as path from 'path';

export class ConsensusFolderService {
  constructor(private consensusRoot: string) {}

  async writeDocument(relPath: string, content: string): Promise<void> {
    const full = path.join(this.consensusRoot, 'documents', relPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    await this.withLock(full, async () => {
      const tmp = `${full}.tmp.${process.pid}-${Math.random().toString(36).slice(2)}`;
      fs.writeFileSync(tmp, content, 'utf8');
      const fd = fs.openSync(tmp, 'r+');
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fs.renameSync(tmp, full);
    });
  }

  async withLock<T>(target: string, fn: () => Promise<T>): Promise<T> {
    const lockPath = `${target}.lock`;
    const start = Date.now();
    while (true) {
      try {
        fs.mkdirSync(lockPath);
        fs.writeFileSync(path.join(lockPath, 'pid'), String(process.pid));
        break;
      } catch (e: any) {
        if (e.code !== 'EEXIST') throw e;
        if (this.isStale(lockPath)) {
          this.removeLock(lockPath);
          continue;
        }
        if (Date.now() - start > 10_000) throw new Error(`Lock timeout: ${lockPath}`);
        await new Promise(r => setTimeout(r, 100));
      }
    }
    try { return await fn(); } finally { this.removeLock(lockPath); }
  }

  private isStale(lockPath: string): boolean {
    try {
      const pidFile = path.join(lockPath, 'pid');
      const pid = Number(fs.readFileSync(pidFile, 'utf8'));
      if (!pid) return true;
      try { process.kill(pid, 0); } catch { return true; }  // no such process
      const st = fs.statSync(lockPath);
      return (Date.now() - st.mtimeMs) > 30_000;
    } catch { return true; }
  }

  private removeLock(lockPath: string): void {
    try { fs.rmSync(lockPath, { recursive: true, force: true }); } catch {}
  }
}
```

- [ ] **Step 2: 테스트**

1. `writeDocument('doc.md', 'hello')` → 파일 존재, `.tmp` 없음.
2. `withLock` 동시 호출 (Promise.all 2개) → 양쪽 순차 실행 (순서는 비결정적이지만 둘 다 완료).
3. stale lock 시뮬레이션: 임의 pid(99999) 기록 후 withLock 호출 → stale 감지 후 진행.
4. 10초 타임아웃: lock 획득한 프로세스가 release 안 하는 시나리오 mock → throw.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(rolestra): ConsensusFolderService atomic rename + advisory lock (spec §9)"
```

---

## Task 15: QueueService + CircuitBreaker (4종 상한)

**Goal:** `queue_items` CRUD + 순서 유지(order_index 소수 간격) + circuit breaker 4종 감지 (턴당 파일 변경 20 / 누적 30분 / 큐 연속 5 / 같은 에러 3회) + 발동 시 manual 다운그레이드.

**Files:**
- Create: `src/main/queue/queue-repository.ts`
- Create: `src/main/queue/queue-service.ts`
- Create: `src/main/queue/circuit-breaker.ts`
- Create: `src/main/queue/__tests__/queue-service.test.ts`
- Create: `src/main/queue/__tests__/circuit-breaker.test.ts`

**Acceptance Criteria:**
- [ ] `add(projectId, prompt, targetChannelId?)` → order_index는 마지막 + 1000
- [ ] `reorder(projectId, orderedIds)` → 1000, 2000, 3000... 으로 재계산
- [ ] `next(projectId)` → pending 중 가장 작은 order_index의 item (status=in_progress로 원자 전환)
- [ ] `complete(id, meetingId, success)` → status 'done' 또는 'failed'
- [ ] `cancel(id)` → pending만 cancelled, in_progress는 연결된 meeting abort 요청 이벤트 emit
- [ ] 앱 재시작 시 `recoverInProgress()` → in_progress를 pending으로 되돌림
- [ ] CircuitBreaker 4종 tracker:
  - `recordFileChanges(n)` → n이 20 초과면 breaker fire
  - `recordCliElapsed(ms)` → 누적 30분 초과 시 fire
  - `recordQueueStart()` → 5 연속 시 fire
  - `recordError(category)` → 같은 category 3 연속 시 fire
- [ ] Breaker fire 시 이벤트 emit(`breaker:fired`), caller가 autonomyMode을 `manual`로 바꾸고 approval_item 생성

**Verify:** `npx vitest run src/main/queue/__tests__/` → PASS

**Steps:**

- [ ] **Step 1: `circuit-breaker.ts`**

```typescript
import { EventEmitter } from 'events';
import type { CircuitBreakerLimits, CircuitBreakerState } from '../../shared/queue-types';

export const DEFAULT_LIMITS: CircuitBreakerLimits = {
  filesChangedPerTurn: 20,
  cumulativeCliMs: 30 * 60 * 1000,
  consecutiveQueueRuns: 5,
  sameErrorRepeats: 3,
};

export class CircuitBreaker extends EventEmitter {
  private state: CircuitBreakerState = {
    filesChangedThisTurn: 0,
    cumulativeCliMs: 0,
    consecutiveQueueRuns: 0,
    recentErrorCategory: null,
    recentErrorCount: 0,
  };
  constructor(private limits: CircuitBreakerLimits = DEFAULT_LIMITS) { super(); }

  resetTurn(): void { this.state.filesChangedThisTurn = 0; }

  recordFileChanges(n: number): void {
    this.state.filesChangedThisTurn += n;
    if (this.state.filesChangedThisTurn > this.limits.filesChangedPerTurn) {
      this.fire('files_per_turn', { count: this.state.filesChangedThisTurn });
    }
  }
  recordCliElapsed(ms: number): void {
    this.state.cumulativeCliMs += ms;
    if (this.state.cumulativeCliMs > this.limits.cumulativeCliMs) this.fire('cumulative_cli_ms', { ms: this.state.cumulativeCliMs });
  }
  recordQueueStart(): void {
    this.state.consecutiveQueueRuns += 1;
    if (this.state.consecutiveQueueRuns >= this.limits.consecutiveQueueRuns) this.fire('queue_streak', { count: this.state.consecutiveQueueRuns });
  }
  confirmContinue(): void { this.state.consecutiveQueueRuns = 0; }

  recordError(category: string): void {
    if (this.state.recentErrorCategory === category) this.state.recentErrorCount += 1;
    else { this.state.recentErrorCategory = category; this.state.recentErrorCount = 1; }
    if (this.state.recentErrorCount >= this.limits.sameErrorRepeats) this.fire('same_error', { category, count: this.state.recentErrorCount });
  }
  clearError(): void { this.state.recentErrorCategory = null; this.state.recentErrorCount = 0; }

  private fire(reason: string, detail: unknown): void { this.emit('fired', { reason, detail }); }
}
```

- [ ] **Step 2: Queue Repository/Service**

```typescript
export class QueueService extends EventEmitter {
  constructor(private repo: QueueRepository) { super(); }

  add(projectId: string, prompt: string, targetChannelId?: string): QueueItem {
    const last = this.repo.lastOrderIndex(projectId);
    const item: QueueItem = {
      id: randomUUID(),
      projectId,
      targetChannelId: targetChannelId ?? null,
      orderIndex: (last ?? 0) + 1000,
      prompt,
      status: 'pending',
      startedMeetingId: null,
      startedAt: null,
      finishedAt: null,
      lastError: null,
      createdAt: Date.now(),
    };
    this.repo.insert(item);
    this.emit('changed', { projectId });
    return item;
  }

  reorder(projectId: string, orderedIds: string[]): void {
    this.repo.db.transaction(() => {
      orderedIds.forEach((id, i) => this.repo.setOrder(id, (i + 1) * 1000));
    })();
    this.emit('changed', { projectId });
  }

  claimNext(projectId: string): QueueItem | null {
    return this.repo.db.transaction(() => {
      const next = this.repo.nextPending(projectId);
      if (!next) return null;
      this.repo.setStatus(next.id, 'in_progress', Date.now());
      return { ...next, status: 'in_progress', startedAt: Date.now() };
    })();
  }

  complete(id: string, meetingId: string | null, success: boolean, error?: string): void {
    this.repo.finish(id, success ? 'done' : 'failed', meetingId, error ?? null, Date.now());
    this.emit('changed', { id });
  }

  cancel(id: string): void { /* pending → cancelled; in_progress → emit abort-request */ }
  pause(projectId: string): void { /* batch: pending → paused */ }
  resume(projectId: string): void { /* batch: paused → pending */ }
  recoverInProgress(): number { /* on app start: UPDATE status='pending' WHERE status='in_progress' */ }
}
```

- [ ] **Step 3: 테스트**

queue-service.test.ts:
1. add 3건 → order_index 1000/2000/3000.
2. reorder → 재계산.
3. claimNext → 첫 항목 status='in_progress'.
4. complete(success) → status='done'.
5. cancel pending → status='cancelled'.
6. recoverInProgress(in_progress 남긴 DB) → pending으로 복원.

circuit-breaker.test.ts:
1. recordFileChanges(21) 1회 → fire.
2. 5연속 recordQueueStart → fire.
3. 같은 category 3번 record → fire, 다른 category 중간 끼면 카운터 리셋.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(rolestra): QueueService + CircuitBreaker (4 limits per spec §8 CB-5, CD-2)"
```

---

## Task 16: NotificationService (Electron Notification + DB 로그)

**Goal:** OS 알림(Windows Action Center / macOS Notification Center) + 포커스 체크 + DB 로그 + 설정 preferences.

**Files:**
- Create: `src/main/notifications/notification-repository.ts`
- Create: `src/main/notifications/notification-service.ts`
- Create: `src/main/notifications/__tests__/notification-service.test.ts`

**Acceptance Criteria:**
- [ ] `show({kind, title, body, channelId?})` → 포커스 잃었을 때만 OS 알림 + DB 로그
- [ ] `prefs.enabled === false`이면 skip (로그에도 기록 안 함)
- [ ] 클릭 시 `stream:notification-clicked` IPC emit (포커스 + 채널 라우팅 정보 전달)
- [ ] `getPrefs()` / `updatePrefs(patch)` → notification_prefs row 관리 (없으면 기본값 insert)
- [ ] `testNotification(kind)` → 포커스 여부 무시하고 강제 발송 (설정 UI용)
- [ ] Electron 환경이 아닌 테스트 환경에서도 서비스 생성 가능 (BrowserWindow/Notification mock 주입)

**Verify:** `npx vitest run src/main/notifications/__tests__/` → PASS

**Steps:**

- [ ] **Step 1: Repository**

```typescript
export class NotificationRepository {
  constructor(private db: Database.Database) {}
  getPrefs(): NotificationPrefs {}
  upsertPrefs(patch: Partial<NotificationPrefs>): NotificationPrefs {}
  insertLog(entry: NotificationLogEntry): void {}
  markClicked(id: string): void {}
}
```

첫 로드 시 notification_prefs에 6개 kind 기본 row 없음 → insert default(enabled=1, sound=1).

- [ ] **Step 2: Service**

```typescript
import { Notification as ElectronNotification, BrowserWindow } from 'electron';

export interface NotifierAdapter {
  isAnyWindowFocused(): boolean;
  notify(title: string, body: string): { onClick(cb: () => void): void };
}

export class NotificationService extends EventEmitter {
  constructor(private repo: NotificationRepository, private adapter: NotifierAdapter) { super(); }
  show(input: { kind: NotificationKind; title: string; body: string; channelId?: string; force?: boolean }): void {
    const prefs = this.repo.getPrefs()[input.kind];
    if (!prefs.enabled) return;
    if (!input.force && this.adapter.isAnyWindowFocused()) return;
    const id = randomUUID();
    this.repo.insertLog({ id, kind: input.kind, title: input.title, body: input.body, channelId: input.channelId ?? null, clicked: false, createdAt: Date.now() });
    const handle = this.adapter.notify(input.title, input.body);
    handle.onClick(() => {
      this.repo.markClicked(id);
      this.emit('clicked', { id, channelId: input.channelId });
    });
  }
  getPrefs() { return this.repo.getPrefs(); }
  updatePrefs(patch: Partial<NotificationPrefs>) { return this.repo.upsertPrefs(patch); }
  test(kind: NotificationKind) { this.show({ kind, title: 'Rolestra 테스트', body: 'OS 알림 확인용', force: true }); }
}
```

ElectronNotifierAdapter(prod), MockNotifierAdapter(test) 구현 분리.

- [ ] **Step 3: 테스트** — Mock adapter로 focus=true/false 케이스, enabled=false skip, test() force 발송.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(rolestra): NotificationService with Electron adapter + DB log + prefs"
```

---

## Task 17: IPC 타입·스키마 확장 (IpcChannelMap + zod)

**Goal:** spec §6의 IPC 채널 세트를 `IpcChannelMap`에 추가하고, 각 요청/응답의 zod 스키마를 `ipc-schemas.ts`에 정의한다. stream 이벤트 8종 타입도 정의.

**Files:**
- Modify: `src/shared/ipc-types.ts` (채널 9 도메인 세트 추가)
- Modify: `src/shared/ipc-schemas.ts` (zod 스키마 추가)
- Create: `src/shared/stream-events.ts` (stream:* 이벤트 payload 타입 + discriminated union)
- Create: `src/shared/__tests__/ipc-schemas-v3.test.ts`

**Acceptance Criteria:**
- [ ] `IpcChannelMap` 확장: 40개 이상 신규 채널 (project 7, channel 7, member 5, approval 2, notification 3, arena-root 3, queue 6, meeting 1, message 3)
- [ ] zod 스키마 per 채널 (개발 모드 엄격 검증, 프로덕션 passthrough)
- [ ] Stream 이벤트 타입 8종 (`stream:channel-message` 등) — discriminated union `type` 필드
- [ ] 기존 v2 채널은 그대로 유지 (v2 UI 호환)
- [ ] `tsc --noEmit` 통과

**Verify:** `npx vitest run src/shared/__tests__/ipc-schemas-v3.test.ts` → PASS, `npx tsc --noEmit` 전체 통과

**Steps:**

- [ ] **Step 1: `ipc-types.ts` 확장** — `IpcChannelMap`에 entry 추가

각 entry 포맷:
```typescript
'project:list': { request: void; response: Project[] };
'project:create': { request: ProjectCreateInput; response: Project };
// ... 40+
```

spec §6의 채널 목록을 그대로 옮기고, request/response 타입은 Task 4에서 만든 shared types를 사용.

- [ ] **Step 2: `ipc-schemas.ts` 확장**

```typescript
import { z } from 'zod';

export const projectKindSchema = z.enum(['new','external','imported']);
export const permissionModeSchema = z.enum(['auto','hybrid','approval']);
export const autonomyModeSchema = z.enum(['manual','auto_toggle','queue']);

export const projectCreateSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  kind: projectKindSchema,
  externalPath: z.string().optional(),
  sourcePath: z.string().optional(),
  permissionMode: permissionModeSchema,
  autonomyMode: autonomyModeSchema.optional(),
  initialMemberProviderIds: z.array(z.string()).optional(),
}).refine(
  (v) => !(v.kind === 'external' && v.permissionMode === 'auto'),
  { message: 'external + auto is forbidden' },
);

// ... 이하 생략: 채널당 request + response 스키마
```

- [ ] **Step 3: Stream 이벤트 타입**

```typescript
import type { Message } from './message-types';
import type { ApprovalItem } from './approval-types';
import type { QueueItem } from './queue-types';
import type { Project } from './project-types';

export type StreamEvent =
  | { type: 'stream:channel-message'; payload: { message: Message } }
  | { type: 'stream:member-status'; payload: { providerId: string; status: WorkStatus } }
  | { type: 'stream:approval-created'; payload: { item: ApprovalItem } }
  | { type: 'stream:approval-decided'; payload: { item: ApprovalItem; decision: ApprovalDecision; comment: string | null } }
  | { type: 'stream:project-updated'; payload: { project: Project } }
  | { type: 'stream:meeting-state-changed'; payload: { meetingId: string; channelId: string; state: string; outcome?: MeetingOutcome } }
  | { type: 'stream:queue-progress'; payload: { item: QueueItem } }
  | { type: 'stream:notification'; payload: { id: string; kind: NotificationKind; title: string; body: string; channelId: string | null } };
```

- [ ] **Step 4: Schema 테스트**

`ipc-schemas-v3.test.ts`:
1. projectCreateSchema `external + auto` → refine 에러.
2. projectCreateSchema 올바른 input → parse success.
3. 각 주요 채널 스키마 round-trip parse.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(rolestra): IPC channel map + zod schemas for v3 (9 domains, 40+ channels, 8 stream events)"
```

---

## Task 18: IPC 핸들러 9종 등록 + router 연결

**Goal:** Task 17의 채널을 실제로 처리하는 핸들러 9개를 작성하고 `src/main/ipc/router.ts`에 등록. 각 핸들러는 Task 5~16의 서비스를 호출.

**Files:**
- Create: `src/main/ipc/handlers/arena-root-handler.ts`
- Create: `src/main/ipc/handlers/project-handler.ts`
- Create: `src/main/ipc/handlers/channel-handler.ts`
- Create: `src/main/ipc/handlers/message-handler.ts`
- Create: `src/main/ipc/handlers/meeting-handler.ts`
- Create: `src/main/ipc/handlers/member-handler.ts`
- Create: `src/main/ipc/handlers/approval-handler.ts`
- Create: `src/main/ipc/handlers/notification-handler.ts`
- Create: `src/main/ipc/handlers/queue-handler.ts`
- Modify: `src/main/ipc/router.ts` (핸들러 9개 register)
- Create: `src/main/ipc/__tests__/handlers-v3.test.ts`

**Acceptance Criteria:**
- [ ] 각 핸들러는 생성자로 해당 서비스를 주입받음
- [ ] `router.ts`가 handler 9개를 등록하고 개발 모드에서 zod 검증 실행
- [ ] 요청 타입 불일치 시 `IpcError`로 structured 에러 반환
- [ ] 프로덕션 모드에서 stream 이벤트 검증 실패 시 drop + log (연속 5회 차단)
- [ ] 통합 테스트: router에 mock services 주입하고 invoke → 응답 스키마 일치

**Verify:** `npx vitest run src/main/ipc/__tests__/handlers-v3.test.ts` → PASS

**Steps:**

- [ ] **Step 1: 핸들러 템플릿 (예: project-handler)**

```typescript
import type { IpcHandlerRegistry } from '../router';
import { projectCreateSchema } from '../../../shared/ipc-schemas';
import { ProjectService } from '../../projects/project-service';

export function registerProjectHandlers(router: IpcHandlerRegistry, service: ProjectService): void {
  router.handle('project:list', async () => service.list());
  router.handle('project:create', async (input) => {
    const parsed = projectCreateSchema.parse(input);
    return service.create(parsed);
  });
  router.handle('project:link-external', async (input) => service.create({ ...input, kind: 'external' }));
  router.handle('project:import', async (input) => service.create({ ...input, kind: 'imported' }));
  router.handle('project:update', async ({ id, patch }) => service.update(id, patch));
  router.handle('project:archive', async ({ id }) => { service.archive(id); });
  router.handle('project:open', async ({ id }) => { service.setActive(id); });
  router.handle('project:set-autonomy', async ({ id, mode }) => { service.setAutonomyMode(id, mode); });
}
```

나머지 8개 핸들러도 같은 패턴 (zod parse → service 호출 → 응답).

- [ ] **Step 2: `router.ts` 수정**

```typescript
import { registerProjectHandlers } from './handlers/project-handler';
import { registerArenaRootHandlers } from './handlers/arena-root-handler';
// ... 8개 더

export function registerV3Handlers(router: IpcHandlerRegistry, services: {
  arenaRoot: ArenaRootService;
  projects: ProjectService;
  channels: ChannelService;
  messages: MessageService;
  meetings: MeetingService;
  members: MemberProfileService;
  approvals: ApprovalService;
  notifications: NotificationService;
  queue: QueueService;
}): void {
  registerArenaRootHandlers(router, services.arenaRoot);
  registerProjectHandlers(router, services.projects);
  // ... 7개 더
}
```

- [ ] **Step 3: 통합 테스트**

```typescript
describe('v3 IPC handlers', () => {
  it('project:create routes to service + returns Project', async () => {
    const service = new ProjectService(/* mock repo, mock arena */);
    const router = new TestRouter();
    registerProjectHandlers(router, service);
    const result = await router.invoke('project:create', { name:'x', kind:'new', permissionMode:'hybrid' });
    expect(result.id).toBeDefined();
  });

  it('rejects invalid input via zod', async () => {
    const router = new TestRouter();
    registerProjectHandlers(router, /* any */);
    await expect(router.invoke('project:create', { name: '', kind:'new', permissionMode:'hybrid' }))
      .rejects.toThrow(/validation/i);
  });
});
```

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(rolestra): IPC handlers for 9 domains with zod validation"
```

---

## Task 19: Stream Bridge (stream:* 이벤트 중앙화)

**Goal:** 각 서비스가 emit한 도메인 이벤트를 `StreamBridge`가 수집하여 Renderer로 전달하고, 프로덕션에서도 최소 shape validation을 보장한다.

**Files:**
- Create: `src/main/streams/stream-bridge.ts`
- Create: `src/main/streams/__tests__/stream-bridge.test.ts`
- Modify: 각 서비스(MessageService, ApprovalService, ProjectService, QueueService, MeetingService, MemberProfileService, NotificationService) — bridge에 연결 (기존 `EventEmitter.emit`을 그대로 두고 bridge가 `on(...)` 구독)

**Acceptance Criteria:**
- [ ] `StreamBridge.connect(services)` → 모든 서비스 이벤트를 bridge로 funnel
- [ ] `StreamBridge.onOutbound((event: StreamEvent) => void)` → Renderer 전송 훅
- [ ] 이벤트마다 최소 shape validation (프로덕션도 동일, `passthrough` + `type` 검사), 실패 시 drop + log
- [ ] 연속 5회 검증 실패 시 해당 `type` 일시 차단 (30s 쿨다운)
- [ ] 단위 테스트: MessageService.emit('message') → bridge.onOutbound 콜백으로 `stream:channel-message` 이벤트 전달

**Verify:** `npx vitest run src/main/streams/__tests__/` → PASS

**Steps:**

- [ ] **Step 1: 구현**

```typescript
import { EventEmitter } from 'events';
import type { StreamEvent } from '../../shared/stream-events';

type Listener = (e: StreamEvent) => void;

export class StreamBridge {
  private outbound: Listener[] = [];
  private failuresByType = new Map<string, { count: number; until: number }>();

  onOutbound(fn: Listener): void { this.outbound.push(fn); }

  emit(event: StreamEvent): void {
    if (!this.validate(event)) return;
    const state = this.failuresByType.get(event.type);
    if (state && Date.now() < state.until) return;
    for (const fn of this.outbound) {
      try { fn(event); } catch (err) { console.error('stream listener failed', err); }
    }
  }

  connect(services: {
    messages?: EventEmitter;
    approvals?: EventEmitter;
    projects?: EventEmitter;
    queue?: EventEmitter;
    meetings?: EventEmitter;
    members?: EventEmitter;
    notifications?: EventEmitter;
  }): void {
    services.messages?.on('message', (msg) => this.emit({ type: 'stream:channel-message', payload: { message: msg } }));
    services.approvals?.on('created', (item) => this.emit({ type: 'stream:approval-created', payload: { item } }));
    services.approvals?.on('decided', ({ item, decision, comment }) => this.emit({ type: 'stream:approval-decided', payload: { item, decision, comment: comment ?? null } }));
    services.projects?.on('updated', (project) => this.emit({ type: 'stream:project-updated', payload: { project } }));
    services.queue?.on('changed', () => { /* caller passes full item via separate event */ });
    services.queue?.on('progress', (item) => this.emit({ type: 'stream:queue-progress', payload: { item } }));
    services.meetings?.on('state', (payload) => this.emit({ type: 'stream:meeting-state-changed', payload }));
    services.members?.on('status', ({ providerId, status }) => this.emit({ type: 'stream:member-status', payload: { providerId, status } }));
    services.notifications?.on('shown', (n) => this.emit({ type: 'stream:notification', payload: n }));
  }

  private validate(event: StreamEvent): boolean {
    if (!event || typeof (event as any).type !== 'string' || !('payload' in event)) {
      this.recordFailure('unknown');
      return false;
    }
    return true;
  }

  private recordFailure(type: string): void {
    const s = this.failuresByType.get(type) ?? { count: 0, until: 0 };
    s.count += 1;
    if (s.count >= 5) { s.until = Date.now() + 30_000; s.count = 0; }
    this.failuresByType.set(type, s);
  }
}
```

- [ ] **Step 2: 기존 서비스 연결**

`src/main/index.ts`에서 bridge를 생성하고 `bridge.connect({ messages, approvals, ... })` 호출. `onOutbound`는 Electron `webContents.send`로 위임.

- [ ] **Step 3: 테스트**

1. MessageService.append → bridge onOutbound 콜백에 `stream:channel-message` 이벤트 전달.
2. Invalid shape(`{ payload: {} }`) 5회 → 이후 30s 차단.
3. 정상 이벤트 → 차단 해제 후 통과.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(rolestra): StreamBridge centralizing stream:* events with production shape validation"
```

---

## Task 20: SSM 엔진 통합 (v3 ctx + 사이드이펙트 리스너 + circuit breaker)

**Goal:** 기존 SSM(12상태) 엔진이 v3 서비스(메시지 저장, 회의 상태 업데이트, approval 생성, 알림 발송, circuit breaker 판정)와 연동되도록 bridge를 심는다. SSM 상태/이벤트 체계는 변경하지 않는다(재사용).

**Files:**
- Modify: `src/main/engine/` 내 SSM 관련 파일 (구체 위치 Grep 필요)
- Create: `src/main/engine/v3-side-effects.ts` (신규 이벤트 리스너 모듈)
- Create: `src/main/engine/__tests__/v3-side-effects.test.ts`

**Acceptance Criteria:**
- [ ] SSM 생성 시 `SsmContext`에 6개 v3 필드 주입 (Task 12에서 타입 확장 완료)
- [ ] 리스너 4종:
  - `onMessage(ctx, msg)` → MessageService.append + StreamBridge (중복 emit 방지: MessageService 내부 emit만 사용)
  - `onStateChange(ctx, state, snapshot)` → MeetingService.updateState + bridge
  - `onPermissionAction(ctx, grant_worker)` → approval 로그 + CLI respawn 훅
  - `onFinal(ctx, outcome)` → `#회의록` 자동 포스팅 + work_done 알림
- [ ] Circuit breaker가 `ExecutionService.filesChangedInTurn` 콜백을 수신 → 초과 시 `autonomyMode`을 `manual`로 강제 + approval_item 생성 + OS 알림
- [ ] 기존 v2 SSM 테스트가 여전히 통과 (v3 리스너는 optional 연결)

**Verify:** `npx vitest run src/main/engine/__tests__/` → PASS (기존 + 신규 모두)

**Steps:**

- [ ] **Step 1: SSM ctx 확장 지점 확인**

```bash
grep -rn "SsmContext\|interface.*Context" src/main/engine
```

확인 후 interface 수정(Task 12 Step 2 참조). 호출부 일괄 수정 — 누락 시 tsc 에러.

- [ ] **Step 2: `v3-side-effects.ts` 작성**

```typescript
import { MessageService } from '../channels/message-service';
import { MeetingService } from '../meetings/meeting-service';
import { ApprovalService } from '../approvals/approval-service';
import { NotificationService } from '../notifications/notification-service';
import { ProjectService } from '../projects/project-service';
import { CircuitBreaker } from '../queue/circuit-breaker';
import type { SsmContext } from './ssm-context';

export function wireV3SideEffects(engine: SsmEngine, deps: {
  messages: MessageService;
  meetings: MeetingService;
  approvals: ApprovalService;
  notifications: NotificationService;
  projects: ProjectService;
  breaker: CircuitBreaker;
}): void {
  engine.on('message', (ctx: SsmContext, msg) => {
    deps.messages.append({
      channelId: ctx.channelId,
      meetingId: ctx.meetingId,
      authorId: msg.authorId,
      authorKind: msg.authorKind,
      role: msg.role,
      content: msg.content,
      meta: msg.meta ?? null,
    });
  });

  engine.on('state', (ctx: SsmContext, payload) => {
    deps.meetings.updateState(ctx.meetingId, payload.state, JSON.stringify(payload.snapshot));
  });

  engine.on('permissionAction', (ctx: SsmContext, action) => {
    deps.approvals.create({
      kind: 'cli_permission',
      projectId: ctx.projectId,
      channelId: ctx.channelId,
      meetingId: ctx.meetingId,
      requesterId: action.requesterId,
      payload: action,
    });
  });

  engine.on('final', (ctx: SsmContext, outcome) => {
    const minutesChannelId = deps.projects.getSystemChannelId(ctx.projectId, 'system_minutes');
    deps.messages.append({
      channelId: minutesChannelId,
      meetingId: ctx.meetingId,
      authorId: 'user',
      authorKind: 'system',
      role: 'system',
      content: `회의 종료: ${outcome.topic} → ${outcome.result}`,
      meta: null,
    });
    deps.notifications.show({
      kind: 'work_done',
      title: '작업 완료',
      body: outcome.summary ?? '',
      channelId: minutesChannelId,
    });
  });

  deps.breaker.on('fired', ({ reason, detail }) => {
    // 최신 ctx 확인 후 다운그레이드
    const active = engine.getActiveContexts();
    for (const ctx of active) {
      deps.projects.setAutonomyMode(ctx.projectId, 'manual');
      deps.approvals.create({
        kind: 'failure_report',
        projectId: ctx.projectId,
        channelId: ctx.channelId,
        meetingId: ctx.meetingId,
        requesterId: null,
        payload: { reason, detail },
      });
      deps.notifications.show({
        kind: 'error',
        title: 'Circuit breaker 발동',
        body: `${reason}: 자율 모드 → manual`,
        channelId: ctx.channelId,
      });
    }
  });
}
```

- [ ] **Step 3: `src/main/index.ts`에서 `wireV3SideEffects(engine, services)` 호출**

- [ ] **Step 4: 테스트**

Mock engine/services로 이벤트 발생 시 각 서비스 메서드 호출 횟수·인자 assertion.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(rolestra): SSM v3 side-effects — message/meeting/approval/notification/breaker wiring"
```

---

## Task 21: v2 Renderer 호환성 점검 + 통합 smoke 테스트

**Goal:** 기존 v2 Renderer가 v3 Main 서비스를 호출할 때 깨지는 부분을 **명시적으로 비활성화**하고, 전체 DB 체인 + 서비스 + IPC + 엔진 리스너를 통과하는 Vitest 기반 통합 smoke를 1개 이상 추가한다.

**Files:**
- Modify: v2 Renderer에서 v3 Main과 호환되지 않는 페이지/훅에 `<LegacyUnavailable>` 배너 + 버튼 비활성 (실제 파일은 Grep 후 판단)
- Create: `src/main/__tests__/r2-integration-smoke.test.ts`
- Modify: `src/main/ipc/router.ts` — 레거시 채널은 유지하되 `logger.warn('legacy channel used:', channel)` 추가

**Acceptance Criteria:**
- [ ] 앱이 v3 스키마로 부팅되고 renderer가 열려도 throw 없음 (기능 미동작은 허용, 크래시 불가)
- [ ] 통합 smoke 시나리오:
  1. temp ArenaRoot 생성
  2. DB 마이그레이션 체인 11개 전부 실행
  3. ProjectService `create('new')` → 시스템 채널 3개 자동 생성
  4. MessageService.append → stream-bridge onOutbound 호출 횟수 ≥ 1
  5. ApprovalService.create + decide → decided 이벤트 발행
  6. QueueService add/claim/complete → orderIndex 순서 유지
  7. PermissionService.resolveForCli(project) → external+auto 거부 확인
  8. ConsensusFolderService.writeDocument → 파일 존재 + `.tmp` 없음
- [ ] 레거시 채널 호출 시 콘솔 warn + 동작은 유지
- [ ] R2 완료 시점에서 `npx vitest run` 전체 PASS

**Verify:** `npx vitest run src/main/__tests__/r2-integration-smoke.test.ts && npx vitest run` → 둘 다 PASS

**Steps:**

- [ ] **Step 1: Renderer 호환성 점검**

```bash
grep -rn "ipcRenderer.invoke\|typedInvoke" src/renderer | head -50
```

깨질 것으로 예상되는 후보: v2 `ConversationRepository` 기반 훅, workspace-handler 경유 채팅 UI. 이들은 R3에서 `_legacy/`로 이동 예정이므로 **현재 상태에서는 그대로 두되**, 앱 부팅은 가능한지 확인. 필요 시 renderer 최상단에 다음 배너:

```tsx
{!v3Ready && <div className="banner">v3 마이그레이션 진행 중 — UI는 R3에서 교체됩니다.</div>}
```

단순 배너만 추가, 기능 수정은 금지.

- [ ] **Step 2: `r2-integration-smoke.test.ts` 작성**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrator';
import { migrations } from '../database/migrations';
// ... 서비스 imports

describe('R2 integration smoke', () => {
  let tmpRoot: string;
  let db: Database.Database;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rolestra-r2-'));
    ['consensus/documents','consensus/meetings','consensus/scratch','projects','db','logs'].forEach(d =>
      fs.mkdirSync(path.join(tmpRoot, d), { recursive: true })
    );
    db = new Database(path.join(tmpRoot, 'db', 'arena.sqlite'));
    db.pragma('foreign_keys = ON');
    runMigrations(db, migrations);
  });
  afterEach(() => {
    db.close();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('full flow: migrations → services → bridge', async () => {
    // ArenaRoot mock
    const arenaRoot = { getPath: () => tmpRoot, consensusPath: () => path.join(tmpRoot,'consensus'), /* ... */ } as any;

    const projectRepo = new ProjectRepository(db);
    const channelRepo = new ChannelRepository(db);
    const messageRepo = new MessageRepository(db);
    const channelService = new ChannelService(channelRepo);
    const projectService = new ProjectService(projectRepo, arenaRoot, channelService);
    const messageService = new MessageService(messageRepo);
    const approvalService = new ApprovalService(new ApprovalRepository(db));

    // provider insert (필요)
    db.prepare(`INSERT INTO providers(id,display_name,kind,config_json,created_at,updated_at) VALUES('pr1','A','cli','{}',?,?)`).run(Date.now(),Date.now());

    const p = projectService.create({ name:'Smoke', kind:'new', permissionMode:'hybrid', initialMemberProviderIds:['pr1'] });
    expect(p.slug).toBeDefined();

    const channels = channelService.listByProject(p.id);
    expect(channels.map(c=>c.kind).sort()).toEqual(['system_approval','system_general','system_minutes']);

    const generalId = channels.find(c=>c.kind==='system_general')!.id;
    const msg = messageService.append({
      channelId: generalId,
      meetingId: null,
      authorId: 'pr1',
      authorKind: 'member',
      role: 'assistant',
      content: 'hello',
      meta: null,
    });
    expect(msg.id).toBeDefined();

    const a = approvalService.create({
      kind:'cli_permission', projectId:p.id, channelId:generalId, meetingId:null, requesterId:'pr1', payload:{summary:'x'}
    });
    const decided = approvalService.decide(a.id, 'approve');
    expect(decided.status).toBe('approved');

    // external + auto 거부
    expect(() => projectService.create({ name:'X', kind:'external', externalPath:tmpRoot, permissionMode:'auto' })).toThrow(/external \+ auto/);
  });
});
```

- [ ] **Step 3: 레거시 채널 경고 추가**

`router.ts`에서 v2에만 존재했던 채널명 세트를 상수로 두고 `handle` 호출 시 `logger.warn`. 예:

```typescript
const LEGACY_V2_CHANNELS = new Set(['workspace:load', 'cli-permission:request', /* ... */]);
router.use((channel, args) => {
  if (LEGACY_V2_CHANNELS.has(channel)) logger.warn('legacy v2 channel invoked', { channel });
});
```

- [ ] **Step 4: 전체 테스트 실행 + Commit**

```bash
npx vitest run
git add -A
git commit -m "test(rolestra): R2 integration smoke + legacy channel warnings

- End-to-end smoke through migrations → project → channels → messages → approvals
- Legacy v2 channels retained with deprecation warnings (R3 removal)
- v2 renderer receives transition banner, no crash on boot"
```

---

## Phase R2 완료 기준

- [ ] Task 0~21 모두 완료, 각 커밋 존재
- [ ] `npx vitest run` 전체 PASS (마이그레이션·서비스·IPC·통합 smoke)
- [ ] `npx tsc --noEmit` 전체 통과
- [ ] ArenaRoot가 존재하고 v3 DB 파일(`<ArenaRoot>/db/arena.sqlite`)이 생성됨
- [ ] v2 Renderer가 부팅되고(기능 제한은 OK) 크래시 없음
- [ ] R1 매트릭스 13/18 결과가 Main 레이어에서도 동일 재현 가능 (adapter 이식 후)

**R3 진입 조건:**
- 디자인 시안 락 (memory `rolestra-design-mockups.md` Step 1~4)
- spec §7.5 대시보드·§7.10 디자인 시스템·§7.2 출근 라벨 갱신 (planner 위임)
- Task 21에서 추가한 레거시 채널 경고 로그로 R3 제거 대상 식별 완료

---

## Self-Review Checklist

1. **Spec 커버리지:**
   - §5.1 ArenaRoot → Task 5
   - §5.2 001~011 → Task 0~3
   - §6 IPC 채널 + stream → Task 17, 18, 19
   - §7.1 MemberProfile → Task 9
   - §7.2 출근 상태 → Task 9
   - §7.3 Project 3종 + external+auto 금지 → Task 8
   - §7.4 Channel + system 자동 → Task 10
   - §7.6.1~§7.6.4 방어 범위 + path-guard → Task 6
   - §7.6.3 CLI adapter 이식 → Task 7
   - §7.8 OS 알림 → Task 16
   - §8 SsmContext + circuit breaker + side-effects → Task 12, 15, 20
   - §9 Consensus atomic rename + advisory lock → Task 14
   - §10 R2 범위 → 전체

2. **Placeholder/TBD 없음:** 모든 Step이 구체 코드/명령/테스트 케이스 포함. 주의: Task 18의 "나머지 8개 핸들러도 같은 패턴" 부분 — subagent가 Task 17 채널 목록을 그대로 구현해야 함을 명시했으므로 OK.

3. **타입 일관성:**
   - `Project`, `Channel`, `Message` 등 Task 4 정의를 모든 후속 태스크가 import (camelCase).
   - `PermissionMode`, `AutonomyMode`는 `projectCreateSchema` (Task 17) + DB CHECK (Task 1) + SsmContext (Task 12) 모두 동일 값 집합 사용.
   - `QueueItemStatus` Task 4 정의 = DB CHECK Task 2 값 = QueueService Task 15 값.

4. **경계 준수:**
   - Main → Renderer 참조 없음 (shared만 import).
   - Renderer → Main 직접 참조 없음 (R2는 Renderer 변경 안 함).
   - `_legacy/migrations-v2/`는 import 대상 아님.

---

## Execution Handoff

Plan 저장 완료: `docs/superpowers/plans/2026-04-18-rolestra-phase-r2.md`
Tasks persistence: `docs/superpowers/plans/2026-04-18-rolestra-phase-r2.md.tasks.json`

