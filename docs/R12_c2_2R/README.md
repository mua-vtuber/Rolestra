---
name: R12-C2 Round 2 (T0~T42 계획) + R12-W + R12-X — 통합 진행 상황 + 검토/검증 진입 (2026-05-12)
description: 본 worktree (feat/r12-c2-redesign-r2) 의 모든 R12-C2 2 라운드 작업 + 파생 phase (R12-W 채널 권한 / R12-X PathGuard 봉인 chain wire) 산출물 hub. 사용자 결재 — 구현 중단, 지금까지 한 범위 전면 검토/검증 우선. 검토 결과 "문제 없음" 확신 후에야 T30+ 또는 R12-W T11+ 또는 R12-X 진입 결재.
type: progress
---

# R12-C2 Round 2 — 통합 hub

> **본 폴더 (`docs/R12_c2_2R/`) 는 worktree `feat/r12-c2-redesign-r2` 의 모든 R12 작업 산출물을 모은 hub.** R12-C2 Round 2 (회의 시스템 재설계 + 8 후보 흡수, T0~T42 계획) + R12-W (채널 단위 파일 권한 wire-up, T1~T21) + R12-X (spec §7.6 PathGuard 봉인 chain 복원, G3+G4+G6+G7 + 회귀 가드 3종) 의 ADR / plan / audit / work-log 가 카테고리별 분류돼 있음.

---

## ⚠️ 현재 결재 (2026-05-12)

**구현 멈춤. 전면 검토 / 검증 우선.**

사용자 결재: 지금까지 land 한 범위 (R12-C2 T29 + R12-W T10.5 hotfix) 의 *전면 검토 + 검증* 을 먼저 진행. 이어가는 것은 **지금까지 만든 것에 문제가 없음을 확신한 이후**.

다음 단계 (T30+ / T11+ / R12-X 진입) 는 검토/검증 PASS 까지 *모두 hold*.

---

## TL;DR — 본 worktree 의 land 현황

| Phase | 의도 한 줄 | 상태 | 마지막 tip |
|---|---|---|---|
| **R12-C2 Round 1** (T0~T10b) | 옛 12 단계 SSM 폐기 + OpinionService backend + 의견 트리 + 일괄 동의 투표 backend | ✅ main land (`5472bef` ff merge → main tip `8e6a602`) | Round 1 종결 |
| **R12-C2 Round 2** (T11~T42 계획) | 참고 프로젝트 (Symphony / oa-py / alex-core) 8 후보 (A~H) 흡수 + P2~P8 phase 단위 | ⚠️ T29 까지 land (P6 dogfooding 진입 가이드 `7c39e92`) — T30~T42 미진입 | `7c39e92` |
| **R12-W** (T1~T21 계획) | 채널 단위 파일 권한 wire-up + AI 자기검열 제거 | ⚠️ T1~T10 land (`e2f43e7`) + T10.5 hotfix land (`d0992ee`) — T11~T21 미진입 | `eb8e063` |
| **R12-X** (G3+G4+G6+G7 + 회귀 가드 3종) | spec §7.6 PathGuard 봉인 chain 정식 wire + 회귀 가드 (brand `AbsolutePath` + runtime invariant + integration test) | 🆕 ADR + plan 산출물 작성 완료 — *commit 대기* (사용자 결재) | (산출물만) |

**사용자 명시 문제 요소 3 종** (dogfooding 3 round 결과, 본 문서 §2.1~§2.3 참조 → `rolestra-r12-w-x-2026-05-12-state.md`):
1. ❌ 프로젝트 폴더 봉인 위반 (rolestra source repo 의 docs/ 노출, spec §7.6)
2. ❌ 채팅 메시지에 application-level JSON 형식 노출 (R12-C2 P2 의 parsed UI 미land)
3. ❌ 코덱스 + 제미니 응답 실패 (codex trust list / gemini hang)

---

## 1. 폴더 navigation

```
docs/R12_c2_2R/
├── README.md                            ← 본 파일 (메인 진행 상황 정리, navigation index)
│
├── plans/                                ← phase 별 실행 plan + tasks.json
│   ├── 2026-05-04-rolestra-phase-r12-c2.md
│   ├── 2026-05-04-rolestra-phase-r12-c2.md.tasks.json
│   ├── 2026-05-11-rolestra-r12-w-member-file-permission.md
│   └── 2026-05-12-rolestra-r12-x-pathguard-wire-up.md
│
├── decisions/                            ← phase 별 ADR
│   ├── r12-c2-reference-projects-absorb.md   (R12-C2 Round 2 의 8 후보 흡수 결정)
│   ├── r12-w-member-file-permission.md       (R12-W 채널 단위 권한 wire-up)
│   └── r12-x-pathguard-wire-up.md            (R12-X PathGuard chain 복원)
│
└── reports/
    ├── audit/
    │   └── 2026-05-12-r12-w-pathguard-wire-audit.md   (PathGuard chain dead-infrastructure 7 격차 audit)
    └── work-log/
        ├── rolestra-r12-c2-entry.md
        ├── rolestra-r12-c2-round2-design-complete.md
        ├── rolestra-r12-c2-reference-projects-a3.md
        ├── rolestra-r12-c2-p1-completion.md
        ├── rolestra-r12-c2-p15-completion.md
        ├── rolestra-r12-c2-p21-completion.md
        ├── rolestra-r12-c2-p22-completion.md
        ├── rolestra-r12-c2-p23-completion.md
        ├── rolestra-r12-c2-p6-dogfooding-entry.md
        ├── rolestra-r12-c2-t10-split.md
        ├── rolestra-r12-c2-t10a-completion.md / -t10a-progress.md / -t10b-completion.md
        ├── rolestra-r12-c2-t11~t29-completion.md         (T11~T29 land work-log)
        └── rolestra-r12-w-t1-t10-progress.md             (R12-W T1~T10 + T10.5 host-local LOCAL_ONLY)
```

**본 폴더 외 (참조용, docs 루트 권위 위치)**:
- `docs/rolestra-r12-w-x-2026-05-12-state.md` — **R12-W/X 상세 + 사용자 명시 문제 3 종 + 가설 + 향후 계획** (여태까지 뭐가 만들어졌고 문제가 뭔지 파악하는 권위 문서, 본 README 의 §3 / §4 본문의 detail 참조 source)
- `docs/구현-현황.md` — R1~R12-X phase 별 status 권위 문서
- `docs/specs/2026-04-18-rolestra-design.md` — 단일 권위 spec (134 KB, 11 phase 누적, R12-C2 의견 트리 / 일괄 동의 spec §3, §4, §5, §11.13~§11.18)
- `docs/회의시스템-새로만들기-1차-쉬운설명.md` — R12-C2 회의 시스템 재설계 *쉬운 설명* 본문
- `docs/decisions/r12-c-channel-roles.md` — R12-C 1차 (R12-C2 의 선행 phase)
- `docs/plans/2026-05-02-rolestra-phase-r12-c.md` (+ tasks.json) — R12-C 1차 plan
- `docs/reports/audit/2026-05-03-r12-c-t1-t11-audit.md` — R12-C 1차 audit

---

## 2. R12-C2 Round 2 진행 현황 (T0~T42)

### 2.1 land 된 phase

| Round 2 Phase | 한 줄 (사무실 비유) | 핵심 task ID | land work-log |
|---|---|---|---|
| **P0** (entry) | 진입 + Round 2 설계 | — | `rolestra-r12-c2-entry.md` + `rolestra-r12-c2-round2-design-complete.md` |
| **P1** (spec round) | 직원 응답 JSON schema 정식화 + Round 2 결정 | — | `rolestra-r12-c2-p1-completion.md` |
| **P1.5** (정리) | 옛 12 단계 SSM 잔재 청소 + 직원 멤버 정확화 | — | `rolestra-r12-c2-p15-completion.md` |
| **P2** (기반) | 회의 backend 본체 — OpinionService + RunStep (A) + NextStep (B) + 6 헌법 감사관 (F) + 의견 트리 + 일괄 동의 투표 | T11 (F) + T12 (A) + T13 (B) + T14~T22 | `rolestra-r12-c2-t11~t22-completion.md` (T11~T22 land) |
| **P2.1~P2.3** (P2 정리) | P2 dogfooding 정리 + 변경 카드 fix | — | `rolestra-r12-c2-p21/p22/p23-completion.md` |
| **P5** (designated worker) | 임무 카드 (E capability manifest) + designated worker schema | T23 | `rolestra-r12-c2-t23-completion.md` |
| **P5 추가** | T24~T26 | T24, T25, T26 | `rolestra-r12-c2-t24/t25/t26-completion.md` |
| **P6 진입** (1~3 호) | handoff_dispatch table + HandoffPackage schema + HandoffDispatchService + HandoffApprovalModal + B handoff_mode 우회 + H2 받는 부서 첫 화면 | T27 (G) + T28 (B1) + T29 (H2) | `rolestra-r12-c2-t27/t28/t29-completion.md` + `rolestra-r12-c2-p6-dogfooding-entry.md` |

**가장 최근 R12-C2 tip**: `7c39e92` (R12-C2 P6 dogfooding 진입 가이드 — T27+T28+T29 land 후 사용자 Windows 위임).

### 2.2 미진입 phase (T30~T42)

R12-C2 plan (`plans/2026-05-04-rolestra-phase-r12-c2.md`) 의 P6~P8 잔여 + 디자인 라운드:

| Phase | 한 줄 | 후보 |
|---|---|---|
| **P6 잔여** | 큐 운영 시스템 (C) + 의미 단위 알림 (D) | T30 (D) / T31~T32 (C) / T34 (D 추가) |
| **P7** (대시보드) | 대시보드 진행률 (H1) + 6 헌법 감사관 phase 2 (F2) + 디자인 라운드 + land | T39 + T40 (H1) + T41 (F phase 2) |
| **P8** (closeout) | R12-C2 종결 commit + ADR / 구현현황 통합 + main merge | T42 |

세부 task list 는 `plans/2026-05-04-rolestra-phase-r12-c2.md.tasks.json` 본문 참조. ADR 결정 본문은 `decisions/r12-c2-reference-projects-absorb.md`.

### 2.3 R12-C2 에서 파생된 phase (R12-W, R12-X)

**R12-W** (채널 단위 파일 권한 wire-up) — R12-C2 P6 dogfooding 에서 *"AI 가 spec 파일 못 읽고 자기검열"* 격차 발견 → 회의 채널 단위 권한 부여 + AI 자기검열 제거 phase. R12-C2 와 같은 worktree, 평행 phase.

| R12-W phase | 한 줄 | 상태 |
|---|---|---|
| ADR + plan | 채널 1:1 권한 단위 결재 (사용자 mental model) + 5 axis | ✅ commit `6ebcabc` |
| T1+T2 | PromptComposer fallback 안내 + PermissionSet 공통 타입 | ✅ commit `06c2051` |
| T3~T7 | 채널 권한 backend layer (마이그레이션 023 + repository + service + resolver + IPC) | ✅ commit `033cb71` |
| T8 | MeetingSession 채널 권한 캐시 + invalidation | ✅ commit `8d98dbb` |
| T9+T10 | MeetingTurnExecutor 권한 wire 교체 + 옛 buildPermissionRules 삭제 | ✅ commit `e2f43e7` |
| **T10.5 hotfix (G2+G5)** | ssmCtx 4곳 cwd / mode 하드코딩 fix | ✅ commit `a7ef7f5` (본 세션) |
| **T10.5 hotfix (G1)** | CliProvider.setProjectPath wire | ✅ commit `d0992ee` (본 세션) |
| renderer 사전 작업 | App 라우팅 + Strict Mode fix + 채널 멤버 관리 UI 초기본 | ✅ commit `eb8e063` (본 세션) |
| T11~T21 | argv filter + UI + i18n + verify + 문서 | ⏳ T10.5 효과 검증 후 |

**R12-X** (PathGuard 봉인 chain 복원) — R12-W T10.5 hotfix 진행 중 audit 으로 *spec §7.6 PathGuard chain 이 R2 (2022) 이후 4년간 dead-infrastructure 였음* 발견 → G3+G4+G6+G7 + 회귀 가드 3종 (brand `AbsolutePath` + runtime invariant + integration test) 정식 phase.

| R12-X 산출물 | 위치 | 상태 |
|---|---|---|
| ADR | `decisions/r12-x-pathguard-wire-up.md` | 🆕 commit 대기 |
| plan | `plans/2026-05-12-rolestra-r12-x-pathguard-wire-up.md` | 🆕 commit 대기 |
| audit (근거) | `reports/audit/2026-05-12-r12-w-pathguard-wire-audit.md` | ✅ commit `a7ef7f5` |

---

## 3. 사용자 명시 문제 요소 3 종

상세 본문 + 가설 + 향후 계획은 `docs/rolestra-r12-w-x-2026-05-12-state.md` §2 (현재 발생 중인 문제) 본문 (docs 루트 권위 위치). 본 README 는 한 줄 가시화만.

| # | 문제 | 책임 phase | 검토 단계에서의 의미 |
|---|---|---|---|
| **문제 1** | Rolestra 프로젝트가 *허용된 폴더 안* 에서만 작동해야 하는데 *다른 경로* (rolestra source repo) 사용 — spec §7.6 봉인 위반 | R12-W T10.5 hotfix (land 완료) + R12-X (정식 wire) | 검토의 *주 surface* — hotfix 효과 검증 + R12-X 진입 결재 |
| **문제 2** | 채팅 메시지에 application-level JSON 형식 노출 | R12-C2 P2 (의견 트리 frontend parsing) | 검토 중 *결정 사항* — short-term 완화 옵션 A/B/C 결재 |
| **문제 3** | 코덱스 + 제미니 응답 실패 (codex trust list / gemini hang) | 별 follow-up | 검토 중 *완화 작업* — codex `--skip-git-repo-check` 자동 등 |

---

## 4. 전면 검토 / 검증 진입 결재 (사용자 명시)

### 4.1 검토 범위

**R12-C2 Round 2 T0~T29 land** + **R12-W T1~T10 + T10.5 hotfix land** 의 통합 검증.

검토 후보 표면:

| 영역 | 핵심 산출물 / 코드 | 검증 방향 |
|---|---|---|
| **R12-C2 회의 backend** | OpinionService / 의견 트리 / 일괄 동의 투표 / MeetingMinutesService / migration 019 / spec §3, §4, §5, §11.13~§11.18 | 의도 spec ↔ 구현 일치 / 회귀 / dogfooding surface |
| **R12-C2 RunStep / NextStep / 감사관 (A/B/F)** | OpinionService 영속 / NextStep 7 종 분류 / 6 헌법 감사관 catalog (phase 1 report-only) | 데이터 정합 / surface 통합 |
| **R12-C2 designated worker (E)** | capability manifest + worker schema | spec ↔ 구현 |
| **R12-C2 P6 인계 (G/B1/H2)** | handoff_dispatch table (migration 022) + HandoffPackage schema + HandoffDispatchService + HandoffApprovalModal + 받는 부서 첫 화면 | 4 경로 인계 흐름 |
| **R12-W 채널 권한** | 마이그레이션 023 + ChannelRepository / ChannelService / ChannelPermissionResolver + PromptComposer wire + MeetingSession 캐시 + MeetingTurnExecutor | 채널 권한 단위 → AI 시스템 프롬프트까지의 wire 일관성 |
| **R12-W T10.5 hotfix** | ssmCtx 4 경로 (`channel:start-meeting` / auto-trigger / queue / handoff) + CliProvider.setProjectPath wire | dogfooding 3 round 결과 진단 (build mismatch / external 연결 / singleton race / AI 도구 cwd 무시 4 가설) |
| **사용자 명시 문제 1** | spec §7.6 PathGuard chain 의 4 가설 좁히기 | Claude 응답 본문 / projects row / Windows 빌드 grep 캡쳐로 결정적 결론 |
| **사용자 명시 문제 2** | R12-C2 P2 의 JSON ↔ UI parsing surface 격차 | short-term 완화 옵션 결재 |
| **사용자 명시 문제 3** | codex trust list / gemini hang | provider 환경 진단 + 임시 완화 옵션 |

### 4.2 검증 방식 (제안)

| 방식 | 설명 | 비용 / 가치 |
|---|---|---|
| **vitest 회귀** | 본 worktree 의 production 테스트 (2885+ tests) 풀 실행 | 낮음 / 보장 |
| **typecheck** | `npx tsc --noEmit` exit 0 확인 | 낮음 / 보장 |
| **lint** | `npm run lint` baseline 유지 확인 | 낮음 / 보장 |
| **dogfooding round 4** | 새 프로젝트 + 부서 채널 + 회의 시작 (다른 부서 / 다른 권한 mode / 다른 provider 조합) | 중 / *문제 1 진단의 결정적 데이터* |
| **spec ↔ 구현 cross-check** | spec §3/§4/§5/§11.13~§11.18 항목별 구현 위치 / 결정 추적 | 중 / 의도 일치 보장 |
| **PathGuard chain audit re-run** | `docs/R12_c2_2R/reports/audit/2026-05-12-r12-w-pathguard-wire-audit.md` 의 7 격차 grep 재검증 (T10.5 fix 후) | 낮음 / dead-infrastructure 회귀 가드 |
| **E2E Playwright** | 사용자 가시 시나리오 (회의 시작 → 의견 제출 → 일괄 동의 → 회의록) end-to-end | 높음 / 사용자 가시 surface 보장 |

### 4.3 검증 절차 권장 순서

1. **WSL/Windows 빌드 mismatch 해소** — Windows 에서 `npm run build` 또는 `npm run dev` 재실행 → `Select-String "out\main\index.js" -Pattern "T10\.5|provider\.setProjectPath\(|resolveProjectPaths\("` 로 hotfix 코드 본문 박혔는지 확정.
2. **vitest + typecheck + lint** — 기본 검증 PASS 확인.
3. **dogfooding round 4** — 새 프로젝트 (kind=`new` 확실) + 부서 채널 + 메시지 → Claude 응답 본문 캡쳐 → spec §7.6 위반 surface 가 사라졌는지 결정적 결론.
4. **문제 1 hotfix 효과 PASS** 시 — R12-W T11~T21 또는 R12-X 진입 결재 / 문제 2, 3 옵션 결재.
5. **문제 1 hotfix 효과 FAIL** 시 — `rolestra-r12-w-x-2026-05-12-state.md` §2.1 의 4 가설 좁히기 (build / external 연결 / singleton race / AI 도구 cwd 무시) → 추가 hotfix 또는 R12-X 우선 진입.

---

## 5. 다음 세션 진입 시 quick start

```bash
# WSL 에서 git 작업:
export GIT_DIR=/mnt/d/Taniar/Documents/Git/Rolestra/.git/worktrees/Rolestra-r12c2-r2
export GIT_WORK_TREE=/mnt/d/Taniar/Documents/Git/Rolestra-r12c2-r2

# 1. 본 README 본문 — 가장 권위 있는 단일 출처
cat docs/R12_c2_2R/README.md

# 2. R12-W/X 상세 — 문제 3 종 + 가설 + 향후 계획 (docs 루트 권위 위치)
cat docs/rolestra-r12-w-x-2026-05-12-state.md

# 3. 진행 상태
git log --oneline -20        # R12-C2 + R12-W + R12-W T10.5 hotfix commit 흐름
git status                   # R12-X 산출물 + 본 폴더 mv 등 staged 상태

# 4. 직전 상태에서의 검토 진입 — Windows PowerShell 에서 빌드 검증
#    PowerShell:
#    Select-String -Path "out\main\index.js" -Pattern "T10\.5|provider\.setProjectPath\(|resolveProjectPaths\("
```

### 5.1 다음 세션 첫 행동 결정 트리

1. **검토/검증 진행 중**:
   - 본 README §4.3 의 권장 순서 1~3 진행.
   - 문제 1 hotfix 효과 결론 (PASS / FAIL) 기록.

2. **검토 PASS 후 진입 결재**:
   - R12-X 진입 (PathGuard 정식 wire + 회귀 가드 3종) — 가장 우선순위 높음. 문제 1 의 *근원 fix*.
   - R12-W T11~T21 진입 — argv filter + UI + i18n. R12-X 와 직렬/평행 결재.
   - R12-C2 T30~T42 진입 — 큐 시스템 (C) + 알림 (D) + 대시보드 (H1) + 감사관 phase 2 (F2) + closeout.

3. **별 follow-up**:
   - 문제 2 short-term 완화 옵션 A/B/C 결재.
   - 문제 3 codex `--skip-git-repo-check` 자동 추가 등 임시 완화.
   - WSL/Windows 빌드 mismatch ADR 또는 CI 자동화.

---

## 6. 참조 문서 / 메모리 / 외부 프로젝트

### 6.1 권위 문서 (`docs/*.md` 루트)

| 문서 | 경로 | 역할 |
|---|---|---|
| 문서 폴더 정책 | `docs/README.md` | 폴더별 용도 + 명명 규칙 |
| 기능 정의서 | `docs/기능-정의서.md` | Rolestra v3 메타포 + 누적 기능 |
| 설계 문서 | `docs/설계-문서.md` | 4 layer 아키텍처 + 핵심 모듈 + 6 테마 + 패키징 |
| 코딩 규칙 | `docs/코딩-규칙.md` | 어떤 규칙을 지키는가 |
| 완료 기준 | `docs/완료-기준.md` | 언제 끝난 것인가 |
| 구현 현황 | `docs/구현-현황.md` | R1~R12-X phase 별 status + commit |
| 회의 시스템 재설계 (쉬운 설명) | `docs/회의시스템-새로만들기-1차-쉬운설명.md` | R12-C2 의 사용자 친화 설명 |

### 6.2 본 폴더 안 (R12_c2_2R)

본 README §1 navigation 표 참조.

### 6.3 단일 권위 spec / cross-cutting

| 종류 | 경로 |
|---|---|
| 단일 권위 spec | `docs/specs/2026-04-18-rolestra-design.md` (134 KB, 11 phase 누적, R12-C2 의견 트리 / 일괄 동의 spec §3, §4, §5, §11.13~§11.18) |
| 토픽별 design spec | `docs/specs/` |
| cross-cutting ADR | `docs/decisions/` (R12-C 1차 channel-roles + 기타 phase 결정) |

### 6.4 instruction / 글로벌 규칙

| 종류 | 경로 |
|---|---|
| 프로젝트 instruction | `CLAUDE.md` (저장소 루트, R12-W 의 절대 위반 금지 규칙 등) |
| 사용자 글로벌 instruction | `~/.claude/CLAUDE.md` (Work Principles + 절대 금지 + 에이전트 정책) |

### 6.5 메모리 (host-local 한정)

| 종류 | 경로 |
|---|---|
| 자동 메모리 (사용자 + feedback + project + reference) | `/home/taniar/.claude/projects/-mnt-d-Taniar-Documents-Git-Rolestra-r12c2-r2/memory/` |
| 메모리 인덱스 | 위 디렉토리의 `MEMORY.md` |

**주의**: 메모리는 사용자 host (WSL) 한정 — 다른 환경에서 접근 불가. 다른 세션 / 다른 환경 진입 시 *git log + 본 README + plan/ADR* 로 컨텍스트 복원.

### 6.6 외부 참조 프로젝트 (같은 git 폴더 내)

| 프로젝트 | 경로 | 용도 |
|---|---|---|
| AI Chat Arena v1 (Python/FastAPI/Svelte) | `/mnt/f/hayoung/git/AI_Chat/` | 멀티파티 메시지 변환, 팩토리 패턴 provider, anti-sycophancy 참고 |
| bara_system (메모리 시스템) | `/mnt/f/hayoung/git/bara_system/` | hybrid search, Stanford 3-factor scoring, SQLite+FTS5+embeddings — Memory Phase 3-b (R12+) 의존 |
| Symphony / oa-py / alex-core | (사용자 host 어딘가, R12-C2 ADR `decisions/r12-c2-reference-projects-absorb.md` 참조) | R12-C2 Round 2 의 8 후보 (A~H) 흡수 source |

### 6.7 R12-C 1차 (선행 phase, 본 폴더 외 유지)

본 폴더는 *Round 2 + 파생 phase* 만 포함. R12-C 1차 산출물은 *별 위치 유지* — 1차는 main merge 완료, 본 worktree 와 별 lifecycle.

| 종류 | 경로 |
|---|---|
| R12-C 1차 plan | `docs/plans/2026-05-02-rolestra-phase-r12-c.md` (+ tasks.json) |
| R12-C 1차 ADR | `docs/decisions/r12-c-channel-roles.md` |
| R12-C 1차 audit | `docs/reports/audit/2026-05-03-r12-c-t1-t11-audit.md` |

### 6.8 환경 troubleshoot 메모 (host-local 한정)

WSL 에서 git 작업 시:

```bash
export GIT_DIR=/mnt/d/Taniar/Documents/Git/Rolestra/.git/worktrees/Rolestra-r12c2-r2
export GIT_WORK_TREE=/mnt/d/Taniar/Documents/Git/Rolestra-r12c2-r2
```

| 이슈 | 원인 | 해소 |
|---|---|---|
| `git status` → `fatal: not a git repository: ...D:/Taniar/.../Rolestra-r12c2-r2` | `.git` 파일이 Windows 절대경로 — WSL 에선 `/mnt/d/...` 필요 | 위 export |
| `Cannot find module @rollup/rollup-linux-x64-gnu` (vitest) | npm optional dependency 버그 | `npm install --no-save @rollup/rollup-linux-x64-gnu` |
| `invalid ELF header` for `better_sqlite3.node` | Windows 빌드 native module 이 WSL Node 에서 못 돔 | `npm rebuild better-sqlite3` |
| WSL commit 이 Windows electron main bundle 에 반영 안 됨 | WSL 의 빌드 산출물 ≠ Windows 의 빌드 산출물 | Windows PowerShell 에서 `npm run build` 또는 `npm run dev` 재실행 |

---

## 7. 결재 history (사용자 명시)

| 일자 | 결재 | 출처 |
|---|---|---|
| 2026-05-11~12 | R12-W 6 결재 (D1~D5 + UI 옵션 ①+① + 별도 #1~#2) | R12-W ADR `decisions/r12-w-member-file-permission.md` + work-log `reports/work-log/rolestra-r12-w-t1-t10-progress.md` |
| 2026-05-12 | R12-W audit 옵션 C 변형 — T10.5 hotfix (G1+G2+G5) + R12-X 정식 분리 (G3+G4+G6+G7 + 회귀 가드 3종) | audit `reports/audit/2026-05-12-r12-w-pathguard-wire-audit.md` §8 |
| 2026-05-12 | **구현 멈춤, 전면 검토 / 검증 우선** | 본 README §4 (이 결재가 가장 최근, 가장 권위) |

---

**본 README 갱신 정책**: 검토/검증 진행에 따라 §4 (검토 진입 결재) 및 §3 (문제 요소 상태) 본문을 *living document* 로 갱신. 새 phase 진입 (R12-X / T11+ / T30+) 시점에 §2 (Round 2 진행 현황) + TL;DR 표 갱신.
