# Rolestra v3 — Phase R12-S 페르소나/스킬 분리 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provider 데이터 모델을 *캐릭터 (persona)* 와 *능력 (roles + skill_overrides)* 로 분리하고, 시스템 정의 스킬 카탈로그 (10 능력) + 회의록 정리 모델 설정 + 직원 편집 모달 탭 분리 + PromptComposer 합성 경로를 구축한다. R12-C 채널 역할의 데이터 기반.

**Architecture:**
- **데이터 분리**: `providers.persona` 의미 변경 (캐릭터 only) + `providers.roles` (TEXT JSON array) + `providers.skill_overrides` (TEXT JSON, nullable) 컬럼 추가. Migration 017 forward-only.
- **스킬 카탈로그**: `src/shared/skill-catalog.ts` 가 10 능력 정의 (`idea` / `planning` / `design.ui` / `design.ux` / `design.character` / `design.background` / `implement` / `review` / `general` + 시스템 `meeting-summary`). 각 능력 = (한국어 system prompt 템플릿 + tool 권한 matrix + 외부 자원 endpoint slot). agestra plugin agent prompts 를 reference.
- **합성 경로**: `PromptComposer` 가 회의/인계 시 `{persona} + {role-skill template} + {permission_rules} + {format_instruction}` 합성. 회의 참여 직원이 어느 부서 (channel.role) 에 들어가느냐에 따라 자동 작업복 갈아입음.
- **회의록 정리 모델**: 별도 settings (`summaryModelProviderId`) — 디폴트 자동 선택 로직 (Claude API → Gemini API → 기타 summarize-capable → Ollama).
- **호환성**: 기존 persona 데이터 보존 (캐릭터 + 능력 섞여 있어도 롤백 가능). roles 빈 배열 = legacy 동작 유지.

**Tech Stack:** TypeScript strict, better-sqlite3 (migration chain), zod (IPC schema), Zustand (renderer state), React 19 + Radix Tabs, Vitest (unit + integration), eslint-plugin-i18next.

**사용자 결정 요약 (2026-05-01)**:
1. 능력 카탈로그 10개 (디자인 4분할 + 4개 별도 체크 가능) — `design.ui` / `design.ux` / `design.character` / `design.background`
2. 부서 템플릿 8개 (디폴트 6 + 옵션 2: `캐릭터 디자인` / `배경 디자인` 은 사용자 추가)
3. 능력 다중 선택 가능 — 한 직원 여러 부서 동시 배치 (메모리 line: "여러 채널에 복제되어야하니까")
4. 회의록 정리 모델 별도 설정, Ollama 도 가능. 자동 디폴트: Claude Haiku → Gemini Flash → 기타 → Ollama
5. agestra plugin (`/home/taniar/.claude/plugins/cache/agestra/agestra/4.13.0/agents/`) 의 system prompt 를 reference 하되 한국어로 재작성

**No-go**:
- 채널 데이터 모델 변경 (R12-C 영역)
- 회의 흐름 변경 (R12-C 영역)
- 인계 / handoff (R12-H 영역)
- 외부 자원 endpoint 호출 (R12-S 는 schema slot 만)

**참고 메모리**:
- `rolestra-r12-channel-roles-design.md`
- `rolestra-next-session-pushwork.md`
- `rolestra-phase-status.md`

---

## File Structure

| 경로 | 책임 | 동작 |
|------|------|------|
| `src/main/database/migrations/017-providers-roles-skills.ts` | DB 컬럼 추가 | Create |
| `src/main/database/migrations/index.ts` | migration 등록 | Modify |
| `src/shared/role-types.ts` | RoleId / SkillId / ToolGrant 타입 | Create |
| `src/shared/skill-catalog.ts` | 10 능력 카탈로그 정의 | Create |
| `src/shared/provider-types.ts` | ProviderInfo + roles/skill_overrides 필드 | Modify |
| `src/main/skills/skill-service.ts` | 카탈로그 조회 + override merge | Create |
| `src/main/skills/__tests__/skill-service.test.ts` | unit | Create |
| `src/main/skills/prompt-composer.ts` | persona + skill template 합성 | Create |
| `src/main/skills/__tests__/prompt-composer.test.ts` | unit | Create |
| `src/main/providers/provider-repository.ts` | roles + skill_overrides DB read/write | Modify |
| `src/main/providers/__tests__/provider-repository.test.ts` | repo unit | Modify |
| `src/main/ipc/handlers/skill-handler.ts` | skill.list / skill.getTemplate IPC | Create |
| `src/main/ipc/handlers/provider-handler.ts` | provider.updateRoles IPC | Modify |
| `src/main/ipc/handlers/settings-handler.ts` | settings.summaryModel CRUD | Modify |
| `src/shared/ipc-schemas.ts` | zod schema 추가 | Modify |
| `src/shared/ipc-types.ts` | IpcChannelMap 추가 | Modify |
| `src/preload/index.ts` | typedInvoke whitelist 추가 | Modify |
| `src/renderer/features/settings/StaffEditModal.tsx` | 캐릭터 / 역할+스킬 탭 분리 | Modify |
| `src/renderer/features/settings/RolesSkillsTab.tsx` | 새 탭 컴포넌트 | Create |
| `src/renderer/features/settings/SummaryModelCard.tsx` | 회의록 정리 모델 설정 카드 | Create |
| `src/renderer/hooks/use-skill-catalog.ts` | renderer-side hook | Create |
| `src/main/llm/meeting-summary-service.ts` | settings.summaryModel 우선 + auto fallback | Modify |
| `src/main/config/settings-store.ts` | summaryModelProviderId 필드 | Modify |
| `src/renderer/i18n/locales/ko/settings.json` | ko 키 추가 | Modify |
| `src/renderer/i18n/locales/en/settings.json` | en 키 추가 | Modify |
| `src/renderer/i18n/locales/ko/skills.json` | ko 스킬 라벨 namespace | Create |
| `src/renderer/i18n/locales/en/skills.json` | en 스킬 라벨 namespace | Create |
| `docs/decisions/r12-s-persona-skills.md` | ADR | Create |
| `docs/specs/2026-05-01-rolestra-channel-roles-design.md` | §3 카탈로그 갱신 (10 능력) | Modify |
| `docs/구현-현황.md` | R12-S 행 추가 | Modify |
| `tests/e2e/r12-s-roles-skills.spec.ts` | Playwright Electron e2e (smoke) | Create |

---

## Task 0: Spec §3 능력 카탈로그 갱신 (5 → 10)

**Goal:** 사용자 결정 반영 — spec 의 능력 카탈로그를 5개 (`planning` / `design` / `implement` / `review` / `idea`) 에서 10개 (디자인 4분할 + general + system meeting-summary) 로 확장. plan 본 작업 진입 전 spec 정합 먼저.

**Files:**
- Modify: `docs/specs/2026-05-01-rolestra-channel-roles-design.md` (§3 "시스템 정의 스킬 카탈로그" 표 + §3 "데이터 모델 변경" 의 roles 예시)

**Acceptance Criteria:**
- [ ] §3 카탈로그 표가 10 행 (`idea` / `planning` / `design.ui` / `design.ux` / `design.character` / `design.background` / `implement` / `review` / `general` / `meeting-summary`)
- [ ] §3 의 roles 예시가 다중 선택 가능 명시 (`['planning', 'design.ui', 'design.ux']` 같은 형태)
- [ ] §3 끝에 "부서 템플릿 8개 (디폴트 6 / 옵션 2)" 단락 추가 — 디자인 부서 = `[design.ui, design.ux]` 묶음, 캐릭터/배경 부서는 사용자 추가
- [ ] §11.5 회의록 정리 항목에 "디폴트 자동 선택 로직 (Claude Haiku → Gemini Flash → 기타 summarize → Ollama)" 추가
- [ ] §11.7 R12-S task 목록에 "회의록 정리 모델 settings + 자동 선택" 항목 추가
- [ ] git diff 확인 시 §3, §11.5, §11.7 만 변경 (다른 phase 영역 무손상)

**Verify:** `git diff docs/specs/2026-05-01-rolestra-channel-roles-design.md | head -150`
Expected: §3 표 행이 10 개, §11.5 + §11.7 에 회의록 정리 모델 자동 선택 단락 추가.

**Steps:**

- [ ] **Step 1: §3 카탈로그 표 교체**

`docs/specs/2026-05-01-rolestra-channel-roles-design.md` 의 line 65~75 부근 표를 다음으로 교체:

```markdown
### 시스템 정의 스킬 카탈로그 (10 능력)

| Role ID | 한국어 라벨 | 핵심 |
|---------|-------------|------|
| `idea` | 아이디어 | 자유 brainstorm + 비판 보류 + 다양성 강조 |
| `planning` | 기획 | spec 작성 + 사용자 페르소나 분석 + 우선순위 매트릭스 + (외부) 시장조사 |
| `design.ui` | 디자인 (UI / 형태) | UI 형태 / 디자인 토큰 / 컴포넌트 시안 + (외부) 색상 추출 |
| `design.ux` | 디자인 (UX / 사용감) | 사용 흐름 / 정보 구조 / 사용자 여정 |
| `design.character` | 디자인 (캐릭터) | 게임 캐릭터 시안 / 모션 컨셉 — 게임 프로젝트만 |
| `design.background` | 디자인 (배경) | 게임 배경 시안 / 무드 보드 — 게임 프로젝트만 |
| `implement` | 구현 | 코드 생성 + 파일 쓰기 + 명령 실행 + diff 적용 + 테스트 실행 |
| `review` | 검토 | lint / typecheck / 테스트 실행 + 스파게티 / 하드코딩 / 버그 위험 평가 + e2e |
| `general` | 일반 (잡담) | 1라운드 단순 응답, 회의 안 함, 채널 권한 매트릭스 X |
| (시스템) `meeting-summary` | 회의록 자동 정리 | system 만 호출, 직원 부여 X |

**부서 템플릿 8개 (디폴트 6 + 옵션 2)**:
- 디폴트 (프로젝트 만들면 자동 생성): 아이디어 / 기획 / 디자인 (UI+UX 묶음) / 구현 / 검토 / 일반
- 옵션 (사용자 추가): 캐릭터 디자인 / 배경 디자인
- 디자인 부서 = `[design.ui, design.ux]` 두 능력 묶음 — UI/UX 의논 잦으니 분리하지 않음.
- 직원 능력은 4개 중 자유 다중 체크 — 한 직원이 여러 부서에 멤버.
```

- [ ] **Step 2: §3 데이터 모델 roles 예시 갱신**

같은 파일 line 60 부근 `roles ← string[], 예: ['planning', 'design']` 를 다음으로 교체:

```
roles        ← string[], 예: ['planning', 'design.ui', 'design.ux'] (다중 선택 가능)
```

- [ ] **Step 3: §11.5 회의록 정리 디폴트 자동 선택 로직 추가**

§11.5 끝 (line 463 근처) 에 다음 단락 추가:

```markdown
**디폴트 자동 선택 로직 (R12-S)**:
1. 사용자 등록 provider 중 `summarize` capability + `kind='api'` + Anthropic Haiku 모델 우선
2. 없으면 `kind='api'` + Gemini Flash 모델
3. 없으면 `summarize` capability 인 다른 api/cli provider
4. 마지막 fallback: `kind='local'` Ollama 첫 번째 ready provider
5. 모두 없으면 정리 skip (회의록 deterministic minutes 만)

사용자가 settings 에서 명시 선택 시 자동 선택 무시.
```

- [ ] **Step 4: §11.7 R12-S task 항목 추가**

§11.7 R12-S 블록 (line 475 근처) 에 다음 두 줄 추가:

```markdown
- 회의록 정리 모델 별도 settings (`summaryModelProviderId`) — 디폴트 자동 선택 로직 + 사용자 명시 선택.
- agestra plugin (`/home/taniar/.claude/plugins/cache/agestra/agestra/4.13.0/agents/`) 의 system prompt 를 reference 하되 한국어로 재작성.
```

- [ ] **Step 5: 변경 확인**

Run: `git diff --stat docs/specs/2026-05-01-rolestra-channel-roles-design.md`
Expected: 1 file changed, 약 30~40 insertions, 약 5~10 deletions.

- [ ] **Step 6: Commit**

```bash
git add docs/specs/2026-05-01-rolestra-channel-roles-design.md
git commit -m "docs(rolestra): R12 spec — 능력 카탈로그 5→10 확장 + 회의록 정리 모델 자동 선택

- design 1개 → design.ui/design.ux/design.character/design.background 4분할
- general + meeting-summary 시스템 항목 추가
- 부서 템플릿 8개 (디폴트 6 + 옵션 2) 단락
- 회의록 정리 모델 자동 선택 로직 (Claude Haiku → Gemini Flash → 기타 → Ollama)

R12-S 진입 전 spec 정합."
```

---

## Task 1: DB Migration 017 — providers.roles + skill_overrides

**Goal:** `providers` 테이블에 `roles` (TEXT NOT NULL DEFAULT '[]') + `skill_overrides` (TEXT, nullable) 컬럼 추가. Forward-only, idempotent (chain-level), 기존 row 는 default 로 채워짐.

**Files:**
- Create: `src/main/database/migrations/017-providers-roles-skills.ts`
- Modify: `src/main/database/migrations/index.ts:?` (export 배열 끝에 추가)
- Test: `src/main/database/__tests__/migrator.test.ts` (기존 마이그레이션 chain 테스트가 자동 커버 — 신규 케이스 추가만)

**Acceptance Criteria:**
- [ ] `017-providers-roles-skills.ts` 가 `Migration` 타입 export
- [ ] `roles` 컬럼: TEXT NOT NULL DEFAULT '[]' — JSON array 직렬화
- [ ] `skill_overrides` 컬럼: TEXT, nullable — JSON object 직렬화, NULL = 기본 카탈로그 사용
- [ ] migrations/index.ts 의 export 배열 끝에 등록 — 016 다음 위치
- [ ] migrator integration 테스트가 17개 마이그레이션 chain 모두 적용 + idempotent 통과
- [ ] 기존 row 에 default `'[]'` + NULL 채워짐 (마이그레이션 후 SELECT 확인)

**Verify:** `npx vitest run src/main/database/__tests__/migrator.test.ts -t "all migrations apply"` → PASS

**Steps:**

- [ ] **Step 1: 신규 마이그레이션 파일 작성**

Create `src/main/database/migrations/017-providers-roles-skills.ts`:

```typescript
/**
 * Migration 017-providers-roles-skills — R12-S 페르소나/스킬 분리.
 *
 * - `roles TEXT NOT NULL DEFAULT '[]'`: JSON-serialized RoleId 배열.
 *   예: '["planning","design.ui","design.ux"]'. 빈 배열 = legacy 동작
 *   (R12-C 진입 전까지 부서 매칭 없음).
 *
 * - `skill_overrides TEXT`: JSON-serialized Record<RoleId, string> (nullable).
 *   사용자 customize prompt 템플릿. NULL = catalog default 사용.
 *
 * persona 컬럼 의미는 *문서 수준* 으로만 변경 (캐릭터 only) — 기존 데이터는
 * 그대로. 사용자가 직원 편집 모달에서 정리하라는 안내만 띄움 (Task 8).
 *
 * SQLite 의 ALTER TABLE ADD COLUMN 은 IF NOT EXISTS 미지원 — chain-level
 * idempotency (migrator tracking 표) 만 보장.
 *
 * Migration files are immutable once applied.
 */

import type { Migration } from '../migrator';

export const migration: Migration = {
  id: '017-providers-roles-skills',
  sql: `
ALTER TABLE providers ADD COLUMN roles TEXT NOT NULL DEFAULT '[]';
ALTER TABLE providers ADD COLUMN skill_overrides TEXT;
`,
};
```

- [ ] **Step 2: index.ts 등록**

Read current `src/main/database/migrations/index.ts` 끝 부분, 016 다음에 다음 두 줄 추가:

```typescript
import { migration as m017 } from './017-providers-roles-skills';
// ...
export const ALL_MIGRATIONS: Migration[] = [
  // ... existing 001 ~ 016
  m017,
];
```

(정확한 변수 명명/패턴은 기존 015/016 등록 모양 그대로 따름 — Read 로 먼저 확인 후 동일 스타일.)

- [ ] **Step 3: 신규 테스트 케이스 추가**

Edit `src/main/database/__tests__/migrator.test.ts` — 다음 테스트 추가:

```typescript
it('017-providers-roles-skills adds roles + skill_overrides columns', () => {
  const db = openInMemoryDatabase();
  applyAllMigrations(db);

  // 컬럼 존재 확인
  const cols = db.prepare(`PRAGMA table_info(providers)`).all() as Array<{ name: string }>;
  const colNames = cols.map((c) => c.name);
  expect(colNames).toContain('roles');
  expect(colNames).toContain('skill_overrides');

  // default 값 확인 — INSERT 후 SELECT
  db.prepare(
    `INSERT INTO providers (id, kind, display_name, config_json, persona, created_at, updated_at)
     VALUES ('test-1', 'api', 'Test', '{}', '', unixepoch(), unixepoch())`,
  ).run();

  const row = db.prepare(`SELECT roles, skill_overrides FROM providers WHERE id = 'test-1'`).get() as {
    roles: string;
    skill_overrides: string | null;
  };
  expect(row.roles).toBe('[]');
  expect(row.skill_overrides).toBeNull();
});
```

- [ ] **Step 4: 테스트 실행**

Run: `npx vitest run src/main/database/__tests__/migrator.test.ts`
Expected: 모든 케이스 PASS, 신규 "017-providers-roles-skills" 케이스 포함.

- [ ] **Step 5: typecheck**

Run: `npm run typecheck`
Expected: 0 error.

- [ ] **Step 6: Commit**

```bash
git add src/main/database/migrations/017-providers-roles-skills.ts \
        src/main/database/migrations/index.ts \
        src/main/database/__tests__/migrator.test.ts
git commit -m "feat(rolestra): R12-S Task 1 — migration 017 providers.roles + skill_overrides

- roles TEXT NOT NULL DEFAULT '[]' (JSON array)
- skill_overrides TEXT (JSON object, nullable)
- persona 의미 변경 (문서 수준만, 데이터 그대로)
- migrator 신규 PRAGMA + INSERT default 케이스"
```

---

## Task 2: Shared Types — RoleId / SkillId / ProviderInfo 확장

**Goal:** `src/shared/role-types.ts` 신규 — 10 능력 literal union + ToolGrant + SkillTemplate 타입. `src/shared/provider-types.ts` 의 `ProviderInfo` 에 `roles` + `skill_overrides` 필드 추가.

**Files:**
- Create: `src/shared/role-types.ts`
- Modify: `src/shared/provider-types.ts:?` (ProviderInfo interface)

**Acceptance Criteria:**
- [ ] `RoleId` = `'idea' | 'planning' | 'design.ui' | 'design.ux' | 'design.character' | 'design.background' | 'implement' | 'review' | 'general'` — 9 직원 능력
- [ ] `SystemSkillId` = `'meeting-summary'` — 시스템 전용
- [ ] `ToolGrant` = `'file.read' | 'file.write' | 'command.exec' | 'db.read' | 'web.search'` — boolean matrix 의 키
- [ ] `SkillTemplate` interface = `{ roleId: RoleId | SystemSkillId; label: { ko: string; en: string }; systemPromptKo: string; toolGrants: Record<ToolGrant, boolean>; externalEndpoints: string[] }`
- [ ] `ProviderInfo` 가 `roles: RoleId[]` + `skill_overrides: Record<RoleId, string> | null` 필드 (둘 다 required)
- [ ] `npm run typecheck` 0 error

**Verify:** `npm run typecheck` → 0 error + `npx vitest run --reporter=basic` → 영향 안 받음 (기존 통과 유지)

**Steps:**

- [ ] **Step 1: role-types.ts 작성**

Create `src/shared/role-types.ts`:

```typescript
/**
 * Role / Skill 식별자 — R12-S 페르소나/스킬 분리.
 *
 * 10 능력 (9 직원 + 1 시스템) 의 type-level 정의. 카탈로그 본문 (prompt
 * 텍스트, tool 권한 matrix) 은 src/shared/skill-catalog.ts 에 위치한다.
 *
 * 본 union 은 forward-only — 새 role 추가 시 catalog + i18n + UI chip
 * 모두 동기 업데이트.
 */

/** 직원에게 부여 가능한 능력 (9). */
export type RoleId =
  | 'idea'
  | 'planning'
  | 'design.ui'
  | 'design.ux'
  | 'design.character'
  | 'design.background'
  | 'implement'
  | 'review'
  | 'general';

/** 시스템만 호출 — 직원 부여 X. */
export type SystemSkillId = 'meeting-summary';

/** Skill catalog entry 의 ID 합집합. */
export type SkillId = RoleId | SystemSkillId;

/** Tool 권한 matrix 키. */
export type ToolGrant =
  | 'file.read'
  | 'file.write'
  | 'command.exec'
  | 'db.read'
  | 'web.search';

/** 카탈로그 항목 = system prompt + tool 권한 matrix + 외부 endpoint slot. */
export interface SkillTemplate {
  /** 능력 ID. */
  id: SkillId;
  /** UI 라벨 (i18n 키 fallback). */
  label: { ko: string; en: string };
  /** 한국어 system prompt 본문 (default — settings.ts 의 i18n 분기는 R11 D9 따름). */
  systemPromptKo: string;
  /** boolean matrix — 직원이 그 부서에서 활성 시 적용. */
  toolGrants: Record<ToolGrant, boolean>;
  /** 외부 자원 endpoint slot (R12-S 는 schema 만, 호출은 후속). */
  externalEndpoints: string[];
}

/** 9 직원 능력의 readonly array — UI chip / 검증 enum. */
export const ALL_ROLE_IDS: readonly RoleId[] = [
  'idea',
  'planning',
  'design.ui',
  'design.ux',
  'design.character',
  'design.background',
  'implement',
  'review',
  'general',
] as const;

/** type guard. */
export function isRoleId(value: string): value is RoleId {
  return (ALL_ROLE_IDS as readonly string[]).includes(value);
}
```

- [ ] **Step 2: provider-types.ts 확장**

Edit `src/shared/provider-types.ts` — `ProviderInfo` interface (찾아서 위치 확인) 에 다음 두 필드 추가:

```typescript
import type { RoleId } from './role-types';

export interface ProviderInfo {
  // ... existing fields (id, kind, displayName, model, status, capabilities, persona)
  /** R12-S: 직원에게 부여된 능력 (다중 가능, 빈 배열 = 어떤 부서도 못 들어감). */
  roles: RoleId[];
  /** R12-S: 능력별 사용자 customize prompt — null = 카탈로그 default. */
  skill_overrides: Record<RoleId, string> | null;
}
```

(정확한 ProviderInfo 위치는 Read 로 확인 후 적용 — 80~120 라인 범위.)

- [ ] **Step 3: 타입 검증 + 회귀**

Run: `npm run typecheck`
Expected: 0 error.

`ProviderInfo` 를 사용하는 모든 호출지 (provider-handler / use-providers / settings UI) 에서 새 필드를 채우지 않으면 typecheck 가 깨질 수 있음 — 이 task 에서는 *type 만 추가*, 채우기는 Task 5 / Task 8 에서 처리. typecheck 깨지면:
- ProviderInfo 생성 지점 찾기: `grep -rn "ProviderInfo" src/main/providers/ src/main/ipc/ src/renderer/`
- 임시로 `roles: []`, `skill_overrides: null` 로 채워서 typecheck 통과시킴 (Task 5 에서 진짜 데이터로 교체)

Run: `npx vitest run --reporter=basic`
Expected: 기존 테스트 모두 PASS.

- [ ] **Step 4: Commit**

```bash
git add src/shared/role-types.ts src/shared/provider-types.ts \
        $(git diff --name-only | grep -E "(provider-handler|provider-restore|use-provider|registry)")
git commit -m "feat(rolestra): R12-S Task 2 — RoleId/SkillTemplate 타입 + ProviderInfo 확장

- src/shared/role-types.ts 신규 (9 RoleId + meeting-summary SystemSkillId + SkillTemplate)
- ProviderInfo 에 roles: RoleId[] + skill_overrides 필드 추가
- 호출지 임시 default ([]/null) 로 typecheck 통과 — 실제 데이터는 Task 5 에서 wire"
```

---

## Task 3: 스킬 카탈로그 모듈 — 10 능력 정의 (agestra reference)

**Goal:** `src/shared/skill-catalog.ts` 가 10 SkillTemplate 인스턴스를 export. system prompt 는 한국어, agestra plugin 의 description / system prompt 를 reference 하되 Rolestra 메타포 (직원 / 부서) 로 재작성.

**Files:**
- Create: `src/shared/skill-catalog.ts`

**Acceptance Criteria:**
- [ ] 10 SkillTemplate 모두 정의 — 9 RoleId + 1 SystemSkillId
- [ ] 각 systemPromptKo 가 한국어 4~12 줄, "당신은 {부서} 부서의 {능력} 담당입니다" 시작
- [ ] toolGrants matrix 가 R7 path-guard 와 호환 — `implement` 만 `file.write` + `command.exec` true, `review` 는 read + command.exec true (테스트 실행) , 나머지 read only
- [ ] `general` 은 모든 tool false — 잡담 안전
- [ ] `meeting-summary` 는 systemPromptKo 가 기존 `meeting-summary-service.ts` 의 SUMMARY_PERSONA 메시지와 의미 일치 (그 service 가 본 카탈로그를 참조하도록 Task 10 에서 wire)
- [ ] `getSkillTemplate(id: SkillId): SkillTemplate` helper export
- [ ] `npm run typecheck` 0 error

**Verify:** `npx vitest run --reporter=basic src/shared/__tests__/skill-catalog.test.ts` → PASS (Task 4 에서 작성)

**Steps:**

- [ ] **Step 1: 카탈로그 본문 작성**

Create `src/shared/skill-catalog.ts`:

```typescript
/**
 * 스킬 카탈로그 — R12-S 능력 정의 (10).
 *
 * 각 능력 = (한국어 system prompt + tool 권한 matrix + 외부 endpoint slot).
 * agestra plugin (4.13.0) 의 agent 들이 reference — 하되 한국어 + Rolestra
 * 메타포 (회사 / 부서 / 직원) 로 재작성.
 *
 * 본 카탈로그 = default. 사용자가 직원 편집 모달에서 능력별로 prompt 를
 * customize 하면 providers.skill_overrides 에 저장 — SkillService 가
 * lookup 시 override 우선.
 */

import type { SkillTemplate, SkillId, ToolGrant } from './role-types';

const NO_TOOLS: Record<ToolGrant, boolean> = {
  'file.read': false,
  'file.write': false,
  'command.exec': false,
  'db.read': false,
  'web.search': false,
};

const READ_ONLY: Record<ToolGrant, boolean> = {
  ...NO_TOOLS,
  'file.read': true,
  'db.read': true,
};

const READ_PLUS_WEB: Record<ToolGrant, boolean> = {
  ...READ_ONLY,
  'web.search': true,
};

export const SKILL_CATALOG: Record<SkillId, SkillTemplate> = {
  idea: {
    id: 'idea',
    label: { ko: '아이디어', en: 'Idea' },
    systemPromptKo:
      `당신은 아이디어 부서의 자유 발산 담당입니다.
주제에 대해 떠오르는 가능성을 폭넓게 제시하세요.
- 비판은 보류하고 다양성을 우선합니다.
- 구현 가능성을 미리 따지지 마세요.
- 비슷한 도구 / 경쟁 사례 / 사용자 불만을 단서로 활용하세요.
- 의견은 짧고 구체적으로, 한 발언당 핵심 1~3 가지.`,
    toolGrants: READ_PLUS_WEB,
    externalEndpoints: [],
  },

  planning: {
    id: 'planning',
    label: { ko: '기획', en: 'Planning' },
    systemPromptKo:
      `당신은 기획 부서의 spec 작성 담당입니다.
사용자 의도를 정확히 분해하고 작업 가능한 단위로 정리하세요.
- 사용자 페르소나 / 사용 시나리오 / 성공 기준을 먼저 합의합니다.
- 우선순위는 MVP → 단계별 → 완성 흐름에 맞춰 분리합니다.
- 다른 부서로 인계할 작업은 결정문 형태로 명시합니다 (무엇을 / 왜 / 언제까지).
- 모호한 요구는 질문으로 명확화 후 진행합니다.`,
    toolGrants: READ_PLUS_WEB,
    externalEndpoints: ['market-research'], // R12-S schema slot, 호출은 후속
  },

  'design.ui': {
    id: 'design.ui',
    label: { ko: '디자인 (UI)', en: 'Design (UI)' },
    systemPromptKo:
      `당신은 디자인 부서의 UI / 형태 담당입니다.
컴포넌트 형태, 디자인 토큰, 시각 위계를 정의하세요.
- 색상 / 간격 / 타이포 / 그림자 토큰을 일관되게 제시합니다.
- 컴포넌트 단위로 시안 제시, 사용 위치 / 변형 / 상태 표기.
- UX 담당과 협의해서 형태가 사용 흐름을 막지 않게 조율합니다.
- 시안은 ASCII 또는 마크다운 표 + 토큰 리스트 형태로 출력하세요.`,
    toolGrants: READ_ONLY,
    externalEndpoints: ['figma-url', 'color-extract'],
  },

  'design.ux': {
    id: 'design.ux',
    label: { ko: '디자인 (UX)', en: 'Design (UX)' },
    systemPromptKo:
      `당신은 디자인 부서의 UX / 사용감 담당입니다.
사용자 흐름, 정보 구조, 의사결정 비용을 다룹니다.
- 사용 시나리오를 단계별로 분해합니다 (entry → action → feedback).
- 사용자가 막히는 지점, 되돌리기 비용을 명시합니다.
- UI 담당과 협의해서 사용 흐름이 형태로 잘 표현되는지 확인합니다.
- 출력은 사용 흐름 도식 + 결정 포인트 리스트.`,
    toolGrants: READ_PLUS_WEB,
    externalEndpoints: [],
  },

  'design.character': {
    id: 'design.character',
    label: { ko: '디자인 (캐릭터)', en: 'Design (Character)' },
    systemPromptKo:
      `당신은 캐릭터 디자인 부서의 시안 담당입니다 (게임 / 비주얼 노벨 / 일러스트레이션 프로젝트 한정).
캐릭터의 외형, 성격, 모션 컨셉을 일관되게 제시합니다.
- 캐릭터 시트 형태로 출력 (이름 / 역할 / 외형 키워드 / 컬러 팔레트 / 의상 / 표정 / 모션).
- 세계관 / 배경 부서와 톤 / 컬러 / 시대감 협의.
- 같은 캐릭터의 변형은 "기본 / 표정 변형 / 동작 변형" 명시.
- 게임 외 프로젝트는 본 부서를 사용하지 않습니다.`,
    toolGrants: READ_ONLY,
    externalEndpoints: ['reference-image'],
  },

  'design.background': {
    id: 'design.background',
    label: { ko: '디자인 (배경)', en: 'Design (Background)' },
    systemPromptKo:
      `당신은 배경 디자인 부서의 시안 담당입니다 (게임 / 비주얼 노벨 / 일러스트레이션 프로젝트 한정).
배경 / 환경 / 무드를 일관되게 제시합니다.
- 배경 시트 형태로 출력 (장소 / 시간대 / 무드 / 컬러 팔레트 / 핵심 요소 / 카메라 각도).
- 캐릭터 부서와 톤 / 컬러 / 시대감 협의.
- 시안은 "와이드샷 / 미디엄 / 클로즈업" 단위 제시.
- 게임 외 프로젝트는 본 부서를 사용하지 않습니다.`,
    toolGrants: READ_ONLY,
    externalEndpoints: ['reference-image'],
  },

  implement: {
    id: 'implement',
    label: { ko: '구현', en: 'Implement' },
    systemPromptKo:
      `당신은 구현 부서의 코드 작성 담당입니다.
기획 부서 결정문 + 디자인 부서 시안을 받아 실제 코드를 작성합니다.
- 기존 코드 패턴 / 네이밍 / 추상화 레벨을 따릅니다 (마음대로 refactor 금지).
- 변경은 작은 단위로, 테스트 가능한 형태로.
- 명령 실행 / 파일 쓰기 권한이 있습니다 — 사용자 승인 게이트 거친 후 적용됩니다.
- 모호한 부분은 추측하지 말고 기획 부서로 인계 / 질문하세요.`,
    toolGrants: {
      'file.read': true,
      'file.write': true,
      'command.exec': true,
      'db.read': true,
      'web.search': false,
    },
    externalEndpoints: [],
  },

  review: {
    id: 'review',
    label: { ko: '검토', en: 'Review' },
    systemPromptKo:
      `당신은 검토 부서의 품질 담당입니다.
구현 부서 결과를 받아 다음을 검증합니다:
- lint / typecheck / 테스트 실행 결과 PASS 여부
- 스파게티 / 하드코딩 / fallback 위장 패턴 (CLAUDE.md 절대 금지 항목)
- 기획 결정문과 실제 동작 일치
- 사용성 / 성능 / 메모리 위험
출력은 PASS / FAIL + 위반 항목 리스트 + 재작업 지시 (구현 부서로 인계).
보안 위험은 별도 표시.`,
    toolGrants: {
      'file.read': true,
      'file.write': false,
      'command.exec': true, // 테스트 / lint 실행
      'db.read': true,
      'web.search': false,
    },
    externalEndpoints: [],
  },

  general: {
    id: 'general',
    label: { ko: '일반 (잡담)', en: 'General' },
    systemPromptKo:
      `당신은 일반 채널의 잡담 / Q&A 담당입니다.
사용자 메시지에 1턴으로 자연스럽게 응답합니다.
- 회의는 시작하지 않습니다.
- 작업 요청이 들어오면 "{부서명} 부서로 가시면 됩니다" 안내합니다.
- 톤은 가볍고 짧게.`,
    toolGrants: NO_TOOLS,
    externalEndpoints: [],
  },

  'meeting-summary': {
    id: 'meeting-summary',
    label: { ko: '회의록 자동 정리', en: 'Meeting Summary' },
    systemPromptKo:
      `다음 회의 내용을 한국어로 한 단락 (2~4 문장) 으로 간결하게 요약하세요.
메타 코멘트나 머리말 없이 요약 본문만 출력하세요.
- 결정 사항 / 합의 / 미합의 / 다음 행동을 한 문장씩 포함.
- 발언자 이름은 필요한 경우만 인용.
- 객관적 톤, 캐릭터 영향 배제.`,
    toolGrants: NO_TOOLS,
    externalEndpoints: [],
  },
};

/** SkillId → SkillTemplate lookup. unknown id 는 throw. */
export function getSkillTemplate(id: SkillId): SkillTemplate {
  const tpl = SKILL_CATALOG[id];
  if (!tpl) {
    throw new Error(
      `[skill-catalog] unknown skill id: ${id}. ` +
        `Known: ${Object.keys(SKILL_CATALOG).join(', ')}`,
    );
  }
  return tpl;
}

/** UI chip 용 9 직원 능력만 (system 제외). */
export function listEmployeeRoles(): SkillTemplate[] {
  return Object.values(SKILL_CATALOG).filter(
    (tpl) => tpl.id !== 'meeting-summary',
  );
}
```

- [ ] **Step 2: typecheck**

Run: `npm run typecheck`
Expected: 0 error.

- [ ] **Step 3: Commit (테스트는 Task 4)**

```bash
git add src/shared/skill-catalog.ts
git commit -m "feat(rolestra): R12-S Task 3 — 스킬 카탈로그 10 능력 정의

- 9 직원 능력 (idea/planning/design.ui/design.ux/design.character/design.background/implement/review/general)
- 1 시스템 능력 (meeting-summary)
- agestra plugin agent prompt reference, 한국어 + Rolestra 메타포
- toolGrants matrix R7 path-guard 호환 (implement 만 file.write+command.exec)
- externalEndpoints schema slot (R12-S 는 호출 X)"
```

---

## Task 4: SkillService + 단위 테스트 (TDD)

**Goal:** `src/main/skills/skill-service.ts` 가 카탈로그 lookup + override merge + RoleId 검증을 담당. `getSkillForRole(roleId, providerOverrides)` → effective `SkillTemplate` 반환.

**Files:**
- Create: `src/main/skills/skill-service.ts`
- Create: `src/main/skills/__tests__/skill-service.test.ts`

**Acceptance Criteria:**
- [ ] `getSkillForRole(roleId: RoleId, overrides: Record<RoleId, string> | null): SkillTemplate` — override 있으면 systemPromptKo 만 교체 (toolGrants/externalEndpoints 는 카탈로그 그대로)
- [ ] `validateRoles(roles: string[]): RoleId[]` — unknown 은 throw with specific id
- [ ] `listAvailableRolesForProvider(providerRoles: RoleId[], channelRole: RoleId): RoleId[]` — 직원이 보유 능력 ∩ 채널이 요구하는 role
- [ ] 테스트 ≥ 8 케이스: catalog 9 + override 적용 + override 없음 + unknown role throw + general empty toolGrants + implement file.write true + meeting-summary skill_overrides 무시 (시스템 전용)
- [ ] `npx vitest run src/main/skills/__tests__/` PASS

**Verify:** `npx vitest run src/main/skills/__tests__/skill-service.test.ts --reporter=verbose` → 모든 테스트 PASS

**Steps:**

- [ ] **Step 1: 실패 테스트 작성 (red)**

Create `src/main/skills/__tests__/skill-service.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { SkillService } from '../skill-service';
import type { RoleId } from '../../../shared/role-types';

describe('SkillService.getSkillForRole', () => {
  const svc = new SkillService();

  it('returns catalog default when no overrides', () => {
    const tpl = svc.getSkillForRole('planning', null);
    expect(tpl.id).toBe('planning');
    expect(tpl.systemPromptKo).toContain('기획 부서');
    expect(tpl.toolGrants['web.search']).toBe(true);
  });

  it('applies user override prompt while keeping toolGrants', () => {
    const overrides = { planning: '커스텀 PM 프롬프트' } as Record<RoleId, string>;
    const tpl = svc.getSkillForRole('planning', overrides);
    expect(tpl.systemPromptKo).toBe('커스텀 PM 프롬프트');
    expect(tpl.toolGrants['web.search']).toBe(true); // matrix 그대로
  });

  it('implement skill grants file.write + command.exec', () => {
    const tpl = svc.getSkillForRole('implement', null);
    expect(tpl.toolGrants['file.write']).toBe(true);
    expect(tpl.toolGrants['command.exec']).toBe(true);
  });

  it('general skill grants nothing', () => {
    const tpl = svc.getSkillForRole('general', null);
    Object.values(tpl.toolGrants).forEach((v) => expect(v).toBe(false));
  });

  it('review skill grants command.exec but not file.write', () => {
    const tpl = svc.getSkillForRole('review', null);
    expect(tpl.toolGrants['command.exec']).toBe(true);
    expect(tpl.toolGrants['file.write']).toBe(false);
  });

  it('overrides for unknown role are ignored', () => {
    const overrides = { unknown: 'x' } as unknown as Record<RoleId, string>;
    const tpl = svc.getSkillForRole('idea', overrides);
    expect(tpl.systemPromptKo).toContain('아이디어 부서');
  });
});

describe('SkillService.validateRoles', () => {
  const svc = new SkillService();

  it('accepts valid RoleIds', () => {
    expect(svc.validateRoles(['planning', 'design.ui'])).toEqual([
      'planning',
      'design.ui',
    ]);
  });

  it('throws on unknown role with specific id', () => {
    expect(() => svc.validateRoles(['planning', 'wat'])).toThrow(/wat/);
  });

  it('throws on meeting-summary (system only)', () => {
    expect(() => svc.validateRoles(['meeting-summary'])).toThrow(/system/i);
  });
});

describe('SkillService.listAvailableRolesForProvider', () => {
  const svc = new SkillService();

  it('returns intersection of provider roles and channel role', () => {
    expect(
      svc.listAvailableRolesForProvider(['planning', 'design.ui'], 'design.ui'),
    ).toEqual(['design.ui']);
  });

  it('returns empty when provider lacks channel role', () => {
    expect(svc.listAvailableRolesForProvider(['idea'], 'implement')).toEqual([]);
  });
});
```

Run: `npx vitest run src/main/skills/__tests__/skill-service.test.ts`
Expected: FAIL (`Cannot find module '../skill-service'`).

- [ ] **Step 2: 최소 구현 (green)**

Create `src/main/skills/skill-service.ts`:

```typescript
/**
 * SkillService — R12-S 카탈로그 lookup + override merge.
 *
 * - getSkillForRole: 카탈로그 default + 사용자 override (systemPromptKo 만)
 * - validateRoles: unknown / system-only role 차단
 * - listAvailableRolesForProvider: 직원 ∩ 채널
 *
 * 본 service 는 stateless — 카탈로그가 build-time constant.
 */

import {
  getSkillTemplate,
  SKILL_CATALOG,
} from '../../shared/skill-catalog';
import type { RoleId, SkillTemplate } from '../../shared/role-types';
import { ALL_ROLE_IDS, isRoleId } from '../../shared/role-types';

export class SkillService {
  /** 카탈로그 default + override merge. */
  getSkillForRole(
    roleId: RoleId,
    overrides: Record<RoleId, string> | null,
  ): SkillTemplate {
    const base = getSkillTemplate(roleId);
    const overridePrompt = overrides?.[roleId];
    if (typeof overridePrompt === 'string' && overridePrompt.length > 0) {
      return { ...base, systemPromptKo: overridePrompt };
    }
    return base;
  }

  /** unknown / 시스템 전용 차단. */
  validateRoles(values: string[]): RoleId[] {
    return values.map((v) => {
      if (v === 'meeting-summary') {
        throw new Error(
          `[SkillService] 'meeting-summary' is a system-only skill — cannot be assigned to a provider.`,
        );
      }
      if (!isRoleId(v)) {
        throw new Error(
          `[SkillService] unknown role id: ${v}. ` +
            `Known: ${ALL_ROLE_IDS.join(', ')}`,
        );
      }
      return v;
    });
  }

  /** 직원 능력 ∩ 채널 역할. */
  listAvailableRolesForProvider(
    providerRoles: RoleId[],
    channelRole: RoleId,
  ): RoleId[] {
    return providerRoles.filter((r) => r === channelRole);
  }

  /** 9 능력 readonly — UI chip. */
  listEmployeeRoleIds(): readonly RoleId[] {
    return ALL_ROLE_IDS;
  }
}
```

Run: `npx vitest run src/main/skills/__tests__/skill-service.test.ts`
Expected: 모든 케이스 PASS.

- [ ] **Step 3: typecheck + lint**

Run: `npm run typecheck && npm run lint -- src/main/skills/`
Expected: 0 error / 0 warning.

- [ ] **Step 4: Commit**

```bash
git add src/main/skills/skill-service.ts \
        src/main/skills/__tests__/skill-service.test.ts
git commit -m "feat(rolestra): R12-S Task 4 — SkillService + 단위 테스트

- getSkillForRole: 카탈로그 + override merge (systemPromptKo만)
- validateRoles: unknown + meeting-summary system-only 차단
- listAvailableRolesForProvider: 직원 ∩ 채널 교집합
- 8 케이스 PASS"
```

---

## Task 5: ProviderRepository + ProviderService 확장

**Goal:** DB 의 `roles` + `skill_overrides` 컬럼을 read/write 하도록 `provider-repository.ts` 확장. `provider-handler.ts` 가 ProviderInfo 직렬화에 두 필드 포함.

**Files:**
- Modify: `src/main/providers/provider-repository.ts` (saveProvider 시그니처 + loadAllProviders SELECT)
- Modify: `src/main/providers/provider-handler.ts` (handleAddProvider / handleUpdateProvider)
- Modify: `src/main/providers/__tests__/provider-repository.test.ts` (또는 신규)
- Modify: `src/main/providers/registry.ts` (ProviderInfo 변환 — Task 2 의 임시 [] / null 제거)

**Acceptance Criteria:**
- [ ] `saveProvider` 가 `roles: RoleId[]` + `skillOverrides: Record<RoleId, string> | null` 인자 추가
- [ ] `ProviderRow` 타입에 `roles: string` (JSON) + `skillOverrides: string | null` 필드 추가
- [ ] `loadAllProviders` SELECT 가 두 컬럼 포함
- [ ] JSON parse 실패 시 throw (silent fallback 금지 — CLAUDE.md 절대 규칙)
- [ ] handler 가 AddProviderInput / UpdateProviderInput 에 roles 추가 + SkillService.validateRoles 호출
- [ ] 기존 add/update 테스트가 새 필드 default 채워서 통과
- [ ] `npx vitest run src/main/providers/__tests__/` PASS

**Verify:** `npx vitest run src/main/providers/__tests__/ --reporter=basic` → all PASS

**Steps:**

- [ ] **Step 1: ProviderRow 타입 + saveProvider 시그니처 확장 — 테스트 먼저**

Edit `src/main/providers/__tests__/provider-repository.test.ts` (없으면 신규) — 다음 테스트 추가:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import {
  saveProvider,
  loadAllProviders,
  removeProvider,
} from '../provider-repository';
import { resetTestDatabase } from '../../database/__test-helpers__/db-helpers';

describe('ProviderRepository — R12-S roles + skill_overrides', () => {
  beforeEach(() => {
    resetTestDatabase(); // 17 마이그레이션 모두 적용된 깨끗한 DB
  });

  it('saves and loads roles + skill_overrides', () => {
    saveProvider(
      'p1',
      'api',
      'Claude',
      '신중한 PM',
      { type: 'api', endpoint: 'x', apiKeyRef: 'k', model: 'sonnet' },
      ['planning', 'design.ui'],
      { planning: '커스텀 PM 프롬프트' },
    );
    const rows = loadAllProviders();
    expect(rows).toHaveLength(1);
    expect(rows[0].roles).toBe('["planning","design.ui"]');
    expect(rows[0].skillOverrides).toBe('{"planning":"커스텀 PM 프롬프트"}');
  });

  it('persists empty roles and null skill_overrides as defaults', () => {
    saveProvider(
      'p2',
      'cli',
      'Codex',
      '',
      { type: 'cli', /* ... minimal */ } as never,
      [],
      null,
    );
    const rows = loadAllProviders();
    expect(rows[0].roles).toBe('[]');
    expect(rows[0].skillOverrides).toBeNull();
  });

  it('upserts roles on conflict', () => {
    saveProvider('p3', 'api', 'Test', '', { type: 'api', endpoint: 'x', apiKeyRef: 'k', model: 'm' }, ['idea'], null);
    saveProvider('p3', 'api', 'Test', '', { type: 'api', endpoint: 'x', apiKeyRef: 'k', model: 'm' }, ['planning'], null);
    const rows = loadAllProviders();
    expect(rows[0].roles).toBe('["planning"]');
  });
});
```

Run: `npx vitest run src/main/providers/__tests__/provider-repository.test.ts`
Expected: FAIL (시그니처 mismatch).

- [ ] **Step 2: provider-repository.ts 확장**

Edit `src/main/providers/provider-repository.ts`:

```typescript
import type { RoleId } from '../../shared/role-types';

export interface ProviderRow {
  id: string;
  kind: ProviderType;
  displayName: string;
  persona: string | null;
  configJson: string;
  /** R12-S: JSON-serialized RoleId[]. */
  roles: string;
  /** R12-S: JSON-serialized Record<RoleId, string> | null. */
  skillOverrides: string | null;
}

export function saveProvider(
  id: string,
  kind: ProviderType,
  displayName: string,
  persona: string | undefined,
  config: ProviderConfig,
  roles: RoleId[],
  skillOverrides: Record<RoleId, string> | null,
): void {
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT INTO providers (id, display_name, kind, config_json, persona, roles, skill_overrides, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())
    ON CONFLICT(id) DO UPDATE SET
      display_name    = excluded.display_name,
      kind            = excluded.kind,
      config_json     = excluded.config_json,
      persona         = excluded.persona,
      roles           = excluded.roles,
      skill_overrides = excluded.skill_overrides,
      updated_at      = unixepoch()
  `);
  stmt.run(
    id,
    displayName,
    kind,
    JSON.stringify(config),
    persona ?? '',
    JSON.stringify(roles),
    skillOverrides === null ? null : JSON.stringify(skillOverrides),
  );
}

export function loadAllProviders(): ProviderRow[] {
  const db = getDatabase();
  return db
    .prepare(
      `SELECT id, kind, display_name AS displayName, persona, config_json AS configJson,
              roles, skill_overrides AS skillOverrides
         FROM providers`,
    )
    .all() as ProviderRow[];
}
```

Run: `npx vitest run src/main/providers/__tests__/provider-repository.test.ts`
Expected: PASS.

- [ ] **Step 3: registry.ts — Row → ProviderInfo 변환**

`src/main/providers/registry.ts` 의 row → ProviderInfo 변환 함수 (보통 `rowToInfo` 또는 inline) 에서:

```typescript
import type { RoleId } from '../../shared/role-types';

function parseRoles(rolesJson: string): RoleId[] {
  try {
    const arr = JSON.parse(rolesJson);
    if (!Array.isArray(arr)) {
      throw new Error(`roles JSON is not array: ${rolesJson}`);
    }
    return arr as RoleId[]; // SkillService.validateRoles 는 IPC 단계에서 호출
  } catch (err) {
    throw new Error(
      `[registry] failed to parse providers.roles for ${row.id}: ${rolesJson}. ` +
        `Cause: ${(err as Error).message}`,
    );
  }
}

function parseSkillOverrides(json: string | null): Record<RoleId, string> | null {
  if (json === null) return null;
  try {
    return JSON.parse(json);
  } catch (err) {
    throw new Error(
      `[registry] failed to parse providers.skill_overrides for ${row.id}: ${json}. ` +
        `Cause: ${(err as Error).message}`,
    );
  }
}

// 변환 시:
return {
  // ... existing fields
  roles: parseRoles(row.roles),
  skill_overrides: parseSkillOverrides(row.skillOverrides),
};
```

(정확한 위치 + 변수명은 Read 로 확인 후 동일 스타일 적용. 변환 함수가 없으면 inline 으로.)

- [ ] **Step 4: provider-handler.ts — Add/Update IPC 입력 확장**

Edit `src/main/ipc/handlers/provider-handler.ts` — `handleAddProvider` / `handleUpdateProvider` 가 input 의 `roles` + `skill_overrides` 받아 SkillService.validateRoles 호출 후 saveProvider 에 전달:

```typescript
import { SkillService } from '../../skills/skill-service';

const skillService = new SkillService();

export async function handleAddProvider(input: AddProviderInput): Promise<...> {
  // ... existing setup
  const validatedRoles = skillService.validateRoles(input.roles ?? []);
  saveProvider(
    id,
    input.kind,
    input.displayName,
    input.persona,
    input.config,
    validatedRoles,
    input.skill_overrides ?? null,
  );
  // ...
}
```

`UpdateProviderInput` 도 동일.

- [ ] **Step 5: 모든 ProviderInfo 호출지의 임시 default 제거**

Task 2 에서 임시로 채워둔 `roles: []`, `skill_overrides: null` 들을 실제 row 값으로 교체:

Run: `grep -rn "roles: \[\]" src/main/providers/ src/main/ipc/`
Expected: 모두 row → info 변환 단계로 이동되어 hard-coded 가 사라짐 (provider-restore.ts / 일부 테스트 helper 만 남음).

- [ ] **Step 6: 회귀 테스트**

Run: `npx vitest run src/main/providers/ src/main/ipc/`
Expected: all PASS.

Run: `npm run typecheck`
Expected: 0 error.

- [ ] **Step 7: Commit**

```bash
git add src/main/providers/ src/main/ipc/handlers/provider-handler.ts
git commit -m "feat(rolestra): R12-S Task 5 — ProviderRepository roles + skill_overrides 영속

- saveProvider 시그니처 확장 (roles, skillOverrides)
- loadAllProviders SELECT 두 컬럼 포함
- registry parseRoles/parseSkillOverrides — JSON 파싱 실패 시 throw (silent fallback 금지)
- provider-handler: SkillService.validateRoles 게이트
- 임시 [] / null 제거"
```

---

## Task 6: PromptComposer — persona + skill template 합성

**Goal:** `src/main/skills/prompt-composer.ts` 가 회의 / 인계 시 system prompt 를 합성한다. 입력: provider info + channel role + format instruction. 출력: 단일 문자열 system prompt.

본 Task 는 R12-C 채널 wire 전 — channelRole 인자는 R12-S 단계에서 dummy 호출 (예: 기존 #일반 채널이 'general' 로 매핑) 로 검증.

**Files:**
- Create: `src/main/skills/prompt-composer.ts`
- Create: `src/main/skills/__tests__/prompt-composer.test.ts`

**Acceptance Criteria:**
- [ ] `compose({ persona, providerRoles, skillOverrides, channelRole, formatInstruction })` 메서드
- [ ] 출력 = `{persona}\n\n당신은 {channelRole 라벨} 부서에서 일하고 있습니다.\n{skillTemplate.systemPromptKo}\n\n{toolGrants 요약}\n\n{formatInstruction}`
- [ ] persona 가 빈 문자열이면 그 단락 생략
- [ ] providerRoles 에 channelRole 없으면 throw with both ids
- [ ] formatInstruction 없으면 그 단락 생략
- [ ] 6 케이스 테스트 — full + persona 빈 + format 빈 + override 적용 + 권한 mismatch throw + general 부서 toolGrants 요약 "권한 없음"

**Verify:** `npx vitest run src/main/skills/__tests__/prompt-composer.test.ts -v` → 모든 케이스 PASS

**Steps:**

- [ ] **Step 1: 실패 테스트 (red)**

Create `src/main/skills/__tests__/prompt-composer.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { PromptComposer } from '../prompt-composer';
import { SkillService } from '../skill-service';

describe('PromptComposer.compose', () => {
  const composer = new PromptComposer(new SkillService());

  it('composes persona + role skill + format', () => {
    const out = composer.compose({
      persona: '신중한 PM Sarah',
      providerRoles: ['planning'],
      skillOverrides: null,
      channelRole: 'planning',
      formatInstruction: '응답은 JSON 으로.',
    });
    expect(out).toContain('신중한 PM Sarah');
    expect(out).toContain('기획 부서에서 일하고');
    expect(out).toContain('spec 작성');
    expect(out).toContain('응답은 JSON 으로.');
  });

  it('omits persona paragraph when empty', () => {
    const out = composer.compose({
      persona: '',
      providerRoles: ['idea'],
      skillOverrides: null,
      channelRole: 'idea',
      formatInstruction: '',
    });
    expect(out).not.toMatch(/^\n/);
    expect(out).toContain('아이디어 부서');
  });

  it('applies override prompt when present', () => {
    const out = composer.compose({
      persona: '',
      providerRoles: ['planning'],
      skillOverrides: { planning: '나만의 PM 가이드' },
      channelRole: 'planning',
      formatInstruction: '',
    });
    expect(out).toContain('나만의 PM 가이드');
    expect(out).not.toContain('spec 작성'); // 카탈로그 default 미포함
  });

  it('throws when provider lacks channel role', () => {
    expect(() =>
      composer.compose({
        persona: '',
        providerRoles: ['idea'],
        skillOverrides: null,
        channelRole: 'implement',
        formatInstruction: '',
      }),
    ).toThrow(/idea.*implement/);
  });

  it('summarizes tool grants for implement', () => {
    const out = composer.compose({
      persona: '',
      providerRoles: ['implement'],
      skillOverrides: null,
      channelRole: 'implement',
      formatInstruction: '',
    });
    expect(out).toMatch(/file\.write|파일 쓰기/);
    expect(out).toMatch(/command\.exec|명령 실행/);
  });

  it('summarizes "권한 없음" for general', () => {
    const out = composer.compose({
      persona: '',
      providerRoles: ['general'],
      skillOverrides: null,
      channelRole: 'general',
      formatInstruction: '',
    });
    expect(out).toContain('권한 없음');
  });
});
```

Run: `npx vitest run src/main/skills/__tests__/prompt-composer.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 2: 최소 구현 (green)**

Create `src/main/skills/prompt-composer.ts`:

```typescript
/**
 * PromptComposer — R12-S 합성 경로.
 *
 * persona (캐릭터) + role skill template (능력) + format (회의 흐름) 결합.
 * channelRole 이 providerRoles 에 없으면 throw — 직원 ∩ 부서 매칭 사전 검증.
 *
 * R12-S 는 R12-C 채널 wire 전 — channelRole 은 임시 호출 (예: legacy
 * #일반 → 'general' 매핑) 으로 검증, 본격 wire 는 R12-C.
 */

import type { RoleId } from '../../shared/role-types';
import type { SkillService } from './skill-service';
import { SKILL_CATALOG } from '../../shared/skill-catalog';

export interface ComposeInput {
  persona: string;
  providerRoles: RoleId[];
  skillOverrides: Record<RoleId, string> | null;
  channelRole: RoleId;
  formatInstruction: string;
}

const TOOL_GRANT_LABEL_KO: Record<string, string> = {
  'file.read': '파일 읽기',
  'file.write': '파일 쓰기',
  'command.exec': '명령 실행',
  'db.read': 'DB 읽기',
  'web.search': '웹 검색',
};

export class PromptComposer {
  constructor(private readonly skills: SkillService) {}

  compose(input: ComposeInput): string {
    if (!input.providerRoles.includes(input.channelRole)) {
      throw new Error(
        `[PromptComposer] provider roles [${input.providerRoles.join(', ')}] ` +
          `does not include channel role '${input.channelRole}'. ` +
          `Cannot compose — provider should not enter this channel.`,
      );
    }

    const tpl = this.skills.getSkillForRole(input.channelRole, input.skillOverrides);
    const channelLabel = SKILL_CATALOG[input.channelRole].label.ko;

    const sections: string[] = [];

    if (input.persona.trim().length > 0) {
      sections.push(input.persona.trim());
    }

    sections.push(
      `당신은 ${channelLabel} 부서에서 일하고 있습니다.\n${tpl.systemPromptKo}`,
    );

    sections.push(`권한: ${this.summarizeTools(tpl.toolGrants)}`);

    if (input.formatInstruction.trim().length > 0) {
      sections.push(input.formatInstruction.trim());
    }

    return sections.join('\n\n');
  }

  private summarizeTools(grants: Record<string, boolean>): string {
    const granted = Object.entries(grants)
      .filter(([, v]) => v)
      .map(([k]) => TOOL_GRANT_LABEL_KO[k] ?? k);
    if (granted.length === 0) return '권한 없음';
    return granted.join(' / ');
  }
}
```

Run: `npx vitest run src/main/skills/__tests__/prompt-composer.test.ts`
Expected: 모든 케이스 PASS.

- [ ] **Step 3: typecheck**

Run: `npm run typecheck`
Expected: 0 error.

- [ ] **Step 4: Commit**

```bash
git add src/main/skills/prompt-composer.ts \
        src/main/skills/__tests__/prompt-composer.test.ts
git commit -m "feat(rolestra): R12-S Task 6 — PromptComposer 합성 경로

- persona + role skill template + tool grants + format 합성
- providerRoles ∩ channelRole 검증 (불일치 시 throw)
- 빈 persona / format 단락 생략
- toolGrants 한국어 라벨 요약, 'general' 은 '권한 없음'
- 6 케이스 PASS"
```

---

## Task 7: IPC handlers — skill.list / skill.getTemplate / provider.updateRoles

**Goal:** Renderer 가 카탈로그 조회 + 직원 능력 업데이트 가능하도록 IPC 채널 추가. zod schema + typedInvoke whitelist + handler 등록.

**Files:**
- Create: `src/main/ipc/handlers/skill-handler.ts`
- Modify: `src/main/ipc/router.ts` (handler 등록)
- Modify: `src/main/ipc/handlers/provider-handler.ts` (updateRoles 추가)
- Modify: `src/shared/ipc-types.ts` (IpcChannelMap 추가)
- Modify: `src/shared/ipc-schemas.ts` (zod schemas 추가)
- Modify: `src/preload/index.ts` (typedInvoke whitelist 추가)

**Acceptance Criteria:**
- [ ] IPC channel `skill:list` → `SkillTemplate[]` (9 직원 능력만)
- [ ] IPC channel `skill:getTemplate` (input: `{ id: SkillId }`) → `SkillTemplate`
- [ ] IPC channel `provider:updateRoles` (input: `{ providerId: string; roles: RoleId[]; skill_overrides: Record<RoleId, string> | null }`) → `ProviderInfo`
- [ ] zod schema 가 SkillId / RoleId enum 으로 검증
- [ ] preload typedInvoke 화이트리스트에 3 채널 추가
- [ ] dev 모드 zod runtime validation OK
- [ ] `npx vitest run src/main/ipc/__tests__/` PASS

**Verify:** `npx vitest run src/main/ipc/__tests__/skill-handler.test.ts -v` → PASS + manual: `pnpm dev` 시 콘솔에 IPC zod 경고 없음

**Steps:**

- [ ] **Step 1: shared zod schema 추가**

Edit `src/shared/ipc-schemas.ts` — 다음 스키마 추가:

```typescript
import { z } from 'zod';
import { ALL_ROLE_IDS } from './role-types';

export const RoleIdSchema = z.enum(ALL_ROLE_IDS as unknown as [string, ...string[]]);
export const SkillIdSchema = z.union([RoleIdSchema, z.literal('meeting-summary')]);

export const SkillGetTemplateInputSchema = z.object({
  id: SkillIdSchema,
});

export const ProviderUpdateRolesInputSchema = z.object({
  providerId: z.string().min(1),
  roles: z.array(RoleIdSchema),
  skill_overrides: z.record(RoleIdSchema, z.string()).nullable(),
});
```

- [ ] **Step 2: IpcChannelMap 확장**

Edit `src/shared/ipc-types.ts` — IpcChannelMap 에 다음 추가:

```typescript
import type { SkillTemplate, SkillId } from './role-types';
import type { ProviderInfo } from './provider-types';

export interface IpcChannelMap {
  // ... existing
  'skill:list': {
    input: void;
    output: SkillTemplate[];
  };
  'skill:getTemplate': {
    input: { id: SkillId };
    output: SkillTemplate;
  };
  'provider:updateRoles': {
    input: {
      providerId: string;
      roles: RoleId[];
      skill_overrides: Record<RoleId, string> | null;
    };
    output: ProviderInfo;
  };
}
```

- [ ] **Step 3: skill-handler.ts 작성**

Create `src/main/ipc/handlers/skill-handler.ts`:

```typescript
import {
  SKILL_CATALOG,
  getSkillTemplate,
  listEmployeeRoles,
} from '../../../shared/skill-catalog';
import type { SkillTemplate, SkillId } from '../../../shared/role-types';

export async function handleSkillList(): Promise<SkillTemplate[]> {
  return listEmployeeRoles();
}

export async function handleSkillGetTemplate(input: { id: SkillId }): Promise<SkillTemplate> {
  return getSkillTemplate(input.id);
}
```

- [ ] **Step 4: provider-handler.ts — updateRoles 추가**

Edit `src/main/ipc/handlers/provider-handler.ts`:

```typescript
import { SkillService } from '../../skills/skill-service';

const skillService = new SkillService();

export async function handleProviderUpdateRoles(input: {
  providerId: string;
  roles: RoleId[];
  skill_overrides: Record<RoleId, string> | null;
}): Promise<ProviderInfo> {
  const validated = skillService.validateRoles(input.roles);
  // 기존 provider 조회
  const existing = registry.get(input.providerId)?.getInfo();
  if (!existing) {
    throw new Error(`[provider:updateRoles] provider not found: ${input.providerId}`);
  }
  // saveProvider 로 upsert (다른 필드는 기존 값 유지)
  saveProvider(
    existing.id,
    existing.kind,
    existing.displayName,
    existing.persona,
    existing.config,
    validated,
    input.skill_overrides,
  );
  // registry refresh + 새 ProviderInfo 반환
  await registry.reload(input.providerId);
  const updated = registry.get(input.providerId)!.getInfo();
  return updated;
}
```

(`registry.reload` / `saveProvider` 의 정확한 시그니처는 기존 코드 패턴 따라 조정.)

- [ ] **Step 5: router.ts — 3 채널 등록 + zod 검증**

Edit `src/main/ipc/router.ts`:

```typescript
import {
  handleSkillList,
  handleSkillGetTemplate,
} from './handlers/skill-handler';
import { handleProviderUpdateRoles } from './handlers/provider-handler';
import {
  SkillGetTemplateInputSchema,
  ProviderUpdateRolesInputSchema,
} from '../../shared/ipc-schemas';

router.register('skill:list', { input: undefined, handler: handleSkillList });
router.register('skill:getTemplate', {
  input: SkillGetTemplateInputSchema,
  handler: handleSkillGetTemplate,
});
router.register('provider:updateRoles', {
  input: ProviderUpdateRolesInputSchema,
  handler: handleProviderUpdateRoles,
});
```

- [ ] **Step 6: preload typedInvoke whitelist 추가**

Edit `src/preload/index.ts`:

```typescript
const ALLOWED_CHANNELS: ReadonlySet<keyof IpcChannelMap> = new Set([
  // ... existing
  'skill:list',
  'skill:getTemplate',
  'provider:updateRoles',
]);
```

- [ ] **Step 7: 단위 테스트**

Create `src/main/ipc/__tests__/skill-handler.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  handleSkillList,
  handleSkillGetTemplate,
} from '../handlers/skill-handler';

describe('skill IPC handlers', () => {
  it('skill:list returns 9 employee roles', async () => {
    const list = await handleSkillList();
    expect(list).toHaveLength(9);
    expect(list.find((s) => s.id === 'meeting-summary')).toBeUndefined();
  });

  it('skill:getTemplate returns the requested skill', async () => {
    const tpl = await handleSkillGetTemplate({ id: 'planning' });
    expect(tpl.id).toBe('planning');
    expect(tpl.systemPromptKo).toContain('기획 부서');
  });

  it('skill:getTemplate throws on unknown id', async () => {
    await expect(
      handleSkillGetTemplate({ id: 'wat' as never }),
    ).rejects.toThrow(/wat/);
  });
});
```

Run: `npx vitest run src/main/ipc/__tests__/skill-handler.test.ts`
Expected: 3 PASS.

- [ ] **Step 8: 회귀**

Run: `npm run typecheck && npx vitest run src/main/ipc/`
Expected: 0 error / all PASS.

- [ ] **Step 9: Commit**

```bash
git add src/shared/ipc-types.ts src/shared/ipc-schemas.ts \
        src/main/ipc/handlers/skill-handler.ts \
        src/main/ipc/handlers/provider-handler.ts \
        src/main/ipc/router.ts \
        src/preload/index.ts \
        src/main/ipc/__tests__/skill-handler.test.ts
git commit -m "feat(rolestra): R12-S Task 7 — IPC skill.list/getTemplate + provider.updateRoles

- 3 IPC channel + zod schema (RoleId enum / SkillId union)
- preload typedInvoke whitelist 추가
- skill-handler: 카탈로그 list / lookup
- provider-handler.updateRoles: SkillService 검증 + saveProvider upsert
- 3 단위 케이스 PASS"
```

---

## Task 8: 직원 편집 모달 — 캐릭터 / 역할+스킬 탭 분리

**Goal:** 기존 직원 편집 UI 를 두 탭으로 분리. **캐릭터** 탭 = persona 자유 텍스트 (말투 가이드), **역할+스킬** 탭 = roles chip 다중 선택 + 능력별 customize prompt textarea.

**Files:**
- Modify: `src/renderer/features/settings/StaffEditModal.tsx` (또는 동일 역할 파일 — Read 로 위치 확인)
- Create: `src/renderer/features/settings/RolesSkillsTab.tsx`
- Create: `src/renderer/hooks/use-skill-catalog.ts`
- Modify: `src/renderer/i18n/locales/ko/settings.json`
- Modify: `src/renderer/i18n/locales/en/settings.json`

**Acceptance Criteria:**
- [ ] Radix Tabs 2개 — `character` / `roles-skills`
- [ ] **캐릭터** 탭: persona textarea + 안내 "캐릭터 / 말투만 작성하세요. 능력은 옆 탭에서 선택합니다."
- [ ] **역할+스킬** 탭: 9 RoleId chip 다중 선택 + 선택된 각 role 의 prompt customize textarea (placeholder = 카탈로그 default)
- [ ] 저장 시 `provider:updateRoles` IPC 호출 + 기존 `provider:update` 와 분리 (persona 변경 시만 update, roles 변경 시만 updateRoles — 또는 둘 다 한 번에 호출하는 wrapper)
- [ ] 모달 첫 열림 시 카탈로그 fetch (`skill:list`) — `use-skill-catalog` hook 에 zustand cache + 1회만 fetch
- [ ] 모든 한국어 / 영어 라벨이 t() 경유 (eslint-plugin-i18next 통과)
- [ ] 모달 진입 → 캐릭터만 수정 → 저장 → 다시 열기 → 캐릭터 변경 반영 확인 (manual)
- [ ] 모달 진입 → 역할 chip 추가 → 저장 → 다시 열기 → chip 활성 유지 확인 (manual)

**Verify:** `npm run lint && npm run typecheck` → 0 error / 0 i18next warning + manual smoke

**Steps:**

- [ ] **Step 1: i18n 키 추가**

Edit `src/renderer/i18n/locales/ko/settings.json` — 다음 키 추가 (네임스페이스 끝):

```json
{
  "staffEdit": {
    "tab": {
      "character": "캐릭터",
      "rolesSkills": "역할 + 스킬"
    },
    "characterTab": {
      "personaLabel": "캐릭터 / 말투",
      "personaPlaceholder": "예: 신중한 PM Sarah. 결정 전에 위험을 먼저 짚는 편.",
      "personaHint": "캐릭터 / 말투만 작성하세요. 능력은 옆 탭에서 선택합니다."
    },
    "rolesSkillsTab": {
      "title": "능력 선택 (다중 가능)",
      "subtitle": "선택한 능력의 부서에 이 직원이 들어갈 수 있습니다.",
      "customizeTitle": "스킬 customize",
      "customizePlaceholder": "비워두면 기본 시스템 프롬프트를 사용합니다.",
      "validationError": "알 수 없는 능력: {{role}}"
    }
  }
}
```

en 도 동일 구조로 (Edit 시 영어로 작성).

- [ ] **Step 2: use-skill-catalog hook**

Create `src/renderer/hooks/use-skill-catalog.ts`:

```typescript
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import type { SkillTemplate } from '../../shared/role-types';
import { typedInvoke } from '../lib/typed-invoke';

interface SkillCatalogStore {
  list: SkillTemplate[] | null;
  loading: boolean;
  error: string | null;
  fetch: () => Promise<void>;
}

const useStore = create<SkillCatalogStore>((set, get) => ({
  list: null,
  loading: false,
  error: null,
  fetch: async () => {
    if (get().list !== null || get().loading) return;
    set({ loading: true });
    try {
      const list = await typedInvoke('skill:list', undefined);
      set({ list, loading: false });
    } catch (err) {
      set({ error: (err as Error).message, loading: false });
    }
  },
}));

export function useSkillCatalog() {
  const { list, loading, error, fetch } = useStore();
  useEffect(() => {
    fetch();
  }, [fetch]);
  return { catalog: list ?? [], loading, error };
}
```

- [ ] **Step 3: RolesSkillsTab 컴포넌트**

Create `src/renderer/features/settings/RolesSkillsTab.tsx`:

```typescript
import { useTranslation } from 'react-i18next';
import { useSkillCatalog } from '../../hooks/use-skill-catalog';
import type { RoleId } from '../../../shared/role-types';

interface Props {
  roles: RoleId[];
  skillOverrides: Record<RoleId, string> | null;
  onChange: (roles: RoleId[], overrides: Record<RoleId, string> | null) => void;
}

export function RolesSkillsTab({ roles, skillOverrides, onChange }: Props) {
  const { t } = useTranslation('settings');
  const { catalog } = useSkillCatalog();

  const toggleRole = (roleId: RoleId) => {
    const next = roles.includes(roleId)
      ? roles.filter((r) => r !== roleId)
      : [...roles, roleId];
    onChange(next, skillOverrides);
  };

  const updateOverride = (roleId: RoleId, value: string) => {
    const next = { ...(skillOverrides ?? {}) };
    if (value.trim().length === 0) {
      delete next[roleId];
    } else {
      next[roleId] = value;
    }
    onChange(roles, Object.keys(next).length === 0 ? null : (next as Record<RoleId, string>));
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold">{t('staffEdit.rolesSkillsTab.title')}</h3>
        <p className="text-sm text-muted-foreground">
          {t('staffEdit.rolesSkillsTab.subtitle')}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {catalog.map((tpl) => (
            <button
              key={tpl.id}
              type="button"
              onClick={() => toggleRole(tpl.id as RoleId)}
              className={`px-3 py-1 rounded-full text-sm border ${
                roles.includes(tpl.id as RoleId)
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-background'
              }`}
              data-testid={`role-chip-${tpl.id}`}
            >
              {tpl.label.ko}
            </button>
          ))}
        </div>
      </div>

      {roles.length > 0 && (
        <div>
          <h3 className="font-semibold">{t('staffEdit.rolesSkillsTab.customizeTitle')}</h3>
          {roles.map((roleId) => {
            const tpl = catalog.find((t) => t.id === roleId);
            if (!tpl) return null;
            return (
              <div key={roleId} className="mt-2">
                <label className="text-sm font-medium">{tpl.label.ko}</label>
                <textarea
                  className="w-full mt-1 p-2 border rounded"
                  rows={4}
                  placeholder={tpl.systemPromptKo}
                  value={skillOverrides?.[roleId] ?? ''}
                  onChange={(e) => updateOverride(roleId, e.target.value)}
                  data-testid={`override-textarea-${roleId}`}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: StaffEditModal 분리**

Edit 기존 모달 파일 — Radix Tabs 로 감싸고 두 탭으로 분리. 저장 핸들러:

```typescript
const handleSave = async () => {
  // 두 IPC 호출 — 기존 update (persona / config 등) + 신규 updateRoles
  if (personaChanged || configChanged) {
    await typedInvoke('provider:update', { /* ... */ });
  }
  if (rolesChanged || overridesChanged) {
    await typedInvoke('provider:updateRoles', {
      providerId,
      roles,
      skill_overrides: skillOverrides,
    });
  }
  onSaved();
};
```

(정확한 모달 파일 경로는 Read / Glob 으로 확인 후 — `find src/renderer -name "*Edit*Modal*" -o -name "*Provider*Form*"`)

- [ ] **Step 5: lint + typecheck**

Run: `npm run lint -- src/renderer/features/settings/ src/renderer/hooks/use-skill-catalog.ts src/renderer/i18n/`
Expected: 0 error / 0 warning (i18next 키 누락 / 하드코딩 문자열 없음).

Run: `npm run typecheck`
Expected: 0 error.

- [ ] **Step 6: Manual smoke (dev mode)**

Run: `pnpm dev`
- 설정 → 직원 → 임의 직원 편집
- "캐릭터" 탭 — persona 입력 → 저장 → 재오픈 시 유지
- "역할 + 스킬" 탭 — chip 3~4 개 선택 → 저장 → 재오픈 시 유지
- chip 선택된 role 의 customize textarea 가 placeholder 에 카탈로그 default 노출
- customize 저장 → 재오픈 시 유지

- [ ] **Step 7: Commit**

```bash
git add src/renderer/features/settings/StaffEditModal.tsx \
        src/renderer/features/settings/RolesSkillsTab.tsx \
        src/renderer/hooks/use-skill-catalog.ts \
        src/renderer/i18n/locales/ko/settings.json \
        src/renderer/i18n/locales/en/settings.json
git commit -m "feat(rolestra): R12-S Task 8 — 직원 편집 모달 캐릭터/역할+스킬 탭 분리

- Radix Tabs 2개 (character / roles-skills)
- RolesSkillsTab: 9 RoleId chip 다중 선택 + role 별 prompt customize textarea
- use-skill-catalog hook: skill:list IPC 1회 fetch + zustand cache
- 저장 시 provider:update + provider:updateRoles 분리 호출
- i18n ko/en 키 추가 (eslint-plugin-i18next 통과)"
```

---

## Task 9: 회의록 정리 모델 settings + 자동 선택 로직

**Goal:** `summaryModelProviderId` 를 settings 에 추가. 디폴트 자동 선택 로직 (Claude API + Haiku → Gemini API + Flash → 기타 summarize-capable api/cli → Ollama). 사용자 명시 선택 시 자동 무시.

**Files:**
- Modify: `src/main/config/settings-store.ts` (`summaryModelProviderId: string | null` 필드)
- Create: `src/main/llm/summary-model-resolver.ts` (자동 선택 로직)
- Create: `src/main/llm/__tests__/summary-model-resolver.test.ts`
- Modify: `src/shared/ipc-types.ts` + `src/shared/ipc-schemas.ts` (settings IPC 확장)
- Modify: `src/main/ipc/handlers/settings-handler.ts`

**Acceptance Criteria:**
- [ ] settings 에 `summaryModelProviderId: string | null` 필드 (default null = 자동)
- [ ] `resolveSummaryProvider(settings, registry)` 함수: 사용자 명시 → registry 조회. null 이면 자동 선택 4단계
- [ ] 4단계: (1) `kind='api'` + Anthropic + Haiku 모델 (2) `kind='api'` + Gemini + Flash (3) `summarize` capability 있는 다른 api/cli (4) `kind='local'` Ollama
- [ ] 모두 없으면 `null` 반환 (calling code 가 skip)
- [ ] 단위 테스트 ≥ 6 케이스 커버 (각 단계 + 사용자 명시 우선 + 모두 없음)
- [ ] IPC `settings:setSummaryModel` (input: `{ providerId: string | null }`) 추가

**Verify:** `npx vitest run src/main/llm/__tests__/summary-model-resolver.test.ts -v` → PASS

**Steps:**

- [ ] **Step 1: 실패 테스트 작성**

Create `src/main/llm/__tests__/summary-model-resolver.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { resolveSummaryProvider } from '../summary-model-resolver';
import type { ProviderInfo } from '../../../shared/provider-types';

function info(over: Partial<ProviderInfo>): ProviderInfo {
  return {
    id: 'x', kind: 'api', displayName: 'X', model: 'm', status: 'ready',
    capabilities: ['streaming'], persona: '',
    roles: [], skill_overrides: null,
    ...over,
  } as ProviderInfo;
}

describe('resolveSummaryProvider', () => {
  it('returns user-specified provider when settings has explicit id', () => {
    const all = [info({ id: 'manual', model: 'sonnet' })];
    const got = resolveSummaryProvider({ summaryModelProviderId: 'manual' }, all);
    expect(got?.id).toBe('manual');
  });

  it('returns null when explicit id missing from registry', () => {
    const all = [info({ id: 'a' })];
    const got = resolveSummaryProvider({ summaryModelProviderId: 'gone' }, all);
    expect(got).toBeNull();
  });

  it('auto-selects Claude Haiku when present', () => {
    const all = [
      info({ id: 'gemini', kind: 'api', displayName: 'Gemini API', model: 'gemini-2.5-flash', capabilities: ['summarize'] }),
      info({ id: 'haiku', kind: 'api', displayName: 'Anthropic API', model: 'claude-haiku-4-5', capabilities: ['summarize'] }),
    ];
    const got = resolveSummaryProvider({ summaryModelProviderId: null }, all);
    expect(got?.id).toBe('haiku');
  });

  it('auto-selects Gemini Flash when no Haiku', () => {
    const all = [
      info({ id: 'g', kind: 'api', displayName: 'Gemini API', model: 'gemini-2.5-flash', capabilities: ['summarize'] }),
    ];
    const got = resolveSummaryProvider({ summaryModelProviderId: null }, all);
    expect(got?.id).toBe('g');
  });

  it('auto-selects other summarize-capable api/cli when no Haiku/Flash', () => {
    const all = [
      info({ id: 'codex', kind: 'cli', model: 'gpt-5.4', capabilities: ['summarize'] }),
    ];
    const got = resolveSummaryProvider({ summaryModelProviderId: null }, all);
    expect(got?.id).toBe('codex');
  });

  it('falls back to Ollama when no api/cli available', () => {
    const all = [
      info({ id: 'oll', kind: 'local', model: 'qwen2.5:7b', capabilities: ['summarize'] }),
    ];
    const got = resolveSummaryProvider({ summaryModelProviderId: null }, all);
    expect(got?.id).toBe('oll');
  });

  it('returns null when registry is empty', () => {
    const got = resolveSummaryProvider({ summaryModelProviderId: null }, []);
    expect(got).toBeNull();
  });
});
```

Run: `npx vitest run src/main/llm/__tests__/summary-model-resolver.test.ts`
Expected: FAIL.

- [ ] **Step 2: resolveSummaryProvider 구현**

Create `src/main/llm/summary-model-resolver.ts`:

```typescript
/**
 * Summary Model Resolver — R12-S 회의록 정리 모델 자동 선택.
 *
 * 우선순위:
 *   1. 사용자 명시 (settings.summaryModelProviderId)
 *   2. Anthropic API + Haiku (저렴 + 품질)
 *   3. Gemini API + Flash
 *   4. summarize capability 있는 기타 api/cli
 *   5. Local Ollama (오프라인 fallback)
 *
 * 모두 없으면 null — calling code 가 정리 skip.
 */

import type { ProviderInfo } from '../../shared/provider-types';

export interface SummaryModelSettings {
  /** null = 자동 선택. */
  summaryModelProviderId: string | null;
}

export function resolveSummaryProvider(
  settings: SummaryModelSettings,
  all: ProviderInfo[],
): ProviderInfo | null {
  // 1. 사용자 명시
  if (settings.summaryModelProviderId !== null) {
    return all.find((p) => p.id === settings.summaryModelProviderId) ?? null;
  }

  const ready = all.filter(
    (p) => p.status === 'ready' && p.capabilities.includes('summarize'),
  );

  // 2. Anthropic Haiku
  const haiku = ready.find(
    (p) => p.kind === 'api' && /haiku/i.test(p.model),
  );
  if (haiku) return haiku;

  // 3. Gemini Flash
  const flash = ready.find(
    (p) => p.kind === 'api' && /gemini.*flash|flash.*gemini/i.test(p.model),
  );
  if (flash) return flash;

  // 4. 기타 api/cli
  const otherApi = ready.find((p) => p.kind === 'api' || p.kind === 'cli');
  if (otherApi) return otherApi;

  // 5. Ollama
  const ollama = ready.find((p) => p.kind === 'local');
  if (ollama) return ollama;

  return null;
}
```

Run: `npx vitest run src/main/llm/__tests__/summary-model-resolver.test.ts`
Expected: 7 PASS.

- [ ] **Step 3: settings-store 확장**

Edit `src/main/config/settings-store.ts` — settings type 에 `summaryModelProviderId: string | null` 추가, default = null.

```typescript
export interface RolestraSettings {
  // ... existing
  summaryModelProviderId: string | null;
}

export const DEFAULT_SETTINGS: RolestraSettings = {
  // ... existing
  summaryModelProviderId: null,
};
```

기존 settings JSON load 시 `summaryModelProviderId` 필드가 없으면 `null` 로 채움 (forward compat).

- [ ] **Step 4: IPC `settings:setSummaryModel`**

Edit `src/shared/ipc-types.ts`:

```typescript
'settings:setSummaryModel': {
  input: { providerId: string | null };
  output: void;
};
```

Edit `src/shared/ipc-schemas.ts`:

```typescript
export const SettingsSetSummaryModelInputSchema = z.object({
  providerId: z.string().min(1).nullable(),
});
```

Edit `src/main/ipc/handlers/settings-handler.ts`:

```typescript
export async function handleSetSummaryModel(input: { providerId: string | null }): Promise<void> {
  await settingsStore.update({ summaryModelProviderId: input.providerId });
}
```

router 에 등록.

- [ ] **Step 5: 회귀 + Commit**

```bash
npm run typecheck
npx vitest run src/main/llm/ src/main/config/ src/main/ipc/handlers/
```

```bash
git add src/main/llm/summary-model-resolver.ts \
        src/main/llm/__tests__/summary-model-resolver.test.ts \
        src/main/config/settings-store.ts \
        src/shared/ipc-types.ts src/shared/ipc-schemas.ts \
        src/main/ipc/handlers/settings-handler.ts \
        src/main/ipc/router.ts
git commit -m "feat(rolestra): R12-S Task 9 — 회의록 정리 모델 자동 선택 + settings IPC

- summaryModelProviderId: string | null (default null = 자동)
- resolveSummaryProvider 4단계 (Haiku → Flash → 기타 api/cli → Ollama)
- IPC settings:setSummaryModel + zod schema
- 7 단위 케이스 PASS"
```

---

## Task 10: MeetingSummaryService wire — 자동 선택 로직 사용

**Goal:** 기존 `MeetingSummaryService` 가 첫 ready provider 대신 `resolveSummaryProvider` 결과를 사용. SUMMARY_PERSONA / 한국어 프롬프트는 카탈로그 (`SKILL_CATALOG['meeting-summary']`) 의 systemPromptKo 사용.

**Files:**
- Modify: `src/main/llm/meeting-summary-service.ts`
- Modify: `src/main/llm/__tests__/meeting-summary-service.test.ts`

**Acceptance Criteria:**
- [ ] `MeetingSummaryService.summarize` 가 settings + registry 받아 `resolveSummaryProvider` 호출
- [ ] 결정된 provider 의 `summarize`/`chat` 호출
- [ ] system prompt 가 카탈로그 `meeting-summary` 항목의 systemPromptKo 사용
- [ ] resolver 가 null 이면 기존처럼 `{summary: null, providerId: null}` (silent skip)
- [ ] 사용자가 명시한 provider 가 capability 없으면 throw with provider id (silent fallback 금지)
- [ ] 기존 회귀 테스트 모두 PASS + 신규 "summary uses resolved provider" 케이스 추가

**Verify:** `npx vitest run src/main/llm/__tests__/meeting-summary-service.test.ts -v` → PASS

**Steps:**

- [ ] **Step 1: 신규 테스트 케이스**

Edit `src/main/llm/__tests__/meeting-summary-service.test.ts` — 다음 케이스 추가:

```typescript
it('uses provider resolved by resolveSummaryProvider', async () => {
  // 가짜 registry: Haiku + Flash 모두 ready
  const fakeRegistry = makeRegistry([
    fakeProvider('haiku', 'api', 'claude-haiku-4-5', ['summarize']),
    fakeProvider('flash', 'api', 'gemini-2.5-flash', ['summarize']),
  ]);
  const settings = { summaryModelProviderId: null };

  const svc = new MeetingSummaryService(fakeRegistry, fakeSink, settings);
  const result = await svc.summarize('meeting-1', '회의 내용...');
  expect(result.providerId).toBe('haiku'); // 자동 선택
});

it('uses user-specified provider when set', async () => {
  const fakeRegistry = makeRegistry([
    fakeProvider('haiku', 'api', 'claude-haiku-4-5', ['summarize']),
    fakeProvider('flash', 'api', 'gemini-2.5-flash', ['summarize']),
  ]);
  const settings = { summaryModelProviderId: 'flash' };

  const svc = new MeetingSummaryService(fakeRegistry, fakeSink, settings);
  const result = await svc.summarize('meeting-1', '회의 내용...');
  expect(result.providerId).toBe('flash');
});

it('uses meeting-summary catalog prompt as system prompt', async () => {
  const captured: { messages: Message[] } = { messages: [] };
  const fakeRegistry = makeRegistry([
    fakeProvider('haiku', 'api', 'claude-haiku-4-5', ['summarize'], (msgs) => {
      captured.messages = msgs;
      return { content: '요약 결과' };
    }),
  ]);
  const svc = new MeetingSummaryService(fakeRegistry, fakeSink, { summaryModelProviderId: null });
  await svc.summarize('meeting-1', '회의 내용...');
  // SKILL_CATALOG['meeting-summary'].systemPromptKo 가 prompt 에 포함
  const allText = JSON.stringify(captured.messages);
  expect(allText).toContain('한 단락');
  expect(allText).toContain('메타 코멘트나 머리말 없이');
});

it('throws when user-specified provider lacks summarize capability', async () => {
  const fakeRegistry = makeRegistry([
    fakeProvider('weird', 'api', 'x', ['streaming']), // no summarize
  ]);
  const settings = { summaryModelProviderId: 'weird' };
  const svc = new MeetingSummaryService(fakeRegistry, fakeSink, settings);
  await expect(svc.summarize('meeting-1', 'x')).rejects.toThrow(/weird.*summarize/);
});
```

Run: `npx vitest run src/main/llm/__tests__/meeting-summary-service.test.ts`
Expected: 새 케이스 FAIL.

- [ ] **Step 2: meeting-summary-service.ts 변경**

Edit `src/main/llm/meeting-summary-service.ts`:

```typescript
import { resolveSummaryProvider, type SummaryModelSettings } from './summary-model-resolver';
import { SKILL_CATALOG } from '../../shared/skill-catalog';

export class MeetingSummaryService {
  constructor(
    private readonly registry: ProviderRegistryView,
    private readonly sink: LlmCostAuditSink,
    private readonly settings: SummaryModelSettings, // 신규 인자
  ) {}

  async summarize(meetingId: string, content: string): Promise<SummaryResult> {
    const all = this.registry.listAll();
    const target = resolveSummaryProvider(this.settings, all);
    if (target === null) {
      return { summary: null, providerId: null };
    }

    // 사용자 명시인데 capability 없는 경우 throw
    if (
      this.settings.summaryModelProviderId !== null &&
      !target.capabilities.includes('summarize')
    ) {
      throw new Error(
        `[MeetingSummaryService] user-specified provider '${target.id}' ` +
          `lacks 'summarize' capability. Pick a different model in settings.`,
      );
    }

    const provider = this.registry.get(target.id);
    if (!provider) {
      return { summary: null, providerId: null };
    }

    const tpl = SKILL_CATALOG['meeting-summary'];
    const messages: Message[] = [
      { role: 'system', content: tpl.systemPromptKo },
      { role: 'user', content: `---\n${content}\n---` },
    ];

    // ... 기존 chat 호출 / timeout / cost append 그대로
  }
}
```

기존 호출지 (`MeetingOrchestrator` 등) 가 `settings` 인자 추가하도록 wire — `getSettings()` 호출 결과 전달.

- [ ] **Step 3: 회귀**

Run: `npx vitest run src/main/llm/`
Expected: 모든 케이스 PASS.

Run: `npm run typecheck`
Expected: 0 error.

- [ ] **Step 4: Commit**

```bash
git add src/main/llm/meeting-summary-service.ts \
        src/main/llm/__tests__/meeting-summary-service.test.ts \
        $(git diff --name-only | grep -E "(orchestrator|meeting)")
git commit -m "feat(rolestra): R12-S Task 10 — MeetingSummaryService 자동 선택 로직 wire

- resolveSummaryProvider 결과 사용 (settings + registry)
- system prompt = SKILL_CATALOG['meeting-summary'].systemPromptKo
- 사용자 명시 + capability 없음 = throw (silent fallback 금지)
- resolver null = 기존처럼 silent skip
- 4 신규 케이스 PASS"
```

---

## Task 11: 회의록 정리 모델 설정 UI 카드

**Goal:** 설정 화면에 "회의록 정리 담당 모델" 카드 추가. 현재 자동 선택 결과 + 사용자 명시 옵션 (provider 드롭다운). "자동" / "특정 provider 지정" 라디오.

**Files:**
- Create: `src/renderer/features/settings/SummaryModelCard.tsx`
- Modify: `src/renderer/features/settings/SettingsPage.tsx` (또는 동일 역할 — Read 로 확인)
- Modify: `src/renderer/i18n/locales/ko/settings.json`
- Modify: `src/renderer/i18n/locales/en/settings.json`
- Create: `src/renderer/hooks/use-summary-model.ts`

**Acceptance Criteria:**
- [ ] 카드 제목 "회의록 정리 담당"
- [ ] 라디오 2개: "자동 (추천)" / "특정 모델 지정"
- [ ] "자동" 선택 시 현재 resolver 가 선택할 provider 라벨 노출 (예: "현재: Claude Haiku")
- [ ] "특정 모델" 선택 시 dropdown — `summarize` capability 있는 provider 만 표시
- [ ] 저장 시 `settings:setSummaryModel` IPC 호출
- [ ] 모든 라벨 t() 경유

**Verify:** `npm run lint && npm run typecheck` → 0 error + manual smoke

**Steps:**

- [ ] **Step 1: i18n 키**

Edit `src/renderer/i18n/locales/ko/settings.json`:

```json
"summaryModel": {
  "cardTitle": "회의록 정리 담당",
  "cardSubtitle": "회의 종료 시 회의록을 자동 정리하는 모델입니다. 회의에 참여하는 직원과 별도입니다.",
  "modeAuto": "자동 (추천)",
  "modeManual": "특정 모델 지정",
  "currentLabel": "현재: {{name}}",
  "currentNone": "사용 가능한 모델이 없습니다 — 회의록은 결정문만 저장됩니다.",
  "selectPlaceholder": "모델 선택"
}
```

en 도 동일.

- [ ] **Step 2: use-summary-model hook**

Create `src/renderer/hooks/use-summary-model.ts`:

```typescript
import { useEffect, useState, useCallback } from 'react';
import { typedInvoke } from '../lib/typed-invoke';

export function useSummaryModel() {
  const [providerId, setProviderId] = useState<string | null>(null);
  const [resolvedName, setResolvedName] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const settings = await typedInvoke('settings:get', undefined);
      setProviderId(settings.summaryModelProviderId);
      // 현재 resolved provider 조회 — main 에 'settings:resolveSummaryModel' 같은 추가 채널 필요
      const resolved = await typedInvoke('settings:getResolvedSummaryModel', undefined);
      setResolvedName(resolved?.displayName ?? null);
    })();
  }, []);

  const update = useCallback(async (id: string | null) => {
    await typedInvoke('settings:setSummaryModel', { providerId: id });
    setProviderId(id);
    const resolved = await typedInvoke('settings:getResolvedSummaryModel', undefined);
    setResolvedName(resolved?.displayName ?? null);
  }, []);

  return { providerId, resolvedName, update };
}
```

(`settings:getResolvedSummaryModel` IPC 도 Task 9 의 router 에 추가 — handler 가 resolveSummaryProvider 호출 결과 ProviderInfo 또는 null 반환.)

- [ ] **Step 3: SummaryModelCard 컴포넌트**

Create `src/renderer/features/settings/SummaryModelCard.tsx`:

```typescript
import { useTranslation } from 'react-i18next';
import { useSummaryModel } from '../../hooks/use-summary-model';
import { useProviders } from '../../hooks/use-providers';

export function SummaryModelCard() {
  const { t } = useTranslation('settings');
  const { providerId, resolvedName, update } = useSummaryModel();
  const { providers } = useProviders();
  const summarizeCapable = providers.filter((p) => p.capabilities.includes('summarize'));

  const isAuto = providerId === null;

  return (
    <section className="border rounded p-4">
      <h2 className="font-semibold">{t('summaryModel.cardTitle')}</h2>
      <p className="text-sm text-muted-foreground">{t('summaryModel.cardSubtitle')}</p>

      <div className="mt-3 space-y-2">
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="summary-mode"
            checked={isAuto}
            onChange={() => update(null)}
          />
          <span>{t('summaryModel.modeAuto')}</span>
        </label>
        {isAuto && (
          <p className="text-sm pl-6">
            {resolvedName
              ? t('summaryModel.currentLabel', { name: resolvedName })
              : t('summaryModel.currentNone')}
          </p>
        )}

        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="summary-mode"
            checked={!isAuto}
            onChange={() => update(summarizeCapable[0]?.id ?? null)}
          />
          <span>{t('summaryModel.modeManual')}</span>
        </label>
        {!isAuto && (
          <select
            className="ml-6 border rounded p-1"
            value={providerId ?? ''}
            onChange={(e) => update(e.target.value)}
            data-testid="summary-model-select"
          >
            {summarizeCapable.map((p) => (
              <option key={p.id} value={p.id}>
                {p.displayName} ({p.model})
              </option>
            ))}
          </select>
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: SettingsPage 에 카드 추가**

기존 설정 페이지 (Read 로 위치 확인) 에 `<SummaryModelCard />` 한 줄 추가.

- [ ] **Step 5: lint + typecheck + manual**

Run: `npm run lint && npm run typecheck`
Expected: 0 error.

Manual: `pnpm dev` → 설정 → "회의록 정리 담당" 카드 확인 → 자동 / 특정 라디오 토글 → 저장 → 새로고침 후 유지.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/features/settings/SummaryModelCard.tsx \
        src/renderer/features/settings/SettingsPage.tsx \
        src/renderer/hooks/use-summary-model.ts \
        src/renderer/i18n/locales/ko/settings.json \
        src/renderer/i18n/locales/en/settings.json \
        src/main/ipc/handlers/settings-handler.ts \
        src/main/ipc/router.ts \
        src/shared/ipc-types.ts
git commit -m "feat(rolestra): R12-S Task 11 — 회의록 정리 모델 설정 카드 + IPC

- SummaryModelCard: 자동 / 특정 모델 라디오 + 드롭다운
- 자동 선택 시 현재 resolver 결과 라벨 노출
- summarize capability 있는 provider 만 노출
- IPC settings:getResolvedSummaryModel 추가
- i18n ko/en 카드 키 추가"
```

---

## Task 12: ADR + 구현-현황 + 메모리 + Closeout

**Goal:** R12-S 결정사항 ADR 작성, 구현-현황.md 에 R12-S task 행 추가, 메모리 갱신 (rolestra-phase-status.md / rolestra-r12-channel-roles-design.md), 마지막 회귀 + push.

**Files:**
- Create: `docs/decisions/r12-s-persona-skills.md`
- Modify: `docs/구현-현황.md`
- Modify: `/home/taniar/.claude/projects/-mnt-d-Taniar-Documents-Git-AI-Chat-Arena/memory/rolestra-phase-status.md`
- Modify: `/home/taniar/.claude/projects/-mnt-d-Taniar-Documents-Git-AI-Chat-Arena/memory/rolestra-r12-channel-roles-design.md`
- Create: `/home/taniar/.claude/projects/-mnt-d-Taniar-Documents-Git-AI-Chat-Arena/memory/rolestra-r12-s-completion.md`

**Acceptance Criteria:**
- [ ] ADR 가 결정 5건 정리: (1) 능력 카탈로그 10개 + 직원 9 / 시스템 1 (2) 부서 디폴트 6 + 옵션 2 (3) 디자인 부서 통합 (UI+UX 한 묶음) (4) 회의록 정리 모델 별도 + 자동 선택 4단계 (5) skill_overrides JSON nullable
- [ ] 구현-현황.md 에 R12-S 항목 + Task 1~12 status + commit hash 추가
- [ ] phase-status 메모리 main tip 갱신 + R12-S 종결 표시
- [ ] r12-channel-roles-design 메모리에 "R12-S 완료" 단락 + 다음 phase (R12-C) 진입 가이드 추가
- [ ] r12-s-completion 메모리 신규 — Task 1~12 commit / 변경 파일 / 검증 결과 / 다음 R12-C 진입 가이드
- [ ] 모든 Task commit 이 main 에 land + origin/main 으로 push 완료

**Verify:** `git log --oneline main ^origin/main` → 비어있어야 (push 완료) + `npx vitest run` 전체 PASS + `npm run typecheck` 0 error

**Steps:**

- [ ] **Step 1: ADR 작성**

Create `docs/decisions/r12-s-persona-skills.md`:

```markdown
# ADR — R12-S 페르소나 / 스킬 분리

작성일: 2026-05-XX
상태: 채택

## Context

R11 까지 `providers.persona` 단일 텍스트가 캐릭터 + 능력 + 도구 권한 / 형식 instruction 까지 모두 담당. D-A batch 2 dogfooding 에서 다음 한계:

1. 사용자가 "신중한 PM Sarah" 같이 캐릭터 작성하려는데 그 안에 tool 권한 / 스킬까지 섞여 있음.
2. 한 AI 가 기획·디자인·구현·검토 전부 — 역할 분화 결여.
3. 회의록 정리 시 *어떤* 직원이 정리하느냐에 따라 톤이 바뀜.

R12-S 가 데이터 모델을 분리해서 R12-C / D-B / R12-H 의 기반 마련.

## Decision

### 1. 능력 카탈로그 10개 (직원 9 + 시스템 1)
- 직원: `idea` / `planning` / `design.ui` / `design.ux` / `design.character` / `design.background` / `implement` / `review` / `general`
- 시스템: `meeting-summary` (직원 부여 X)
- agestra plugin (4.13.0) 의 agent system prompt reference, 한국어 + Rolestra 메타포

### 2. 부서 템플릿 8개 (디폴트 6 + 옵션 2)
- 디폴트: 아이디어 / 기획 / 디자인 / 구현 / 검토 / 일반
- 옵션 (사용자 추가): 캐릭터 디자인 / 배경 디자인 — 게임 프로젝트만
- 디자인 부서 = `[design.ui, design.ux]` 통합. UI/UX 의논 잦으니 분리하지 않음.

### 3. providers.roles + skill_overrides 컬럼
- `roles TEXT NOT NULL DEFAULT '[]'` — JSON array
- `skill_overrides TEXT NULL` — JSON object, null = 카탈로그 default
- persona 의미는 "캐릭터 only" 로 *문서 수준* 변경 (데이터 보존)

### 4. 회의록 정리 모델 별도 + 자동 선택 4단계
- settings.summaryModelProviderId: string | null
- 자동 선택 우선순위: Anthropic Haiku → Gemini Flash → 기타 summarize-capable api/cli → Local Ollama
- 사용자 명시 + capability 없음 = throw (silent fallback 금지)

### 5. PromptComposer 합성 경로
- `{persona} + {channelRole 부서명} + {skillTemplate.systemPromptKo} + {권한 요약} + {format}`
- providerRoles ∩ channelRole 검증 — 직원 자격 없는 부서 진입 차단

## Consequences

(+) 캐릭터 일관 / 능력 채널별 갈아입음 — 메타포 명확
(+) 회의록 정리 톤 객관화
(+) R12-C 채널 역할 기반 마련 — 카탈로그 + 합성기 wire 만 남음
(+) 능력 다중 선택 — 한 직원 여러 부서 동시 멤버

(-) 기존 persona 데이터 사용자가 직접 정리해야 (모달 안내)
(-) 카탈로그 prompt 한국어 hardcoded — 영어 사용자는 R11 D9 와 같은 locale 분기 추후 필요 (R12-S 범위 외)

## Related
- spec: `docs/specs/2026-05-01-rolestra-channel-roles-design.md` §3 / §11.5 / §11.7
- plan: `docs/plans/2026-05-01-rolestra-r12-s-persona-skills.md`
- 의존 phase: R12-C (채널 역할) 가 본 ADR 결과 사용
```

- [ ] **Step 2: 구현-현황.md 갱신**

Edit `docs/구현-현황.md` — R11 표 아래 R12-S 표 추가:

```markdown
## R12-S 페르소나 / 스킬 분리 (2026-05-XX 종결)

| Task | 상태 | Commit |
|------|------|--------|
| 0. spec §3 능력 카탈로그 갱신 (5→10) | ✅ | `<hash>` |
| 1. DB Migration 017 | ✅ | `<hash>` |
| 2. Shared Types | ✅ | `<hash>` |
| 3. 스킬 카탈로그 모듈 | ✅ | `<hash>` |
| 4. SkillService + tests | ✅ | `<hash>` |
| 5. ProviderRepository 확장 | ✅ | `<hash>` |
| 6. PromptComposer | ✅ | `<hash>` |
| 7. IPC handlers | ✅ | `<hash>` |
| 8. 직원 편집 모달 탭 분리 | ✅ | `<hash>` |
| 9. 회의록 정리 모델 settings | ✅ | `<hash>` |
| 10. MeetingSummaryService wire | ✅ | `<hash>` |
| 11. 회의록 정리 카드 UI | ✅ | `<hash>` |
| 12. ADR + Closeout | ✅ | `<hash>` |
```

(commit hash 는 git log 보고 채움)

- [ ] **Step 3: 메모리 phase-status 갱신**

Edit `/home/taniar/.claude/projects/-mnt-d-Taniar-Documents-Git-AI-Chat-Arena/memory/rolestra-phase-status.md`:

- "R12-S 페르소나/스킬 분리 종결 (commit `<hash>` ~ `<hash>`)" 단락 추가
- 다음 단계 = R12-C 진입 명시

- [ ] **Step 4: r12-channel-roles-design 메모리 갱신**

Edit `/home/taniar/.claude/projects/-mnt-d-Taniar-Documents-Git-AI-Chat-Arena/memory/rolestra-r12-channel-roles-design.md`:

- 끝에 "## R12-S 종결 (2026-05-XX)" 단락 추가
- 카탈로그 10개 / 부서 8 / 회의록 모델 자동 선택 결과 요약
- 다음 phase R12-C 진입 가이드 (channels.role 컬럼 / 사이드바 collapsible / 일반채널 전역화)

- [ ] **Step 5: r12-s-completion 메모리 신규**

Create `/home/taniar/.claude/projects/-mnt-d-Taniar-Documents-Git-AI-Chat-Arena/memory/rolestra-r12-s-completion.md`:

```markdown
---
name: R12-S 페르소나/스킬 분리 종결 (2026-05-XX)
description: providers.roles + skill_overrides 컬럼 land + 카탈로그 10개 + PromptComposer + 회의록 정리 모델 자동 선택 + 직원 편집 모달 탭 분리. R12-C 진입 준비 완료.
type: project
---

## 종결 commit
- Task 0~12: `<commit hash range>`
- main tip: `<final hash>` (push 완료 / origin/main 동기)

## 변경 요약
- DB: providers ALTER (roles + skill_overrides) — migration 017
- shared/main: role-types / skill-catalog (10) / SkillService / PromptComposer
- IPC: skill:list / skill:getTemplate / provider:updateRoles / settings:setSummaryModel
- renderer: StaffEditModal 탭 분리 / RolesSkillsTab / SummaryModelCard
- llm: MeetingSummaryService 가 resolveSummaryProvider + 카탈로그 prompt 사용

## 검증
- vitest 전체 PASS (신규 단위 ~30 케이스)
- typecheck 0 error / lint 0 warning (i18next 포함)
- manual: 직원 모달 탭 / 능력 chip 다중 선택 / 회의록 정리 카드 라디오

## 다음 phase — R12-C 진입 가이드
- spec: `docs/specs/2026-05-01-rolestra-channel-roles-design.md` §4
- plan 작성 시 다음 결정 항목 사용자 받기:
  1. 사이드바 collapsible 디폴트 (펼침 / 접힘)
  2. 일반 채널 전역화 — system_general migration 전략
  3. 부서 채널 메시지란 disabled / enabled 상태 transition 정의
  4. Designated worker 디폴트 선택 알고리즘 (사용자 선택 / 능력 score)
- DB 다음 마이그레이션 = 018 (channels.role + purpose 컬럼)
```

- [ ] **Step 6: 최종 회귀**

Run: `npm run typecheck && npm run lint && npx vitest run`
Expected: 모두 통과.

Run: `git log --oneline -20`
Expected: Task 0~12 commit 12+ 개 순서대로.

- [ ] **Step 7: Push**

(사용자 확인 후) Run: `git push origin main`
(또는 worktree 사용 시 main merge → push 절차)

- [ ] **Step 8: 마지막 commit (closeout)**

```bash
git add docs/decisions/r12-s-persona-skills.md \
        docs/구현-현황.md \
        /home/taniar/.claude/projects/-mnt-d-Taniar-Documents-Git-AI-Chat-Arena/memory/
git commit -m "docs(rolestra): R12-S 종결 — ADR + 구현현황 + 메모리

- ADR r12-s-persona-skills 작성 (결정 5건)
- 구현-현황.md R12-S 표 (Task 0~12 ✅ + commit hash)
- 메모리 phase-status / r12-channel-roles-design 갱신
- r12-s-completion 메모리 신규 (다음 R12-C 진입 가이드 포함)

R12-S phase 종결. 다음 R12-C 채널 역할."
```

---

## Self-Review Checklist

- [ ] **Spec coverage**: spec §3 데이터 모델 (Task 1, 2, 5), 카탈로그 (Task 0, 3), 합성 경로 (Task 6), §11.5 회의록 정리 (Task 9, 10, 11), §11.7 추가 task (Task 9, 11) 모두 커버.
- [ ] **No placeholders**: 모든 Step 에 actual code / actual command. "TBD" / "나중에" 없음.
- [ ] **Type consistency**: `RoleId` / `SkillId` / `ToolGrant` / `SkillTemplate` / `ProviderInfo` 시그니처 Task 2 ~ Task 11 일관.
- [ ] **Files exact**: 모든 task 의 Files 섹션이 절대 경로.
- [ ] **TDD**: Task 4 / 6 / 9 / 10 이 red-green commit cycle.
- [ ] **agestra reference**: Task 3 의 systemPromptKo 들이 agestra-ideator / designer / implementer / reviewer 의 description 의미 살림 (한국어 + Rolestra 메타포).

## 참고
- agestra plugin: `/home/taniar/.claude/plugins/cache/agestra/agestra/4.13.0/agents/`
- 기존 R11 plan format: `docs/plans/2026-04-26-rolestra-phase-r11.md`
- 기존 마이그레이션 패턴: `src/main/database/migrations/016-meeting-paused-and-kind.ts`
