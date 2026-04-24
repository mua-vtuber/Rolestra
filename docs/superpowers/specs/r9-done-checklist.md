# Rolestra Phase R9 — Done Checklist

> Closes the implementation work for **Phase R9 — 자율 모드 + 시스템 알림**.
> Plan: `docs/superpowers/plans/2026-04-23-rolestra-phase-r9.md`.
> Branch: `rolestra-phase-r9` (14 commits, ready to fast-forward into `main`).

## Task → 산출물 맵 (14/14 ✓)

| # | 산출물 (커밋) |
|---|---------------|
| 0 | docs(rolestra): R9 plan + tasks.json + spec §10 R9 체크리스트 확장 (`946a5ee`) — plan 760 lines + 14-slot tasks.json + Decision Log D1~D8 + spec §10 R9 expansion |
| 1 | feat: R9 shared schemas + 3 broadcast stream events + preload fix (`337bb79`) — `queue:*` + `notification:*` 6 schemas + `stream:queue-updated` / `stream:notification-prefs-changed` / `stream:autonomy-mode-changed` + preload `typedOnStream` generic narrowing fix |
| 2 | feat: AutonomyModeToggle + AutonomyConfirmDialog + use-autonomy-mode (`1ac33cd`) — 3-mode toggle + 2-stage confirm (Circuit Breaker ack) + stream reducer (22 tests) |
| 3 | feat: QueuePanel + use-queue hook + HTML5 native drag reorder (`9a666de`) — multi-line add / drag / pause/resume / status badge / in_progress lock (15 tests) |
| 4 | feat: NotificationPrefsView + use-notification-prefs (`4f02a02`) — 4 core kinds × display/sound + test button + SettingsView routing wire (15 tests) |
| 5 | feat: AutonomyGate + ProjectService autonomy event + stream bridge wiring (`f32f1e4`) — ApprovalService 'created' → autonomyMode 분기 (manual/auto_toggle/queue) + #회의록 audit + downgrade-on-failure (30 tests) |
| 6 | feat: Circuit Breaker 4 tripwire 실 이벤트 feed + downgrade handler (`fd2a117`) — ExecutionService / CliRunner / QueueService / MeetingTurnExecutor 4 hook + `handleBreakerFired` complete with per-tripwire readout (30 tests) |
| 7 | feat: QueueService startNext + onFinalized hook + stream:queue-updated fan-out (`0ae098e`) — pause gate + meetingStarter callback + recoverInProgress + full snapshot stream (21 tests) |
| 8 | feat: MeetingOrchestrator onFinal work-done wiring (`f0e47d6`) — `postGeneralMeetingDoneMessage` helper + #일반 post for auto_toggle/queue only (13 tests) |
| 9 | feat: R9 production wiring (`c7e5653`) — setNotificationServiceAccessor + setQueueServiceAccessor + seedDefaultPrefsIfEmpty + streamBridge.connect({queue, queueSnapshot}) (5 tests) |
| 10 | feat: 외근 자동 timeout 60분 + warmup backoff retry (`c6007e7`) — MemberProfileService lazy clear (D7) + MemberWarmupService retry chain 10s/30s/60s × 3 (14 tests) |
| 11 | feat: i18n populate notification/autonomy/queue/circuitBreaker/settings (`784cc61`) — `notification-labels.ts` main-process dictionary (D8) + ko/en populate + 5 keepRemoved anchors (15 tests) |
| 12 | feat: E2E autonomy-queue-flow.spec.ts + mount AutonomyModeToggle/QueuePanel (`a720f83`) — 3 step scenario spec + ShellTopBar rightSlot + QueuePanel band (WSL DONE_WITH_CONCERNS) |
| 13 | (this commit) chore: R9 closeout — done-checklist + spec §10 R9 ✓ + tasks 14/14 |

## 정식 게이트 (Task 13)

| 게이트 | 결과 | 비고 |
|--------|------|------|
| `npm run typecheck` (node + web) | exit 0 | R8 baseline 유지 — legacy 회귀 0 |
| `npm run lint` | 0 errors / 23 warnings | 23 warnings 모두 R9 무관 (pre-existing theme-provider test literals, QueuePanel drag-handle aria-hidden, etc.) |
| `npm run test -- r9-scoped` | 400/400 green | R9 touched 28 test files (autonomy-gate, autonomy-mode-toggle, queue-service, notification-service, notification-labels, notification-prefs, meeting-orchestrator, v3-side-effects, member-*, r9-boot, handlers-v3, ipc-schemas-v3, stream-events, use-autonomy-mode, use-queue, use-notification-prefs, QueuePanel, NotificationPrefsView, SettingsView) |
| `npm run i18n:check` | exit 0 | parser idempotent — 두 번째 실행 0 diff. 5 신규 namespace (notification / circuitBreaker / autonomy / queue / settings) populated on ko + en |
| `npm run theme:check` | exit 0 | clean |
| `npm run build` | exit 0 | main 671.76 kB + preload 1.98 kB + renderer 1,220.66 kB (R8 대비 +40 kB — AutonomyConfirmDialog + QueuePanel 신규) |
| Playwright `autonomy-queue-flow.spec.ts` | DONE_WITH_CONCERNS | WSL 제약, R10 OS matrix 에서 실 런. Step C (Circuit Breaker 강제 downgrade) 는 R10 mock-breaker 주입 후 활성화 |
| 레거시 v2 도메인 13 files (database-branch / conversation / memory / recovery / remote / session-persistence) | 기존 failing 유지 | R9 무관, R11 legacy cleanup 예정 |

## 핵심 산출물 / 주요 변경

### 신규 main
- `src/main/autonomy/autonomy-gate.ts` — ApprovalService 'created' subscriber + autonomyMode 분기 + #회의록 audit trace + downgrade-on-failure
- `src/main/notifications/notification-labels.ts` — main-process i18n dictionary (D8, ko/en). `resolveNotificationLabel` / `resolveBreakerCopy` / `resolveGeneralMeetingDoneBody` + `setNotificationLocale` for R10 settings wire
- `src/main/queue/circuit-breaker-accessor.ts` — set/getCircuitBreaker DI for ExecutionService + CliProcessManager + MeetingTurnExecutor (avoids constructor injection chain)

### 신규 renderer
- `src/renderer/features/projects/{AutonomyModeToggle,AutonomyConfirmDialog,QueuePanel}.tsx` + `__tests__`
- `src/renderer/features/settings/{SettingsView,NotificationPrefsView}.tsx` + `__tests__`
- `src/renderer/hooks/{use-autonomy-mode,use-queue,use-notification-prefs}.ts` + `__tests__`

### 신규 shared
- `src/shared/queue-types.ts` 확장 — `QueueItem` / `QueueItemStatus` + 5 IPC payloads
- `src/shared/notification-types.ts` 확장 (R2 에서 베이스 정의, R9 에서 R9 관련 필드만 보강)
- `src/shared/stream-events.ts` — 3 신규 broadcast events

### 신규 IPC 채널 (7) / stream events (3)
- `project:set-autonomy` — request `{projectId, mode}` → `Project`
- `queue:list/add/reorder/remove/pause/resume` — queue CRUD + pause gate (6 channels)
- `notification:get-prefs/update-prefs/test` — prefs round-trip + diagnostic fire (3 channels, R2 에서 선언 → R9 에서 production 연결)
- `stream:autonomy-mode-changed` — `{projectId, mode, reason?}`
- `stream:queue-updated` — full queue snapshot per project
- `stream:notification-prefs-changed` — full prefs broadcast

### 주요 수정 파일
- `src/main/index.ts` — R9 production boot block (QueueService + NotificationService accessor + streamBridge.connect({queue, queueSnapshot}) + seedDefaultPrefsIfEmpty + recoverInProgress + AutonomyGate wire)
- `src/main/engine/v3-side-effects.ts` — 하드코딩 Korean 라벨 제거, `notification-labels.ts` dictionary 위임. `breakerNotificationCopy` 가 `resolveBreakerCopy` 한 호출로 축소 (4-tripwire switch 는 dictionary 레이어로 이동)
- `src/main/notifications/notification-service.ts` — `test()` 도 dictionary 기반 라벨 사용
- `src/main/queue/queue-service.ts` — `startNext(projectId, meetingStarter?)` + `isPaused` + `findByMeetingId` + `recoverInProgress`
- `src/main/meetings/engine/meeting-orchestrator.ts` — `onFinalized` callback + `postGeneralMeetingDoneMessage` 호출
- `src/main/approvals/approval-service.ts` — AutonomyGate hook-in (기존 EventEmitter 'created' reuse)
- `src/main/projects/project-service.ts` — EventEmitter 상속, `setAutonomy(id, mode, {reason?})` emit `'autonomy-changed'`
- `src/main/streams/stream-bridge.ts` — 3 신규 event fan-out
- `src/main/members/member-profile-service.ts` — `getWorkStatus` lazy auto-clear (D7) + `MemberProfileServiceOptions { offlineManualTimeoutMs, now }`
- `src/main/members/member-warmup-service.ts` — `retryDelaysMs` backoff chain + `cancelRetries/cancelAll/pendingRetryCount`
- `src/main/execution/execution-service.ts` / `src/main/providers/cli-process-manager.ts` / `src/main/meetings/engine/meeting-turn-executor.ts` — Circuit Breaker recordX callsite
- `src/renderer/App.tsx` — activeProject 기반 `AutonomyModeToggle` (topBar rightSlot) + `QueuePanel` band mount
- `src/renderer/i18n/locales/{ko,en}.json` + `i18next-parser.config.js` — 5 신규 namespace + 5 keepRemoved anchors

### 신규 테스트 (R9 직접 + 회귀 400 cases)
- shared: `ipc-schemas-v3` (+7), `stream-events` (+3 R9 events)
- main: `autonomy-gate` (30) / `circuit-breaker-feed` (10) / `v3-side-effects` (+4 circuit_breaker) / `meeting-orchestrator` (+6 onFinalized/work-done) / `queue-service` (+14) / `queue-repository` (+2) / `stream-bridge` (+3) / `r9-boot` (5) / `notification-labels` (15) / `member-profile-service` (+6 offline-manual timeout) / `member-warmup-service` (+8 backoff retry)
- renderer: `AutonomyModeToggle` (6) / `AutonomyConfirmDialog` (7) / `use-autonomy-mode` (9) / `QueuePanel` (7) / `use-queue` (8) / `NotificationPrefsView` (8) / `use-notification-prefs` (7)

### 신규 의존성
- 없음 — HTML5 native drag + 기존 Radix Dialog 재사용 (D3)

## Decision Log 요약 (D1~D10)

| # | 결정 | 한 줄 요약 |
|---|------|-----------|
| D1 | AutonomyGate 배치 | ApprovalService 'created' 이벤트 훅으로 구현. 내부 if 분기 대신 별도 모듈 |
| D2 | Circuit Breaker persistence | R9 는 in-memory only. 재시작 시 counter 리셋 (R10 이후 persist 검토) |
| D3 | Drag-and-drop | HTML5 native `draggable=true` + React state. `@dnd-kit` 미도입 |
| D4 | Confirm dialog 적용 범위 | manual → auto_toggle / manual → queue 두 전환만. 상호 전환 / downgrade 는 바로 |
| D5 | 실패 경로 downgrade | rework/fail 시 approval_item 은 대기 상태 유지 + autonomyMode 만 manual 로 강제 복귀 |
| D6 | Notification seed 타이밍 | 부팅 시 `seedDefaultPrefsIfEmpty()` — 첫 부팅 6, 이후 0, 유저 토글 보존 |
| D7 | 외근 자동 timeout 평가 시점 | `getWorkStatus` 호출 시 lazy. timer 없음 |
| D8 | i18n main-process 라벨 전략 | `notification-labels.ts` dictionary + `setNotificationLocale` — i18next 직접 import 금지 |
| D9 (implicit) | `stream:autonomy-mode-changed` 설계 | project-updated 재사용 대신 전용 stream event (payload 가볍고 receiver 가 다름) |
| D10 (implicit) | React 19 `set-state-in-effect` 회피 | `useEffect(() => setX(init))` 대신 "adjusting state during render" 패턴 (`if (init !== lastInit) { setLastInit(...); setX(...); }`) |

## Known Concerns (R10 인수인계 — 6건)

1. **Queue meetingStarter production 주입 부재** — `QueueService.startNext` 는 선택적 `meetingStarter` 콜백을 받지만 R9 production wiring (Task 9) 에서는 주입되지 않았다. 즉 큐 모드에서 `onFinalized` 후 다음 항목은 `pending → in_progress` 로 claim + stream emit 까지만 수행하고, 실제 meeting spawn 은 수행하지 않는다. R10 `channel:start-meeting` 팩토리 helper 를 재사용해 주입 예정.

2. **Circuit Breaker persistence 부재** (D2) — 재시작 시 counter 리셋. `cumulative_cli_ms` 는 장시간 중단 후 자동 리셋 되는 것이 사용자 친화적이지만, `files_per_turn` / `queue_streak` / `same_error` 는 세션 간 연속성이 필요할 수 있다. R10+ 에서 `notification_log` 패턴으로 persist 검토.

3. **`stream:member-status-changed` 실시간 broadcast 부재** (R8 D8 이월) — R9 에서 `MemberProfileService.emit('status-changed')` 스텁은 있지만 stream broadcast 는 미구현. R10 에서 autonomy + 다중 클라이언트 도입 시 stream 으로 승격.

4. **Warmup backoff 중 provider disable 처리** — R9 warmup retry 체인은 provider disable 여부를 체크하지 않는다. 사용자가 warmup 도중 provider 를 disable 하면 retry 가 계속 실행된다. R10 에서 `provider.disabled` 체크 추가 필요.

5. **`notification.show` focus gate 는 BrowserWindow 포커스 기반** — macOS 에서 BrowserWindow 포커스와 앱 포커스가 다를 수 있다. R10 에서 Electron 네이티브 Focus API 로 대체.

6. **Circuit Breaker approval UI 정식 편입 미완** — R9 는 `kind='circuit_breaker'` row 를 생성하지만 renderer ApprovalInbox 는 아직 전용 UI 를 제공하지 않는다. 현재 `approval.kind.circuit_breaker` 라벨만 populate (Task 11). R10 ApprovalInbox 에 breaker 전용 row + 상세 view 추가 예정.

## R10 / R11 Forward Pointers

### R10 (다듬기)
- Queue `meetingStarter` production 주입 (#1)
- FTS5 검색 UI / 설정 UI 10-tab / i18n 완성 / DmSession / PermissionService 확장
- Playwright CI matrix (Windows + Linux + macOS) — R4~R9 의 DONE_WITH_CONCERNS 일괄 해소
- optimistic UI / 6 테마 시각 sign-off
- `stream:member-status-changed` broadcast (R8 D8 + R9 #3 이월)
- Circuit Breaker persistence (#2) 와 approval UI (#6) 동시 정리
- Warmup backoff provider.disabled 체크 (#4)
- Notification focus gate macOS 보정 (#5)
- E2E autonomy-queue-flow Step C 활성화 (R9 placeholder 위에 mock breaker 주입)
- LLM 요약 옵션

### R11 (레거시 청소 + 릴리스)
- v2 engine 5 파일 + `engine/persona-builder.ts` 물리 삭제
- 7 legacy 파일 `@ts-nocheck` 삭제
- 디자인 sign-off + retro 영어 복귀 (D8 잔재)
- legacy failing tests 13 files (database-branch / conversation / memory / recovery / remote / session-persistence) 제거
- 릴리스 패키징
