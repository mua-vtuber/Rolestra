# Rolestra Phase R10 — 다듬기(Polish) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Date:** 2026-04-24
**Prev plan:** `docs/plans/2026-04-23-rolestra-phase-r9.md` (R9 14/14 ✓ — main tip `81a55e6`)
**Spec:** `docs/specs/2026-04-18-rolestra-design.md` §10 Phase R10
**Closeout target:** `docs/checklists/r10-done-checklist.md` (Task 15)

**Goal:** R9 까지 자율 모드 + 시스템 알림이 닫힌 상태 위에서, **R1~R9 내내 "R10 deferred" 라벨로 미뤄둔 항목들과 R9 Known Concerns 6건을 일괄 수확**한다. R10 종료 시 (a) 메시지 검색 UI(`MessageSearchView` + `message:search` IPC + R5 시점 이미 구현된 `MessageRepository.searchInChannel/searchInProject`)가 사용자 노출, (b) 사용자+AI 1:1 DM 이 정식 기능 (`channels.kind='dm'` + `idx_dm_unique_per_provider` 위에 `DmListView` + `DmCreateModal` + `dm:create/list` IPC), (c) 설정 화면이 R9 의 임시 단일 view 에서 정식 10탭(`SettingsTabs` — 멤버 / 알림 / 자율 모드 기본값 / API 키 / 테마 / 언어 / 경로 / CLI / 보안 / 정보) 으로 재구성, (d) 6 테마 × 2 모드의 시각 sign-off 게이트(autonomy/queue/settings/DM 신규 surface 포함) 통과 + `themeKey` 형태-레벨 분기(R4 시점 디자인 fidelity 갭 메모 해소 — `panelClip` / `cardTitleStyle` / `miniBtnStyle` / `gaugeGlow` 등 R3 토큰을 신규 surface 에 실제 wire), (e) i18n ko/en 완성(잔여 하드코딩 0 + `setNotificationLocale` settings UI wiring + `i18next-parser` orphan-prune diff 0), (f) Playwright Electron E2E 시나리오 6개(R4 외부 프로젝트 / R5 메신저 / R6 회의 / R7 승인 / R8 멤버 프로필 / R9 autonomy-queue + 신규 R10 검색·DM)를 GitHub Actions OS matrix(Windows + macOS + Linux)에서 실 런 — R4~R9 내내 WSL DONE_WITH_CONCERNS 로 남겨둔 부채 일괄 해소, (g) R9 Known Concerns 6건(Queue `meetingStarter` production 주입 / Circuit Breaker persistence / `stream:member-status-changed` broadcast / Warmup backoff `provider.disabled` 체크 / `notification.show` macOS focus gate / Circuit Breaker approval UI 정식 편입) 모두 종결, (h) PermissionService 가 spec §7.6 의 3 모드 × 3 CLI 매트릭스 전체 커버리지로 확장 (현재는 path-guard 단일 함수 + cli-permission-bridge 만 — R10 에서 모드별 CLI 플래그 build 와 sandbox 매트릭스를 단일 `PermissionFlagBuilder` 로 통합), (i) optimistic UI(메시지 전송 / autonomy 토글 / queue 추가 — pending state 먼저 반영 후 IPC confirmation, error 시 rollback) 도입, (j) consensus_decision 24h 타이머 rehydrate(R7 D2 이월) + `notification.approvalPending.*` main→renderer i18n migration(R7 D 흐름 deferred) + LLM 회의록 요약 옵션(`ai-summarize-meeting` 구조화 출력 — `notification_log` 와 다른 채널, R6 의 원문 + 메타 헤더 위에 LLM 요약 1단락 추가, provider 미설치 fallback 은 기존 포맷 유지), (k) Dashboard KPI 의 approval count 실시간 stream wiring(R7 deferred — `usePendingApprovals` 훅 reuse 로 R4 KPI 패널의 mount-fetch+invalidate 를 stream-driven 으로 승격).

**Overview (자연어, 비코더용):**

- R10 은 "신규 기능 phase" 가 아니라 **R1~R9 누적 부채 + 디자인 sign-off + CI matrix 활성화** 가 핵심이다. 새 도메인 모델은 추가하지 않고, 기존 모듈 위에 (a) UI surface 보강, (b) production wire, (c) accept-criteria 강화를 얹는다. R9 가 "스위치를 켰다" 면 R10 은 "켠 스위치들을 정돈하고, R3~R9 내내 미뤄둔 검색·DM·설정 10탭·6테마·E2E·i18n·optimistic UI·LLM 요약 부채를 한 번에 정리한다."
- 가장 큰 두 부채는 **(i) 6 테마 시각 fidelity** 와 **(ii) Playwright OS matrix** 다. 전자는 R4 시점 사용자 피드백 메모(`rolestra-design-fidelity-gap.md` — "토큰 스왑만으로 '공통 형태 + 색만' 느낌, R5+ 는 themeKey 형태-레벨 분기 필수") 가 R5/R6/R7/R8/R9 내내 deferred 로 누적된 결과다. R10 Task 9 가 R3 시점 도입한 `panelClip` / `cardTitleStyle` / `miniBtnStyle` / `gaugeGlow` / `avatarShape` 등 형태 토큰들을 R4~R9 신규 surface(MessengerView / ApprovalInbox / MemberProfilePopover / AutonomyConfirmDialog / QueuePanel / NotificationPrefsView / SettingsTabs / 신규 MessageSearchView / DmListView)에 **실제 wire** 한다 — Tactical 의 12분절 게이지 / Retro 의 ASCII 게이지 / Warm 의 라운드 패널처럼 시각적으로 분명한 차이가 모든 surface 에 적용. 후자는 R4~R9 의 6개 E2E spec 이 모두 WSL 런타임 제약으로 DONE_WITH_CONCERNS 였던 것을 GitHub Actions `windows-latest` + `macos-latest` + `ubuntu-latest` matrix 에서 일괄 실 런으로 승격(spec §11). API 키 없는 환경은 mock provider fixture 로 cover.
- 세 번째 축은 **검색**. spec §5.2 migration 005 가 이미 `messages_fts` virtual table + 3 trigger 를 land 했고 R5 시점 `MessageRepository.searchInChannel/searchInProject` 도 구현이 끝나있다. R10 은 그 위에 (a) `message:search` IPC + zod, (b) `useMessageSearch` hook, (c) `MessageSearchView` (모달 또는 사이드 패널 — D2 결정), (d) ShellTopBar 검색 진입 UI, (e) 검색 결과 → 채널/메시지 deep-link 라우팅(R7 ApprovalsWidget → ApprovalInbox 라우팅 패턴 reuse) 를 얹는다. 신규 마이그레이션 0건.
- 네 번째 축은 **DM 정식 기능**. R2 시점 channels 테이블 + `idx_dm_unique_per_provider` partial unique index 가 land 됐지만 (channel.project_id IS NULL + kind='dm' + provider 1명만 channel_members 등록) R5/R6/R7/R8/R9 어디서도 사용자 노출이 없었다. R10 Task 6 이 (a) DM 전용 IPC `dm:list` / `dm:create({providerId})` (channels:list 과 분리), (b) NavRail 의 DM 섹션 정식 활성화(현재는 placeholder), (c) `DmCreateModal` (provider 단일 선택, 이미 DM 있는 provider 는 비활성), (d) `Thread` 컴포넌트가 `channel.kind === 'dm'` 일 때 시스템 채널 분기와 동일하게 메시지 입력 가능 (회의 시작 버튼은 비활성 — DM 은 회의 불가, spec §7.4 명시) 를 추가. AI 끼리 DM 은 구현하지 않음 (spec §7.4 제약 유지). 신규 마이그레이션 0건 — 이미 R2 에서 모든 컬럼이 준비됐다.
- 다섯 번째 축은 **설정 UI 10탭 재구성**. R9-Task4 시점 임시 단일 `SettingsView` 에 `NotificationPrefsView` 한 섹션만 mount 한 상태인데, R10 Task 7 이 spec §7.10.6 "Blocks: SettingsSection R4/R10" 표대로 정식 10탭으로 재편: (1) 멤버 관리(R8 `MemberProfileEditModal` 풀버전 - 일괄 편집/추가/삭제 — R8 D8 deferred), (2) 알림(R9 `NotificationPrefsView` 이전), (3) 자율 모드 기본값(프로젝트 생성 시 default autonomyMode + Circuit Breaker 4 tripwire 한계값 조정), (4) API 키(safeStorage CRUD), (5) 테마(themeKey + mode 선택 — `theme-switcher` 정식 노출), (6) 언어(`i18next.changeLanguage` + `setNotificationLocale` wiring D8 잔재), (7) 경로(ArenaRoot 변경 안내 + 재시작 필요 배너), (8) CLI(provider 추가/삭제 — R8 D 흐름 deferred), (9) 보안(path-guard 상태 + 위험한 자율 모드 opt-in switch — spec §7.6.5), (10) 정보(앱 버전 + 라이센스 + 디자인 sign-off 마크). 신규 zustand store 0 — 각 탭은 기존 hook 재사용 (`use-projects` / `use-members` / `use-notification-prefs` / `useTheme` / `i18n` / `use-arena-root`).
- 여섯 번째 축은 **R9 Known Concerns 6건 종결**. 단일 Task 로 묶지 않고 **각 concern 의 최적 위치에 분산**: (1) Queue `meetingStarter` production 주입 → Task 4 (DmSession 구현 직후 channel:start-meeting 헬퍼 reuse), (2) Circuit Breaker persistence → Task 11 (notification_log 와 같은 패턴, 신규 마이그레이션 012 `circuit_breaker_state` table — spec §10 "마이그레이션 추가는 R10 에서 1건 허용" 명시), (3) `stream:member-status-changed` 실시간 broadcast → Task 12 (R9 stream 패턴 그대로 재사용, MemberProfileService.emit('status-changed') → StreamBridge.connect({members}) → renderer reducer), (4) Warmup backoff `provider.disabled` 체크 → Task 13, (5) `notification.show` macOS focus gate → Task 13 (Electron 네이티브 `app.focus()` API 로 BrowserWindow.isFocused 보정), (6) Circuit Breaker approval UI 정식 편입 → Task 5 (ApprovalInbox 에 `kind='circuit_breaker'` 전용 row 디자인 + 상세 view — "어떤 tripwire 가 어떤 한계로 발동됐는가" + "재개" 버튼).
- 일곱 번째 축은 **PermissionService 확장**. 현재 `src/main/files/permission-service.ts` 와 `src/main/files/cli-permission-bridge.ts` 는 path-guard + CLI 권한 인터셉트만 담당하고, 3 모드 × 3 CLI 의 실제 플래그 build (Claude `--permission-mode acceptEdits` / Codex `--full-auto` / Gemini `--approval-mode auto_edit` 등 — spec §7.6.3) 는 각 provider 의 cli-runner 에 분산되어 있다. R10 Task 8 이 단일 `PermissionFlagBuilder` 모듈로 매트릭스 전체를 통합 — provider kind + permission mode + project kind (new/external/imported) 입력 → 정확한 CLI flag 배열 출력. external+auto 의 거부(spec §7.3 CA-1/CA-3) 는 builder 의 zod 입력 스키마에서 reject. spec §7.6.5 의 "위험한 자율 모드" opt-in 스위치는 builder 입력의 별도 boolean (default false) — settings tab 9(보안) 에서 토글.
- 여덟 번째 축은 **Optimistic UI**. R4~R9 의 mutation 흐름은 모두 "click → invoke → await → re-render" 순서로 100~300ms latency 가 노출된다. R10 Task 10 이 R5 의 `useChannelMessages` (메시지 전송), R9 의 `useAutonomyMode` (모드 전환), R9 의 `useQueue` (항목 추가) 세 hook 에 optimistic update 를 도입 — invoke 전에 zustand store 에 `pending: true` flag 와 함께 임시 row 를 추가 → invoke 성공 시 server-issued id 로 swap, 실패 시 rollback + ErrorBoundary toast. 새로 도입할 의존성은 없음 (zustand 기존 sync API).
- 아홉 번째 축은 **i18n 완성**. R3 시점 15개 namespace 가 정의됐지만 ko 만 채워져 있고 en 은 일부만 populate 된 상태다. R10 Task 14 가 (a) `i18next-parser` 가 추출하는 모든 키를 ko + en 양쪽에 동일 schema 로 populate (공백 0), (b) `setNotificationLocale` 을 settings tab 6(언어)에서 `i18next.changeLanguage` 와 동시 호출하도록 wire (현재는 main-process `DEFAULT_LOCALE='ko'` 고정), (c) main-process 의 R7/R8 deferred 였던 `notification.approvalPending.*` 등 잔여 한국어 고정 라벨을 모두 `notification-labels.ts` (D8) dictionary 로 이전, (d) parser orphan-prune diff 0 게이트.
- 열 번째 축은 **소형 deferred 항목 일괄 정리**: (i) consensus_decision 24h 타이머 rehydrate (R7 D2 이월) — 앱 재시작 시 `approval_items.status='pending'` + `kind='consensus_decision'` + `created_at + 24h > now` 조건의 row 를 boot 직후 timer 로 재예약, (ii) Dashboard KPI approval count 실시간 stream wiring (R7 deferred) — `useDashboardKpis` 가 `usePendingApprovals` 의 stream reducer 를 watch 하여 mount-fetch+invalidate → stream-driven 으로 승격, (iii) `mode_transition` conditional UX (R7 D3 deferred) — R7 에서 비활성 + 툴팁만이었던 conditional 버튼을 정식 활성화 (조건은 모드 메타에 자연어로 첨부, 다음 회의 시작 시 system message 로 주입), (iv) LLM 회의록 요약 옵션 (R6 의 원문 + 메타 헤더 위에 1 단락 LLM 요약 추가 — 각 provider 의 `summarize` capability 가 있을 때만 활성, 없으면 기존 포맷 유지).
- 열한 번째 축은 **신규 마이그레이션 1건의 정당성**. R10 은 신규 마이그레이션 0건이 원칙이지만 Circuit Breaker persistence 만 예외. **이유:** in-memory only 였던 R9 가 `cumulative_cli_ms` 외 3 tripwire 의 세션 간 연속성 문제를 Known Concern #2 로 남겼다. 패턴은 `notification_log` 와 동일 (단일 row append-only) — 신규 테이블 `circuit_breaker_state` 는 `(project_id, tripwire) → counter, last_reset_at` 의 4 행을 매 부팅마다 hydrate 후 in-memory `CircuitBreaker` 인스턴스에 주입. forward-only + idempotent 원칙 그대로.
- **SSM 은 건드리지 않는다**. spec §8 의 12 상태 / 가드 / 이벤트는 R10 범위 밖. R10 의 어떤 task 도 `session-state-machine.ts` 의 transition table 을 수정하지 않는다.
- **신규 도메인 0**. R10 의 모든 신규 surface (MessageSearchView / DmListView / SettingsTabs / Circuit Breaker approval UI / Member Status broadcast) 는 R2~R9 에 land 된 도메인 모델 위에서 UI + IPC + production wire 만 추가한다.
- **`spec §10 R10 체크박스` 확장과 Decision Log 는 Task 0 에서 먼저 한다**. 구현 중 모호함은 **반드시 spec 을 먼저 갱신** 한 뒤 코드를 고친다(R2~R9 규약).
- **R11 은 "레거시 청소 + 릴리스 패키징" 뿐이다**. R10 종료 후에는 v2 engine 5 파일 + `engine/persona-builder.ts` 물리 삭제 + 7 legacy `@ts-nocheck` 파일 청소 + retro 영어 복귀(R8 D8) + Windows 인스톨러 / macOS dmg 만 남는다. 즉 R10 이 "쓸 수 있는 v3" 의 마지막 phase 다.

**Architecture:**

- Layering: `renderer → shared → preload(contextBridge) → main`. R3~R9 구조 그대로.
- Main 재사용 (R2~R9 land 완료):
  - `src/main/channels/message-repository.ts` — `searchInChannel/searchInProject` 이미 구현 (R5)
  - `src/main/channels/channel-service.ts` — `kind='dm'` 분기 R2 land (R10 변경: dm:create/list IPC handler 추가)
  - `src/main/queue/circuit-breaker.ts` — R9 변경 0, R10 변경: persistence hydrate/flush API 추가
  - `src/main/queue/queue-service.ts` — R9 변경 land, R10 변경: meetingStarter production 주입 wiring
  - `src/main/notifications/notification-service.ts` — R9 변경 land, R10 변경: macOS focus gate + show focus refinement
  - `src/main/notifications/notification-labels.ts` — D8 dictionary, R10 변경: `setNotificationLocale` settings wiring + 잔여 라벨 이전
  - `src/main/members/member-profile-service.ts` — R10 변경: `emit('status-changed')` stub 을 stream broadcast 로 승격
  - `src/main/members/member-warmup-service.ts` — R10 변경: backoff 중 `provider.disabled` 체크
  - `src/main/files/permission-service.ts` — R10 변경 0, but `PermissionFlagBuilder` 가 외부에서 참조
  - `src/main/files/cli-permission-bridge.ts` — R10 변경 0
  - `src/main/approvals/approval-service.ts` — R10 변경: 24h timer rehydrate 부팅 hook
  - `src/main/dashboard/dashboard-service.ts` — R10 변경 0 (KPI hook 측만 수정)
- Main 신규 파일:
  - `src/main/permissions/permission-flag-builder.ts` — 3 모드 × 3 CLI × 3 project kind 매트릭스 (Task 8)
  - `src/main/permissions/__tests__/permission-flag-builder.test.ts`
  - `src/main/queue/circuit-breaker-store.ts` — persistence hydrate/flush (Task 11)
  - `src/main/queue/__tests__/circuit-breaker-store.test.ts`
  - `src/main/database/migrations/012-circuit-breaker-state.ts` — neue 테이블 (Task 11, 신규 마이그레이션 1건만 허용)
  - `src/main/llm/meeting-summary-service.ts` — provider summarize capability 활용 LLM 1단락 요약 (Task 13)
  - `src/main/llm/__tests__/meeting-summary-service.test.ts`
- Main 수정:
  - `src/main/index.ts` — R10 boot block: PermissionFlagBuilder wire / CircuitBreakerStore hydrate / queue meetingStarter production 주입 / consensus 24h timer rehydrate / streamBridge.connect({members})
  - `src/main/queue/queue-service.ts` — meetingStarter production hook (Task 4)
  - `src/main/queue/circuit-breaker.ts` — store DI + flush on tripwire counter change (Task 11)
  - `src/main/members/member-profile-service.ts` — emit broadcast 승격 (Task 12)
  - `src/main/members/member-warmup-service.ts` — provider.disabled 체크 (Task 13)
  - `src/main/notifications/notification-service.ts` — macOS focus gate (Task 13)
  - `src/main/notifications/notification-labels.ts` — 잔여 main-process 라벨 dictionary 이전 + setNotificationLocale settings hook (Task 14)
  - `src/main/approvals/approval-service.ts` — 24h timer rehydrate boot helper (Task 13)
  - `src/main/streams/stream-bridge.ts` — `stream:member-status-changed` broadcast 활성 (Task 12)
  - `src/main/ipc/handlers/channel-handler.ts` — dm:create / dm:list 추가 (Task 6)
  - `src/main/ipc/handlers/message-handler.ts` — message:search 추가 (Task 5)
  - `src/main/ipc/router.ts` — 신규 채널 등록
  - `src/main/dashboard/dashboard-service.ts` — KPI 실시간 stream subscription (Task 13 안에 포함, dashboard 재계산 트리거만)
- Shared:
  - `src/shared/message-search-types.ts` — NEW (Task 1) — `MessageSearchRequest` / `MessageSearchResult` / `MessageSearchHit` (matched message + channel + 작은 snippet)
  - `src/shared/dm-types.ts` — NEW (Task 1) — `DmCreateRequest` / `DmListResponse`
  - `src/shared/circuit-breaker-types.ts` 확장 — `CircuitBreakerStateRecord` (persistence schema)
  - `src/shared/permission-flag-types.ts` — NEW (Task 1) — `PermissionFlagInput` / `PermissionFlagOutput`
  - `src/shared/ipc-types.ts` — `message:search` / `dm:list` / `dm:create` / `permission:dry-run-flags` / `meeting:llm-summarize` 추가
  - `src/shared/ipc-schemas.ts` — zod
  - `src/shared/stream-events.ts` — `stream:member-status-changed` payload 확정 (R8 D8 / R9 #3 의 스텁 → 정식)
- Preload:
  - `src/preload/index.ts` — 신규 IPC + stream:member-status-changed 화이트리스트
- Renderer 신규:
  - `src/renderer/features/search/MessageSearchView.tsx` — 검색 모달 (Task 5)
  - `src/renderer/features/search/SearchResultRow.tsx` — 결과 row 시각화
  - `src/renderer/features/dms/DmListView.tsx` — NavRail 진입 (Task 6)
  - `src/renderer/features/dms/DmCreateModal.tsx` — 신규 DM 생성 (Task 6)
  - `src/renderer/features/settings/tabs/{MembersTab,NotificationsTab,AutonomyDefaultsTab,ApiKeysTab,ThemeTab,LanguageTab,PathTab,CliTab,SecurityTab,AboutTab}.tsx` (10 파일, Task 7)
  - `src/renderer/features/settings/SettingsTabs.tsx` — Radix Tabs orchestrator (Task 7)
  - `src/renderer/features/approvals/CircuitBreakerApprovalRow.tsx` — kind='circuit_breaker' 전용 row (Task 4 - approval UI 정식 편입)
  - `src/renderer/hooks/use-message-search.ts` (Task 5)
  - `src/renderer/hooks/use-dms.ts` 확장 — R5 placeholder hook 을 정식 dm:list/create 로 (Task 6)
  - `src/renderer/hooks/use-member-status-stream.ts` (Task 12)
- Renderer 수정:
  - `src/renderer/components/shell/ShellTopBar.tsx` — 검색 진입 버튼 (Task 5)
  - `src/renderer/components/shell/NavRail.tsx` — DM 섹션 정식 활성화 + Settings tab 라우팅 (Task 6, 7)
  - `src/renderer/features/messenger/Thread.tsx` — DM 채널 분기 (Task 6)
  - `src/renderer/features/approvals/ApprovalInboxView.tsx` — Circuit Breaker row 분기 (Task 4)
  - `src/renderer/features/dashboard/widgets/ApprovalsWidget.tsx` — stream-driven KPI (Task 13)
  - `src/renderer/hooks/use-channel-messages.ts` — optimistic add (Task 10)
  - `src/renderer/hooks/use-autonomy-mode.ts` — optimistic mode swap (Task 10)
  - `src/renderer/hooks/use-queue.ts` — optimistic add (Task 10)
  - `src/renderer/hooks/use-dashboard-kpis.ts` — stream subscription (Task 13)
  - `src/renderer/styles/tokens.css` — 6 테마 형태 토큰 신규 surface 적용 (Task 9)
  - `src/renderer/i18n/locales/{ko,en}.json` — R10 잔여 키 + en 완전 populate (Task 14)
- E2E:
  - `e2e/search-flow.spec.ts` — NEW (Task 5)
  - `e2e/dm-flow.spec.ts` — NEW (Task 6)
  - `e2e/settings-tabs-flow.spec.ts` — NEW (Task 7)
  - `e2e/playwright.config.ts` 확장 — projects matrix (Task 11/15 사이)
  - `.github/workflows/playwright.yml` — NEW (Task 15) — Windows + macOS + Linux matrix CI
- State flow:
  - **메시지 검색:**
    1. ShellTopBar 검색 아이콘 클릭 → `MessageSearchView` 모달 open.
    2. 입력 (`AND OR NOT`/`"phrase"`/`prefix*` FTS5 syntax 지원) + 옵션 필터 (`projectId?` / `channelId?`).
    3. `useMessageSearch.search(query, filters)` → `invoke('message:search', {query, projectId?, channelId?, limit:50})` → MessageRepository.searchInProject/searchInChannel → 결과 list (matched message + channel + `<mark>` snippet).
    4. row 클릭 → `useChannelMessages.scrollToMessage(messageId)` (R5 navigation pattern reuse) + 모달 close.
  - **DM 생성/대화:**
    1. NavRail "DM" 섹션 + 클릭 → `DmListView` (NavRail 안 expand 또는 별도 view).
    2. `+ 새 DM` 버튼 → `DmCreateModal` open → providers list (이미 DM 있는 provider 는 disabled).
    3. provider 선택 → `invoke('dm:create', {providerId})` → ChannelService.createDm → `idx_dm_unique_per_provider` 가 중복 방지 → 새 channel.id 반환 → activeChannel 로 전환.
    4. Thread 가 `channel.kind === 'dm'` 인 경우 메시지 입력 정상 활성화, 회의 시작 버튼 비활성 (spec §7.4 명시 — DM 은 회의 불가).
  - **Circuit Breaker persistence + approval UI 종결:**
    1. 부팅 시 `CircuitBreakerStore.hydrate(projectId)` → `circuit_breaker_state` table 의 4 row 읽어 in-memory `CircuitBreaker.counters` 에 주입.
    2. `recordX` 호출 시 persistence flush (debounced 1s) — 신규 마이그레이션 012 의 `last_updated_at` 갱신.
    3. `on('fired')` 시 R9 와 동일 흐름 + `kind='circuit_breaker'` row 가 ApprovalInbox 의 `CircuitBreakerApprovalRow` 컴포넌트로 시각화 (어떤 tripwire / 어떤 한계 / "재개" 버튼 → autonomyMode 다시 승격 + counter reset + projectService.setAutonomy).
  - **`stream:member-status-changed`:**
    1. R9 의 `MemberProfileService.emit('status-changed')` 스텁이 R10 에서 활성.
    2. StreamBridge.connect({members}) → 모든 renderer surface (PeopleWidget / MemberRow / MessengerSidebar) 가 `useMemberStatusStream` hook 으로 reducer 적용.
    3. R8 mutation 후 invalidation 패턴은 그대로 유지 (regress 0), stream 은 추가 layer.
  - **Optimistic UI (메시지 전송 예시):**
    1. 사용자가 입력 + Enter → `useChannelMessages.send(content)` 가 즉시 zustand store 에 `{ id: temp-uuid, content, status:'pending', author:'user', createdAt:now }` 추가 → UI 가 메시지 buble 회색조로 즉시 렌더.
    2. 동시에 `invoke('message:append', {channelId, content})` 발사.
    3. 성공 → server-issued message.id 로 swap + status='sent'.
    4. 실패 → store 에서 rollback + ErrorBoundary toast `messenger.composer.error.send`.
  - **LLM 회의록 요약:**
    1. MeetingOrchestrator.onFinal → R6 의 postMinutes 가 R6 포맷 + 메타 헤더 작성.
    2. 새로운 `meetingSummaryService.summarize(meeting, provider?)` 호출 — provider capability 가 'summarize' true 인 첫 provider 로 fallback chain.
    3. 성공 → 1 단락 (200~400자) 추가 paragraph 를 `#회의록` 메시지에 append.
    4. 실패 (provider 없음 / 호출 throw) → 기존 포맷 그대로, warn 로그.
- Testing: Vitest (permission-flag-builder, circuit-breaker-store, dm-create, message-search, meeting-summary-service, member-profile-service stream emit, optimistic store reducers), jsdom (MessageSearchView / DmListView / DmCreateModal / SettingsTabs 10탭 / CircuitBreakerApprovalRow / 3 hook optimistic 패턴), Playwright `_electron` E2E (search-flow / dm-flow / settings-tabs-flow + R4~R9 의 6 spec OS matrix 활성화).

**Tech Stack (R10 추가):**

- 기존 (R9 까지): TypeScript strict / React 19 / Electron 40 / Vite / Vitest (jsdom) / i18next / zod / zustand / Tailwind / Radix (Dialog/Popover/Tooltip/Tabs) / framer-motion / cva / clsx / @playwright/test / better-sqlite3 / @radix-ui/react-popover
- 신규: **`@radix-ui/react-tabs`** (Settings 10탭) — pure JS, native binding 0, WSL rebuild 무관. 다른 신규 dep 없음.
- E2E CI: GitHub Actions matrix 활성화 — `actions/setup-node@v4` + `microsoft/playwright-github-action@v1` 표준 패턴, 신규 외부 service 없음.

**참조:**

- Spec:
  - `docs/specs/2026-04-18-rolestra-design.md`
    - §3 용어집: DM / FTS5 / autonomyMode
    - §5.2 migration 003_channels (`idx_dm_unique_per_provider` 이미 존재) + 005_messages (`messages_fts` + 3 trigger 이미 존재) + 011_notifications + 012_circuit_breaker_state (R10 신규)
    - §6 IPC: `dm:list/create` / `message:search` / 기존 R7 IPC 재사용
    - §7.1 멤버 프로필 (Settings 멤버 탭 풀버전)
    - §7.4 채널 (DM 섹션 — AI 1명만 channel_members + 회의 불가)
    - §7.6 PermissionService 확장 (3 모드 × 3 CLI 매트릭스)
    - §7.6.5 위험한 자율 모드 opt-in (Settings 보안 탭)
    - §7.8 OS 시스템 알림 (focus gate)
    - §7.10.6 Blocks: SettingsSection R4/R10
    - §8 Circuit Breaker (persistence)
    - §10 Phase R10 (Task 0 에서 R3~R9 템플릿으로 확장)
    - §11 E2E + 크로스 OS CI matrix
  - `docs/checklists/r9-done-checklist.md` (Known Concerns 6건 — 모두 R10 종결)
  - `docs/checklists/r8-done-checklist.md` (D8 stream:member-status-changed / Settings 멤버 탭 풀버전 / Provider 추가삭제 UX 이월)
  - `docs/checklists/r7-done-checklist.md` (D2 24h timer rehydrate / D3 mode_transition conditional UX / Dashboard KPI 실시간 / notification.approvalPending main→renderer i18n migration)
- R9 plan/done-checklist: `docs/plans/2026-04-23-rolestra-phase-r9.md`, `docs/checklists/r9-done-checklist.md`
- Main 재사용 모듈:
  - `src/main/channels/{message-repository,channel-service}.ts`
  - `src/main/queue/{queue-service,circuit-breaker,circuit-breaker-accessor}.ts`
  - `src/main/notifications/{notification-service,notification-labels,notification-repository}.ts`
  - `src/main/members/{member-profile-service,member-warmup-service}.ts`
  - `src/main/files/{permission-service,cli-permission-bridge}.ts`
  - `src/main/approvals/{approval-service,approval-decision-router,approval-notification-bridge}.ts`
  - `src/main/dashboard/dashboard-service.ts`
  - `src/main/streams/stream-bridge.ts`
  - `src/main/database/migrations/{007-queue,011-notifications,index}.ts`
- Renderer 재사용:
  - `src/renderer/features/messenger/Thread.tsx` (DM 분기 추가 위치)
  - `src/renderer/features/approvals/ApprovalInboxView.tsx` (CircuitBreakerApprovalRow 분기 추가 위치)
  - `src/renderer/features/settings/{SettingsView,NotificationPrefsView}.tsx` (R9 임시 SettingsView → SettingsTabs 로 교체)
  - `src/renderer/components/shell/{ShellTopBar,NavRail}.tsx` (R3 — search/DM 진입 추가)
  - `src/renderer/hooks/{use-channel-messages,use-autonomy-mode,use-queue,use-pending-approvals,use-dashboard-kpis,use-dms,use-members}.ts`
  - `src/renderer/components/primitives/*` (Radix Tabs 신규 추가)
- R10 신규 디렉토리:
  - `src/renderer/features/search/` — MessageSearchView + SearchResultRow + hook
  - `src/renderer/features/dms/` — DmListView + DmCreateModal
  - `src/renderer/features/settings/tabs/` — 10 탭 컴포넌트
  - `src/main/permissions/` — PermissionFlagBuilder
  - `src/main/llm/` — MeetingSummaryService

---

## Prereqs

- [x] R9 전체 완료 (14/14) + main ff-merge (2026-04-24) — `81a55e6` tip
- [x] R9 done-checklist 작성 및 Known Concerns 6건 문서화
- [x] `MessageRepository.searchInChannel/searchInProject` (R5)
- [x] `idx_dm_unique_per_provider` partial unique index (R2 migration 003)
- [x] `notification-labels.ts` D8 dictionary (R9-Task11) — R10 에서 `setNotificationLocale` settings wiring 만 남음
- [x] `MemberProfileService.emit('status-changed')` 스텁 (R9-Task10)
- [x] `CircuitBreaker` in-memory + `recordX` API (R2/R9)
- [x] `QueueService.startNext` + onFinalized hook (R9-Task7) — meetingStarter production 주입만 R10
- [x] R7 ApprovalDecisionRouter 패턴 (CircuitBreakerApprovalRow 분기 reuse)
- [ ] `rolestra-phase-r10` 브랜치 `main`(`81a55e6`)에서 생성 (Task 0 첫 step)
- [ ] spec §10 R10 블록 R3~R9 템플릿으로 확장 (Task 0)

---

## File Structure (R10 종료 시)

```
src/
├── main/
│   ├── permissions/                                # NEW 디렉토리 (Task 8)
│   │   ├── permission-flag-builder.ts              # NEW
│   │   └── __tests__/permission-flag-builder.test.ts
│   ├── llm/                                        # NEW 디렉토리 (Task 13)
│   │   ├── meeting-summary-service.ts              # NEW
│   │   └── __tests__/meeting-summary-service.test.ts
│   ├── queue/
│   │   ├── circuit-breaker.ts                      # + store DI + flush (Task 11)
│   │   ├── circuit-breaker-store.ts                # NEW (Task 11)
│   │   ├── queue-service.ts                        # + meetingStarter production (Task 4)
│   │   └── __tests__/circuit-breaker-store.test.ts
│   ├── members/
│   │   ├── member-profile-service.ts               # + status-changed broadcast 활성 (Task 12)
│   │   └── member-warmup-service.ts                # + provider.disabled 체크 (Task 13)
│   ├── notifications/
│   │   ├── notification-service.ts                 # + macOS focus gate (Task 13)
│   │   └── notification-labels.ts                  # + setNotificationLocale settings hook (Task 14)
│   ├── approvals/
│   │   └── approval-service.ts                     # + 24h timer rehydrate (Task 13)
│   ├── streams/
│   │   └── stream-bridge.ts                        # + members broadcast (Task 12)
│   ├── ipc/handlers/
│   │   ├── channel-handler.ts                      # + dm:create/list (Task 6)
│   │   └── message-handler.ts                      # + message:search (Task 5)
│   ├── database/migrations/
│   │   └── 012-circuit-breaker-state.ts            # NEW (Task 11, 신규 마이그레이션 1건)
│   └── index.ts                                    # R10 boot block: PermissionFlagBuilder + CircuitBreakerStore.hydrate + queue meetingStarter + 24h timer rehydrate + members stream
├── renderer/
│   ├── features/
│   │   ├── search/                                 # NEW 디렉토리 (Task 5)
│   │   │   ├── MessageSearchView.tsx
│   │   │   └── SearchResultRow.tsx
│   │   ├── dms/                                    # NEW 디렉토리 (Task 6)
│   │   │   ├── DmListView.tsx
│   │   │   └── DmCreateModal.tsx
│   │   ├── settings/
│   │   │   ├── SettingsTabs.tsx                    # NEW (Task 7) — R9 SettingsView 대체
│   │   │   └── tabs/                               # NEW 디렉토리 (10 파일, Task 7)
│   │   │       ├── MembersTab.tsx
│   │   │       ├── NotificationsTab.tsx            # R9 NotificationPrefsView 위임
│   │   │       ├── AutonomyDefaultsTab.tsx
│   │   │       ├── ApiKeysTab.tsx
│   │   │       ├── ThemeTab.tsx
│   │   │       ├── LanguageTab.tsx
│   │   │       ├── PathTab.tsx
│   │   │       ├── CliTab.tsx
│   │   │       ├── SecurityTab.tsx
│   │   │       └── AboutTab.tsx
│   │   ├── approvals/
│   │   │   ├── ApprovalInboxView.tsx               # + CircuitBreakerApprovalRow 분기 (Task 4)
│   │   │   └── CircuitBreakerApprovalRow.tsx       # NEW (Task 4)
│   │   ├── messenger/
│   │   │   └── Thread.tsx                          # + DM 분기 (Task 6)
│   │   └── dashboard/widgets/
│   │       └── ApprovalsWidget.tsx                 # + stream-driven KPI (Task 13)
│   ├── components/shell/
│   │   ├── ShellTopBar.tsx                         # + search 진입 (Task 5)
│   │   └── NavRail.tsx                             # + DM 섹션 활성 + Settings tab 라우팅 (Task 6/7)
│   ├── components/primitives/
│   │   └── Tabs.tsx                                # NEW (Radix Tabs 래퍼, Task 7)
│   ├── hooks/
│   │   ├── use-message-search.ts                   # NEW (Task 5)
│   │   ├── use-dms.ts                              # 확장 — placeholder → 정식 (Task 6)
│   │   ├── use-member-status-stream.ts             # NEW (Task 12)
│   │   ├── use-channel-messages.ts                 # + optimistic add (Task 10)
│   │   ├── use-autonomy-mode.ts                    # + optimistic swap (Task 10)
│   │   ├── use-queue.ts                            # + optimistic add (Task 10)
│   │   └── use-dashboard-kpis.ts                   # + stream subscription (Task 13)
│   ├── styles/
│   │   └── tokens.css                              # + 6 테마 형태 토큰 신규 surface 적용 (Task 9)
│   └── i18n/locales/
│       └── {ko,en}.json                            # R10 잔여 + en 완성 (Task 14)
├── shared/
│   ├── message-search-types.ts                     # NEW (Task 1)
│   ├── dm-types.ts                                 # NEW (Task 1)
│   ├── circuit-breaker-types.ts                    # + persistence schema (Task 1)
│   ├── permission-flag-types.ts                    # NEW (Task 1)
│   ├── ipc-types.ts                                # + 5 신규 채널 (Task 1)
│   ├── ipc-schemas.ts                              # + zod (Task 1)
│   └── stream-events.ts                            # + member-status-changed 정식 (Task 1)
├── preload/
│   └── index.ts                                    # + 신규 IPC + stream 화이트리스트
├── docs/superpowers/
│   ├── plans/
│   │   ├── 2026-04-24-rolestra-phase-r10.md        # (this file)
│   │   └── 2026-04-24-rolestra-phase-r10.md.tasks.json
│   └── specs/
│       ├── 2026-04-18-rolestra-design.md           # §10 R10 체크박스 확장 (Task 0)
│       └── r10-done-checklist.md                   # NEW (Task 15)
├── e2e/
│   ├── search-flow.spec.ts                         # NEW (Task 5)
│   ├── dm-flow.spec.ts                             # NEW (Task 6)
│   └── settings-tabs-flow.spec.ts                  # NEW (Task 7)
├── .github/workflows/
│   └── playwright.yml                              # NEW (Task 11/15) — Windows + macOS + Linux matrix
└── i18next-parser.config.js                        # + R10 신규 namespace keepRemoved
```

**파일 요약:**
- 신규 main: 2 디렉토리 (permissions/ + llm/) + circuit-breaker-store + 012 마이그레이션
- 신규 renderer: 4 디렉토리 (search/ + dms/ + settings/tabs/) + 17 신규 컴포넌트 + 2 신규 hook
- 수정 main: queue-service / circuit-breaker / member-profile-service / member-warmup-service / notification-service / notification-labels / approval-service / stream-bridge / channel-handler / message-handler / index.ts
- 수정 renderer: ApprovalInboxView / Thread / ApprovalsWidget / ShellTopBar / NavRail / 3 hook (optimistic) + 1 hook (stream KPI) + tokens.css
- 수정 shared: ipc-types / ipc-schemas / stream-events / circuit-breaker-types
- 수정 preload: 다중 IPC + stream 화이트리스트
- 신규 spec/plan: r10-done-checklist + this plan + tasks.json + .github playwright workflow

---

## Tasks

### Task 0 — Branch + spec §10 R10 확장 + plan + tasks.json + Decision Log

**목표**: R10 브랜치를 main tip(`81a55e6`)에서 파고, spec §10 R10 블록을 R3~R9 템플릿(체크박스 + 산출물 링크)으로 확장, Decision Log 10건 기록.

- [ ] `git checkout -b rolestra-phase-r10` from main tip (`81a55e6`)
- [ ] spec §10 R10 블록 확장:
  - `- [ ]` 항목 14개 (Task 1~14 산출물과 1:1) + closeout 1개 = 15
  - **scope 경계** 하단 블록: R11 (legacy v2 engine 5 파일 + retro 영어 복귀 D8 + Windows installer / macOS dmg 패키징)
  - plan/done-checklist 링크 placeholder
- [ ] `docs/plans/2026-04-24-rolestra-phase-r10.md.tasks.json` 생성 (16 task slot — Task 0 + Task 1~15)
- [ ] Decision Log (본 plan 끝에 Decision Log 섹션 추가):
  - D1~D10 — 본 plan 끝의 Decision Log 섹션 참고
- [ ] 커밋: `docs(rolestra): R10 plan + tasks.json + spec §10 R10 체크리스트 확장 (R10-Task0)`

**AC**:
- `rolestra-phase-r10` 브랜치 존재
- spec §10 R10 블록 체크박스 + scope 경계 + 링크 placeholder
- tasks.json 16-slot skeleton
- Decision Log 10건 기록

**Testing**: N/A (docs-only commit)

---

### Task 1 — Shared types + IPC 채널 + zod + preload + stream 이벤트

**목표**: R10 가 필요한 신규 IPC 경계를 shared 에 확정. 5 신규 채널 + member-status-changed 정식 활성.

- [ ] `src/shared/message-search-types.ts` 신규:
  - `MessageSearchRequest` `{ query: string; projectId?: string; channelId?: string; limit?: number }`
  - `MessageSearchHit` `{ messageId: string; channelId: string; channelName: string; snippet: string; createdAt: number; rank: number }`
  - `MessageSearchResponse` `{ hits: MessageSearchHit[]; total: number; truncated: boolean }`
- [ ] `src/shared/dm-types.ts` 신규:
  - `DmCreateRequest` `{ providerId: string }`
  - `DmListResponse` `{ channels: Channel[] }` (단순 — 기존 Channel type reuse)
- [ ] `src/shared/circuit-breaker-types.ts` 확장:
  - `CircuitBreakerStateRecord` `{ projectId: string; tripwire: 'files_per_turn'|'cumulative_cli_ms'|'queue_streak'|'same_error'; counter: number; lastResetAt: number; lastUpdatedAt: number }`
- [ ] `src/shared/permission-flag-types.ts` 신규:
  - `PermissionFlagInput` `{ providerKind: 'claude'|'codex'|'gemini'; permissionMode: PermissionMode; projectKind: 'new'|'external'|'imported'; dangerousAutoOptIn: boolean; consensusPath: string }`
  - `PermissionFlagOutput` `{ args: string[]; rejected: false } | { args: null; rejected: true; reason: string }`
- [ ] `src/shared/ipc-types.ts` 확장:
  - `message:search`: `{ request: MessageSearchRequest; response: MessageSearchResponse }`
  - `dm:list`: `{ request: void; response: DmListResponse }`
  - `dm:create`: `{ request: DmCreateRequest; response: Channel }`
  - `permission:dry-run-flags`: `{ request: PermissionFlagInput; response: PermissionFlagOutput }` (settings tab 8/9 미리 보기 용)
  - `meeting:llm-summarize`: `{ request: { meetingId: string }; response: { summary: string | null; providerId: string | null } }`
- [ ] `src/shared/ipc-schemas.ts` 확장:
  - 위 5 채널의 request/response zod schema
  - 기존 `permissionModeSchema` / `autonomyModeSchema` / `channelSchema` 재사용
- [ ] `src/shared/stream-events.ts` 확장:
  - `stream:member-status-changed` (R8 D8 / R9 #3 의 스텁 → 정식 payload 확정): `{ providerId: string; status: WorkStatus; reason?: 'warmup'|'manual'|'reconnect'|'auto-clear' }`
- [ ] `src/preload/index.ts`: 신규 IPC + stream 이벤트 화이트리스트
- [ ] `src/shared/__tests__/ipc-schemas.test.ts` 확장: round-trip 각 채널 당 2 케이스 이상
- [ ] 커밋: `feat(rolestra): R10 shared types + 5 IPC + member-status stream + zod (R10-Task1)`

**AC**:
- 5 신규 IPC 채널 + 1 stream 이 ipc-types / ipc-schemas / preload / stream-events 에 일관 선언
- zod round-trip 12+ 케이스 green
- 기존 R9 채널 회귀 0
- typecheck exit 0

**Testing**: Vitest schema round-trip.

---

### Task 2 — `MessageSearchView` + `use-message-search` + ShellTopBar 진입

**목표**: spec §10 R10 "검색 (FTS5 메시지 검색)" 항목 완료. R5 시점 이미 구현된 `MessageRepository.searchInChannel/searchInProject` 위에 IPC handler + UI + 라우팅.

- [ ] `src/main/ipc/handlers/message-handler.ts` 확장: `message:search` handler — `messageRepo.searchInProject(query, projectId, limit)` 또는 `searchInChannel(query, channelId, limit)` 호출 결과를 `MessageSearchHit[]` 로 mapping (channel name lookup 포함)
- [ ] `src/main/ipc/router.ts`: `message:search` 등록
- [ ] `src/renderer/hooks/use-message-search.ts` 신규:
  - `useMessageSearch()` → `{ hits, isLoading, error, search(query, filters), clear() }`
  - debounce 200ms
- [ ] `src/renderer/features/search/MessageSearchView.tsx` 신규:
  - Radix Dialog modal — 입력 textbox + filter (current channel only / current project only / all)
  - 결과 list — `<SearchResultRow>` 반복 + empty state + loading skeleton
  - `Esc` 닫기 / `Enter` 첫 결과 활성화
- [ ] `src/renderer/features/search/SearchResultRow.tsx` 신규:
  - channel badge + 시각 + content snippet (`<mark>` 강조 — 서버에서 이미 wrap 된 경우 우선, 없으면 client side highlight)
  - 클릭 → `useChannelMessages.scrollToMessage(messageId)` + close modal
- [ ] `src/renderer/components/shell/ShellTopBar.tsx` 수정: 검색 아이콘 (LineIcon `search`) 클릭 → `MessageSearchView` open. `Cmd/Ctrl+K` shortcut 추가 (Task 7 SettingsTabs 의 keyboard shortcut 탭과 일관)
- [ ] `e2e/search-flow.spec.ts` 신규: ShellTopBar 검색 진입 → 입력 → 결과 list 표시 → 클릭 → 채널 이동 (WSL DONE_WITH_CONCERNS 정책 R4~R9 동일)
- [ ] `__tests__/MessageSearchView.test.tsx` 8+ tests
- [ ] `__tests__/use-message-search.test.tsx` 6+ tests (debounce / empty / error / clear)
- [ ] `__tests__/message-handler.test.ts` 5+ tests (handler 입력 분기 / 결과 mapping)
- [ ] 커밋: `feat(rolestra): MessageSearchView + use-message-search + ShellTopBar 진입 (R10-Task2)`

**AC**:
- 검색 입력 → invoke('message:search') 인자 정확
- 결과 row 클릭 → channel 이동 + 메시지 scroll (R5 navigation pattern reuse)
- Cmd/Ctrl+K 단축키 동작
- 신규 `message.search.*` i18n 키 18+ (Task 14 에서 populate)
- E2E 1 spec 추가
- 기존 messenger 회귀 0

**Testing**: Vitest + React Testing Library + Playwright (DONE_WITH_CONCERNS).

---

### Task 3 — DM 정식 기능 (`DmListView` + `DmCreateModal` + Thread 분기 + dm:create/list IPC)

**목표**: spec §10 R10 "DM 기능 완성" 항목 완료. R2 시점 channels.kind='dm' + idx_dm_unique_per_provider 위에 사용자 노출.

- [ ] `src/main/channels/channel-service.ts` 수정: `createDm(providerId)` API 추가 — `idx_dm_unique_per_provider` 위반 시 기존 channel 반환 (idempotent)
- [ ] `src/main/channels/__tests__/channel-service.test.ts`: createDm 4+ cases (신규 / 중복 / 잘못된 providerId / DM list 정렬)
- [ ] `src/main/ipc/handlers/channel-handler.ts` 확장: `dm:list` (channels WHERE project_id IS NULL AND kind='dm') / `dm:create` 등록
- [ ] `src/main/ipc/router.ts`: 2 채널 등록
- [ ] `src/renderer/hooks/use-dms.ts` 확장 — R5 placeholder 를 정식 dm:list/create 로 전환:
  - `useDms()` → `{ channels, isLoading, error, create(providerId) }`
- [ ] `src/renderer/features/dms/DmListView.tsx` 신규:
  - 헤더 "DM" + `+ 새 DM` 버튼
  - DM channel list — provider avatar + lastMessage preview + unread count
  - row 클릭 → activeChannel 로 전환 + view='messenger'
- [ ] `src/renderer/features/dms/DmCreateModal.tsx` 신규:
  - Radix Dialog — providers list (이미 DM 있는 provider 는 disabled + tooltip "이미 DM 채널 있음")
  - 선택 + "DM 시작" → `useDms.create(providerId)` → modal close + 새 channel 활성
- [ ] `src/renderer/components/shell/NavRail.tsx` 수정: DM 섹션 (R3 시점 placeholder) → `DmListView` 진입 활성화
- [ ] `src/renderer/features/messenger/Thread.tsx` 수정:
  - `channel.kind === 'dm'` 분기: 메시지 입력 정상 활성화 + 회의 시작 버튼 비활성 + tooltip `dm.meetingDisabled`
- [ ] `e2e/dm-flow.spec.ts` 신규: NavRail DM 진입 → `+ 새 DM` → provider 선택 → DM channel 활성 → 메시지 입력 (WSL DONE_WITH_CONCERNS)
- [ ] `__tests__/DmListView.test.tsx` 6+ tests
- [ ] `__tests__/DmCreateModal.test.tsx` 6+ tests (이미 DM 있는 provider disabled / 선택 → invoke / 취소)
- [ ] `__tests__/use-dms.test.tsx` 6+ tests
- [ ] `__tests__/Thread.test.tsx` (R5/R7 회귀) — DM 분기 추가 케이스 2+
- [ ] 커밋: `feat(rolestra): DM 정식 — DmListView + DmCreateModal + dm:create/list (R10-Task3)`

**AC**:
- DM 생성 → idx_dm_unique_per_provider 가 중복 방지 (idempotent)
- DM channel 에서 메시지 입력 정상 / 회의 시작 비활성
- AI 끼리 DM 생성 불가 (UI 자체에서 차단 — provider list 만 표시, 사용자는 channel_members 에 들어가지 않음)
- NavRail DM 섹션 정식 활성
- 신규 `dm.*` i18n 키 (Task 14)
- E2E 1 spec 추가
- 기존 messenger / channel 회귀 0

**Testing**: Vitest + React Testing Library + Playwright (DONE_WITH_CONCERNS).

---

### Task 4 — Queue meetingStarter production 주입 + Circuit Breaker approval UI 정식 편입

**목표**: R9 Known Concerns #1 + #6 동시 종결. (i) `QueueService.startNext` 가 R9 에서는 claim + stream emit 까지만 했고 실제 meeting spawn 은 미수행 — R10 에서 `channel:start-meeting` 팩토리 helper 를 production 주입. (ii) `kind='circuit_breaker'` row 가 R9 에서는 ApprovalInbox 의 일반 row 로만 표시 — R10 에서 `CircuitBreakerApprovalRow` 전용 컴포넌트로 시각화 + "재개" 버튼.

- [ ] `src/main/queue/queue-service.ts` 수정:
  - `startNext(projectId, meetingStarter?)` 의 `meetingStarter` 콜백을 production 에서 주입받을 helper 추출 — `createDefaultMeetingStarter(deps: { meetingService, channelService })` 가 `(projectId, prompt) => meetingService.start({channelId: resolveSystemGeneral(projectId), topic: prompt})` 반환
- [ ] `src/main/index.ts` 수정: `const meetingStarter = createDefaultMeetingStarter({meetingService, channelService}); queueService.setMeetingStarter(meetingStarter);` (boot block)
- [ ] `src/main/queue/__tests__/queue-service.test.ts` 확장: production meetingStarter 통합 4+ cases (정상 / 중복 활성 회의 거부 / channel 미존재 / autonomyMode != queue 인 프로젝트 거부)
- [ ] `src/renderer/features/approvals/CircuitBreakerApprovalRow.tsx` 신규:
  - props: `{ item: ApprovalItem }` — meta 에서 tripwire / detail 추출
  - 시각화: tripwire icon (LineIcon `circuitBreaker`) + 라벨 + 한계값 vs 측정값 비교 + 시각 (createdAt) + "재개" 버튼 + "manual 유지" 버튼
  - "재개" 클릭 → `invoke('approval:decide', {id, decision:'approved'})` + downstream `circuitBreaker.resetCounter(tripwire)` + `projectService.setAutonomy(projectId, previousMode)` (previousMode 는 meta 에 저장된 값, 없으면 'auto_toggle' default)
- [ ] `src/renderer/features/approvals/ApprovalInboxView.tsx` 수정: `item.kind === 'circuit_breaker'` 분기 → `<CircuitBreakerApprovalRow>` 렌더, 그 외는 기존 row
- [ ] `src/main/queue/circuit-breaker.ts` 수정: `resetCounter(tripwire)` 공개 API 추가 (현재는 fired 후 자동 리셋만)
- [ ] `src/main/approvals/approval-decision-router.ts` 수정: `kind='circuit_breaker'` + `decision='approved'` 분기 → `circuitBreaker.resetCounter(meta.tripwire)` + `projectService.setAutonomy(meta.previousMode)`
- [ ] `__tests__/CircuitBreakerApprovalRow.test.tsx` 6+ tests
- [ ] `__tests__/approval-decision-router.test.ts` 확장: circuit_breaker 분기 4+ cases
- [ ] `__tests__/queue-service.test.ts` 회귀 + production meetingStarter 4+ cases
- [ ] 커밋: `feat(rolestra): Queue meetingStarter production + CircuitBreaker approval UI (R10-Task4)`

**AC**:
- Queue 모드에서 meeting onFinal → 다음 항목이 실제 meeting 으로 spawn (이전 R9 는 claim 만)
- ApprovalInbox 에서 circuit_breaker row 가 전용 시각화로 표시
- "재개" 클릭 → autonomyMode 복귀 + counter reset
- R9 Known Concerns #1 + #6 종결
- 신규 `approval.circuitBreaker.*` / `queue.toast.nextStarted` i18n 키 (Task 14)
- 기존 R9 queue / approval 회귀 0

**Testing**: Vitest + React Testing Library.

---

### Task 5 — PermissionFlagBuilder (3 모드 × 3 CLI × 3 project kind 매트릭스 통합)

**목표**: spec §7.6.3 에 흩어져 있는 CLI 플래그 build 를 단일 모듈로 통합. external+auto 거부(CA-1/CA-3) 를 builder 입력 zod 스키마에서 reject. settings 보안 탭(Task 7)의 "위험한 자율 모드" opt-in 토글이 builder 입력의 별도 boolean 으로 반영.

- [ ] `src/main/permissions/permission-flag-builder.ts` 신규:
  - `buildFlags(input: PermissionFlagInput): PermissionFlagOutput`
  - input.providerKind === 'claude':
    - `auto`: `['--permission-mode', 'acceptEdits', '--allowedTools', 'Read,Glob,Grep,Edit,Write,Bash,WebSearch,WebFetch', '--add-dir', input.consensusPath]`
    - `hybrid`: `['--permission-mode', 'acceptEdits', '--allowedTools', 'Read,Glob,Grep,Edit,Write,WebSearch,WebFetch', '--add-dir', input.consensusPath]`
    - `approval`: `['--allowedTools', 'Read,Glob,Grep,WebSearch,WebFetch', '--permission-mode', 'default', '--add-dir', input.consensusPath]`
    - `dangerousAutoOptIn=true`: `--dangerously-skip-permissions` 추가 (auto 만, 그 외 모드는 무시)
  - input.providerKind === 'codex': spec §7.6.3 의 Codex 표 그대로 build
  - input.providerKind === 'gemini': spec §7.6.3 의 Gemini 표 그대로 build
  - input.projectKind === 'external' + permissionMode === 'auto': `{ args: null, rejected: true, reason: 'external+auto disallowed (CA-1/CA-3)' }` (spec §7.3 명시)
- [ ] `src/main/permissions/__tests__/permission-flag-builder.test.ts`: 3 × 3 × 3 = 27 cases + dangerousAutoOptIn × 3 + external+auto rejection × 3 = 33 cases
- [ ] CliProvider 들이 `PermissionFlagBuilder.buildFlags` 를 사용하도록 cli-runner 들 수정 (claude / codex / gemini cli-runner 의 inline 플래그 build 코드 → builder 호출로 교체). 회귀 0 보장.
- [ ] `src/main/ipc/handlers/permission-handler.ts` 확장: `permission:dry-run-flags` handler — 미리 보기 (settings 탭 사용)
- [ ] `src/main/ipc/router.ts`: 등록
- [ ] 커밋: `feat(rolestra): PermissionFlagBuilder + 3×3×3 매트릭스 통합 (R10-Task5)`

**AC**:
- buildFlags 27 + 6 + 6 = 39 cases green
- external+auto 입력 → `rejected: true`
- dangerousAutoOptIn=true + auto + Claude → `--dangerously-skip-permissions` 포함
- 기존 cli-runner 들이 builder 사용 (검증: spawn arg 비교 테스트)
- 기존 cli spawn 회귀 0

**Testing**: Vitest 매트릭스 + cli-runner 통합 (mock spawn).

---

### Task 6 — Settings UI 정식 10탭 재구성 (`SettingsTabs` + 10 탭 컴포넌트)

**목표**: R9 임시 SettingsView (NotificationPrefsView 한 섹션) → spec §7.10.6 의 정식 10탭으로 재구성. R8 D8 deferred (멤버 풀버전) + Provider 추가/삭제 UX 동시 종결.

- [ ] `src/renderer/components/primitives/Tabs.tsx` 신규: Radix Tabs 래퍼 (cva variants — themeKey 분기로 panelClip / cardTitleStyle 자동 매핑)
- [ ] `src/renderer/features/settings/SettingsTabs.tsx` 신규: Tabs orchestrator + 10 tab keys
- [ ] `src/renderer/features/settings/tabs/MembersTab.tsx`: R8 `MemberProfileEditModal` 풀버전 — 일괄 편집 / 추가 / 삭제 (+신규 IPC `member:add` / `member:remove` 가 필요하면 R10 추가, 아니면 `provider:create/delete` reuse)
- [ ] `src/renderer/features/settings/tabs/NotificationsTab.tsx`: R9 `NotificationPrefsView` 위임 (이전)
- [ ] `src/renderer/features/settings/tabs/AutonomyDefaultsTab.tsx`: 프로젝트 생성 시 default autonomyMode + Circuit Breaker 4 tripwire 한계값 조정
- [ ] `src/renderer/features/settings/tabs/ApiKeysTab.tsx`: safeStorage CRUD (provider 별 API key 입력 + masked 표시 + "변경" 버튼)
- [ ] `src/renderer/features/settings/tabs/ThemeTab.tsx`: themeKey + mode 선택 — `theme-switcher` 정식 노출 (DEV-only flag 제거)
- [ ] `src/renderer/features/settings/tabs/LanguageTab.tsx`: `i18next.changeLanguage` + `setNotificationLocale(locale)` 동시 호출 — Task 14 와 통합 (D8 잔재 종결)
- [ ] `src/renderer/features/settings/tabs/PathTab.tsx`: ArenaRoot 변경 안내 + 재시작 필요 배너
- [ ] `src/renderer/features/settings/tabs/CliTab.tsx`: provider 추가/삭제 UX (R8 deferred — provider:create / provider:delete IPC reuse)
- [ ] `src/renderer/features/settings/tabs/SecurityTab.tsx`: path-guard 상태 표시 + "위험한 자율 모드" opt-in switch (spec §7.6.5)
- [ ] `src/renderer/features/settings/tabs/AboutTab.tsx`: 앱 버전 + 라이센스 + R10 디자인 sign-off 마크
- [ ] `src/renderer/features/settings/SettingsView.tsx` 삭제 (또는 `<SettingsTabs />` 위임 단일 라인) — R9 시점 임시 view 정식 교체
- [ ] `src/renderer/components/shell/NavRail.tsx` 수정: Settings 진입 시 `view='settings'` + 기본 tab 'notifications' (R9 호환), URL hash 로 `#settings/members` 같은 deep-link 지원
- [ ] `__tests__/SettingsTabs.test.tsx` 8+ tests (10 tab 렌더 / 활성 tab 전환 / deep-link)
- [ ] 각 tab 별 `__tests__/{Members,Notifications,...}Tab.test.tsx` 4~6 tests × 10 = 약 50 tests
- [ ] `e2e/settings-tabs-flow.spec.ts` 신규: NavRail Settings → 10 tab 순회 → ThemeTab 에서 theme 변경 → LanguageTab 에서 en 전환 → 알림 라벨 en 으로 갱신 (WSL DONE_WITH_CONCERNS)
- [ ] 커밋: `feat(rolestra): Settings UI 10탭 재구성 + R8/R10 deferred 일괄 (R10-Task6)`

**AC**:
- 10 tab 모두 mount + 전환 정상
- ThemeTab 에서 theme switch → tokens.css 적용 (R10 Task 9 wire 후 시각 차이)
- LanguageTab 에서 ko ↔ en 전환 + main-process notification 라벨 동시 전환
- SecurityTab 의 "위험한 자율 모드" 토글 → PermissionFlagBuilder dangerousAutoOptIn 반영
- R8 D8 (멤버 풀버전) + R8 D 흐름 (Provider 추가/삭제) + R7 D3 (mode_transition conditional UX placeholder) 종결
- 신규 `settings.{members,notifications,autonomyDefaults,apiKeys,theme,language,path,cli,security,about}.*` i18n 키 (Task 14)
- E2E 1 spec 추가
- 기존 R9 SettingsView 회귀 0 (NotificationPrefsView 위임 유지)

**Testing**: Vitest + React Testing Library + Playwright (DONE_WITH_CONCERNS).

---

### Task 7 — 6 테마 형태-레벨 분기 정식 wire (디자인 fidelity 갭 해소)

**목표**: 메모리 `rolestra-design-fidelity-gap.md` 메모 (R4 시점 사용자 피드백 — "토큰 스왑만으로 '공통 형태 + 색만' 느낌, R5+ 는 themeKey 형태-레벨 분기 필수") 해소. R3 시점 도입한 `panelClip` / `cardTitleStyle` / `miniBtnStyle` / `gaugeGlow` / `avatarShape` 형태 토큰들을 R4~R10 의 신규 surface 에 실제 wire.

- [ ] `src/renderer/styles/tokens.css` 확장:
  - 6 테마 × 신규 surface 별 형태 토큰 적용 — 특히 R5 MessageBubble / R7 ApprovalCard / R8 MemberProfilePopover / R9 AutonomyConfirmDialog + QueuePanel + NotificationPrefsView / R10 MessageSearchView + DmListView + SettingsTabs + CircuitBreakerApprovalRow
  - 예: warm light Card 는 `border-radius: var(--panel-radius-warm)` (기존 변수 reuse), tactical dark 는 `clip-path: var(--panel-clip-tactical)` (NEW), retro 는 `border: 1px dashed; cardTitleStyle = ascii` 분기
- [ ] 각 신규 surface 컴포넌트 — `data-theme`/`data-mode` 기반 CSS 만 사용 (인라인 스타일 0, hardcoded color 0). cva variants 가 themeKey 가져와서 `panelClip` / `cardTitleStyle` 자동 분기
- [ ] `src/renderer/components/primitives/Card.tsx` (R3) 확장: variants 에 R10 형태-레벨 prop (`asciiHeader?: boolean`) 추가 — retro 시 자동 활성화
- [ ] `src/renderer/components/primitives/Button.tsx` (R3) 확장: `shape='auto'` 일 때 `miniBtnStyle` 토큰 (pill / notched / text) 분기 정상 동작 (R3 에서 선언만, 실제 surface 가 사용 안 함 — R10 에서 정식 wire)
- [ ] `src/renderer/features/dashboard/ProgressGauge.tsx` (R4) 확장: tactical 12분절 / retro ASCII / warm 라운드 — 3 variant 모두 정식 wire (R4 에서 themeKey 분기 stub 만, R10 에서 시각 완성)
- [ ] 6 테마 스크린샷 증빙 — `docs/specs/appendix/r10-evidence/` 디렉토리 신규:
  - 12 캡처 (6 테마 × 2 surface — Dashboard + Messenger; SettingsTabs 와 ApprovalInbox 는 R10 sign-off 게이트 필수)
  - 캡처 위치: Windows native 또는 macOS native (WSL 제약 — DONE_WITH_CONCERNS 정책 R3 와 동일하게 README 에 명시)
- [ ] `theme:check` 스크립트 확장: 신규 surface 의 hardcoded color literal 0 검증 (regex grep `#[0-9a-f]{3,6}`)
- [ ] `__tests__/theme-shape-tokens.test.tsx` 신규: 6 테마 × 5 surface = 30 cases — DOM 의 `data-theme`/`data-mode` 와 computed style 의 `border-radius` / `clip-path` 가 일치
- [ ] 커밋: `feat(rolestra): 6 테마 형태-레벨 분기 정식 wire — design fidelity sign-off (R10-Task7)`

**AC**:
- 6 테마 모두 신규 surface 에서 시각 차이 분명 (panelClip / cardTitleStyle / miniBtnStyle / gaugeGlow 분기 적용)
- theme:check exit 0 (hardcoded color 0)
- 12 스크린샷 증빙 (DONE_WITH_CONCERNS 시 README placeholder)
- R4~R9 의 시각 회귀 0
- 신규 i18n 키 0 (시각만 변경)

**Testing**: Vitest + jsdom computed style + theme:check + 수동 스크린샷.

---

### Task 8 — Optimistic UI (메시지 전송 / autonomy 토글 / queue 추가)

**목표**: R5 / R9 의 mutation 흐름을 optimistic 으로 승격. 100~300ms latency 노출 제거.

- [ ] `src/renderer/hooks/use-channel-messages.ts` 수정:
  - `send(content)` 가 invoke 전에 zustand store 에 `{ id: temp-uuid, content, status:'pending', author:'user', createdAt:now }` 추가
  - invoke 성공 → server-issued message.id 로 swap + status='sent'
  - 실패 → store 에서 rollback + ErrorBoundary toast `messenger.composer.error.send` (i18n 키 Task 14)
- [ ] `src/renderer/hooks/use-autonomy-mode.ts` 수정: `confirm(target)` 이 invoke 전에 로컬 state mode 낙관 갱신, stream 수신 시 reconcile (이미 R9 에서 일부 구현 — 정식 + rollback 추가)
- [ ] `src/renderer/hooks/use-queue.ts` 수정: `addLines(text)` 가 invoke 전에 `{ id: temp-uuid, content, status:'pending' }` row 추가, invoke 성공 시 swap, 실패 시 rollback
- [ ] `src/renderer/components/ErrorBoundary.tsx` 신규 (R10 deferred — 여기서 같이 도입): React 19 ErrorBoundary 래퍼 + toast surfacing
- [ ] `src/renderer/App.tsx` 수정: 최상위에 `<ErrorBoundary>` 래핑
- [ ] `__tests__/use-channel-messages.test.tsx` 확장: optimistic + rollback 6+ cases
- [ ] `__tests__/use-autonomy-mode.test.tsx` 확장: optimistic + rollback 4+ cases
- [ ] `__tests__/use-queue.test.tsx` 확장: optimistic + rollback 4+ cases
- [ ] `__tests__/ErrorBoundary.test.tsx` 신규 4+ cases
- [ ] 커밋: `feat(rolestra): Optimistic UI + ErrorBoundary 도입 (R10-Task8)`

**AC**:
- 메시지 전송 / autonomy 토글 / queue add 모두 즉시 UI 반영
- IPC 실패 시 rollback + toast
- ErrorBoundary 가 unhandled error 가로채기
- 기존 R5/R9 hook 회귀 0
- 신규 의존성 0

**Testing**: Vitest + React Testing Library + mock invoke (latency 0/100ms/throw).

---

### Task 9 — Circuit Breaker persistence (신규 마이그레이션 012 + hydrate/flush)

**목표**: R9 Known Concerns #2 종결. `CircuitBreaker` in-memory counter → 신규 테이블 `circuit_breaker_state` 와 동기화. 신규 마이그레이션 1건 (R10 의 유일한 forward-only 추가).

- [ ] `src/main/database/migrations/012-circuit-breaker-state.ts` 신규:
  ```sql
  CREATE TABLE circuit_breaker_state (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    tripwire TEXT NOT NULL CHECK(tripwire IN ('files_per_turn','cumulative_cli_ms','queue_streak','same_error')),
    counter INTEGER NOT NULL DEFAULT 0,
    last_reset_at INTEGER NOT NULL,
    last_updated_at INTEGER NOT NULL,
    PRIMARY KEY (project_id, tripwire)
  );
  CREATE INDEX idx_cbs_project ON circuit_breaker_state(project_id);
  ```
- [ ] `src/main/database/migrations/index.ts` 수정: 012 등록 (forward-only, idempotent)
- [ ] `src/main/queue/circuit-breaker-store.ts` 신규:
  - `hydrate(projectId): Promise<Map<Tripwire, CircuitBreakerStateRecord>>`
  - `flush(projectId, tripwire, counter, now): void` (debounced 1s — R10 에서 new lodash 도입은 회피, 자체 debounce util 사용)
  - `reset(projectId, tripwire, now): void`
- [ ] `src/main/queue/circuit-breaker.ts` 수정:
  - constructor 에 `store?: CircuitBreakerStore` DI
  - `recordX` 호출 시 store.flush (debounced)
  - `resetCounter(tripwire)` (R10 Task 4 에서 추가) → store.reset
  - constructor 에서 store.hydrate 호출 → 인메모리 counters 초기화
- [ ] `src/main/index.ts` 수정: `const cbStore = new CircuitBreakerStore(db); const circuitBreaker = new CircuitBreaker({store: cbStore});` boot block
- [ ] `src/main/queue/__tests__/circuit-breaker-store.test.ts` 신규: 8+ cases (hydrate empty / hydrate with rows / flush + read / reset / debounce coalesce / FK cascade on project delete)
- [ ] `src/main/queue/__tests__/circuit-breaker.test.ts` 확장: persistence 통합 6+ cases
- [ ] `src/main/database/__tests__/migrations.test.ts` (R2) 확장: 012 up + 재실행 idempotent + down 테스트
- [ ] 커밋: `feat(rolestra): Circuit Breaker persistence — 012 migration + store (R10-Task9)`

**AC**:
- 부팅 시 circuit_breaker_state row hydrate
- recordX 호출 시 1s debounce 후 DB flush
- 재시작 후 counter 유지
- migration 012 idempotent
- R9 Known Concerns #2 종결
- 기존 R9 circuit-breaker 회귀 0

**Testing**: Vitest + 마이그레이션 통합.

---

### Task 10 — `stream:member-status-changed` 정식 broadcast + Warmup `provider.disabled` 체크 + Notification macOS focus gate

**목표**: R9 Known Concerns #3 + #4 + #5 동시 종결. R8 D8 도 함께.

- [ ] `src/main/members/member-profile-service.ts` 수정: `emit('status-changed', {providerId, status, reason})` (R9 스텁) → 정식 활성, R10 에서 추가 reason 'auto-clear' 포함
- [ ] `src/main/streams/stream-bridge.ts` 수정: `connect({members: memberProfileService})` 활성화 → `stream:member-status-changed` broadcast
- [ ] `src/renderer/hooks/use-member-status-stream.ts` 신규: `useMemberStatusStream()` → store reducer (zustand) — PeopleWidget / MemberRow / MessengerSidebar 가 이 store 구독
- [ ] R8 의 mutation 후 invalidation 패턴은 그대로 유지 (regress 0), stream 은 추가 layer
- [ ] `src/main/members/member-warmup-service.ts` 수정: backoff retry 중 `provider.disabled === true` 이면 retry 체인 중단 (cancelRetries(providerId))
- [ ] `src/main/notifications/notification-service.ts` 수정: macOS 에서 `app.isFocused()` (BrowserWindow.isFocused 기반) 가 부정확 — `process.platform === 'darwin'` 일 때 `app.dock.isVisible()` + `BrowserWindow.getAllWindows().some(w => w.isFocused() && w.isVisible())` 조합으로 보정
- [ ] `__tests__/member-profile-service.test.ts` 확장: status-changed broadcast 4+ cases
- [ ] `__tests__/use-member-status-stream.test.tsx` 신규 5+ cases
- [ ] `__tests__/member-warmup-service.test.ts` 확장: provider.disabled 중단 4+ cases
- [ ] `__tests__/notification-service.test.ts` 확장: macOS focus gate 5+ cases (process.platform mock)
- [ ] 커밋: `feat(rolestra): member-status-changed broadcast + warmup disable check + macOS focus gate (R10-Task10)`

**AC**:
- 멤버 status 변경 → 모든 surface 즉시 동기 (R8 mutation 후 fetch latency 제거)
- Warmup 중 provider disable 시 retry 즉시 중단
- macOS focus gate 정확
- R9 Known Concerns #3/#4/#5 종결
- R8 D8 종결
- 기존 R8/R9 회귀 0

**Testing**: Vitest + jsdom + process.platform mock.

---

### Task 11 — Consensus 24h timer rehydrate + Dashboard KPI stream + mode_transition conditional UX + LLM 회의록 요약

**목표**: R7/R6 deferred 일괄 정리 + LLM 요약 추가.

- [ ] `src/main/approvals/approval-service.ts` 수정: `rehydrateConsensusTimers()` 부팅 helper — `approval_items.status='pending' AND kind='consensus_decision' AND created_at + 24h > now` row 들에 대해 setTimeout 재예약 (R7 D2 이월)
- [ ] `src/main/index.ts` 수정: boot 직후 `approvalService.rehydrateConsensusTimers()` 호출
- [ ] `src/renderer/hooks/use-dashboard-kpis.ts` 수정: `usePendingApprovals` reducer 를 watch 하여 mount-fetch+invalidate → stream-driven 으로 승격 (R7 deferred)
- [ ] `src/renderer/features/dashboard/widgets/ApprovalsWidget.tsx` 수정: KPI count 가 stream 으로 즉시 갱신
- [ ] `src/renderer/features/messenger/ApprovalBlock.tsx` (R7) 수정: `mode_transition` 의 conditional 버튼 활성 (R7 D3 deferred) — 클릭 → ConditionalDialog (R7 컴포넌트 reuse) → 자연어 조건 입력 → `invoke('approval:decide', {id, decision:'conditional', comment})` → ApprovalDecisionRouter 가 mode 메타에 조건 첨부 → 다음 회의 시작 시 system message 로 주입
- [ ] `src/main/llm/meeting-summary-service.ts` 신규:
  - `summarize(meetingId, providerId?): Promise<{summary: string|null, providerId: string|null}>`
  - provider capability 'summarize' true 인 첫 provider 로 fallback chain
  - 호출 throw / provider 없음 → null + warn
- [ ] `src/main/meetings/engine/meeting-orchestrator.ts` 수정: onFinal → R6 postMinutes 직후 `meetingSummaryService.summarize(meeting.id)` 호출 → 성공 시 1단락 추가 paragraph 를 `#회의록` 메시지에 append (실패면 기존 포맷 유지)
- [ ] `src/main/ipc/handlers/meeting-handler.ts` 확장: `meeting:llm-summarize` (사용자 수동 호출 — Task 14 i18n 키 만 추가, UI 는 SettingsTabs.AutonomyDefaultsTab 의 "자동 LLM 요약" 토글에서 default 결정)
- [ ] `__tests__/meeting-summary-service.test.ts` 신규 6+ cases
- [ ] `__tests__/approval-service.test.ts` 확장: rehydrateConsensusTimers 4+ cases
- [ ] `__tests__/use-dashboard-kpis.test.tsx` 확장: stream-driven 4+ cases
- [ ] `__tests__/ApprovalBlock.test.tsx` 확장: conditional 활성 4+ cases
- [ ] 커밋: `feat(rolestra): consensus rehydrate + KPI stream + mode_transition conditional + LLM summary (R10-Task11)`

**AC**:
- 24h timer 재시작 후 정확히 expire
- Dashboard KPI 가 approval mutation 즉시 반영
- mode_transition conditional 버튼 정식 활성
- LLM 요약 — provider 있을 때 1단락 추가, 없으면 기존 포맷 (회귀 0)
- R7 D2/D3 + Dashboard KPI realtime + LLM 요약 종결
- 기존 R6/R7 회귀 0

**Testing**: Vitest + fake timers.

---

### Task 12 — i18n 완성 (잔여 main-process 라벨 dictionary 이전 + en 풀 populate + setNotificationLocale settings wiring)

**목표**: R3~R9 누적 i18n 부채 종결. 1) ko/en 양쪽 동일 schema, 2) main-process 잔여 한국어 고정 라벨 모두 `notification-labels.ts` (D8) dictionary 로 이전, 3) `setNotificationLocale` 을 settings LanguageTab 에서 i18next.changeLanguage 와 동시 호출.

- [ ] `src/main/notifications/notification-labels.ts` 확장: R7/R8 deferred `notification.approvalPending.*` + R9 잔여 라벨 모두 dictionary 로 이전 (현재 일부는 라벨이 없거나 한국어 fallback)
- [ ] R10 신규 namespace populate (ko + en 양쪽):
  - `message.search.*` (Task 2 — modal title / placeholder / empty / error / shortcut hint)
  - `dm.*` (Task 3 — DM list / create modal / disabled tooltip / meetingDisabled)
  - `settings.{members,notifications,autonomyDefaults,apiKeys,theme,language,path,cli,security,about}.*` (Task 6 — 각 탭 라벨 + 설명)
  - `approval.circuitBreaker.*` (Task 4 — tripwire 시각 라벨 + 재개 버튼)
  - `messenger.composer.error.*` (Task 8 — optimistic rollback toast)
  - `meeting.summary.*` (Task 11 — LLM 요약 헤더)
- [ ] R3~R9 의 ko 만 채워진 키 — en 일괄 populate (orphan 0 보장)
- [ ] `src/renderer/features/settings/tabs/LanguageTab.tsx` (Task 6) → `i18next.changeLanguage(locale)` + `invoke('notification:set-locale', {locale})` (R10 신규 IPC) 동시 호출
- [ ] `src/main/notifications/notification-service.ts` 확장: `setLocaleFromIpc` IPC handler — `setNotificationLocale(locale)` 위임
- [ ] `src/main/ipc/handlers/notification-handler.ts` 확장: `notification:set-locale` 등록
- [ ] `i18next-parser.config.js` 수정: keepRemoved regex 에 R10 신규 namespace 추가
- [ ] `npm run i18n:check` exit 0 (idempotent — 두 번째 실행 diff 0)
- [ ] `__tests__/notification-labels.test.ts` 확장: 신규 keys + en parity 8+ cases
- [ ] 커밋: `feat(rolestra): i18n 완성 ko/en parity + setNotificationLocale settings wire (R10-Task12)`

**AC**:
- ko + en 양쪽 동일 schema (orphan 0)
- LanguageTab 토글 → i18next + main-process 라벨 동시 전환
- main-process 한국어 고정 라벨 0 (모두 dictionary)
- i18n:check exit 0 (idempotent)
- D8 잔재 종결

**Testing**: Vitest + i18n:check.

---

### Task 13 — Playwright OS matrix CI 활성화 + R4~R10 6+3 spec 일괄 실 런

**목표**: R4~R9 내내 WSL DONE_WITH_CONCERNS 였던 6 spec + R10 신규 3 spec (search / dm / settings-tabs) + R10 autonomy-queue Step C 활성 → GitHub Actions matrix `windows-latest` + `macos-latest` + `ubuntu-latest` 에서 실 런.

- [ ] `.github/workflows/playwright.yml` 신규:
  - matrix: `os: [windows-latest, macos-latest, ubuntu-latest]`
  - jobs: setup-node 20 → npm ci → npm run build → npx playwright install electron → npx playwright test
  - API 키 없으면 mock provider fixture 로 cover (E2E spec 들이 이미 mock 패턴 사용 — R4~R9)
  - Linux 는 `xvfb-run` 으로 headless Electron
- [ ] `e2e/playwright.config.ts` 확장: `projects` 에 OS 별 환경 변수 (path separator, font fallback) 분기
- [ ] `e2e/autonomy-queue-flow.spec.ts` (R9-Task12) 수정: Step C (Circuit Breaker downgrade) 의 mock breaker 주입 wiring 활성 (`window.__rolestraDevHooks.tripFilesPerTurn(21)` 같은 debug hook — main 에 dev only 노출)
- [ ] `src/main/index.ts` 수정: NODE_ENV='test' 또는 `ROLESTRA_E2E=1` 일 때만 `__rolestraDevHooks` 노출 (production code path 0 영향)
- [ ] `e2e/{external-project,messenger,meeting,approval,member-profile,autonomy-queue,search,dm,settings-tabs}-flow.spec.ts` — OS matrix 에서 모두 green (실 실행 결과는 R10 closeout 시 캡처)
- [ ] 6 테마 스크린샷 증빙 (Task 7 의 `appendix-r10-evidence/`) Windows + macOS native 캡처 — Linux 는 폰트 fallback 으로 시각 차이 (별도 tracking)
- [ ] 커밋: `ci(rolestra): Playwright OS matrix activation — 9 spec 실 런 (R10-Task13)`

**AC**:
- GitHub Actions playwright.yml 등록
- 9 spec 모두 OS matrix 에서 green
- R4~R9 의 DONE_WITH_CONCERNS 부채 일괄 해소
- Step C (Circuit Breaker downgrade) 활성 — R9 placeholder 가 실제 실행
- 12 스크린샷 증빙 (Windows + macOS)

**Testing**: Playwright OS matrix run + 수동 시각 검토.

---

### Task 14 — R10 Closeout (정식 게이트 + done-checklist + §10 ✓ + tasks 16/16)

**목표**: 모든 정식 게이트 녹색. done-checklist 작성. spec §10 R10 ✓ 전환. tasks 16/16.

- [ ] 정식 게이트:
  - `npm run typecheck` exit 0
  - `npm run typecheck:web` exit 0
  - `npm run lint` exit 0 (errors) — pre-existing warnings 허용
  - `npm run test` — R10 touched domains (search / dm / settings / circuit-breaker-store / permission-flag-builder / member-profile-service stream / member-warmup-service / notification-service / approval-service / meeting-summary-service / use-* optimistic / ErrorBoundary) 전부 green
  - `npm run i18n:check` exit 0 (idempotent — Task 12)
  - `npm run theme:check` exit 0 (Task 7 의 hardcoded color 0)
  - `npm run build` exit 0
  - Playwright OS matrix (Task 13) green
- [ ] `docs/checklists/r10-done-checklist.md` 작성:
  - 16 task 산출물 맵
  - 게이트 결과표 (OS matrix 결과 포함)
  - Known Concerns (R11 인수인계 — legacy cleanup 만 남는 시점)
  - Decision Log D1~D10 요약
  - R11 forward pointers (3건만 — v2 engine 5 파일 + retro 영어 복귀 + 인스톨러 패키징)
- [ ] spec §10 R10 블록: `[ ]` → `[x]` 전환
- [ ] tasks.json 16/16 status='completed'
- [ ] 커밋: `chore(rolestra): R10 closeout — done-checklist + tasks 16/16 (R10-Task14)`

**AC**:
- 정식 게이트 전체 녹색 (특히 Playwright OS matrix — R10 의 핵심 acceptance)
- r10-done-checklist.md 작성
- §10 R10 모든 ✓
- tasks.json 16/16 completed

**Testing**: 전 게이트 스위트 + OS matrix.

---

## Decision Log (D1~D10)

**D1 — DM 데이터 모델 — 기존 channels 테이블 확장 (별도 dm_sessions 테이블 미도입)**
- 결정: DM 은 R2 시점 land 된 `channels.kind='dm'` + `channels.project_id IS NULL` + `idx_dm_unique_per_provider` 위에서 그대로 운영. 별도 `dm_sessions` 테이블 만들지 않음.
- 이유: (i) 이미 데이터 모델이 완성되어 있고 사용자 노출만 빠진 상태, (ii) DM 의 기능 확장 (read receipt / typing indicator 등) 은 V4, R10 범위는 "최소 기능 노출" 만, (iii) 별도 테이블로 가면 message FK / channel FK 가 둘로 갈라짐 — 검색 / 알림 / approval 의 모든 cross-cutting concerns 가 두 곳을 각각 처리해야 함.
- 대안: 신규 `dm_sessions` 테이블 + 별도 message FK — 각하.

**D2 — MessageSearch UI — 모달 (사이드 패널 미채택)**
- 결정: MessageSearchView 는 Radix Dialog modal. 사이드 패널 (Slack 스타일) 미채택.
- 이유: (i) Rolestra 는 "사무실 메타포" — 검색은 일상이 아니라 occasional action, (ii) 모달이 focus trap + Esc 닫기 + Cmd/Ctrl+K shortcut 패턴에 자연스럽고 1.5px clip-path 같은 6 테마 형태 분기가 잘 맞음, (iii) 사이드 패널은 메인 메시지 흐름과 시각 충돌.
- 대안: 사이드 패널 — V4 검토.

**D3 — 설정 UI 10탭 — Radix Tabs (수직 sidebar nav 미채택)**
- 결정: SettingsTabs 는 horizontal Radix Tabs. macOS Preferences 스타일의 sidebar navigation 미채택.
- 이유: (i) 6 테마 형태 분기 (panelClip / cardTitleStyle) 가 horizontal tabs 에 자연스럽고 retro 의 ASCII 헤더 / tactical 의 12분절 progress 같은 시각 분기가 잘 wire, (ii) Electron 앱 width 가 제한적 — sidebar 를 더 빼면 콘텐츠 영역 좁아짐, (iii) 10 탭 = 모바일도 horizontal 가 일반적.
- 대안: vertical sidebar — 각하.

**D4 — 6 테마 fidelity 전략 — 형태 토큰 정식 wire (R10 에서 sign-off, R11 으로 안 미룸)**
- 결정: 메모리 `rolestra-design-fidelity-gap.md` (R4 시점 메모) 의 "themeKey 형태-레벨 분기" 를 R10 에서 종결. R11 (레거시 청소) 으로 미루지 않음.
- 이유: (i) R10 이 "다듬기" phase — 디자인 sign-off 가 본질, (ii) R11 은 패키징 + retro 영어 복귀만 — 디자인 변경은 risky (regression), (iii) Task 7 의 12 스크린샷 증빙이 R10 closeout 의 acceptance.
- 대안: R11 으로 이연 — 각하 (R11 이 무거워짐).

**D5 — Playwright CI matrix — GitHub Actions 표준 (self-hosted runner 미사용)**
- 결정: Windows + macOS + Linux matrix 는 GitHub Actions 표준 hosted runner. self-hosted 미도입.
- 이유: (i) E2E spec 들이 이미 mock provider 사용 — API 키 없는 hosted runner 에서도 충분, (ii) self-hosted 는 OSS 프로젝트 부담 큼, (iii) Linux 의 Electron 은 `xvfb-run` headless 로 cover, (iv) macOS hosted runner 가 minutes 비싸지만 weekly cron 으로 비용 cap 가능.
- 대안: self-hosted Windows 머신 — 향후 검토.

**D6 — Circuit Breaker persistence schema — `(project_id, tripwire) → counter` 4 row per project**
- 결정: 신규 테이블 `circuit_breaker_state` 가 `PRIMARY KEY (project_id, tripwire)` 의 좁은 schema. project 당 정확히 4 row.
- 이유: (i) 4 tripwire 가 enum 으로 고정 — 정규화 OK, (ii) ON CASCADE DELETE 가 project 삭제와 자동 동기화, (iii) flush debounce 1s 로 write 부하 미미, (iv) hydrate 는 project 별 단일 SELECT.
- 대안: row 당 event log (append-only) — 각하 (notification_log 와 다름, counter 는 state 관점이 자연).

**D7 — LLM 요약 provider 선정 — capability 'summarize' fallback chain (사용자 명시 선택 미도입)**
- 결정: `MeetingSummaryService.summarize(meetingId, providerId?)` 가 providerId 명시 안 하면 'summarize' capability true 인 첫 provider 로 fallback chain. 사용자 UI 에서 명시 선택은 R10 settings AutonomyDefaultsTab 에 토글만 (auto / off). 회의별 provider 선택은 미도입.
- 이유: (i) "다듬기" phase 는 최소 기능, (ii) provider capability 시스템이 R6 에서 이미 land — fallback chain 자연, (iii) 사용자 UX 부담 없음 (회의 끝나면 자동 1단락).
- 대안: 회의별 provider drop-down — V4.

**D8 — Optimistic UI scope — 3 hook (메시지 전송 / autonomy 토글 / queue 추가) 만**
- 결정: optimistic 적용은 3 hook 으로 제한. R7 의 ApprovalBlock decide / R8 의 MemberProfile edit 등은 R11 이후.
- 이유: (i) 위 3 흐름이 latency 가 가장 frequent visible, (ii) decide / edit 등은 사용자 부담 큰 mutation — server confirmation 이 자연, (iii) optimistic + rollback 패턴은 ErrorBoundary 결합 필요 — R10 Task 8 에서 ErrorBoundary 함께 도입, scope creep 방지.
- 대안: 모든 mutation optimistic — 각하 (regression risk).

**D9 — `stream:member-status-changed` — invalidation 패턴과 공존 (replace 안 함)**
- 결정: stream broadcast 는 R8 의 mutation 후 invalidation 위에 추가 layer. invalidation 제거 안 함.
- 이유: (i) stream 이 누락된 경우에도 invalidation 으로 fallback, (ii) Task 10 의 회귀 risk 최소화, (iii) R9 의 stream 패턴 (autonomy / queue / notification-prefs) 모두 동일 — invalidation + stream 공존이 R3~R9 의 일관 패턴.
- 대안: invalidation 제거 — 각하.

**D10 — 신규 마이그레이션 1건만 허용 (012 circuit_breaker_state)**
- 결정: R10 은 신규 마이그레이션 0건이 원칙이지만 Circuit Breaker persistence (Task 9) 만 예외. 011 까지의 R2 chain 은 forward-only 유지.
- 이유: (i) R9 Known Concerns #2 가 명확히 persistence 요구, (ii) in-memory 만으로는 R10 이후 R11 패키징 시 사용자 신뢰 부족, (iii) DM / 검색 / 설정 / 6 테마 / E2E 등 다른 모든 task 는 신규 테이블 0 — 기존 모델 위에서 UI/IPC/wire 만.
- 대안: R11 으로 이연 — 각하 (R11 이 무거워지고 사용자 신뢰 issue).

---

## Test Strategy

### 정식 게이트 (R10 Closeout — Task 14)

| 게이트 | 명령 | 기대 결과 |
|--------|------|----------|
| typecheck (node + web) | `npm run typecheck && npm run typecheck:web` | exit 0 (R9 baseline 유지) |
| lint | `npm run lint` | 0 errors (warnings 는 pre-existing 만) |
| test (Vitest) | `npm run test` | R10 touched 30+ test files green (R10 신규 80+ tests + R9 회귀 0) |
| i18n:check | `npm run i18n:check` (`npx i18next-parser` 2회) | idempotent (두 번째 실행 diff 0), ko/en parity orphan 0 |
| theme:check | `npm run theme:check` | exit 0 (hardcoded color 0 — Task 7 신규 surface 포함) |
| build | `npm run build` | exit 0 (main + preload + renderer chunk size 보고) |
| migration | `npx vitest run src/main/database/__tests__/migrations.test.ts` | 012 up + idempotent + down green |
| Playwright OS matrix | `.github/workflows/playwright.yml` | 9 spec × 3 OS = 27 matrix cell green (Task 13) |

### CI matrix 활성화 (Task 13)

- GitHub Actions `playwright.yml` 신규 — Windows + macOS + Linux
- 9 E2E spec: external-project / messenger / meeting / approval / member-profile / autonomy-queue / search / dm / settings-tabs
- API 키 없는 환경은 mock provider fixture 사용 (R4~R9 패턴 reuse)
- Linux 는 xvfb-run + Electron headless

### 단위 테스트 분포 (예측)

- shared: ipc-schemas (+15 R10), stream-events (+1 member-status payload)
- main: permission-flag-builder (33), circuit-breaker-store (8), circuit-breaker (확장 +6), member-profile-service (확장 +4), member-warmup-service (확장 +4), notification-service (확장 +5), approval-service (확장 +4), meeting-summary-service (6), channel-service (확장 +4 createDm)
- renderer: MessageSearchView (8), use-message-search (6), DmListView (6), DmCreateModal (6), use-dms (6), CircuitBreakerApprovalRow (6), SettingsTabs (8), 10 tab × 5 = 50, ErrorBoundary (4), use-channel-messages (확장 +6), use-autonomy-mode (확장 +4), use-queue (확장 +4), use-dashboard-kpis (확장 +4), use-member-status-stream (5), theme-shape-tokens (30)

총 R10 신규/확장 약 250 cases, 회귀 0 baseline 유지.

---

## i18n 체크리스트

- [ ] 신규 namespace populate (ko + en):
  - `message.search.{title, placeholder, empty, error, shortcutHint, filter.allChannels, filter.currentChannel, filter.currentProject}` (8)
  - `dm.{listTitle, newDm, providerSelect, alreadyExists, meetingDisabled, empty}` (6)
  - `settings.{members, notifications, autonomyDefaults, apiKeys, theme, language, path, cli, security, about}.{tabLabel, sectionTitle, description, ...}` (10 탭 × 5+ 키 = 50+)
  - `approval.circuitBreaker.{rowTitle, tripwireFilesPerTurn, tripwireCumulativeCliMs, tripwireQueueStreak, tripwireSameError, resumeButton, keepManualButton, detail.template}` (8)
  - `messenger.composer.error.{send, sendRetry, autonomySwap, queueAdd}` (4)
  - `meeting.summary.{header, fallback, providerNote}` (3)
  - `error.boundary.{title, body, reload}` (3)
- [ ] 잔여 main-process 한국어 고정 라벨 → `notification-labels.ts` dictionary 이전:
  - `notification.approvalPending.*` (R7 deferred — 4+ 라벨)
  - 기타 main-process inline 한국어 grep 후 일괄 이전
- [ ] R3~R9 의 ko 만 있던 키 — en 일괄 populate (orphan 0)
- [ ] `i18next-parser.config.js` keepRemoved regex 확장 (R10 신규 namespace)
- [ ] `npm run i18n:check` idempotent (두 번째 실행 diff 0)
- [ ] `setNotificationLocale` settings LanguageTab wire (D8 잔재 종결)

---

## Risks / Open Questions

### Risks

1. **신규 마이그레이션 012 의 회귀 risk** — 011 까지의 forward-only chain 에 추가하는 첫 R10 마이그레이션. idempotent 보장 + 마이그레이션 통합 테스트 필수.
2. **Playwright OS matrix CI minutes 비용** — macOS hosted runner 가 비용 큼. weekly cron + PR 별 trigger 분리 검토 (R10 closeout 후 cost monitoring).
3. **6 테마 sign-off 의 시각 회귀** — Task 7 의 형태 토큰 wire 가 R4~R9 surface 의 시각 변화 유발 가능. 12 스크린샷 증빙 + 사용자 sign-off 필수.
4. **Optimistic UI 의 race condition** — IPC race / stream race 가 임시 row 와 server-issued row 의 swap 시 발생 가능. Task 8 의 reducer 로직에 ordering invariant 보장 필요.
5. **PermissionFlagBuilder 통합으로 인한 cli-runner 회귀** — Task 5 가 기존 inline 플래그 build 코드를 builder 호출로 교체 — 회귀 0 보장 위해 spawn arg snapshot 테스트 필수.
6. **LLM 요약의 provider capability 가짜 양성** — Task 11 의 fallback chain 이 capability false 인 provider 까지 시도하면 호출 비용. capability strict false 만 skip (mock provider 에서 명시).

### Open Questions

1. **Settings 보안 탭의 "위험한 자율 모드" opt-in 토글의 default** — 항상 false 인지, 첫 부팅 user 안내 banner 필요한지. R10 Task 6 에서 default false + banner 0, 사용자가 명시적으로 토글해야 활성. R11 사용자 onboarding 설계 시 재검토.
2. **Settings 멤버 탭 풀버전의 "삭제" semantics** — `provider:delete` 가 hard DELETE 인지 soft (status='archived') 인지. R8 D 흐름 미결. R10 Task 6 에서 일단 hard DELETE + ON CASCADE 로 channels.kind='dm' 의 idx_dm_unique_per_provider 도 정리. 사용자 데이터 손실 risk — confirmation dialog 필수.
3. **LLM 요약의 모델 비용** — 회의 길이 × token 비용. R10 default 는 auto, 사용자가 SettingsTabs.AutonomyDefaultsTab 에서 off 가능. 비용 가시화 (요약 생성 시 token count audit log) 는 R11.
4. **CI matrix 의 macOS dmg sign 부재** — R11 packaging 시 unsigned dmg + Gatekeeper 우회 안내 (spec §7.9). R10 의 macOS Playwright 는 unsigned binary 로 실행 가능 — 단, 첫 실행 시 사용자 prompt 가 CI 에서 어떻게 처리되는지 확인 필요.

---

## Session Breakdown

R10 은 16 task (Task 0 + Task 1~14 + 다소의 reordering 으로 14 implementation slot). R9 가 14 tasks 에 4 sessions 였으니 R10 은 4~5 sessions.

### Session 1 — 진입 + shared + 검색 + DM (Task 0~3)

- Task 0: brand + spec + plan + tasks.json
- Task 1: shared types + 5 IPC + member-status stream
- Task 2: MessageSearchView + use-message-search + ShellTopBar
- Task 3: DM 정식 (DmListView + DmCreateModal + Thread 분기)

### Session 2 — Approval / Permission / Settings (Task 4~6)

- Task 4: Queue meetingStarter production + CircuitBreaker approval UI
- Task 5: PermissionFlagBuilder 매트릭스 통합
- Task 6: Settings UI 10탭 재구성 (가장 큰 task — 10 tab 컴포넌트)

### Session 3 — Theme / Optimistic / Persistence / Streams (Task 7~10)

- Task 7: 6 테마 형태-레벨 분기 정식 wire (디자인 sign-off)
- Task 8: Optimistic UI + ErrorBoundary
- Task 9: Circuit Breaker persistence (012 마이그레이션)
- Task 10: member-status-changed broadcast + warmup disable + macOS focus gate

### Session 4 — Deferred 정리 + i18n + CI matrix (Task 11~13)

- Task 11: consensus rehydrate + KPI stream + mode_transition conditional + LLM summary
- Task 12: i18n 완성 ko/en parity + setNotificationLocale wire
- Task 13: Playwright OS matrix CI 활성화 + 9 spec 실 런

### Session 5 — Closeout (Task 14)

- 정식 게이트 전체 녹색
- r10-done-checklist.md 작성
- spec §10 R10 ✓ 전환
- tasks.json 16/16 completed
- 사용자 시각 sign-off (12 스크린샷)

---

## Known Concerns (R11 인수인계 — TBD 후 done-checklist 에 기록)

- (R10 진행 중 발생하면 각 Task 내 주석 + 마지막 Task 14 closeout 시점에 done-checklist 에 정리)
- 초기 예상 (R11 으로 이연):
  - v2 engine 5 파일 + `engine/persona-builder.ts` 물리 삭제 (R8 D1 + R10 closeout 잔재)
  - 7 legacy `@ts-nocheck` 파일 청소
  - retro 영어 복귀 결정 (R8 D8)
  - Windows 인스톨러 + macOS dmg + Linux AppImage 패키징 (spec §7.9)
  - LLM 요약 비용 가시화 (D7 open question)
  - CI matrix macOS hosted runner 비용 monitoring (D5 risk)
  - 사용자 onboarding 흐름 + 첫 부팅 wizard (R10 SettingsTabs 의 보안 탭 toggle 안내 등)

---

(이 plan 은 R10 세션 중 구현 진행에 따라 각 Task 의 `[ ]` 를 `[x]` 로 갱신하며 진화한다. Task 14 의 done-checklist 에 최종 산출물 + Known Concerns 를 정리한다.)
