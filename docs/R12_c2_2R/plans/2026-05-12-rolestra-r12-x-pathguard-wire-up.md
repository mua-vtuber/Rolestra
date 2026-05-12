# Plan — R12-X PathGuard 봉인 chain 정식 wire-up + 회귀 가드 3종

작성일: 2026-05-12
ADR: `docs/R12_c2_2R/decisions/r12-x-pathguard-wire-up.md`
audit: `docs/R12_c2_2R/reports/audit/2026-05-12-r12-w-pathguard-wire-audit.md`
선행: R12-W 종결 (T1~T21 + T10.5 hotfix block land) + 사용자 dogfooding 검증

> **본 plan 의 위치:** R12-W T10.5 가 *사용자 가시 critical* (G1+G2+G5) 을 해결한 후, 잔여 G3+G4+G6+G7 + 회귀 가드 3종 (`AbsolutePath` brand / runtime invariant / integration test) 을 land 하는 phase. audit 보고서 옵션 C 변형의 R12-X 정식 phase.

---

## 0. Plan 전제

ADR 확정 결정 (R12-X):
- **D1** PermissionService 인스턴스화 + 호출 wire (G3)
- **D2** ExecutionService boot wire + ensureAccess required (G4+G7)
- **D3** MeetingSession.setProjectPath 삭제 (G6)
- **D4** AbsolutePath brand type
- **D5** Runtime invariant
- **D6** Integration test (4 회의 path × external 정상/swap = 6 시나리오)
- **D7** spec §7.6 본문 보정

ADR §4 결재 포인트 (사용자 결재 대기):
- AX-Q1 spec 본문 보정 깊이 — 본문 다시 쓰기
- AX-Q2 brand 도입 범위 — 일괄 1 PR
- AX-Q3 integration test 위치 — vitest main unit

---

## 1. Root cause 패턴 명시 (왜 이 phase 가 필요한가)

audit 보고서 §4 인용:

> "**land 단계 책임자가 wire 단계 책임자에게 인계 안 함**" — R2 Task 6 (PathGuard) / R2 Task 12 (SsmContext) / R7 / R10 / R12-S / R12-C 의 각 phase 가 *자기 도메인* 만 책임. *cross-cutting wire* 가 **누구의 phase 책임도 아닌 영역**. ADR cross-cutting C3 / C6 가 *invariant 만 선언* 하고 *그 invariant 의 회귀 가드는 명시 안 함*.

본 plan 은 이 *구조적 사각* 을 닫는다:
- **R2~R12 의 phase 별 책임 모델 안에서 cross-cutting wire 가 깨졌다** — R12-X 는 그 wire 를 정식 복원.
- **회귀 가드 3종 (brand / invariant / integration test) 이 *cross-cutting 책임* 을 자동 enforce** — R13+ 의 새 phase 가 path 또는 ssmCtx 를 *잘못 채우면* TypeScript / runtime / vitest 가 즉시 catch.
- *cross-cutting* 이라는 영역에 *명시적 가드 layer* 가 들어가 — phase 별 책임 모델에서 비어 있던 사각이 채워짐.

이 plan 의 *진짜 가치* 는 G3/G4/G6/G7 fix 가 아니라 *회귀 가드 3종 도입* 이다. fix 만 land 하고 가드 안 land 하면 R14 또는 R15 의 새 phase 가 같은 패턴으로 wire 다시 끊을 가능성 100%.

---

## 2. 의존성 그래프

```
─────────── 1차 (회귀 가드 기반) ──────────────────────────────
T1: src/shared/absolute-path.ts — AbsolutePath brand + asAbsolutePath +
    unsafeMarkAbsolute helper
    └─ 독립 (R12-X 의 모든 후속 T 의 기반)

T2: SsmContext / ProjectPaths / Channel path 등 shared type 갱신
    + asAbsolutePath 검증 도입
    └─ T1 의존

─────────── 2차 (PermissionService 정식 wire) ─────────────────
T3: PermissionService 인스턴스화 + composition root DI
    └─ T1 의존 (resolveForCli 반환 type 이 AbsolutePath)

T4: meeting-turn-executor / cli-provider — resolveProjectPaths 직접 호출
    → permissionService.resolveForCli(projectId) 대체
    └─ T3 의존 (+ T10.5 land 의무 — T10.5 의 우회 site 를 정식 wire 로 교체)

T5: workspace-handler / meeting-minutes-service / snapshot/* / 기타 Main I/O —
    permissionService.validateAccess 호출 wire
    └─ T3 의존

─────────── 3차 (ExecutionService boot + ensureAccess required) ───
T6: ExecutionService — ensureAccess optional → required + 미주입 throw
    └─ T3 의존 (ensureAccess closure 가 permissionService.validateAccess 호출)

T7: setExecutionWorkspaceRoot boot wire + detailPreviewExecutionService
    인스턴스화 수정 (ensureAccess 주입)
    └─ T6 의존

─────────── 4차 (Runtime invariant + dead code 삭제) ──────────
T8: SsmContext factory (createSsmContext) — runtime invariant 강화
    + createDefaultSsmContext 를 createDefaultSsmContextForTest 로 격리
    └─ T2 의존

T9: MeetingSession.setProjectPath dead method 삭제 (G6)
    └─ T10.5 land 의무 (T10.5 가 ssmCtx 로 충분히 해결한 후)

─────────── 5차 (Integration test) ────────────────────────────
T10: src/main/__tests__/path-guard-integration.test.ts — 6 시나리오
     └─ T4, T5, T7, T8 의존 — 모든 wire 가 정식 land 된 후 통합 검증

T11: brand / invariant 단위 vitest 케이스 (asAbsolutePath / createSsmContext
     / ExecutionService constructor 단위)
     └─ T1, T2, T8 의존

─────────── 6차 (spec 본문 보정 + 문서 정합) ───────────────────
T12: spec §7.6 본문 다시 쓰기 — D7 의 4 영역 (§7.6.1 표 / §7.6.2 / §7.6.4 /
     §7.6.5 번호 시프트)
     └─ T10, T11 PASS 후 (전체 land 확정 후 본문 갱신)

T13: 문서 정합 — 구현현황 / decisions/README / R12-W log / cross-cutting
     C3/C6 의 *land 가정* → *실제 land* 정정
     └─ T12 PASS 후
```

병렬 가능:
- 1차: T1 → T2 순차
- 2차 (T3~T5) ↔ 3차 (T6~T7) 병렬 (T3 land 후)
- 4차 T8 은 T2 후, T9 는 T10.5 land 후 — 둘 다 독립
- 5차 (T10/T11) 동시 진행 가능 (T11 은 T1~T8 만 만족하면 됨)

크리티컬 패스: T1 → T2 → T3 → T4 → T6 → T7 → T10 → T12 → T13 (9 단계)

---

## 3. 작업 분해

### T1 — `src/shared/absolute-path.ts` — brand type + helper

**무엇:** ADR D4 의 핵심 — `AbsolutePath` brand 도입.

**영향 파일:** 0 edit

**신규 파일:**
- `src/shared/absolute-path.ts`
- `src/shared/__tests__/absolute-path.test.ts`

**내용 (ADR D4 의 스케치 그대로):**
```ts
export type AbsolutePath = string & { readonly __brand: 'AbsolutePath' };
export function asAbsolutePath(p: string, context: string): AbsolutePath;
export function unsafeMarkAbsolute(p: string): AbsolutePath;
```

**verify:** `npx vitest run src/shared/__tests__/absolute-path.test.ts`

**acceptance:**
- `asAbsolutePath('')` throw
- `asAbsolutePath('.')` throw
- `asAbsolutePath('./foo')` throw
- `asAbsolutePath('relative/path')` throw
- `asAbsolutePath('/abs/path', 'ctx')` PASS, returns AbsolutePath
- `unsafeMarkAbsolute('any')` PASS (escape hatch — code review 단계 catch)

---

### T2 — Shared type 갱신 (path 필드 → AbsolutePath)

**무엇:** path 가진 모든 shared type 의 string → AbsolutePath 갱신.

**영향 파일:**
- `src/shared/ssm-context-types.ts` — `SsmContext.projectPath: AbsolutePath`
- `src/shared/arena-root-types.ts` — `ProjectPaths.{rootPath,cwdPath,metaPath,consensusPath}: AbsolutePath`
- `src/shared/channel-types.ts` (또는 정의 위치) — channel 의 cwdPath 류 필드가 있으면 갱신
- `src/shared/file-types.ts` — `WorkspaceInfo.{projectFolder,arenaFolder}: AbsolutePath`, `ConsensusFolderInfo.folderPath: AbsolutePath`
- 기타 path 가진 shared interface grep 후 일괄

**컴파일 fail chain 정정 (T2 의 핵심 작업):**
- TypeScript build 가 *모든 호출 site* 에서 error 발생.
- 정정 패턴 2가지:
  - **(a)** `asAbsolutePath(rawString, 'context')` — 검증 + brand. *path 의 source* 가 외부 입력일 때.
  - **(b)** `unsafeMarkAbsolute(verifiedString)` — 이미 다른 곳에서 검증된 경로의 escape hatch. 코드 리뷰 단계에서 *왜 unsafe 인지* 주석 필수.
- `resolveProjectPaths` 의 내부 — `path.join(arenaRoot, ...)` 결과 — arenaRoot 가 이미 AbsolutePath 라면 `unsafeMarkAbsolute(path.join(...))` 사용.

**신규 파일:** 0

**verify:**
- `npm run build` PASS
- `npx tsc --noEmit` PASS

**acceptance:**
- 컴파일 fail chain 100% 정정.
- `unsafeMarkAbsolute` 호출 site grep — 모두 *주석* 으로 *왜 unsafe* 명시.

**touch 파일 수 추정:** 30~40 (ADR §7 추정과 일치).

---

### T3 — PermissionService 인스턴스화 + composition root DI

**무엇:** ADR D1 — PermissionService 가 production runtime 에서 *처음 인스턴스화*.

**영향 파일:**
- `src/main/index.ts` — boot 시점에 `const permissionService = new PermissionService(arenaRoot, projectRepo)` 추가
- 의존 서비스 (meeting-turn-executor / cli-provider / execution-handler / workspace-handler 등) 의 DI 에 permissionService accessor 추가

**신규 파일:** 0

**핵심 invariant:**
- PermissionService 단일 인스턴스 — composition root 에서만 생성, 모든 호출 site 가 같은 인스턴스 참조.
- accessor pattern — 기존 R10 D5 patterns (`setApprovalDetailExecutionAccessor` 등) 과 일관.

**verify:** `npm run build` PASS + boot smoke (앱 시작 정상)

**acceptance:** PermissionService 인스턴스 정확히 1개, accessor 통해 4+ 호출 site 가 참조.

---

### T4 — meeting-turn-executor / cli-provider — resolveForCli 호출 wire

**무엇:** R12-W T10.5 의 임시 우회 (`resolveProjectPaths` 직접 호출) 를 PermissionService.resolveForCli 로 대체.

**영향 파일:**
- `src/main/meetings/engine/meeting-turn-executor.ts` — callProviderOnce / runPhaseTurn 의 CLI spawn 분기, `permissionService.resolveForCli(this.session.ssmCtx.projectId)` 호출. cwd 결과로 `provider.setProjectPath(...)` 호출.
- `src/main/providers/cli/cli-provider.ts` — spawn 직전 cwd 검증 도입 (AbsolutePath 외 throw)
- ssmCtx 생성 4 곳 (R12-W T10.5.G2 에서 resolveProjectPaths 호출 패턴) — `permissionService.resolveForCli(...).cwd` 로 일괄 교체

**변경 본문 (ssmCtx 생성 4곳 — 예시 channel-handler):**
```ts
// T10.5 의 직접 호출 패턴:
const paths = resolveProjectPaths(project, arenaRoot.getPath());
const ssmCtx: SsmContext = {
  ...,
  projectPath: paths.cwdPath,
};

// T4 의 정식 wire:
const { cwd } = permissionService.resolveForCli(channel.projectId);
const ssmCtx: SsmContext = {
  ...,
  projectPath: cwd,
};
```

**효과:**
- external 프로젝트 junction TOCTOU 재검증이 *매 회의 시작* 자동 발동 (CA-3).
- `folder_missing` 상태 프로젝트의 회의 시작이 *명시 PermissionBoundaryError throw* — silent fallback 0.

**verify:**
- `npx vitest run src/main/meetings/engine/__tests__/`
- `npx vitest run src/main/ipc/handlers/__tests__/channel-handler.test.ts`

**acceptance:**
- 4 회의 시작 path 모두 PermissionService.resolveForCli 경유.
- external 프로젝트 junction swap 시 회의 시작 throw.
- `resolveProjectPaths` 직접 호출 grep — meeting-turn-executor / cli-provider / channel-handler / default-meeting-starter / index.ts (ssmCtx 생성 분기) 에서 0건.

---

### T5 — Main I/O 의 validateAccess 호출 wire

**무엇:** workspace-handler / meeting-minutes-service / snapshot/* / 기타 Main 경유 fs 호출 site 에 `permissionService.validateAccess` wire.

**영향 파일 (사전 grep 필요):**
- `src/main/meetings/meeting-minutes-service.ts` — consensusPath 안 검증 (현재 *내부 helper* 로 직접 isPathWithin) → permissionService.validateAccess 경유 통일
- `src/main/snapshot/playwright-snapshot.ts` — PathGuard 봉인 검증 (현재 직접 호출인지 grep)
- `src/main/ipc/handlers/workspace-handler.ts` — init / status 의 path 인자 검증
- 기타 — `grep -rn "isPathWithin\|fs.writeFile\|fs.readFile" src/main/` 후 PathGuard 미경유 site 식별

**신규 파일:** 0

**verify:** 사이트 별 unit test 갱신 + grep 결과 0 차이

**acceptance:**
- 모든 Main-routed fs / command 호출 site 가 PermissionService.validateAccess 경유 (또는 ExecutionService.ensureAccess 경유 — 둘 다 결국 validateAccess 호출).
- `isPathWithin` 직접 호출 grep — `permission-service.ts` 내부 helper 외 0건.

---

### T6 — ExecutionService — ensureAccess optional → required

**무엇:** ADR D2 — silent skip 패턴 제거.

**영향 파일:**
- `src/main/execution/execution-service.ts` — interface 변경, constructor throw 추가, `if (this.ensureAccess)` 분기 제거
- `src/main/execution/__tests__/execution-service.test.ts` — ensureAccess required 검증 케이스 추가

**변경 본문 (ADR D2 의 스케치 그대로):**
```ts
interface ExecutionServiceOptions {
  workspaceRoot: AbsolutePath;
  ensureAccess: (...) => Promise<boolean>;  // required
  circuitBreaker?: CircuitBreaker;
}

constructor(options: ExecutionServiceOptions) {
  if (typeof options.ensureAccess !== 'function') {
    throw new Error(
      '[ExecutionService] ensureAccess callback is required. ' +
      'Wire to PermissionService.validateAccess at composition root.'
    );
  }
  ...
}

// 호출 site — if 분기 제거
const allowed = await this.ensureAccess(aiId, 'read', normalizedPath);
if (!allowed) throw new ExecutionAccessDeniedError(...);
```

**verify:** `npx vitest run src/main/execution/__tests__/execution-service.test.ts`

**acceptance:**
- `new ExecutionService({})` (ensureAccess 없음) throw.
- silent skip 패턴 0건.

---

### T7 — setExecutionWorkspaceRoot boot wire + detailPreview 인스턴스화 수정

**무엇:** ADR D2 — boot 시 ExecutionService singleton 초기화 + detailPreviewExecutionService 에도 ensureAccess 주입.

**영향 파일:**
- `src/main/index.ts` — boot 시점에 다음 추가:
  ```ts
  setExecutionWorkspaceRoot(
    arenaRoot.getPath(),
    async (aiId, action, target) => {
      permissionService.validateAccess(target, getActiveProjectId());
      return true;
    },
    circuitBreaker,
  );
  ```
- `src/main/index.ts:361-363` — `detailPreviewExecutionService` 도 ensureAccess 주입:
  ```ts
  const detailPreviewExecutionService = new ExecutionService({
    workspaceRoot: arenaRoot.getPath(),
    ensureAccess: async (...) => { ... },  // T6 가 required 로 만들었으므로 의무
  });
  ```

**핵심 디자인 — `getActiveProjectId()` 결정:**
- ExecutionService 의 ensureAccess closure 가 *현재 어느 프로젝트* 인지 어떻게 아는가?
- 후보:
  - (a) ExecutionService 자체가 projectId 인자 받음 — interface 변경
  - (b) submitPatchForReview / apply 호출 site 가 projectId 전달 — 호출 site 정정
  - (c) global context (zustand-like main state) 에서 lookup — 추천 안 함
- **추천: (b)** — ExecutionService 가 *projectId 를 모르고* 호출 site 가 명시 전달. ExecutionService interface 에 projectId 추가.
- sub-task 7a: ExecutionService.submitPatch / apply / rollback 의 인자에 `projectId: string` 추가, 호출 site 정정.

**verify:**
- `npm run build` PASS
- `npx vitest run` 전체 PASS
- boot smoke — `getExecutionService()` 가 throw 없이 인스턴스 반환

**acceptance:**
- `setExecutionWorkspaceRoot` 호출자 = main/index.ts 1건.
- `getExecutionService()` 호출 시 throw 0.
- detailPreviewExecutionService 도 정상 ensureAccess 주입.

---

### T8 — Runtime invariant 강화 (createSsmContext factory)

**무엇:** ADR D5 — SsmContext 생성 시 빈 문자열 / '.' 명시 throw.

**영향 파일:**
- `src/shared/ssm-context-types.ts` — `createSsmContext` factory 신설 (production 용) + `createDefaultSsmContextForTest` (test 용으로 격리, 인자에 projectPath required)
- 호출 site 4 곳 (ssmCtx 생성) — createSsmContext factory 경유로 통일

**변경 본문 (ADR D5 의 스케치 그대로):**
```ts
export function createSsmContext(input: {...}): SsmContext {
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
```

**verify:** `npx vitest run src/shared/__tests__/ssm-context-types.test.ts`

**acceptance:**
- createSsmContext 가 빈 문자열 / '.' / 빈 projectId 받으면 throw.
- 4 곳 호출 site 가 모두 factory 경유 (raw object literal 0건).

---

### T9 — `MeetingSession.setProjectPath` 삭제 (G6)

**무엇:** dead method 정리.

**영향 파일:**
- `src/main/meetings/engine/meeting-session.ts:290-292` — 메서드 + JSDoc 삭제
- test 호출자 있으면 동시 정리

**선행 verify:**
```bash
grep -rn "session\\.setProjectPath\|\\.setProjectPath(" src/ | grep -v "cli-provider\|__tests__"
```
production 0건 확인.

**verify:** `npm run build` PASS + `npx vitest run` PASS

**acceptance:** dead method 제거, 회귀 0.

---

### T10 — Integration test (`path-guard-integration.test.ts`)

**무엇:** ADR D6 — 6 시나리오 layer 통과 단언.

**신규 파일:**
- `src/main/__tests__/path-guard-integration.test.ts`

**setup:**
- in-memory better-sqlite3
- temp ArenaRoot (os.tmpdir 안 fixture)
- mock CLI spawn — `execFile` stub 으로 args + cwd 캡처
- mock provider registry — CliProvider 의 streamCompletion 가짜 응답

**시나리오 6종 (ADR D6 표 그대로):**

| 시나리오 | trigger | 핵심 단언 |
|----------|---------|----------|
| S1 channel:start-meeting | channel-handler IPC | spawn cwd === `<arena>/projects/<slug>/`, ssmCtx 정상 |
| S2 큐 자동 회의 | default-meeting-starter | 동일 |
| S3 handoff:start-meeting-from-package | handoff-handler | 동일 |
| S4 auto-trigger | meeting-auto-trigger | 동일 |
| S5 external + 정상 link | S1~S4 변종 | spawn cwd = `<arena>/projects/<slug>/link/` + TOCTOU 발동 |
| S6 external + junction swap | S5 변종 | PermissionBoundaryError throw |

**verify:** `npx vitest run src/main/__tests__/path-guard-integration.test.ts`

**acceptance:**
- 6 시나리오 GREEN.
- 각 시나리오에서 *layer 통과* (channel-handler → ssmCtx → MeetingSession → CliProvider → spawn cwd) 일관성 단언.

---

### T11 — brand / invariant 단위 vitest

**무엇:** ADR D4 + D5 의 단위 회귀.

**영향 파일:**
- `src/shared/__tests__/absolute-path.test.ts` (T1 에 일부 있음, 여기서 확장)
- `src/shared/__tests__/ssm-context-types.test.ts` (T8 에 일부 있음, 여기서 확장)
- `src/main/execution/__tests__/execution-service.test.ts` (T6 에 일부 있음, 여기서 확장)

**케이스 (ADR D6 후반 의 단위 케이스 표):**
- `asAbsolutePath` 빈 / `.` / 상대 / `/abs` 4 케이스
- `createSsmContext` 빈 projectPath / 빈 projectId / 정상 3 케이스
- `new ExecutionService({})` ensureAccess 없음 throw

**verify:** `npx vitest run` 전체 PASS

**acceptance:** brand / invariant 단위 회귀 셋 모두 GREEN.

---

### T12 — spec §7.6 본문 다시 쓰기

**무엇:** ADR D7 — dead infrastructure 묘사 정정.

**영향 파일:**
- `docs/specs/2026-04-18-rolestra-design.md` §7.6

**갱신 영역 (ADR D7 의 4 영역):**
1. §7.6.1 방어 범위 표 — *path-guard (PermissionService)* 행에 정정 각주
2. §7.6.2 cwd 강제 — `PermissionService.resolveForCli` 가 정본임을 명시 (resolveProjectPaths 직접 호출은 *내부 helper* 라고 정정)
3. §7.6.4 path-guard 본문 — `validateAccess` / `resolveForCli` 의 *모든 호출 site 목록* 정본 표 추가
4. §7.6.5 번호 시프트 — R12-W T20 의 §7.6.4 (채널-권한 filter layer) 가 §7.6.5 로 이동 (정확한 번호는 plan 진행 시 결정)

**verify:** 사람 spot check + markdown lint

**acceptance:** 본문 정정 + cross-reference 정합 (R12-W 의 §7.6.4 ↔ R12-X 의 §7.6.4 충돌 해결).

---

### T13 — 문서 정합

**무엇:** ADR / plan / 구현 현황 / cross-cutting 정합.

**영향 파일:**
- `docs/구현-현황.md` — R12-X 항목 추가 (G3+G4+G6+G7 + 회귀 가드 land)
- `docs/decisions/README.md` — r12-x 행 추가
- `docs/R12_c2_2R/decisions/r12-w-member-file-permission.md` — "후속: r12-x PathGuard wire-up 정식 land" 1줄 추가
- `docs/decisions/cross-cutting.md` C3 / C6 — *land 가정* 을 *실제 land (R12-X)* 로 정정. 본문 1~2 paragraph 갱신
- `docs/R12_c2_2R/reports/audit/2026-05-12-r12-w-pathguard-wire-audit.md` — "결재 후 처리 결과: R12-X 로 land" 후속 노트

**verify:** 사장 spot check

**acceptance:** 5 문서 모두 R12-X land 명시 + cross-cutting C3/C6 본문 정정.

---

## 4. Definition of Done

1. `npm run build` PASS
2. `npm run lint` PASS
3. `npm run i18n:check` exit 0
4. `npx vitest run` 전체 PASS (R12-W 회귀 0 + path-guard-integration.test.ts 6 시나리오 GREEN)
5. `npx playwright test --project=electron` 전체 PASS (R12-W T19 회귀 0)
6. grep 단언:
   ```bash
   # G3 정식 fix 확인
   grep -rn "resolveForCli\|validateAccess(" src/main/ | grep -v __tests__ | grep -v permission-service.ts
   # → 호출자 N건 (R12-X 가 land 한 site)

   # G4 fix 확인
   grep -rn "setExecutionWorkspaceRoot" src/  | grep -v __tests__
   # → main/index.ts 호출자 1건

   # G6 dead method 삭제
   grep -rn "MeetingSession.*setProjectPath" src/  | grep -v __tests__
   # → 0건

   # T10.5 의 임시 우회 — R12-X 가 정식 wire 로 대체했는지
   grep -rn "resolveProjectPaths(" src/main/ | grep -v __tests__ | grep -v permission-service.ts | grep -v arena
   # → 정식 호출 site 외 0건
   ```
7. AbsolutePath brand 도입 — `unsafeMarkAbsolute` 호출 site 모두 *주석으로 unsafe 이유 명시*
8. spec §7.6 본문 보정 land
9. ADR / plan / 구현 현황 / cross-cutting C3/C6 정합

---

## 5. 잠재적 막힘 / 위험

| 위험 | 영향 | 대비 |
|------|------|------|
| AbsolutePath brand 도입 시 컴파일 fail chain 의 *touch 파일 30~40* 가 추정치 초과 (50+ 가능성) | T2 분량 폭증 | sub-task 분할 — shared type 그룹 / service 그룹 / handler 그룹 / test 그룹 별 PR 분리 가능. 단 brand 효과 위해 *최종 land 는 한 commit* 으로 묶음 |
| ExecutionService.ensureAccess closure 의 `getActiveProjectId()` 결정 | T7 막힘 | sub-task 7a — projectId 를 호출 site 가 전달 (interface 변경). 후방 호환성 X |
| realpathSync 성능 마찰 | 사용자 가시 마찰 | spec §7.6.4 자체 인정한 한계 — Follow-up 1 (캐싱) 별도 ADR |
| spec §7.6 본문 다시 쓰기가 *cross-reference 5 phase 분 ADR* 와 충돌 | T12 위험 | T13 의 cross-cutting C3/C6 정정과 함께 정합 — 본문 갱신 시 5 phase 의 §7.6 참조 grep 후 일괄 갱신 |
| MeetingSession.setProjectPath 삭제 후 *옛 test 코드* 가 dead method 호출 | T9 fail | T9 진입 전 production grep 0건 확인 + test grep 도 0건 확인 후 삭제 |
| Integration test 의 mock CLI spawn 가 *실제 cli-provider 동작* 과 drift | T10 회귀 가드 효과 약화 | mock spawn 의 args/cwd 캡처가 *production cli-provider 의 execFile 호출* 과 동일한 인터페이스 사용 — test fixture 가 production code path 정확히 거쳐야 함 |
| `unsafeMarkAbsolute` 의 *남용* — brand 의 효과 무력화 | R13+ 회귀 가드 효과 약화 | 코드 리뷰 단계에서 *모든 unsafeMarkAbsolute 호출 site* 점검 + 주석 의무. ESLint custom rule 으로 *주석 없는 unsafeMarkAbsolute* 차단 검토 (별 sub-task) |

---

## 6. 신규 코드 추정 (LoC — ADR §7 재게재)

| 영역 | LoC |
|------|-----|
| `src/shared/absolute-path.ts` | 80 |
| Shared type 갱신 | 120 |
| 호출 site 정정 (asAbsolutePath / unsafeMarkAbsolute) | 400 |
| PermissionService 인스턴스화 + DI | 60 |
| 호출 site wire (meeting-turn-executor / cli-provider / workspace-handler / etc.) | 200 |
| ExecutionService boot wire + ensureAccess required | 100 |
| MeetingSession.setProjectPath 삭제 | −20 |
| Runtime invariant (createSsmContext) | 80 |
| Integration test (6 시나리오) | 400 |
| Brand / invariant 단위 test | 200 |
| spec §7.6 보정 | 60 |
| ADR / plan / 문서 정합 | 40 |
| **총합** | **약 1,720 LoC** |

---

## 7. 결재 후 R13+ 영향 (회귀 가드 효과 예측)

R12-X land 후 R13+ phase 가 *새 cross-cutting wire* 추가할 때 자동 catch 되는 패턴:

1. **R13 phase 가 새 ssmCtx 생성 path 추가** — `projectPath: ''` 또는 `projectPath: project.name` 같은 raw string 대입 → TypeScript error (AbsolutePath brand 위반).
2. **R13 phase 가 새 ExecutionService 인스턴스화** — `new ExecutionService({})` ensureAccess 없음 → runtime throw.
3. **R13 phase 가 새 CLI spawn 경로 추가** — `execFile(..., { cwd: someString })` 인자 brand 위반 → TypeScript error.
4. **R13 phase 가 새 회의 시작 path 추가** — integration test S1~S6 패턴 따라 *해당 path 의 cwd 단언* 추가 의무 (test 작성 시 grep 으로 빠진 path 추적).

즉 본 plan 의 *진짜 효과* 는 R13+ 의 *cross-cutting 책임 사각* 자체를 *없앰* — 회귀 가드 3종이 *cross-cutting 책임* 을 phase 별 책임 모델 안으로 *재배치*.

---

## 8. 관련 문서

- ADR: `docs/R12_c2_2R/decisions/r12-x-pathguard-wire-up.md`
- audit: `docs/R12_c2_2R/reports/audit/2026-05-12-r12-w-pathguard-wire-audit.md`
- R12-W plan: `docs/R12_c2_2R/plans/2026-05-11-rolestra-r12-w-member-file-permission.md` (T10.5 hotfix 의 임시 우회를 T4 가 정식 wire 로 대체)
- spec: `docs/specs/2026-04-18-rolestra-design.md` §7.6 — T12 가 본문 갱신
- cross-cutting: `docs/decisions/cross-cutting.md` C3 / C6 — T13 이 본문 정정
