# Audit — R12-W PathGuard wire 정합성 (spec §7.6 봉인 전면 조사)

작성일: 2026-05-12
계기: R12-W T1~T10 dogfooding 중 사용자 보고 — AI 가 사용자가 의도한 ArenaRoot 안 프로젝트 폴더가 아니라 *앱 실행 위치 (rolestra source repo)* 의 `docs/` 를 읽음.
사장 결정 인용:
> "그것만 고치면 되는게 맞아? 전면조사가 필요하지 않나? 동작의 기본이 되는 부분이라 우선 수정되어야한다고 생각하는데"

본 보고서는 *audit 만* — production 코드 수정 0건. 사용자 결재 후 별 phase 에서 fix.

---

## 0. 요약 (먼저 결론)

spec §7.6 의 ArenaRoot 봉인 시스템은 R2 Task 6 에서 land 된 후 **production code path 에서 *한 번도 호출되지 않은* dead infrastructure 상태**다. 사용자 dogfooding 보고는 *단일 wire 누락 sample* 이 아니라 **봉인 chain 전체가 끊어진 결과 중 하나** 의 표면화에 불과.

핵심 root cause 5건:
- **G1 (high)** `CliProvider._projectPath = '.'` + `setProjectPath` 호출자 0 — CLI 가 *앱 실행 위치* 를 cwd 로 사용
- **G2 (high)** `ssmCtx.projectPath: ''` 4 곳 하드코딩 — SSM/PromptComposer/AutonomyGate 가 *프로젝트 경로 자체를 모름*
- **G3 (critical)** `PermissionService.resolveForCli` / `validateAccess` **호출자 0** — path-guard 가 한 번도 발동되지 않음
- **G4 (high)** `setExecutionWorkspaceRoot` **호출자 0** — `ExecutionService` lazy singleton 이 boot 시 초기화 안 됨. `submitPatchForReview` / apply 흐름이 호출 시점 throw
- **G5 (medium)** `ssmCtx.permissionMode: 'hybrid'` / `autonomyMode: 'manual'` 하드코딩 — 사용자가 설정한 *프로젝트 mode* 가 SSM 에 전달 안 됨

**보안 위험도 분리:**
- *실제 보안* (악의적 코드 격리): low — Rolestra 는 사용자가 *자기* AI 에게 자기 PC 권한 위임. AI 가 도구 sandbox 를 *바이패스* 한 사례 아님.
- *사용자 신뢰성 / mental model 충돌*: **high** — 사용자가 설정한 작업장 폴더가 아닌 *완전히 다른 폴더* 가 AI 에 노출되는 것은 spec §7.6.1 "1.5~2중 방어" 의 *0중 방어* 상태.
- *데이터 무결성*: **medium** — AI 가 사용자 원본 source repo (`rolestra source`) 에 read 만 가능 (CLI argv 가 read-only) 이므로 *현재로선* 쓰기 사고 없음. 단 R12-W T11+ 의 argv filter 가 land 되기 전에 mode 가 `auto` 로 가면 *쓰기 가능*.

---

## 1. spec §7.6 정본 vs 실제 — 격차 매트릭스

| 봉인 layer | spec §7.6 정본 의도 | 실제 동작 | 격차 |
|------------|---------------------|-----------|------|
| **§7.6.2 cwd 강제** | spawn 직전 `resolveProjectPaths(project)` → `cwd: resolved.spawnCwd` 주입 | `CliProvider._projectPath = '.'` (process.cwd = 앱 실행 위치) | G1 |
| **§7.6.2 cwd 강제 (SSM 측)** | `ssmCtx.projectPath` = `resolveProjectPaths` 의 cwdPath | `ssmCtx.projectPath: ''` 4 곳 하드코딩 | G2 |
| **§7.6.3 매트릭스** | mode × CLI × kind → argv | (mode 입력이 `'hybrid'` 하드코딩) → builder 는 정상 동작이지만 *입력이 거짓* | G5 |
| **§7.6.4 path-guard `validateAccess`** | Main 경유 I/O 전부 봉인 검증 | **호출자 0** — IPC handler 없음, ExecutionService 미연결 | G3 |
| **§7.6.4 CA-3 TOCTOU `resolveForCli`** | external 프로젝트 junction realpath 재검증 spawn 직전 | **호출자 0** — CLI spawn 이 `resolveForCli` 우회 | G3 |
| **§7.6.5 권한 요청 인터셉트** | hybrid/approval 에서 ApprovalCard | ApprovalCliAdapter 는 wire 되어 있음 — 옛 *CLI prompt* 흐름만 정상, ExecutionService 의 ensureAccess 우회 | (부분 정상) |
| **ExecutionService 경계 (C3)** | dryRun → 승인 → atomic apply → rollback | `setExecutionWorkspaceRoot` 호출자 0 → singleton 미초기화 → 호출 시점 throw | G4 |

**Defense-in-depth 1.5~2중 → 0~0.5중.** spec §7.6.1 의 "그래도 path-guard 는 Main 경유 I/O 만이라도 막는다" 의 *그 path-guard 가 dead*.

---

## 2. 발견된 wire 누락 사례 — 격차 별 정밀 보고

### G1 — `CliProvider._projectPath = '.'` + `setProjectPath` 호출자 0

**위치:**
- 정의: `src/main/providers/cli/cli-provider.ts:111` (default `'.'`), `:213-215` (setter), `:322` (사용)
- 호출 grep: `grep -rn "setProjectPath" src/` → **CliProvider 의 호출자 0** (MeetingSession 의 동명 method 만 매칭)

**현재 동작:**
```ts
private _projectPath = '.';   // line 111
// ...
setProjectPath(projectPath: string): void { this._projectPath = projectPath; }  // 호출자 0
// ...
cwd: this._projectPath,   // line 322 — '.' 그대로 spawn 에 전달
```

`'.'` 가 Node spawn 에 전달되면 `process.cwd()` 로 해석 = **앱 실행 위치**. 개발 시 `/mnt/d/Taniar/Documents/Git/Rolestra-r12c2-r2`, 배포 시 사용자가 앱 실행한 위치.

**사용자 가시 영향 (실제 dogfooding 보고):**
- 사용자가 ArenaRoot 안 `<arena>/projects/<slug>/` 만들고 회의 시작
- AI 가 "docs/messenger-mockup-tool-spec.md 읽기" 시도
- **rolestra source repo 의 `docs/` 가 dump** — 사용자가 의도한 프로젝트 폴더와 무관한 위치
- 사용자 mental model: "rolestra 폴더 안에 한정되어야 함" — 격차 100%

**spec 의도 vs 실제:**
- spec §7.6.2 정본: `execFile(cmd, args, { cwd: resolved.spawnCwd, ... })` 에서 `resolved = resolveProjectPaths(project)` 가 cwdPath = `<ArenaRoot>/projects/<slug>/` 또는 external link target.
- 실제: cwdPath 결정 함수 자체는 land 되어 있고 호출도 가능하지만 (`resolveProjectPaths` 가 `permission-service.ts` / `project-service.ts` / `project-handler.ts` 에서 호출됨), **그 결과를 CliProvider 에 전달하는 wire 가 없음**.

**보안 위험도:** high (사용자 신뢰성 + 데이터 무결성 둘 다 영향)

**Root cause:**
- 본 sample 은 *역사적 잔재*. R12-W T1~T10 의 PromptComposer wire-up 과 같은 종류의 "land 후 wire 잊음" 패턴.
- 회귀 테스트 없음 — CliProvider spawn 시 cwd 값을 검증하는 vitest 케이스가 없으면 호출자 0 인 method 가 영구 dead.

---

### G2 — `ssmCtx.projectPath: ''` 4 곳 하드코딩

**위치 4건:**
- `src/main/index.ts:612` — channel:start-meeting 분기 (handler 와 동등 경로)
- `src/main/index.ts:1221` — handoff:start-meeting-from-package buildSsmCtx
- `src/main/ipc/handlers/channel-handler.ts:350` — channel:start-meeting handler
- `src/main/queue/default-meeting-starter.ts:215` — 큐 자동 회의 시작

**Fallback factory 의 자체 인정:** `src/shared/ssm-context-types.ts:78` 의 `createDefaultSsmContext` 에 `projectPath: ''` default — *테스트용* 이라 주석되어 있지만 **production 4 곳이 같은 빈 문자열을 그대로 사용**. CLAUDE.md "silent fallback 금지" + spec 의 "R2-Task21 cleanup pending" 가 land 후 잊혀짐.

**현재 동작:**
```ts
// channel-handler.ts:350 등 4 곳
const ssmCtx = {
  meetingId, channelId, projectId: channel.projectId,
  projectPath: '',                       // ← 하드코딩
  permissionMode: 'hybrid' as const,     // ← 하드코딩 (G5)
  autonomyMode: 'manual' as const,       // ← 하드코딩 (G5)
};
```

빈 문자열이 SSM ctx 에 박혀서 PermissionService 가 발동되더라도 (G3 가 fix 된다면) `validateAccess(target, projectId)` 가 *projectId 는 있지만* `cwdPath` 가 비어서 *결국 isPathWithin 이 root='' vs candidate=...* 로 모든 path 거부 또는 모든 path 허용 (구현체에 따라). 한 마디로 *어느 쪽도 안전 아님*.

**사용자 가시 영향:**
- SSM 흐름이 *프로젝트 경로 자체를 모름* → meeting-turn-executor 가 PromptComposer 에 넘기는 시스템 프롬프트의 *프로젝트 폴더 문맥* 도 비어 있을 수 있음 (옛 buildPermissionRules 분기에서 `projectFolder: this.session.ssmCtx.projectPath || null` 가 항상 `null` 로 떨어짐 — `''` || null = null. **이게 R12-W 의 사용자 보고 자기검열의 직접 원인의 한 축**).
- handoff 흐름의 receiver 채널 회의도 동일.
- 큐 자동 회의도 동일.

**spec 의도 vs 실제:**
- spec §7.5 + R2 Task 12 정본: `SsmContext.projectPath` = `resolveProjectPaths(project).cwdPath` (절대 경로).
- 실제: `''` 하드코딩 4 곳 + R2-bridge sentinel 의 "Task21 cleanup pending" comment 가 4 phase 째 잊혀짐.

**보안 위험도:** high (R12-W 자기검열 사건의 한 축 + path-guard 발동 시에도 무력)

**Root cause:**
- R2 시점에 SsmContext 도입하면서 *모든 호출처에서 projectPath 채우는 단계* 까지 land 안 됨.
- 그 후 R5/R6/R7+ 가 ssmCtx 를 *그대로 받아쓰고* 빈 문자열을 통과시킴.
- 회귀 가드 없음 — `SsmContext.projectPath !== ''` 단언이 어디에도 없음.

---

### G3 — `PermissionService.resolveForCli` / `validateAccess` 호출자 0

**위치:**
- 정의: `src/main/files/permission-service.ts:167-281` (PermissionService 클래스 전체)
- 호출 grep: `grep -rn "resolveForCli\|validateAccess(" src/main/` (test/permission-service 제외) → **호출자 0**
  - 매칭은 전부 `permission-service.ts` 자기 정의, `project-service.ts` 의 *주석*, `permission-adapter.ts` 의 *주석*. 실제 call site 없음.

**현재 동작:**
- `PermissionService` 클래스 자체가 어디서도 *인스턴스화* 되지 않음. `new PermissionService(...)` 의 grep 결과 — production code 에 0건 (test 만).
- `isPathWithin` 도 외부 호출자 없음 (permission-service 내부 helper 외).
- 즉 **R2 Task 6 의 land 코드가 production runtime 에 한 번도 실행되지 않음**.

**사용자 가시 영향:**
- spec §7.6.1 의 "Main 경유 I/O 는 path-guard 가 막는다" 가 **0중 방어**.
- 단, 현재 시점에 main process 가 "AI 의 호출을 받아 fs 작업" 하는 path 자체가 제한적 (workspace-handler 의 init / status 등은 정상). 사용자 보고된 surface 는 *CLI 가 자기 spawn 내부에서 직접 fs 호출* 하는 경로 (spec §7.6.1 표 의 "CLI sandbox / 승인 플래그" 책임 영역).
- **그러나 G1+G2 fix 후에는 path-guard 가 *Main 경유 I/O* 의 마지막 방어선** — 그 마지막 방어선이 dead.

**spec 의도 vs 실제:**
- spec §7.6.4 정본: 모든 Main-routed I/O 가 `validateAccess(targetPath, projectId)` 경유.
- 실제: 호출자 0. land 후 wire 없음.

**보안 위험도:** critical (방어 layer 그 자체 부재)

**Root cause:**
- R2 Task 6 land 후 R3~R12 phase 모두 *각자의 도메인* (channels / meetings / approvals / queue ...) 만 신경 쓰고 path-guard 와의 wire 를 *체크하지 않음*.
- ExecutionService 는 `ensureAccess` 콜백 *훅* 을 가지지만 (line 42) — 그 콜백이 *PermissionService.validateAccess* 로 연결되어야 한다. 현재는 콜백 정의 자체가 *optional* 이고 콜백 미주입 시 검증 skip (line 94-95: `if (this.ensureAccess) { const allowed = await this.ensureAccess(...) }` → false 면 skip 가능). 콜백 부재 = silent passthrough. CLAUDE.md "silent fallback 금지" 위반.

---

### G4 — `setExecutionWorkspaceRoot` 호출자 0

**위치:**
- 정의: `src/main/ipc/handlers/execution-handler.ts:52-73`
- 호출 grep: `grep -rn "setExecutionWorkspaceRoot" src/` → 정의 + 주석만, **호출자 0**

**현재 동작:**
- `executionService: ExecutionService | null = null` 가 module-level (line 20) 에 선언만, 절대 set 되지 않음.
- `getExecutionService()` 가 호출되면 `throw new Error('ExecutionService not initialized')` (line 75-79).
- 즉 ExecutionService 의 모든 IPC 흐름 (submitPatchForReview / apply / rollback) 이 **production 에서 호출 시점 throw**.

**사용자 가시 영향:**
- ExecutionService 가 실제로 사용되는 path 는 dryRunPreview (`detailPreviewExecutionService` 별도 인스턴스, line 361) 에 한정 — 이건 line 361 에서 `new ExecutionService({workspaceRoot: arenaRoot.getPath()})` 정상 생성.
- 단 *AI 의 patch 적용* 흐름 (R12-W T9 의 ApprovalCard → execution-handler 의 apply 경로) 은 production 에서 throw.
- *현재 사용자가 이 흐름을 안 쓰는 것 같다* (R12-W T1~T10 dogfooding 에서 표면화 안 됨) — 즉 *기능 자체가 사용 안 되고 있음*. spec §7.7 의 "허가 / 거절 / 조건부 허가" UX 가 land 되어 있으나 실제 적용 path 가 throw 라는 것은 R12-Y (별도 audit 필요) 의 의심 사항.

**spec 의도 vs 실제:**
- spec C3 (cross-cutting) + spec §7.7 정본: ExecutionService 가 단일 경계 — dryRun → 승인 → atomic apply → rollback.
- 실제: 인스턴스화 자체 X. `detailPreviewExecutionService` 는 *Approval detail panel 의 dryRun preview 만* 담당 (line 355-364 주석 명시), 실제 적용 경로 X.

**보안 위험도:** medium (사용자가 이 path 를 실제로 호출하면 throw → 사용자 가시 에러. silent 는 아님 — 적어도 silent fallback 위반 X)

**Root cause:**
- `setExecutionWorkspaceRoot` 호출 위치 = boot 시 또는 workspace init 시. 두 위치 모두 미 wire.
- workspace-handler 가 *init 시* 호출할 의도였을 가능성 — comment line 40-43 ("Called once at boot by `main/index.ts`. Subsequent workspace init IPC calls pick it up automatically without re-threading the reference through the workspace-handler call chain.") 가 자체 인정하지만 *그 wire 자체가 누락*.

---

### G5 — `permissionMode: 'hybrid'` / `autonomyMode: 'manual'` 하드코딩

**위치 (G2 와 같은 4건):**
- `src/main/index.ts:613-614` — `'hybrid' as const, 'manual' as const`
- `src/main/index.ts:1222-1223` — handoff buildSsmCtx
- `src/main/ipc/handlers/channel-handler.ts` — channel:start-meeting (line 350 의 4-key 객체 안)
- `src/main/queue/default-meeting-starter.ts:215` 부근

`index.ts:1204-1206` 의 comment 가 자체 인정:
> "channel:start-meeting (channel-handler) 의 동일한 형식 — projectPath 빈 문자열 + permissionMode 'hybrid' + autonomyMode 'manual' (해당 channel / project 의 더 정확한 값으로 boot 시점 갱신은 기존 channel-handler 와 동일)."

즉 "더 정확한 값으로 갱신" 이 *예고* 만 되어 있고 *land 안 됨*.

**현재 동작:**
- 사용자가 ProjectService.updatePermissionMode (R7+R10 D5 의 mode_transition approval 흐름) 로 *프로젝트 mode 를 `auto` 로 바꿔도* SSM 에는 `'hybrid'` 가 박힘.
- AutonomyGate 의 자동 결재 정책 분기가 *사용자가 끈 manual* 이 아니라 *코드 하드코딩 manual* 로 동작.

**사용자 가시 영향:**
- 사용자가 설정한 mode 가 무력화. CLI argv 는 PermissionFlagBuilder 가 *별도로 project.permissionMode* 를 읽을 가능성 — 그러나 SSM 의 PromptComposer / AutonomyGate / ApprovalService 분기는 `ssmCtx.permissionMode` 를 신뢰. 즉 *layer 별로 다른 mode* 가 회의 흐름에 공존.
- R10 D5 의 mode_transition approval 흐름 자체가 *DB 는 정확히 갱신* 하지만 *SSM 은 옛 hardcoded 값* 사용.

**보안 위험도:** medium (사용자 설정 무력화, 보안 정책 일관성 부재)

**Root cause:**
- G2 와 동일 — R2 bridge sentinel 의 "Task21 cleanup pending" 가 4 phase 째 잊혀짐.

---

### G6 — `MeetingSession.setProjectPath` 호출자 0 (dead method)

**위치:**
- 정의: `src/main/meetings/engine/meeting-session.ts:290-292`
- 호출 grep: → **호출자 0**

CliProvider 와 동일 패턴 — setter 정의만 있고 호출자 없음. G2 의 빈 문자열 ssmCtx 와 결합되어 *동기화 흐름 자체 부재*.

**보안 위험도:** medium (G2 의 대안 경로일 수 있었으나 사용 안 됨)

---

### G7 — `ExecutionService.ensureAccess` 콜백 silent passthrough

**위치:**
- 콜백 정의: `src/main/execution/execution-service.ts:42-66` — `ensureAccess?: (aiId, action, targetPath, conversationId?) => Promise<boolean>` *optional*
- 콜백 미주입 시 동작: line 94-95 `if (this.ensureAccess) { ... }` — undefined 면 *검증 자체 skip*

**현재 동작:**
- `detailPreviewExecutionService` (line 361-363) — `ensureAccess` 옵션 *미전달*. dryRun preview 가 *path-guard 없이* fs 읽기 가능.
- `setExecutionWorkspaceRoot` (line 52-66) — `ensureAccess` 가 *optional*, 호출자 0 이므로 무관하지만 fix 후에도 *호출자가 ensureAccess 전달 안 하면* silent passthrough.

**CLAUDE.md 위반:** "사일런트 폴백 금지 — 누락 시 명시적이고 큰 에러로". ensureAccess 미주입 시 *throw* 여야 하나 *skip*.

**보안 위험도:** medium (silent 가 핵심 — 사용자가 "검증 발동" 으로 믿지만 실제는 skip)

---

## 3. 격차 요약 표

| ID | 위치 | 현재 | spec 의도 | 위험도 (보안) | 위험도 (mental model) | dogfooding 표면화 |
|----|------|------|-----------|---------------|------------------------|-------------------|
| G1 | `cli-provider.ts:111,213,322` | `_projectPath='.'` + setter 호출자 0 | spawn cwd = `resolveProjectPaths(project).cwdPath` | high | high | **표면화 (사용자 보고)** |
| G2 | index.ts:612, :1221, channel-handler.ts:350, default-meeting-starter.ts:215 | `projectPath:''` 4 곳 하드코딩 | `SsmContext.projectPath = cwdPath` | high | high | 간접 (G1 과 결합) |
| G3 | `permission-service.ts:167-281` | 호출자 0 (인스턴스화 자체 X) | Main-routed I/O 전부 validateAccess 경유 | critical | low | 미표면 (현재 호출 path 자체 없음) |
| G4 | `execution-handler.ts:52-73` | `setExecutionWorkspaceRoot` 호출자 0, singleton null | boot 시 init | medium | medium | 미표면 (apply path 실제 사용 X) |
| G5 | index.ts:613, :1222, channel-handler.ts:351, default-meeting-starter.ts | `'hybrid'`/`'manual'` 하드코딩 | project.permissionMode/autonomyMode 동기화 | medium | high | 미표면 (mode `auto` 설정해도 SSM 은 `hybrid` 그대로) |
| G6 | `meeting-session.ts:290-292` | setter 호출자 0 | G2 의 동기화 경로 | medium | medium | 미표면 |
| G7 | `execution-service.ts:42, 94-95` | ensureAccess optional + 미주입 시 silent skip | 미주입 = throw | medium | medium | 미표면 |

---

## 4. Root cause 패턴 (왜 이렇게 land 후 끊어졌나)

본 audit 의 7 격차 중 6건이 *동일 패턴*:

**패턴 = "land 단계 책임자가 wire 단계 책임자에게 인계 안 함".**

- R2 Task 6 (PathGuard) — 본인 코드 land 됨, *호출자 wire 는 후속 phase 의 책임*
- R2 Task 12 (SsmContext) — `projectPath` field 만 정의, *채우는 책임은 호출처 (channel:start-meeting / queue)* 에 인계
- R7 / R10 / R12-S / R12-C — 각자의 도메인 진행 시 ssmCtx 를 *그대로 받아씀*. 빈 문자열을 *문제 신호로 인식 안 함*

**왜 회귀 가드가 안 잡았나:**

1. **type 시스템 가드 부재** — `projectPath: string` 이라 빈 문자열도 valid. brand type (`AbsolutePath`) 도입 안 됨.
2. **runtime invariant 가드 부재** — `SsmContext` 생성자 / constructor 에 `if (projectPath === '')` throw 없음. 빈 문자열이 silent 통과.
3. **integration test 부재** — vitest 가 *각 서비스 단위* 만 검증. "channel:start-meeting → MeetingSession → CliProvider 의 spawn cwd 가 ArenaRoot 안" 같은 *layer 통과 단언* 없음.
4. **E2E test 부재** — Playwright 가 *UI 흐름* 검증, *spawn argv / cwd 캡처* 까지는 안 함.
5. **dead-code 검출 부재** — `setProjectPath` 가 호출자 0 인데 ESLint `no-unused-private-class-members` 또는 `tsc --noUnusedLocals` 가 *public method* 라 못 잡음.

**구조적 결론:**
- R2~R12 의 각 phase 가 *자기 domain* 만 책임지는 plan 형식 — *cross-cutting wire* 가 누구의 phase 책임도 아닌 영역.
- ADR cross-cutting C3 / C6 가 *invariant 만 선언* 하고 *그 invariant 의 회귀 가드는 명시 안 함*.

---

## 5. 사용자 보고 시나리오 재구성

사용자 dogfooding 보고를 격차 chain 으로 재구성:

```
[사용자 행동]
  새 프로젝트 (ArenaRoot 안) + 할 일 큐로 "아이디어 부서" 회의 시작
  AI 에게 "docs/messenger-mockup-tool-spec.md 읽고 의견" 요청
       ↓
[큐 → 회의 시작 흐름]
  default-meeting-starter.ts:215 — projectPath:'' 하드코딩 (G2)
       ↓
[SSM 생성]
  ssmCtx.projectPath = ''  (G2)
  ssmCtx.permissionMode = 'hybrid' 하드코딩 (G5 — 사용자의 project.permissionMode 무시)
       ↓
[MeetingTurnExecutor.runPhaseTurn]
  CliProvider.streamCompletion 호출 (T9 land 후 PromptComposer 합성)
       ↓
[CLI spawn 직전]
  CliProvider._projectPath = '.'  (G1 — setProjectPath 호출자 0)
  execFile(..., { cwd: '.' })   → process.cwd() = 앱 실행 위치
       ↓
[Claude CLI 실행]
  cwd = /mnt/d/.../Rolestra-r12c2-r2 (rolestra source repo)
  AI: "docs/" 읽기 시도 → CLI 가 cwd 의 docs/ list dump
       ↓
[사용자 가시 결과]
  AI 가 사용자 의도 프로젝트 폴더와 무관한 rolestra source repo 의 docs/ 응답
  사용자: "rolestra 폴더 안에 한정되어야 하는데"  ← spec §7.6 정본 위반
```

핵심 격차 결합:
- **G1** 이 *근본 원인* (cwd 결정 누락)
- **G2** 가 *방어 실패의 원인* — SSM 에서 cwd 가 비어 있어 PromptComposer 가 *프로젝트 폴더 안내 단락도 빈 문자열* 로 합성. AI 의 "polder 경로 인식" 도 못 함.
- **G3** 이 *마지막 방어선 부재* — PermissionService.validateAccess 가 발동했다면 path-guard 가 cwd='.' spawn 자체를 throw.

**G1+G2+G3 셋 다 fix 필요.** 하나만 고치면 다른 격차 surface.

---

## 6. 보안 위험도 분리 (다시 강조)

| 분류 | 격차 | 위험 |
|------|------|------|
| **실제 보안** (악의적 격리) | G1~G7 전부 | **low** — Rolestra 는 사용자가 *자기 AI 에게 자기 PC 권한 위임*. AI 가 CLI sandbox 를 *바이패스* 하는 사례 아님. CLI 자체의 sandbox 가 layer 0. |
| **사용자 신뢰성** (mental model) | G1, G2, G5 | **high** — 사용자가 설정한 폴더가 아닌 다른 폴더가 노출. 사용자가 "여기서 작업한다" 고 믿는 mental model 위반. |
| **데이터 무결성** (실수 / 사고) | G1+G7 | **medium** — 현재 read-only argv 라 쓰기 사고 X. R12-W T11+ filter 가 land 되기 전 mode `auto` 면 **high** (사용자가 다른 폴더에 의도치 않은 쓰기). |
| **방어 layer 존재 자체** | G3, G4 | **critical** (설계 의도와의 격차) — spec §7.6 이 land 라고 가정한 모든 후속 ADR (C3 / C6) 가 *허구* 위에 서 있음. |

---

## 7. R12-W T1~T10 와 본 audit 의 관계

**T9 land 와 본 root cause 는 무관.** T9 가 추가한:
- `channelService.get(meeting.channelId)` 의 ChannelNotFoundError throw
- `session.channelRole` wire 를 ChannelRole 로 활용
- PromptComposer 합성 경로 (옛 buildPermissionRules 폐기)

이 셋은 *모두 메시지 시스템 + 페르소나 합성* 영역 — *CLI spawn cwd* 영역과 직교. 그러나:

**R12-W T1~T10 의 가시 효과는 G1+G2 가 fix 안 된 채로는 *불완전*.**

- T9 의 PromptComposer 가 "권한: 파일 읽기" 안내를 합성해도 — AI 가 *어느 폴더를 읽어야 할지* 모름 (G2 의 projectPath='' 가 PromptComposer 입력으로 들어감).
- T11+ 의 argv filter 가 `--allowedTools Read,Glob,Grep` 으로 좁혀도 — *cwd 가 잘못된 폴더* 면 잘못된 폴더의 파일을 read.
- T19 의 E2E 가 "권한: 파일 읽기" persona 존재 단언 GREEN — *그러나 실제 사용자 효과는 의도와 정반대* (rolestra source repo 가 노출).

즉 **R12-W 의 land 가 *대대적인 성공 신호* 를 줄 수 있는데 사용자 가시 효과는 부분적**.

---

## 8. fix 우선순위 + plan 옵션 비교

### 옵션 A — R12-W 안에 흡수 (T22+T23 추가)

**구조:**
- T22 = G1+G2+G5+G6 wire (projectPath / permissionMode / autonomyMode 동기화)
- T23 = G3+G4+G7 wire (PathGuard / ExecutionService 인스턴스화 + ensureAccess 명시 throw)
- T11+ (argv filter) 가 T22 후에 진행 (T22 가 *입력 source* 의 정확성 보장)

**Trade-off:**
- (+) commit history 정합 — R12-W 의 "권한 시스템 wire" 라는 동일 도메인 안에서 *도구 권한 + 경로 봉인* 통합. dogfooding 검증도 1 회차로 끝남.
- (+) 사용자 mental model — "권한" 이 하나의 phase 에서 land.
- (−) plan 분량 증가 — T1~T21 → T1~T23 (실제로는 T22 가 G1/G2/G5/G6 4 격차라 더 큰 묶음).
- (−) R12-W 의 *완료 신호* 가 늦어짐.

### 옵션 B — R12-X 로 분리

**구조:**
- R12-W 그대로 T11~T21 진행 (T11 진입 전 G1+G2 만 hotfix — argv filter 의 효과 보장 위해)
- R12-X 신설: PathGuard wire-up 전면 (G1~G7 통합)
- ADR 신규: `docs/decisions/r12-x-pathguard-wire-up.md`

**Trade-off:**
- (+) 책임 분리 명확 — R12-W = 도구 권한 (어느 도구를 쓰나), R12-X = 경로 봉인 (어느 폴더에서 쓰나).
- (+) commit history 추적성 — git log 에 "R12-X PathGuard wire-up" 단위 묶음.
- (+) dogfooding 검증 회차 분리 — R12-W 완료 후 사용자 검증 → R12-X 진행.
- (−) R12-W T11+ 가 G1+G2 hotfix 의존 — *완전 분리* 가 안 됨. G1+G2 만이라도 R12-W 안에 흡수 필요.
- (−) 사용자 mental model — "왜 두 phase 인가" 설명 필요.

### 옵션 C — Hotfix 단독 + R12-X 정식 분리

**구조:**
- **즉시 hotfix** — G1+G2 만 (사용자 보고 정확한 surface 해결)
- R12-W T11~T21 정상 진행
- R12-X 신설 — G3+G4+G5+G6+G7 통합 (구조적 봉인)

**Trade-off:**
- (+) 사용자 가시 격차 (G1+G2) 즉시 해결.
- (+) R12-W 의 페르소나/도구 권한 흐름과 G3/G4 의 PathGuard 구조 분리.
- (−) 3 단계 phase (hotfix → R12-W 잔여 → R12-X) — commit history 가 분기.

### 추천: 옵션 B 변형 — "G1+G2 만 R12-W 안 hotfix + R12-X 정식 분리"

**근거:**
1. **G1+G2 는 사용자 가시 critical** — R12-W T11~T21 의 효과 보장 위해 *T11 진입 전 즉시 fix*. 1 commit 단위 (Setter wire + ssmCtx.projectPath 채움 + permissionMode/autonomyMode 동기화). 약 5~10 파일, ~200 LoC.
2. **G3+G4+G7 는 구조적 봉인** — *PathGuard 인스턴스화 + ExecutionService 인스턴스화 + ensureAccess 명시 throw*. 별도 ADR + dedicated plan + 회귀 가드 (integration test + invariant 가드) 추가가 필요한 규모.
3. **G5 는 G2 와 동일 행** — G1+G2 hotfix 안에 함께 처리 (4 곳의 하드코딩 한 번에).
4. **G6 는 dead-code 정리** — G1+G2 hotfix 후 자연 정리 (MeetingSession.setProjectPath 도 호출 path 가 생기거나, 또는 G2 가 ssmCtx 로 충분히 해결하면 setter 제거).

**phase 구조:**
- **R12-W (in-flight)** + hotfix block: G1+G2+G5 (3 격차 동시) — T11 진입 전 — *plan 본문 T11 앞에 T10.5 sub-block 추가*
- **R12-X (신규)**: G3+G4+G6+G7 + 회귀 가드 (integration test + brand type `AbsolutePath` 도입) — 별도 ADR + plan

---

## 9. 사용자 결재 포인트 (audit 결과 보고 후 결재 필요)

| # | 결재 항목 | 추천 |
|---|----------|------|
| **Q1** | 전체 fix 묶음 | 옵션 B 변형 — R12-W hotfix block (G1+G2+G5) + R12-X 정식 분리 (G3+G4+G6+G7) |
| **Q2** | hotfix 우선순위 | G1+G2+G5 즉시 (T11 진입 전 의무) |
| **Q3** | R12-W T11+ 진행 시점 | hotfix block land + 사용자 dogfooding 검증 후 |
| **Q4** | R12-X 진행 시점 | R12-W 종결 후 |
| **Q5** | R12-X 에 *brand type* / *integration test* / *invariant 가드* 셋 다 포함? | 권장 — 본 audit 의 root cause 패턴 (회귀 가드 부재) 재발 방지 |

---

## 10. 다음 산출물 (사용자 결재 후)

본 audit 결과 결재 후:
- **R12-W plan 보정** — T10.5 sub-block 추가 (G1+G2+G5 hotfix). 영향 파일 / 신규 파일 / verify 명령 / acceptance 명세.
- **`docs/decisions/r12-x-pathguard-wire-up.md` 초안** — G3+G4+G6+G7 + 회귀 가드.
- **`docs/plans/2026-05-12-rolestra-r12-x-pathguard-wire-up.md` 초안** — T1~T? 분해.

본 audit 단계는 *보고서* 만. 코드 0 수정.

---

## 부록 — grep 검증 명령어 (재현 가능)

```bash
# G1
grep -rn "setProjectPath\|_projectPath\|this\\.projectPath\\b" src/  
# → CliProvider.setProjectPath 호출자 0 확인

# G2 + G5
grep -rn "ssmCtx\\.projectPath\|projectPath:\\s*''" src/  | grep -v __tests__
# → 4 곳 하드코딩 확인

# G3
grep -rn "resolveForCli\|validateAccess(" src/main/ | grep -v __tests__ | grep -v permission-service.ts
# → 호출자 0 (주석만 매칭)

# G4
grep -rn "setExecutionWorkspaceRoot" src/  | grep -v __tests__
# → 호출자 0 (정의만)

# G6
grep -n "setProjectPath" src/main/meetings/engine/meeting-session.ts
# → 정의 line 290-292, 호출자 0

# G7
grep -n "ensureAccess" src/main/execution/execution-service.ts
# → optional callback + silent skip when undefined
```

본 grep 결과는 audit 시점 (2026-05-12) 기준. 본 보고서 land 후 코드 수정 발생 시 grep 결과 변경 — 다음 audit 재실행 권장.
