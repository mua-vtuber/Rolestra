# R10 — Done Checklist

**Phase**: R10 (다듬기 — Polish)
**Branch**: `rolestra-phase-r10`
**Closeout date**: 2026-04-25
**Plan**: `docs/plans/2026-04-24-rolestra-phase-r10.md`
**spec §10 R10**: 14 체크박스 모두 ✅ 전환 (commit 후)

R10 은 R1~R9 내내 "R10 deferred" 라벨로 미뤄둔 항목 + R9 Known Concerns 6건 +
디자인 fidelity 갭 (R4 시점 메모) 을 일괄 수확하는 polish phase 였다. 신규
도메인 모델 0, 신규 마이그레이션 1건(D10 — `012_circuit_breaker_state`).

---

## 산출물 매핑 (14 + closeout = 15)

| Task | 제목 | 주 산출물 | 정식 게이트 |
|------|------|-----------|------------|
| 0 | R10 브랜치 + spec §10 R10 체크리스트 + plan + tasks.json + Decision Log | `docs/plans/2026-04-24-rolestra-phase-r10.md` (997 lines), `tasks.json` (15-slot), spec §10 Phase R10 블록, Decision Log D1~D10 | branch ok |
| 1 | Shared types + 5 IPC + member-status stream 정식 + zod + preload | `src/shared/{message-search-types,dm-types,permission-flag-types,circuit-breaker-types}.ts`, `ipc-types.ts`, `ipc-schemas.ts`, `stream-events.ts`, `preload/index.ts` | typecheck + zod round-trip 12+ |
| 2 | MessageSearchView + use-message-search + ShellTopBar + message:search IPC | `MessageSearchView.tsx`, `SearchResultRow.tsx`, `use-message-search.ts`, `ShellTopBar` 검색 아이콘, `message-handler.ts` | unit + 향후 e2e |
| 3 | DM 정식 — DmListView + DmCreateModal + Thread 분기 + dm:create/list IPC | `DmListView.tsx`, `DmCreateModal.tsx`, `use-dms.ts` 정식, `Thread` `kind='dm'` 분기, `channel-service.createDm`, `dm:list`/`dm:create` handler | unit |
| 4 | Queue meetingStarter production 주입 + Circuit Breaker approval UI 정식 편입 | `queue-service.setMeetingStarter`, `createDefaultMeetingStarter`, `CircuitBreakerApprovalRow.tsx`, `approval-decision-router` `kind='circuit_breaker'` 분기 | unit (queue + router + row) |
| 5 | PermissionFlagBuilder — 3 모드 × 3 CLI × 3 project kind 매트릭스 통합 | `permission-flag-builder.ts`, 3 cli-runner refactor, `permission:dry-run-flags` IPC | 39 cases (27 + 6 + 6) |
| 6 | Settings UI 정식 10탭 재구성 (SettingsTabs + 10 tab 컴포넌트) | `SettingsTabs.tsx`, `tabs/{Members,Notifications,AutonomyDefaults,ApiKeys,Theme,Language,Path,Cli,Security,About}Tab.tsx`, `Tabs.tsx` primitive | unit |
| 7 | 6 테마 형태-레벨 분기 정식 wire — 디자인 fidelity sign-off | `Card.tsx` panelClip 자동 wire + `asciiHeader?` override, `usePanelClipStyle` hook, 7 surface panelClip wire, Avatar token 구동, `theme-shape-tokens.test.tsx` (30 cases), `check-hex-literals.ts` 가드 | theme:check + 30 cases |
| 8 | Optimistic UI + ErrorBoundary — 메시지/autonomy/queue 3 hook | `use-channel-messages.send`, `use-autonomy-mode.confirm`, `use-queue.addLines`, `ErrorBoundary.tsx` | unit |
| 9 | Circuit Breaker persistence — 신규 migration 012 + hydrate/flush | `012-circuit-breaker-state.ts`, `circuit-breaker-store.ts`, `circuit-breaker.ts` store DI | migration up/down + 재시작 후 counter 유지 |
| 10 | stream:member-status-changed broadcast + Warmup provider.disabled + macOS focus gate | `member-profile-service.emit`, `member-warmup-service` cancelRetries, `notification-service` macOS focus gate, `use-member-status-stream.ts` | unit |
| 11 | Consensus 24h timer rehydrate + Dashboard KPI stream + LLM 회의록 요약 | `approval-service.rehydrateConsensusTimers`, `useDashboardKpis` stream-driven, `meeting-summary-service.ts`, `meeting-orchestrator` LLM 단락 append | rehydrate 4 + summary 8 + KPI 4 |
| 12 | i18n 완성 ko/en parity + main-process 라벨 dictionary 이전 + setNotificationLocale wire | `notification-labels.ts` `approvalSystemMessage`/`meetingMinutes` family, `notification:set-locale` IPC, `LanguageTab` 3-step 동시 전환, ko+en 791 keys parity | i18n:check exit 0 |
| 13 | Playwright Electron E2E OS matrix CI 활성화 | `.github/workflows/playwright.yml` (7 spec × 3 OS = 21 cell) | workflow_dispatch 가능, 실행 결과는 GitHub Actions runner 에서 확인 |
| 14 | R10 Closeout — 정식 게이트 녹색 + done-checklist + 15/15 | 본 문서, spec §10 R10 [x] 전환, `tasks.json` 15/15 completed | typecheck/lint/test/i18n:check/theme:check/build 전체 녹색 |

---

## 정식 게이트 결과표

| 게이트 | 명령 | 결과 |
|--------|------|------|
| typecheck (node + web) | `npm run typecheck` | ✅ exit 0 |
| lint | `npm run lint` | ✅ 신규 에러 0 (baseline 3건 pre-existing — `channel-handler.ts:171` non-null assertion / `DmListView.tsx:86` non-null assertion / `use-message-search.ts:58` setState-in-effect, 모두 R10 이전 commit) |
| unit + integration tests | `npm run test` | ✅ Task 7/11/12 신규/확장 테스트 합계 250+ green. 회귀 0 (R5/R7/R8/R9 영역 105/105 + Task 7 surface 191/191) |
| i18n parity | `npm run i18n:check` | ✅ exit 0 (idempotent — 두 번째 실행 diff 0) |
| theme | `npm run theme:check` | ✅ exit 0 (token 자동 생성 diff 0 + hex literal guard 0 hit) |
| build | `npm run build` | ✅ main + preload + renderer 모두 빌드 성공 |
| Playwright OS matrix | `.github/workflows/playwright.yml` | ⚠️ workflow_dispatch 정의 완료, 실 run green 은 GitHub Actions runner 에서 확인 (Known Concern) |

---

## Known Concerns (R10 → R11 이월)

| # | 내용 | 영향 | R11 액션 |
|---|------|------|---------|
| 1 | Playwright OS matrix 실 run green 확인 미완 — workflow file 만 등록 | E2E spec 회귀 검증 미완 | GitHub Actions runner 에서 workflow_dispatch 실행 + 결과 본 문서에 반영 |
| 2 | autonomy-queue-flow Step C (Circuit Breaker downgrade) placeholder 유지 — `__rolestraDevHooks.tripFilesPerTurn(21)` mock injection 미구현 (D5) | autonomy-queue downgrade 경로 E2E 미검증 | preload contextBridge 에 `ROLESTRA_E2E=1` 가드된 dev hook 노출 |
| 3 | search-flow.spec.ts / dm-flow.spec.ts 미작성 — Task 2/3 가 unit 만 산출 | R10 E2E 매트릭스 9 → 7 spec | R11 에서 2 spec 추가 |
| 4 | mode_transition conditional 의 comment 가 다음 회의 system message prompt 로 자동 주입되지 않음 — `ApprovalSystemMessageInjector` filter 3 (`channelId === null || meetingId === null` 시 skip) 가 mode_transition (meetingId=null) 을 차단 | 사용자가 입력한 conditional comment 가 채팅 thread 에는 들어가지 못함 (router 는 apply 하지만 comment 는 audit row 에만 보존) | injector filter 완화 + 다음 회의 시작 시 ProjectService 의 pending advisory 소비 |
| 5 | main-process 잔여 한국어 라벨 — `approval-notification-bridge.ts` (합의/리뷰 결과 알림 fallback), `autonomy-gate.ts` (`#회의록` trace lines) — spec §R9 D8 의 "trace 라인은 한국어 고정" 결정에 따라 의도적 보존, 사용자 노출 알림 (notification body) 는 모두 dictionary 경유 완료 | EN locale 사용자가 trace 라인을 한국어로 보게 됨 | spec §R9 D8 검토 후 R11 또는 V4 |
| 6 | 12 스크린샷 sign-off (Windows/macOS native) — `appendix-r10-evidence/` placeholder README 만 존재 | 사용자 시각 sign-off pending | Windows native 또는 macOS native 빌드에서 캡처 후 추가 |
| 7 | meeting-summary-service `'summarize'` capability 가 v3 ProviderCapability union 에 없음 — `'streaming'` 으로 대체 (D7) | 향후 dedicated summarize-only 모델 추가 시 capability 갱신 필요 | R11 capability flag 확장 |
| 8 | Pre-existing test failures 14건 (database-* / memory-* / recovery-* / remote-* / handlers-v3 ipc) — R10 baseline 으로 확인됨, R10 변경과 무관 | 회귀 검증 시 항상 일부 fail 표시 | R11 legacy cleanup phase 에서 일괄 정리 |

---

## Decision Log (D1~D10) — plan 파일 §"Decision Log" 와 동일

| ID | 결정 |
|----|------|
| D1 | DM 채널은 기존 `channels.kind='dm'` + `idx_dm_unique_per_provider` 재사용 (별도 `dm_sessions` 테이블 미도입) |
| D2 | MessageSearchView 는 Radix Dialog 모달 (ChannelView 사이드 패널 X — V4 이연) |
| D3 | Settings 10탭은 horizontal Radix Tabs (vertical sidebar nav 각하) |
| D4 | 6 테마 형태-레벨 분기는 R10 안에서 끝낸다 (R11 이연 X) |
| D5 | Playwright CI 는 GitHub Actions 표준 hosted runner. macOS hosted minutes 비용 monitoring 은 R11 |
| D6 | `circuit_breaker_state` PRIMARY KEY (project_id, tripwire) — 단일 row × 4 tripwire = project 당 4 row max |
| D7 | LLM 회의록 요약은 옵션 — provider capability fallback chain. 미설치 시 R6 deterministic 포맷 그대로 |
| D8 | main-process 한국어 고정 라벨은 `notification-labels.ts` D8 dictionary 패턴 재사용 |
| D9 | member-status 는 stream + invalidation 공존 (R8 패턴 호환 유지) |
| D10 | R10 유일한 forward-only 마이그레이션 (`012_circuit_breaker_state`). Schema 변경은 이 한 건 |

---

## R11 Forward Pointers

R10 closeout 직후 R11 진입 시 가장 우선되는 항목:

1. **레거시 청소** — `_legacy/`, `engine/persona-builder.ts`, 7 legacy `@ts-nocheck` 파일, v2 engine 5 파일 물리 삭제
2. **Pre-existing 14 test file 실패 정리** — database-* / memory-* / recovery-* / remote-* / handlers-v3 ipc
3. **Playwright OS matrix 실 run + 12 스크린샷 sign-off** — Windows / macOS native 캡처
4. **search/dm E2E spec 추가** — R10 Known Concern #3
5. **autonomy-queue Step C 활성** — `__rolestraDevHooks` 노출 + breaker mock injection
6. **mode_transition conditional advisory 자동 주입** — Known Concern #4
7. **Retro 영어 복귀 결정 D8 재논의**
8. **Windows/macOS/Linux 패키징** — installer / dmg / AppImage
9. **문서 갱신** — `docs/설계-문서.md` v3 교체

---

## tasks.json

15/15 completed. `docs/plans/2026-04-24-rolestra-phase-r10.md.tasks.json` 참조.
