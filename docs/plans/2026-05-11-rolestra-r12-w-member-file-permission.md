# Plan — R12-W 채널-단위 파일 권한 wire-up (v3 — mental model 정정 반영)

작성일: 2026-05-11
최종 갱신: 2026-05-11 (사장 mental model 정정 — 권한 단위 = 채널 1:1)
ADR: `docs/decisions/r12-w-member-file-permission.md`
목적: 사용자 보고 자기검열 발언 해소 (R12-S `PromptComposer` 미 wire-up 종결) + 채널 row 에 권한 5축 컬럼 직접 추가 + CLI argv 채널-권한 filter layer 도입.

---

## 0. Plan 전제 (v3)

ADR 확정 결정 (R12-W v3):
- **D1 = 채널 1:1** (별도 도메인 X)
- **D2 = 읽기 허용** (ALTER DEFAULT `file_read=1` + PromptComposer fallback 1줄)
- **D3 = `channels` 테이블 ALTER 5컬럼 + IPC 2채널 + 모달 섹션 2개**
- **D4 = 회의 시작 1회 + invalidation** (ChannelService `extends EventEmitter` 승격)
- **D5 = 2단계 filter** (입력 source = 채널 권한)

마이그레이션 번호 **023** (014~022 land — 다음 forward-only).

**v2 plan 대비 변경 요약:**

| 삭제 | 신설 / 수정 |
|------|----------|
| ProjectRolePermissionRepository (별도 클래스) | ChannelRepository edit (CHANNEL_COLUMNS 5개 추가 + getPermissions/updatePermissions 메서드) |
| ProjectRolePermissionService (별도 클래스) | ChannelService edit (extends EventEmitter + 권한 메서드 2개 + create 시 권한 컬럼 채우기) |
| PermissionResolver (2계층 결합) | ChannelPermissionResolver (단일 channels row lookup) |
| 프로젝트 설정 RolePermissionsTab UI | 채널 생성 모달 + 채널 설정 모달 권한 섹션 |
| `project:role-permission:list/set/reset` 3채널 | `channel:get-permissions` + `channel:update-permissions` 2채널 |
| (v2 마이그레이션 023 = CREATE TABLE) | (v3 마이그레이션 023 = ALTER 5건 + UPDATE 3건) |
| use-role-permissions hook | use-channel-permissions hook |

---

## 1. 사전 확인 결과 (코드 grep 검증)

| 항목 | 결과 | 영향 |
|------|------|------|
| `channels.role TEXT` 컬럼 | 존재 (migration 018) | backfill UPDATE 의 매핑 키. NULL = system / DM / legacy |
| 기본 부서 채널 자동 생성 코드 | `src/main/channels/channel-service.ts:795 createDepartmentChannels` | INSERT SQL 에 권한 컬럼 추가만으로 신규 채널 자동 시드 |
| `DEFAULT_DEPARTMENT_BLUEPRINT` | 5종 (`아이디어`/`기획`/`디자인=design.ux`/`구현`/`검토`) | T5 의 INSERT 권한 컬럼 매핑이 5 row 에 적용 |
| `OPTIONAL_DEPARTMENT_BLUEPRINT` | 2종 (`디자인-캐릭터`/`디자인-배경`) | 동일 분기 처리 |
| `ChannelService extends EventEmitter` | 없음 | T6 에서 승격 — MemberProfileService / ApprovalService / MessageService 와 일관 |
| `ChannelRepository.insert` SQL | `(id, project_id, name, kind, read_only, created_at, role, purpose, handoff_mode, max_rounds)` 10컬럼 | T4 에서 5컬럼 추가 → 15컬럼 |
| `ChannelRepository.transaction` | 존재 | createDepartmentChannels 가 이미 transaction 사용 — 권한 컬럼 추가 시 안전 |
| `RoleId` 10종 vs 자동 생성 5종 | `audit` / `design.ui` / `general` 은 자동 채널 없음 | 사용자 자유 채널이 role 자유 선택 (드롭다운 6 옵션: 5 부서 + `general`) |

**T1+T2 즉시 시작 가능 여부 (최종 확인):**

| 작업 | 영향 | 시작 가능? |
|------|------|-----------|
| T1 (PromptComposer fallback 1줄 + "회의록 권한 무관" 명시) | 채널 단위로 가도 fallback 메시지 동일 | **즉시 가능** |
| T2 (`PermissionSet` 공통 타입 + 카탈로그 변환 helper) | 5 axis 형태가 채널이든 부서든 동일 | **즉시 가능** |

---

## 2. 의존성 그래프 (v3 — T 번호 재할당)

```
─────────── 1차 (기반 인프라) ─────────────────────────────────
T1: PromptComposer fallback 안내 1줄 + "회의록 권한 무관" 명시
    └─ 독립 (이미 시작 가능 확인)

T2: PermissionSet 공통 타입 + 카탈로그 default 변환 helper
    └─ 독립 (이미 시작 가능 확인)

T3: migration 023 (ALTER 5건 + UPDATE 3건 + 카탈로그 sanity 테스트)
    └─ T2 의존 (PermissionSet + 카탈로그 helper 가 sanity 테스트 정본 비교에 사용)

T4: ChannelRepository edit (5컬럼 + getPermissions/updatePermissions)
    └─ T3 의존 (DB schema 후)

─────────── 2차 (서비스 + IPC) ────────────────────────────────
T5: ChannelService edit — extends EventEmitter 승격 + 권한 메서드 2개
    + createDepartmentChannels / createUserChannel 시 권한 컬럼 채우기
    └─ T2 (PermissionSet), T4 (repo 메서드) 의존

T6: ChannelPermissionResolver (channels row 단일 lookup)
    └─ T4 (repo.getPermissions) 의존

T7: IPC 핸들러 2채널 (channel:get-permissions, channel:update-permissions)
    + zod schema + router register
    └─ T5 (service) 의존

─────────── 3차 (회의 흐름 통합) ──────────────────────────────
T8: MeetingSession — permissionSnapshot 필드 + dirty flag + emitter
    구독/해제
    └─ T5 (emitter), T6 (resolver) 의존

T9: MeetingTurnExecutor — buildPermissionRules 호출 폐기, PromptComposer
    호출 + permissionSnapshot 활용
    └─ T1 (fallback 문구 final), T6, T8 의존

T10: 옛 buildPermissionRules + FilePermission 타입 삭제
     └─ T9 의존 (모든 호출자 제거 확인 후)

─────────── 3.5차 (PathGuard wire 누락 hotfix — T11 진입 전 의무) ─
T10.5.G1: CliProvider.setProjectPath 호출 wire (meeting-turn-executor)
          └─ T9 land 후 (turn-executor 안정화 후)
T10.5.G2: ssmCtx.projectPath 하드코딩 4곳 → resolveProjectPaths 직접 호출
          └─ 독립 (T9 와 병렬 가능)
T10.5.G5: permissionMode/autonomyMode 하드코딩 4곳 → project row 동기화
          └─ T10.5.G2 와 한 commit 묶음 (project lookup 둘 다 필요)

   ▶ T10.5 통합 검증 PASS 후 T11 진입 — audit 보고서 §8 옵션 C 변형

─────────── 4차 (argv filter layer) ───────────────────────────
T11: permission-flag-filter (Claude allowedTools 좁히기)
     └─ T2 의존 (PermissionSet) + **T10.5 land 의무** (입력 source = ssmCtx.projectPath
        + project.permissionMode 가 정확해야 filter 의 효과 보장)

T12: cli-provider spawn 경로 wire-up (base → filter → spawn)
     └─ T6 (resolver), T11 (filter) 의존

─────────── 5차 (Renderer UI) ─────────────────────────────────
T13: use-channel-permissions hook + zustand store (Optimistic UI)
     └─ T7 (IPC) 의존

T14: 채널 생성 모달 — 부서 template 드롭다운 + 권한 섹션
     └─ T13 의존

T15: 채널 설정 모달 — 권한 섹션 + "template 으로 리셋" 버튼
     └─ T13 의존 (T14 와 병렬 가능)

T16: i18n ko/en JSON 라벨 추가 (부서 template 6 + axis 5 + 모달 라벨)
     └─ T14, T15 의존

─────────── 6차 (composition root + verification) ─────────────
T17: index.ts DI wire-up (PromptComposer / ChannelPermissionResolver /
     ChannelService emitter / IPC handler)
     └─ T6, T7, T8, T9, T12 의존 — 모든 신규 컴포넌트 인스턴스화

T18: Vitest 회귀 + 신규 케이스
     └─ T17 의존

T19: Playwright E2E (사용자 보고 시나리오 + UI 흐름 + invalidation)
     └─ T17 의존

T20: spec §7.6 본문 갱신 (§7.6.4 신설 + 번호 시프트)
     └─ T17 land 후

T21: 문서 정합 (구현현황 / decision README / R12-S log 후속 표시)
     └─ T18, T19 PASS 후
```

병렬 가능:
- 1차: T1 + T2 동시
- 3.5차 (T10.5 hotfix block): G2+G5 가 한 commit, G1 은 T9 후. **T11 진입 전 의무**.
- 5차 (T13~T16) 는 2차 T7 만 만족하면 3/4차와 병렬 가능
- 4차 (T11/T12) 와 3차 (T8~T10) 병렬 가능 — 단 T11 은 T10.5 land 의무

크리티컬 패스 (T10.5 포함): T2 → T3 → T4 → T5 → T6 → T8 → T9 → T10.5 → T11 → T12 → T17 → T18 → T19 → T20 → T21 (15 단계)

---

## 3. 작업 분해 (v3)

### T1 — PromptComposer fallback 안내 + 회의록 권한 무관 명시

**무엇:** 능력 미부여 직원 + 부서 채널 fallback 분기에 D2 안내 1줄 + "회의록은 채널 시스템이라 권한 무관" 1줄 추가.

**영향 파일:**
- `src/main/skills/prompt-composer.ts:74-80`
- `src/main/skills/__tests__/prompt-composer.test.ts`

**신규 파일:** 0

**변경 본문:**
```ts
// 변경 후 (line 74-76):
sections.push(
  `이 채널은 ${channelLabel} 부서입니다. 부서의 일반 업무 맥락으로 응답하세요.\n` +
  `권한: 작업장 폴더 안 파일 읽기 (쓰기 / 명령 실행은 사용자가 명시적으로 지시한 경우에만).\n` +
  `참고: 회의록(#회의록 채널)은 시스템 기록이므로 파일 권한과 무관합니다.`,
);
```

**verify:** `npx vitest run src/main/skills/__tests__/prompt-composer.test.ts`

**acceptance:** fallback 케이스 snapshot 에 위 3줄 명시.

---

### T2 — PermissionSet 공통 타입 + 카탈로그 default 변환 helper

**무엇:** main/renderer/preload 공유 타입. R12-S `ToolGrant` (dot key) ↔ SQL/IPC underscore camelCase 변환.

**신규 파일:**
- `src/shared/permission-set-types.ts`
- `src/shared/__tests__/permission-set-types.test.ts`

**내용 스케치:**
```ts
import type { RoleId, ToolGrant } from './role-types';
import { SKILL_CATALOG } from './skill-catalog';

export interface PermissionSet {
  fileRead: boolean;
  fileWrite: boolean;
  commandExec: boolean;
  webSearch: boolean;
  dbRead: boolean;
}

export function toolGrantsToPermissionSet(grants: Record<ToolGrant, boolean>): PermissionSet;
export function permissionSetToToolGrants(p: PermissionSet): Record<ToolGrant, boolean>;
export function catalogDefaultFor(roleId: RoleId): PermissionSet;
export function catalogDefaultForNullRole(): PermissionSet; // = { fileRead:true, 나머지 false }
export function permissionSetsEqual(a: PermissionSet, b: PermissionSet): boolean;
export function permissionSetFromRow(row: {
  file_read: number; file_write: number; command_exec: number;
  web_search: number; db_read: number;
}): PermissionSet; // 0/1 INTEGER ↔ boolean
export function permissionSetToRow(p: PermissionSet): { /* 위 5 컬럼 0/1 */ };
```

**verify:** `npx vitest run src/shared/__tests__/permission-set-types.test.ts` (변환 idempotency + 카탈로그 lookup 5 케이스)

**acceptance:** 모든 변환 O(1) + 카탈로그 default = SKILL_CATALOG 단일 source.

---

### T3 — migration 023 + 카탈로그 sanity 테스트

**무엇:** ALTER 5건 + UPDATE 3건 + 코드 카탈로그 vs ADR 정본 표 일치 검증.

**영향 파일:**
- `src/main/database/migrations/index.ts` — m023 import + 배열 추가

**신규 파일:**
- `src/main/database/migrations/023-channel-permissions.ts` — ADR § D3 SQL 그대로
- `src/main/database/__tests__/migration-023-sanity.test.ts` — 카탈로그 ↔ migration 매핑 검증

**migration 023 본문 (ADR § D3 정본):**
```sql
ALTER TABLE channels ADD COLUMN file_read    INTEGER NOT NULL DEFAULT 1 CHECK (file_read    IN (0,1));
ALTER TABLE channels ADD COLUMN file_write   INTEGER NOT NULL DEFAULT 0 CHECK (file_write   IN (0,1));
ALTER TABLE channels ADD COLUMN command_exec INTEGER NOT NULL DEFAULT 0 CHECK (command_exec IN (0,1));
ALTER TABLE channels ADD COLUMN web_search   INTEGER NOT NULL DEFAULT 0 CHECK (web_search   IN (0,1));
ALTER TABLE channels ADD COLUMN db_read      INTEGER NOT NULL DEFAULT 0 CHECK (db_read      IN (0,1));

UPDATE channels SET db_read = 1
 WHERE role IN ('idea','planning','design.ui','design.ux',
                'design.character','design.background','implement',
                'review','audit','general');

UPDATE channels SET web_search = 1
 WHERE role IN ('idea','planning','design.ux','design.background',
                'review','audit','general');

UPDATE channels SET file_write = 1, command_exec = 1
 WHERE role = 'implement';
```

**sanity 테스트 (필수 — coding 의 정본 격차 차단):**
- migration 적용 후 가짜 channels row 10개 (role = 각 RoleId 1개씩) 삽입
- 각 row 의 권한 5컬럼이 `catalogDefaultFor(roleId)` (T2 helper) 와 정확히 일치하는지 확인
- 미스매치 시 명시 fail message: "code SKILL_CATALOG drift from migration 023 UPDATE — role=X, axis=Y, code=true, migration=false"

**verify:**
- `npx vitest run src/main/database/__tests__/migrator.test.ts`
- `npx vitest run src/main/database/__tests__/migration-023-sanity.test.ts`

**acceptance:**
- forward-only chain PASS (014~022 무손상 + 023 land).
- sanity 테스트 10 role 전부 GREEN.
- system 채널 + DM (role IS NULL) 은 file_read=1, 나머지 0 그대로.

**리스크 mitigation:**
- ADR § D3 표의 `review` 행은 코드 정본 (`src/shared/skill-catalog.ts:160-163`) 재확인 필요. sanity 테스트가 이 격차를 즉시 잡음. drift 발견 시 migration 023 의 UPDATE 표현식을 코드 정본에 맞춰 정정 후 재 land (마이그레이션 immutability 가드 우회를 위해 migration 023 land 전이 limit — T3 진행 중 sanity 미통과 시 SQL 보정).

---

### T4 — ChannelRepository edit

**무엇:** CHANNEL_COLUMNS 5개 추가 + insert SQL 확장 + 권한 메서드 2개.

**영향 파일:**
- `src/main/channels/channel-repository.ts` — edit
- `src/main/channels/__tests__/channel-repository.test.ts` — edit

**신규 파일:** 0

**변경:**
- `CHANNEL_COLUMNS` 상수에 `file_read, file_write, command_exec, web_search, db_read` 5개 추가.
- `rowToChannel` / `Channel` 타입 (shared) 에 5 boolean field 추가 (또는 `permissions: PermissionSet` 중첩 — 가독성 우선 후자 추천).
- `insert` SQL VALUES 5 placeholder 추가.
- 신규 메서드:
  ```ts
  getPermissions(channelId: string): PermissionSet | null;
  updatePermissions(channelId: string, patch: PermissionSet): boolean;
  ```

**verify:** `npx vitest run src/main/channels/__tests__/channel-repository.test.ts`

**acceptance:**
- 기존 CRUD 회귀 0.
- `getPermissions` 가 unknown channelId → null.
- `updatePermissions` 가 row 변경 시 true, 미존재 시 false.
- PermissionSet ↔ row 변환은 T2 helper 활용.

---

### T5 — ChannelService — EventEmitter 승격 + 권한 메서드 + create 시 권한 채우기

**무엇:** D4 의 핵심. EventEmitter 승격 + service surface 확장.

**영향 파일:**
- `src/main/channels/channel-service.ts` — edit
- `src/main/channels/__tests__/channel-service.test.ts` — edit

**신규 파일:** 0

**변경:**
1. `class ChannelService extends EventEmitter` 로 승격 (MemberProfileService 패턴 그대로).
2. 타입 overload (typed event map) — `'permission-changed'` event 만 정의:
   ```ts
   export const PERMISSION_CHANGED_EVENT = 'permission-changed' as const;
   export interface PermissionChangedPayload { channelId: string; }
   export interface ChannelServiceEvents {
     'permission-changed': (p: PermissionChangedPayload) => void;
   }
   ```
3. 신규 메서드:
   ```ts
   getPermissions(channelId: string): PermissionSet; // 미존재 시 throw (silent fallback 금지)
   updatePermissions(channelId: string, patch: PermissionSet): void; // emit 'permission-changed'
   ```
4. **`createDepartmentChannels` 변경** (line 795-839):
   - `channels.map` 안에서 각 채널의 권한 5컬럼을 `catalogDefaultFor(spec.role)` 로 채움.
   - `repo.insert(channel)` 호출 — repository SQL 이 T4 에서 권한 컬럼 받도록 확장됨.
5. **`createUserChannel` 변경**:
   - input 에 `permissions?: PermissionSet` 추가 (UI 의 부서 template + 미세조정 결과).
   - 미제공 시 `role` 기반 카탈로그 default 또는 NULL role 의 ALTER DEFAULT 사용.

**verify:** `npx vitest run src/main/channels/__tests__/channel-service.test.ts`

**acceptance:**
- `createDepartmentChannels` 후 5종 채널이 정확한 카탈로그 default 권한 보유 (T3 sanity 와 일치).
- `updatePermissions` 호출 시 `'permission-changed'` event 발사 + listener 가 throw 해도 service 호출자 무영향.
- `getPermissions` 가 unknown channelId → ChannelNotFoundError throw.
- 기존 ChannelService 회귀 0.

---

### T6 — ChannelPermissionResolver

**무엇:** 단일 진입점. 채널 row → PermissionSet 매핑.

**신규 파일:**
- `src/main/permissions/channel-permission-resolver.ts`
- `src/main/permissions/__tests__/channel-permission-resolver.test.ts`

**시그니처:**
```ts
export class ChannelPermissionResolver {
  constructor(private readonly repo: ChannelRepository) {}
  resolve(channelId: string): PermissionSet; // unknown → throw
}
```

**verify:** `npx vitest run src/main/permissions/__tests__/channel-permission-resolver.test.ts`

**acceptance:**
- 알려진 채널 → PermissionSet 반환.
- 알려지지 않은 채널 → throw (silent fallback 금지).
- v2 의 2계층 결합 로직이 *없음* — 단일 row lookup 만.

---

### T7 — IPC 핸들러 2채널 + zod

**무엇:** Renderer ↔ Main 권한 채널.

**영향 파일:**
- `src/shared/ipc-types.ts` — IpcChannelMap 2채널 추가
- `src/shared/ipc-schemas.ts` — 2 zod schema 추가
- `src/main/ipc/router.ts` — register

**신규 파일:**
- `src/main/ipc/handlers/channel-permission-handler.ts`
- `src/main/ipc/handlers/__tests__/channel-permission-handler.test.ts`

**채널:**
- `channel:get-permissions` `{ channelId }` → `PermissionSet`
- `channel:update-permissions` `{ channelId, fileRead, fileWrite, commandExec, webSearch, dbRead }` → `{ ok: true }`

**zod 핵심:** `channelId: z.string().uuid()`, 5 boolean axis. invalid → 명시 throw.

**verify:** `npx vitest run src/main/ipc/handlers/__tests__/channel-permission-handler.test.ts`

**acceptance:**
- 정상 입력 → service 호출 성공.
- 잘못된 channelId / boolean 아닌 axis → zod throw.
- ChannelNotFoundError → IPC 응답으로 명시 에러 (silent fallback 금지).

---

### T8 — MeetingSession 캐시 + invalidation

**무엇:** D4 의 핵심.

**영향 파일:**
- `src/main/meetings/engine/meeting-session.ts` — edit
- `src/main/meetings/engine/__tests__/meeting-session.test.ts` — edit

**신규 파일:** 0

**시그니처 추가:**
```ts
private permissionSnapshot: PermissionSet | null = null;
private permissionSnapshotDirty = false;
private permissionListener: ((p: PermissionChangedPayload) => void) | null = null;

attachPermissionInvalidation(svc: ChannelService): void {
  this.permissionListener = (p) => {
    if (p.channelId === this.channelId) this.permissionSnapshotDirty = true;
  };
  svc.on(PERMISSION_CHANGED_EVENT, this.permissionListener);
}
detachPermissionInvalidation(svc: ChannelService): void {
  if (this.permissionListener) svc.off(PERMISSION_CHANGED_EVENT, this.permissionListener);
  this.permissionListener = null;
}
getPermissions(resolver: ChannelPermissionResolver): PermissionSet {
  if (this.permissionSnapshot === null || this.permissionSnapshotDirty) {
    this.permissionSnapshot = resolver.resolve(this.channelId);
    this.permissionSnapshotDirty = false;
  }
  return this.permissionSnapshot;
}
```

**verify:** `npx vitest run src/main/meetings/engine/__tests__/meeting-session.test.ts`

**acceptance:**
- 회의 시작 후 첫 getPermissions → resolver 1회 호출.
- 두 번째 호출 (dirty=false) → 캐시 사용 (resolver 호출 0).
- service.updatePermissions 발사 후 다음 호출 → resolver 재호출 1회.
- session dispose → listener detach. 메모리 누수 0 (테스트는 svc.listenerCount 사용).

---

### T9 — MeetingTurnExecutor 호출 교체

**무엇:** R12-W 의 사용자-가시 핵심 변경.

**영향 파일:**
- `src/main/meetings/engine/meeting-turn-executor.ts:70` — import 갱신
- `src/main/meetings/engine/meeting-turn-executor.ts:120-135` — deps 에 `promptComposer: PromptComposer` + `channelPermissionResolver: ChannelPermissionResolver` 추가
- `src/main/meetings/engine/meeting-turn-executor.ts:533-541` — persona 합성 본문 교체
- `src/main/meetings/engine/__tests__/meeting-turn-executor.test.ts` — 테스트 갱신

**변경 본문 (line 533-541 교체):**
```ts
let persona = '';
if (this.shouldIncludePersona(provider, speaker.id)) {
  const v3Identity = this.memberProfileService.buildPersona(speaker.id);
  const providerRoles = this.memberProfileService.getRoles(speaker.id);
  const skillOverrides = this.memberProfileService.getSkillOverrides(speaker.id);
  const channelRole = this.session.channelRole;
  const permissionSnapshot = this.session.getPermissions(this.channelPermissionResolver);
  persona = this.promptComposer.compose({
    persona: v3Identity,
    providerRoles,
    skillOverrides,
    channelRole,
    formatInstruction: '',
    permissionSnapshot, // PromptComposer 확장 — 권한 단락에 우선 적용
  });
}
```

**선행 sub-task 확인:**
- `MemberProfileService.getRoles(providerId): RoleId[]` accessor 존재 여부 (R12-S land 결과).
- `MemberProfileService.getSkillOverrides(providerId)` accessor 존재 여부.
- `MeetingSession.channelRole: ChannelRole` 필드 존재 여부 (R12-C land 결과).
- 누락 시 T9 sub-task 로 보강.

**PromptComposer 확장 (T1 묶음):**
- `compose()` input 에 `permissionSnapshot?: PermissionSet` optional 추가.
- 활성 분기 (능력 부여) 의 `summarizeTools` 가 카탈로그 toolGrants 대신 `permissionSnapshot` 우선 사용. 미제공 시 카탈로그 fallback.

**verify:** `npx vitest run src/main/meetings/engine/__tests__/meeting-turn-executor.test.ts`

**acceptance:**
- persona 문자열에 "Do NOT access any files" / "You have NO file permissions configured" **부재**.
- 부서 채널 + 능력 부여 직원 → 권한 단락 ("권한: 파일 읽기 / 웹 검색" 등) **존재**, 채널 미세조정 우선.
- promptComposer === undefined 또는 channelPermissionResolver === undefined → 명시 throw.

---

### T10 — 옛 buildPermissionRules + FilePermission 삭제

**무엇:** dead code 제거.

**영향 파일:**
- `src/main/members/persona-permission-rules.ts` — **파일 삭제**
- `src/main/members/__tests__/persona-permission-rules.test.ts` 가 있으면 — **삭제**
- `src/shared/file-types.ts:9-20, 81-85` — `FilePermission` / `DEFAULT_FILE_PERMISSION` 삭제
- `src/shared/file-types.ts:23-30` — `WorkspaceConfig.permissions: FilePermission[]` grep 확인 후 처리

**선행 verify:**
```bash
grep -rn "buildPermissionRules\|persona-permission-rules\|FilePermission\b\|DEFAULT_FILE_PERMISSION" src/ docs/
```
test/docs 제외 production 본문 0건 확인.

**verify:** `npm run build` PASS + 전체 vitest PASS

**acceptance:** 유령 export 0건.

---

### T10.5 — PathGuard wire 누락 hotfix block (G1+G2+G5) — **T11 진입 전 의무**

**무엇:** R12-W T1~T10 dogfooding 중 사용자 보고로 발견된 spec §7.6 PathGuard 봉인 wire 누락 격차의 hotfix. audit 보고서 (`docs/reports/audit/2026-05-12-r12-w-pathguard-wire-audit.md`) 의 G1+G2+G5 세 격차 즉시 해결. **본 sub-block 은 T11 진입 전 의무** — T11~T19 의 가시 효과가 G1/G2 fix 없으면 *의도와 정반대* 로 surface (rolestra source repo 가 AI 에 노출).

**audit 보고서의 격차 chain:**
```
[큐 회의 시작]
  ↓ default-meeting-starter.ts:215 — projectPath:'' 하드코딩 (G2)
[SSM 생성]
  ↓ ssmCtx.projectPath = '', permissionMode='hybrid' 하드코딩 (G5)
[CliProvider.streamCompletion]
  ↓ _projectPath = '.' (G1 — setProjectPath 호출자 0)
[CLI spawn]
  cwd = process.cwd() = 앱 실행 위치 = rolestra source repo
  → 사용자가 의도한 ArenaRoot/projects/<slug>/ 가 아닌 다른 폴더 노출
```

**범위 한정:**
- G3 (PermissionService 인스턴스화 자체 X) 의 *정식 fix* 는 R12-X (별도 phase). 본 hotfix 는 `resolveProjectPaths` 직접 호출로 *우회* — G3 wire 가 land 되기 전까지의 임시 cwd source.
- G4 (ExecutionService singleton) / G6 (MeetingSession.setProjectPath dead method) / G7 (ensureAccess silent skip) 은 R12-X.
- 본 hotfix 는 *사용자 가시 critical* 만. 회귀 가드 (brand type / integration test / invariant) 도 R12-X.

---

#### T10.5.G1 — `CliProvider.setProjectPath` 호출 wire

**무엇:** CLI spawn 직전 `setProjectPath` 호출. CliProvider 인스턴스는 registry singleton 으로 회의 간 재사용되므로 *매 turn 시작 직전* 갱신.

**영향 파일:**
- `src/main/meetings/engine/meeting-turn-executor.ts` — `callProviderOnce` 또는 `runPhaseTurn` 의 spawn 직전, `provider instanceof CliProvider` 분기에서 `setProjectPath(this.session.ssmCtx.projectPath)` 호출.
- `src/main/meetings/engine/__tests__/meeting-turn-executor.test.ts` — CliProvider mock 에 setProjectPath spy 추가, 호출 검증.

**변경 본문 (스케치):**
```ts
// meeting-turn-executor.ts: callProviderOnce 내부, wireCliPermissionCallback 직전
if (provider instanceof CliProvider) {
  // R12-W T10.5.G1 — spawn cwd 동기화. ssmCtx.projectPath 는 T10.5.G2 가
  // resolveProjectPaths 로 채워준다. 빈 문자열일 경우 명시 throw (silent fallback 금지).
  const projectPath = this.session.ssmCtx.projectPath;
  if (!projectPath || projectPath === '.' || !path.isAbsolute(projectPath)) {
    throw new Error(
      `[meeting-turn-executor] ssmCtx.projectPath invalid for CLI spawn: ` +
      `value='${projectPath}' (must be absolute path inside ArenaRoot)`,
    );
  }
  provider.setProjectPath(projectPath);
  this.wireCliPermissionCallback(provider, speaker);
}
```

**verify:**
- `npx vitest run src/main/meetings/engine/__tests__/meeting-turn-executor.test.ts`
- 호스트가 dogfooding — 회의 시작 후 `ps`/`/proc/<pid>/cwd` 또는 ROLESTRA_E2E hook 으로 spawn cwd 가 `<arena>/projects/<slug>/` 확인.

**acceptance:**
- mock CliProvider 의 setProjectPath spy 가 *spawn 직전* 정확한 cwd 로 호출.
- ssmCtx.projectPath 가 빈 문자열 / `'.'` / 상대 경로면 명시 throw (silent fallback 금지).
- 사용자 dogfooding — AI 가 ArenaRoot 안 프로젝트 폴더만 인식.

**리스크:**
- CliProvider 가 *registry singleton* 이라 동시 2개 회의 진행 시 race 가능 — 한 회의의 setProjectPath 가 다른 회의에 leak. 본 hotfix 의 한계 (R12-X 에서 *per-call cwd injection* 으로 구조 개선).

---

#### T10.5.G2 — `ssmCtx.projectPath` 4곳 하드코딩 → `resolveProjectPaths` 직접 호출

**무엇:** SSM ctx 생성 4 곳의 `projectPath: ''` 를 `resolveProjectPaths(project, arenaRoot.getPath()).cwdPath` 로 교체. G3 정식 fix 전이라 PermissionService 우회 + helper 직접 호출.

**영향 파일:**
- `src/main/index.ts:608-615` — channel:start-meeting 분기 ssmCtx 생성
- `src/main/index.ts:1217-1224` — handoff:start-meeting-from-package buildSsmCtx
- `src/main/ipc/handlers/channel-handler.ts:350` 부근 — channel:start-meeting handler
- `src/main/queue/default-meeting-starter.ts:215` 부근 — 큐 자동 회의 시작
- 각 호출처는 *project row 와 arenaRoot 를 이미 가지고 있거나* 가져올 수 있어야 함 — 못 가져오면 사전 dependency injection 추가.

**변경 본문 (스케치 — channel-handler.ts 패턴 예시):**
```ts
import { resolveProjectPaths } from '../../arena/resolve-project-paths';

// channel:start-meeting handler 내부, channel.projectId 알고 있는 시점
const project = projectRepo.get(channel.projectId);
if (!project) {
  throw new Error(`[channel-handler] project not found: ${channel.projectId}`);
}
if (project.status === 'folder_missing') {
  throw new Error(`[channel-handler] project folder missing: ${project.slug}`);
}
const paths = resolveProjectPaths(project, arenaRoot.getPath());

const ssmCtx: SsmContext = {
  meetingId,
  channelId,
  projectId: channel.projectId,
  projectPath: paths.cwdPath,         // ← G2 fix
  permissionMode: project.permissionMode,   // ← G5 fix
  autonomyMode: project.autonomyMode,       // ← G5 fix
};
```

**4 곳 변경 모두 *동일 패턴*:**
1. projectRepo / arenaRoot accessor 가 이미 closure 에 있으면 그대로 사용
2. 없으면 setHandoff*Resolver / setDefaultMeetingStarter*Deps 같은 wire 함수에 1개 추가
3. project row 가 *folder_missing* 이거나 *kind=external* 인데 link realpath mismatch 시 — 본 hotfix 는 *resolveProjectPaths* 만 호출 (TOCTOU 재검증 X). 그건 R12-X 의 PermissionService.resolveForCli 정식 wire 책임.

**verify:**
- `npx vitest run` — 4 곳의 unit test 가 ssmCtx.projectPath 가 *비어 있지 않은 절대 경로* 임을 단언 (CLAUDE.md silent fallback 금지 정신, 회귀 가드 최소판).
- 통합 smoke — 4 회의 시작 path 각각에 대해 회의 시작 후 ssmCtx 캡처 (ROLESTRA_E2E dev hook 또는 logger snapshot).

**acceptance:**
- 4 곳 모두 production code 에 `projectPath: ''` 또는 `projectPath: '.'` 리터럴 0건 (grep 검증).
- 회의 시작 시 project lookup 실패 / folder_missing → 명시 throw (사용자 가시 에러).
- dogfooding — 사용자가 4 회의 시작 path 각각에서 AI 가 ArenaRoot 안 프로젝트 폴더만 인식.

**리스크:**
- 본 hotfix 가 `resolveProjectPaths` 직접 호출이라 *external 프로젝트의 junction TOCTOU 재검증 X*. external + 누군가 junction 을 swap 한 경우 spawn cwd 가 *원 target* 이 아닌 *swap target* 으로 갈 가능성 — spec §7.6.4 CA-3. R12-X 가 PermissionService.resolveForCli 정식 wire 로 close.
- 본 hotfix 후에도 *external + auto* 거부는 PermissionFlagBuilder 의 zod 단계에서 막힘 — 본 hotfix 와 무관.

---

#### T10.5.G5 — `permissionMode`/`autonomyMode` 하드코딩 → project row 동기화

**무엇:** T10.5.G2 와 *같은 4 곳* 의 `'hybrid' as const` / `'manual' as const` 하드코딩을 `project.permissionMode` / `project.autonomyMode` 로 교체. G2 와 *한 commit* 으로 묶어 처리 (project lookup 이 둘 다 필요).

**영향 파일:** T10.5.G2 와 동일 4 파일 — `index.ts:613-614`, `:1222-1223`, `channel-handler.ts:351-352`, `default-meeting-starter.ts:216-217`.

**변경 본문:** T10.5.G2 의 스케치 안에 이미 포함 (`permissionMode: project.permissionMode`, `autonomyMode: project.autonomyMode`).

**verify:**
- mode 변경 시나리오 — `ProjectService.applyPermissionModeChange` 로 `auto` 로 바꾼 후 회의 시작 → ssmCtx.permissionMode 가 `auto` 인지 단언.

**acceptance:**
- 4 곳 production code 에 `'hybrid' as const` / `'manual' as const` 리터럴 0건 (ssmCtx 분기 한정 grep).
- 사용자가 mode 변경 후 새 회의 시작 시 SSM 분기 (AutonomyGate / ApprovalService 정책) 가 새 mode 반영.

**리스크:**
- 진행 중 회의는 *옛 mode 유지* (SsmContext immutability 원칙 — `ssm-context-types.ts:37` "If a field needs to change, rebuild the SSM"). 사용자가 *진행 중 회의에 mode 변경 즉시 반영* 을 기대하면 별 follow-up (R12-X 외 별도 ADR).

---

#### T10.5 통합 검증

**Verify chain:**
1. `npm run build` PASS
2. `npx vitest run` 전체 PASS — meeting-turn-executor / channel-handler / default-meeting-starter unit test 모두 GREEN
3. **호스트 dogfooding 재현** — 사용자 보고 시나리오 (큐 회의 → "docs/ 읽기" 요청) 재실행 → AI 가 `<arena>/projects/<slug>/docs/` 또는 *해당 위치에 파일 없음* 응답, *rolestra source repo* dump X
4. grep 단언:
   ```bash
   grep -rn "projectPath:\s*''\|projectPath:\s*'\.'" src/ | grep -v __tests__ | grep -v ssm-context-types.ts
   # → 0건 (test factory 의 default 만 허용)
   ```

**Definition of Done (T10.5):**
- G1 + G2 + G5 grep 단언 0건
- 사용자 dogfooding 재현 시 surface 부재
- 호스트 + 사장 spot check PASS — T11 진입 승인

**T10.5 의 한계 명시 (R12-X 가 이어받을 책임):**
- G3 (PermissionService 인스턴스화 + 호출 wire) — `resolveProjectPaths` 우회는 임시. PermissionService 정식 wire 가 진짜 fix.
- G4 (ExecutionService singleton boot) — apply path 가 throw 인 상태 그대로.
- G6 (MeetingSession.setProjectPath dead method) — 본 hotfix 가 ssmCtx 로 충분히 해결하면 R12-X 에서 dead method 자체 삭제.
- G7 (ensureAccess silent skip) — `if (this.ensureAccess) {...}` 패턴 그대로. R12-X 가 *required* 로 변경.
- **brand type / runtime invariant / integration test** — 회귀 가드 셋 모두 R12-X. 본 hotfix 는 *최소 unit test* 만.

→ T11 진입 시점에 *위 5건은 여전히 미해결*. 사장이 사용자 dogfooding 검증 후 R12-W 종결 → R12-X 진행 결재.

---

### T11 — permission-flag-filter (D5)

**무엇:** Claude `--allowedTools` 콤마 리스트를 PermissionSet 으로 좁힘.

**신규 파일:**
- `src/main/permissions/permission-flag-filter.ts`
- `src/main/permissions/__tests__/permission-flag-filter.test.ts`

**시그니처:**
```ts
export interface PermissionFilterInput {
  cliKind: CliKind;
  baseFlags: PermissionFlagOutput;
  permissions: PermissionSet;
}
export interface PermissionFilterOutput {
  flags: string[];
  rationale: string[]; // i18n key 배열
  filtered: { removedTools: string[] };
}
export function filterFlagsByMemberPermission(input: PermissionFilterInput): PermissionFilterOutput;
```

**Claude 매핑 표 (constant):**
```ts
const TOOL_REQUIREMENTS: Record<string, keyof PermissionSet> = {
  Read: 'fileRead', Glob: 'fileRead', Grep: 'fileRead',
  Edit: 'fileWrite', Write: 'fileWrite', MultiEdit: 'fileWrite', NotebookEdit: 'fileWrite',
  Bash: 'commandExec',
  WebSearch: 'webSearch', WebFetch: 'webSearch',
};
```

**Sub-task 11a — Claude `--allowedTools ""` 거동 검증:**
실제 Claude CLI 로 `--allowedTools ""` 호출 실험 → fail-closed 인지 / 옵션 자체 제거 필요한지 결정. 옵션 자체 제거가 안전 — Claude default = 전체 도구 허용일 가능성이 있으므로, filter 후 빈 리스트면 `--allowedTools` 자체를 argv 에서 빼고 별도 fail-closed alias (예: `--permission-mode plan`) 적용. 11a 결과로 본 작업 acceptance 확정.

**verify:** `npx vitest run src/main/permissions/__tests__/permission-flag-filter.test.ts`

**acceptance:**
- ADR §4 의 8 셀 표 그대로 검증.
- Codex / Gemini 는 base 무손상 + rationale 에 "cli_no_filter" key 1개 추가.
- 빈 리스트 시 11a 결과대로 fail-closed.

---

### T12 — cli-provider spawn wire-up

**무엇:** spawn 직전 base argv → filter 호출 → spawn argv.

**영향 파일:**
- `src/main/providers/cli/cli-provider.ts` — edit (spawn 경로)

**신규 파일:** 0

**선행 sub-task:**
- cli-provider 가 현재 어디서 PermissionFlagBuilder 를 호출하는지 grep.
- PermissionSet 을 어디서 받을지 — `MeetingSession.getPermissions(resolver)` 가 첫 후보. 회의 외 경로 (DM, system) 는 `channelRole=null` 또는 `permissions = catalogDefaultForNullRole()` 사용.

**verify:**
- `npx vitest run src/main/providers/cli/__tests__/` PASS
- spawn argv snapshot 테스트 — ADR §4 표 #1, #3, #5, #8 4 케이스 추가

**acceptance:** ADR §4 8 셀의 filter 후 argv 가 실제 spawn argv 와 일치.

---

### T13 — use-channel-permissions hook + zustand

**무엇:** Optimistic UI 패턴 (R10 D8 + R11 Task 15).

**신규 파일:**
- `src/renderer/hooks/use-channel-permissions.ts`
- `src/renderer/hooks/__tests__/use-channel-permissions.test.ts`

**시그니처:**
```ts
export function useChannelPermissions(channelId: string): {
  permissions: PermissionSet | null;
  setPermissions: (next: PermissionSet) => Promise<void>; // optimistic + rollback on failure
  resetToTemplate: (roleId: RoleId | null) => Promise<void>; // = setPermissions(catalogDefaultFor(roleId))
  loading: boolean;
  error: ErrorState | null;
};
```

Optimistic 흐름: 즉시 store 갱신 → IPC round-trip → 실패 시 rollback + 에러 표시 (CLAUDE.md "silent fallback 금지").

**verify:** `npx vitest run src/renderer/hooks/__tests__/use-channel-permissions.test.ts`

**acceptance:**
- IPC 실패 시 UI 상태 rollback + 에러 토스트.
- race 시 last-write-wins.
- resetToTemplate 가 catalogDefaultFor 결과 그대로 적용.

---

### T14 — 채널 생성 모달 — 부서 template + 권한 섹션

**무엇:** 신규 채널 생성 시 부서 template 드롭다운 (6 옵션) + 권한 5축 토글 + 미세조정.

**영향 파일:**
- `src/renderer/features/channels/CreateChannelModal.tsx` (기존 있으면 edit, 없으면 신규)
- `src/renderer/features/channels/__tests__/CreateChannelModal.test.tsx`

**구성:**
- 채널 이름 input (기존)
- 부서 template 드롭다운: `아이디어` / `기획` / `디자인` / `구현` / `검토` / `일반` (6 옵션, default = `일반`)
- 선택 시 카탈로그 default 가 5 axis 토글에 자동 반영
- 사용자 토글 미세조정 가능
- 제출 시 channels create + 권한 5컬럼 동시 전달

**verify:** `npx vitest run src/renderer/features/channels/__tests__/CreateChannelModal.test.tsx`

**acceptance:**
- 부서 선택 → 5 토글 자동 갱신 (T2 catalogDefaultFor 결과와 일치).
- 사용자 토글 미세조정이 catalogDefaultFor 무시하고 적용.
- 모든 라벨 i18n t() 경유.

---

### T15 — 채널 설정 모달 — 권한 섹션 + template 리셋

**무엇:** 사후 수정 모달. T14 와 병렬 진행 가능.

**영향 파일:**
- `src/renderer/features/channels/ChannelSettingsModal.tsx` (기존 있으면 edit, 없으면 신규)
- `src/renderer/features/channels/__tests__/ChannelSettingsModal.test.tsx`

**구성:**
- 부서 드롭다운 — **read-only** (출발 부서 표시, 변경 X, Follow-up 5)
- 권한 5 axis 토글 — 현재 값 표시 + 변경 가능
- "template 으로 리셋" 버튼 — catalogDefaultFor 결과로 토글 일괄 리셋 + Optimistic 적용
- "오버라이드 적용 중" / "기본값 사용 중" 시각 배지 (`permissionSetsEqual` 비교)

**verify:** `npx vitest run src/renderer/features/channels/__tests__/ChannelSettingsModal.test.tsx`

**acceptance:**
- 리셋 버튼 → IPC update + 배지 "기본값 사용 중" 전환.
- 토글 변경 → Optimistic + 배지 "오버라이드 적용 중".
- i18n t() 경유 0건 위반.

---

### T16 — i18n ko/en JSON

**무엇:** T14, T15 의 모든 노출 문자열.

**영향 파일:**
- `src/renderer/i18n/locales/ko/channels.json` (또는 신규 namespace)
- `src/renderer/i18n/locales/en/channels.json`

**키:**
- `channels.permissions.tabTitle` / `sectionTitle`
- `channels.permissions.template.dropdown.label`
- `channels.permissions.template.option.{idea,planning,design,implement,review,general}` (6)
- `channels.permissions.axis.{fileRead,fileWrite,commandExec,webSearch,dbRead}` (5)
- `channels.permissions.button.resetToTemplate`
- `channels.permissions.badge.{overrideActive,defaultActive}`
- `permission.flag.filter.reason.removed_by_channel_permission`
- `permission.flag.filter.reason.cli_no_filter`

**verify:** `npm run i18n:check` exit 0

**acceptance:** ko/en parity, keepRemoved 보존.

---

### T17 — Composition root DI

**무엇:** `src/main/index.ts` 에서 신규 인스턴스 wire-up.

**영향 파일:**
- `src/main/index.ts` — edit

**핵심 invariant:**
- `ChannelPermissionResolver` 단일 인스턴스 — TurnExecutor + cli-provider + UI handler 가 공유.
- `ChannelService` 의 emitter 에 `MeetingSession` (생성될 때마다) 이 attach.
- `MeetingSession` dispose 시 detach.

**verify:** `npm run build` PASS + 통합 smoke 테스트

**acceptance:** wire-up 완전 — 어떤 회의 turn 도 promptComposer / channelPermissionResolver 없이 실행되지 않음.

---

### T18 — Vitest 회귀 + 신규 케이스

**무엇:** T1~T17 의 모든 유닛 + 통합 테스트.

**신규 케이스 (예시):**
1. PermissionSet helper 변환 idempotency
2. migration 023 sanity (카탈로그 ↔ migration UPDATE 일치)
3. ChannelRepository CRUD 회귀 + 5컬럼 getPermissions/updatePermissions
4. ChannelService emitter 발사 + createDepartmentChannels 권한 채우기
5. ChannelPermissionResolver 단일 lookup
6. IPC handler zod 검증 + 명시 throw
7. MeetingSession dirty → 재조회 / dispose → detach
8. MeetingTurnExecutor 합성 — promptComposer 미주입 throw / 능력 부여 → 권한 단락 / 미부여 → fallback
9. permission-flag-filter 8 셀 매트릭스
10. use-channel-permissions Optimistic + rollback

**verify:** `npx vitest run` 전체 PASS, R10 D5 permission-flag-builder.test.ts 회귀 0.

**acceptance:** 신규 + 회귀 합쳐 100% GREEN.

---

### T19 — Playwright E2E

**무엇:** 사용자 보고 시나리오 + UI 흐름 + invalidation.

**신규 파일:**
- `e2e/r12-w-channel-file-permission.spec.ts`

**시나리오 A — 자기검열 회귀 차단 (사용자 보고 케이스):**
1. 프로젝트 생성 → 자동으로 `#아이디어` 채널 생성 (T5 의 createDepartmentChannels)
2. AI 1명에 idea 능력 부여
3. 할 일 큐로 `#아이디어` 회의 시작
4. ROLESTRA_E2E hook 으로 첫 turn persona 캡처
5. 부재 단언: "Do NOT access any files", "You have NO file permissions configured", "본 회의 채널 규칙상 파일을 직접 읽지 못"
6. 존재 단언: "권한: 파일 읽기", "권한: 웹 검색", "이번 부서 = idea"

**시나리오 B — 채널 미세조정:**
1. 새 채널 생성 — 부서 template = 구현 선택 → 5 토글 자동 (read+write+exec+db_read=true, web_search=false)
2. file_write 토글 끔
3. 제출 → 채널 생성 + DB 권한 row 확인
4. 그 채널에서 회의 시작 → persona 캡처 + Claude argv 캡처
5. persona 단언: "권한: 파일 읽기 / 명령 실행" (write 부재)
6. argv 단언: `--allowedTools` 에 `Edit,Write,MultiEdit,NotebookEdit` 부재

**시나리오 C — Invalidation:**
1. 회의 진행 중 (turn 2 응답 대기 중) 채널 설정 모달 열기
2. file_write 토글 끔 → IPC update
3. 다음 turn 시작 직전 persona 재캡처
4. 권한 단락 변경 반영 (write 부재) 확인 — D4 invalidation 증명

**verify:** `npx playwright test e2e/r12-w-channel-file-permission.spec.ts --project=electron` PASS

**acceptance:** 3 시나리오 GREEN. CI matrix 33셀 회귀 0.

**선행 sub-task:**
- ROLESTRA_E2E hook 에 `captureLastTurnPersona()` + `captureLastSpawnArgv()` 추가 (preload, dev only).

---

### T20 — spec §7.6 본문 갱신

**무엇:** §7.6.4 신설 + §7.6.4/§7.6.5 번호 시프트 + §7.6.1 표 1행 추가.

**영향 파일:**
- `docs/specs/2026-04-18-rolestra-design.md`

**§7.6.4 신설 본문** (ADR § 6.4 의 스케치 그대로 — **채널** 단위 명명):
```markdown
#### 7.6.4 계층 2.5 — 채널-권한 filter layer (R12-W)

§7.6.3 매트릭스가 생성한 base argv 위에 *채널 권한*
(ChannelPermissionResolver 결과) 으로 한 단계 더 좁힌다. 책임 분리:

| 축 | 결정 source |
|----|------------|
| sandbox / approval policy (`--sandbox`, `-a`, `--permission-mode`) | 작업장 mode (§7.6.3 정본) |
| 도구 화이트리스트 (`--allowedTools`, Claude 전용) | 채널 권한 (R12-W) |

Codex / Gemini 는 도구 단위 화이트리스트가 없어 prompt only 로
대체된다 (PromptComposer 의 "권한: ..." 안내 단락).

상세: `docs/decisions/r12-w-member-file-permission.md`.
```

**§7.6.1 방어 범위 표 갱신** — 표에 1행 추가:
```
| CLI 도구 화이트리스트 (channel-permission filter) | Claude --allowedTools | △ Claude 전용 |
```

**번호 시프트** — grep 으로 §7.6.4 / §7.6.5 참조하는 다른 문서 찾아 일괄 갱신.

**verify:** 사람 spot check + markdown lint

**acceptance:** §7.6.3 본문 무손상 (R10 D5 회귀 0) + §7.6.4 신설 + 번호 시프트 정합.

---

### T21 — 문서 정합

**무엇:** ADR / plan / decision README / 구현현황 / R12-S log 후속 표시.

**영향 파일:**
- `docs/구현-현황.md` — R12-W 항목 추가 (v3 채널 단위 land)
- `docs/decisions/README.md` — r12-w 행 추가
- `docs/decisions/r12-s-persona-skills.md` — "후속: r12-w wire-up 종결" 1줄 추가
- `docs/decisions/r12-c-channel-roles.md` — "후속: r12-w 채널 권한 5컬럼 추가" 1줄 추가

**verify:** 사장 spot check

**acceptance:** 네 문서 모두 r12-w v3 land 명시.

---

## 4. Definition of Done (v3)

1. `npm run build` PASS
2. `npm run lint` PASS (eslint-plugin-i18next 가드 0건)
3. `npm run i18n:check` exit 0 (ko/en parity)
4. `npx vitest run` 전체 PASS (R10 D5 회귀 0)
5. `npx playwright test --project=electron` 전체 PASS (CI matrix 33셀 회귀 0)
6. 사용자 보고 시나리오 수동 재현 — 자기검열 발언 부재 확인
7. `grep -rn "buildPermissionRules\|FilePermission\b\|DEFAULT_FILE_PERMISSION" src/` 결과 0건 (test/docs 제외)
8. spec §7.6.4 신설 본문 land + 번호 시프트
9. ADR / plan / decision README / 구현 현황 / R12-S / R12-C log 문서 정합

---

## 5. 잠재적 막힘 / 위험 (v3)

| 위험 | 영향 | 대비 |
|------|------|------|
| ADR §D3 정본 표의 `review` 행이 코드 정본과 미스매치 | T3 sanity fail | T3 sanity 테스트가 즉시 잡음 — migration 023 SQL 의 UPDATE 표현식을 코드 정본에 맞춰 정정 후 land |
| `MemberProfileService.getRoles` / `getSkillOverrides` accessor 부재 | T9 막힘 | T9 sub-task — repository 가 R12-S migration 017 으로 보유, service surface 만 노출 |
| `MeetingSession.channelRole` 필드 부재 (R12-C land 미흡 가능성) | T8/T9 막힘 | grep 사전 확인 → 없으면 ChannelService lookup helper 추가 |
| Claude `--allowedTools ""` 거동 미지 | T11 fail-closed 단언 불가 | T11 sub-task 11a — 실제 CLI 실행 검증 후 옵션 자체 제거 + fail-closed alias 적용 결정 |
| ROLESTRA_E2E hook 부재 | T19 막힘 | T19 sub-task — preload dev hook 추가 |
| `ChannelService extends EventEmitter` 승격 후 기존 호출자 회귀 | T5 회귀 위험 | 기존 ChannelService 사용 케이스 모두 unit 테스트 회귀 — T18 에 포함 |
| `CreateChannelModal` / `ChannelSettingsModal` 기존 존재 여부 | T14/T15 신규 vs edit 결정 | grep 사전 확인 — 없으면 신규 컴포넌트 + 라우팅 추가 (작업량 약간 증가) |
| Optimistic UI race (T13) | UI 상태 drift | last-write-wins + 명시 에러 토스트 |
| EventEmitter listener leak (T8) | 회의 N개 후 메모리 누수 | dispose 시 detach + 회귀 테스트 (T18 case 7) |
| 마이그레이션 023 chain 충돌 | T3 land 시 충돌 | 014~022 다음 번호 = 023 사전 확인 완료 (free) |
| spec 번호 시프트가 다른 ADR 참조 깨뜨림 | T20 위험 | §7.6.3 무손상, §7.6.4/§7.6.5 만 시프트 — grep 후 일괄 갱신 |

---

## 6. 결재 5 포인트 (v3 — 재게재)

| # | 결정 포인트 | v3 확정 |
|---|------------|---------|
| D1 | 권한 부여 단위 | **채널 1:1 (별도 도메인 X)** |
| D2 | 미설정 기본 | **읽기 허용** + ALTER DEFAULT `file_read=1` 자동 backfill |
| D3 | 저장 위치 | **`channels` ALTER 5컬럼 + IPC 2채널 + 모달 섹션 2개** |
| D4 | 조회 시점 | **회의 시작 1회 + invalidation** (ChannelService EventEmitter 승격) |
| D5 | argv 동기화 | **2단계 filter** (입력 source = 채널) |

본 plan 은 T1~T21 land. T1 + T2 즉시 시작 가능 (영향 없음 확인 완료).
