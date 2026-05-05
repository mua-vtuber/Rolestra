# Rolestra Phase R4 — Dashboard + Project Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** R3에서 세워진 Shell + 6 테마 디자인 시스템 위에 **첫 진입 화면인 대시보드**와 **프로젝트 생성/외부 연결/가져오기** UX를 완성한다. Main 레이어는 R2에서 이미 모든 서비스(`ProjectService` / `ArenaRootService` / `ApprovalService` / `MeetingService` / `MemberProfileService` / junction helpers)가 구축돼 있으므로 R4는 **(a) KPI 집계 전용 신규 서비스 1개 + (b) Renderer 전체 스택**이 핵심이다. R4 종료 시 앱을 처음 띄웠을 때 Hero 4 KPI + 비대칭 2x2 그리드 + Insight 띠 + 프로젝트 생성 모달이 6 테마 전부에서 정상 동작하고, Playwright Electron E2E로 "외부 폴더 연결 → 대시보드 이동" 시나리오를 증빙한다.

**Overview (자연어, 비코더용):**

- R3까지 앱을 실행하면 "R4에서 대시보드가 여기에 들어옵니다"라는 placeholder가 뜨는 상태다. R4에서는 이 placeholder 자리를 **실제 대시보드 화면**이 차지하고, 좌측 ProjectRail에서 프로젝트를 선택하거나 새 프로젝트를 만들 수 있게 한다.
- 대시보드에 표시되는 숫자(활성 프로젝트 N / 진행 회의 N / 승인 대기 N / 오늘 완료 N)는 **DB에서 그때그때 계산**한다. 실시간 스트림 갱신은 R6 이후 — R4에서는 화면 진입·활성 프로젝트 전환·모달 닫힘 시점에만 다시 읽는다.
- 프로젝트 생성 모달은 3 종류(신규/외부 연결/가져오기)를 **하나의 Radix Dialog**에서 탭/라디오로 전환한다. 외부 연결을 고르면 폴더 선택 다이얼로그가 뜨고, **permission_mode='auto'는 선택지 자체가 비활성**(spec §7.3 CA-1). 서버(Main) 측 validation은 R2에서 이미 걸려 있지만, 렌더러가 애초에 보내지 않도록 **양쪽에서 방어**한다.
- 외부 연결은 Windows에서는 junction(mklink /J), macOS/Linux에서는 symlink로 `<ArenaRoot>/projects/<slug>/link → <외부경로>`를 만든다. R2에서 `createLink/resolveLink`가 이미 구현돼 있고, 프로젝트 생성 시 realpath 재검증(TOCTOU — spec §7.6 CA-3)도 들어가 있으므로 R4는 **그 결과를 UI에 연결만** 한다. 추가 테스트 보강은 필요 시에만.
- 활성 프로젝트는 Renderer 로컬 상태(zustand persist)로 관리한다. ProjectRail에서 프로젝트를 클릭하면 `project:open` IPC 호출 후 활성 상태로 세팅. 대시보드의 일부 KPI(오늘 완료)는 활성 프로젝트 scope와 무관한 전역 값이지만, Hero 아래 빠른 액션의 "회의 소집"은 활성 프로젝트 없이 비활성 처리한다.
- spec 문서 §7.3 / §7.5 / §10 R4 체크박스는 **Task 0에서 먼저 점검**한다 — 구현 중 발견되는 모호함은 반드시 spec을 먼저 갱신한 뒤 코드를 고친다. 문서 리드 원칙.
- R4는 **기존 legacy IPC 경고를 유지**한다(제거는 R11). 새 Renderer 코드는 legacy 채널을 호출하면 안 되고, R3에서 세운 `legacy-channel-isolation.test.ts`가 이 경계를 계속 지킨다.

**Architecture:**

- Layering: `renderer → shared → preload(contextBridge) → main`. R3 구조 그대로.
- Main 신규: `DashboardService` (단일 책임 — 4 KPI를 **하나의 IPC 호출**로 집계) + `dashboard:*` IPC 핸들러 1개. KPI 4개를 각각 따로 호출해 N+1을 만들지 않는다. 기존 `ProjectRepository` / `MeetingRepository` / `ApprovalRepository`를 직접 읽는 thin aggregator.
- Main 재사용(신규 서비스/핸들러 **없음**): `ProjectService.create/update/archive/open/list`, `ArenaRootService.getPath()`, `junction.createLink/resolveLink`, 기존 `project:*` 8개 채널, 기존 `arena-root:*` 채널.
- Renderer 신규: `src/renderer/ipc/` typed wrapper(`window.arena.invoke` 얇게 감쌈) + `hooks/` 3종(`useDashboardKpis`, `useProjects`, `useActiveProject`) + `features/dashboard/` 페이지/위젯 + `features/projects/` 생성 모달 + `stores/active-project-store.ts`(zustand persist).
- Styling: R3 tailwind token 체계 그대로. 대시보드 진행률 게이지 3종(warm/tactical/retro)은 **토큰의 `gaugeStyle`(R3에서 schema에 있음) 분기**로 선택하되, 시각적 디테일은 각 컴포넌트 내부 Tailwind + cva variant로 표현. 하드코딩 색·간격 금지.
- State flow: ProjectRail 클릭 → `project:open` IPC → active-project-store 갱신 → Dashboard가 store를 subscribe해 재마운트(필요 시) → `dashboard:get-kpis` 호출. 모달 제출 성공 → `project:create|link-external|import` → useProjects refetch → active-project 자동 설정(옵션).
- Testing: Vitest jsdom (단위 + 훅 + 모달 컴포넌트), Playwright `_electron` 모드 E2E 1 시나리오.

**Tech Stack (R4 추가):**

- 기존(R3까지): TypeScript strict / React 19 / Electron 40 / Vite / Vitest (jsdom) / i18next / zod / zustand / Tailwind / Radix(slot/tooltip/separator) / framer-motion / cva / clsx
- 신규: `@radix-ui/react-dialog` (프로젝트 생성 모달), `@radix-ui/react-radio-group` (생성 타입 3종 선택), `@playwright/test` (dev 의존성, Electron E2E 전용)

**참조:**

- Spec: `docs/specs/2026-04-18-rolestra-design.md` §5.1, §5.2(projects / project_members / approval_items / meetings), §6(project:* 채널), §7.3, §7.5, §7.10, §10 Phase R4
- R3 plan: `docs/plans/2026-04-20-rolestra-phase-r3.md` (디자인 시스템 토큰/컴포넌트 관례)
- 시안 정본: `docs/Rolestra_sample/01-Dashboard.html`, `docs/Rolestra_sample/01-dash-variants.jsx` (6 변형 Hero / 그리드 / Insight), `docs/Rolestra_sample/theme-tokens.jsx` (gauge 토큰)
- Main 재사용 모듈:
  - `src/main/projects/project-service.ts` — 3 kind 생성 + external+auto 거부 + junction TOCTOU + 소프트 아카이브
  - `src/main/projects/junction.ts` — createLink / resolveLink / removeLink (Windows junction + POSIX symlink)
  - `src/main/projects/__tests__/junction.test.ts` — R2에서 작성됨
  - `src/main/arena/arena-root-service.ts` — ArenaRoot 경로 정본
  - `src/main/approvals/approval-service.ts`, `src/main/meetings/meeting-service.ts` — KPI 집계용 repository 접근 경로
  - `src/main/ipc/handlers/project-handler.ts`, `arena-root-handler.ts` — 기존 IPC 접점
- IPC 타입: `src/shared/ipc-types.ts` (IpcChannelMap), `src/shared/ipc-schemas.ts` (zod)
- R3 shell 컴포넌트 (wiring 대상): `src/renderer/components/shell/{Shell,NavRail,ProjectRail,ShellTopBar}.tsx`

---

## Prereqs

- [x] R3 전체 완료(12/12) + main ff-merge (2026-04-20)
- [x] spec §5.1 / §5.2 / §7.3 / §7.5 / §7.10 정본 상태 확인
- [x] Main 레이어 ProjectService / junction / ApprovalService / MeetingService 실사용 가능 상태(R2 Task 21 포함)
- [ ] `rolestra-phase-r4` 브랜치 `main`에서 생성 (Task 0 첫 step)

---

## File Structure (R4 종료 시)

```
docs/
  superpowers/
    plans/
      2026-04-20-rolestra-phase-r4.md                  # 본 문서
      2026-04-20-rolestra-phase-r4.md.tasks.json
    specs/
      2026-04-18-rolestra-design.md                    # §7.3 / §7.5 / §10 R4 갱신
      appendix-r4-evidence/                            # E2E 스크린샷 + 수동 캡처
        dashboard-warm-light.png
        external-link-flow.mp4 (선택)
      r4-done-checklist.md                             # Task 13 산출물

src/
  main/
    dashboard/                                         # 신규
      __tests__/
        dashboard-service.test.ts
      dashboard-service.ts                             # 4 KPI 단일 집계
    ipc/handlers/
      dashboard-handler.ts                             # 신규 (신규 1 채널)
      # project-handler.ts / arena-root-handler.ts — 수정 없음
  shared/
    dashboard-types.ts                                 # 신규 (KpiSnapshot)
    ipc-types.ts                                       # 'dashboard:get-kpis' 추가
    ipc-schemas.ts                                     # zod schema 추가
  preload/
    index.ts                                           # 변경 없음 (whitelist는 기존 패턴)
  renderer/
    ipc/                                               # 신규
      invoke.ts                                        # typedInvoke wrapper (renderer 측)
      __tests__/invoke.test.ts
    hooks/                                             # 신규
      use-dashboard-kpis.ts
      use-projects.ts
      use-active-project.ts
      __tests__/
        use-dashboard-kpis.test.tsx
        use-projects.test.tsx
        use-active-project.test.tsx
    stores/                                            # 신규
      active-project-store.ts
      __tests__/active-project-store.test.ts
    features/                                          # 신규 (도메인 단위 그룹)
      dashboard/
        DashboardPage.tsx                              # Hero + 비대칭 그리드 + Insight
        HeroKpiTile.tsx
        HeroQuickActions.tsx
        widgets/
          TasksWidget.tsx                              # 📋 업무
          PeopleWidget.tsx                             # 👥 직원
          RecentWidget.tsx                             # 💬 최근 대화
          ApprovalsWidget.tsx                          # 🔔 결재 (2-row span)
        ProgressGauge.tsx                              # warm/tactical/retro 3 variant
        InsightStrip.tsx
        __tests__/
          DashboardPage.test.tsx
          HeroKpiTile.test.tsx
          ProgressGauge.test.tsx
          ApprovalsWidget.test.tsx
      projects/
        ProjectCreateModal.tsx                         # Radix Dialog 3 kinds
        ProjectKindTabs.tsx                            # new / external / imported
        ExternalPathPicker.tsx                         # showOpenDialog → IPC
        ProjectPermissionRadio.tsx                     # auto 비활성 규칙
        __tests__/
          ProjectCreateModal.test.tsx
          ProjectPermissionRadio.test.tsx
    components/
      shell/
        ProjectRail.tsx                                # 활성 전환 props 확장 + + 버튼 slot
        ShellTopBar.tsx                                # 활성 프로젝트 이름 표시 슬롯 확장
    App.tsx                                            # Shell + <DashboardPage /> (placeholder 제거)
    i18n/locales/
      ko.json, en.json                                 # dashboard.* / project.* populate

e2e/                                                   # 신규 (루트)
  playwright.config.ts
  electron-launch.ts                                   # _electron.launch 헬퍼
  fixtures/
    external-sample/                                   # 더미 외부 폴더
      README.md
  external-project-flow.spec.ts                        # Task 12 시나리오
```

**루트 변경점 요약:**

- `package.json` dependencies 추가: `@radix-ui/react-dialog`, `@radix-ui/react-radio-group`
- `package.json` devDependencies 추가: `@playwright/test`
- `package.json` scripts 추가: `"e2e": "playwright test"`, `"e2e:install": "playwright install chromium"` (Electron mode는 별도 브라우저 불필요하지만 Playwright 공통 툴체인 의존)
- `tsconfig.node.json` / `tsconfig.web.json`: `e2e/**` 경로는 별도 tsconfig로 분리하거나 node tsconfig에 포함
- `vitest.config.ts` exclude: `e2e/**` 추가 (Playwright 파일이 Vitest에 잡히지 않도록)
- `eslint`: `e2e/**`에 대한 i18next 룰 off (UI 문자열 아님)

---

## Task 0: 브랜치 분기 + spec §7.3 / §7.5 / §10 R4 점검

**Goal:** R4 작업용 브랜치를 파고, 현재 spec의 §7.3(프로젝트 생성 3종 + external+auto 금지 + TOCTOU) / §7.5(Hero 4 KPI + 비대칭 2x2 + Insight + 게이지 테마 분기) / §10 Phase R4 체크박스가 R4 구현 범위와 일치하는지 한 번 걸러낸다. 구현 착수 전에 spec 문구상 모호한 점을 잡아 문서를 먼저 손본다(문서 리드 원칙).

**Files:**

- New branch: `rolestra-phase-r4` (from `main`)
- Modify (발견되는 경우만): `docs/specs/2026-04-18-rolestra-design.md` §10 Phase R4 블록 — 체크박스 리스트 + 산출물 필드 템플릿으로 확장(R3 §10 포맷과 동일 구조)
- Create: 없음

**Acceptance Criteria:**

- [ ] `rolestra-phase-r4` 브랜치 생성 + origin 푸시(아직 비어 있어도 무방)
- [ ] §7.5 KPI 데이터 소스 표 4행(activeProjects/activeMeetings/pendingApprovals/completedToday)이 본 plan의 `DashboardService` 집계 로직과 1:1 일치
- [ ] §7.3 생성 모달 ASCII mockup이 본 plan Task 9 모달 구조와 일치 — 불일치 시 spec을 우선 갱신
- [ ] §10 Phase R4 블록이 R3과 동일한 "체크박스 + 산출물 링크" 템플릿으로 확장됨 (빈 칸은 Task 13에서 채움)
- [ ] Legacy IPC 경고 제거 시점이 R11임을 재확인(본 plan에서 변경 없음)

**Verify:**

- `git rev-parse --abbrev-ref HEAD` == `rolestra-phase-r4`
- `git diff main...HEAD -- docs/specs/2026-04-18-rolestra-design.md` 에서 §10 Phase R4만 변경(있다면)

---

## Task 1: Shared types + IpcChannelMap 확장 (`dashboard:*`)

**Goal:** Renderer가 호출할 `dashboard:get-kpis` 채널을 **먼저** 선언한다. zod schema도 동시에 추가. Main 핸들러/Service 없이도 renderer 코드가 컴파일되도록 타입 계약을 먼저 확정.

**Files:**

- Create: `src/shared/dashboard-types.ts`
  - `export interface KpiSnapshot { activeProjects: number; activeMeetings: number; pendingApprovals: number; completedToday: number; asOf: number /* epoch ms */ }`
  - `export interface DashboardGetKpisInput { projectId?: string | null /* reserved for R6+ project scope — R4는 global만 */ }`
- Modify: `src/shared/ipc-types.ts`
  - `IpcChannelMap`에 `'dashboard:get-kpis': { request: DashboardGetKpisInput; response: { snapshot: KpiSnapshot } }` 추가
- Modify: `src/shared/ipc-schemas.ts`
  - `dashboardGetKpisSchema` zod 추가 + V3_CHANNEL_SCHEMAS 맵에 등록
- Create: `src/shared/__tests__/dashboard-types.test.ts` — KpiSnapshot 기본 값 타입 가드 snapshot

**Acceptance Criteria:**

- [ ] `dashboard:get-kpis` 키가 `IpcChannelMap` 리터럴에 존재 + response가 `{ snapshot: KpiSnapshot }`
- [ ] zod schema가 `projectId` optional+nullable을 정확히 허용
- [ ] `npm run typecheck` 0 errors (아직 구현 없음 → renderer/main이 이 채널을 호출하지 않으므로 OK)
- [ ] `src/shared/__tests__/ipc-schemas-v3.test.ts`의 channel set 검증 테스트가 통과(신규 채널 자동 인식)

**Verify:**

- `npm run typecheck` → exit 0
- `npm run test -- ipc-schemas-v3` → pass

**명시적 비범위:**

- `dashboard:subscribe` 스트림 채널은 R6 이후. R4는 polling 한 번씩만.

---

## Task 2: Main — `DashboardService` + IPC 핸들러

**Goal:** 4 KPI를 **단일 SQL 호출 세트**로 집계하는 서비스 + IPC wrapper. N+1 방지. 모든 집계 쿼리는 기존 repository 경유(raw SQL을 service에서 쓰지 않음).

**Files:**

- Create: `src/main/dashboard/dashboard-service.ts`
  - `class DashboardService { constructor(private projectRepo, private meetingRepo, private approvalRepo) {} async getKpis(): Promise<KpiSnapshot> }`
  - 구현:
    - `activeProjects = projectRepo.countByStatus('active')`
    - `activeMeetings = meetingRepo.countActive()` (state NOT IN done/failed/aborted)
    - `pendingApprovals = approvalRepo.countByStatus('pending')`
    - `completedToday = meetingRepo.countCompletedSince(startOfToday())`
    - `asOf = Date.now()`
  - `startOfToday()`은 **앱 로컬 타임존**(TZ ENV 또는 Intl.DateTimeFormat) 기준. DST 엣지 케이스 주석.
- Modify (필요 시 count 메서드 추가): `src/main/projects/project-repository.ts`, `src/main/meetings/meeting-repository.ts`, `src/main/approvals/approval-repository.ts`
  - 누락된 `countByStatus` / `countActive` / `countCompletedSince`만 추가. 기존 메서드 시그니처는 변경 금지.
- Create: `src/main/ipc/handlers/dashboard-handler.ts`
  - `setDashboardServiceAccessor(fn)` + `handleDashboardGetKpis(data)` — project-handler.ts 패턴 그대로.
- Modify: `src/main/ipc/router.ts` — `dashboard:get-kpis` 디스패치 등록
- Modify: main 부트 시퀀스(services wiring 지점) — `DashboardService` 인스턴스 생성 + handler accessor 주입
- Create: `src/main/dashboard/__tests__/dashboard-service.test.ts` — in-memory SQLite fixture로 4 KPI 값 시나리오 검증 (빈 DB / 1 active project / 1 pending approval / today-boundary edge)

**Acceptance Criteria:**

- [ ] `DashboardService.getKpis()`가 **4번 이하 SQL 호출**로 끝남(벤치 주석 또는 단순 호출 카운트 테스트)
- [ ] 각 KPI 필드가 spec §7.5 표의 SQL 조건과 1:1 대응
- [ ] `completedToday`가 DST 전환일에도 "오늘 00:00 기준"을 정확히 계산(테스트 케이스 1건으로 검증)
- [ ] IPC 라우터에 `dashboard:get-kpis` 등록 + handler 초기화 실패 시 "dashboard handler: service not initialized" 에러
- [ ] Vitest 전부 green

**Verify:**

- `npm run test -- dashboard-service` → pass
- `npm run typecheck:node` → exit 0

**명시적 비범위:**

- KPI 변경 감지 + push 이벤트: R6 스트림 통합 이후.
- projectId scope KPI: R4는 global만. 타입은 optional로 선언해두되 구현은 global만.

---

## Task 3: Main — 프로젝트 생성 flow 재검증 (신규 코드 최소)

**Goal:** `ProjectService.create()` + `project:create|link-external|import` + junction TOCTOU + `ExternalAutoForbiddenError`는 R2에서 구현 완료 상태. R4는 **추가 테스트 2건**으로 엣지 커버리지만 보강한다. 신규 로직 추가 금지(변경 보이면 문서부터 수정).

**Files:**

- Modify: `src/main/projects/__tests__/project-service.test.ts` — 2 케이스 추가
  - (a) `kind='external'` + `permissionMode='auto'` → `ExternalAutoForbiddenError` throw + DB row 0 + FS 흔적 0
  - (b) `createLink` 직후 external target이 삭제된 경우 → `JunctionTOCTOUMismatchError` throw + rollback(DB + FS)
- Modify: `src/main/projects/__tests__/junction.test.ts` — Windows/POSIX 플랫폼 분기 skip 로직 확인, 누락 시 `it.skipIf(process.platform !== 'win32')` 보강
- Create (new): 없음

**Acceptance Criteria:**

- [ ] 신규 테스트 2건 전부 green
- [ ] 기존 `project-service.test.ts` 어떤 케이스도 회귀하지 않음
- [ ] `ProjectService` 파일 **변경 0 lines** (테스트만 추가)
- [ ] junction 테스트가 플랫폼별 skip을 정확히 처리(Linux CI에서 mklink 테스트 skip)

**Verify:**

- `npm run test -- project-service` → all pass
- `npm run test -- junction` → all pass
- `git diff src/main/projects/project-service.ts` → empty

**명시적 비범위:**

- junction 구현 자체 변경 (R11 정리 전까지 touch 금지).
- R4 내 macOS symlink 실기 CI 추가: R10에서 OS matrix 확장.

---

## Task 4: Renderer IPC wrapper + 3 hooks

**Goal:** Renderer가 Main을 부를 때 쓰는 **단일 진입점** `invoke<C extends IpcChannel>(channel, data)`를 `src/renderer/ipc/invoke.ts`에 둔다(preload의 `window.arena.invoke`를 감싸 타입 보장). 이 wrapper 위에 3 hooks를 올린다.

**Files:**

- Create: `src/renderer/ipc/invoke.ts`
  - `function invoke<C>(channel, data)` — preload bridge 호출, 에러 시 `IpcError` 래핑(사일런트 폴백 금지 — 에러는 반드시 throw)
- Create: `src/renderer/hooks/use-dashboard-kpis.ts`
  - `useDashboardKpis(): { data: KpiSnapshot | null; loading: boolean; error: Error | null; refresh: () => Promise<void> }`
  - mount 시 자동 fetch, `refresh()` 수동 호출 가능. 스트림 구독 **없음**.
- Create: `src/renderer/hooks/use-projects.ts`
  - `useProjects(): { projects: Project[]; loading; error; refresh; createNew(input); linkExternal(input); importFolder(input); archive(id) }`
  - 내부적으로 `project:list` + mutation 후 자동 refresh. 활성 프로젝트 자동 선택은 **active-project-store**가 담당(여기서 직접 setActive 하지 않음 — 책임 분리).
- Create: `src/renderer/hooks/use-active-project.ts`
  - `useActiveProject(): { activeProjectId: string | null; activeProject: Project | null; setActive(id); clear() }`
  - `active-project-store` 구독. `setActive`는 내부적으로 `project:open` IPC 호출 후 store 갱신(실패 시 에러 전파).
- Create: `src/renderer/stores/active-project-store.ts`
  - zustand + `persist` (localStorage key `rolestra.activeProject.v1`). state `{ activeProjectId: string | null }` 최소.
- Create: `src/renderer/ipc/__tests__/invoke.test.ts` — bridge mock으로 정상 호출 + 에러 전파 검증
- Create: `src/renderer/hooks/__tests__/use-dashboard-kpis.test.tsx`, `use-projects.test.tsx`, `use-active-project.test.tsx`
- Create: `src/renderer/stores/__tests__/active-project-store.test.ts`

**Acceptance Criteria:**

- [ ] `invoke` 외 경로로 ipcRenderer를 호출하는 renderer 코드 0건 (grep guard)
- [ ] `useDashboardKpis`가 mount 시 1회만 fetch (strict mode double-invoke 방어)
- [ ] `useProjects.createNew` 성공 후 `projects` 자동 refetch
- [ ] `useActiveProject.setActive`가 `project:open` IPC 실패 시 store를 갱신하지 않음(사일런트 폴백 금지)
- [ ] `active-project-store` persist key = `rolestra.activeProject.v1`
- [ ] Vitest 전부 green

**Verify:**

- `npm run test -- hooks stores ipc/__tests__` → pass
- `grep -rE "ipcRenderer|window\.arena\.invoke\(" src/renderer | grep -v "src/renderer/ipc/invoke.ts"` → 0 hits

**명시적 비범위:**

- 낙관적 업데이트(optimistic UI): R5 이후.
- Error Boundary 래핑: 별도 R10 정리.

---

## Task 5: Progress Gauge — 테마별 3 variant

**Goal:** spec §7.5 게이지 테마 분기(warm=round bar / tactical=12-seg diamond / retro=ASCII `[████░░░░]`)를 **한 컴포넌트 + 내부 variant 분기**로 구현. 렌더 선택 로직은 `useTheme().token.gaugeStyle`(R3 theme-tokens에 이미 있는 키)에 따라 자동. 외부에서는 `<ProgressGauge value={n} total={12} label="...">`만 쓴다.

**Files:**

- Create: `src/renderer/features/dashboard/ProgressGauge.tsx`
  - 내부 3 sub-component: `<RoundBarGauge>`, `<TacticalSegmentGauge>`, `<RetroAsciiGauge>`
  - 렌더 스위치: `switch (token.gaugeStyle) { case 'roundBar': ... case 'segmentDiamond': ... case 'asciiBlocks': ... }`
  - Retro는 `<span className="font-mono">[████░░░░]</span>` 식 ASCII 12 slot.
  - Tactical은 CSS `clip-path: polygon(...)` 12 분절 + alpha gradient를 Tailwind arbitrary value 또는 inline-style로(이 케이스만 inline-style 허용 — 이유 주석 필수). 색은 **CSS var 경유**.
- Create: `src/renderer/features/dashboard/__tests__/ProgressGauge.test.tsx`
  - 6 theme × value 0/6/12 스냅샷
  - retro variant DOM text가 `[` + `█` × (value) + `░` × (12-value) + `]` 패턴 일치
  - hardcoded hex 색 0건

**Acceptance Criteria:**

- [ ] `<ProgressGauge value={4} total={12} />` 렌더가 3 테마 전부에서 시각적으로 다른 DOM 구조 (snapshot diff)
- [ ] retro variant: `[████░░░░░░░░]` 처럼 정확히 12 slot
- [ ] tactical variant: 12 segment 중 activeSegments = `ceil(value/total * 12)` 개만 활성 class
- [ ] warm variant: border-radius가 `var(--radius-panel)` 참조
- [ ] 하드코딩 색 0건 (`grep -E "#[0-9a-fA-F]{3,6}" src/renderer/features/dashboard/ProgressGauge.tsx` → 0)
- [ ] label prop이 없으면 우측 label 미렌더 / 있으면 `font-mono` 적용

**Verify:**

- `npm run test -- ProgressGauge` → pass
- `grep -E "#[0-9a-fA-F]{3,6}" src/renderer/features/dashboard/ProgressGauge.tsx` → 0

**명시적 비범위:**

- 애니메이션 전환(value 변할 때 ease): R6 스트림 연동 후.

---

## Task 6: Dashboard Hero — 4 KPI 타일 + 빠른 액션

**Goal:** 대시보드 최상단 Hero 블록. 4 KPI 타일(`HeroKpiTile`) + 빠른 액션 2개(`+ 새 프로젝트`, `회의 소집 →`). `useDashboardKpis()`에서 데이터를 읽고, 로딩/에러/빈 상태를 명시적으로 렌더. 문구 전부 i18n.

**Files:**

- Create: `src/renderer/features/dashboard/HeroKpiTile.tsx` — props: `{ icon?; label; value; delta?; variant: 'projects'|'meetings'|'approvals'|'completed' }`. variant별로 아이콘/색 토큰만 분기.
- Create: `src/renderer/features/dashboard/HeroQuickActions.tsx` — 2 버튼. `+ 새 프로젝트` 클릭 → 모달 오픈 콜백(props). `회의 소집 →` 클릭은 **active project 없으면 disabled**(tooltip "먼저 프로젝트를 선택하세요"). 실제 회의 소집 핸들러는 R6까지 no-op placeholder.
- Modify: `src/renderer/features/dashboard/DashboardPage.tsx` — Hero section 통합
- Create: `src/renderer/features/dashboard/__tests__/HeroKpiTile.test.tsx`
  - 4 variants × 렌더 snapshot
  - value=0일 때 placeholder 스타일(fg-muted) 적용 여부

**Acceptance Criteria:**

- [ ] 4 KPI 타일이 `useDashboardKpis` loading=true일 때 skeleton(로딩 플레이스홀더)으로 렌더
- [ ] error일 때 에러 메시지가 화면에 **반드시 표시됨**(사일런트 폴백 금지 — spec §9)
- [ ] 빠른 액션 "회의 소집" 버튼이 active project null일 때 `aria-disabled="true"` + tooltip
- [ ] 모든 문자열 `t('dashboard.kpi.*')`, `t('dashboard.action.*')` 경유
- [ ] 하드코딩 색 0건

**Verify:**

- `npm run test -- HeroKpiTile` → pass
- `npm run lint` → exit 0

**명시적 비범위:**

- delta(전주 대비) 수치 실제 계산: R6 이후. R4는 prop으로만 받되 값은 항상 undefined.

---

## Task 7: 비대칭 2x2 위젯 4종 (Tasks / People / Recent / Approvals)

**Goal:** spec §7.5의 위젯 4종 골격. R4에서는 **각 위젯이 DB에서 데이터를 읽는 최소 구현**까지. 풍부한 상호작용(클릭 네비게이션 등)은 후속 Phase로.

| 위젯 | R4 범위 | 지연 Phase |
|---|---|---|
| 📋 TasksWidget | 활성 Meeting 상위 10건 + `ProgressGauge` 표시 | 클릭 이동 → R5 채널 화면 |
| 👥 PeopleWidget | member_profiles + 출근 상태 도트 | 프로필 팝업 → R8 |
| 💬 RecentWidget | messages 통합 최신 5~10건 | 메시지 클릭 이동 → R5 |
| 🔔 ApprovalsWidget | pending approvals 상위 5건 + 카운트 | ApprovalInbox 이동 → R7 |

**Files:**

- Create: `src/renderer/features/dashboard/widgets/TasksWidget.tsx` — 내부에서 `invoke('meeting:list-active')`(신규 채널 — Task 1 때 함께 정의) 호출. `ProgressGauge` 사용.
- Create: `src/renderer/features/dashboard/widgets/PeopleWidget.tsx` — `invoke('member:list-all')` 또는 기존 `member:get-profile` 반복. **N+1 주의**: 신규 bulk 채널 `member:list` 또는 `provider:list-with-profiles` 중 **이미 존재하는 것**을 재사용, 없으면 Task 1 범위로 묶어 추가.
- Create: `src/renderer/features/dashboard/widgets/RecentWidget.tsx` — `message:recent(limit=10)` (기존 채널 재사용, 없으면 Task 1 추가 범위).
- Create: `src/renderer/features/dashboard/widgets/ApprovalsWidget.tsx` — `approval:list({status:'pending', limit:5})` 기존 채널.
- Create: `src/renderer/features/dashboard/__tests__/ApprovalsWidget.test.tsx` — 5건 렌더 + count 표시 + 빈 상태 메시지
- Modify: `src/renderer/features/dashboard/DashboardPage.tsx` — `grid-template: "tasks tasks approvals" "people recent approvals"` 구현. Approvals가 2-row span.

**Acceptance Criteria:**

- [ ] 4 위젯 전부 loading/error/empty 3상태를 명시적으로 렌더
- [ ] CSS grid template가 spec §7.5 ASCII mockup과 일치(Approvals가 풀높이)
- [ ] 각 위젯이 **자체 fetch 훅**을 가지고(상위 DashboardPage에서 일괄 fetch 하지 않음), 위젯별 독립 새로고침 가능
- [ ] 존재하지 않는 IPC 채널을 호출하지 않음 — Task 1에서 누락된 것이 발견되면 즉시 Task 1로 되돌아가 shared에 먼저 선언
- [ ] 게이미피케이션 단어 0건(자동 grep 가드)

**Verify:**

- `npm run test -- widgets` → pass
- `grep -rE "XP|CREDITS|\\bLV\\b|MISSION|REWARD|UNLOCK" src/renderer/features` → 0 hits

**명시적 비범위:**

- 위젯 드래그 리사이즈/순서 변경: 본 버전 범위 아님(향후 과제).

---

## Task 8: Insight 띠 (하단)

**Goal:** 대시보드 하단 1줄 띠. 4 셀(주간 +N% / 평균 응답 / 누적 승인 / 리뷰 완료율). R4는 **실데이터 3 / 플레이스홀더 1** 수준으로 시작.

**Files:**

- Create: `src/renderer/features/dashboard/InsightStrip.tsx`
  - 4 셀 균등 분할 (flexbox 또는 grid-cols-4)
  - 각 셀: `{ icon?; label; value; tone?: 'up'|'down'|'neutral' }`
  - i18n: `dashboard.insight.weeklyDelta`, `dashboard.insight.avgResponse`, `dashboard.insight.cumApprovals`, `dashboard.insight.reviewRate`
- Create: `src/renderer/features/dashboard/__tests__/InsightStrip.test.tsx` — 4 셀 렌더 + tone up/down 색 토큰 class 확인
- Modify: `src/renderer/features/dashboard/DashboardPage.tsx` — 그리드 하단에 `<InsightStrip />` 삽입. 값은 `useDashboardKpis`가 제공(확장 필요 시 Task 2 service로 되돌아가 필드 추가).

**Acceptance Criteria:**

- [ ] 4 셀 전부 렌더 + 간격·폰트가 토큰 참조
- [ ] tone='up' 셀은 `text-success`, 'down' 셀은 `text-danger` 토큰 사용
- [ ] 데이터 부족 시 셀이 `—`로 표시(빈 값 금지 — 명시적 dash)

**Verify:**

- `npm run test -- InsightStrip` → pass

**명시적 비범위:**

- 4개 셀 이상으로 확장 가능한 동적 cell 구조: 지금은 고정 4셀.

---

## Task 9: ProjectCreateModal — Radix Dialog 3 kinds

**Goal:** spec §7.3 생성 모달을 Radix Dialog로 구현. 3 kind(신규/외부연결/가져오기) 라디오 + permission_mode 라디오(external일 때 auto 비활성) + initial members 선택 + 외부 폴더 선택 버튼. 클라이언트/서버 양쪽에서 external+auto 거부.

**Files:**

- Create: `src/renderer/features/projects/ProjectCreateModal.tsx` — Radix Dialog root, 폼 state는 `useState` 또는 `useReducer`. submit 시 kind에 따라 `createNew|linkExternal|importFolder` 훅 호출.
- Create: `src/renderer/features/projects/ProjectKindTabs.tsx` — 3 라디오(Radix RadioGroup). kind 변경 시 `externalPath` / `sourcePath` 입력 필드 가시성 토글.
- Create: `src/renderer/features/projects/ProjectPermissionRadio.tsx` — auto/hybrid/approval 라디오. `disabledModes: PermissionMode[]` prop 받아 auto 비활성(aria-disabled + tooltip). external kind 선택 시 상위에서 `['auto']` 전달.
- Create: `src/renderer/features/projects/ExternalPathPicker.tsx` — "폴더 선택" 버튼 → `invoke('arena-root:show-open-dialog', { mode: 'external-project' })` 또는 기존 채널 재사용. 선택된 경로 표시 + realpath 표시(힌트).
- Create: `src/renderer/features/projects/__tests__/ProjectCreateModal.test.tsx` — kind 전환 시 필드 가시성, external+auto 선택 불가능, submit payload shape
- Create: `src/renderer/features/projects/__tests__/ProjectPermissionRadio.test.tsx` — disabledModes prop 동작
- Modify: `src/renderer/features/dashboard/HeroQuickActions.tsx` — `+ 새 프로젝트` 클릭 시 모달 open state toggle

**Acceptance Criteria:**

- [ ] kind='external' 선택 시 auto 라디오가 disabled + aria-disabled + tooltip 메시지
- [ ] 폼 validation: 이름 1~64자, externalPath/sourcePath 존재 여부 kind에 따라 요구
- [ ] submit 성공 → `useProjects.refresh()` → 모달 닫힘 + 생성된 project를 `useActiveProject.setActive()` (옵션: 사용자 설정 없으면 자동)
- [ ] submit 에러 → 에러 메시지 **모달 내부에 inline으로 표시** (토스트 아님, 사일런트 폴백 금지)
- [ ] Radix Dialog의 focus trap / ESC 닫기 / overlay click 닫기 기본 동작 유지
- [ ] 모든 라벨 i18n (`project.create.*`)
- [ ] 게이미피케이션 단어 0건

**Verify:**

- `npm run test -- ProjectCreate` → pass
- `npm run typecheck:web` → exit 0

**명시적 비범위:**

- 드래그앤드롭 폴더 연결: V3.1+
- initial members 고급 선택(그룹 프리셋): R5 이후.

---

## Task 10: 활성 프로젝트 전환 UI (ProjectRail + ShellTopBar)

**Goal:** ProjectRail은 R3에서 이미 active prop을 받도록 만들어져 있음. R4는 **(a) active store에 연결 + (b) 리스트에 생성 버튼 추가 + (c) ShellTopBar에 활성 프로젝트 이름 표시**.

**Files:**

- Modify: `src/renderer/components/shell/ProjectRail.tsx`
  - props 유지하되, 최상단에 `+ 새 프로젝트` 섹션(1줄) 추가 (시각적으로 `PROJECTS` 섹션 헤더 옆 작은 `+` 버튼 또는 별도 row)
  - `onCreateProject?: () => void` prop 추가
  - 기존 `activeProjectId` prop을 App에서 `useActiveProject()`로 주입
- Modify: `src/renderer/components/shell/ShellTopBar.tsx`
  - `subtitle`에 활성 프로젝트 이름 표시 슬롯 추가(또는 별도 `activeProject?: Project` prop)
  - 활성 프로젝트 없으면 "프로젝트 미선택"(i18n 키 `shell.topbar.noActiveProject`)
- Modify: `src/renderer/App.tsx`
  - `useProjects()` + `useActiveProject()` 연결
  - `<Shell>` 구성 시 ProjectRail에 데이터 전달
  - R3 placeholder(`app.mainPlaceholder`) 제거 → `<DashboardPage />` 마운트
- Create: `src/renderer/components/shell/__tests__/ProjectRail.active.test.tsx` — active 전환 시 aria-current 토글 + onSelect 콜백 호출

**Acceptance Criteria:**

- [ ] ProjectRail 클릭 → `useActiveProject.setActive(id)` → store 갱신 → ShellTopBar subtitle 즉시 반영(리렌더 1 frame)
- [ ] `+ 새 프로젝트` 버튼이 ProjectRail 내부에서 노출되고 모달 오픈
- [ ] 새로고침 후에도 active project 유지(persist)
- [ ] R3 `app.mainPlaceholder` 문구가 UI에 더 이상 나타나지 않음
- [ ] `useTheme()` 기반 테마 토큰만 사용, 하드코딩 색 0건

**Verify:**

- `npm run test -- ProjectRail.active` → pass
- `grep -rn "app.mainPlaceholder" src/renderer` → Task 9/10에서 제거됐는지 확인(ko/en.json에는 남겨둬도 무방)

**명시적 비범위:**

- NavRail 라우팅 확장(대시보드/채널/승인함 탭): R5 이후.

---

## Task 11: i18n populate (`dashboard.*`, `project.*`)

**Goal:** R3에서 빈 객체로만 선언된 `dashboard` / `project` 도메인을 실제 키로 채운다. ko/en 동기. eslint-plugin-i18next 가드 통과.

**Files:**

- Modify: `src/renderer/i18n/locales/ko.json` + `en.json`
  - `dashboard.kpi.{activeProjects,activeMeetings,pendingApprovals,completedToday}`
  - `dashboard.action.{newProject,startMeeting}`
  - `dashboard.tasks.{title,empty,loading}`, `dashboard.people.{title,empty,...}`, `dashboard.recent.{title,empty,...}`, `dashboard.approvals.{title,empty,count}`
  - `dashboard.insight.{weeklyDelta,avgResponse,cumApprovals,reviewRate,placeholder}`
  - `dashboard.gauge.{label}` (e.g. `"{{state}} · {{index}}/12"`)
  - `project.create.{title,kind.new,kind.external,kind.imported,name,description,permissionMode.auto,permissionMode.hybrid,permissionMode.approval,externalPath,sourcePath,externalAutoForbidden,members.header,submit,cancel}`
  - `project.errors.{externalAutoForbidden,duplicateSlug,junctionTOCTOU,folderMissing,external.realpathMismatch}`
  - `shell.topbar.noActiveProject`
- Modify: `src/renderer/i18n/keys.ts` — Task 9/6/10에서 참조한 키 상수를 `as const` 객체에 등록(선택이지만 권장)
- Modify: `i18next-parser.config.js` — 필요 시 `keepRemoved` regex 확인(도메인 빈 객체 보호는 R3에서 이미 설정됨)

**Acceptance Criteria:**

- [ ] `npm run i18n:check` 통과 (parser가 orphan key 없음 / 신규 키 반영됨)
- [ ] `npm run lint`에서 eslint-plugin-i18next 하드코딩 0건
- [ ] ko.json / en.json key set 완전 동일(deep equal on keys only)
- [ ] 영문 en.json 값은 최소 identifier 수준으로라도 채움(빈 문자열 금지)

**Verify:**

- `npm run i18n:check && npm run lint` → exit 0

---

## Task 12: Playwright Electron E2E — "외부 프로젝트 연결 → 대시보드"

**Goal:** `_electron.launch`로 실제 앱을 띄우고, (1) 임시 ArenaRoot 생성 (2) 더미 외부 폴더 생성 (3) `+ 새 프로젝트` → 외부 연결 → 제출 (4) 대시보드 활성 프로젝트 KPI 갱신 확인 — 전 과정을 자동화. 본 시나리오는 spec §11 E2E 케이스 "외부 폴더 연결 → junction 생성 확인 → Claude에 파일 쓰기 지시 → 파일 생성 확인" 중 **R4 범위(파일 쓰기 앞 단계까지)**만 커버.

**Files:**

- Create: `e2e/playwright.config.ts` — projects: `electron`(timeout 60s)
- Create: `e2e/electron-launch.ts` — `_electron.launch({ args: ['.', '--rolestra-arena-root=<tmp>'] })` 유틸. tmp 디렉토리는 `os.tmpdir()/rolestra-e2e-<uuid>` + afterAll 정리.
- Create: `e2e/fixtures/external-sample/README.md` — 더미 외부 폴더 1파일
- Create: `e2e/external-project-flow.spec.ts`
  - Steps:
    1. Electron app launch, DOM ready
    2. ProjectRail `+ 새 프로젝트` 클릭 → 모달 표시 확인
    3. 라디오 "외부 연결" 선택 → auto 라디오 aria-disabled=true 확인
    4. ExternalPathPicker가 IPC를 통해 `externalPath` 설정(테스트에서는 IPC stub 또는 pre-set state로 우회)
    5. name 입력 + permission=hybrid 선택 + submit
    6. Main 측 `<ArenaRoot>/projects/<slug>/link` 파일시스템에 junction/symlink 생성 확인(fs.lstat)
    7. 모달 닫힘 + ProjectRail에 새 프로젝트 active 표시
    8. Dashboard Hero `activeProjects` 타일 값이 1 (또는 증가) 확인
- Modify: `package.json` scripts — `"e2e": "playwright test"`, `"e2e:install": "playwright install --with-deps"`
- Modify: `vitest.config.ts` exclude에 `e2e/**` 추가
- Modify: CI 설정(있는 경우): e2e job 추가 시점은 R10. R4는 로컬 실행 + 증빙 캡처만.

**Acceptance Criteria:**

- [ ] `npm run e2e` 로컬에서 exit 0 (Windows 환경에서는 mklink 권한 확인)
- [ ] 시나리오가 mock 없이 **실제 electron-vite 빌드를 사용**(e2e 러너는 production build를 띄움)
- [ ] 테스트 종료 후 tmp ArenaRoot 정리(leak 없음)
- [ ] 실패 시 스크린샷 자동 저장(`e2e/test-results/`)
- [ ] CI에서는 R4 범위상 **required 아님** — 로컬 실행 + 스크린샷 증빙만 필수

**Verify:**

- `npm run e2e -- external-project-flow` → pass
- `docs/specs/appendix/r4-evidence/external-link-flow.png` 생성 확인

**명시적 비범위:**

- Linux에서 symlink 테스트: symlink 자체는 동작하지만 Rolestra Windows-first 정책상 R10에서 OS matrix 확장.
- Playwright CI integration: R10.

---

## Task 13: R4 종료 확인 + R5 진입 체크리스트

**Goal:** 전체 typecheck/lint/test/i18n:check/theme:check/build 통과, Playwright E2E 1건 pass, 6 테마 대시보드 스크린샷 증빙, spec §10 R4 체크박스 ✓ + 산출물 링크 채움, r4-done-checklist.md 작성.

**Files:**

- Create: `docs/specs/appendix/r4-evidence/`
  - `dashboard-warm-light.png`, `dashboard-tactical-dark.png`, `dashboard-retro-light.png` (최소 3장, 가능하면 6장)
  - `external-link-flow.png` (Playwright capture)
  - `README.md` — 캡처 방법 기록
- Modify: `docs/specs/2026-04-18-rolestra-design.md` §10 Phase R4 블록 — 체크박스 전부 ✓ + 산출물 링크 채움:
  - DashboardService, DashboardPage, ProjectCreateModal, junction(R2 재활용), activeProjectStore, e2e spec, appendix-r4-evidence
- Create: `docs/checklists/r4-done-checklist.md` — R4 완료 확인 항목 + R5(채널+메신저 본체) 진입 전 필수 조건
- Modify: `tools/cli-smoke/README.md` — R4 완료 상태 반영

**Acceptance Criteria:**

- [ ] `npm run typecheck && npm run lint && npm run test && npm run i18n:check && npm run theme:check && npm run build` 전부 exit 0
- [ ] `npm run e2e -- external-project-flow` 로컬에서 1회 성공
- [ ] 스크린샷 3장 이상(이상적으로는 6장 전부)
- [ ] spec §10 R4 블록 체크박스 전부 ✓ + 산출물 링크 채움
- [ ] R5 진입 체크리스트 작성(예: 채널 스키마 재검토 / MessageBubble 디자인 시안 락 / #회의록 자동 포스팅 플로우 확정 여부)
- [ ] tasks.json `completed` 마킹

**Verify:**

- `npm run typecheck && npm run lint && npm run test && npm run i18n:check && npm run theme:check && npm run build` → exit 0
- `ls docs/specs/appendix/r4-evidence/*.png | wc -l` ≥ 3

---

## Dependency Graph

```
Task 0 (branch + spec 정합) ─────────────────────┐
                                                  ▼
Task 1 (shared types + ipc channel 선언) ─────── Task 3 (ProjectService 테스트 보강)
        │
        ├─────────────────────────────────┐
        ▼                                  ▼
Task 2 (DashboardService + handler)   Task 4 (renderer invoke + hooks + store)
        │                                  │
        │         ┌────────────────────────┤
        │         ▼                        │
        │   Task 5 (ProgressGauge 3 variant)
        │         │                        │
        │         ▼                        │
        │   Task 6 (Hero KPI 타일 + 빠른액션)
        │         │                        │
        │         ▼                        │
        │   Task 7 (비대칭 2x2 위젯 4종)
        │         │                        │
        │         ▼                        │
        │   Task 8 (Insight 띠)            │
        │         │                        │
        └─────────┼────────────────────────┤
                  ▼                        ▼
           Task 9 (ProjectCreateModal)  Task 10 (활성 프로젝트 UI)
                  │                        │
                  └──────────┬─────────────┘
                             ▼
                      Task 11 (i18n populate)
                             │
                             ▼
                      Task 12 (Playwright E2E)
                             │
                             ▼
                      Task 13 (종료 + R5 진입 체크)
```

### 병렬화 가능 그룹

- **Group A (직렬):** Task 0 → Task 1 (channel 계약 필요)
- **Group B (Task 1 완료 후 병렬):** Task 2 (Main) / Task 3 (Main 테스트) / Task 4 (Renderer 스택)
- **Group C (Task 4 완료 후 직렬):** Task 5 → Task 6 → Task 7 → Task 8 (대시보드 UI 스택)
- **Group D (Task 8 완료 후 병렬):** Task 9 / Task 10
- **Group E (수렴):** Task 11 → Task 12 → Task 13

총 태스크 14개(0~13). 최대 병렬성 = 3 (Group B).

---

## Decisions (초안 — 팀장 승인 필요)

| ID | 항목 | 선택지 | 초안 결정 |
|---|---|---|---|
| **D1** | KPI 갱신 주기 | A: polling 30s / B: 진입 + manual refresh / C: 스트림 구독 | **B** — R4는 stream hook-up 없음(R6+). 진입 + 활성 전환 + 모달 close 3 시점만 refresh. |
| **D2** | Dashboard KPI의 `projectId` scope 지원 | A: R4부터 / B: R6 이후 | **B** — R4 타입은 optional만 선언, 구현은 global. |
| **D3** | `+ 새 프로젝트` 모달의 위치 | A: ProjectRail 버튼 / B: Hero 빠른액션 / C: 둘 다 | **C** — 둘 다 같은 store/trigger 사용, 모달 자체는 단일 인스턴스. |
| **D4** | E2E에서 외부 폴더를 실제 외부 경로에 만드는가? | A: tmp 밖 실제 홈 / B: `os.tmpdir()` 내부 | **B** — 정리 용이, realpath 차이 문제없음. |
| **D5** | Playwright를 CI에 즉시 통합? | A: R4부터 / B: R10에서 OS matrix와 함께 | **B** — R4는 로컬 pass + 스크린샷 증빙만. |

---

## Self-Review (plan 작성자 체크)

### 1. Spec 커버리지 (§10 Phase R4 항목 → Task 매핑)

| Spec R4 요구사항 | Task |
|---|---|
| Dashboard (3열) + 5개 위젯 | **4 위젯 (spec §7.5에서 5→4로 정정됨)** — Task 6 (Hero) / Task 7 (4 위젯) / Task 8 (Insight) |
| 프로젝트 생성 모달 (신규/외부/가져오기) | Task 9 |
| Windows junction / macOS symlink 구현 | Task 3 (R2 완료 확인 + 테스트 보강) |
| 활성 프로젝트 전환 | Task 4 (store) + Task 10 (UI) |
| E2E "외부 프로젝트 연결 → 대시보드 이동" | Task 12 |

### 2. 하드코딩 금지 원칙 커버

- 색: Task 5~10 컴포넌트 모두 Tailwind token + CSS var 경유 (guard grep 유지)
- 문자열: Task 11 i18n populate + 각 구현 태스크 AC에 "i18n 경유" 명시
- 경로/상수: `rolestra.activeProject.v1` 등 persist key는 상수로 분리, 하드코딩 리터럴 집중 금지

### 3. 사일런트 폴백 금지

- `useDashboardKpis.error` → Hero에서 반드시 표시 (Task 6)
- `ProjectCreateModal` submit 에러 → 모달 inline 표시 (Task 9)
- `useActiveProject.setActive`가 `project:open` 실패 시 store 미갱신 (Task 4)
- 외부 폴더 realpath 불일치는 Main에서 `JunctionTOCTOUMismatchError` throw → UI에서 project.errors.junctionTOCTOU 표시 (Task 9/11)

### 4. 시안 이탈 위험 구간

- **위험 A (중):** Task 7의 비대칭 그리드 `"tasks tasks approvals" "people recent approvals"` 비율이 시안 01-dash-variants.jsx와 픽셀 비교 없으면 어긋날 수 있음 → Task 13 스크린샷 증빙에 포함.
- **위험 B (낮음):** Task 5의 tactical 12-segment gauge가 `clip-path` 구현 방식에 따라 6 테마 중 하나에서 layout shift 일으킬 수 있음 → snapshot + 수동 6 테마 스위치 확인.
- **위험 C (중):** Task 12 Playwright가 Windows junction 생성 시 권한 이슈가 날 수 있음 → mklink /J는 관리자 권한 불필요하지만 일부 AV 프로그램이 차단 사례 있음 → spec §7.9에 명시된 대응 방침(alt: symlink 생성 실패 시 명시적 에러) 따름.

### 5. Placeholder scan

- "TBD"/"TODO"/"implement later" **없음**. 경로/명령 전부 exact.

---

## 참고

이 plan은 **Rolestra Phase R4만** 다룬다. R5(채널+메신저) 이후는 R4 완료 후 각각 별도 plan 문서로 작성된다. spec §10 Phase 분할과 1:1 대응.
