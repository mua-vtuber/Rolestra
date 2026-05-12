# ADR — R12-X PathGuard 봉인 chain 정식 wire-up + 회귀 가드 3종

작성일: 2026-05-12
상태: 채택 제안 (사용자 결재 대기 — Q1~Q3 ADR 추가 결재 포인트)
선행 ADR: r12-w-member-file-permission (도구 권한 + T10.5 hotfix), cross-cutting C3 (ExecutionService 경계) / C6 (path-guard ArenaRoot 봉인) / C7 (i18n)
선행 audit: `docs/R12_c2_2R/reports/audit/2026-05-12-r12-w-pathguard-wire-audit.md`

> **본 ADR 의 위치:** R12-W T10.5 hotfix block (G1+G2+G5) 가 *사용자 가시 critical* 을 해결한 후, *구조적 봉인 layer* 를 정식으로 복원하는 phase. audit 보고서의 옵션 C 변형 추천에서 분리된 정식 ADR.

---

## 0. 한 줄 결론

spec §7.6 의 PathGuard 봉인은 R2 Task 6 에서 코드 land 후 production runtime 에서 한 번도 호출되지 않은 dead-infrastructure. R12-X 는 (1) `PermissionService` 인스턴스화 + 호출 wire (G3), (2) `ExecutionService` singleton boot wire + `ensureAccess` required (G4+G7), (3) dead method 정리 (G6), 그리고 **재발 방지를 위한 회귀 가드 3종** — `AbsolutePath` brand type / runtime invariant / integration test — 을 모두 land 한다.

---

## 1. Context — R12-W T10.5 land 후 잔여 격차

R12-W T10.5 hotfix (G1+G2+G5) land 후 audit 보고서의 4 격차가 *여전히 미해결*:

| ID | 격차 | T10.5 후 상태 | R12-X 책임 |
|----|------|---------------|------------|
| **G3** | `PermissionService.resolveForCli` / `validateAccess` 호출자 0 | T10.5 가 `resolveProjectPaths` 직접 호출로 *우회* — 임시 | **정식 fix** — PermissionService 인스턴스화 + CLI spawn / Main I/O 모든 경로에서 호출 |
| **G4** | `setExecutionWorkspaceRoot` 호출자 0 → singleton 미초기화, apply path throw | 미변경 (T10.5 범위 외) | **fix** — boot 시 wire |
| **G6** | `MeetingSession.setProjectPath` 호출자 0 dead method | T10.5 가 ssmCtx 로 충분히 해결 — dead method 그대로 남음 | **삭제** |
| **G7** | `ExecutionService.ensureAccess` optional + silent skip | 미변경 | **fix** — required + 미주입 throw |

추가로 audit 보고서 §4 의 **root cause 패턴** ("cross-cutting wire 가 누구의 phase 책임도 아닌 사각") 재발 방지가 본 ADR 의 *진짜 핵심*. R2~R12 의 각 phase 가 자기 도메인만 land 하면서 cross-cutting wire 가 깨진 패턴이 *5 phase 누적* — 같은 종류의 격차가 R13+ 에 또 생기지 않으려면 *회귀 가드* 필수.

---

## 2. 결정 (확정 제안)

### D1. `PermissionService` 정식 wire (G3)

**확정:** PermissionService 인스턴스화 + 모든 CLI spawn / Main-routed I/O 가 경유.

**구조:**
```
[Main boot]
  ↓
  permissionService = new PermissionService(arenaRoot, projectRepo)
       ↓ 단일 인스턴스, composition root 에서 DI
       ↓
[CLI spawn 직전 — meeting-turn-executor 또는 cli-provider]
  const { cwd, consensusPath, project } = permissionService.resolveForCli(projectId);
  → external 프로젝트 junction TOCTOU 재검증 자동 발동 (CA-3)
       ↓
[Main-routed I/O — workspace-handler, meeting-minutes-service, snapshot/* 등]
  permissionService.validateAccess(targetPath, activeProjectId);
  → isPathWithin 경계 + 거부 시 PermissionBoundaryError throw
```

**T10.5 의 임시 우회 (resolveProjectPaths 직접 호출) 를 PermissionService.resolveForCli 로 *대체*:**
- ssmCtx 생성 4 곳에서 `resolveProjectPaths(...).cwdPath` → `permissionService.resolveForCli(projectId).cwd` 로 일괄 교체.
- 효과: external 프로젝트 junction TOCTOU 재검증이 *매 회의 시작* 자동 발동. T10.5 의 한계 (junction swap 공격 가능성) close.

**호출 대상 audit (R12-X 가 책임):**
- `meeting-minutes-service.ts` 의 PathGuard 봉인 (consensusPath 안 검증) — 현재 *내부 helper* 로 직접 isPathWithin? — grep 후 PermissionService 경유로 통일
- `snapshot/playwright-snapshot.ts` 의 PathGuard 봉인
- `workspace-handler.ts` 의 init / status — PermissionService 경유 확인
- ExecutionService.ensureAccess 콜백 (G7 fix 와 연동) — `permissionService.validateAccess` 호출

**리스크:**
- TOCTOU 재검증 발동이 *매 회의 시작* 마다 한 번 + *매 CLI 명령* 마다 한 번 → realpathSync 비용. spec §7.6.4 의 "Performance note: not a cheap/cached guard" 가 자체 인정 — R12-X 시점에 *캐싱 없음* 으로 진행, 성능 문제가 사용자 가시 마찰로 surface 하면 별도 follow-up.

---

### D2. `ExecutionService` singleton boot wire (G4) + `ensureAccess` required (G7)

**확정:** `setExecutionWorkspaceRoot` 를 main boot 시 호출. `ensureAccess` 콜백을 *optional 에서 required* 로 변경, 미주입 시 명시 throw.

**구조 변경:**
```ts
// execution-service.ts — interface 변경
interface ExecutionServiceOptions {
  workspaceRoot: string;
  ensureAccess: (                  // ← optional 제거, required
    aiId: string,
    action: 'read' | 'write' | 'execute',
    targetPath: string,
    conversationId?: string,
  ) => Promise<boolean>;
  circuitBreaker?: CircuitBreaker;
}

// constructor 안에서
if (typeof options.ensureAccess !== 'function') {
  throw new Error(
    '[ExecutionService] ensureAccess callback is required. ' +
    'Wire to PermissionService.validateAccess at composition root.'
  );
}
```

**Wire 위치:**
- `src/main/index.ts` — boot 시점에 `setExecutionWorkspaceRoot(arenaRoot.getPath(), ensureAccess, circuitBreaker)` 호출. ensureAccess closure = `async (aiId, action, target) => { permissionService.validateAccess(target, getActiveProjectId()); return true; }` (throw 면 false, 통과면 true 반환).
- `detailPreviewExecutionService` (line 361-363) — 동일하게 ensureAccess 주입.

**ExecutionService.ensureAccess 호출 패턴 변경:**
```ts
// 변경 전 (line 94-95)
if (this.ensureAccess) {
  const allowed = await this.ensureAccess(aiId, 'read', normalizedPath);
  if (!allowed) throw new Error(...);
}

// 변경 후 — required 라 if 분기 자체 제거
const allowed = await this.ensureAccess(aiId, 'read', normalizedPath);
if (!allowed) throw new ExecutionAccessDeniedError(...);
```

silent skip 패턴 완전 제거 — CLAUDE.md "사일런트 폴백 금지" 정신 정합.

**리스크:**
- `setExecutionWorkspaceRoot` 호출자 0 인 시점에 *사용자가 apply path 를 호출하면* throw — *현재도 throw* 이므로 surface 무변경. 단 ensureAccess required 변경은 *기존 ExecutionService 호출처* 가 ensureAccess 없이 인스턴스화하면 throw — `detailPreviewExecutionService` 가 영향. 한 commit 안에 둘 다 처리.

---

### D3. `MeetingSession.setProjectPath` dead method 삭제 (G6)

**확정:** T10.5 가 ssmCtx 로 충분히 cwd 동기화 → setProjectPath dead method 제거.

**영향 파일:**
- `src/main/meetings/engine/meeting-session.ts:290-292` — 메서드 + JSDoc 삭제
- 호출자 grep — production 0건 (T10.5 land 후 확인). test 호출자 있으면 동시 정리.

---

### D4. 회귀 가드 1 — `AbsolutePath` brand type

**확정:** `string` 대신 `string & { __brand: 'AbsolutePath' }` brand type 도입. 컴파일 타임 가드.

**구조:**
```ts
// src/shared/absolute-path.ts (new)
export type AbsolutePath = string & { readonly __brand: 'AbsolutePath' };

/**
 * AbsolutePath 검증 + brand 부여. 빈 문자열 / '.' / 상대 경로는 throw.
 * silent fallback 금지 — CLAUDE.md 절대 규칙.
 */
export function asAbsolutePath(p: string, context: string): AbsolutePath {
  if (typeof p !== 'string' || p.length === 0) {
    throw new Error(`[absolute-path] empty path in ${context}`);
  }
  if (p === '.' || p === './') {
    throw new Error(`[absolute-path] relative '.' rejected in ${context}`);
  }
  if (!path.isAbsolute(p)) {
    throw new Error(`[absolute-path] non-absolute path '${p}' in ${context}`);
  }
  return p as AbsolutePath;
}

/**
 * 이미 검증된 경로를 raw string 으로 받아 unsafe cast. 마이그레이션 중
 * 호환성 위해서만 — 신규 코드는 `asAbsolutePath` 만 사용. 본 헬퍼 호출 위치는
 * grep 으로 추적 가능하게 명시적 이름 유지.
 */
export function unsafeMarkAbsolute(p: string): AbsolutePath {
  return p as AbsolutePath;
}
```

**도입 site:**
- `SsmContext.projectPath: string` → `AbsolutePath`
- `Channel.cwdPath: string | null` → `AbsolutePath | null` (DM/system 채널은 null)
- `ProjectPaths.cwdPath: string` → `AbsolutePath`
- `ProjectPaths.rootPath: string` → `AbsolutePath`
- `ProjectPaths.metaPath: string` → `AbsolutePath`
- `ProjectPaths.consensusPath: string` → `AbsolutePath`
- `ArenaRootService.getPath(): string` → `AbsolutePath`
- `CliProvider._projectPath: string` → `AbsolutePath`
- `PermissionService.resolveForCli(projectId).cwd: string` → `AbsolutePath`
- `PermissionService.validateAccess(targetPath: string, ...)` → 첫 인자 `AbsolutePath`
- `ExecutionService` 의 path 인자 — `normalizedPath` 등이 brand 으로 type

**효과:**
- 컴파일 타임에 `projectPath: ''` 같은 raw 문자열 대입 차단.
- `ssmCtx.projectPath = someString` 같은 패턴이 TypeScript error.
- `asAbsolutePath(...)` 호출이 *path 의 source* 로 명확화 — code review 시 *어디서 검증되는지* 즉시 보임.

**touch 파일 수 추정 (R12-X plan T 단위 분해 대상):**
- `src/shared/` 의 path 가진 타입 ~6 (SsmContext, Channel, ProjectPaths, WorkspaceInfo, ConsensusFolderInfo, etc.)
- `src/main/` 의 service / handler 의 path 사용처 ~30~40 (PermissionService, ArenaRootService, CliProvider, ExecutionService, channel-handler, workspace-handler, meeting-minutes-service, snapshot/*, etc.)
- 점진적 도입 — *type 변경 → 호출처 컴파일 fail → asAbsolutePath/unsafeMarkAbsolute 로 정정* 의 일괄 PR 1건.

---

### D5. 회귀 가드 2 — Runtime invariant

**확정:** SsmContext 생성자 / factory 에서 projectPath 검증. Constructor 시점에 silent fallback 차단.

**구조:**
```ts
// shared/ssm-context-types.ts — createDefaultSsmContext 갱신
export function createSsmContext(input: {
  meetingId: string;
  channelId: string;
  projectId: string;
  projectPath: AbsolutePath;          // ← brand
  permissionMode: PermissionMode;
  autonomyMode: AutonomyMode;
}): SsmContext {
  // runtime 도 한 번 더 — brand 가 unsafeMarkAbsolute 로 우회된 경우 대비
  if (!input.projectPath || input.projectPath === ('' as string)) {
    throw new Error('[SsmContext] projectPath must not be empty');
  }
  if (input.projectPath === ('.' as string)) {
    throw new Error('[SsmContext] projectPath must not be ".".');
  }
  if (!input.projectId || input.projectId === '') {
    throw new Error('[SsmContext] projectId must not be empty');
  }
  return { ...input };
}

// 기존 createDefaultSsmContext 는 test-only 로 격리 + projectPath 인자 required
export function createDefaultSsmContextForTest(overrides: {
  projectPath: AbsolutePath;          // ← test 도 required
  // 나머지 optional
} & Partial<SsmContext>): SsmContext {
  // 동일 검증
}
```

**ExecutionService constructor 도 동일:**
- `workspaceRoot: AbsolutePath` brand + runtime 빈 문자열 throw.
- `ensureAccess: required` (G7 fix 일부).

**CliProvider.setProjectPath 도 동일:**
- 인자 type `AbsolutePath` + runtime double-check.

**효과:**
- type 가드를 *brand cast 로 우회* 한 경우에도 runtime 시점에 jail. R12-W T10.5 의 G2 fix 직후 *4 곳 모두 통과* 가 boot 시 단언됨.

---

### D6. 회귀 가드 3 — Integration test

**확정:** "channel:start-meeting → spawn cwd 가 ArenaRoot/projects/<slug>/ 안" layer 통과 단언. 4 회의 시작 path 전부 커버.

**테스트 구조:**
- 위치: `src/main/__tests__/path-guard-integration.test.ts` (신규)
- in-memory SQLite + temp ArenaRoot + mock CLI spawn (spawn 호출 시 cwd 캡처)
- 4 시나리오:

| 시나리오 | trigger | 단언 |
|----------|---------|------|
| **S1** channel:start-meeting | channel-handler IPC 호출 | spawn cwd === `<arena>/projects/<slug>/`, ssmCtx.projectPath === 동일, ssmCtx.permissionMode === project.permissionMode |
| **S2** 큐 자동 회의 | default-meeting-starter | 동일 + 큐 path 가 ssmCtx 채움 |
| **S3** handoff:start-meeting-from-package | handoff-handler | 동일 + receiver 채널의 projectId 사용 |
| **S4** auto-trigger (메시지 자동 회의) | meeting-auto-trigger | 동일 + 자동 트리거의 ssmCtx 가 빈 문자열 0건 |
| **S5** external 프로젝트 + 정상 link | S1~S4 변종 | TOCTOU 재검증 발동 + spawn cwd = `<arena>/projects/<slug>/link/` |
| **S6** external 프로젝트 + junction swap | S5 변종 | `resolveForCli` 가 PermissionBoundaryError throw |

**추가 vitest 케이스 (브랜드 / invariant 단위):**
- `asAbsolutePath('')` throw
- `asAbsolutePath('.')` throw
- `asAbsolutePath('./foo')` throw
- `asAbsolutePath('relative/path')` throw
- `asAbsolutePath('/abs/path')` PASS
- `createSsmContext({ projectPath: ''})` throw
- `createSsmContext({ projectId: ''})` throw
- `new ExecutionService({})` (ensureAccess 없음) throw

**효과:**
- R13+ phase 에서 *cross-cutting wire 가 깨지면* integration test 가 즉시 fail.
- "land 단계 책임자가 wire 단계 책임자에게 인계 안 함" 패턴이 *test 단계에서 catch*.

---

### D7. spec §7.6 본문 보정 — *R12-X land 후* dead infrastructure 묘사 정정

**확정:** 현행 spec §7.6 본문이 *land 가정* 으로 작성되어 있음 — *실제로는 dead* 였던 사실을 R12-X 가 정정. 본문 갱신은 R12-X 의 마지막 task.

**갱신 영역:**
- §7.6.1 방어 범위 표 — *path-guard (PermissionService)* 행에 *"R12-X 에서 정식 wire — R2~R12 사이 dead infrastructure 였음"* 각주 (정정 명시).
- §7.6.2 cwd 강제 — *`resolveProjectPaths` 직접 호출* 이 아니라 *`PermissionService.resolveForCli`* 가 정본임을 명시. T10.5 의 *임시 우회* 가 본 phase 에서 닫힘.
- §7.6.4 path-guard 본문 — `validateAccess` / `resolveForCli` 의 *모든 호출 site 목록* 을 명시 (R12-X 가 land 한 정본). 새로운 호출 추가 시 *이 표가 정본 — 갱신 의무* 라고 못 박음.
- R12-W T20 의 §7.6.4 신설 ("채널-권한 filter layer") 과 *공존* — 둘 다 §7.6.4 가 되려 하므로 R12-W T20 을 §7.6.5 로 재시프트 (구체 번호는 plan 진행 시 결정).

---

## 3. 결정 요약 표

| # | 결정 포인트 | 확정 |
|---|------------|------|
| D1 | PermissionService 정식 wire (G3) | 인스턴스화 + CLI spawn / Main I/O 모든 경로 경유. T10.5 의 resolveProjectPaths 직접 호출 대체 |
| D2 | ExecutionService boot wire (G4) + ensureAccess required (G7) | `setExecutionWorkspaceRoot` boot 호출 + ensureAccess optional → required + 미주입 throw |
| D3 | MeetingSession.setProjectPath dead method 삭제 (G6) | 호출자 0 확인 후 제거 |
| D4 | 회귀 가드 1 — AbsolutePath brand type | `string & { __brand: 'AbsolutePath' }` + asAbsolutePath / unsafeMarkAbsolute |
| D5 | 회귀 가드 2 — Runtime invariant | SsmContext / ExecutionService constructor 에서 빈 문자열 / '.' throw |
| D6 | 회귀 가드 3 — Integration test | 4 회의 시작 path × external 정상/junction-swap = 6 시나리오 |
| D7 | spec §7.6 본문 보정 | R12-X 의 마지막 task — dead infrastructure 묘사 정정 + 호출 site 정본 표 |

---

## 4. ADR §결재 포인트 (사용자 결재 대기)

| # | 결재 항목 | 추천 |
|---|----------|------|
| **AX-Q1** | spec §7.6 본문 보정 깊이 — 가벼운 footnote 1줄 vs §7.6.2/§7.6.4 본문 다시 쓰기 | 본문 다시 쓰기 — dead infrastructure 묘사가 *5 phase 누적 잘못된 가정* 의 근원. 본문 다시 써야 R13+ 가 정본을 신뢰 가능 |
| **AX-Q2** | `AbsolutePath` brand 도입 범위 — 점진적 vs 일괄 | **일괄 1건 PR** — type 변경 → 컴파일 fail → 정정. 점진은 *brand 의 효과를 무력화* (brand 안 한 site 가 brand 한 site 에 raw string 흘려보냄). 약 30~40 파일 touch 추정 |
| **AX-Q3** | Integration test 위치 — vitest main unit / 별 layer test / Playwright E2E | **vitest main unit** — in-memory SQLite + mock CLI spawn 으로 빠른 회귀 (E2E 33셀 매트릭스 부담 X). Playwright E2E 는 R12-W T19 가 이미 사용자 시나리오 커버 |
| AX-Q4 (자연) | T10.5 land 후 잔여 G3/G4/G6/G7 모두 R12-X 안에서 처리 | audit 옵션 C 변형 그대로 |
| AX-Q5 (자연) | R12-X land 시점 — R12-W 종결 후 + 사용자 dogfooding 검증 후 | audit 추천 그대로 |

---

## 5. Rolestra 7축 권한 비유 — R12-X 영향 표 (갱신)

| 축 | 코드 | R12-W (도구 권한) | R12-X (경로 봉인) |
|----|------|------------------|-------------------|
| 인사팀 | `MemberProfileService` | 변경 0 | 변경 0 |
| **출입증 (CLI argv)** | `PermissionFlagBuilder` + filter | filter layer 추가 (T11) | **`AbsolutePath` brand 적용** |
| **출입문 경비원 (PathGuard)** | `PermissionService` | 변경 0 | **인스턴스화 + 모든 호출 site wire — 본 phase 핵심** |
| **작업 감독관 (ExecutionService)** | `execution-service.ts` | 변경 0 | **boot wire (G4) + ensureAccess required (G7)** |
| 결재 담당자 | `ApprovalService` / `AutonomyGate` | 변경 0 | 변경 0 |
| **통역사 (PromptComposer)** | `prompt-composer.ts` | wire-up + permissionSnapshot | (안내 단락의 경로 표기에 `AbsolutePath` 사용) |
| 비서실 (i18n) | `notification-labels.ts` | 변경 0 | 변경 0 |
| **채널** | `ChannelService` | 권한 5컬럼 + EventEmitter | 변경 0 |
| **회귀 가드 (신규 축 — R12-X 도입)** | `absolute-path.ts` + SsmContext invariant + integration test | — | **본 phase 도입 — R13+ 회귀 차단 기반** |

R12-W 와 R12-X 가 *직교 영역* 으로 책임 분리. R12-W = "어느 도구를 쓰나" (도구 권한), R12-X = "어느 폴더에서 쓰나" (경로 봉인) + *회귀 가드*.

---

## 6. Consequences

(+) spec §7.6 PathGuard 봉인 chain 정식 복원 — *5 phase 누적 dead infrastructure* 종결.
(+) `AbsolutePath` brand + runtime invariant + integration test 셋 다 land — R13+ 의 cross-cutting wire 격차 *자동 catch*.
(+) audit 의 root cause 패턴 ("누구의 phase 책임도 아닌 사각") 해소 — 회귀 가드 자체가 *cross-cutting 책임* 을 자동 enforce.
(+) external 프로젝트 junction TOCTOU (CA-3) 가 *실제로 동작* — spec §7.6.4 의 의도 land.
(+) ExecutionService apply path 가 실제 호출 가능 — G4 fix 로 spec §7.7 의 결재 / 거절 / 조건부 흐름이 *실제 작동*.

(−) **30~40 파일 touch** — `AbsolutePath` brand 일괄 도입의 비용. 점진적 도입은 brand 효과 무력화라 어쩔 수 없음.
(−) realpathSync 비용 — 매 회의 시작 + 매 CLI 명령. spec §7.6.4 가 자체 인정한 "not cheap/cached". 사용자 가시 마찰 시 follow-up.
(−) ExecutionService.ensureAccess required 변경이 *기존 `detailPreviewExecutionService` 인스턴스화 site* 깨뜨림 — 한 commit 안 처리.
(−) spec §7.6 본문 다시 쓰기 — 5 phase 누적 ADR 들이 *현행 spec 본문* 참조하므로 cross-reference 무결성 영향. R12-X 의 spec 보정 task 가 *5 phase 분 ADR 의 참조 정합도* 함께 검토.

---

## 7. 신규 코드 추정 (LoC)

| 영역 | LoC 추정 |
|------|---------|
| `src/shared/absolute-path.ts` (new — brand + helper) | 80 |
| SsmContext / ProjectPaths / ChannelPath 등 type 갱신 | 120 |
| asAbsolutePath / unsafeMarkAbsolute 호출 사이트 정정 (~30~40 파일) | 400 |
| PermissionService 인스턴스화 + composition root DI | 60 |
| 호출 site wire — meeting-turn-executor / cli-provider / workspace-handler / meeting-minutes-service / snapshot/* | 200 |
| ExecutionService boot wire + ensureAccess required + detailPreview 인스턴스화 수정 | 100 |
| MeetingSession.setProjectPath 삭제 | −20 |
| Runtime invariant (createSsmContext factory + ExecutionService constructor) | 80 |
| Integration test (`path-guard-integration.test.ts` — 6 시나리오) | 400 |
| Unit test 추가 (brand / invariant 단위) | 200 |
| spec §7.6 본문 보정 (마크다운) | 60 |
| ADR / plan / 구현 현황 문서 정합 | 40 |
| **총합** | **약 1,720 LoC** |

---

## 8. Follow-up (R12-X 범위 외)

### Follow-up 1 — realpathSync 캐싱

spec §7.6.4 가 자체 인정한 "not cheap/cached". 사용자 가시 마찰 발생 시 (예: 100 turn 회의에서 100 회 realpath) 캐싱 + invalidation 도입. 별도 ADR.

### Follow-up 2 — `process.cwd()` 의존성 전면 제거

`'.'` 또는 `process.cwd()` fallback 이 어디서 발동하는지 audit 재실행. brand type 으로 컴파일 단계에서 차단되지만 *raw shell command / electron API* 등 brand 외 surface 는 별도 검토.

### Follow-up 3 — Path 외 *다른* cross-cutting invariant audit

본 audit 가 *경로* 만 검토 — 다른 cross-cutting (PermissionMode / AutonomyMode / channel role NULL 분기 etc.) 도 *같은 root cause 패턴* 일 가능성. R12-W audit 보고서의 root cause §4 가 *경로 한정 격차* 가 아닐 가능성 — 점진 audit.

### Follow-up 4 — CLI 자체 spawn 의 fs 호출 (spec §7.6.1 한계)

spec §7.6.1 의 *"path-guard 는 Main 경유 I/O 만 막는다"* 는 본질적 한계. CLI 가 자체 spawn 안에서 `fs.writeFile` 직접 호출하면 PathGuard 못 막음. OS-level sandbox (seccomp / chroot / app sandbox) 도입 검토 — 본 ADR 범위 외.

---

## 9. 관련 문서

- spec: `docs/specs/2026-04-18-rolestra-design.md` §7.6 — 본 ADR 의 D7 가 본문 보정
- audit: `docs/R12_c2_2R/reports/audit/2026-05-12-r12-w-pathguard-wire-audit.md` — 본 ADR 의 직접 근거
- ADR 선행: `docs/R12_c2_2R/decisions/r12-w-member-file-permission.md` (T10.5 hotfix block 의 *임시 우회* 를 본 ADR 이 정식 wire 로 대체)
- ADR cross-cutting: `docs/decisions/cross-cutting.md` C3 (ExecutionService 경계) / C6 (path-guard ArenaRoot 봉인) — 본 ADR 이 *land 가정* 을 *실제 land* 로 정정
- plan: `docs/R12_c2_2R/plans/2026-05-12-rolestra-r12-x-pathguard-wire-up.md` (본 ADR 의 구현 분해)
