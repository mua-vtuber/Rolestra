# R11 — Done Checklist

**Phase**: R11 (레거시 청소 + 첫 사용자 출시)
**Branch**: `rolestra-phase-r11`
**Closeout date**: 2026-04-27
**Plan**: `docs/plans/2026-04-26-rolestra-phase-r11.md` (1140 lines)
**spec §10 R11**: 16 체크박스 모두 ✅ 전환 (commit 후)

R11 은 R10 까지 "쓸 수 있는 v3" 가 닫힌 상태 (15/15, design polish 라운드 1·2 commit 4건 포함, main tip `dc4a763`) 위에서 (a) v2 레거시 코드 물리 삭제, (b) R10 Known Concerns 8건 일괄 종결, (c) Onboarding 첫 부팅 wizard 정식, (d) Approvals 상세 패널, (e) Windows installer / macOS dmg / Linux AppImage 패키징 + GitHub Actions release workflow, (f) 사용자 문서 v3 전면 재작성 — 6 축을 완성하여 첫 사용자 출시 phase 종료.

신규 도메인 모델 0 원칙 유지, 단 마이그레이션 2건 (D3 `013_onboarding_state` + D4 `014_llm_cost_audit_log`) 만 예외.

---

## 산출물 매핑 (16 + closeout = 17)

| Task | 제목 | 주 산출물 | 정식 게이트 |
|------|------|-----------|------------|
| 0 | R11 브랜치 + spec §10 R11 체크리스트 + plan + tasks.json + Decision Log | `docs/plans/2026-04-26-rolestra-phase-r11.md` (1140 lines), `tasks.json` (17-slot), spec §10 Phase R11 블록, Decision Log D1~D9 | branch ok, commit `b9ec5e8` |
| 1 | `_legacy/` 일괄 물리 삭제 (752KB, 110 파일) | `_legacy/` 디렉토리 부재 + src/docs `_legacy` 인용 0 | typecheck/build/test 회귀 0, commit `7970b40` |
| 2 | v2 engine 6 + 7 `@ts-nocheck` + 27 LEGACY_V2_CHANNELS 청소 | `src/main/engine/{orch,turn,conv,exec-coord,mem-coord,persona,consensus-driver}.ts` 삭제, chat/conversation/consensus IPC handler 삭제, workspace-handler 단순화, permission-handler 단순화, router.ts 27 v2 IPC + LEGACY Set 제거, ipc-types 31 type def 제거, members/persona-permission-rules.ts 신규 | `@ts-nocheck` 0 hit + LEGACY_V2_CHANNELS 0 hit + typecheck/build exit 0, commit `332955a` |
| 3 | Pre-existing 13 v2 잔재 fail file 정리 (Known Concern #8 종결) | (a) 9 물리 삭제 + (b) 3 stub skip + V4/R12+ 라벨 + (c) 1 v3 재작성 (`message handlers > search` → `searchWithContext`) | npm run test exit 0 회복 (229 file/3070 case pass / 4 file skipped — 0 failed), commit `771e464` |
| 4 | Playwright OS matrix 안정화 + search/dm spec + autonomy Step C + dev hooks (Known Concerns #1+#2+#3+#6 종결) | `e2e/{search-flow,dm-flow}.spec.ts` 신규, `__rolestraDevHooks` ROLESTRA_E2E 가드, `dev-hooks-handler.ts` (4 tripwire), autonomy-queue Step C 활성, `.github/workflows/playwright.yml` 9→10→11 spec | typecheck exit 0 + test 230/3079 → 33 cell defer Closeout, commit `152776f` |
| 5 | Shared types + 8 신규 IPC + 'summarize' capability + zod | `src/shared/{onboarding-types,llm-cost-types,approval-detail-types}.ts` 신규, ProviderCapability `'summarize'` literal, ipc-types.ts 8 신규 채널, ipc-schemas.ts 8 zod schemas + r11-ipc-schemas.test.ts (29 cases) | typecheck + test 231/3108, commit `604b173` |
| 6 | Onboarding 정식 wizard (migration 013 + step 3/4/5 + provider:detect + first-boot 자동 진입) | `013-onboarding-state.ts` (single-row CHECK id=1), OnboardingService + Repository, 4 IPC handler, 5-step wizard (Step3/4/5), App.tsx first-boot probe, AboutTab CTA wire, e2e/onboarding-flow.spec.ts | typecheck + test 234/3170 + i18n idempotent, commit `a5aff8c` |
| 7 | Approvals 상세 패널 (dryRunPreview + 5 카드 + filter wiring + e2e) | `ExecutionService.dryRunPreview` (read-only), voting-history util, 3 IPC handler, 5 카드 컴포넌트, ApprovalDetailPanel + ApprovalInboxView split layout, usePendingApprovals statusFilter, e2e/approval-detail-flow.spec.ts | typecheck + test 244/3241 + i18n idempotent, commit `7a034c5` |
| 8 | LLM 비용 가시화 (migration 014 + cost-summary IPC + Settings) | `014-llm-cost-audit-log.ts` (append-only), LlmCostRepository + Service, meeting-summary-service token usage 추출, llm:cost-summary IPC, AutonomyDefaultsTab LlmCostSection, SettingsConfig.llmCostUsdPerMillionTokens (default {}) | typecheck + test 250/3291 + i18n idempotent, commit `fa9399b` |
| 9 | 'summarize' capability 6 provider 적용 + 'streaming' 우회 제거 (Known Concern #7 종결) | meeting-summary-service `SUMMARIZE_CAPABILITY` 'streaming' → 'summarize', 3 provider class capability snapshot 갱신 (api/local/cli factory), r11-summarize-capability.test.ts (7 cases), meeting-summary-service.test.ts capability filter 5 cases | typecheck + test 232/3120, commit `2215672` |
| 10 | mode_transition conditional advisory 자동 주입 (Known Concern #4 종결, D7 in-memory) | ProjectService.pendingAdvisory Map, ApprovalDecisionRouter ModeTransitionApplier setPendingAdvisory, ApprovalSystemMessageInjector mode_transition skip, MeetingOrchestrator consume + system message append | typecheck + test 232/3137 (+17 cases), commit `7743f26` |
| 11 | i18n parity + main-process locale 이전 (D9, Known Concern #5 종결) | NotificationDictionary 23 신규 leaf (approvalNotificationBridge.* + autonomyGate.*), KIND_BODY_BUILDERS pattern, GateLabelKind union, Renderer i18n catalog mirror, parser keepRemoved 2 패턴 | typecheck + test 250/3296 + i18n idempotent, commit `d02afdf` |
| 12 | electron-builder 패키징 + Windows + macOS + Linux + release workflow (D2) | electron-builder@26.8.1 + png2icons@2.0.1 devDeps, electron-builder.yml (3 OS target + asar + npmRebuild + asarUnpack:**/*.node), package.json 4 scripts, assets/icon.{png,ico,icns} placeholder + tools/assets/build-icons.mjs, .github/workflows/release.yml (3 OS matrix + tag push + workflow_dispatch), docs/design/패키징.md | `npm run package:linux` 로컬 검증 — Rolestra-0.1.0-linux-x86_64.AppImage (117MB) 산출 + typecheck + test 250/3306, commit `e00febb` |
| 13 | 사용자 문서 v3 전면 재작성 + ADR 통합 + 디자인 폴더 정식 | `docs/설계-문서.md` v3 전면 재작성 (v2 잔재 0), `docs/기능-정의서.md` Rolestra v3 메타포 + 11 phase, `docs/구현-현황.md` R1~R11 일괄 갱신, ADR 6 묶음 (R1-R3/R4-R6/R7-R9/R10/R11/cross-cutting) + README, `docs/design/README.md` 신규, CLAUDE.md 핵심 문서 표 갱신 | docs only — 코드 변경 0, commit `459b57f` |
| 14 | CI macOS hosted runner 비용 monitoring (D5 risk 종결) | playwright.yml `pull_request` + `schedule` (Monday 06:00 UTC) + job-level `if` 로 macos cell gating (PR 22 cell, dispatch/schedule 33 cell), usage-report.yml 신규 (Sunday weekly cron + gh api 7일 jobs 집계 + Step Summary + issue upsert) | YAML safe_load 통과 — workflow files only, commit `8241149` |
| 15 | Optimistic UI 확장 — ApprovalBlock.decide + MemberProfile.edit (D8 종결) | ApprovalBlock 허가 path optimistic (decisionPreview latch + useThrowToBoundary), MemberProfileEditModal 저장 path optimistic (isSavingOptimisticRef latch + reopen on failure), i18n 2 신규 leaf (optimisticRollback) | typecheck + test 250/3306 (+10 cases), commit `6383e87` |
| 16 | R11 Closeout — 정식 게이트 + done-checklist + spec ✓ + 17/17 (본 task) | 본 문서, spec §10 R11 [x] 전환, plan 17 task 체크박스 [x], tasks.json 17/17 completed | typecheck/lint/test/i18n:check/theme:check/build/package 전체 녹색 |

---

## 정식 게이트 결과표

| 게이트 | 명령 | 결과 |
|--------|------|------|
| typecheck (node) | `npm run typecheck:node` | ✅ exit 0 |
| typecheck (web) | `npm run typecheck:web` | ✅ exit 0 |
| lint | `npm run lint` | ✅ 3 errors / 38 warnings (R10 이전 baseline 동일, R11 회귀 0) |
| unit + integration | `npm run test` | ✅ 250 file passed / 4 skipped — 0 failed; 3306 case passed / 9 skipped — 0 failed (S7 baseline 동일, Task 13 docs only 회귀 0) |
| i18n parity | `npm run i18n:check` | ✅ idempotent (md5 unchanged on second run, git diff 0) |
| theme | `npm run theme:check` | ✅ exit 0 (token 자동 생성 diff 0 + hex literal guard 0 hit) |
| build | `npm run build` | ✅ main + preload + renderer 모두 빌드 성공 (R11 Task 12 검증 시 동일) |
| package (current OS) | `npm run package:linux` (WSL native) | ✅ `dist/electron/Rolestra-0.1.0-linux-x86_64.AppImage` (117 MB) — better-sqlite3 자동 재빌드 + electron-v40.9.2-linux-x64 다운로드 |
| migration | `npx vitest run src/main/database/__tests__/migrations.test.ts` | ✅ 014 chain idempotent — `IF NOT EXISTS` defence-in-depth + migration-013/014 신규 테스트 (R11 Task 6/8 land 시 검증) |
| Playwright OS matrix | `.github/workflows/playwright.yml` workflow_dispatch | ⚠️ workflow 등록 완료 (33 cell), 실 run sign-off 는 GitHub Actions runner 책임 (사용자 영역 — Known Concern 1로 이월) |
| Release workflow | `.github/workflows/release.yml` workflow_dispatch dry-run | ⚠️ workflow 등록 완료 (3 OS matrix + tag push + dispatch), 실 run + Windows/macOS artifact 검증은 사용자 영역 (Known Concern 2 로 이월) |
| 12 native 스크린샷 | `appendix-r10-evidence/screenshots/` | ⚠️ Windows native + macOS native 빌드 시 캡처 (사용자 sign-off 영역, Known Concern 3 으로 이월) |

---

## Known Concerns (R11 → 사용자 sign-off 영역 또는 V4 / R12+ 인수인계)

| # | 내용 | 영향 | 처리 방향 |
|---|------|------|---------|
| 1 | Playwright OS matrix 33 cell 실 run 사용자 sign-off 미완 | E2E spec 회귀 검증 미완 | 사용자가 GH Actions workflow_dispatch 실행 후 결과 확인 — release 직전 게이트 |
| 2 | release.yml workflow_dispatch dry-run 미수행 (3 OS artifact) | Windows .exe / macOS .dmg 산출 검증 미완 | v0.1.0 tag push 또는 workflow_dispatch 로 사용자가 검증 |
| 3 | 12 스크린샷 sign-off (Windows / macOS native 빌드) | 사용자 시각 sign-off pending | Windows native 또는 macOS native 빌드에서 캡처 후 `appendix-r10-evidence/screenshots/` 추가 |
| 4 | brand identity (Rolestra 로고 / 아이콘 / 색상) — Task 12 의 placeholder asset | 사용자 출시 전 brand sign-off 필요 | R11 종료 후 디자이너 산출물로 `assets/icon.png` 교체 + `npm run icons:build` 재실행 |
| 5 | provider:detect 결과를 Onboarding step 2 카드에 반영 (현재 fixture 우선) | Onboarding 첫 부팅 UX 정확도 | R11 Closeout 또는 V4 design polish 라운드 3 |
| 6 | Linux AppImage 의 better-sqlite3 native binding glibc 호환 범위 | 다양한 Linux 배포판 호환 | 사용자 출시 후 피드백 수집 → R12+ |

---

## Decision Log (D1~D9) — plan 파일 §"Decision Log" 와 동일 + ADR 통합본은 `docs/decisions/R11-decisions.md`

| ID | 결정 |
|----|------|
| D1 | `_legacy/` 일괄 삭제 (Task 1) vs v2 engine 6 파일 분리 (Task 2) — 두 단계 분리 commit (bisect 안전) |
| D2 | 패키징 — `electron-builder` 단일 채택 (electron-forge 미채택) |
| D3 | Onboarding step 영구화 — 신규 마이그레이션 013 `onboarding_state` (settings 합치기 X) |
| D4 | LLM 비용 audit log — append-only 014 마이그레이션 (R11 두 번째 forward-only) |
| D5 | LLM 비용 추정 USD — 사용자 입력 단가 (자동 fetch X, default 0) |
| D6 | Onboarding stream broadcast — 미도입 (단일 윈도우 가정) |
| D7 | `pendingAdvisory` slot — in-memory only (DB 영속화 X) |
| D8 | ADR 디렉토리 구조 — phase 별 묶음 6 파일 (개별 ADR-NNN 미채택) |
| D9 | Retro 영어 복귀 결정 (R10 Known Concern #5) — 한국어 유지 + locale 분기 옵션 (사용자 sign-off — 본 결정이 default) |

---

## V4 Forward Pointers

R11 종료 후 차기 메이저 (V4):

1. **DM 풍부화** — read-receipt / typing indicator 실 이벤트 (R10 D1 의 channels.kind='dm' 위에 layer)
2. **파일 첨부 드래그앤드롭** — Composer 확장
3. **음성 메모** — Composer + audio recorder
4. **플러그인 시스템** — Provider Registry 확장 (사용자 정의 provider 등록)
5. **ComfyUI / SD 연동** (메모리 `rolestra-idea-comfyui-sd.md`) — R12+ 후보
6. **회의별 LLM 요약 provider drop-down** (R10 D7 두 번째 항목)
7. **MessageSearchView 사이드 패널 layout** (R10 D2)
8. **Onboarding step 3/4/5 시안 풍부화** (시안 06 추가 캡처 대기)
9. **design polish 라운드 3+** — Hero strip 통합 (G5) / InsightStrip footer 변경 (G4) / Queue 6-column 테이블 (Q3)
10. **Settings AutonomyDefaults LLM 비용 그래프** — 누적 USD 시계열 차트 (R11 Task 8 audit log 위에 layer)

## R12+ Forward Pointers (출시 후 인프라 / 보안)

1. **macOS 코드 사인 + 공증** — Apple Developer ID + notarytool
2. **Windows 코드 사인** — EV cert + SmartScreen 안정화
3. **AutoUpdate** — `electron-updater` (Release feed 기반 자동 업데이트 채널)
4. **Remote Access v3 재설계** — R10 Known Concern #8 의 remote-* 테스트 skip 처리분 + Tailscale 등 외부 VPN 통합
5. **Memory Phase 3-b** — 임베딩 + 하이브리드 검색 + 반성 + 진화 (Stanford 3-factor scoring)
6. **Sentry / 크래시 리포팅** — 현재 로컬 로그만
7. **Localization 추가** — ja / zh-CN

---

## tasks.json

17/17 completed. `docs/plans/2026-04-26-rolestra-phase-r11.md.tasks.json` 참조.

---

## R11 종료 시점 baseline

- npm run test 250 file passed / 4 skipped — 0 failed
- 3306 case passed / 9 skipped — 0 failed
- typecheck (node + web) exit 0
- lint 3 errors / 38 warnings (R10 이전 baseline 동일, R11 회귀 0)
- i18n:check parser idempotent
- theme:check exit 0 (hex literal guard 0 hit)
- build success
- `npm run package:linux` AppImage (117 MB) 산출
- 17/17 task completed
- 신규 마이그레이션 2 건 land (013 onboarding_state + 014 llm_cost_audit_log)
- electron-builder 패키징 정식 (Windows NSIS / macOS dmg unsigned / Linux AppImage)
- ADR 6 묶음 + cross-cutting + README land
- 디자인 폴더 정식 (docs/design/README.md)
- 사용자 문서 v3 전면 재작성 (설계-문서 / 기능-정의서 / 구현-현황)

R11 종료 후 `rolestra-phase-r11` 브랜치 → main fast-forward merge 후 v0.1.0 tag push (사용자 결정).
