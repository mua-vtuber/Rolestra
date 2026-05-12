---
name: R12-W T1~T10 진행 현황 + dogfooding 발견 → R12-X 분기 (2026-05-12)
description: T1~T10 land 후 dogfooding 으로 spec §7.6 PathGuard 봉인 chain 이 R2 land 이후 *production runtime 에서 한 번도 호출 안 된 dead-infrastructure* 임이 발견됨. R12-W 안에 T10.5 hotfix (G1+G2+G5) + R12-X 정식 phase 분리 (G3+G4+G6+G7 + 회귀 가드) 결재 완료. 새 세션 이어받기 가이드.
type: project
locality: LOCAL_ONLY — git untracked, 사용자 호스트 한정. 다른 세션은 git log + plan/ADR 로 접근.
---

# R12-W T1~T10 진행 + R12-X 분기 (2026-05-12 갱신)

## 새 세션 진입 시 우선 읽기

세션 끊김 / 다른 환경에서 이어받을 때 다음 순서로 컨텍스트 복원:

1. 본 work-log 본문 (현재 파일)
2. `docs/R12_c2_2R/reports/audit/2026-05-12-r12-w-pathguard-wire-audit.md` — PathGuard 봉인 chain dead-infrastructure audit (planner 산출)
3. `docs/R12_c2_2R/decisions/r12-w-member-file-permission.md` — R12-W ADR
4. `docs/R12_c2_2R/plans/2026-05-11-rolestra-r12-w-member-file-permission.md` — R12-W plan (T10.5 보정 포함 예정)
5. `docs/R12_c2_2R/decisions/r12-x-pathguard-wire-up.md` (작성 예정) — R12-X ADR
6. `docs/R12_c2_2R/plans/2026-05-12-rolestra-r12-x-pathguard-wire-up.md` (작성 예정) — R12-X plan

새 세션 첫 액션:
```bash
export GIT_DIR=/mnt/d/Taniar/Documents/Git/Rolestra/.git/worktrees/Rolestra-r12c2-r2
export GIT_WORK_TREE=/mnt/d/Taniar/Documents/Git/Rolestra-r12c2-r2

git log --oneline -10                       # R12-W 5 commit + 이후 작업 land 여부 확인
cat docs/R12_c2_2R/reports/work-log/rolestra-r12-w-t1-t10-progress.md   # 본 파일
ls docs/reports/audit/                      # audit 산출물 확인
ls docs/decisions/r12-{w,x}*.md             # ADR 확인
ls docs/plans/2026-05-1{1,2}*.md            # plan 확인
```

## 다음 작업 entry point (사용자 결재 완료)

**R12-W T10.5 hotfix 즉시 시작 → 사용자 dogfooding 검증 → T11+ 또는 R12-X 진입**

상세 작업 list 는 본 work-log §"R12-W T10.5 hotfix 작업 list (새 세션 즉시 시작)" 섹션 참조.

---

# 본 phase 본문 (T1~T10 land 기록)

worktree `feat/r12-c2-redesign-r2`, 본 phase 의 baseline `7c39e92` (R12-C2 P6 dogfooding 진입 가이드). 5 commit land, **누적 ~2,000 LoC, 2885 production 테스트 PASS** (4 skipped).

**Why:** 사용자 dogfooding 보고 — 작업장 + 채널 (부서) 컨텍스트의 회의에서 AI 가 `docs/messenger-mockup-tool-spec.md` 같은 spec 문서를 읽으려 하지 않고 "본 회의 채널 규칙상 파일을 직접 읽지 못해..." 라고 자기검열. 원인 = `meeting-turn-executor.ts:535` 의 `buildPermissionRules({permission: null})` 하드코딩이 *항상* "어떤 파일도 접근하지 마라" 시스템 프롬프트를 발사하던 회귀.

**How to apply:** R12-W 는 R12-C2 와 평행 phase (worktree 동일). T1~T10 land 후 dogfooding 체크포인트 도달 — 같은 시나리오 재시도 후 결과 보고 받고 T11+ 진입 결정. T11~T17 (argv filter + UI + composition + verify + 문서) 은 아직 미진행.

---

## 사용자 핵심 결재 (2026-05-11~12)

| # | 결정 포인트 | 확정 |
|---|------------|------|
| D1 | 권한 부여 단위 | **채널 1:1** (부서 = 기본 채널의 라벨 — 사용자 mental model) |
| D2 | 미설정 기본 | **최소 읽기 허용** (PromptComposer fallback 1줄 + ALTER DEFAULT file_read=1) |
| D3 | 저장 위치 | **channels 테이블 5컬럼 ALTER** (마이그레이션 023, 신규 도메인 없음) |
| D4 | 조회 시점 | **회의 시작 1회 캐싱 + 'permission-changed' invalidation** → 다음 turn 재조회 |
| D5 | argv 동기화 | **2단계 filter** — spec §7.6.3 매트릭스 무손상 + 직원 권한으로 좁힘 (**T11 미진행**) |
| 별도1 | 회의록 쓰기 권한 | **불필요** — `#회의록` 채널 메시지 시스템 append, 파일 권한 무관 |
| 별도2 | 구현 부서 동시 작업 | **별도 follow-up** — 채널 단위 권한 분리로 자연 해결, 같은 채널 내 동시성은 별도 ADR |
| UI | 부서 default 사용자 수정 | **불가** (옵션 ①) — 카탈로그 고정, 채널 단위에서만 override |
| UI | 채널 모달 권한 입력 | **부서 template + 미세조정** (옵션 ①) |

mental model 정정 history — 직전 라운드에서 planner+claude 가 "프로젝트 × 부서" 매트릭스로 가정, 사용자가 "부서 == 기본 채널" 이라는 사실 명시 후 **권한 단위가 채널 1:1 로 단순화** (DB 별도 테이블 0, IPC 3→2, UI 별도 탭 → 채널 모달 안 섹션). 코드 추정 22% 감소.

---

## 산출물 위치

| 종류 | 파일 |
|------|------|
| ADR | `docs/R12_c2_2R/decisions/r12-w-member-file-permission.md` |
| Plan | `docs/R12_c2_2R/plans/2026-05-11-rolestra-r12-w-member-file-permission.md` |
| 본 work-log | `docs/R12_c2_2R/reports/work-log/rolestra-r12-w-t1-t10-progress.md` (이 파일, 로컬 한정) |

---

## land 된 commit 5개

| SHA | 내용 | LoC | Tests 누적 |
|-----|------|-----|------------|
| `6ebcabc` | docs(rolestra): R12-W ADR + plan 설계 문서 | 1,345 | — |
| `06c2051` | feat(rolestra): R12-W T1 + T2 — PromptComposer fallback 안내 + PermissionSet 공통 타입 | 351 | 23 |
| `033cb71` | feat(rolestra): R12-W T3~T7 — 채널 권한 backend layer | 897 | 99 (누적 122) |
| `8d98dbb` | feat(rolestra): R12-W T8 — MeetingSession 채널 권한 캐시 + invalidation | 226 | 28 (누적 150) |
| `e2f43e7` | feat(rolestra): R12-W T9 + T10 — MeetingTurnExecutor 권한 wire 교체 + 옛 buildPermissionRules 삭제 | 217 / −141 | 2885 회귀 0 |

---

## task 별 status

| T | 영역 | status | 핵심 산출물 |
|---|------|--------|------------|
| T1 | PromptComposer fallback 안내 + 회의록 권한 무관 명시 | ✅ land (`06c2051`) | `src/main/skills/prompt-composer.ts` line 74-86 |
| T2 | PermissionSet 공통 타입 + 카탈로그 default 변환 helper | ✅ land (`06c2051`) | `src/shared/permission-set-types.ts` 신규 (7 helper + 2 인터페이스) |
| T3 | migration 023 + 카탈로그 sanity 테스트 | ✅ land (`033cb71`) | `src/main/database/migrations/023-channel-permissions.ts` + sanity (drift 검출) |
| T4 | ChannelRepository edit | ✅ land (`033cb71`) | rowToChannel 5컬럼 + getPermissions / updatePermissions 메서드 |
| T5 | ChannelService — EventEmitter 승격 + 권한 메서드 + create 시 권한 채우기 | ✅ land (`033cb71`) | 5 channel literal 모두 permissions 자동 채움 (catalogDefaultFor / catalogDefaultForNullRole) |
| T6 | ChannelPermissionResolver | ✅ land (`033cb71`) | `src/main/permissions/channel-permission-resolver.ts` 신규 |
| T7 | IPC 핸들러 2채널 + zod | ✅ land (`033cb71`) | `channel:get-permissions` / `channel:update-permissions` |
| T8 | MeetingSession 캐시 + invalidation | ✅ land (`8d98dbb`) | attachPermissionInvalidation / getPermissions / detachPermissionInvalidation |
| T9 | MeetingTurnExecutor 호출 교체 | ✅ land (`e2f43e7`) | meeting-turn-executor.ts:550-572 — 옛 buildPermissionRules 폐기 + PromptComposer.compose 단일 진입 |
| T10 | 옛 buildPermissionRules + FilePermission 삭제 | ✅ land (`e2f43e7`) | persona-permission-rules.ts 삭제, file-types.ts 정리 |
| **T11** | **permission-flag-filter (D5)** | ❌ **미진행** | Claude `--allowedTools` 콤마 리스트를 PermissionSet 으로 좁힘 |
| **T12** | **cli-provider spawn wire-up** | ❌ **미진행** | spawn 직전 base argv → filter 호출 → spawn argv |
| **T13** | **use-channel-permissions hook + zustand** | ❌ **미진행** | renderer side state |
| **T14** | **채널 생성 모달 — 부서 template + 권한 섹션** | ❌ **미진행** | UI |
| **T15** | **채널 설정 모달 — 권한 섹션 + template 리셋** | ❌ **미진행** | UI |
| **T16** | **i18n ko/en JSON** | ❌ **미진행** | 부서 template 5종 라벨 + 5 axis 라벨 |
| **T17** | **Composition root DI** | ⚠️ **부분 land** | main/index.ts 의 SkillService / PromptComposer / ChannelPermissionResolver wire 는 T9 와 함께 land. 남은 부분 (renderer hook + UI mount) 은 T13~T16 위. |
| **T18** | **spec §7.6.4 신설** | ❌ **미진행** | "직원-권한 filter layer" 본문 1 페이지 |
| **T19** | **vitest 통합** | ⚠️ **회귀 검증만** | 신규 통합 시나리오 (예: 부서 채널 + 권한 변경 → 다음 turn argv 좁힘) 는 T11+T12 의존 |
| **T20** | **E2E Playwright** | ❌ **미진행** | 사용자 보고 시나리오 — `messenger-mockup-tool-spec.md` 읽기 |
| **T21** | **문서 / closeout** | ❌ **미진행** | ADR 본문 갱신 (실제 SHA + LoC) + 구현-현황.md |

---

## dogfooding 체크포인트 (2026-05-12)

**시도할 시나리오:**
- 작업장 1개 (예: 신규 프로젝트) 생성 시 자동 생성되는 기본 부서 채널 (#아이디어 / #기획 / #구현 / #검토 / #디자인) 중 하나 진입
- "docs 폴더의 messenger-mockup-tool-spec.md를 읽어보고, 더하는게 좋을 기능이 뭐가 있을지 봐줘" (이전 dogfooding 메시지 동일)
- AI 의 첫 응답을 관찰

**예상 결과 (T9 land 후):**
- AI 가 spec 파일을 실제로 읽기 시도 (Claude Code 의 Read 도구 호출) → 정상 의견 제출
- 시스템 프롬프트는 PromptComposer 의 활성 분기 / fallback 분기에서 `권한: 파일 읽기 ...` 또는 `권한: 작업장 폴더 안 파일 읽기 ...` 명시 — 자기검열 발언 ("본 회의 채널 규칙상 파일을 직접 읽지 못해...") 사라짐

**만약 그래도 자기검열한다면:**
- 그 직원이 부서 능력 미부여 → PromptComposer fallback 분기 진입 (T9 가 활성 분기만 변경, fallback 은 T1 으로 변경됨 — D2 안내 + 회의록 무관 명시 1줄 들어감)
- fallback 분기의 안내가 충분한지 재검토 필요. AI 가 여전히 "기본 부서 외 능력 없음" 으로 해석해 자기 검열한다면, fallback 메시지를 더 명시 형태로 갱신할지 결정.
- 또 dogfooding 시 *어떤 직원* 이 발화했는지 확인 — 능력 부여 직원과 미부여 직원이 같은 채널에 있으면 결과가 섞임.

**dogfooding 결과 입력이 다음 결정 트리거:**
- ✅ 자기검열 사라짐 + AI 가 spec 읽음 → **T11+T12 진입 결재** (argv 도 직원 권한으로 좁히는 hard layer)
- ⚠️ 자기검열 부분 사라짐 (일부 직원만) → fallback 메시지 보강 sub-task
- ❌ 자기검열 여전 → 원인 재진단 (다른 layer 가 막고 있을 가능성)

---

## T11~T21 후속 작업 — 어디부터 다시 진입할지

dogfooding 결과 +ve 일 시 가장 자연스러운 순서:

1. **T11 + T12** (argv filter) — backend 의 마지막 hard layer. 작업장 mode = auto 여도 직원 권한이 `fileWrite=false` 면 CLI argv 가 `Edit/Write` 도구 제거. 시스템 프롬프트 자기검열에 의존하지 않는 다중 방어.
2. **T13 + T14 + T15** (UI) — 채널 생성 / 설정 모달에 권한 섹션 mount. 부서 template + 미세조정 토글. **사용자 가시 변화의 본격 진입**.
3. **T16** (i18n) — UI 라벨 ko/en JSON.
4. **T18 + T19 + T20 + T21** (verify + 문서) — spec §7.6.4 본문 신설, E2E 1 시나리오, ADR / 구현-현황 closeout.

T11 / T12 의 plan 본문에 명시된 **sub-task 11a** — Claude CLI 의 `--allowedTools ""` (빈 리스트) 거동 검증 필요 (실험 후 결정). plan 본문이 fail-closed 방향 추천했지만 실제 거동 봐서 결정.

---

## 호스트 환경 troubleshoot 메모

R12-W 진행 중 발생한 환경 이슈 + 해소 방법:

| 이슈 | 원인 | 해소 |
|------|------|------|
| `git status` → `fatal: not a git repository: ...D:/Taniar/.../Rolestra-r12c2-r2` | `.git` 파일이 Windows 절대경로 (`D:/...`) 를 가리키지만 WSL 에선 `/mnt/d/...` 로 접근해야 함 | `GIT_DIR=/mnt/d/Taniar/Documents/Git/Rolestra/.git/worktrees/Rolestra-r12c2-r2 GIT_WORK_TREE=/mnt/d/Taniar/Documents/Git/Rolestra-r12c2-r2 git ...` 형태로 환경변수 우회. **`.git` 파일 자체는 안 건드림** (Windows 쪽 worktree 무영향 보호) |
| `Cannot find module @rollup/rollup-linux-x64-gnu` (vitest 실행 시) | npm optional dependency 알려진 버그 (Windows 빌드 환경에서 Linux native binding 누락) | `npm install --no-save @rollup/rollup-linux-x64-gnu` (package.json 미변경) |
| `invalid ELF header` for `better_sqlite3.node` | Windows 빌드된 native module 이 WSL Node 에서 못 돌아감 (Electron-rebuild 잔재) | `npm rebuild better-sqlite3` (Linux Node 용 재컴파일) |

세 가지 모두 host environment 차원의 부수 작업이라 commit 영향 0. 다음 세션 진입 시 같은 troubleshoot 다시 필요할 수 있음 — node_modules 상태에 따라.

---

## 사용자가 다음 세션 진입 시 quick start

```bash
# WSL 에서 git 사용 (3 commit 이상 진행 예정이면 export 한 번):
export GIT_DIR=/mnt/d/Taniar/Documents/Git/Rolestra/.git/worktrees/Rolestra-r12c2-r2
export GIT_WORK_TREE=/mnt/d/Taniar/Documents/Git/Rolestra-r12c2-r2

# 진행 상태 확인:
git log --oneline -10        # R12-W 5 commit + R12-C2 잔재
git status                   # untracked work-log + 사용자의 다른 작업 (별 영역)

# 회귀 빠른 검증:
npx vitest run src/main/skills/__tests__/prompt-composer.test.ts \
                src/shared/__tests__/permission-set-types.test.ts \
                src/main/database/__tests__/migration-023-sanity.test.ts \
                src/main/channels/ \
                src/main/permissions/__tests__/channel-permission-resolver.test.ts \
                src/main/ipc/handlers/__tests__/channel-permission-handler.test.ts \
                src/main/meetings/engine/__tests__/meeting-session.test.ts \
                src/main/meetings/engine/__tests__/meeting-turn-executor.test.ts
# 예상: 1042+ tests PASS
```

dogfooding 시 사용자 발화 + AI 의 첫 응답 캡쳐해두면 본 문서 dogfooding 섹션 갱신 자료가 됨.

---

## Follow-up 메모 (R12-W 외 / 정리 캡쳐)

- `stream-types.ts` 의 `StreamPermissionPendingEvent` + `PermissionRequest` — R7-Task4 폐기 잔재. R12-W T10 삭제 후보였지만 의존 cleanup 별 phase 로 미룸.
- `meeting-turn-executor.ts` 의 `arenaRootService` — T9 후 페르소나 합성 path 에서 미사용. deps 와 private field 는 유지 (다른 호출자 회귀 차단). 후속 cleanup 단계가 정리할 영역.
- `meeting-turn-executor.ts` 의 JSDoc line 23 — 옛 `buildPermissionRules` 언급 잔재 (T9 노트는 별 line). 본 라인도 정리 후보.

---

# 2026-05-12 dogfooding 결과 + audit + R12-X 분기 (갱신)

## dogfooding 1회차 결과

사용자 dogfooding 시나리오: 새 프로젝트 생성 + 부서 채널 + 사용자 메시지 `"docs 보고 의견"` (이전 시나리오 동일).

### R12-W T9 효과 검증 결과 — ✅ 성공

| 항목 | 검증 |
|---|---|
| AI 자기검열 메시지 ("본 회의 채널 규칙상…") | ✅ **사라짐** |
| AI 가 Read 도구 호출 시도 | ✅ **확인** — Claude 가 rawLength=23,658 응답 (파일 list dump) |
| 시스템 프롬프트의 권한 단락 발사 | ✅ 확인 (도구 사용 시도 = 권한 인식) |

→ R12-W 의 핵심 backend 효과 = **권한 wire 자체는 작동**.

### 그러나 사용자 발견 — spec §7.6 봉인 chain 무너짐

사용자 mental model:
> "rolestra의 권한은 rolestra폴더 안에 한정되는거지 ... 내가 docs를 읽어 하면 rolestra폴더안에 만든 프로젝트 폴더안의 docs폴더를 읽어야하는데"

실제 동작:
- AI 가 작업장 폴더가 아니라 **앱 실행 위치 (= rolestra source repo `D:\Taniar\Documents\Git\Rolestra-r12c2-r2`) 의 docs/** 를 list
- 사용자가 만든 프로젝트와 완전히 다른 폴더 노출

→ spec §7.6 PathGuard 봉인이 사용자가 본 surface 에서 무력화.

### 사용자 사고 — dogfooding 환경 정리

- 옛 직원 추가 버그 시점의 dirty 프로젝트 누적 → DB 전체 초기화 (선택지 A) 진행. `D:\Taniar\Documents\Rolestra\db\arena.sqlite` + WAL + SHM 삭제. 앱 재시작 후 마이그레이션 fresh land.
- 별 사전 wire 이슈 — boot warmup race (CLI ping 5초 timeout 초과). 두 번째 부팅 시 자연 회복.

---

## audit 결과 — spec §7.6 PathGuard chain 전체 dead-infrastructure

산출물: `docs/R12_c2_2R/reports/audit/2026-05-12-r12-w-pathguard-wire-audit.md`

### 한 줄 결론

R2 Task 6 에서 land 된 PermissionService 코드는 **production runtime 에서 한 번도 호출된 적이 없음**. 1.5~2중 방어 의도 → 실제 0~0.5중.

### 7 격차 (위험도 순)

| ID | 격차 | 위험도 | 표면화 |
|---|---|---|---|
| **G3** | `PermissionService` 인스턴스화 0, 호출 0 — *마지막 방어선 자체 부재* | 🔴 critical | 미표면 |
| **G1** | `CliProvider._projectPath = '.'`, `setProjectPath` 호출자 0 | 🟠 high | ✅ 사용자 보고 |
| **G2** | `ssmCtx.projectPath: ''` 4곳 하드코딩 (`index.ts:612, :1221`, `channel-handler.ts:350`, `default-meeting-starter.ts:215`) | 🟠 high | 간접 (G1 결합) |
| **G4** | `setExecutionWorkspaceRoot` 호출자 0 → ExecutionService singleton 미초기화 | 🟡 medium | 미표면 |
| **G5** | `permissionMode:'hybrid'` / `autonomyMode:'manual'` 하드코딩 — 사용자 mode 무력화 | 🟡 medium | 미표면 |
| **G6** | `MeetingSession.setProjectPath` 호출자 0 (dead method) | 🟡 medium | 미표면 |
| **G7** | `ExecutionService.ensureAccess` optional + 미주입 시 silent skip — CLAUDE.md 위반 | 🟡 medium | 미표면 |

### 위험도 분리

- 실제 보안 (악의적 격리 우회): **low** — Rolestra 는 자기 AI 에게 자기 PC 권한 위임 모델
- 사용자 신뢰성 / mental model: **high** — spec §7.6 정본 위반
- 데이터 무결성 (사고 위험): **medium** — 현 read-only argv 라 OK. mode `auto` + T11 미land 면 **high**
- 방어 layer 존재 자체: **🔴 critical** — 1.5~2중 → 0~0.5중

### Root cause 패턴

**"land 단계 책임자가 wire 단계 책임자에게 인계 안 함"**. R2~R12 각 phase 가 자기 domain 만 책임 — cross-cutting wire 가 누구의 phase 책임도 아닌 사각.

회귀 가드 5종 모두 부재:
1. type 가드 (brand type `AbsolutePath`)
2. runtime invariant (생성자 빈 문자열 throw)
3. integration test (layer 통과 단언)
4. E2E argv 캡처 (Playwright 가 UI 만 검증, spawn argv 미확인)
5. dead-code 검출 (public method 호출자 0 인데 lint 통과)

---

## 사장 결재 완료 (2026-05-12)

| # | 결재 | 확정 |
|---|------|------|
| Q1 | fix 묶음 구조 | **C 변형** — R12-W T10.5 hotfix (G1+G2+G5) + R12-X 정식 분리 (G3+G4+G6+G7 + 회귀 가드) |
| Q2 | hotfix 시점 | **즉시** — T11 진입 전 의무 |
| Q3 | R12-X 회귀 가드 | **다 포함** — brand `AbsolutePath` + integration test + invariant |
| Q4 (자연) | R12-X 시점 | R12-W 종결 후 |
| Q5 (자연) | T11+ 시점 | hotfix land + dogfooding 검증 후 |

---

## R12-W T10.5 hotfix 작업 list (새 세션 즉시 시작)

planner 가 R12-W plan 본문에 T10.5 sub-block 추가 작성 중. plan 갱신 land 후 다음 작업 진입:

### G2 — `ssmCtx.projectPath` 4곳 fix (base)

각 회의 시작 path 의 `projectPath: ''` 또는 `projectPath: '\'`(?) 하드코딩을 정확한 cwd 로 교체. 우선 `resolveProjectPaths(project, arenaRoot.getPath()).cwdPath` 직접 호출 (G3 PermissionService 정식 wire 는 R12-X 책임).

| 위치 | 현재 | 교체 후 |
|------|------|---------|
| `src/main/index.ts:612` | `projectPath: ''` 하드코딩 | `resolveProjectPaths(project, arenaRoot.getPath()).cwdPath` |
| `src/main/index.ts:1221` | 동일 | 동일 |
| `src/main/ipc/handlers/channel-handler.ts:350` | 동일 | 동일 |
| `src/main/queue/default-meeting-starter.ts:215` | 동일 (`buildSsmCtx`) | 동일 |

### G5 — `permissionMode` / `autonomyMode` 하드코딩 fix (G2 와 같은 4곳)

`permissionMode: 'hybrid'` / `autonomyMode: 'manual'` 하드코딩 → `project.permissionMode` / `project.autonomyMode` 로 교체. 사용자 mode 설정 반영.

### G1 — `CliProvider.setProjectPath()` wire

`MeetingTurnExecutor.executeTurn` 의 `provider.streamCompletion` 호출 직전:

```ts
if (provider instanceof CliProvider) {
  provider.setProjectPath(this.session.ssmCtx.projectPath);
  this.wireCliPermissionCallback(provider, speaker);
}
```

provider 인스턴스는 회의별 재사용이라 매 turn setProjectPath 호출 필수 (사용자가 회의 도중 다른 채널/프로젝트 회의 시작 가능).

### Verify

```bash
npx vitest run src/main/meetings/engine/__tests__/meeting-turn-executor.test.ts \
                src/main/queue/__tests__/default-meeting-starter.test.ts \
                src/main/ipc/handlers/__tests__/channel-handler.test.ts
# G2/G5 호스트 default 변경 → 회귀 단언 갱신 필요
```

### Acceptance

- 큐 회의 시작 / `channel:start-meeting` / `handoff:start-meeting-from-package` / auto-trigger 4 path 모두 `ssmCtx.projectPath` = `<ArenaRoot>/projects/<slug>/` 절대 경로
- CLI spawn 시 `child.cwd` = 같은 절대 경로 (process.cwd() fallback X)
- 사용자 mode 설정 (`project.permissionMode='auto'` 등) 이 ssmCtx 에 그대로 흐름
- 사용자 dogfooding 시나리오 재현 — AI 가 *사용자가 만든 프로젝트 폴더의 docs/* 를 list (rolestra source 가 아닌)

---

## R12-X phase 작업 list (R12-W 종결 후)

planner 가 ADR + plan 작성 중. 도착 시 본 work-log 갱신 또는 R12-X 별 work-log 신설.

핵심 작업:
- **G3** — `PermissionService` 인스턴스화 + composition root wire + 호출 site (CLI spawn 직전, file I/O 직전) wire
- **G4** — `setExecutionWorkspaceRoot` 호출 + ExecutionService singleton 초기화
- **G6** — `MeetingSession.setProjectPath` dead method 검토 후 정리 (R12-W T10.5 hotfix 후 자연 정리 가능)
- **G7** — `ExecutionService.ensureAccess` optional 제거 + 미주입 시 throw (silent fallback 금지)

회귀 가드 셋:
1. **`AbsolutePath` brand type** — `string & { __brand: 'AbsolutePath' }` 도입. `SsmContext.projectPath` 등 모두 brand. 빈 문자열 / 상대경로 컴파일 단계 차단.
2. **Runtime invariant** — `SsmContext` 생성자에서 빈 문자열 / 상대경로 throw.
3. **Integration test** — "회의 시작 path 4종 → spawn cwd = ArenaRoot 안" layer 통과 단언.

---

## 새 세션 진입 시 작업 시작 순서

1. **planner 산출물 land 확인** — R12-W plan (T10.5 추가) + R12-X ADR + R12-X plan 본문 존재 확인. 사용자가 commit 여부 결정.
2. **R12-W T10.5 hotfix 진행** — G1 + G2 + G5 fix (위 작업 list)
3. **사용자 dogfooding 검증** — DB 초기화 없이 사용자가 hotfix 효과 dogfooding (의도한 폴더의 docs 가 list 되는지)
4. **R12-W 종결** — T10.5 land + T11~T21 (argv filter + UI + verify + 문서) 진행 또는 R12-X 먼저
5. **R12-X 정식 phase 시작** — ADR/plan 결재 후 brand type + integration test + invariant 가드 진행

---

## R12-W T1~T10 land 상태 (DB 초기화로 변경 없음)

| Commit | 내용 | LoC |
|---|---|---|
| `6ebcabc` | ADR + plan | 1,345 |
| `06c2051` | T1 + T2 | 351 |
| `033cb71` | T3~T7 | 897 |
| `8d98dbb` | T8 | 226 |
| `e2f43e7` | T9 + T10 | 217 / −141 |

총 5 commit, ~2,000 LoC, 2885 production tests PASS.

DB 초기화 후 마이그레이션 fresh land 자동 — 코드 변경 없음.
