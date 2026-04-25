# Rolestra Phase R11 — 레거시 청소 + 릴리스 패키징 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Date:** 2026-04-26
**Prev plan:** `docs/superpowers/plans/2026-04-24-rolestra-phase-r10.md` (R10 15/15 ✓ — main tip `dc4a763` 포함, design polish 라운드 1·2 후속 commit `b35a7d3` / `281b6bd` / `0485ddc` / `dc4a763`)
**Spec:** `docs/superpowers/specs/2026-04-18-rolestra-design.md` §10 Phase R11 (line 1343~1347 — R11 본 정의 3 항목 + R10 scope 경계 line 1326~1342 의 R11 이연 항목)
**Closeout target:** `docs/superpowers/specs/r11-done-checklist.md` (Task 16)

**Goal:** R10 까지 "쓸 수 있는 v3" 가 닫힌 상태 위에서, **R11 은 (a) v2 레거시 코드 물리 삭제, (b) R10 Known Concerns 8건 일괄 종결, (c) Onboarding 첫 부팅 wizard 완성, (d) Approvals 상세 패널(design polish 라운드 2 의 B 이월), (e) Windows installer / macOS dmg / Linux AppImage 패키징 + GitHub Actions release workflow, (f) 사용자 문서 (`docs/설계-문서.md`) v3 교체 — 6 축을 완성한다**. R11 종료 시 (i) `_legacy/migrations-v2/`(8 파일) + `_legacy/renderer-v1/`(8 디렉토리) 가 사라지고, (ii) v2 engine 5 파일 (`orchestrator.ts` / `turn-executor.ts` / `conversation.ts` / `execution-coordinator.ts` / `memory-coordinator.ts`) + `engine/persona-builder.ts` + 7 legacy `@ts-nocheck` 파일이 청소되고, (iii) Pre-existing 14 test file 실패가 정리되어 `npm run test` exit 0 회복, (iv) Playwright OS matrix 가 27 cell 모두 실 run green (workflow file 만이었던 R10 → R11 에서 dispatch 실행 + 결과 캡처) + 누락 spec 2 개 (`search-flow` / `dm-flow`) 작성 + autonomy-queue Step C 가 `__rolestraDevHooks` 노출로 실 동작, (v) `OnboardingPage` 가 step 2 (design polish 라운드 2 의 A) 위에 step 3/4/5 + `provider:detect` IPC + onboarding state 영구화 까지 확장 — 사용자가 처음 앱을 켰을 때 자동으로 안내, (vi) `ApprovalDetailPanel` 이 `ApvImpactedFilesCard` + `ApvDiffPreviewCard` + `ApvConsensusContextCard` 로 구성되고 `approval:list` filter wiring + `ExecutionService.dryRunPreview` IPC 신설 + meeting voting/comment history fetch 로 데이터 layer 완비, (vii) `electron-builder` 또는 `electron-forge` 채택 결정 후 Windows NSIS installer + macOS dmg(unsigned) + Linux AppImage 가 `npm run package` 단일 명령으로 산출, (viii) `LlmCostAuditLog` 신규 테이블이 token count / provider id / meeting id 를 기록하고 Settings AutonomyDefaultsTab 에서 누적 비용 가시화, (ix) `'streaming'` capability literal 이 `'summarize'` 가 아닌 v3 ProviderCapability union 으로 meeting-summary-service 에 정식 적용 (R10 D7 open question 종결), (x) `docs/설계-문서.md` 가 v2 (Python/FastAPI/Svelte) 기반에서 v3 (Electron/TS/React/Rolestra) 기반으로 전면 재작성 + ADR 디렉토리 (`docs/아키텍처-결정-기록/`) 가 R1~R11 결정사항 통합.

**Overview (자연어, 비코더용):**

- R11 은 Rolestra v3 의 **마지막 phase 이자 첫 사용자 출시 phase** 다. R1~R10 은 "엔진 + UI + 이름표가 다 붙은 v3" 였고, R10 design polish 라운드 1·2 까지 시각 갭도 거의 닫혔지만, 아직 (a) v2 시절 흔적이 코드 트리 안에 살아 있고, (b) 사용자가 처음 앱을 켰을 때의 안내(=onboarding)가 design polish A 라운드의 step 2 placeholder 만 존재하고, (c) 패키지 빌드 (.exe/.dmg/.AppImage) 가 한 번도 만들어지지 않았으며, (d) `docs/설계-문서.md` 는 여전히 Python/FastAPI/Svelte 시절의 v2 문서다. R11 은 이 4 가지를 모두 해소해야 "사용자에게 배포 가능한 v3" 가 된다.
- 가장 큰 부채는 **R10 Known Concerns 8건** 이다. 워크플로 파일만 등록되어 있는 Playwright OS matrix 가 실 run green 인지 미확인 (#1), `__rolestraDevHooks` 가 preload 에 미노출이라 autonomy-queue Step C 가 placeholder 로 남아 있음 (#2), `search-flow.spec.ts` / `dm-flow.spec.ts` 가 미작성 (#3), `mode_transition` conditional advisory 의 자동 system message 주입 미동작 (#4), main-process 잔여 한국어 trace 라인이 R9 D8 결정으로 보존되었지만 사용자 요청 시 영어 복귀 가능 여부 결정 필요 (#5), 12 스크린샷이 Windows/macOS native 캡처 대기 (#6), v3 ProviderCapability union 에 `'summarize'` 가 없어 `'streaming'` 으로 우회 (#7), Pre-existing 14 test file 실패가 v2 legacy 잔재 (#8). R11 의 절반 정도 task 가 이 8건을 분산 종결한다.
- 두 번째 부채는 **레거시 청소**. spec §10 R11 본 정의 첫 항목이 "_legacy/ 삭제" 다. `_legacy/migrations-v2/` 8 파일 + `_legacy/renderer-v1/` 의 8 디렉토리(`App.tsx` / `components/` / `env.d.ts` / `hooks/` / `i18n/` / `index.html` / `main.tsx` / `stores/` / `styles/`) 752KB 가 한 번에 사라진다. **그런데 v2 engine 5 파일** (`src/main/engine/orchestrator.ts` / `turn-executor.ts` / `conversation.ts` / `execution-coordinator.ts` / `memory-coordinator.ts`) + `engine/persona-builder.ts` 는 spec §10 R10 scope 경계 line 1327 에서 R11 이연으로 명시된 항목이고, **이들은 src/main 트리 안에 있어서** typecheck / test / build 게이트가 모두 통과하는지 신중히 검증해야 한다. R11 Task 1 은 `_legacy/` 단일 commit, R11 Task 2 는 v2 engine 6 파일 + 7 `@ts-nocheck` 파일 단계 삭제 + import 끊기 검증으로 분리한다 (D1 결정).
- 세 번째 부채는 **테스트 회복**. R10 done-checklist Known Concern #8 의 Pre-existing 14 test file 실패 — `database-*` (4 파일) / `memory-*` (3 파일) / `recovery-*` (2 파일) / `remote-*` (3 파일) / `handlers-v3 ipc` (2 파일) — 가 R10 회귀 검증 시 항상 fail 표시 노이즈를 만든다. 이들은 모두 v2 시절 테스트로, v3 도메인 모델이 들어오지 않은 부분이거나 import 경로가 v2 모듈을 가리키는 경우다. R11 Task 3 이 각 파일을 (a) v3 로 재작성, (b) 영구 skip + skip reason 명시, (c) 물리 삭제 — 셋 중 하나로 정리해서 `npm run test` exit 0 를 회복한다.
- 네 번째 부채는 **E2E 안정화**. R10 Task 13 이 OS matrix workflow 를 등록만 했고 실 run 결과는 GitHub Actions runner 에서 봐야 한다. R11 Task 4 는 (i) 누락 spec 2 개 작성, (ii) `__rolestraDevHooks` 노출 (`ROLESTRA_E2E=1` 가드), (iii) autonomy-queue Step C 활성, (iv) workflow_dispatch 실 run + 27 cell green 확인, (v) 12 스크린샷 sign-off (Windows native + macOS native) — 5 단계를 거쳐 OS matrix 를 "빨강 → 초록" 으로 만든다.
- 다섯 번째 부채는 **Onboarding 완성**. design polish 라운드 2 A 라운드는 step 2 (직원 선택 화면) 까지만 fixture 데이터로 만들었다. R11 Task 6 은 step 3 (역할 부여) / step 4 (권한 설정) / step 5 (첫 프로젝트 생성) 추가 + `provider:detect` IPC 신설 (capability snapshot 수신) + `onboarding-state` settings 영구화 + 첫 부팅 시 자동 진입 (NavRail 우회) + 완료 후 Dashboard 진입 + Settings.AboutTab "온보딩 다시 시작" CTA 정식 wire (현재 design polish 라운드 2 에서 testid 만 등록).
- 여섯 번째 부채는 **Approvals 상세 패널** (design polish 라운드 2 의 B 이월). 시안의 핵심 가치인 우측 상세 패널 — `ApvImpactedFilesCard` + `ApvDiffPreviewCard` + `ApvConsensusContextCard` — 는 R11/R12 데이터 layer 의존이라고 라운드 2 에서 backlog 처리됐다. R11 Task 7 이 (a) `approval:list` filter wiring (이미 IPC 가 `{status?}` 받음, frontend hook 만), (b) `ExecutionService.dryRunPreview` IPC 신설 (changes 의 file path + +/- lines + 일부 diff content 노출), (c) meeting voting/comment history fetch IPC, (d) `ApprovalDetailPanel` root + 5 카드 컴포넌트 + filter wiring, (e) Approvals 페이지를 list+detail 분할 layout 으로 재구성 — 시안 03 fidelity 도달.
- 일곱 번째 부채는 **LLM 비용 가시화**. R10 D7 open question 의 첫 번째 항목 — "회의 길이 × token 비용" — 가 미구현. R10 Task 11 의 `meeting-summary-service` 가 provider 호출하지만 token count audit 가 없어서 사용자가 비용을 인지하지 못한다. R11 Task 8 이 (a) 신규 테이블 `llm_cost_audit_log` (`id` / `meeting_id` / `provider_id` / `token_in` / `token_out` / `created_at`) — R11 의 유일한 forward-only 마이그레이션, (b) `meeting-summary-service` 가 호출 후 token count 기록, (c) Settings AutonomyDefaultsTab 에 누적 토큰 + 추정 비용 (provider 별 단가 setting 에서 입력) 표시, (d) `llm:cost-summary` IPC. R10 D7 종결.
- 여덟 번째 부채는 **`'streaming'` capability literal**. R10 Known Concern #7 — `'summarize'` capability 가 v3 ProviderCapability union 에 없어서 R10 Task 11 이 임시로 `'streaming'` 으로 fallback 했다. R11 Task 9 가 (a) `ProviderCapability` union 에 `'summarize'` 추가, (b) 6 provider config 들이 capability 명시 (Claude/Codex/Gemini/Anthropic API/OpenAI API/Local Ollama 의 각 capability 표 기준), (c) `meeting-summary-service` 가 `'summarize'` true 인 첫 provider 로 fallback chain 수정, (d) `'streaming'` 임시 우회 코드 제거. 회귀 0 보장.
- 아홉 번째 부채는 **mode_transition conditional advisory 자동 주입**. R10 Known Concern #4 — 사용자가 ApprovalBlock 에서 `mode_transition` 의 conditional 버튼을 클릭하면 comment 가 `audit row` 에는 들어가지만 다음 회의 system message 로 자동 주입되지 않는다. `ApprovalSystemMessageInjector` 의 filter 3 (`channelId === null || meetingId === null` 시 skip) 이 mode_transition (meetingId=null) 을 차단한다. R11 Task 10 이 (a) injector filter 완화 (mode_transition kind 만 예외 허용), (b) ProjectService 에 `pendingAdvisory` slot 추가 (mode_transition conditional 결정 시 저장), (c) 다음 meeting 시작 시 advisory 소비 (system message 로 prepend), (d) 소비 후 slot 비움. R10 D 흐름 종결.
- 열 번째 축은 **Retro 영어 복귀 결정 D8**. R10 Known Concern #5 — main-process 잔여 한국어 trace 라인 (`approval-notification-bridge.ts` / `autonomy-gate.ts` / 일부 system message) 이 spec §R9 D8 결정 ("trace 라인은 한국어 고정") 로 보존됐다. R11 은 사용자 sign-off 시점이므로 (a) 사용자에게 명시적 결정 요청 (영어 복귀 / 한국어 유지 / locale 분기), (b) 결정 결과를 D9 로 기록, (c) 영어 복귀 또는 locale 분기 채택 시 dictionary 이전 + en parity 갱신. **이 task 는 사용자 결정 의존이라 plan 자체에서는 default = 한국어 유지 + locale 분기 옵션 추가 로 가정** (가장 보수적). 사용자가 다른 결정 시 D9 갱신.
- 열한 번째 축은 **패키징**. spec §10 R11 "Windows 인스톨러 + macOS dmg 빌드" + R10 scope 경계의 "Linux AppImage" 를 통합. R11 Task 12 가 (a) `electron-builder` (`builder.config.js`) 또는 `electron-forge` 채택 결정 — D2 (electron-builder default 권장 — TS/React 친화 + 광범위한 OS 지원, electron-forge 는 plugin 생태계 의존성 큼), (b) Windows NSIS installer (32/64bit) + 코드 사인 미적용 (R12+), (c) macOS dmg unsigned (Gatekeeper 우회 안내) + Apple Silicon arm64 + Intel x64 universal binary, (d) Linux AppImage (x64), (e) `npm run package` / `npm run package:win` / `npm run package:mac` / `npm run package:linux` 4 명령, (f) GitHub Actions release workflow (tag push 시 3 OS matrix 빌드 + artifact 업로드). 외부 service (notarize / signing certificate) 는 R12+ 로 명시.
- 열두 번째 축은 **문서 갱신**. spec §10 R11 "docs/설계-문서.md → v3 교체" — 현재 v2 (Python/FastAPI/Svelte) 시절 문서다. R11 Task 13 이 (a) `docs/설계-문서.md` 전면 재작성 — Electron + TS + React 18 + Tailwind + Radix + Zustand + better-sqlite3 + react-i18next + Vitest + Playwright + electron-builder 기반, (b) `docs/기능-정의서.md` Rolestra 메타포 + 10 phase 구조 + 12 SSM state + 6 테마 + 자율 모드 4 tripwire 반영, (c) `docs/구현-현황.md` R1~R11 status 일괄 갱신, (d) ADR 디렉토리 `docs/아키텍처-결정-기록/` 정리 — R1~R11 의 80+ Decision 통합 (ADR 별 1 파일이 너무 많으면 phase 별 묶음 ADR 채택 — D8 결정), (e) `docs/Rolestra_sample/` 시안 → `docs/디자인/` 정식 폴더 이전 + R11 시각 sign-off 마크. ko-only.
- 열세 번째 축은 **CI matrix macOS hosted runner 비용 monitoring**. R10 D5 risk — macOS runner 가 minutes 비싸다. R11 Task 14 가 (a) GitHub Actions usage report 파싱 helper 작성 (`.github/workflows/usage-report.yml` weekly cron), (b) macOS Playwright 만 weekly trigger (PR 별은 Windows + Linux 만), (c) macOS PR 별 trigger 는 manual workflow_dispatch + `[macos]` PR label 옵션, (d) usage 결과 README 배지 + monthly notification.
- **신규 도메인 모델 0 원칙** — R11 도 R10 처럼 신규 도메인 모델 0 이 원칙. 단 onboarding state 영구화 (Task 6) 와 LLM 비용 audit log (Task 8) 가 신규 마이그레이션 2 건 추가. 두 건의 정당성:
  - **마이그레이션 013 `onboarding_state`** — onboarding 진행 단계 + 선택 데이터 영구화. settings 와 별도 테이블인 이유는 (i) 진행 중 종료 시 step 복귀 가능, (ii) 완료 표식 (boolean) + 완료 시각, (iii) 향후 onboarding 변경 시 마이그레이션 가능. spec §5.2 의 마이그레이션 chain 에 등록.
  - **마이그레이션 014 `llm_cost_audit_log`** — token 사용 내역 append-only. R10 D7 open question 종결.
- **SSM 은 건드리지 않는다**. spec §8 의 12 상태 / 가드 / 이벤트는 R11 범위 밖. R11 의 어떤 task 도 `consensus-machine.ts` 의 transition table 을 수정하지 않는다.
- **R12+ 이연 명확화** — R11 종료 후에는 spec §10 의 "쓸 수 있는 v3" 가 사용자에게 배포된다. 그 다음은 V4 (DM read receipt / typing indicator / 파일 첨부 드래그앤드롭 / 음성 메모 / 플러그인 시스템 / ComfyUI/SD 연동) 이고, R10 design polish 라운드 3+ backlog (Hero strip 통합 / InsightStrip footer 변경 / Queue 6-column 테이블 / Onboarding step 3-5 페이지 미캡처 시안 추가) 도 V4 로 통합. R11 은 "마지막 출시 phase" — V4 진입 전 사용자 피드백 수집 phase.

**Architecture:**

- Layering: `renderer → shared → preload(contextBridge) → main`. R3~R10 구조 그대로.
- Main 재사용 (R2~R10 land 완료):
  - `src/main/database/migrations/index.ts` — 012 까지 register, R11 Task 6/8 에서 013/014 추가
  - `src/main/llm/meeting-summary-service.ts` — R10 Task 11 land, R11 Task 8 변경: token count 기록 + Task 9 변경: `'streaming'` → `'summarize'` capability 정식
  - `src/main/approvals/approval-service.ts` — R10 Task 11 land, R11 Task 7 변경: filter status 매개변수 정식 활용 (이미 IPC 는 받지만 frontend wiring 필요)
  - `src/main/approvals/approval-system-message-injector.ts` — R10 land, R11 Task 10 변경: filter 완화 + advisory 소비
  - `src/main/projects/project-service.ts` — R7 land, R11 Task 10 변경: `pendingAdvisory` slot 추가
  - `src/main/execution/execution-service.ts` — R3 land, R11 Task 7 변경: `dryRunPreview` API 추가 (이미 internal `dryRunApply` 가 changes 산출 — preview 는 read-only wrapper)
  - `src/main/index.ts` — R10 boot block 위에 R11 추가: provider capability snapshot loader / first-boot detection / GH Actions release workflow 환경 변수 처리
  - `src/main/providers/registry.ts` — R11 Task 9 변경: capability `'summarize'` 추가 후 6 provider config 갱신
- Main 신규 파일:
  - `src/main/onboarding/onboarding-service.ts` — first-boot detection / state CRUD / step transition (Task 6)
  - `src/main/onboarding/onboarding-state-repository.ts` — 013 마이그레이션 위 CRUD
  - `src/main/onboarding/__tests__/onboarding-service.test.ts`
  - `src/main/llm/llm-cost-repository.ts` — 014 마이그레이션 위 append-only insert + sum query (Task 8)
  - `src/main/llm/__tests__/llm-cost-repository.test.ts`
  - `src/main/database/migrations/013-onboarding-state.ts` — neue 테이블 (Task 6)
  - `src/main/database/migrations/014-llm-cost-audit-log.ts` — neue 테이블 (Task 8)
- Main 삭제:
  - `src/main/engine/orchestrator.ts` — v2 legacy (Task 2)
  - `src/main/engine/turn-executor.ts` — v2 legacy
  - `src/main/engine/conversation.ts` — v2 legacy
  - `src/main/engine/execution-coordinator.ts` — v2 legacy
  - `src/main/engine/memory-coordinator.ts` — v2 legacy
  - `src/main/engine/persona-builder.ts` — v2 legacy
  - `src/main/engine/__tests__/{orchestrator,turn-executor,conversation,execution-coordinator,memory-coordinator,persona-builder}.test.ts` — 동시 삭제
  - 7 legacy `@ts-nocheck` 파일 (consensus-driver / consensus-handler / permission-handler / workspace-handler 등) — 케이스 별 (a) 삭제 또는 (b) v3 재작성 (Task 2)
- Main 수정:
  - `src/main/index.ts` — R11 boot block: `OnboardingService.detectFirstBoot()` / `LlmCostRepository.init()` / `'summarize'` capability 적용 후 provider config snapshot 갱신 / `__rolestraDevHooks` 가드 노출 (`ROLESTRA_E2E=1`)
  - `src/main/llm/meeting-summary-service.ts` — token count 기록 (Task 8) + `'summarize'` capability 사용 (Task 9)
  - `src/main/approvals/approval-system-message-injector.ts` — filter 완화 + advisory 소비 (Task 10)
  - `src/main/projects/project-service.ts` — pendingAdvisory slot (Task 10)
  - `src/main/execution/execution-service.ts` — dryRunPreview (Task 7)
  - `src/main/providers/registry.ts` — capability snapshot (Task 9)
  - `src/main/ipc/handlers/{onboarding,llm,approval,execution,provider}-handler.ts` — 신규 IPC 추가
  - `src/main/ipc/router.ts` — 신규 채널 등록
- Shared:
  - `src/shared/onboarding-types.ts` — NEW (Task 5) — `OnboardingState` / `StepNumber` / `OnboardingStaffSelection` / `ProviderDetectionSnapshot`
  - `src/shared/llm-cost-types.ts` — NEW (Task 5) — `LlmCostAuditEntry` / `LlmCostSummary`
  - `src/shared/approval-detail-types.ts` — NEW (Task 5) — `ApprovalDetail` (impactedFiles + diffPreview + consensusContext) / `ApprovalListFilter`
  - `src/shared/provider-types.ts` 확장 — `ProviderCapability` union 에 `'summarize'` 추가 (Task 9)
  - `src/shared/ipc-types.ts` — 신규 IPC 채널: `onboarding:get-state` / `onboarding:set-state` / `onboarding:complete` / `provider:detect` / `llm:cost-summary` / `execution:dry-run-preview` / `approval:detail-fetch` / `meeting:voting-history`
  - `src/shared/ipc-schemas.ts` — zod
  - `src/shared/stream-events.ts` — `stream:onboarding-state-changed` (선택, onboarding 다중 윈도우 동기화 시) — D6 결정으로 단일 윈도우 가정 시 미도입
- Preload:
  - `src/preload/index.ts` — 신규 IPC 화이트리스트 + `__rolestraDevHooks` (E2E 환경 가드)
- Renderer 신규:
  - `src/renderer/features/onboarding/OnboardingPage.tsx` 확장 (R10 design polish 라운드 2 위에 step 3/4/5)
  - `src/renderer/features/onboarding/steps/{Step3RoleAssignment,Step4Permissions,Step5FirstProject}.tsx` (Task 6)
  - `src/renderer/features/onboarding/use-onboarding-state.ts` — 영구화 hook
  - `src/renderer/features/approvals/detail/{ApprovalDetailPanel,ApvDetailHeader,ApvImpactedFilesCard,ApvDiffPreviewCard,ApvConsensusContextCard,ApvActionBar}.tsx` (Task 7)
  - `src/renderer/features/approvals/use-approval-detail.ts` (Task 7)
  - `src/renderer/features/settings/tabs/AutonomyDefaultsTab.tsx` 확장 — LLM 비용 가시화 섹션 (Task 8)
  - `src/renderer/hooks/use-llm-cost-summary.ts` (Task 8)
- Renderer 수정:
  - `src/renderer/App.tsx` — first-boot 시 `view='onboarding'` 자동 진입 (Task 6)
  - `src/renderer/features/settings/tabs/AboutTab.tsx` — "온보딩 다시 시작" CTA 정식 wire (Task 6)
  - `src/renderer/features/approvals/ApprovalInboxView.tsx` — list+detail 분할 layout (Task 7)
  - `src/renderer/features/approvals/ApprovalFilterBar.tsx` — filter onChange wiring (Task 7)
  - `src/renderer/features/onboarding/onboarding-data.ts` — fixture → `provider:detect` IPC 결과로 (Task 6)
  - `src/renderer/i18n/locales/{ko,en}.json` — onboarding step 3/4/5 + approval detail + llm cost 추가 (Task 11)
- E2E:
  - `e2e/search-flow.spec.ts` — NEW (Task 4 — Known Concern #3)
  - `e2e/dm-flow.spec.ts` — NEW (Task 4 — Known Concern #3)
  - `e2e/onboarding-flow.spec.ts` — NEW (Task 6)
  - `e2e/approval-detail-flow.spec.ts` — NEW (Task 7)
  - `e2e/playwright.config.ts` 확장 — 신규 spec 추가
  - `e2e/autonomy-queue-flow.spec.ts` 수정 — Step C 활성 (Task 4)
- 패키징:
  - `electron-builder.yml` — NEW (Task 12)
  - `.github/workflows/release.yml` — NEW (Task 12) — tag push 시 3 OS build + artifact upload
  - `.github/workflows/usage-report.yml` — NEW (Task 14) — weekly cron monitor
  - `package.json` — `package` / `package:win` / `package:mac` / `package:linux` scripts
  - `assets/icon.{ico,icns,png}` — 앱 아이콘 (R11 brand 확정 후, design polish 결과물 reuse 가능)
- 문서:
  - `docs/설계-문서.md` — 전면 재작성 (v2 → v3) (Task 13)
  - `docs/기능-정의서.md` — Rolestra v3 메타포 반영
  - `docs/구현-현황.md` — R1~R11 일괄 갱신
  - `docs/아키텍처-결정-기록/` — phase 별 묶음 ADR (D8)
  - `docs/디자인/` — `Rolestra_sample/` 이전 + sign-off 마크
- State flow:
  - **Onboarding 자동 진입:**
    1. 부팅 시 `OnboardingService.detectFirstBoot()` → `onboarding_state` 테이블의 row 0 OR `completed=false` 면 first-boot.
    2. `App.tsx` 가 `useOnboardingState()` 가 `view='onboarding'` 강제 (Shell 우회).
    3. step 1~5 완료 → `OnboardingService.complete()` → `onboarding_state.completed=true` + `view='dashboard'` 전환.
    4. 향후 Settings.AboutTab "온보딩 다시 시작" CTA → `OnboardingService.reset()` → `view='onboarding'` 재진입.
  - **Approval 상세 패널:**
    1. ApprovalInboxView 가 list+detail split layout. 좌측 list (filter bar 동작) → 우측 detail panel.
    2. 사용자가 list row 클릭 → `useApprovalDetail(id)` → `invoke('approval:detail-fetch', {id})` → backend 가 (i) approval row, (ii) impactedFiles (`ExecutionService.dryRunPreview` 의 changes), (iii) consensusContext (meeting voting/comment history) 통합 응답.
    3. detail panel 의 Action bar "승인/조건부/거절" 클릭 → 기존 `approval:decide` IPC 사용.
  - **LLM 비용:**
    1. `meeting-summary-service.summarize()` 가 provider 호출 직전/후 token count 추출 (provider 응답에 usage 객체 — Anthropic / OpenAI 표준).
    2. `LlmCostRepository.append({meetingId, providerId, tokenIn, tokenOut, createdAt})`.
    3. Settings.AutonomyDefaultsTab 의 "LLM 사용량" 섹션이 `useLlmCostSummary()` 로 누적 표시 (project 별 / provider 별 / 기간 별).
    4. 단가는 settings 의 `provider.pricing.{providerId}` 입력 필드에서 사용자가 직접 (R11 default 0 — 사용자가 설정해야 추정 비용 보임).
  - **mode_transition advisory 자동 주입:**
    1. 사용자가 ApprovalBlock 의 conditional 버튼 클릭 → comment 입력 → `approval:decide` invoke.
    2. ApprovalDecisionRouter 가 `kind='mode_transition'` + `decision='conditional'` 분기 → ProjectService.setPendingAdvisory(comment).
    3. 다음 meeting 시작 시 MeetingOrchestrator 가 `projectService.consumePendingAdvisory()` → 결과 있으면 system message prepend.
- Testing: Vitest (onboarding-service / llm-cost-repository / approval-system-message-injector + project-service advisory / execution-service dryRunPreview / meeting-summary-service capability 'summarize'), jsdom (OnboardingPage step 3/4/5 / ApprovalDetailPanel + 5 카드 / AutonomyDefaultsTab LLM cost section / use-onboarding-state / use-approval-detail / use-llm-cost-summary), Playwright `_electron` E2E (search-flow / dm-flow / onboarding-flow / approval-detail-flow + autonomy-queue Step C 활성).

**Tech Stack (R11 추가):**

- 기존 (R10 까지): TypeScript strict / React 19 / Electron 40 / Vite / Vitest (jsdom) / i18next / zod / zustand / Tailwind / Radix (Dialog/Popover/Tooltip/Tabs) / framer-motion / cva / clsx / @playwright/test / better-sqlite3
- 신규: **`electron-builder`** (D2 채택) — Windows NSIS / macOS dmg / Linux AppImage 빌더. peer dep 0, native binding 0.
- 신규 dev dep 0 외 — Onboarding / Approval Detail / LLM cost 는 모두 기존 dep 위에서 구현.
- GitHub Actions: 기존 `playwright.yml` (R10) 위에 `release.yml` + `usage-report.yml` 2 workflow 추가.

**참조:**

- Spec:
  - `docs/superpowers/specs/2026-04-18-rolestra-design.md`
    - §3 용어집: onboarding / capability snapshot / dry-run preview
    - §5.2 migration 013_onboarding_state + 014_llm_cost_audit_log (R11 신규 2 건)
    - §6 IPC: 신규 8 채널 (onboarding:* 3 + provider:detect + llm:cost-summary + execution:dry-run-preview + approval:detail-fetch + meeting:voting-history)
    - §7.1 멤버 프로필 (Onboarding step 3 역할 부여 — `displayName/role/personality/expertise` 입력)
    - §7.6 PermissionService (Onboarding step 4 권한 — 기존 PermissionFlagBuilder reuse)
    - §7.9 패키징 (Windows / macOS / Linux 정식)
    - §10 Phase R11 (Task 0 에서 R3~R10 템플릿으로 확장)
    - §11 E2E + 크로스 OS CI matrix (R10 활성 → R11 안정화)
    - §12 보안/프라이버시 (코드 사인 R12+ 명시)
  - `docs/superpowers/specs/r10-done-checklist.md` (Known Concerns 8 건 — 모두 R11 종결)
  - `docs/superpowers/specs/r9-done-checklist.md` (D8 Retro 영어 복귀 결정 재논의 항목)
- R10 plan/done-checklist: `docs/superpowers/plans/2026-04-24-rolestra-phase-r10.md`, `docs/superpowers/specs/r10-done-checklist.md`
- design polish 라운드 1·2 메모리:
  - `rolestra-design-polish-round1.md` — Approvals 필터바·상태배지 + Queue ASCII status mark
  - `rolestra-design-polish-round2.md` — D/C/A/B 라운드, B 가 R11 으로 이연
- Main 재사용 모듈:
  - `src/main/llm/meeting-summary-service.ts` — R11 Task 8/9 변경 위치
  - `src/main/approvals/{approval-service,approval-decision-router,approval-system-message-injector}.ts`
  - `src/main/projects/project-service.ts`
  - `src/main/execution/execution-service.ts`
  - `src/main/providers/registry.ts`
- Renderer 재사용:
  - `src/renderer/features/onboarding/{OnboardingPage,OBStepper,OBStaffCard,OBSummaryStrip,OBTopBar,DetectionBadge}.tsx` (design polish 라운드 2 land)
  - `src/renderer/features/approvals/{ApprovalInboxView,ApprovalFilterBar,ApprovalStatusBadge,CircuitBreakerApprovalRow}.tsx` (R10 + design polish 라운드 1)
  - `src/renderer/features/settings/tabs/{AutonomyDefaultsTab,AboutTab}.tsx` (R10)
- R11 신규 디렉토리:
  - `src/main/onboarding/` — OnboardingService + state repo (Task 6)
  - `src/renderer/features/onboarding/steps/` — step 3/4/5 (Task 6)
  - `src/renderer/features/approvals/detail/` — ApprovalDetailPanel + 5 카드 (Task 7)
  - `docs/디자인/` — `Rolestra_sample/` 이전 + sign-off (Task 13)

---

## Prereqs

- [x] R10 전체 완료 (15/15) + main ff-merge — `dc4a763` tip (design polish 라운드 1·2 commit 4 건 포함)
- [x] R10 done-checklist 작성 + Known Concerns 8 건 문서화
- [x] design polish 라운드 1·2 commit 4 건 main 위에 누적 (Approvals 필터바 / Queue stat bar / Onboarding step 2)
- [x] `OnboardingPage` step 2 fixture (design polish 라운드 2 A)
- [x] `ApprovalFilterBar` (design polish 라운드 1) — frontend 만 — wiring 미완
- [x] R10 Task 11 `meeting-summary-service` (`'streaming'` 임시 우회)
- [x] R10 Task 7 `theme:check:hex` 가드 — R11 신규 surface 도 통과해야 함
- [ ] `rolestra-phase-r11` 브랜치 main(`dc4a763`)에서 생성 (Task 0 첫 step) — **이미 생성됨, tip dc4a763**
- [ ] spec §10 R11 블록 R3~R10 템플릿으로 확장 (Task 0)

---

## File Structure (R11 종료 시)

```
src/
├── main/
│   ├── engine/                                       # v2 legacy 5 파일 + persona-builder 삭제 (Task 2)
│   │   ├── orchestrator.ts                           # DELETE
│   │   ├── turn-executor.ts                          # DELETE
│   │   ├── conversation.ts                           # DELETE
│   │   ├── execution-coordinator.ts                  # DELETE
│   │   ├── memory-coordinator.ts                     # DELETE
│   │   ├── persona-builder.ts                        # DELETE
│   │   └── __tests__/{orchestrator,...}.test.ts      # DELETE (대응 5+1 파일)
│   ├── onboarding/                                   # NEW 디렉토리 (Task 6)
│   │   ├── onboarding-service.ts                     # NEW
│   │   ├── onboarding-state-repository.ts            # NEW
│   │   └── __tests__/onboarding-service.test.ts
│   ├── llm/
│   │   ├── meeting-summary-service.ts                # + token count 기록 (Task 8) + 'summarize' capability (Task 9)
│   │   ├── llm-cost-repository.ts                    # NEW (Task 8)
│   │   └── __tests__/llm-cost-repository.test.ts
│   ├── approvals/
│   │   └── approval-system-message-injector.ts       # + filter 완화 + advisory 소비 (Task 10)
│   ├── projects/
│   │   └── project-service.ts                        # + pendingAdvisory slot (Task 10)
│   ├── execution/
│   │   └── execution-service.ts                      # + dryRunPreview API (Task 7)
│   ├── providers/
│   │   └── registry.ts                               # + 'summarize' capability 6 provider config 갱신 (Task 9)
│   ├── ipc/handlers/
│   │   ├── onboarding-handler.ts                     # NEW (Task 6) — onboarding:* 3 채널
│   │   ├── llm-handler.ts                            # NEW (Task 8) — llm:cost-summary
│   │   ├── execution-handler.ts                      # + execution:dry-run-preview (Task 7)
│   │   ├── approval-handler.ts                       # + approval:detail-fetch (Task 7)
│   │   ├── meeting-handler.ts                        # + meeting:voting-history (Task 7)
│   │   └── provider-handler.ts                       # + provider:detect (Task 6)
│   ├── database/migrations/
│   │   ├── 013-onboarding-state.ts                   # NEW (Task 6)
│   │   └── 014-llm-cost-audit-log.ts                 # NEW (Task 8)
│   └── index.ts                                      # R11 boot block: OnboardingService.detectFirstBoot + LlmCostRepository.init + capability snapshot + __rolestraDevHooks 가드
├── renderer/
│   ├── features/
│   │   ├── onboarding/
│   │   │   ├── OnboardingPage.tsx                    # + step 3/4/5 통합 (Task 6)
│   │   │   ├── onboarding-data.ts                    # fixture → provider:detect 결과 (Task 6)
│   │   │   ├── use-onboarding-state.ts               # NEW (Task 6)
│   │   │   └── steps/                                # NEW 디렉토리 (Task 6)
│   │   │       ├── Step3RoleAssignment.tsx
│   │   │       ├── Step4Permissions.tsx
│   │   │       └── Step5FirstProject.tsx
│   │   ├── approvals/
│   │   │   ├── ApprovalInboxView.tsx                 # + list+detail split layout (Task 7)
│   │   │   ├── ApprovalFilterBar.tsx                 # + filter onChange wiring (Task 7)
│   │   │   ├── use-approval-detail.ts                # NEW (Task 7)
│   │   │   └── detail/                               # NEW 디렉토리 (Task 7)
│   │   │       ├── ApprovalDetailPanel.tsx
│   │   │       ├── ApvDetailHeader.tsx
│   │   │       ├── ApvImpactedFilesCard.tsx
│   │   │       ├── ApvDiffPreviewCard.tsx
│   │   │       ├── ApvConsensusContextCard.tsx
│   │   │       └── ApvActionBar.tsx
│   │   └── settings/tabs/
│   │       ├── AutonomyDefaultsTab.tsx               # + LLM 비용 가시화 섹션 (Task 8)
│   │       └── AboutTab.tsx                          # + 온보딩 다시 시작 CTA wire (Task 6)
│   ├── hooks/
│   │   └── use-llm-cost-summary.ts                   # NEW (Task 8)
│   ├── App.tsx                                       # + first-boot onboarding 자동 진입 (Task 6)
│   └── i18n/locales/
│       └── {ko,en}.json                              # onboarding step 3/4/5 + approval detail + llm cost (Task 11)
├── shared/
│   ├── onboarding-types.ts                           # NEW (Task 5)
│   ├── llm-cost-types.ts                             # NEW (Task 5)
│   ├── approval-detail-types.ts                      # NEW (Task 5)
│   ├── provider-types.ts                             # + 'summarize' capability (Task 9)
│   ├── ipc-types.ts                                  # + 8 신규 채널 (Task 5)
│   └── ipc-schemas.ts                                # + zod
├── preload/
│   └── index.ts                                      # + 신규 IPC 화이트리스트 + __rolestraDevHooks 가드 (Task 4)
├── _legacy/                                          # 전체 디렉토리 DELETE (Task 1)
│   ├── migrations-v2/                                # DELETE
│   └── renderer-v1/                                  # DELETE
├── docs/
│   ├── 설계-문서.md                                  # 전면 재작성 (v2 → v3, Task 13)
│   ├── 기능-정의서.md                                # Rolestra v3 메타포 갱신 (Task 13)
│   ├── 구현-현황.md                                  # R1~R11 일괄 갱신 (Task 13)
│   ├── 아키텍처-결정-기록/                           # phase 별 묶음 ADR (Task 13, D8)
│   ├── 디자인/                                       # NEW — Rolestra_sample/ 이전 (Task 13)
│   └── superpowers/
│       ├── plans/
│       │   ├── 2026-04-26-rolestra-phase-r11.md      # (this file)
│       │   └── 2026-04-26-rolestra-phase-r11.md.tasks.json
│       └── specs/
│           ├── 2026-04-18-rolestra-design.md         # §10 R11 체크박스 확장 (Task 0)
│           └── r11-done-checklist.md                 # NEW (Task 16)
├── e2e/
│   ├── search-flow.spec.ts                           # NEW (Task 4)
│   ├── dm-flow.spec.ts                               # NEW (Task 4)
│   ├── onboarding-flow.spec.ts                       # NEW (Task 6)
│   ├── approval-detail-flow.spec.ts                  # NEW (Task 7)
│   └── autonomy-queue-flow.spec.ts                   # Step C 활성 (Task 4)
├── electron-builder.yml                              # NEW (Task 12)
├── .github/workflows/
│   ├── playwright.yml                                # (R10 land) — Task 4 에서 dispatch 실 run
│   ├── release.yml                                   # NEW (Task 12) — tag push 시 3 OS build
│   └── usage-report.yml                              # NEW (Task 14) — weekly cron
└── assets/
    ├── icon.ico                                      # Windows
    ├── icon.icns                                     # macOS
    └── icon.png                                      # Linux/AppImage
```

**파일 요약:**
- 신규 main: 2 디렉토리 (onboarding/ 추가, llm/ 확장) + 4 신규 service/repo + 2 마이그레이션 + 4 신규 IPC handler
- 신규 renderer: 2 디렉토리 (onboarding/steps + approvals/detail) + 9 신규 컴포넌트 + 3 신규 hook
- 수정 main: meeting-summary-service / approval-system-message-injector / project-service / execution-service / providers/registry / index.ts
- 수정 renderer: ApprovalInboxView / ApprovalFilterBar / OnboardingPage / AutonomyDefaultsTab / AboutTab / App.tsx
- 수정 shared: ipc-types / ipc-schemas / provider-types
- 수정 preload: 신규 IPC 화이트리스트 + __rolestraDevHooks
- 삭제 main: v2 engine 6 파일 + 7 `@ts-nocheck` (개별 평가) + 대응 테스트
- 삭제 _legacy: migrations-v2/ + renderer-v1/ 전체
- 신규 docs: 디자인/ + 아키텍처-결정-기록/ phase 별 묶음 ADR
- 수정 docs: 설계-문서.md / 기능-정의서.md / 구현-현황.md
- 신규 패키징: electron-builder.yml + 2 GitHub Actions workflow + 3 icon asset

---

## Tasks

### Task 0 — Branch + spec §10 R11 확장 + plan + tasks.json + Decision Log

**목표**: R11 브랜치는 이미 main tip(`dc4a763`)에서 생성됨. spec §10 R11 블록을 R3~R10 템플릿(체크박스 + 산출물 링크)으로 확장, Decision Log 9 건 (D1~D9) 기록.

- [ ] `git checkout rolestra-phase-r11` 확인 (이미 생성)
- [ ] spec §10 R11 블록 확장:
  - `- [ ]` 항목 16개 (Task 1~16 산출물과 1:1) + closeout 1개 = 17
  - **scope 경계** 하단 블록: V4 / 디자인 polish 라운드 3+ / 코드 사인 / DM 풍부화 / 음성 메모 / ComfyUI 연동
  - plan/done-checklist 링크 placeholder
- [ ] `docs/superpowers/plans/2026-04-26-rolestra-phase-r11.md.tasks.json` 생성 (17 task slot — Task 0 + Task 1~16)
- [ ] Decision Log (본 plan 끝에 Decision Log 섹션 추가):
  - D1~D9 — 본 plan 끝의 Decision Log 섹션 참고
- [ ] 커밋: `docs(rolestra): R11 plan + tasks.json + spec §10 R11 체크리스트 확장 (R11-Task0)`

**AC**:
- `rolestra-phase-r11` 브랜치 활성
- spec §10 R11 블록 체크박스 + scope 경계 + 링크 placeholder
- tasks.json 17-slot skeleton
- Decision Log 9 건 기록

**의존성**: 없음 (R10 main merge `dc4a763` 위에서 시작)
**R10 회귀 보호**: docs-only commit, 코드 변경 0
**Testing**: N/A (docs-only commit)

---

### Task 1 — `_legacy/` 디렉토리 일괄 물리 삭제

**목표**: spec §10 R11 본 정의 첫 항목 — `_legacy/migrations-v2/` (8 파일) + `_legacy/renderer-v1/` (8 디렉토리, 752KB) 일괄 삭제. 단일 commit (D1 — 일괄 삭제 채택).

- [ ] `git rm -r _legacy/` 한 번에 전체 삭제
- [ ] grep 검증: `grep -rln "_legacy" src/ docs/` (인용 0)
- [ ] tsconfig 경로/excludes 영향 확인 (없을 가능성 높음)
- [ ] 빌드/테스트 게이트 통과 확인:
  - `npm run typecheck` exit 0
  - `npm run build` exit 0
- [ ] 커밋: `chore(rolestra): _legacy/ 디렉토리 물리 삭제 — v2 migrations + renderer-v1 (R11-Task1)`

**AC**:
- `_legacy/` 디렉토리 부재
- src/ 또는 docs/ 어디에도 `_legacy` 인용 0
- typecheck / build / test 회귀 0
- repo 크기 -752KB

**의존성**: Task 0
**R10 회귀 보호**: src/ 트리는 변경 없음, _legacy/ 는 import 안 됨 (R10 시점 검증). build artifact 영향 0.
**Testing**: typecheck + build + test (회귀 0).

---

### Task 2 — v2 engine 6 파일 + 7 `@ts-nocheck` 파일 청소

**목표**: spec §10 R10 scope 경계 line 1327 R11 이연 — `src/main/engine/{orchestrator,turn-executor,conversation,execution-coordinator,memory-coordinator}.ts` (5 파일) + `engine/persona-builder.ts` (1 파일) 물리 삭제 + 대응 `__tests__/*.test.ts` 동시 삭제. 7 legacy `@ts-nocheck` 파일 (`consensus-driver.ts` / `consensus-handler.ts` / `permission-handler.ts` / `workspace-handler.ts` 등) 케이스 별 (a) 삭제 또는 (b) v3 재작성 + 주석 제거. D1 — 단계 분리 (Task 1 의 `_legacy/` 와는 별도 commit).

- [ ] 사전 단계: 각 파일이 src/ 트리 안에서 어디서 import 되는지 grep
  - `grep -rln "from.*engine/orchestrator" src/`
  - 동일 5+1+7 = 13 파일 검사
  - import 끊긴 (already dead) 파일은 즉시 삭제 후보
  - import 살아 있는 파일은 v3 모듈 (consensus-machine / meeting-orchestrator / consensus-driver) 으로 마이그레이션 후 삭제
- [ ] v2 engine 6 파일 삭제:
  - `src/main/engine/orchestrator.ts` + `__tests__/orchestrator.test.ts`
  - `src/main/engine/turn-executor.ts` + `__tests__/turn-executor.test.ts`
  - `src/main/engine/conversation.ts` + `__tests__/conversation.test.ts`
  - `src/main/engine/execution-coordinator.ts` + `__tests__/execution-coordinator.test.ts`
  - `src/main/engine/memory-coordinator.ts` + `__tests__/memory-coordinator.test.ts`
  - `src/main/engine/persona-builder.ts` + `__tests__/persona-builder.test.ts` (있으면)
- [ ] 7 `@ts-nocheck` 파일 처리:
  - `src/main/engine/consensus-driver.ts` — v3 ConsensusStateMachine 위임 또는 삭제 (R10 이후 사용 여부)
  - `src/main/ipc/handlers/consensus-handler.ts` — v3 router 와 통합 검토
  - `src/main/ipc/handlers/permission-handler.ts` — R10 Task 5 PermissionFlagBuilder 사용 (이미)
  - `src/main/ipc/handlers/workspace-handler.ts` — ArenaRootService 위임 검토
  - 나머지 3 파일 — `grep -rln "@ts-nocheck" src/` 로 식별 후 케이스 별 결정
- [ ] 각 파일 처리 후 `npm run typecheck` 통과 확인
- [ ] 커밋: `chore(rolestra): v2 engine 6 파일 + 7 @ts-nocheck 파일 청소 (R11-Task2)`

**AC**:
- v2 engine 6 파일 부재
- 7 `@ts-nocheck` 파일 → 0 (삭제) 또는 v3 재작성 후 nocheck 제거
- `grep -rln "@ts-nocheck" src/` exit 0 (0 hit)
- typecheck / lint / build / test 회귀 0
- v3 engine (consensus-machine / meeting-orchestrator / v3-side-effects) 정상 동작

**의존성**: Task 1
**R10 회귀 보호**: 삭제 전 grep 으로 import 끊긴 파일만 즉시 삭제, 살아 있으면 v3 마이그레이션. R9 `v3-side-effects.ts` 가 진짜 production path 이므로 그쪽은 영향 없음.
**Testing**: typecheck + test (회귀 0) + integration test (consensus / meeting 흐름).

---

### Task 3 — Pre-existing 14 test file 실패 정리 (database-* / memory-* / recovery-* / remote-* / handlers-v3 ipc)

**목표**: R10 Known Concern #8 종결. 14 테스트 파일이 모두 v2 시절 잔재 — (a) v3 도메인 모델 부재로 fail, (b) v2 모듈 import 경로 dead, (c) 마이그레이션 chain 변경에 미반영. 각 파일을 (i) v3 로 재작성, (ii) `it.skip` + skip reason 명시, (iii) 물리 삭제 — 셋 중 하나로 처리해서 `npm run test` exit 0 회복.

- [ ] 14 파일 식별 + 분류:
  - `database-*` (4 파일) — schema 변경에 미반영 가능성, v3 마이그레이션 chain 으로 재작성 또는 skip
  - `memory-*` (3 파일) — Phase 3-a (FTS5) 구현체에 맞춰 재작성
  - `recovery-*` (2 파일) — v2 시절 recovery 모델, v3 에서 미사용 → 삭제
  - `remote-*` (3 파일) — Remote Access 가 R10 까지 안 닿은 영역, v3 재작성 또는 skip
  - `handlers-v3 ipc` (2 파일) — v3 handler 명세 재정합 후 테스트 갱신
- [ ] 각 파일 별 결정 (R10 done-checklist Known Concern #8 의 각 영역 검토):
  - 재작성 — v3 명세 기반 수정
  - skip — `it.skip` + 명시적 reason `// R12+ — Remote Access v3 재설계 후 활성`
  - 삭제 — 완전히 죽은 영역
- [ ] `npm run test` exit 0 확인 (이전: 14 fail, 이후: 0 fail / 또는 skip 만)
- [ ] 커밋 1: `test(rolestra): pre-existing test failures 정리 — 14 파일 v3 마이그레이션 / skip / 삭제 (R11-Task3)`

**AC**:
- 14 파일 모두 처리 (재작성 / skip / 삭제 — 3 카테고리 중 하나)
- `npm run test` exit 0 (회귀 0 + R11 신규 테스트 추가 전 baseline 회복)
- skip 처리 시 모든 skip 에 reason comment + V4/R12+ 라벨

**의존성**: Task 2 (v2 engine 삭제 후 import dead 가 명확해짐)
**R10 회귀 보호**: R10 신규 테스트 (Task 7 / 11 / 12) 는 영향 없음. 본 task 는 R10 baseline 의 noise 만 제거.
**Testing**: `npm run test` exit 0 회복 자체가 acceptance.

---

### Task 4 — Playwright OS matrix 안정화 + 누락 spec 2 작성 + autonomy-queue Step C 활성 + 12 스크린샷

**목표**: R10 Known Concerns #1 + #2 + #3 + #6 동시 종결. (a) `search-flow.spec.ts` / `dm-flow.spec.ts` 2 spec 작성 (R10 Task 2/3 는 unit 만 산출), (b) autonomy-queue-flow Step C 의 mock breaker injection 활성 — `__rolestraDevHooks.tripFilesPerTurn(21)` debug hook 을 preload contextBridge 에 `ROLESTRA_E2E=1` 가드로 노출, (c) `.github/workflows/playwright.yml` workflow_dispatch 실 run + 결과 캡처 (9 spec × 3 OS = 27 cell green), (d) 12 스크린샷 (6 테마 × 2 surface) Windows native + macOS native 캡처 후 `appendix-r10-evidence/` 갱신 (R10 placeholder → 실 캡처).

- [ ] `e2e/search-flow.spec.ts` 신규: ShellTopBar 검색 진입 → query 입력 → 결과 list → row 클릭 → 채널 deep-link
- [ ] `e2e/dm-flow.spec.ts` 신규: NavRail DM 진입 → "+ 새 DM" → provider 선택 → DM 활성 → 메시지 입력 + 회의 시작 비활성 확인
- [ ] `src/preload/index.ts` 수정: `ROLESTRA_E2E === '1'` 일 때만 `__rolestraDevHooks` 객체 contextBridge 로 expose:
  - `tripFilesPerTurn(count: number)` — Circuit Breaker `files_per_turn` 강제 발동
  - `tripCumulativeCliMs(ms: number)` — `cumulative_cli_ms` 강제 발동
  - `tripQueueStreak(count: number)` — `queue_streak`
  - `tripSameError(error: string, count: number)` — `same_error`
- [ ] `src/main/index.ts` 수정: `process.env.ROLESTRA_E2E === '1'` 가드 — production code path 0 영향, dev hook 만 활성
- [ ] `e2e/autonomy-queue-flow.spec.ts` 수정: Step C 활성 — `await window.__rolestraDevHooks.tripFilesPerTurn(21)` → 강제 manual 다운그레이드 + OS 알림 검증
- [ ] `.github/workflows/playwright.yml` workflow_dispatch 실 run:
  - `windows-latest` × 9 spec
  - `macos-latest` × 9 spec
  - `ubuntu-latest` × 9 spec (xvfb-run)
  - 27 cell green 확인 + 결과 artifact 다운로드
- [ ] 12 스크린샷 캡처 (6 테마 × 2 surface — Dashboard + Messenger):
  - Windows native 빌드 (Task 12 와 통합 가능 — 또는 dev mode 캡처)
  - macOS native 빌드
  - `docs/superpowers/specs/appendix-r10-evidence/screenshots/` 디렉토리에 PNG
  - `README.md` 갱신 — placeholder 제거
- [ ] R11 done-checklist (Task 16) 에 OS matrix 결과 + screenshot 경로 기록
- [ ] 커밋: `ci(rolestra): Playwright OS matrix 안정화 + search/dm spec + autonomy Step C 활성 + 12 스크린샷 (R11-Task4)`

**AC**:
- 9 spec × 3 OS = 27 matrix cell 모두 green (workflow run 결과 artifact 캡처)
- search-flow / dm-flow spec 추가 — R10 Known Concern #3 종결
- autonomy-queue Step C 실 실행 (Circuit Breaker downgrade 시나리오) — R10 Known Concern #2 종결
- `__rolestraDevHooks` 가 `ROLESTRA_E2E=1` 일 때만 노출 — production safety
- 12 스크린샷 — Windows + macOS native 캡처 (R10 Known Concern #6 종결)

**의존성**: Task 3 (test baseline 회복 후 OS matrix 가 fail 노이즈 없이 측정 가능)
**R10 회귀 보호**: production code path 변경 0 (dev hook 만 ROLESTRA_E2E 가드). E2E spec 추가는 신규.
**Testing**: GitHub Actions workflow_dispatch run + 27 cell 결과 캡처.

---

### Task 5 — Shared types + 8 신규 IPC + zod + preload + provider-types capability 확장

**목표**: R11 신규 도메인 (onboarding / llm cost / approval detail) 의 IPC 경계 shared 에 확정. 8 신규 채널 + `'summarize'` capability 추가.

- [ ] `src/shared/onboarding-types.ts` 신규:
  - `OnboardingStep` `1 | 2 | 3 | 4 | 5`
  - `OnboardingState` `{ completed: boolean; currentStep: OnboardingStep; selections: { staff?: string[]; roles?: Record<string, string>; permissions?: PermissionMode; firstProject?: { slug: string; kind: ProjectKind } }; updatedAt: number }`
  - `ProviderDetectionSnapshot` `{ providerId: string; kind: ProviderKind; available: boolean; reason?: string; capabilities: ProviderCapability[] }`
- [ ] `src/shared/llm-cost-types.ts` 신규:
  - `LlmCostAuditEntry` `{ id: number; meetingId: string | null; providerId: string; tokenIn: number; tokenOut: number; createdAt: number }`
  - `LlmCostSummary` `{ byProvider: Array<{providerId: string; tokenIn: number; tokenOut: number; estimatedUsd: number | null}>; totalTokens: number; periodStartAt: number; periodEndAt: number }`
- [ ] `src/shared/approval-detail-types.ts` 신규:
  - `ApprovalImpactedFile` `{ path: string; addedLines: number; removedLines: number; changeKind: 'modified'|'added'|'deleted' }`
  - `ApprovalDiffPreview` `{ path: string; preview: string; truncated: boolean }`
  - `ApprovalConsensusContext` `{ meetingId: string | null; participantVotes: Array<{providerId: string; vote: 'approve'|'reject'|'abstain'; comment?: string}>; }`
  - `ApprovalDetail` `{ approval: ApprovalItem; impactedFiles: ApprovalImpactedFile[]; diffPreviews: ApprovalDiffPreview[]; consensusContext: ApprovalConsensusContext | null }`
  - `ApprovalListFilter` `{ status: 'pending'|'approved'|'rejected'|'all' }`
- [ ] `src/shared/provider-types.ts` 확장: `ProviderCapability` union 에 `'summarize'` 추가 (Task 9 정식 사용)
- [ ] `src/shared/ipc-types.ts` 확장:
  - `onboarding:get-state`: `{ request: void; response: OnboardingState }`
  - `onboarding:set-state`: `{ request: { partial: Partial<OnboardingState> }; response: OnboardingState }`
  - `onboarding:complete`: `{ request: void; response: void }`
  - `provider:detect`: `{ request: void; response: { snapshots: ProviderDetectionSnapshot[] } }`
  - `llm:cost-summary`: `{ request: { periodDays?: number }; response: LlmCostSummary }`
  - `execution:dry-run-preview`: `{ request: { approvalId: string }; response: { impactedFiles: ApprovalImpactedFile[]; diffPreviews: ApprovalDiffPreview[] } }`
  - `approval:detail-fetch`: `{ request: { approvalId: string }; response: ApprovalDetail }`
  - `meeting:voting-history`: `{ request: { meetingId: string }; response: ApprovalConsensusContext }`
- [ ] `src/shared/ipc-schemas.ts` 확장: 8 채널 zod
- [ ] `src/preload/index.ts`: 신규 IPC 화이트리스트 + `__rolestraDevHooks` (Task 4 와 통합 commit 가능, 우선 화이트리스트만)
- [ ] `src/shared/__tests__/ipc-schemas.test.ts` 확장: round-trip 16+ cases
- [ ] 커밋: `feat(rolestra): R11 shared types + 8 IPC + summarize capability + zod (R11-Task5)`

**AC**:
- 8 신규 IPC 채널이 ipc-types / ipc-schemas / preload 일관 선언
- `'summarize'` capability 추가, 기존 `'streaming'` 우회 코드는 Task 9 에서 교체
- zod round-trip 16+ cases green
- 기존 R10 채널 회귀 0
- typecheck exit 0

**의존성**: Task 0
**R10 회귀 보호**: shared 확장만 — 기존 채널 변경 0. R10 IPC 회귀 0.
**Testing**: Vitest schema round-trip + typecheck.

---

### Task 6 — Onboarding 첫 부팅 wizard 정식 (step 3/4/5 + provider:detect + 영구화 + 자동 진입)

**목표**: design polish 라운드 2 A 라운드 (step 2 fixture) 위에 정식 5-step 완성. 마이그레이션 013 신규.

- [ ] `src/main/database/migrations/013-onboarding-state.ts` 신규:
  ```sql
  CREATE TABLE onboarding_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),  -- 단일 row
    completed INTEGER NOT NULL DEFAULT 0,
    current_step INTEGER NOT NULL DEFAULT 1,
    selections_json TEXT NOT NULL DEFAULT '{}',
    updated_at INTEGER NOT NULL
  );
  INSERT INTO onboarding_state (id, completed, current_step, selections_json, updated_at) VALUES (1, 0, 1, '{}', strftime('%s','now')*1000);
  ```
- [ ] `src/main/database/migrations/index.ts`: 013 등록 (forward-only, idempotent)
- [ ] `src/main/onboarding/onboarding-state-repository.ts` 신규: `get()` / `upsert(partial)` / `complete()` / `reset()`
- [ ] `src/main/onboarding/onboarding-service.ts` 신규: `detectFirstBoot()` / `getState()` / `setState(partial)` / `complete()` / `reset()` (Settings.AboutTab CTA 용)
- [ ] `src/main/index.ts` 수정: boot block — `onboardingService.detectFirstBoot()` 결과를 startup payload 에 포함 (renderer 가 처음 mount 시 view 결정)
- [ ] `src/main/ipc/handlers/onboarding-handler.ts` 신규: 3 채널 (`get-state` / `set-state` / `complete`)
- [ ] `src/main/ipc/handlers/provider-handler.ts` 확장: `provider:detect` — registry 에서 6 provider 의 capability + available 상태 snapshot 반환
- [ ] `src/main/ipc/router.ts`: 4 채널 등록
- [ ] `src/renderer/features/onboarding/use-onboarding-state.ts` 신규: zustand + IPC sync
- [ ] `src/renderer/features/onboarding/onboarding-data.ts` 수정: fixture (라운드 2) → `provider:detect` 결과로 dynamic
- [ ] `src/renderer/features/onboarding/steps/Step3RoleAssignment.tsx` 신규:
  - 선택된 staff 별 displayName / role / personality / expertise 입력 폼
  - default 는 design polish 라운드 2 의 STAFF_CANDIDATES 의 vendor / role tagline 활용
- [ ] `src/renderer/features/onboarding/steps/Step4Permissions.tsx` 신규:
  - 3 모드 (auto / hybrid / approval) 라디오 — 사용자 선택
  - PermissionFlagBuilder (R10 Task 5) 의 dry-run-flags 미리 보기 (제공 안 하면 단순 라벨만)
- [ ] `src/renderer/features/onboarding/steps/Step5FirstProject.tsx` 신규:
  - 프로젝트 종류 선택 (new / external / imported)
  - 프로젝트 slug 입력 + 경로 미리 보기
  - "완료" 클릭 → `onboarding:complete` + `view='dashboard'` 자동 전환
- [ ] `src/renderer/features/onboarding/OnboardingPage.tsx` 수정: step 3/4/5 라우팅 통합
- [ ] `src/renderer/App.tsx` 수정: first-boot 감지 시 `view='onboarding'` 강제, completed 시 `view='dashboard'`
- [ ] `src/renderer/features/settings/tabs/AboutTab.tsx` 수정: "온보딩 다시 시작" CTA → `onboarding:complete` 의 reset 분기 + `view='onboarding'` 전환 (현재 testid 만)
- [ ] `e2e/onboarding-flow.spec.ts` 신규: first boot 시뮬레이션 → step 1~5 진행 → 완료 → Dashboard 진입 + 재시작 시 reentry 안 함
- [ ] `__tests__/onboarding-service.test.ts` 8+ cases
- [ ] `__tests__/Step3RoleAssignment.test.tsx` 6+
- [ ] `__tests__/Step4Permissions.test.tsx` 5+
- [ ] `__tests__/Step5FirstProject.test.tsx` 5+
- [ ] `__tests__/OnboardingPage.test.tsx` 통합 6+
- [ ] `__tests__/use-onboarding-state.test.tsx` 5+
- [ ] 커밋: `feat(rolestra): Onboarding 정식 wizard — step 3/4/5 + provider:detect + 영구화 (R11-Task6)`

**AC**:
- 첫 부팅 시 `view='onboarding'` 자동 진입
- step 1~5 진행 + step 별 데이터 영구화
- 완료 후 `view='dashboard'` 전환 + 재시작 시 onboarding 재진입 안 함
- Settings.AboutTab "온보딩 다시 시작" CTA 정식 동작
- migration 013 idempotent
- E2E spec 1 추가
- 신규 `onboarding.step3.*` / `onboarding.step4.*` / `onboarding.step5.*` i18n 키 (Task 11)
- 기존 design polish 라운드 2 onboarding (step 2) 회귀 0

**의존성**: Task 5 (shared types + IPC)
**R10 회귀 보호**: design polish 라운드 2 의 step 2 컴포넌트는 그대로 reuse, raw fixture 만 dynamic 으로 교체. NavRail / Shell 영향 0.
**Testing**: Vitest + React Testing Library + Playwright.

---

### Task 7 — Approvals 상세 패널 (design polish 라운드 2 B 이월) + dryRunPreview IPC

**목표**: design polish 라운드 2 B (R11/R12 데이터 layer 의존으로 backlog 이월) 정식 land. (a) `ExecutionService.dryRunPreview` IPC 신설, (b) `approval:detail-fetch` 통합 IPC, (c) `approval:list({status})` filter wiring, (d) `meeting:voting-history` IPC, (e) ApprovalDetailPanel + 5 카드 컴포넌트, (f) ApprovalInboxView list+detail split layout.

- [ ] `src/main/execution/execution-service.ts` 수정: `dryRunPreview(approvalId): Promise<{impactedFiles, diffPreviews}>` 메서드 추가 — 기존 internal `dryRunApply` 의 changes 계산을 read-only wrapper 로 노출 (atomic apply 안 함)
- [ ] `src/main/ipc/handlers/execution-handler.ts` 확장: `execution:dry-run-preview` 등록
- [ ] `src/main/ipc/handlers/approval-handler.ts` 확장: `approval:detail-fetch` — approval row + dryRunPreview 결과 + voting-history 결과를 통합 응답
- [ ] `src/main/ipc/handlers/meeting-handler.ts` 확장: `meeting:voting-history` — meeting record 의 participant votes + comments
- [ ] `src/renderer/features/approvals/use-approval-detail.ts` 신규: `useApprovalDetail(id)` → `{detail, isLoading, error, refetch}`
- [ ] `src/renderer/features/approvals/detail/ApprovalDetailPanel.tsx` 신규: root + Header + ImpactedFiles + DiffPreview + ConsensusContext + ActionBar
- [ ] `src/renderer/features/approvals/detail/ApvDetailHeader.tsx` 신규: avatar + name + role + status badge (R10 design polish 라운드 1 의 ApprovalStatusBadge reuse)
- [ ] `src/renderer/features/approvals/detail/ApvImpactedFilesCard.tsx` 신규: file list + +/- lines + changeKind icon
- [ ] `src/renderer/features/approvals/detail/ApvDiffPreviewCard.tsx` 신규: 첫 1~3 파일의 diff preview (truncated 표시)
- [ ] `src/renderer/features/approvals/detail/ApvConsensusContextCard.tsx` 신규: voting list + comments
- [ ] `src/renderer/features/approvals/detail/ApvActionBar.tsx` 신규: 승인 / 조건부 / 거절 — 기존 `approval:decide` IPC 사용
- [ ] `src/renderer/features/approvals/ApprovalInboxView.tsx` 수정: list+detail split layout (좌측 list + 우측 ApprovalDetailPanel)
- [ ] `src/renderer/features/approvals/ApprovalFilterBar.tsx` 수정: filter onChange wiring → `usePendingApprovals` 가 `{status}` 매개변수 받도록 확장 + `approval:list({status})` 전달
- [ ] `e2e/approval-detail-flow.spec.ts` 신규: ApprovalInbox → row 클릭 → detail panel 표시 → impactedFiles 확인 → "승인" 클릭 → 결정 반영
- [ ] `__tests__/use-approval-detail.test.tsx` 6+
- [ ] `__tests__/ApprovalDetailPanel.test.tsx` 8+
- [ ] `__tests__/ApvImpactedFilesCard.test.tsx` 4+
- [ ] `__tests__/ApvDiffPreviewCard.test.tsx` 4+
- [ ] `__tests__/ApvConsensusContextCard.test.tsx` 4+
- [ ] `__tests__/ApvActionBar.test.tsx` 4+
- [ ] `__tests__/execution-service.test.ts` 확장: `dryRunPreview` 6+ cases
- [ ] 커밋: `feat(rolestra): Approval 상세 패널 + dryRunPreview IPC + filter wiring (R11-Task7)`

**AC**:
- ApprovalInbox list+detail split layout 정상 동작
- row 클릭 → detail panel 5 카드 표시 (impactedFiles + diffPreview + consensusContext + actionBar)
- ApprovalFilterBar onChange → list 가 status 별로 다른 fetch
- `dryRunPreview` 가 atomic apply 안 함 (read-only)
- E2E spec 1 추가
- 신규 `approval.detail.*` i18n 키 (Task 11)
- 기존 R10 ApprovalInbox / R10 design polish 라운드 1 회귀 0

**의존성**: Task 5 (shared types)
**R10 회귀 보호**: ApprovalInbox 는 list 표시 유지 (split layout 추가만), 기존 row 클릭 → 결정 흐름 호환. design polish 라운드 1 의 ApprovalStatusBadge / ApprovalFilterBar 는 reuse.
**Testing**: Vitest + React Testing Library + Playwright.

---

### Task 8 — LLM 비용 가시화 (마이그레이션 014 + LlmCostRepository + cost-summary IPC + AutonomyDefaultsTab 섹션)

**목표**: R10 D7 open question 의 첫 번째 항목 종결 — meeting-summary-service 의 token count audit log + Settings 에서 누적 비용 표시. R11 두 번째 (마지막) forward-only 마이그레이션.

- [ ] `src/main/database/migrations/014-llm-cost-audit-log.ts` 신규:
  ```sql
  CREATE TABLE llm_cost_audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    meeting_id TEXT,
    provider_id TEXT NOT NULL,
    token_in INTEGER NOT NULL,
    token_out INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX idx_llm_cost_audit_provider ON llm_cost_audit_log(provider_id, created_at);
  CREATE INDEX idx_llm_cost_audit_meeting ON llm_cost_audit_log(meeting_id);
  ```
- [ ] `src/main/database/migrations/index.ts`: 014 등록
- [ ] `src/main/llm/llm-cost-repository.ts` 신규: `append(entry)` / `summary({periodDays?})` / `summaryByProvider({periodDays?})`
- [ ] `src/main/llm/meeting-summary-service.ts` 수정: provider 호출 후 응답의 usage 객체 (Anthropic `usage.input_tokens/output_tokens`, OpenAI `usage.prompt_tokens/completion_tokens`) 추출 → `LlmCostRepository.append`
- [ ] `src/main/ipc/handlers/llm-handler.ts` 신규: `llm:cost-summary` 채널 등록
- [ ] `src/main/index.ts` 수정: boot block — `LlmCostRepository.init(db)`
- [ ] `src/renderer/hooks/use-llm-cost-summary.ts` 신규: `useLlmCostSummary({periodDays})` → `{summary, isLoading}`
- [ ] `src/renderer/features/settings/tabs/AutonomyDefaultsTab.tsx` 수정: "LLM 사용량" 섹션 추가 — provider 별 누적 토큰 + 추정 USD (단가는 D5 — 사용자가 별도 입력, R11 default 0)
- [ ] `__tests__/llm-cost-repository.test.ts` 8+ cases
- [ ] `__tests__/meeting-summary-service.test.ts` 확장: token count append 6+ cases
- [ ] `__tests__/use-llm-cost-summary.test.tsx` 5+
- [ ] `__tests__/AutonomyDefaultsTab.test.tsx` 확장: LLM cost section 4+ cases
- [ ] `__tests__/migrations.test.ts` 확장: 014 up + idempotent + down
- [ ] 커밋: `feat(rolestra): LLM 비용 가시화 — 014 migration + llm-cost-repository + AutonomyDefaultsTab 섹션 (R11-Task8)`

**AC**:
- meeting-summary-service 호출 후 `llm_cost_audit_log` row 추가
- AutonomyDefaultsTab 의 LLM 사용량 섹션 누적 토큰 정확
- migration 014 idempotent
- R10 D7 open question (첫 번째) 종결
- R10 Task 11 회귀 0 (기존 fallback chain 동작 유지)

**의존성**: Task 5 (shared types)
**R10 회귀 보호**: meeting-summary-service 의 호출 흐름은 그대로, 응답 처리에 token count 추출 추가만. fallback chain 영향 0.
**Testing**: Vitest + 마이그레이션 통합.

---

### Task 9 — `'summarize'` capability literal 정식 도입 + provider config 갱신

**목표**: R10 Known Concern #7 종결 — `'summarize'` 가 v3 ProviderCapability union 에 추가됐으므로 (Task 5) meeting-summary-service 의 임시 `'streaming'` fallback 우회 제거 + 6 provider config 갱신.

- [ ] `src/main/providers/registry.ts` 수정: 6 provider config 의 capabilities 배열에 `'summarize'` 추가 여부 명시
  - Claude API — `'summarize'` (Sonnet 이상)
  - Codex — `'summarize'` (GPT-4 mini 등 — provider docs 확인)
  - Gemini — `'summarize'` (1.5 Pro 이상)
  - Anthropic API direct — `'summarize'`
  - OpenAI API direct — `'summarize'`
  - Local Ollama — provider 별 model 따라 (Llama 3 이상은 yes)
- [ ] `src/main/llm/meeting-summary-service.ts` 수정: `'streaming'` 임시 우회 제거 → `'summarize'` true 인 첫 provider fallback chain
- [ ] `src/shared/provider-types.ts` (Task 5) 의 `ProviderCapability` union 확정 검증
- [ ] `__tests__/meeting-summary-service.test.ts` 확장: capability filter 5+ cases
- [ ] `__tests__/registry.test.ts` (또는 동등): capability snapshot 검증 6 provider
- [ ] 커밋: `feat(rolestra): 'summarize' capability 정식 도입 + provider config 갱신 (R11-Task9)`

**AC**:
- ProviderCapability union 에 `'summarize'` 추가
- 6 provider config 의 capabilities 명시
- meeting-summary-service 가 `'summarize'` 로 fallback chain
- `'streaming'` 임시 우회 코드 0
- R10 Known Concern #7 종결
- 기존 R10 Task 11 회귀 0 (fallback chain 결과 동일 — provider 가 capability 가지고 있으면 같은 흐름)

**의존성**: Task 5 (capability 추가) + Task 8 (cost audit 위에서 capability 결정)
**R10 회귀 보호**: provider config 변경 — 기존 호출자 (api/cli/local) 의 호출 인터페이스 변경 0. capability snapshot 만 확장.
**Testing**: Vitest.

---

### Task 10 — mode_transition conditional advisory 자동 주입 (R10 Known Concern #4 종결)

**목표**: R10 Known Concern #4 — ApprovalSystemMessageInjector filter 가 mode_transition (meetingId=null) 차단 → conditional comment 가 채팅 thread 에 안 들어감. R11 Task 10 이 (a) injector filter 완화 (mode_transition 만 예외), (b) ProjectService.pendingAdvisory slot, (c) MeetingOrchestrator 의 advisory 소비, (d) 소비 후 slot 비움.

- [ ] `src/main/projects/project-service.ts` 수정: `setPendingAdvisory(projectId, advisory)` / `consumePendingAdvisory(projectId): string|null` 메서드 추가 (in-memory state — 다음 회의까지만 유효, 영속화 미요구 D7)
- [ ] `src/main/approvals/approval-decision-router.ts` 수정: `kind='mode_transition' + decision='conditional'` 분기 → `projectService.setPendingAdvisory(comment)`
- [ ] `src/main/approvals/approval-system-message-injector.ts` 수정: filter 3 (`channelId === null || meetingId === null` 시 skip) 완화 — `kind === 'mode_transition'` 인 경우는 advisory slot 으로 라우팅 (channel 안 가도 됨)
- [ ] `src/main/meetings/engine/meeting-orchestrator.ts` 수정: `start()` 직후 `projectService.consumePendingAdvisory(projectId)` → 결과 있으면 system message prepend + slot 비움
- [ ] `__tests__/project-service.test.ts` 확장: pendingAdvisory 4+ cases
- [ ] `__tests__/approval-decision-router.test.ts` 확장: mode_transition conditional 분기 4+
- [ ] `__tests__/approval-system-message-injector.test.ts` 확장: filter 완화 4+
- [ ] `__tests__/meeting-orchestrator.test.ts` 확장: advisory 소비 4+
- [ ] 커밋: `feat(rolestra): mode_transition conditional advisory 자동 주입 (R11-Task10)`

**AC**:
- ApprovalBlock conditional 클릭 → 다음 회의 system message 자동 prepend
- advisory 소비 후 slot 비움 (이중 주입 방지)
- R10 Known Concern #4 종결
- 기존 ApprovalSystemMessageInjector / MeetingOrchestrator 회귀 0

**의존성**: Task 0
**R10 회귀 보호**: filter 완화는 mode_transition 만 (기존 다른 kind 영향 0). ProjectService 신규 메서드 추가 — 기존 메서드 변경 0.
**Testing**: Vitest.

---

### Task 11 — i18n ko/en parity 확장 + main-process 잔여 라벨 결정 (R10 Known Concern #5)

**목표**: R11 신규 namespace populate (onboarding step 3/4/5 / approval detail / llm cost) + R10 Known Concern #5 의 main-process 잔여 한국어 trace 라인 결정 적용.

- [ ] R11 신규 namespace populate (ko + en):
  - `onboarding.step3.{title, role, personality, expertise, displayName, save, ...}` (10+ 키)
  - `onboarding.step4.{title, modeAuto, modeHybrid, modeApproval, dangerousAutoOptIn, ...}` (8+ 키)
  - `onboarding.step5.{title, projectName, projectKind, slug, finalize, ...}` (8+ 키)
  - `approval.detail.{header, impactedFiles, diffPreview, consensusContext, action, ...}` (15+ 키)
  - `llm.cost.{title, byProvider, totalTokens, estimatedUsd, periodLabel, ...}` (8+ 키)
- [ ] R10 Known Concern #5 결정 적용:
  - **default (D9)**: 한국어 유지 + locale 분기 옵션 추가 — `notification-labels.ts` dictionary 에 `approval-notification-bridge` / `autonomy-gate` trace 라벨 항목 신설, ko = 기존 한국어 / en = 영어 번역
  - 사용자 sign-off 후 다른 결정 시 D9 갱신 + 본 task 재실행
- [ ] `src/main/notifications/notification-labels.ts` 확장: `approvalNotificationBridge.*` / `autonomyGate.trace.*` 항목 추가
- [ ] `src/main/approvals/approval-notification-bridge.ts` 수정: 한국어 inline 라벨 → dictionary 사용
- [ ] `src/main/autonomy/autonomy-gate.ts` 수정: trace 라벨 dictionary 사용
- [ ] `i18next-parser.config.js` 수정: keepRemoved regex 확장
- [ ] `npm run i18n:check` exit 0 + idempotent
- [ ] `__tests__/notification-labels.test.ts` 확장: 신규 키 + en parity 6+
- [ ] 커밋: `feat(rolestra): i18n parity R11 + main-process 잔여 라벨 dictionary 이전 (R11-Task11)`

**AC**:
- ko + en 양쪽 동일 schema
- main-process 한국어 inline 라벨 0 (모두 dictionary)
- LanguageTab 토글 → 모든 surface 일관 전환
- i18n:check exit 0 (idempotent)
- R10 Known Concern #5 종결 (D9 결정 반영)

**의존성**: Task 6 / Task 7 / Task 8 (신규 namespace 의 키 발견)
**R10 회귀 보호**: 기존 dictionary 키 변경 0. 추가만.
**Testing**: Vitest + i18n:check.

---

### Task 12 — 패키징 정식 — electron-builder + Windows installer + macOS dmg + Linux AppImage + release workflow

**목표**: spec §10 R11 본 정의 두 번째 항목 — Windows 인스톨러 + macOS dmg. + R10 scope 경계의 Linux AppImage. D2 (electron-builder 채택).

- [ ] `npm install -D electron-builder`
- [ ] `electron-builder.yml` 신규:
  - `appId: io.rolestra.app`
  - `productName: Rolestra`
  - `directories.output: dist/electron`
  - `win.target: nsis` + `win.icon: assets/icon.ico`
  - `mac.target: dmg` + `mac.category: public.app-category.productivity` + `mac.icon: assets/icon.icns` + `mac.identity: null` (unsigned, R12+)
  - `linux.target: AppImage` + `linux.icon: assets/icon.png` + `linux.category: Development`
  - `extraResources` — 기본 ArenaRoot fixture (선택)
  - `electronVersion: 40.x` (현재 사용 버전)
- [ ] `package.json` scripts 추가:
  - `package:win`: `electron-builder --win`
  - `package:mac`: `electron-builder --mac`
  - `package:linux`: `electron-builder --linux`
  - `package`: `electron-builder` (current OS)
- [ ] `assets/icon.{ico,icns,png}` — design polish 결과물 또는 placeholder. brand 확정 시 갱신.
- [ ] `.github/workflows/release.yml` 신규:
  - tag push (`v*`) trigger
  - matrix `[windows-latest, macos-latest, ubuntu-latest]`
  - jobs: setup-node 20 → npm ci → npm run build → npm run package:{os}
  - artifact upload (`dist/electron/**.{exe,dmg,AppImage}`)
  - GitHub Release draft 자동 생성 + artifact attach
- [ ] 로컬 검증: `npm run package:linux` (WSL native 가능) + 결과 AppImage 실행 검증 (xvfb-run)
- [ ] Windows / macOS 검증은 GitHub Actions runner 에서 (workflow_dispatch 로 dry-run)
- [ ] `docs/설계-문서.md` (Task 13) 의 패키징 섹션 + Gatekeeper 우회 안내 (`spctl` / "이 항목 열기" right-click) 추가
- [ ] 커밋: `feat(rolestra): electron-builder 패키징 + Windows installer + macOS dmg + Linux AppImage + release workflow (R11-Task12)`

**AC**:
- `npm run package:linux` 로컬 성공 → AppImage 산출
- workflow_dispatch trigger 시 3 OS artifact 생성 + GitHub Release draft 등록
- electron-builder.yml + 3 icon asset + release.yml 모두 등록
- macOS dmg 는 unsigned 명시 + Gatekeeper 우회 안내 docs

**의존성**: Task 1 / Task 2 (legacy 청소 후 build artifact 깨끗) + Task 11 (i18n complete)
**R10 회귀 보호**: build 산출물에 영향 — vite.config 변경 미요구. asar / extraResources 만 추가.
**Testing**: 로컬 AppImage 산출 + GitHub Actions workflow_dispatch dry-run + 결과 artifact 다운로드 확인.

---

### Task 13 — 사용자 문서 v3 전면 재작성 + ADR 통합 + 디자인 폴더 정식

**목표**: spec §10 R11 본 정의 세 번째 항목 — `docs/설계-문서.md` v3 교체. + 기능-정의서 / 구현-현황 / ADR / 디자인 폴더 통합.

- [ ] `docs/설계-문서.md` 전면 재작성:
  - v2 (Python/FastAPI/Svelte) 시대 내용 전면 교체
  - v3 — Electron 40 + TypeScript strict + React 19 + Tailwind + Radix + Zustand + better-sqlite3 + react-i18next + Vitest + Playwright + electron-builder
  - 아키텍처 도식 — main / renderer / preload / shared 4 layer
  - 핵심 모듈 — ConsensusStateMachine 12 state / Provider Registry / ExecutionService / ArenaRootService / PermissionService / Memory FTS5 / IPC TypedInvoke / StreamBridge
  - 6 테마 시스템 + 형태 토큰
  - 자율 모드 + Circuit Breaker 4 tripwire
  - Onboarding wizard 5-step
  - 패키징 (electron-builder) + OS 별 아티팩트
- [ ] `docs/기능-정의서.md` 재작성: Rolestra v3 메타포 + 10 phase 구조 + 12 SSM state + 6 테마 + 자율 모드 4 tripwire + onboarding 반영. ko-only.
- [ ] `docs/구현-현황.md` R1~R11 일괄 갱신: 각 phase 별 commit / done-checklist 링크 + Known Concerns / R12+ 이연.
- [ ] `docs/아키텍처-결정-기록/` 정리 (D8 — phase 별 묶음 ADR):
  - `R1-R3-decisions.md` (R1~R3 의 D 통합)
  - `R4-R6-decisions.md`
  - `R7-R9-decisions.md`
  - `R10-decisions.md` (R10 D1~D10)
  - `R11-decisions.md` (R11 D1~D9)
  - `cross-cutting.md` — phase 무관 핵심 결정 (`secrets safeStorage` / `IPC typedInvoke` / `path-guard` 방어 범위 등)
- [ ] `docs/디자인/` 신규: `docs/Rolestra_sample/` 의 6 화면 × 6 변형 시안 이전 + sign-off 마크 (12 스크린샷 from Task 4)
- [ ] CLAUDE.md `핵심 문서` 섹션 갱신 — 본 task 산출 문서 경로 반영
- [ ] 커밋: `docs(rolestra): 설계 문서 v3 전면 재작성 + ADR 통합 + 디자인 폴더 정식 (R11-Task13)`

**AC**:
- `docs/설계-문서.md` v3 기반 전면 재작성 (v2 잔재 0)
- `docs/기능-정의서.md` Rolestra v3 메타포 반영
- `docs/구현-현황.md` R1~R11 일괄 갱신
- ADR phase 별 묶음 문서 6 개
- `docs/디자인/` 정식 — sign-off 마크
- CLAUDE.md 문서 표 갱신

**의존성**: Task 4 (12 스크린샷 캡처 후 sign-off 가능) + Task 12 (패키징 결과 후 패키징 섹션 작성 가능)
**R10 회귀 보호**: docs only — 코드 변경 0.
**Testing**: 사용자 검토.

---

### Task 14 — CI macOS hosted runner 비용 monitoring (R10 D5 risk 종결)

**목표**: R10 D5 risk — macOS GitHub Actions runner minutes 비용. R11 Task 14 가 (a) usage report 자동화, (b) macOS PR-level trigger 분리 (label 기반), (c) weekly cron 만 모두 OS run.

- [ ] `.github/workflows/usage-report.yml` 신규:
  - schedule cron `0 0 * * 0` (weekly Sunday UTC)
  - GitHub API 로 organization / repository billing usage fetch (gh api `/repos/{owner}/{repo}/actions/billing/macos`)
  - 결과 issue 또는 markdown report 로 commit (혹은 README badge 갱신)
- [ ] `.github/workflows/playwright.yml` 수정:
  - PR trigger 시 — Windows + Linux 만 (macOS 제외)
  - `[macos]` label 또는 manual workflow_dispatch 시만 macOS 추가
  - schedule cron `0 6 * * 1` (weekly Monday) — 모든 OS 풀 매트릭스
- [ ] README badge — macOS minutes 사용량 표기 (선택)
- [ ] 커밋: `ci(rolestra): macOS hosted runner 비용 monitoring + PR/cron trigger 분리 (R11-Task14)`

**AC**:
- usage-report.yml weekly cron 가능
- playwright.yml 의 macOS PR trigger 가 label 기반
- weekly cron 으로 풀 매트릭스 검증
- R10 D5 risk 종결

**의존성**: Task 4 (playwright.yml 안정화 후)
**R10 회귀 보호**: workflow 변경만 — production code 영향 0.
**Testing**: workflow_dispatch test run + 결과 검증.

---

### Task 15 — Optimistic UI 확장 (D8 — `ApprovalBlock.decide` + `MemberProfile.edit`)

**목표**: R10 D8 결정 — Optimistic UI 는 R10 에서 3 hook 만 (use-channel-messages.send / use-autonomy-mode.confirm / use-queue.addLines), 추가는 R11 이후. R11 Task 15 가 (a) `ApprovalBlock.decide` 의 mutation 흐름 — 결정 직후 row status 임시 변경 + 실패 시 rollback, (b) `MemberProfile.edit` 의 displayName / role 편집 — 입력 후 dialog 닫고 row 즉시 갱신 + 실패 시 dialog 재열림 + 입력 복구.

- [ ] `src/renderer/features/messenger/ApprovalBlock.tsx` 수정: `useApprovalDecide` hook 의 invoke 직전 zustand store 의 row status 를 'pending'→'optimistic' 으로 변경 → 성공 시 server response 로 reconcile, 실패 시 rollback + ErrorBoundary toast
- [ ] `src/renderer/features/members/MemberProfileEditModal.tsx` (R8) 수정: 저장 클릭 시 row 즉시 갱신 + dialog 닫기 → 실패 시 dialog 재열림 + form state 복구
- [ ] `__tests__/ApprovalBlock.test.tsx` 확장: optimistic + rollback 5+
- [ ] `__tests__/MemberProfileEditModal.test.tsx` 확장: optimistic + rollback 5+
- [ ] 신규 i18n 키 `approval.decide.error.optimisticRollback` / `member.edit.error.optimisticRollback` (Task 11 — 또는 본 task 에서 추가)
- [ ] 커밋: `feat(rolestra): Optimistic UI 확장 — ApprovalBlock.decide + MemberProfile.edit (R11-Task15)`

**AC**:
- ApprovalBlock 결정 → 즉시 UI 반영 + 실패 시 rollback
- MemberProfile 편집 → dialog 닫고 row 즉시 갱신 + 실패 시 dialog 재열림
- ErrorBoundary toast 일관 동작
- 기존 R10 Optimistic UI 3 hook 회귀 0

**의존성**: Task 7 (Approval detail 후 ApprovalBlock 결정 흐름이 변경 가능성 — 통합 후 일관 패턴)
**R10 회귀 보호**: R10 의 3 hook 패턴 reuse — 새 hook 추가 안 함, 컴포넌트 내부 reducer 만 변경.
**Testing**: Vitest + React Testing Library + mock invoke (latency 0/100ms/throw).

---

### Task 16 — R11 Closeout (정식 게이트 + done-checklist + §10 ✓ + tasks 17/17)

**목표**: 모든 정식 게이트 녹색. done-checklist 작성. spec §10 R11 ✓ 전환. tasks 17/17.

- [ ] 정식 게이트:
  - `npm run typecheck` exit 0
  - `npm run typecheck:web` exit 0
  - `npm run lint` exit 0 (errors)
  - `npm run test` exit 0 (R11 신규 + R10 baseline 회복 + R3~R10 회귀 0)
  - `npm run i18n:check` exit 0 (idempotent)
  - `npm run theme:check` exit 0 (hardcoded color 0)
  - `npm run build` exit 0
  - `npm run package` (current OS) exit 0 + artifact 산출
  - migration 013 + 014 idempotent + down 가능
  - Playwright OS matrix workflow_dispatch — 9 spec × 3 OS = 27 cell green
- [ ] `docs/superpowers/specs/r11-done-checklist.md` 작성:
  - 17 task 산출물 맵
  - 게이트 결과표 (OS matrix + 패키징 artifact 포함)
  - Known Concerns (V4 / R12+ 인수인계 — release 후 잔재만)
  - Decision Log D1~D9 요약
  - V4 forward pointers (Hero strip / InsightStrip / Queue 6-column / Onboarding 미캡처 시안 / DM 풍부화 / 음성 메모 / ComfyUI 연동 / 코드 사인 / Remote Access v3 재설계 등)
- [ ] spec §10 R11 블록: `[ ]` → `[x]` 전환
- [ ] tasks.json 17/17 status='completed'
- [ ] 커밋: `chore(rolestra): R11 closeout — done-checklist + tasks 17/17 (R11-Task16)`

**AC**:
- 정식 게이트 전체 녹색 (특히 Playwright OS matrix 실 run + 패키징 artifact 검증)
- r11-done-checklist.md 작성
- §10 R11 모든 ✓
- tasks.json 17/17 completed

**의존성**: Task 1~15 모두 완료
**R10 회귀 보호**: closeout 자체가 회귀 검증 phase. R3~R10 영역 전부 green.
**Testing**: 전 게이트 스위트 + OS matrix + 패키징.

---

## scope 경계 (R11에서 하지 않는 것, V4/R12+ 이연)

### V4 (사용자 출시 후 차기 메이저)

- DM read-receipt / typing indicator 실 이벤트
- 파일 첨부 드래그앤드롭
- 음성 메모
- 플러그인 시스템
- ComfyUI / SD 연동 (메모리 `rolestra-idea-comfyui-sd.md` — R11 종료 후 재검토)
- 회의별 LLM 요약 provider drop-down (R10 D7 두 번째 항목)
- MessageSearchView 사이드 패널 레이아웃 (R10 D2)
- Onboarding 미캡처 step 3/4/5 페이지 풍부화 (시안 06 추가 캡처 대기)
- design polish 라운드 3+ 항목 — Hero strip 통합 (G5) / InsightStrip footer 변경 (G4) / Queue 6-column 테이블 (Q3)

### R12+ (출시 후 인프라/보안)

- macOS 코드 사인 + 공증 (notarize)
- Windows 코드 사인 (EV cert)
- AutoUpdate (electron-updater)
- Remote Access v3 재설계 (R10 Known Concern #8 의 remote-* 테스트가 skip 으로 처리)
- Memory Phase 3-b — 임베딩 + 하이브리드 검색 + 반성 + 진화 (Stanford 3-factor scoring)
- Sentry / 크래시 리포팅 (현재 로컬만)
- Localization 추가 (ja / zh-CN)

### 각하

- Settings vertical sidebar nav (R10 D3 — horizontal Radix Tabs 유지)
- DM 별도 dm_sessions 테이블 (R10 D1 — channels.kind='dm' 유지)

---

## Decision Log (D1~D9)

**D1 — `_legacy/` 일괄 삭제 vs v2 engine 분리 — 두 단계로 분리**
- 결정: Task 1 = `_legacy/` 단일 commit (752KB 완전 삭제). Task 2 = v2 engine 6 파일 + 7 `@ts-nocheck` 파일 — import grep 후 단계 삭제. 별도 commit.
- 이유: (i) `_legacy/` 는 src/ import 0 (R10 까지 검증) — 위험 0, (ii) v2 engine 은 src/main/engine 안에 있어서 기존 import 끊겼는지 grep 검증 필수, (iii) 두 단계로 분리하면 회귀 발생 시 bisect 가 쉽다.
- 대안: 한 commit 으로 묶기 — 각하 (회귀 추적 어려움).

**D2 — 패키징 — `electron-builder` 채택 (electron-forge 미채택)**
- 결정: `electron-builder` 단일 채택. Windows NSIS / macOS dmg / Linux AppImage 모두 한 도구로.
- 이유: (i) TS/React 친화 + 광범위 OS 지원, (ii) electron-forge 는 plugin 생태계 의존성 큼 + makers/publishers 명시 필요, (iii) AutoUpdate (R12+) 도 electron-updater 와 자연 연동, (iv) Rolestra 의 v2 (Python/FastAPI) 시절도 이미 일부 빌드 패턴이 builder 스타일.
- 대안: electron-forge — 각하 (단순 패키징에 무거움). Tauri / Neutralino — 각하 (Electron native 모듈 호환성).

**D3 — Onboarding step 영구화 — 신규 마이그레이션 013 (settings 합치기 안 함)**
- 결정: 신규 테이블 `onboarding_state` 단일 row. settings 테이블에 합치지 않음.
- 이유: (i) onboarding 은 진행 중 종료 시 step 복귀 필요 — 기록 단위가 settings 과 다름, (ii) 향후 onboarding 변경 (step 추가/제거) 시 마이그레이션 가능, (iii) 단일 row + CHECK (id=1) 로 schema 단순.
- 대안: settings json 컬럼 — 각하 (스키마 검증 어려움).

**D4 — LLM 비용 audit log — append-only 014 마이그레이션 (R11 두 번째 forward-only)**
- 결정: 신규 테이블 `llm_cost_audit_log` append-only. R10 의 `circuit_breaker_state` (D10) 와 같은 패턴.
- 이유: (i) audit 의 자연스러운 모델, (ii) summary 는 SUM query 로 충분, (iii) provider_id / meeting_id 인덱스로 group by 빠름.
- 대안: in-memory 만 — 각하 (재시작 시 손실 — 사용자 비용 가시화 불가).

**D5 — LLM 비용 추정 USD — 사용자 입력 단가 (자동 fetch 안 함)**
- 결정: AutonomyDefaultsTab 의 LLM 사용량 섹션은 토큰 정확 + USD = 사용자 입력 단가 × 토큰. R11 default 0 (사용자가 입력해야 USD 표시).
- 이유: (i) provider 별 가격 자주 변경 — fetch 시 stale, (ii) Anthropic / OpenAI / Google 가격 API 표준 부재, (iii) 사용자가 자기 계약 단가 입력이 정확.
- 대안: hardcoded 단가 — 각하 (stale risk).

**D6 — Onboarding stream broadcast — 미도입 (단일 윈도우 가정)**
- 결정: `stream:onboarding-state-changed` 미도입. Rolestra 는 단일 윈도우 (multi-window 향후 추가 시 재검토).
- 이유: (i) 단일 윈도우에서는 IPC sync 만으로 충분, (ii) zustand store 는 IPC 결과로 갱신, (iii) stream 추가는 over-engineering.
- 대안: stream 추가 — 각하 (사용 시점 없음).

**D7 — `pendingAdvisory` slot — in-memory only (DB 영속화 안 함)**
- 결정: ProjectService.pendingAdvisory 는 in-memory state. 다음 회의까지만 유효, 앱 재시작 시 초기화.
- 이유: (i) advisory 의 lifetime 은 짧음 (다음 회의 1번), (ii) 영속화하면 stale 위험, (iii) 사용자가 conditional 클릭 후 앱 재시작 시 재입력 자연.
- 대안: DB 영속화 — 각하 (over-engineering + stale risk).

**D8 — ADR 디렉토리 구조 — phase 별 묶음 (개별 ADR 파일 미채택)**
- 결정: `docs/아키텍처-결정-기록/` 안에 `R1-R3-decisions.md` 같은 phase 별 묶음 파일 6 개. 개별 ADR 파일 (`ADR-001-IPC-typedInvoke.md` 등) 미채택.
- 이유: (i) R1~R11 동안 80+ Decision 누적 — 개별 파일이면 80+ 파일, 탐색성 떨어짐, (ii) phase 별 묶음은 시기 컨텍스트 보존, (iii) cross-cutting (IPC / safeStorage / path-guard) 는 별도 `cross-cutting.md` 1 파일.
- 대안: 개별 ADR 파일 — 각하 (관리 비용 큼).

**D9 — Retro 영어 복귀 결정 (R10 Known Concern #5) — 한국어 유지 + locale 분기 옵션**
- 결정: main-process 잔여 한국어 trace 라인은 dictionary 로 이전하되, default ko = 기존 한국어 / en = 영어 번역 (locale 분기). 사용자가 LanguageTab 에서 en 선택 시 영어로 표시.
- 이유: (i) R9 D8 결정 ("trace 라인은 한국어 고정") 의 보수성을 유지하되, (ii) en locale 사용자 경험 개선, (iii) dictionary 패턴이 R10 에서 이미 land — 추가 노이즈 0.
- 대안: 영어로 전면 복귀 — 각하 (R9 D8 번복은 사용자 결정 필요). 한국어 고정 — 각하 (en locale 사용자 곤란).
- **사용자 sign-off 필요**: 본 결정이 R11 Task 11 의 default 가정. 사용자가 다른 결정 시 D9 재기록 + Task 11 재실행.

---

## Test Strategy

### 정식 게이트 (R11 Closeout — Task 16)

| 게이트 | 명령 | 기대 결과 |
|--------|------|----------|
| typecheck (node + web) | `npm run typecheck && npm run typecheck:web` | exit 0 (R10 baseline 유지 + R11 신규 통과) |
| lint | `npm run lint` | 0 errors |
| test (Vitest) | `npm run test` | exit 0 회복 (R10 baseline 14 fail → 0) + R11 신규 80+ tests green |
| i18n:check | `npm run i18n:check` (`npx i18next-parser` 2회) | idempotent, ko/en parity orphan 0 |
| theme:check | `npm run theme:check` | exit 0 (hardcoded color 0 — R11 신규 surface 포함) |
| build | `npm run build` | exit 0 |
| package | `npm run package` (current OS) | exit 0 + artifact 산출 |
| migration | `npx vitest run src/main/database/__tests__/migrations.test.ts` | 013 + 014 up + idempotent + down green |
| Playwright OS matrix | workflow_dispatch run | 9 spec × 3 OS = 27 cell green |
| Release workflow | workflow_dispatch dry-run (`v0.0.0-dryrun` tag) | 3 OS artifact 산출 |

### CI matrix 안정화 (Task 4 + Task 14)

- R10 OS matrix workflow file 만 등록 → R11 에서 실 run + 27 cell green 확인
- macOS PR trigger 분리 (label 기반) — minutes 비용 cap
- weekly cron 으로 풀 매트릭스 검증

### 단위 테스트 분포 (예측)

- shared: ipc-schemas (+16), provider-types capability
- main: onboarding-service (8), llm-cost-repository (8), execution-service dryRunPreview (6), approval-system-message-injector (4 확장), project-service pendingAdvisory (4), meeting-orchestrator advisory 소비 (4), meeting-summary-service capability (5 확장), registry capability snapshot (6)
- renderer: OnboardingPage (6), Step3 (6), Step4 (5), Step5 (5), use-onboarding-state (5), ApprovalDetailPanel (8), ApvImpactedFilesCard (4), ApvDiffPreviewCard (4), ApvConsensusContextCard (4), ApvActionBar (4), use-approval-detail (6), use-llm-cost-summary (5), AutonomyDefaultsTab LLM section (4 확장), AboutTab onboarding CTA (3 확장), App.tsx first-boot (3), ApprovalBlock optimistic (5 확장), MemberProfileEditModal optimistic (5 확장)

총 R11 신규/확장 약 130 cases + R10 baseline 14 fail 회복 (재작성 시 +N) + 회귀 0.

---

## i18n 체크리스트

- [ ] R11 신규 namespace populate (ko + en):
  - `onboarding.step3.{title, role, personality, expertise, displayName, save, ...}` (10+)
  - `onboarding.step4.{title, modeAuto, modeHybrid, modeApproval, dangerousAutoOptIn, ...}` (8+)
  - `onboarding.step5.{title, projectName, projectKind, slug, finalize, ...}` (8+)
  - `approval.detail.{header, impactedFiles, diffPreview, consensusContext, action, ...}` (15+)
  - `llm.cost.{title, byProvider, totalTokens, estimatedUsd, periodLabel, ...}` (8+)
  - `approvalNotificationBridge.*` / `autonomyGate.trace.*` (D9 — 한국어 유지 + en 번역)
- [ ] `i18next-parser.config.js` keepRemoved regex 확장
- [ ] `npm run i18n:check` idempotent

---

## Risks / Open Questions

### Risks

1. **v2 engine 6 파일 삭제 회귀** — Task 2 가 grep 후 import dead 만 즉시 삭제, 살아 있으면 v3 마이그레이션. 누락된 import 검증 시 typecheck fail. 단계 분리 (D1) + 각 파일 별 commit 으로 bisect 용이.
2. **신규 마이그레이션 013/014 회귀** — R10 의 012 까지 forward-only chain 위에 2 건 추가. idempotent 보장 + migration 통합 테스트 + down rollback 가능성 검증 필수.
3. **OS matrix 27 cell 실 run 비용** — macOS hosted runner 가 minutes 비쌈. Task 14 의 분리 trigger 로 PR/weekly 분리.
4. **Onboarding 첫 부팅 자동 진입의 race** — App.tsx 의 view 결정과 main-process startup payload 의 sync. 부팅 직후 IPC ready 시점까지 splash 또는 loading 상태 필요.
5. **Approval dryRunPreview 의 ExecutionService 결합** — preview 가 atomic apply 안 함 보장 — read-only path 분리 + 단위 테스트로 mutation 0 검증.
6. **macOS dmg unsigned Gatekeeper** — 첫 실행 시 사용자 prompt — Task 12 docs 에 안내 + R12+ signing 명시.
7. **Optimistic UI 확장의 race** — ApprovalBlock decide 후 stream notification 과 server response 의 도착 순서 — Task 15 의 reducer ordering invariant 보장.

### Open Questions

1. **R11 사용자 출시 시점의 brand identity** — Rolestra 로고 / 아이콘 / 색상 — design polish 결과물 reuse 가능 여부. Task 12 의 assets/ 디렉토리에 placeholder 사용. R11 종료 전 brand sign-off 필요.
2. **Linux AppImage 의 better-sqlite3 native binding** — AppImage 가 다양한 glibc 버전 cover 가능한지 검증. Task 12 의 로컬 build 검증.
3. **provider:detect IPC 의 호출 빈도** — Onboarding step 1 진입 시 1회만? Settings.CliTab 진입 시도 호출? 매 부팅마다? — D6 의 단일 윈도우 가정 위에서 Onboarding 진입 시 + Settings.CliTab refresh 버튼 시 호출이 default.
4. **R11 closeout 후 main merge 직후 v0.1.0 tag push** — 사용자 첫 사용자 출시. tag push 후 release.yml 자동 build → GitHub Release artifact 자동. README 다운로드 링크 갱신은 V4 진입 시 자연.

---

## Session Breakdown

R11 은 17 task. R10 이 15 task 4~5 sessions 였으니 R11 은 5~6 sessions.

### Session 1 — 진입 + 레거시 청소 + 테스트 회복 (Task 0~3)

- Task 0: brand + spec + plan + tasks.json + Decision Log
- Task 1: `_legacy/` 일괄 삭제
- Task 2: v2 engine 6 파일 + 7 `@ts-nocheck` 청소
- Task 3: pre-existing 14 test file 정리

### Session 2 — E2E 안정화 + shared types (Task 4~5)

- Task 4: Playwright OS matrix 안정화 + search/dm spec + autonomy Step C 활성 + 12 스크린샷
- Task 5: Shared types + 8 IPC + capability 확장

### Session 3 — Onboarding + Approval Detail (Task 6~7)

- Task 6: Onboarding 정식 wizard step 3/4/5
- Task 7: Approval 상세 패널 + dryRunPreview IPC + filter wiring

### Session 4 — LLM 비용 + capability + advisory + i18n (Task 8~11)

- Task 8: LLM 비용 가시화 + 014 migration
- Task 9: `'summarize'` capability 정식 도입
- Task 10: mode_transition advisory 자동 주입
- Task 11: i18n parity + main-process 라벨 (D9 결정 적용)

### Session 5 — 패키징 + 문서 + CI 비용 + Optimistic 확장 (Task 12~15)

- Task 12: electron-builder + Windows / macOS / Linux + release workflow
- Task 13: 사용자 문서 v3 재작성 + ADR 통합 + 디자인 폴더
- Task 14: macOS hosted runner 비용 monitoring
- Task 15: Optimistic UI 확장 (ApprovalBlock + MemberProfile)

### Session 6 — Closeout (Task 16)

- 정식 게이트 전체 녹색 (typecheck/lint/test/i18n/theme/build/package + OS matrix + release workflow dry-run)
- r11-done-checklist.md 작성
- spec §10 R11 ✓ 전환
- tasks.json 17/17 completed
- v0.1.0 tag push 검토 + release artifact 검증

---

## Known Concerns (R11 진행 중 발생 시 본 plan + done-checklist 갱신)

- (R11 진행 중 발생하면 각 Task 내 주석 + 마지막 Task 16 closeout 시점에 done-checklist 에 정리)
- 초기 예상 (V4 / R12+ 으로 이연):
  - macOS / Windows 코드 사인 + 공증 (R12+)
  - AutoUpdate (electron-updater) — R12+
  - Remote Access v3 재설계 — R12+
  - Memory Phase 3-b (임베딩 + 하이브리드) — R12+
  - design polish 라운드 3+ (Hero strip / InsightStrip / Queue 6-column / Onboarding 미캡처 시안) — V4
  - DM 풍부화 (read receipt / typing) — V4
  - 음성 메모 / 플러그인 / ComfyUI — V4

---

(이 plan 은 R11 세션 중 구현 진행에 따라 각 Task 의 `[ ]` 를 `[x]` 로 갱신하며 진화한다. Task 16 의 done-checklist 에 최종 산출물 + Known Concerns + V4 forward pointers 를 정리한다.)
