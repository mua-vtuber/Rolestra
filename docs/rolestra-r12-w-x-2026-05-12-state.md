---
name: R12-W T10.5 + R12-X 분기 — 현재 상태 + 발생 문제 + 향후 계획 (2026-05-12)
description: R12-W T1~T10 + T10.5 hotfix land 후 dogfooding 2 round fail 상태. spec §7.6 PathGuard 봉인 chain dead-infrastructure 격차 audit + R12-X 분기 결재 완료. T10.5 hotfix 효과 검증 진행 중. 새 세션 이어받기 + 다음 행동 + 참조 문서 / 메모리 path 통합.
type: progress
---

# Rolestra R12-W + R12-X — 2026-05-12 시점 상태

## TL;DR

| 영역 | 한 줄 상태 |
|---|---|
| **R12-W T1~T10** | ✅ land — backend 권한 layer (채널 단위 권한 + PromptComposer wire + MeetingTurnExecutor 권한 wire 교체) |
| **R12-W T10.5 hotfix (G1+G2+G5)** | ✅ land — ssmCtx 4곳 cwd / mode 하드코딩 fix + CliProvider.setProjectPath wire |
| **R12-W T11~T21** | ⏳ T10.5 효과 검증 후 진입 — argv filter + UI + i18n + verify + 문서 |
| **dogfooding 3 round** | ❌ 모두 fail — Claude 가 여전히 *rolestra source repo 의 docs/* 노출 (사용자 의도와 정반대) |
| **사용자 명시 문제 요소 3 종** | ❌ ①프로젝트 폴더 봉인 위반 / ②채팅 메시지에 JSON 형식 노출 / ③코덱스+제미니 응답 실패 — 본 문서 §2.1~§2.3 |
| **R12-X 정식 phase** | 🆕 ADR + plan 작성 완료 (산출물 commit 대기) — G3+G4+G6+G7 + 회귀 가드 3종 (brand `AbsolutePath` / runtime invariant / integration test) |
| **기타 별 격차** | WSL-Windows 빌드 mismatch / dead helper / stream-types 잔재 — 본 phase 외 follow-up |

---

## 1. 지금 구현되었어야 하는 기능 (의도)

### 1.1 R12-W 의도

> AI 직원이 회의에서 spec 파일을 *읽으려 시도조차 하지 않고* "본 회의 채널 규칙상 파일을 직접 읽지 못해" 라고 자기검열하던 회귀를 풀어준다. 권한 단위 = 채널 (부서 = 기본 채널의 라벨, 사용자 mental model).

**구성 요소** (R12-W ADR `docs/R12_c2_2R/decisions/r12-w-member-file-permission.md`):
- 채널 row 에 5 axis boolean 컬럼 (`file_read` / `file_write` / `command_exec` / `web_search` / `db_read`) 직접 박음 — 마이그레이션 023.
- 기본 채널 (system, dm) 은 SKILL_CATALOG default 로 자동 채움. 사용자 채널은 부서 template + 미세조정.
- 회의 시작 시 1회 캐싱 + `'permission-changed'` invalidation → 다음 turn 재조회.
- PromptComposer 가 권한 단락 합성 — fallback 분기에 D2 (최소 읽기 허용) 안내 + 회의록 무관 명시.
- MeetingTurnExecutor 가 옛 `buildPermissionRules` 폐기 + PromptComposer.compose 단일 진입.

### 1.2 R12-W T1~T10 — land 실제 (5 commit, ~2,000 LoC, 2885 production tests PASS)

| Commit | 내용 | LoC |
|---|---|---|
| `6ebcabc` | docs(rolestra): R12-W ADR + plan | 1,345 |
| `06c2051` | feat(rolestra): R12-W T1 + T2 — PromptComposer fallback 안내 + PermissionSet 공통 타입 | 351 |
| `033cb71` | feat(rolestra): R12-W T3~T7 — 채널 권한 backend layer (마이그레이션 023 + repository + service + resolver + IPC) | 897 |
| `8d98dbb` | feat(rolestra): R12-W T8 — MeetingSession 채널 권한 캐시 + invalidation | 226 |
| `e2f43e7` | feat(rolestra): R12-W T9 + T10 — MeetingTurnExecutor 권한 wire 교체 + 옛 buildPermissionRules 삭제 | 217 / −141 |

### 1.3 R12-W T10.5 hotfix — land 실제 (본 세션, 2 hotfix commit)

dogfooding round 1 (2026-05-12) 에서 사용자 보고: AI 가 *사용자가 만든 프로젝트 폴더* 가 아니라 *rolestra source repo 의 docs/* 를 list. spec §7.6 PathGuard 봉인 chain 무력화. audit 결과 7 격차 식별 (G1~G7) — R12-W hotfix 가 G1+G2+G5 즉시 fix, R12-X 가 G3+G4+G6+G7 + 회귀 가드 정식 phase.

| Commit | 내용 | LoC |
|---|---|---|
| `a7ef7f5` | fix(rolestra): R12-W T10.5.G2+G5 — ssmCtx 4곳 cwd / mode 하드코딩 → resolveProjectPaths + project row 동기화 | 6 files, +877/-27 |
| `d0992ee` | fix(rolestra): R12-W T10.5.G1 — MeetingTurnExecutor 의 CliProvider.setProjectPath wire (매 turn cwd 동기화) | 1 file, +7 |
| `eb8e063` | feat(rolestra): renderer dogfooding 보정 + 채널 멤버 관리 UI 초기본 (App / InitialMembersSelector / MemberPanel / MemberRow / ChannelMemberPicker) | 5 files, +376/-7 |

**T10.5 의 한계 (R12-X 가 이어받음)**:
- `resolveProjectPaths` 직접 호출이라 external 프로젝트 junction TOCTOU 재검증 X (spec §7.6.4 CA-3).
- CliProvider singleton 이라 평행 회의 race 가능 — R12-X 의 *per-call cwd injection* 으로 구조 개선.
- 회귀 가드 셋 (brand type / runtime invariant / integration test) 모두 R12-X 책임.

---

## 2. 현재 발생 중인 문제

### 2.0 핵심 문제 요소 — 사용자 명시 3 종

| # | 한 줄 | 분류 | 본 문서 위치 |
|---|---|---|---|
| **문제 1** | Rolestra 가 만든 프로젝트는 *허용된 폴더 안* 에서만 작동해야 하는데, *다른 경로* (rolestra source repo) 를 사용하는 현상 — spec §7.6 PathGuard 봉인 위반 | 봉인 / 보안 / 신뢰성 critical | §2.1 |
| **문제 2** | 채팅 메시지에 application-level JSON 형식이 그대로 노출 (예: `{"name":"Claude Code","label":"claude_1","opinions":[...]}`) — R12-C2 P2 의 *parsed UI* 미land 격차 | UX / surface 격차 (R12-C2 P2 의존) | §2.2 |
| **문제 3** | 코덱스 (`Not inside a trusted directory`) + 제미니 (`CLI response hang timeout 30s`) 응답 실패 — 회의가 1 명짜리로 축소 | provider 통합 / 환경 격차 | §2.3 |

세 문제 모두 *2026-05-12 dogfooding 3 round* 에서 surface. 1, 2, 3 의 *근본 원인* + *해결 경로* + *어떤 phase 가 책임* 가 모두 다름 — 분리해서 진행.

### 2.1 문제 1 — 프로젝트 폴더 봉인 위반 (spec §7.6 PathGuard chain)

**사용자 mental model**:
> "rolestra의 권한은 rolestra폴더 안에 한정되는거지 ... 내가 docs를 읽어 하면 rolestra폴더안에 만든 프로젝트 폴더안의 docs폴더를 읽어야하는데"

**실제 동작**: AI 가 *사용자가 만든 프로젝트 폴더* 가 아니라 *rolestra source repo 의 docs/* (예: `D:\Taniar\Documents\Git\Rolestra-r12c2-r2\docs\`) 를 list. 사용자 의도와 정반대.

**dogfooding 3 round 결과** (timestamp + meetingId + contentLength 기준):

| Round | 시점 | 결과 | 증거 |
|---|---|---|---|
| round 1 | hotfix 전 (R12-W T1~T10 land 직후) | ❌ Claude 가 `rawLength=23,658` 응답으로 *rolestra source repo* 의 docs/ list dump. **단** AI 자기검열 메시지는 사라짐 (T9 효과) | work-log §dogfooding 결과 |
| round 2 | T10.5 hotfix commit 후 (앱 재시작) | ❌ Claude `contentLength=12369` — 여전히 *rolestra source repo* 의 `archive / checklists / decisions / design / plans / README.md / reports / ... / 기능-정의서.md` list + 본문 박힘 | 사용자 보고 로그 + Claude 메시지 본문 |
| round 3 | 빌드 재실행 후 | ❌ Claude `contentLength=2076` — 응답 짧아짐 (fix 작동의 *약한 신호*) 그러나 사용자: "실패야" | round 3 의 Claude 응답 본문 결정적 데이터 대기 |

**확인 진행 중 가설** (우선순위):
1. **WSL/Windows 빌드 mismatch (가장 강력)** — 본 세션 commit 은 WSL 안. Windows electron 이 사용하는 main bundle (`out/main/index.js`) 갱신 미확인. round 2 의 grep 결과 (`setProjectPath(projectPath) {` 1건만, hotfix 의 *호출자* + `T10.5` 마커 0건) 이 빌드 stale 강력 시사.
2. **새 프로젝트의 `kind = external` + `external_link = rolestra source repo`** — 사용자가 rolestra source repo 를 external 로 연결했으면 cwd 가 *정확히 rolestra source repo* (의도와 정반대, hotfix 가 정상 작동해도 같은 surface).
3. **CliProvider singleton race** — 다른 path 가 `setProjectPath('.')` 또는 `setProjectPath('')` 로 덮어씀. (R12-X 의 *per-call cwd injection* 으로 구조 개선 예정)
4. **AI 도구가 cwd 무시** — Claude 의 Read/Glob 도구가 *절대경로 인자* 로 다른 폴더 접근 (cwd 가 정확해도 우회). 이는 cwd layer 와 *AI 도구 인자 layer* 가 다른 layer 라는 진단.

**근원 격차** (§2.4 audit 본문) — spec §7.6 PathGuard 봉인 chain 자체가 R2 (2022 land) 부터 4년간 dead-infrastructure 였음. R12-W T10.5 hotfix 가 G1+G2+G5 즉시 fix, R12-X 정식 phase 가 G3+G4+G6+G7 + 회귀 가드 3종 처리.

**처리 책임**: R12-W T10.5 (hotfix, land 완료) + R12-X (정식 wire + 회귀 가드, 진입 예정). 다음 행동 = round 3 진단 데이터 (빌드 grep / 프로젝트 row / Claude 응답 본문) 캡쳐 → 4 가설 좁히기.

### 2.2 문제 2 — 채팅 메시지에 JSON 형식 노출

**현상**: 회의 surface 에서 AI 응답이 *application-level JSON* 으로 채팅에 그대로 노출. 예 (round 1 Claude 응답 본문 마지막 부분):

```
{"name":"Claude Code","label":"claude_1","opinions":[
  {"title":"회의록 시맨틱 검색 — 기존 FTS5 재활용","content":"…","rationale":"…"},
  {"title":"의견 트리 = Mermaid 텍스트 렌더","content":"…","rationale":"…"},
  …
]}
```

**근본 원인**: R12-C2 P2 (회의 기능 재설계 — *의견 트리 + 일괄 동의 투표*) 의 설계가 AI 응답을 *application-level JSON* (의견 카드 list 형태) 으로 받기로 정함. 그러나 그 JSON 을 *parsing → 의견 카드 UI 컴포넌트 렌더* 하는 surface layer 가 아직 미land. 메시지 컴포넌트 (`Message.tsx` / `SystemMessage.tsx`) 가 *원본 본문 그대로* 채팅 렌더 → JSON 텍스트 노출.

**관련 참조**:
- R12-C2 plan (회의 시스템 재설계, P2 회의 기능): `docs/specs/` 안 R12-C2 design + `docs/plans/` 안 R12-C2 plan
- 의견 트리 / 일괄 동의 투표 spec: `docs/specs/2026-04-18-rolestra-design.md` (의견 카드 본문 + 투표 메커니즘) + `docs/회의시스템-새로만들기-1차-쉬운설명.md`
- `docs/구현-현황.md` §"R12-C2 로 옮겨진 것" 본문 T12 (의견 수집 / 집계 service 미land 표기)

**처리 책임**: R12-C2 P2 (회의 기능) — 옛 T12 (의견 수집 / 집계 service) 의 frontend 측 (parsing + 의견 카드 UI). 본 R12-W phase 와 *완전 별 phase*. R12-W T10.5 hotfix 진행과 *직접 간섭 없음*.

**short-term 완화** (R12-C2 P2 land 전 surface 격차 완화 옵션):
- A) AI 시스템 프롬프트에 "사용자 가시 채팅 본문에 JSON 박지 마라" 1줄 추가 → AI 가 markdown / 자연어 응답
- B) 메시지 컴포넌트가 *JSON parse 시도 → 성공하면 의견 카드 fallback, 실패하면 raw* (parsing 잔여 책임 R12-C2 P2 본 land 까지 임시)
- C) 본 R12-C2 P2 진입 가속화 (R12-W T11+ 와 평행)

세 옵션 모두 *사용자 결재* 영역. 결정 전까지는 사용자 dogfooding 시 JSON 노출 surface 그대로.

### 2.3 문제 3 — 코덱스 + 제미니 응답 실패

dogfooding 3 round 모두 같은 패턴 — claude 만 응답, codex + gemini turn 실패. 사용자 입장에선 *회의가 1 명짜리로 축소*.

| Provider | 실패 메시지 | 분석 | 처리 옵션 |
|---|---|---|---|
| **Codex CLI** | `CLI command failed: Reading prompt from stdin...\nNot inside a trusted directory and --skip-git-repo-check was not specified.` | codex 의 자체 trust list 메커니즘 — 사용자 프로젝트 폴더가 codex 의 trust list 에 등록 안 됨 + 또는 git repo 아님 (codex 가 *git repo 안에서만* 동작 기본) | A) `ProjectService.create` 시 `git init` 자동 → 모든 사용자 프로젝트가 git repo. B) `CliProvider` (codex) 의 spawn argv 에 `--skip-git-repo-check` 자동 추가. C) codex trust list 에 ArenaRoot 자동 등록 (codex CLI 가 노출하는 API 가 있다면) |
| **Gemini CLI** | `CLI response hang timeout (C:\\Users\\Taniar\\AppData\\Roaming\\npm\\gemini.cmd, per-turn, 30000ms)` | gemini CLI 가 30s 안 응답 없음. 다음 가능성: ① 인증 미설정 / ② 네트워크 / ③ 요청 payload 형식 (gemini 가 다른 format 요구) / ④ Windows 의 `.cmd` shim 자체 hang | A) gemini auth status 확인 + 다른 도구로 ping. B) spawn argv + payload trace 로 *어디서 hang* 격리. C) timeout 늘림 (`30s → 60s+`) 으로 완화 (단, 본질 해결 X) |

**처리 책임**: 별 follow-up — R12-W / R12-X 와 *별 phase*. 위 옵션 중 결재 후 별 task. 단, 본 격차가 *dogfooding 의 신호 비율* 을 떨어뜨림 (3 provider 중 1 만 응답 = noise) — 진단 효율을 위해 codex 의 옵션 B (`--skip-git-repo-check` argv) 가 가장 빠른 *임시 완화*.

### 2.4 audit — spec §7.6 PathGuard chain 전체 dead-infrastructure (문제 1 의 근원)

`docs/R12_c2_2R/reports/audit/2026-05-12-r12-w-pathguard-wire-audit.md` 본문. R2 (2022 land) 부터 4년간 **production runtime 에서 한 번도 호출 안 된** code 가 1.5~2중 방어 의도였으나 실제 0~0.5중.

| ID | 격차 | 위험도 | T10.5 hotfix 처리 | R12-X 처리 |
|---|---|---|---|---|
| G1 | `CliProvider._projectPath = '.'`, `setProjectPath` 호출자 0 | 🟠 high | ✅ (turn-executor 호출) | 구조 개선 (per-call cwd) |
| G2 | `ssmCtx.projectPath: ''` 4곳 하드코딩 | 🟠 high | ✅ (4곳 `resolveProjectPaths` 직접 호출) | PermissionService.resolveForCli 정식 wire |
| G3 | `PermissionService` 인스턴스화 0, 호출 0 | 🔴 critical | ❌ 우회 | ✅ 정식 wire (composition root) |
| G4 | `setExecutionWorkspaceRoot` 호출자 0 → ExecutionService singleton 미초기화 | 🟡 medium | ❌ | ✅ |
| G5 | `permissionMode='hybrid'` / `autonomyMode='manual'` 하드코딩 — 사용자 mode 무력화 | 🟡 medium | ✅ (G2 와 같은 4곳 + project row 동기화) | (G2 완료로 자연 close) |
| G6 | `MeetingSession.setProjectPath` 호출자 0 (dead method) | 🟡 medium | ❌ | ✅ (dead method 삭제 또는 정식 wire) |
| G7 | `ExecutionService.ensureAccess` optional + 미주입 시 silent skip (CLAUDE.md 위반) | 🟡 medium | ❌ | ✅ (optional 제거 + 미주입 시 throw) |

**Root cause**: "land 단계 책임자가 wire 단계 책임자에게 인계 안 함". 회귀 가드 5종 (type 가드 / runtime invariant / integration test / E2E argv 캡처 / dead-code 검출) 모두 부재 — 본 dogfooding 까지 4년간 발견 안 됨.

### 2.5 기타 별 격차 (본 hotfix 범위 외)

| 격차 | 메시지 | 의미 | follow-up |
|---|---|---|---|
| **WSL/Windows 빌드 mismatch** | WSL 안 commit 이 Windows electron main bundle 에 반영 안 됨 | dev 환경 (WSL) 과 실행 환경 (Windows) 분리 시 빌드 동기화 절차 부재 | A) `docs/reports/analysis/` 별 ADR 후보 — 절차 정식화 / B) CI 자동화로 둘 다 빌드 |
| **dead helper `createDefaultSsmContext`** | 호출자 0 — CLAUDE.md "no fallback" 정신 위반 후보 | 행위 0 (호출자 없음) 이라 surface 무해 | R12-X 또는 후속 cleanup 단계에서 삭제 |
| **`stream-types.ts` 의 `StreamPermissionPendingEvent` / `PermissionRequest`** | R7-Task4 폐기 잔재 | 의존 cleanup 별 phase 책임 | 후속 cleanup phase |
| **`meeting-turn-executor.ts` 의 `arenaRootService` private field** | T9 후 페르소나 합성 path 에서 미사용. deps 와 private field 유지 (회귀 차단용) | 후속 cleanup 영역 | 후속 cleanup phase |

---

## 3. 앞으로 구현 예정

### 3.1 R12-W 잔여 (T10.5 효과 검증 후)

**T10.5 hotfix 효과 검증** — 다음 행동:
1. Windows 에서 빌드 재실행 (`npm run build` 또는 `npm run dev`) + grep 검증 (`Select-String -Path "out\main\index.js" -Pattern "T10\.5|provider\.setProjectPath\(|resolveProjectPaths\("`) 으로 hotfix 코드가 main bundle 에 박혔는지 확정.
2. Claude 응답 본문 + projects row 캡쳐로 *cwd 가 정말 정확한지* 결론.
3. 효과 확인 PASS 시 T11+ 진입. fail 시 추가 hotfix 또는 R12-X 우선 진입 결재.

**T11~T21** (R12-W plan §4~7차 본문, `docs/R12_c2_2R/plans/2026-05-11-rolestra-r12-w-member-file-permission.md`):

| T | 영역 | 한 줄 |
|---|---|---|
| T11 | permission-flag-filter | Claude `--allowedTools` 콤마 리스트를 PermissionSet 으로 좁힘 (argv filter) |
| T12 | cli-provider spawn wire-up | spawn 직전 base argv → filter 호출 → spawn argv |
| T13 | use-channel-permissions hook + zustand | renderer side state |
| T14 | 채널 생성 모달 — 부서 template + 권한 섹션 | UI |
| T15 | 채널 설정 모달 — 권한 섹션 + template 리셋 | UI |
| T16 | i18n ko/en JSON | 부서 template 5종 라벨 + 5 axis 라벨 |
| T17 | Composition root DI | 부분 land (renderer hook + UI mount 잔여) |
| T18 | spec §7.6.4 신설 | "직원-권한 filter layer" 본문 1 페이지 |
| T19 | vitest 통합 | 신규 통합 시나리오 (예: 부서 채널 + 권한 변경 → 다음 turn argv 좁힘) |
| T20 | E2E Playwright | 사용자 보고 시나리오 — `messenger-mockup-tool-spec.md` 읽기 |
| T21 | 문서 / closeout | ADR 본문 갱신 (실제 SHA + LoC) + 구현-현황.md |

### 3.2 R12-X 정식 phase (ADR `docs/R12_c2_2R/decisions/r12-x-pathguard-wire-up.md` + plan `docs/R12_c2_2R/plans/2026-05-12-rolestra-r12-x-pathguard-wire-up.md`)

**Why**: R12-W T10.5 hotfix 가 G1+G2+G5 즉시 fix 했으나 *정식 wire* (PermissionService 경유) 는 R12-X 책임. spec §7.6 PathGuard chain 의 *마지막 방어선* (G3 — PermissionService) 인스턴스화 0 + 호출 0 격차 + 회귀 가드 부재 fix.

**핵심 작업**:
- **G3** — `PermissionService` 인스턴스화 + composition root wire + 호출 site (CLI spawn 직전, file I/O 직전).
- **G4** — `setExecutionWorkspaceRoot` 호출 + ExecutionService singleton 초기화.
- **G6** — `MeetingSession.setProjectPath` dead method 검토 후 정리.
- **G7** — `ExecutionService.ensureAccess` optional 제거 + 미주입 시 throw.

**회귀 가드 셋 (의무)**:
1. **`AbsolutePath` brand type** — `string & { __brand: 'AbsolutePath' }`. `SsmContext.projectPath` 등 모두 brand. 빈 문자열 / 상대경로 컴파일 단계 차단.
2. **Runtime invariant** — `SsmContext` 생성자에서 빈 문자열 / 상대경로 throw.
3. **Integration test** — "회의 시작 path 4종 → spawn cwd = ArenaRoot 안" layer 통과 단언.

### 3.3 문제 2 (채팅 JSON 노출) — R12-C2 P2 의존

§2.2 의 surface 격차. *근본 해결* = R12-C2 P2 (회의 기능 — 의견 트리 + 일괄 동의 투표) 의 frontend 측 (parsing + 의견 카드 UI 컴포넌트) land. 본 R12-W phase 와 *완전 별 phase* 라 본 work-log 의 직접 책임 X — 그러나 사용자 가시 surface 격차라 *short-term 완화* 결재가 R12-W T11+ 진입과 평행 가능.

**short-term 완화 옵션** (R12-C2 P2 본 land 까지):
| 옵션 | 본문 | 비용 | 위험 |
|---|---|---|---|
| A | AI 시스템 프롬프트에 "사용자 가시 채팅 본문에 JSON 박지 마라" 1줄 추가 → AI 가 markdown / 자연어 응답 | 매우 낮음 (PromptComposer 1줄) | AI 가 가끔 무시 가능. R12-C2 P2 의 *의견 트리 parsing* 가 land 되면 본 가드 제거 필요 |
| B | 메시지 컴포넌트가 *JSON parse 시도 → 성공하면 의견 카드 fallback UI 임시 렌더, 실패하면 raw* | 중간 (Message.tsx + 임시 의견 카드 컴포넌트) | parsing 잔여 책임이 R12-C2 P2 와 *2 곳* 분산 — 본 land 후 cleanup 필요 |
| C | R12-C2 P2 진입 가속화 (R12-W T11+ 와 평행) | 매우 높음 (큰 phase) | R12-W T11+ 와 worktree 공유 가능성. 우선순위 충돌 |

본 work-log 는 옵션 결재 후 *follow-up task 또는 phase 진입 결재* 기록 영역.

### 3.4 문제 3 (codex + gemini 응답 실패) — 별 follow-up

§2.3 의 본문 표 참조. dogfooding 신호 비율 회복을 위해 *임시 완화* 가 R12-W T11+ 진입과 평행 가능:

| Provider | 임시 완화 옵션 | 우선순위 |
|---|---|---|
| codex | 옵션 B: `CliProvider` (codex) spawn argv 에 `--skip-git-repo-check` 자동 추가 — 가장 빠른 완화 | 🟠 high (dogfooding 차단) |
| codex | 옵션 A: `ProjectService.create` 시 `git init` 자동 — *spec 정합도 더 높음* | 🟡 medium (사용자 결재 영역) |
| gemini | spawn argv + payload trace 로 *어디서 hang* 격리 → 진단 후 fix | 🟡 medium |
| gemini | 단순 timeout 늘림 (30s → 60s+) — 본질 해결 X | 🟢 low (응급) |

### 3.5 기타 별 follow-up

| 항목 | 우선순위 | 비고 |
|---|---|---|
| WSL/Windows 빌드 mismatch ADR | 🟡 medium | `docs/reports/analysis/` 새 ADR 또는 CI 자동화 |
| dead helper `createDefaultSsmContext` 삭제 | 🟢 low | R12-X 또는 후속 cleanup |
| `stream-types.ts` 의 옛 `StreamPermissionPendingEvent` / `PermissionRequest` 잔재 (R7-Task4 폐기 잔재) | 🟢 low | 본 work-log §"Follow-up 메모" 캡쳐. 의존 cleanup 별 phase |
| `meeting-turn-executor.ts` 의 `arenaRootService` private field (T9 후 페르소나 합성 path 에서 미사용) | 🟢 low | 후속 cleanup 영역 |

### 3.6 후속 phase (V4 / R12+)

`docs/구현-현황.md` 본문 참조 — R12-W / R12-X 외 phase 의 이연 list.

---

## 4. 참조 문서 / 메모리 path

### 4.1 권위 문서 (`docs/*.md` 루트)

| 문서 | 경로 | 역할 |
|---|---|---|
| 문서 폴더 정책 | `docs/README.md` | 폴더별 용도 + 명명 규칙 |
| 기능 정의서 | `docs/기능-정의서.md` | Rolestra v3 메타포 + 11 phase 누적 기능 (무엇을 만드는가) |
| 설계 문서 | `docs/설계-문서.md` | 4 layer 아키텍처 + 핵심 모듈 + 6 테마 + 패키징 (어떻게 만드는가) |
| 코딩 규칙 | `docs/코딩-규칙.md` | 어떤 규칙을 지키는가 |
| 완료 기준 | `docs/완료-기준.md` | 언제 끝난 것인가 |
| 구현 현황 | `docs/구현-현황.md` | R1~R12-X phase 별 status + commit |

### 4.2 본 phase 산출물

| 종류 | 경로 |
|---|---|
| R12-W ADR | `docs/R12_c2_2R/decisions/r12-w-member-file-permission.md` |
| R12-W plan (T10.5 포함) | `docs/R12_c2_2R/plans/2026-05-11-rolestra-r12-w-member-file-permission.md` |
| R12-W audit (PathGuard wire 격차) | `docs/R12_c2_2R/reports/audit/2026-05-12-r12-w-pathguard-wire-audit.md` |
| R12-W work-log T1~T10 (LOCAL_ONLY) | `docs/R12_c2_2R/reports/work-log/rolestra-r12-w-t1-t10-progress.md` |
| R12-W / R12-X 현 상태 (본 파일, docs 루트 = 권위 위치) | `docs/rolestra-r12-w-x-2026-05-12-state.md` |
| R12-X ADR | `docs/R12_c2_2R/decisions/r12-x-pathguard-wire-up.md` |
| R12-X plan | `docs/R12_c2_2R/plans/2026-05-12-rolestra-r12-x-pathguard-wire-up.md` |

### 4.3 cross-cutting / 전역 결정

| 종류 | 경로 |
|---|---|
| cross-cutting ADR | `docs/decisions/cross-cutting.md` (해당 시) |
| R12 도메인별 ADR | `docs/decisions/r12-c-*.md`, `docs/decisions/r12-s-*.md` 등 |
| 단일 권위 spec | `docs/specs/2026-04-18-rolestra-design.md` (134 KB, 11 phase 누적) |
| spec 의 토픽별 design | `docs/specs/` 안 day-dated md |

### 4.4 instruction / 글로벌 규칙

| 종류 | 경로 |
|---|---|
| 프로젝트 instruction | `CLAUDE.md` (저장소 루트, R12-W 의 절대 위반 금지 규칙 등) |
| 사용자 글로벌 instruction | `~/.claude/CLAUDE.md` (Work Principles + 절대 금지 + 에이전트 정책) |

### 4.5 메모리 path (host-local)

| 종류 | 경로 |
|---|---|
| 자동 메모리 (사용자 + feedback + project + reference) | `/home/taniar/.claude/projects/-mnt-d-Taniar-Documents-Git-Rolestra-r12c2-r2/memory/` |
| 메모리 인덱스 | 위 디렉토리의 `MEMORY.md` |

**주의**: 메모리는 사용자 host (WSL) 한정 — 다른 환경에서 접근 불가. 다른 세션 / 다른 환경 진입 시 *git log + plan/ADR + work-log* 로 컨텍스트 복원.

### 4.6 외부 참조 프로젝트 (같은 git 폴더 내)

| 프로젝트 | 경로 | 용도 |
|---|---|---|
| AI Chat Arena v1 (Python/FastAPI/Svelte) | `/mnt/f/hayoung/git/AI_Chat/` | 멀티파티 메시지 변환, 팩토리 패턴 provider, anti-sycophancy 참고 |
| bara_system (메모리 시스템) | `/mnt/f/hayoung/git/bara_system/` | hybrid search, Stanford 3-factor scoring, SQLite+FTS5+embeddings — Memory Phase 3-b (R12+) 의존 |

### 4.7 환경 troubleshoot 메모 (host-local 한정)

WSL 안에서 git 작업 시:

```bash
export GIT_DIR=/mnt/d/Taniar/Documents/Git/Rolestra/.git/worktrees/Rolestra-r12c2-r2
export GIT_WORK_TREE=/mnt/d/Taniar/Documents/Git/Rolestra-r12c2-r2
```

| 이슈 | 원인 | 해소 |
|---|---|---|
| `git status` → `fatal: not a git repository: ...D:/Taniar/.../Rolestra-r12c2-r2` | `.git` 파일이 Windows 절대경로 (`D:/...`) — WSL 에선 `/mnt/d/...` 필요 | 위 export |
| `Cannot find module @rollup/rollup-linux-x64-gnu` (vitest) | npm optional dependency 버그 (Windows 빌드 환경에서 Linux native binding 누락) | `npm install --no-save @rollup/rollup-linux-x64-gnu` |
| `invalid ELF header` for `better_sqlite3.node` | Windows 빌드 native module 이 WSL Node 에서 못 돔 | `npm rebuild better-sqlite3` |
| WSL commit 이 Windows electron main bundle 에 반영 안 됨 | WSL 의 빌드 산출물 ≠ Windows 의 빌드 산출물 | Windows PowerShell 에서 `npm run build` 또는 `npm run dev` 재실행 |

---

## 5. 다음 세션 진입 시 quick start

```bash
# WSL 에서 git 작업:
export GIT_DIR=/mnt/d/Taniar/Documents/Git/Rolestra/.git/worktrees/Rolestra-r12c2-r2
export GIT_WORK_TREE=/mnt/d/Taniar/Documents/Git/Rolestra-r12c2-r2

# 진행 상태 확인:
git log --oneline -15        # R12-W T10.5 hotfix 3 commit + 이전 R12-W 5 commit + R12-C2 잔재
git status                   # R12-X 산출물 (ADR + plan) 등 untracked

# 본 work-log 본문 (가장 권위 있는 단일 출처):
cat docs/rolestra-r12-w-x-2026-05-12-state.md
```

### 다음 행동 결정 트리

1. **dogfooding hotfix 효과 검증 우선** (현재 진행 중):
   - Windows 빌드 grep 결과로 hotfix 코드 박혔는지 확정 → PASS 시 dogfooding 재시도 → Claude 응답 본문으로 cwd 정합 결론.
   - Claude 응답 본문에 *rolestra source repo docs* list 가 또 나오면 → 가설 3 (singleton race) 또는 4 (AI 도구 cwd 무시) 진단 진입.
   - Claude 응답이 *사용자 프로젝트 폴더의 docs* 또는 "docs 없음" 이면 → ✅ hotfix 효과 확인. T11+ 진입 결재.

2. **별 격차 처리 (병렬 가능)**:
   - codex trust list — A vs B 사용자 결재.
   - gemini hang — trace.
   - WSL/Windows 빌드 ADR — 새 analysis report 후보.

3. **R12-X 진입**:
   - dogfooding 효과 검증 PASS 후 R12-W 종결 → R12-X ADR/plan commit + 정식 phase 시작.
   - 또는 T10.5 의 한계 (singleton race) 가 사용자 가시 위험이면 R12-X 먼저 진입 (T11+T12 와 직렬 vs 평행 결재).
