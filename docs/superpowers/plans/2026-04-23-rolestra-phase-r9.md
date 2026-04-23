# Rolestra Phase R9 — 자율 모드 + 시스템 알림 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** R8 까지 멤버 프로필/출근 상태 축이 닫힌 상태 위에, **프로젝트의 자율 운영 축**(manual ↔ auto_toggle ↔ queue)과 **OS 시스템 알림 축**(4 kind × prefs × 포커스 게이트)을 동시에 켠다. R9 종료 시 앱에서 (a) 사용자가 프로젝트 헤더의 `AutonomyModeToggle` 로 세 가지 모드를 전환할 수 있고 manual → auto_toggle/queue 승격 시 2단계 확인 다이얼로그(`AutonomyConfirmDialog`)가 Circuit Breaker 4 tripwire(`files_per_turn`/`cumulative_cli_ms`/`queue_streak`/`same_error`)의 기본 한계값을 안내하며 명시적 재확인 체크박스를 강제, (b) 프로젝트 상단의 `QueuePanel` 에서 여러 줄 입력으로 할 일을 쌓고 순서 변경/일시정지/제거 가능, queue 모드일 때는 직전 회의 `onFinal` 직후 `QueueService.startNext()` 가 자동으로 다음 항목을 꺼내 새 회의를 킵(연속 5개 기본 한계 — Circuit Breaker `queue_streak` tripwire), (c) `AutonomyGate` 가 `ApprovalService.create` 시점에 프로젝트의 `autonomyMode` 를 읽어 `auto_toggle`/`queue` 에서는 spec §8 의 accepted 조건(`mode_transition.target ∈ {auto,hybrid}` / `consensus_decision.outcome='accepted'`)만 자동 `decide('accepted')` 처리하고 나머지(`review_outcome=rework/fail` 등)는 강제 `manual` 다운그레이드, (d) `CircuitBreaker` 의 4 tripwire 가 `ExecutionService.dryRunApply` / `CliRunner.spawn` / `QueueService.startNext` / `MeetingTurnExecutor` + `ApprovalService` 의 실 이벤트 소스에 hook 되어 한계 초과 시 `on('fired')` 이벤트로 자동 다운그레이드 + `approval_item(category='circuit_breaker')` 생성 + `NotificationService.show('error', { reason })` 발사, (e) `MeetingOrchestrator.onFinal` 이벤트로 `#회의록` 채널에 요약 자동 포스팅 + `NotificationService.show('work_done')` + `auto_toggle`/`queue` 에서는 `#일반` 채널에 완료 system message, (f) 설정 화면의 `NotificationPrefsView` 에서 4 kind(`new_message`/`approval_pending`/`work_done`/`error`) × 표시 on/off + 소리 on/off 개별 관리 + 테스트 알림 버튼, (g) R2 에서 뼈대만 land 되어 있던 `NotificationService` + `QueueService` + `CircuitBreaker` 세 서비스가 production `main/index.ts` 에서 accessor 등록 + `streamBridge.connect({ queue })` 추가 + `NotificationPrefsRepository` 기본값 seed 로 **비로소 프로덕션에서 IPC throw 0 으로 활성화**(R8 Task 8 과 동일한 "wire up 부채 해소" 패턴), (h) R8 인수인계 6건 중 자율 모드와 자연 통합되는 2건 — 외근 자동 timeout(`offline-manual` 60분 후 `online` 자동 복귀, settings 조정 가능) + `MemberWarmupService` backoff 재시도(10s → 30s → 60s 지수, 최대 3회) — 가 main 서비스에 이식, (i) `stream:autonomy-mode-changed` / `stream:queue-updated` / `stream:notification-prefs-changed` 3 broadcast stream 이벤트로 다중 surface 실시간 동기화(R7 ApprovalService stream 패턴 재사용).

**Overview (자연어, 비코더용):**

- R2 시점에 이미 `src/main/notifications/{notification-service,notification-repository,electron-notifier-adapter}.ts` + `src/main/queue/{queue-service,queue-repository,circuit-breaker}.ts` + migrations 007(queue) + 011(notifications) 가 land 되어 있고, R6-Task4 에서 `MeetingOrchestrator` 가 DI 로 `notificationService` + `circuitBreaker` 를 이미 받고, R7-Task11 에서 `ApprovalNotificationBridge` 가 `ApprovalService 'created'` → `NotificationService.show(approval_pending)` 를 wire 했다. **창고와 배선은 거의 다 되어 있는데 스위치와 UI 가 빠져 있다.** R9 가 (a) 스위치(autonomy toggle / queue panel / notification prefs UI 3종), (b) 실 이벤트 소스와 CircuitBreaker 의 연결, (c) `AutonomyGate` 라는 새 분기 로직, (d) main/index.ts 에 `setNotificationServiceAccessor` + `setQueueServiceAccessor` + `streamBridge.connect({ queue })` 라는 production wire up 을 추가해 완성한다.
- 가장 큰 부채는 R8 Task 8 과 **정확히 동일한 패턴**이다. `notification-handler` 의 `setNotificationServiceAccessor` 와 `queue-handler` 의 `setQueueServiceAccessor` 는 `src/main/ipc/__tests__/handlers-v3.test.ts` 에서만 호출되고 production `main/index.ts` 에서는 한 번도 호출되지 않는다. 현재 renderer 가 `notification:get-prefs` 또는 `queue:list` 를 invoke 하면 `'notification handler: service not initialized'` / `'queue handler: service not initialized'` 가 뜬다. R9 Task 9 가 이 끊어진 회로를 잇는다 — `NotificationRepository` + `NotificationService` + `QueueRepository` + `QueueService` 의 accessor 를 등록하고, `streamBridge.connect({ ..., queue: queueService })` 의 R6 주석(`// queue connect in R9`) 을 풀고, `NotificationPrefsRepository` 의 4 kind × `{display:true, sound:true}` 기본값을 최초 부팅 시 seed 한다.
- 두 번째 축은 **autonomy mode 의 실제 동작화**. 현재 `projects.autonomy_mode` 컬럼은 R2 에서 만들어졌고 `ProjectService.update` 는 autonomyMode 를 받지만 **그 값이 바뀌어도 시스템 동작은 아무것도 바뀌지 않는다**. `ApprovalService.create` 는 autonomyMode 를 전혀 보지 않고 모두 `approval_item` 으로 돌리고, `MeetingOrchestrator.onFinal` 은 autonomyMode 로 분기하지 않는다. R9 Task 5 의 `AutonomyGate` 가 spec §8 의 테이블을 그대로 코드로 옮긴다 — `manual`: 기존 흐름, `auto_toggle`: accepted 조건만 auto accept + `#회의록` audit trace + work_done notification, `queue`: auto_toggle 동일 + meeting onFinal 직후 `QueueService.startNext()` 자동. 실패 조건(`review_outcome=rework/fail`, CLI 실패, consensus 실패) 은 autonomyMode 를 `manual` 로 강제 다운그레이드 + `approval_item` + `error` notification.
- 세 번째 축은 **Circuit Breaker 의 실 이벤트 소스 연결**. 현재 `CircuitBreaker` 클래스는 independent — `recordFileChanges(n)` / `recordCliElapsed(ms)` / `recordQueueStart()` / `recordError(cat)` 를 노출하지만 아무도 호출하지 않는다. R9 Task 6 이 4 tripwire 각각의 실 이벤트 소스에 hook 을 추가한다: (i) `ExecutionService.dryRunApply` 직후 change set 의 파일 수를 `recordFileChanges`, (ii) `CliRunner.spawn` 완료 시 wall-clock elapsed 를 `recordCliElapsed`, (iii) `QueueService.startNext` 시 `recordQueueStart`, (iv) `MeetingTurnExecutor` / `ApprovalService` 의 fail 경로에서 error category 를 `recordError`. `on('fired')` handler 는 이미 `src/main/engine/v3-side-effects.ts` 에 스텁이 있고 (`CircuitBreaker.on('fired') → ProjectService.setAutonomy('manual')` 도표), R9 가 완성한다 — ProjectService.setAutonomy('manual') + approval_item(category='circuit_breaker', meta={tripwire, detail}) + notification.show('error', {reason}).
- 네 번째 축은 **Queue run loop 의 완성**. `QueueService.addItems` / `removeItem` / `reorder` / `pauseRun` 등은 R2 에서 구현됐지만 **auto-start next 가 어디서 트리거되는지** 가 명시되지 않았다. R9 Task 7 이 `MeetingOrchestrator.onFinal` 이벤트 경로에서 `autonomyMode === 'queue'` 일 때 `queueService.startNext(projectId)` 를 호출 — 다음 pending 항목이 있으면 새 meeting 을 시작(MeetingService.start 호출), 없으면 idle. 앱 재시작 복구는 `main/index.ts` 부팅 직후 `QueueService.recoverOrphaned()` 로 `status='in_progress'` 항목을 `pending` 으로 롤백 + `attempts` 유지. pause/resume 토글은 `startNext` 를 no-op 으로 게이팅.
- 다섯 번째 축은 **3 surface × 1 hook 패턴의 UI 스택**. R4 `ProjectHeader` / R5 `ChannelList` / R7 `ApprovalInbox` 가 이미 `stream:*` 이벤트 구독 + `useXxx` hook 패턴으로 잡혀 있다. R9 는 3 hook × 3 surface 를 추가한다 — (i) `useAutonomyMode(projectId)` + `AutonomyModeToggle` + `AutonomyConfirmDialog` / (ii) `useQueue(projectId)` + `QueuePanel` / (iii) `useNotificationPrefs()` + `NotificationPrefsView`. 모두 mount fetch + invoke mutation + `stream:*-changed` reducer 의 동일 패턴.
- 여섯 번째 축은 **2단계 확인 다이얼로그의 UX 설계**. spec §11 의 "auto 모드 경고 다이얼로그 → 2단계 확인" E2E 시나리오가 R9 에서 실체화된다. `AutonomyConfirmDialog` 는 Radix Dialog 를 사용해 (a) 현재 autonomyMode 와 승격 target 표시, (b) Circuit Breaker 4 tripwire 기본 한계값 요약(`files_per_turn=20` / `cumulative_cli_ms=30min` / `queue_streak=5` / `same_error=3`), (c) "이해했고 승격합니다" 명시적 체크박스 — 체크하지 않으면 확인 버튼 비활성, (d) 확인 시 `project:set-autonomy(id, target)` invoke. auto_toggle → queue / queue → auto_toggle 전환은 동일 Circuit Breaker 적용이므로 확인 없이 바로. manual 로 다운그레이드는 확인 없이 즉시(안전 방향).
- 일곱 번째 축은 **Notification 의 포커스 게이트와 kind 별 prefs**. `NotificationService.show(kind, payload)` 는 이미 (a) prefs 에서 kind 별 `display` 가 false 면 skip, (b) `app.isFocused()` true 면 skip(사용자가 앱 보고 있으므로), (c) `electron-notifier-adapter` 를 통해 OS 알림 발사, (d) `'clicked'` 이벤트 emit 로직을 R2 에서 구현해 뒀다. R9 Task 4 의 `NotificationPrefsView` 는 이 prefs 를 UI 로 노출하고, Task 11 이 main-process 고정 라벨 i18n 을 populate(R7/R8 에서 deferred 됐던 `notification.approvalPending.*` / `notification.warmupFailed.*` / `notification.circuitBreaker.*` 등 — 4 kind title/body + 특수 상황 라벨).
- 여덟 번째 축은 **i18n populate 의 main-process 반입**. R7/R8 에서 deferred 됐던 `notification.*` top-level namespace 가 이 phase 에서 완성된다. main-process 는 전통적으로 i18next 를 직접 import 하지 않고 상수 테이블을 사용 — 하지만 i18next-parser 의 keepRemoved regex 는 보존해 줘야 renderer orphan-prune 에서 살아남는다. Task 11 이 `notification.*` + `autonomy.*` + `queue.*` + `circuitBreaker.*` + `settings.notifications.*` 를 ko/en 양쪽에 populate + keepRemoved regex 확장.
- 아홉 번째 축은 **R8 인수인계의 자율 모드 통합**. R8 done-checklist 의 Known Concerns 6건 중 (2) 외근 자동 timeout + (3) Warmup 자동 retry 는 "autonomy 정책과 함께" R9 로 이월된 항목이다. Task 10 이 (a) `MemberProfileService.getWorkStatus` 가 status_override='offline-manual' 일 때 last_changed_at 을 체크해 60분 경과 시 `online` 자동 복귀(settings `autonomyTimeouts.offlineManualMinutes` 로 조정), (b) `MemberWarmupService.warmOne` 이 timeout 실패 시 10s → 30s → 60s 지수 backoff 로 최대 3회 재시도. 나머지 4건(stream:member-status-changed / Warmup cancellation / PeopleWidget E2E fixture / notification.warmupFailed main-process 라벨 — 4번째는 Task 11 에서 해결)은 R10 유지.
- 열 번째 축은 **Playwright E2E "auto 모드 경고 다이얼로그 → 2단계 확인"**. spec §11 의 6 시나리오 중 3번 시나리오가 R9 에서 구현된다. Task 12 의 `e2e/autonomy-queue-flow.spec.ts` 가 (i) 프로젝트 헤더 `auto_toggle` 승격 → `AutonomyConfirmDialog` → 체크박스 → 확인 → `project:set-autonomy` mock invoke, (ii) QueuePanel 에 2 항목 추가 → 첫 항목 시작 → 완료 시 `#일반` system message + OS notification mock, (iii) Circuit Breaker `files_per_turn > 20` 모의 → 강제 manual 다운그레이드 + notification.show('error') mock. WSL 런타임 제약 시 R4~R8 와 동일 DONE_WITH_CONCERNS.
- **SSM 은 건드리지 않는다**. `session-state-machine.ts` 의 12 상태 / 가드 / 이벤트는 R9 범위 밖. Autonomy 는 SSM 바깥의 ApprovalService 분기(`AutonomyGate`)로 구현. USER_DECISION 상태 자체는 유지, 다만 그 결과로 만들어지는 approval_item 이 autonomyMode 에 따라 즉시 자동 decide 되거나 대기 상태로 남거나.
- **Approval 흐름은 "게이트" 만 추가**. R7 에서 닫은 `mode_transition` / `consensus_decision` / `cli_permission` 3 kind 는 그대로. `AutonomyGate` 는 `ApprovalService.create` 직후 훅하여 autonomyMode=auto_toggle/queue + 해당 kind+outcome 이 accepted 조건이면 즉시 `decide('accepted')` 호출. 기존 approval-decision-router 는 건드리지 않음.
- **데이터 모델은 컬럼 추가 0**. `projects.autonomy_mode` / `queue_items` / `notification_prefs` / `notification_log` 모두 R2 에서 이미 있음. 신규 마이그레이션 0건. 단 `circuit_breaker_state` 같은 persist 상태는 R9 범위 밖(in-memory `CircuitBreaker` 가 현 설계 — 재시작 시 counter 리셋은 CD-2 허용).
- **보안 invariant (spec §12)**: NotificationPrefs 저장은 DB 내부이므로 path-guard 무관. Circuit Breaker 의 `recordError(cat)` 카테고리는 enum(`consensus_failed`/`cli_spawn_failed`/`test_failed` 등)만 허용 — free-form string 금지(race: 공격자 입력으로 category 폭발 방지 — 실제는 내부 event 카테고리만).
- **`spec §10 R9 체크박스` 확장과 Decision Log 는 Task 0 에서 먼저 한다**. 구현 중 모호함은 **반드시 spec 을 먼저 갱신** 한 뒤 코드를 고친다(R2~R8 규약).

**Architecture:**

- Layering: `renderer → shared → preload(contextBridge) → main`. R3~R8 구조 그대로.
- Main 재사용 (R2~R8 land 완료):
  - `src/main/notifications/{notification-service,notification-repository,electron-notifier-adapter}.ts` — R2 구현 + R7-Task11 approval-notification-bridge wire (R9 변경 0, 단 prefs seed Task 9 에서)
  - `src/main/queue/{queue-service,queue-repository,circuit-breaker}.ts` — R2 구현 (R9 변경: queue-service 확장 Task 7, circuit-breaker 는 변경 0 — record API 는 이미 존재)
  - `src/main/engine/v3-side-effects.ts` — work-done + breaker handler 스텁 (R9 Task 6/8 에서 완성)
  - `src/main/meetings/engine/meeting-orchestrator.ts` — notificationService + circuitBreaker DI 이미 존재(R9 변경: onFinal 분기 Task 8)
  - `src/main/approvals/approval-service.ts` — R9 변경: AutonomyGate hook-in Task 5
  - `src/main/projects/project-service.ts` — `setAutonomy(id, mode)` 이미 구현 + `update` 도 autonomyMode 받음 (R9 변경 0)
  - `src/main/execution/execution-service.ts` — R9 변경: `dryRunApply` 직후 circuitBreaker.recordFileChanges 호출 hook Task 6
  - `src/main/providers/cli-runner.ts` — R9 변경: `spawn` 완료 시 recordCliElapsed Task 6
  - `src/main/ipc/handlers/{notification-handler,queue-handler}.ts` — R2 구현, R9 변경: production wire only Task 9
  - `src/main/streams/stream-bridge.ts` — R9 변경: queue 연결 Task 7/9 + autonomy-mode-changed emit Task 5
- Main 신규 파일:
  - `src/main/autonomy/autonomy-gate.ts` — ApprovalService 'created' 훅, autonomyMode 분기, auto accept + downgrade (Task 5)
  - `src/main/autonomy/__tests__/autonomy-gate.test.ts`
- Main 수정:
  - `src/main/index.ts` — R9 boot block: setNotificationServiceAccessor + setQueueServiceAccessor + streamBridge.connect({queue}) + prefs seed + autonomy-gate wire + queue.recoverOrphaned + autonomy-timeout-scheduler (Task 9/10)
  - `src/main/queue/queue-service.ts` — `startNext(projectId)` 공개 API 완성 + `recoverOrphaned()` 추가 + meeting onFinal 훅에서 호출 (Task 7)
  - `src/main/engine/v3-side-effects.ts` — work-done handler + breaker handler 완성 (Task 6/8)
  - `src/main/members/member-profile-service.ts` — getWorkStatus 에서 status_override 만료 자동 복귀 hook (Task 10)
  - `src/main/members/member-warmup-service.ts` — warmOne backoff retry 루프 (Task 10)
  - `src/main/execution/execution-service.ts` — dryRunApply 직후 breaker.recordFileChanges (Task 6)
  - `src/main/providers/cli-runner.ts` — spawn 완료 시 breaker.recordCliElapsed (Task 6)
  - `src/main/meetings/engine/meeting-turn-executor.ts` — fail 시 breaker.recordError (Task 6)
  - `src/main/approvals/approval-service.ts` — AutonomyGate emit hook (Task 5)
- Shared:
  - `src/shared/queue-types.ts` — `QueueItem` / `QueueRunState` / `CircuitBreakerLimits` / `CircuitBreakerState` 이미 존재, R9 확장: IPC request/response 형태 (Task 1)
  - `src/shared/notification-types.ts` — `NotificationKind` / `NotificationPrefs` / `NotificationPayload` 이미 존재, R9 확장: prefs update patch 형태 (Task 1)
  - `src/shared/ipc-types.ts` — `project:set-autonomy` + `queue:list/add/reorder/remove/pause/resume` + `notification:get-prefs/update-prefs/test` 추가 (Task 1)
  - `src/shared/ipc-schemas.ts` — zod (Task 1)
  - `src/shared/stream-events.ts` — `stream:queue-updated` / `stream:notification-prefs-changed` / `stream:autonomy-mode-changed` 추가 (Task 1)
- Preload:
  - `src/preload/index.ts` — 신규 IPC 채널 화이트리스트 + 3 stream 이벤트 구독 화이트리스트
- Renderer 신규:
  - `src/renderer/features/projects/AutonomyModeToggle.tsx` — 3 모드 토글 (Task 2)
  - `src/renderer/features/projects/AutonomyConfirmDialog.tsx` — 2단계 확인 다이얼로그 (Task 2)
  - `src/renderer/features/projects/QueuePanel.tsx` — 프로젝트 상단 queue 패널 (Task 3)
  - `src/renderer/features/settings/NotificationPrefsView.tsx` — 알림 설정 UI (Task 4)
  - `src/renderer/hooks/use-autonomy-mode.ts` (Task 2)
  - `src/renderer/hooks/use-queue.ts` (Task 3)
  - `src/renderer/hooks/use-notification-prefs.ts` (Task 4)
- Renderer 수정:
  - `src/renderer/features/projects/ProjectHeader.tsx` — AutonomyModeToggle mount (Task 2)
  - `src/renderer/features/projects/ProjectView.tsx` 또는 상응 상단 area — QueuePanel mount (Task 3)
  - `src/renderer/features/settings/SettingsView.tsx` — NotificationPrefsView 진입점 (Task 4, 설정 surface 최소 wire)
  - `src/renderer/i18n/locales/{ko,en}.json` — notification/autonomy/queue/circuitBreaker populate (Task 11)
- State flow:
  - **Autonomy mode change:**
    1. 사용자가 `AutonomyModeToggle` 에서 manual → auto_toggle 선택.
    2. `useAutonomyMode.requestSet(mode)` 가 (a) manual → auto_toggle/queue 승격이면 `AutonomyConfirmDialog` open, (b) auto_toggle ↔ queue 또는 다운그레이드 manual 은 바로 invoke.
    3. 다이얼로그 "이해했습니다" 체크 + 확인 → `invoke('project:set-autonomy', { id, mode })` → `ProjectService.setAutonomy` → `projects.autonomy_mode` UPDATE + `ProjectService.emit('autonomy-changed', { id, mode })`.
    4. `StreamBridge` 가 `stream:autonomy-mode-changed` broadcast → 모든 renderer surface 가 reducer 로 반영.
  - **Queue add → start → finish → next:**
    1. 사용자가 QueuePanel 입력에 `로그인 리팩토링\n다크모드 추가` 작성 → Enter.
    2. `useQueue.addLines(projectId, lines)` 가 줄 단위로 `invoke('queue:add', {projectId, content})` × N.
    3. `QueueService.add` 가 `queue_items` INSERT + `stream:queue-updated` emit.
    4. autonomyMode=queue + idle 이면 `QueueService.startNext(projectId)` 자동 호출: 첫 항목 `status='in_progress'` UPDATE + `MeetingService.start(projectId, channel='#일반', topic=item.content)` → meeting 진행.
    5. `MeetingOrchestrator.onFinal` → `v3-side-effects.workDoneHandler` → (a) `#회의록` 요약 포스트, (b) `notification.show('work_done')`, (c) autonomyMode ∈ {auto_toggle, queue} 이면 `#일반` system message, (d) autonomyMode=queue 이면 `queueService.markItemDone(itemId)` + `startNext(projectId)` 다시 호출 (재귀 아니라 다음 항목 → 새 meeting).
    6. 다음 항목 없으면 idle. `stream:queue-updated` 로 포인터 none.
  - **Circuit Breaker fire:**
    1. 한 meeting 의 한 turn 에서 AI 가 25개 파일을 변경 → `ExecutionService.dryRunApply` 직후 `circuitBreaker.recordFileChanges(25)` 호출.
    2. `files_per_turn` counter 가 20 초과 → `circuitBreaker.emit('fired', { reason: 'files_per_turn', detail: { count: 25, limit: 20 } })`.
    3. `v3-side-effects.breakerHandler` 실행: (a) `projectService.setAutonomy(projectId, 'manual')`, (b) `approvalService.create({kind:'circuit_breaker', meta:{tripwire:'files_per_turn', detail}})` (R10 에서 `circuit_breaker` kind 가 approval flow 에 정식 합류 — R9 에서는 kind 로만 표시), (c) `notification.show('error', { reason: t('circuitBreaker.tripwire.filesPerTurn.reason', {count, limit}) })`.
    4. `stream:autonomy-mode-changed` 로 UI 가 manual 로 되돌아가고, `stream:notification-*` 로 toast 알림, OS 가 background 면 system notification.
  - **NotificationPrefs update:**
    1. 사용자가 설정 화면에서 `work_done` 표시 off 토글.
    2. `useNotificationPrefs.setKind('work_done', { display: false })` → `invoke('notification:update-prefs', patch)`.
    3. `NotificationService.updatePrefs` → `notification_prefs` UPDATE + `NotificationService.emit('prefs-changed', newPrefs)`.
    4. `StreamBridge` → `stream:notification-prefs-changed` broadcast → 다른 surface 도 반영. 다음 `NotificationService.show('work_done', ...)` 호출은 prefs.display=false 로 skip.
  - **외근 자동 timeout:**
    1. 사용자가 10:00 에 "외근" 토글 → `member:set-status('offline-manual')` → `member_profiles.status_override='offline-manual'` + `status_override_at='2026-04-23T10:00:00Z'`.
    2. `MemberProfileService.getWorkStatus(providerId)` 는 호출 시마다 `status_override_at + timeoutMinutes` 를 체크하여 만료 시 null 로 재해석(자동 복귀).
    3. 11:00 이후 첫 getWorkStatus 호출 → status_override 를 null 로 UPDATE + runtime status (warmup 결과 기반) 반환 + stream emit.
    4. Settings 의 `autonomyTimeouts.offlineManualMinutes` (기본 60) 로 조정 가능 — R9 는 코드 상수로 도입하고 UI 는 R10.
  - **Warmup backoff retry:**
    1. 부팅 시 `MemberWarmupService.warmAll` → `warmOne(providerId)` × N 병렬.
    2. `warmOne` = `Promise.race([warmup(), timeout(5s)])`. 실패 → `status='offline-connection'` + 10s 후 재시도 예약.
    3. 재시도도 실패 → 30s 후. 또 실패 → 60s 후. 3회 모두 실패 → retry 중단, status=offline-connection 확정.
    4. 성공 시 retry 취소 + status=online.
- Testing: Vitest (autonomy-gate, circuit-breaker feed, queue-service startNext/recovery, notification-repository seed, member-profile-service offline-manual timeout, member-warmup-service backoff), jsdom (AutonomyModeToggle / AutonomyConfirmDialog / QueuePanel / NotificationPrefsView / 3 hooks + reducer), Playwright `_electron` E2E 1 시나리오 (autonomy-queue-flow — 3단계 시나리오).

**Tech Stack (R9 추가):**

- 기존 (R8 까지): TypeScript strict / React 19 / Electron 40 / Vite / Vitest (jsdom) / i18next / zod / zustand / Tailwind / Radix (Dialog/Popover/Tooltip) / framer-motion / cva / clsx / @playwright/test / better-sqlite3 / @radix-ui/react-popover
- 신규: **없음**. Radix Dialog/Popover 는 R5/R7/R8 에서 사용. drag-and-drop (QueuePanel 순서 변경) 은 HTML5 native drag events + React state 로 처리 — dnd 라이브러리 도입은 과대. native drag 가 부족하면 R10 에서 `@dnd-kit/core` 재검토 (D3).

**참조:**

- Spec:
  - `docs/superpowers/specs/2026-04-18-rolestra-design.md`
    - §3 용어집: autonomyMode / Circuit Breaker
    - §5.2 migration 002_projects (autonomy_mode 컬럼) + 007_queue (queue_items) + 011_notifications (notification_prefs / log)
    - §6 IPC: `project:set-autonomy` / `queue:*` / `notification:get-prefs/update-prefs/test`
    - §7.8 OS 시스템 알림 (4 kind + 포커스 게이트 + 클릭 라우팅)
    - §8 상태 모델 확장 (SsmContext 의 autonomyMode + autonomyMode 별 동작 테이블 + Circuit Breaker CB-5 + 채널/회의 사이드이펙트 리스너)
    - §9 에러 처리 (Circuit breaker 발동 → manual 다운그레이드)
    - §10 Phase R9 (Task 0 에서 R3~R8 템플릿으로 확장)
    - §11 E2E "auto 모드 경고 다이얼로그 → 2단계 확인"
    - §부록 A v2→v3 델타 (자율 모드 / 큐 / 시스템 알림 행)
  - `docs/superpowers/specs/r8-done-checklist.md` (R9 인수인계 6건 중 2건 Task 10 에서 통합)
- R8 plan/done-checklist: `docs/superpowers/plans/2026-04-23-rolestra-phase-r8.md`, `docs/superpowers/specs/r8-done-checklist.md`
- Main 재사용 모듈:
  - `src/main/notifications/{notification-service,notification-repository,electron-notifier-adapter}.ts`
  - `src/main/queue/{queue-service,queue-repository,circuit-breaker}.ts`
  - `src/main/engine/v3-side-effects.ts` (work-done + breaker handler 스텁)
  - `src/main/meetings/engine/meeting-orchestrator.ts`
  - `src/main/approvals/{approval-service,approval-notification-bridge}.ts`
  - `src/main/projects/{project-service,project-repository}.ts`
  - `src/main/execution/execution-service.ts`
  - `src/main/providers/cli-runner.ts`
  - `src/main/meetings/engine/meeting-turn-executor.ts`
  - `src/main/streams/stream-bridge.ts`
  - `src/main/ipc/handlers/{notification-handler,queue-handler,project-handler}.ts`
- Renderer 재사용:
  - `src/renderer/features/projects/ProjectHeader.tsx` (R4)
  - `src/renderer/features/projects/ProjectView.tsx` 또는 상응 (R4)
  - `src/renderer/features/settings/SettingsView.tsx` (R4 최소 shell — R10 에서 전면 재구성)
  - `src/renderer/features/approvals/ApprovalInboxView.tsx` (R7 — 3 surface × 1 hook 패턴 레퍼런스)
  - `src/renderer/components/primitives/{Button,Card,Tooltip,Separator,Badge}.tsx` (R3)
  - Radix Dialog (R5/R7/R8)
- R9 신규 디렉토리:
  - `src/main/autonomy/` — AutonomyGate (R10 에 Queue autonomy retry policy 등으로 확장 예정)
  - (renderer 기존 `src/renderer/features/projects/` 확장, `src/renderer/features/settings/` 확장 — 신규 디렉토리 0)

---

## Prereqs

- [x] R8 전체 완료 (14/14) + main ff-merge (2026-04-23) — `3cf32ad` tip
- [x] R8 done-checklist 작성 및 Known Concerns 6건 문서화
- [x] `NotificationService` + `NotificationRepository` + `ElectronNotifierAdapter` + tests (R2)
- [x] `QueueService` + `QueueRepository` + `CircuitBreaker` + tests (R2)
- [x] migration 002 `projects.autonomy_mode` + 007 `queue_items` + 011 `notification_prefs`/`notification_log` (R2)
- [x] `MeetingOrchestrator` DI 에 `notificationService` + `circuitBreaker` 주입 (R6-Task4)
- [x] `ApprovalNotificationBridge` (R7-Task11) — `ApprovalService 'created'` → `NotificationService.show('approval_pending')`
- [x] `StreamBridge.connect({ ..., notifications })` (R7-Task11) + `stream:notification-clicked` (R7-Task11)
- [x] `ProjectService.setAutonomy` / `update({autonomyMode})` + `project:set-autonomy` IPC 스키마 (R2 — 본 phase 에서 production wire 확정)
- [ ] `rolestra-phase-r9` 브랜치 `main`(`3cf32ad`)에서 생성 (Task 0 첫 step)
- [ ] spec §10 R9 블록 R3~R8 템플릿으로 확장 (Task 0)

---

## File Structure (R9 종료 시)

```
src/
├── main/
│   ├── autonomy/                                # NEW 디렉토리 (Task 5)
│   │   ├── autonomy-gate.ts                     # NEW — ApprovalService 'created' 훅, autonomyMode 분기
│   │   └── __tests__/autonomy-gate.test.ts
│   ├── notifications/                            # R2 재사용 (변경 0)
│   │   ├── notification-service.ts
│   │   ├── notification-repository.ts            # + prefs seed helper (Task 9)
│   │   └── electron-notifier-adapter.ts
│   ├── queue/                                    # R2 재사용 (Task 6/7 수정)
│   │   ├── queue-service.ts                      # + startNext / recoverOrphaned (Task 7)
│   │   ├── queue-repository.ts                   # + recovery (Task 7)
│   │   └── circuit-breaker.ts                    # (변경 0 — record API 는 이미 존재)
│   ├── engine/
│   │   └── v3-side-effects.ts                    # work-done + breaker handler 완성 (Task 6/8)
│   ├── execution/
│   │   └── execution-service.ts                  # + dryRunApply 후 recordFileChanges (Task 6)
│   ├── providers/
│   │   └── cli-runner.ts                         # + spawn 완료 후 recordCliElapsed (Task 6)
│   ├── meetings/engine/
│   │   ├── meeting-orchestrator.ts               # onFinal 분기 (Task 8)
│   │   └── meeting-turn-executor.ts              # + fail 시 recordError (Task 6)
│   ├── members/
│   │   ├── member-profile-service.ts             # + getWorkStatus 자동 복귀 (Task 10)
│   │   └── member-warmup-service.ts              # + backoff retry (Task 10)
│   ├── approvals/
│   │   └── approval-service.ts                   # + AutonomyGate emit hook (Task 5)
│   ├── streams/
│   │   └── stream-bridge.ts                      # + queue connect / autonomy-mode-changed emit (Task 5/7/9)
│   ├── ipc/handlers/
│   │   ├── notification-handler.ts               # (R2 — production wire Task 9)
│   │   ├── queue-handler.ts                      # (R2 — production wire Task 9)
│   │   └── project-handler.ts                    # (R2 — set-autonomy invoke 경유)
│   └── index.ts                                  # R9 boot block: 3 accessor + streamBridge.connect({queue}) + prefs seed + autonomy-gate wire + queue.recoverOrphaned + autonomy-timeout (Task 9/10)
├── renderer/
│   ├── features/
│   │   ├── projects/
│   │   │   ├── AutonomyModeToggle.tsx            # NEW (Task 2)
│   │   │   ├── AutonomyConfirmDialog.tsx         # NEW (Task 2)
│   │   │   ├── QueuePanel.tsx                    # NEW (Task 3)
│   │   │   ├── ProjectHeader.tsx                 # + AutonomyModeToggle mount (Task 2)
│   │   │   └── ProjectView.tsx                   # + QueuePanel mount (Task 3)
│   │   └── settings/
│   │       ├── NotificationPrefsView.tsx         # NEW (Task 4)
│   │       └── SettingsView.tsx                  # + NotificationPrefsView entry (Task 4)
│   ├── hooks/
│   │   ├── use-autonomy-mode.ts                  # NEW (Task 2)
│   │   ├── use-queue.ts                          # NEW (Task 3)
│   │   └── use-notification-prefs.ts             # NEW (Task 4)
│   └── i18n/locales/{ko,en}.json                 # + notification/autonomy/queue/circuitBreaker populate (Task 11)
├── shared/
│   ├── queue-types.ts                            # + IPC request/response types (Task 1)
│   ├── notification-types.ts                    # + prefs update patch type (Task 1)
│   ├── ipc-types.ts                              # + project:set-autonomy / queue:* / notification:* (Task 1)
│   ├── ipc-schemas.ts                            # + zod (Task 1)
│   └── stream-events.ts                          # + 3 새 broadcast stream (Task 1)
├── preload/
│   └── index.ts                                  # + 신규 IPC 채널 화이트리스트 + 3 stream 구독 (Task 1)
├── docs/superpowers/
│   ├── plans/
│   │   ├── 2026-04-23-rolestra-phase-r9.md       # (this file)
│   │   └── 2026-04-23-rolestra-phase-r9.md.tasks.json
│   └── specs/
│       ├── 2026-04-18-rolestra-design.md         # §10 R9 체크박스 확장 (Task 0)
│       └── r9-done-checklist.md                  # NEW (Task 13)
├── e2e/
│   └── autonomy-queue-flow.spec.ts               # NEW (Task 12)
└── i18next-parser.config.js                      # + notification/autonomy/queue/circuitBreaker keepRemoved
```

**파일 요약:**
- 신규 main: 1 디렉토리 (autonomy/) + autonomy-gate.ts + test
- 신규 renderer: 4 UI (AutonomyModeToggle / AutonomyConfirmDialog / QueuePanel / NotificationPrefsView) + 3 hooks + 테스트
- 수정 main: queue-service, v3-side-effects, execution-service, cli-runner, meeting-orchestrator, meeting-turn-executor, member-profile-service, member-warmup-service, approval-service, stream-bridge, notification-repository, index.ts
- 수정 renderer: ProjectHeader, ProjectView, SettingsView, i18n ko/en
- 수정 shared: queue-types, notification-types, ipc-types, ipc-schemas, stream-events
- 수정 preload: + 다중 IPC 화이트리스트 + 3 stream 구독
- 신규 spec/plan: r9-done-checklist + this plan + tasks.json

---

## Tasks

### Task 0 — Branch + spec §10 R9 확장 + plan + tasks.json + Decision Log

**목표**: R9 브랜치를 main tip(`3cf32ad`)에서 파고, spec §10 R9 블록을 R3~R8 템플릿(체크박스 + 산출물 링크)으로 확장, Decision Log 8건 기록.

- [x] `git checkout -b rolestra-phase-r9` from main tip (`3cf32ad`)
- [x] spec §10 R9 블록 확장:
  - `- [ ]` 항목 13개 (Task 1~12 산출물과 1:1) + closeout 1개 = 13
  - **scope 경계** 하단 블록: R10 (FTS5 / 설정 UI 전면 / DM / stream:member-status-changed / optimistic UI / Playwright CI matrix), R11 (legacy v2 engine 5파일 + retro 영어 복귀 D8)
  - plan/done-checklist 링크 placeholder
- [x] `docs/superpowers/plans/2026-04-23-rolestra-phase-r9.md.tasks.json` 생성 (14 task slot)
- [ ] Decision Log (본 plan 끝에 Decision Log 섹션 추가):
  - D1~D8 — 본 plan 끝의 Decision Log 섹션 참고
- [ ] 커밋: `docs(rolestra): R9 plan + tasks.json + spec §10 R9 체크리스트 확장 (R9-Task0)`

**AC**:
- `rolestra-phase-r9` 브랜치 존재
- spec §10 R9 블록 체크박스 + scope 경계 + 링크 placeholder
- tasks.json 14-slot skeleton
- Decision Log 8건 기록

**Testing**: N/A (docs-only commit)

---

### Task 1 — Shared types + IPC 채널 + zod + preload + stream 이벤트

**목표**: R9 가 필요한 IPC 경계를 shared 에 확정. 기존 R2 에서 일부 (project:set-autonomy schema) 만 있던 걸 실제 사용 가능한 수준으로 정리.

- [ ] `src/shared/queue-types.ts` 검토 + 확장:
  - 기존 `QueueItem`, `QueueRunState`, `CircuitBreakerLimits`, `CircuitBreakerState` 유지
  - 신규 `QueueAddRequest` / `QueueReorderRequest` / `QueuePauseResumeRequest` 정의
- [ ] `src/shared/notification-types.ts` 확장:
  - `NotificationPrefsUpdatePatch` — partial, kind 별 display/sound 토글
- [ ] `src/shared/ipc-types.ts` 확장:
  - `project:set-autonomy`: `{ request: { id: string; mode: AutonomyMode }; response: void }`
  - `queue:list`: `{ request: { projectId: string }; response: QueueItem[] }`
  - `queue:add`: `{ request: QueueAddRequest; response: QueueItem }`
  - `queue:reorder`: `{ request: QueueReorderRequest; response: QueueItem[] }`
  - `queue:remove`: `{ request: { itemId: string }; response: void }`
  - `queue:pause`: `{ request: { projectId: string }; response: QueueRunState }`
  - `queue:resume`: `{ request: { projectId: string }; response: QueueRunState }`
  - `notification:get-prefs`: `{ request: void; response: NotificationPrefs }`
  - `notification:update-prefs`: `{ request: NotificationPrefsUpdatePatch; response: NotificationPrefs }`
  - `notification:test`: `{ request: { kind: NotificationKind }; response: void }`
- [ ] `src/shared/ipc-schemas.ts` 확장:
  - 위 10 채널의 request/response zod schema
  - 기존 `autonomyModeSchema` 재사용
- [ ] `src/shared/stream-events.ts` 확장:
  - `stream:queue-updated` — `{ projectId: string; runState: QueueRunState }`
  - `stream:notification-prefs-changed` — `{ prefs: NotificationPrefs }`
  - `stream:autonomy-mode-changed` — `{ projectId: string; mode: AutonomyMode }`
- [ ] `src/preload/index.ts`: 신규 IPC + 3 stream 화이트리스트
- [ ] `src/shared/__tests__/ipc-schemas.test.ts` 확장: round-trip 각 채널 당 2 케이스 이상
- [ ] 커밋: `feat(rolestra): R9 shared types + 10 IPC 채널 + 3 stream + zod (R9-Task1)`

**AC**:
- 10 신규 IPC 채널 + 3 stream 이 ipc-types / ipc-schemas / preload / stream-events 에 일관 선언
- zod round-trip 20+ 케이스 green
- 기존 R8 채널 회귀 0
- typecheck exit 0

**Testing**: Vitest schema round-trip.

---

### Task 2 — `AutonomyModeToggle` + `AutonomyConfirmDialog` + `use-autonomy-mode` hook

**목표**: 프로젝트 헤더에서 3 모드 전환 UI. manual → auto_toggle/queue 승격 시 2단계 확인 다이얼로그.

- [ ] `src/renderer/hooks/use-autonomy-mode.ts` 신규:
  - `useAutonomyMode(projectId)` → `{ mode, isLoading, error, request(target), confirm(target) }`
  - `request(target)` — manual → auto_toggle/queue 승격이면 `pendingTarget` state set (다이얼로그 open 유도); 그 외면 바로 `confirm(target)` 호출
  - `confirm(target)` — `invoke('project:set-autonomy', {id, mode:target})` + 로컬 state mode 낙관 갱신
  - `stream:autonomy-mode-changed` reducer (projectId 일치하면 mode 반영)
- [ ] `src/renderer/features/projects/AutonomyModeToggle.tsx` 신규:
  - props: `{ projectId: string; currentMode: AutonomyMode }`
  - 3 버튼 (manual / auto_toggle / queue) — 현재 mode 강조, 클릭 → `request(target)`
  - i18n: `autonomy.mode.manual/autoToggle/queue` + tooltip `autonomy.mode.*.tooltip`
- [ ] `src/renderer/features/projects/AutonomyConfirmDialog.tsx` 신규:
  - props: `{ open: boolean; from: AutonomyMode; to: AutonomyMode; onConfirm(): void; onCancel(): void }`
  - Radix Dialog — 헤더 `autonomy.confirm.title` + 본문 Circuit Breaker 4 tripwire 설명 (`circuitBreaker.tripwire.*.limit`) + "이해했습니다" 체크박스 (`autonomy.confirm.ack`) + 푸터 취소/확인 버튼
  - 체크박스 해제 시 확인 버튼 disabled
- [ ] `src/renderer/features/projects/ProjectHeader.tsx` (기존 파일) 수정: `<AutonomyModeToggle>` 렌더 (R10 설정 UI 전에 임시 배치)
- [ ] `__tests__/AutonomyModeToggle.test.tsx`: 3 모드 클릭 → onClick / manual 승격 → dialog open / auto_toggle ↔ queue → 바로 invoke
- [ ] `__tests__/AutonomyConfirmDialog.test.tsx`: 체크 안 함 → 확인 disabled / 체크 + 확인 → onConfirm / 취소 → onCancel
- [ ] `__tests__/use-autonomy-mode.test.tsx`: stream event reducer / invoke 분기 / 에러 상태
- [ ] 커밋: `feat(rolestra): AutonomyModeToggle + ConfirmDialog + use-autonomy-mode (R9-Task2)`

**AC**:
- 3 모드 토글 onClick → 올바른 invoke/dialog 분기
- 승격 confirm dialog → 체크박스 필수
- stream 이벤트 수신 시 로컬 state 갱신
- R4 ProjectHeader 회귀 0
- a11y aria-pressed / aria-label

**Testing**: React Testing Library + mock invoke + mock stream.

---

### Task 3 — `QueuePanel` + `use-queue` hook + drag reorder

**목표**: 프로젝트 상단의 접기 가능한 queue 패널. 여러 줄 입력으로 항목 추가, drag 순서 변경, pause/resume.

- [ ] `src/renderer/hooks/use-queue.ts` 신규:
  - `useQueue(projectId)` → `{ items, runState, isLoading, error, addLines(text), remove(itemId), reorder(order), pause(), resume() }`
  - mount fetch `queue:list` + `stream:queue-updated` reducer (projectId 일치)
  - `addLines(text)` — 줄 단위 split → `queue:add` 순차 (병렬 아님 — 순서 보장)
- [ ] `src/renderer/features/projects/QueuePanel.tsx` 신규:
  - 헤더: 접기 toggle + "할 일 큐 (N)" 타이틀 + pause/resume 버튼
  - 입력: `<textarea>` + "추가" 버튼 — 여러 줄 입력 → addLines
  - 목록: 항목 별 content + status 배지(`pending`/`in_progress`/`done`/`failed`) + 순서 drag handle + 제거 버튼
  - 빈 상태 `queue.panel.empty`
  - 진행 중 항목은 시각 강조 + progress spinner
  - drag: HTML5 native `draggable=true` + `onDragStart/onDragOver/onDrop` → 로컬 순서 변경 → `reorder` invoke (drop 시에만)
- [ ] `src/renderer/features/projects/ProjectView.tsx` (기존) 수정: 상단에 `<QueuePanel>` 임시 배치 (R10 에서 layout refine)
- [ ] `__tests__/QueuePanel.test.tsx`: 여러 줄 입력 → addLines 호출 / drag 순서 → reorder 호출 / pause 토글 / 빈 상태
- [ ] `__tests__/use-queue.test.tsx`: stream reducer / addLines 순차 / reorder invoke
- [ ] 커밋: `feat(rolestra): QueuePanel + use-queue + drag reorder (R9-Task3)`

**AC**:
- 여러 줄 입력 → 줄 단위로 `queue:add` invoke (순서 보장)
- drag 순서 → `queue:reorder` invoke 인자 정확
- pause/resume 토글
- stream event 수신 시 로컬 state 반영
- 진행 포인터 시각화

**Testing**: React Testing Library + mock invoke + mock stream.

---

### Task 4 — `NotificationPrefsView` + `use-notification-prefs` hook + 설정 진입

**목표**: 4 kind × 표시/소리 on/off UI + 테스트 알림.

- [ ] `src/renderer/hooks/use-notification-prefs.ts` 신규:
  - `useNotificationPrefs()` → `{ prefs, isLoading, error, setKind(kind, patch), test(kind) }`
  - mount fetch `notification:get-prefs` + `stream:notification-prefs-changed` reducer
  - `setKind(kind, { display?, sound? })` → `invoke('notification:update-prefs', { [kind]: patch })`
- [ ] `src/renderer/features/settings/NotificationPrefsView.tsx` 신규:
  - 4 kind (`new_message` / `approval_pending` / `work_done` / `error`) 각각 row
  - row: kind 라벨 + 표시 스위치 + 소리 스위치 + "테스트" 버튼
  - 테스트 버튼 → `notification:test` invoke
- [ ] `src/renderer/features/settings/SettingsView.tsx` (기존) 수정: `<NotificationPrefsView>` 섹션 mount (R10 설정 10 탭 재구성 전 임시 배치 — 기존 SettingsView 가 tab 구조이면 새 탭 추가, 아니면 단일 View 하단 섹션)
- [ ] `__tests__/NotificationPrefsView.test.tsx`: 4 row 렌더 / 스위치 토글 → setKind 호출 / 테스트 버튼 → notification:test 호출
- [ ] `__tests__/use-notification-prefs.test.tsx`: stream reducer / invoke 인자
- [ ] 커밋: `feat(rolestra): NotificationPrefsView + use-notification-prefs (R9-Task4)`

**AC**:
- 4 kind × 2 스위치 UI 렌더
- 토글 → `notification:update-prefs` invoke 인자 정확
- 테스트 버튼 → `notification:test` invoke
- stream event 수신 반영

**Testing**: React Testing Library.

---

### Task 5 — `AutonomyGate` — ApprovalService `created` 훅 + autonomyMode 분기

**목표**: autonomyMode 가 auto_toggle/queue 일 때 approval_item 을 즉시 자동 decide. 실패 조건은 manual 다운그레이드.

- [ ] `src/main/autonomy/autonomy-gate.ts` 신규:
  - `class AutonomyGate { constructor(deps: { approvalService, projectService, notificationService, messageService, channelService }); wire(): void; }`
  - `wire()` — `approvalService.on('created', async (item) => this.handleCreated(item))`
  - `handleCreated(item)`:
    1. `project = projectService.get(item.projectId)` — projectId 없거나 manual 이면 skip
    2. `if project.autonomyMode in [auto_toggle, queue]`:
       - spec §8 accepted 조건 평가:
         - `item.kind === 'mode_transition'` + `item.meta.target in {auto, hybrid}` → auto accept
         - `item.kind === 'consensus_decision'` + `item.meta.outcome === 'accepted'` → auto accept
         - 그 외 (`cli_permission`, 또는 `consensus_decision` outcome=rework/fail) → 다운그레이드
       - accept 경로: `approvalService.decide(item.id, { decision: 'accepted', reason: '[autonomy:auto]' })` + `messageService.append({channelId: minutesChannelId, kind: 'system', content: t('autonomy.trace.autoAccepted', {kind})})` + `notificationService.show('work_done', {projectId, reason: 'autonomy auto-accept'})`
       - 다운그레이드 경로: `projectService.setAutonomy(projectId, 'manual')` + `messageService.append({...content: t('autonomy.trace.downgraded')...})` + `notificationService.show('error', {reason: 'autonomy downgrade: fail/rework'})`
    3. `else skip` (manual)
  - 테스트: `__tests__/autonomy-gate.test.ts`
    - manual → approval_item 유지 (회귀 0)
    - auto_toggle + mode_transition(target=auto) → auto accept
    - auto_toggle + consensus_decision(accepted) → auto accept
    - auto_toggle + consensus_decision(rework) → 강제 manual + item 그대로 (decide 없음)
    - queue 동일 + queue_streak +1 추적
- [ ] `src/main/approvals/approval-service.ts` 수정:
  - 이미 EventEmitter? → 확인, 없으면 `on('created')` API 추가 (approval-notification-bridge 가 이미 사용한다면 이미 있음)
- [ ] `src/main/streams/stream-bridge.ts` 수정: projectService.on('autonomy-changed') → `stream:autonomy-mode-changed` emit
- [ ] `src/main/index.ts`: `const autonomyGate = new AutonomyGate({...}); autonomyGate.wire();` boot block 추가
- [ ] 커밋: `feat(rolestra): AutonomyGate + autonomyMode 분기 (R9-Task5)`

**AC**:
- manual: approval_item 생성 + 기존 흐름 (회귀 0)
- auto_toggle: accepted kind 자동 `decide('accepted')`
- fail/rework: 강제 manual 다운그레이드
- `#회의록` trace 포스트
- stream:autonomy-mode-changed emit

**Testing**: Vitest + mock ApprovalService / ProjectService / NotificationService.

---

### Task 6 — Circuit Breaker 실 이벤트 feed + `on('fired')` downgrade handler 완성

**목표**: 4 tripwire 에 실 이벤트 소스 연결 + fired handler 가 다운그레이드 + approval_item + notification 발사.

- [ ] `src/main/execution/execution-service.ts` 수정:
  - `dryRunApply` 직후 `changeSet.files.length` 를 circuitBreaker.recordFileChanges(n) 호출
  - DI 에 circuitBreaker 추가 (현재 없다면) — main/index.ts 에서 주입
- [ ] `src/main/providers/cli-runner.ts` 수정:
  - `spawn` 완료 시 wall-clock elapsed 를 `recordCliElapsed(ms)` 호출
  - DI 에 circuitBreaker 추가
- [ ] `src/main/queue/queue-service.ts` 수정:
  - `startNext` 호출 시 `recordQueueStart()` (Task 7 과 통합)
  - `confirmContinue()` API 호출은 "사용자가 계속 버튼" UX — R9 범위, QueuePanel 에 Circuit Breaker 발동 후 resume 버튼 활성화 (Task 3 후속)
- [ ] `src/main/meetings/engine/meeting-turn-executor.ts` 수정:
  - fail 경로(CLI spawn fail, consensus fail, test fail 등)에서 category enum 으로 `recordError(cat)` 호출
- [ ] `src/main/engine/v3-side-effects.ts` 수정:
  - 기존 `breakerHandler` 완성:
    1. `projectService.setAutonomy(event.projectId, 'manual')` (event 에 projectId 없다면 breaker context 에서 추론)
    2. `approvalService.create({projectId, kind:'circuit_breaker', meta:{tripwire:event.reason, detail:event.detail}})` — 새 kind 추가 시 migration 불필요 (approval_items.kind 는 TEXT)
    3. `notificationService.show('error', {title:t('circuitBreaker.tripwire.'+reason+'.title'), body:t('circuitBreaker.tripwire.'+reason+'.body', detail)})`
- [ ] `src/main/index.ts`: ExecutionService + CliRunner 생성자에 circuitBreaker 주입 확인
- [ ] 테스트:
  - `__tests__/circuit-breaker-feed.test.ts` (또는 기존 circuit-breaker.test.ts 확장): files_per_turn/cumulative_cli_ms/queue_streak/same_error 각각 feed → fire
  - `__tests__/v3-side-effects.test.ts` (기존) 확장: breakerHandler 완성 검증
- [ ] 커밋: `feat(rolestra): Circuit Breaker 4 tripwire 실 이벤트 feed + downgrade handler (R9-Task6)`

**AC**:
- 4 tripwire 각각 실 이벤트 소스에서 record 호출 — 단위 테스트 커버
- fired 시 setAutonomy('manual') + approval_item(kind=circuit_breaker) + notification.show('error')
- 회귀 0 (기존 R6/R7 meeting 흐름, R7 approval 흐름)

**Testing**: Vitest + mock 서비스.

---

### Task 7 — Queue run loop — `startNext` + `recoverOrphaned` + pause/resume + stream emit

**목표**: autonomyMode=queue 에서 meeting onFinal 직후 자동으로 다음 항목을 시작. 재시작 복구.

- [ ] `src/main/queue/queue-service.ts` 수정:
  - `startNext(projectId): Promise<QueueItem | null>` 공개:
    1. `runState = getRunState(projectId)` — paused 면 null
    2. 다음 pending 항목 pull → `status='in_progress'` UPDATE + `attempts++`
    3. `meetingService.start({projectId, channelSlug:'#일반', topic:item.content})` 호출 (채널 해결은 기본 `#일반`)
    4. `circuitBreaker.recordQueueStart()` 호출
    5. `stream:queue-updated` emit
    6. 반환: 시작된 item or null
  - `markItemDone(itemId, outcome)` — `status='done'`, onFinal hook 이 호출
  - `markItemFailed(itemId, reason)` — `status='failed'`
  - `recoverOrphaned()` — 부팅 시 1회 호출: `status='in_progress'` → `pending` 롤백 + attempts 유지
  - `pauseRun(projectId) / resumeRun(projectId)` — 이미 있으면 재검토
- [ ] `src/main/meetings/engine/meeting-orchestrator.ts` 또는 `v3-side-effects.ts` 수정:
  - onFinal 경로에서 `if project.autonomyMode === 'queue'` → `queueService.markItemDone + startNext`
- [ ] `src/main/index.ts`: 부팅 직후 `queueService.recoverOrphaned()` 호출 (DB 열고 나서 처음)
- [ ] `src/main/streams/stream-bridge.ts` 수정: queue 연결(현재 `// queue connect in R9` 주석 제거) — queueService.on('updated') → `stream:queue-updated` emit
- [ ] 테스트:
  - `queue-service.test.ts` 확장: startNext happy path / paused → null / 빈 큐 → null / onFinal 통합 (mock meetingService)
  - `recoverOrphaned` 테스트
- [ ] 커밋: `feat(rolestra): QueueService startNext + recovery + stream emit (R9-Task7)`

**AC**:
- queue 모드 onFinal → startNext 호출 확인
- recoverOrphaned: in_progress → pending 롤백
- pause 중 startNext 호출 → no-op
- stream:queue-updated 발사

**Testing**: Vitest.

---

### Task 8 — `MeetingOrchestrator.onFinal` work_done wiring

**목표**: onFinal 이벤트에서 #회의록 요약 포스트 + notification.show('work_done') + auto_toggle/queue 에서 #일반 완료 system message.

- [ ] `src/main/engine/v3-side-effects.ts` 수정:
  - `workDoneHandler(event: { meeting, project, summary })` 완성:
    1. `minutesChannel = channelService.resolveSlug(project.id, '#회의록')` (없으면 skip or error-tolerant)
    2. `messageService.append({channelId: minutesChannel.id, kind:'system', content: formatMinutes(meeting, summary)})` — R6 포맷 동일
    3. `notificationService.show('work_done', {title: meeting.title, body: summary.oneLiner})`
    4. `if project.autonomyMode in [auto_toggle, queue]`:
       - `generalChannel = channelService.resolveSlug(project.id, '#일반')`
       - `messageService.append({channelId: generalChannel.id, kind:'system', content: t('autonomy.generalMeetingDone', {title})})`
- [ ] `src/main/meetings/engine/meeting-orchestrator.ts` 수정: onFinal 이벤트 emit 시 workDoneHandler 호출 (DI wire)
- [ ] 테스트:
  - `v3-side-effects.test.ts`: autonomyMode 각각 3 케이스 — #회의록 항상, #일반 은 auto_toggle/queue 만
  - notification.show('work_done') 호출 검증
- [ ] 커밋: `feat(rolestra): MeetingOrchestrator onFinal work-done wiring (R9-Task8)`

**AC**:
- onFinal → #회의록 메시지 append
- notification.show('work_done')
- auto_toggle/queue 에서만 #일반 system message
- manual 에서 #일반 포스트 0 (회귀 0)

**Testing**: Vitest.

---

### Task 9 — Production wiring — 3 accessor + streamBridge.connect({queue}) + prefs seed

**목표**: R8 Task 8 과 동일 패턴. 기존에 테스트에서만 wire 되어 있던 accessor 들을 production main/index.ts 에 연결.

- [ ] `src/main/index.ts` 수정 — R9 boot block:
  1. `import { setNotificationServiceAccessor } from './ipc/handlers/notification-handler';`
  2. `import { setQueueServiceAccessor } from './ipc/handlers/queue-handler';`
  3. DB open 직후: `const queueService = new QueueService({ repo: new QueueRepository(db), circuitBreaker, meetingService /* lazy */ });`
  4. `setNotificationServiceAccessor(() => notificationService);`
  5. `setQueueServiceAccessor(() => queueService);`
  6. `queueService.recoverOrphaned();` (Task 7 통합)
  7. `notificationService.seedDefaultPrefsIfEmpty();` — 첫 부팅에 4 kind × `{display:true, sound:true}` INSERT OR IGNORE
  8. `streamBridge.connect({ ..., queue: queueService });` (현재 `// queue connect in R9` 주석 제거)
- [ ] `src/main/notifications/notification-repository.ts` 확장:
  - `seedDefaultPrefsIfEmpty()` — 4 kind 에 대해 INSERT OR IGNORE
- [ ] `src/main/notifications/notification-service.ts` 확장: seedDefaultPrefsIfEmpty 위임
- [ ] 테스트:
  - `__tests__/r9-boot.test.ts` — accessor 등록 / queue stream connect / prefs seed
  - `r2-integration-smoke.test.ts` 회귀 0 확인
- [ ] 커밋: `feat(rolestra): R9 production wiring — 3 accessor + queue stream + prefs seed (R9-Task9)`

**AC**:
- `notification:get-prefs` production throw 0
- `queue:list` production throw 0
- streamBridge 에 queue 연결 확인 (emit 테스트)
- prefs 초기 4 kind seed (부팅 후 get-prefs 가 4 kind 반환)

**Testing**: Vitest + integration smoke.

---

### Task 10 — R8 인수인계 통합 — 외근 자동 timeout 60분 + Warmup backoff retry

**목표**: R8 Known Concerns (2)(3) 를 자율 운영 관점에서 해결.

- [ ] `src/main/members/member-profile-service.ts` 수정:
  - `getWorkStatus(providerId)` 호출 시 `row.status_override === 'offline-manual'` + `row.status_override_at + 60min < now` 이면:
    1. `repo.clearStatusOverride(providerId)` (`status_override = null`, `status_override_at = null`)
    2. runtime status 기반 재해석
    3. `emit('status-changed', {providerId, status})` (R10 stream:member-status-changed 를 위한 precursor)
  - 설정 키: `AUTONOMY_TIMEOUT_OFFLINE_MANUAL_MIN = 60` 상수 (R10 UI)
- [ ] `src/main/members/member-profile-repository.ts` 확장: `clearStatusOverride(providerId)` method
- [ ] `src/main/members/member-warmup-service.ts` 수정:
  - `warmOne(providerId)` 를 backoff retry 루프로 감싸기:
    - attempts = [0ms, 10_000, 30_000, 60_000] — 즉시 1회 + 실패 시 10s → 30s → 60s
    - 각 시도: `Promise.race([provider.warmup(), timeout(5s)])`
    - 성공 시 retry 취소 + status='online' emit
    - 모두 실패 시 status='offline-connection' 확정
  - provider.warmup 중단 신호는 미지원 — 재시도 중 성공한 이전 attempt 결과가 스트림에 들어올 수 있으므로 `attemptId` 로 race 방지 (첫 성공 outcome 만 반영)
- [ ] `src/main/__tests__/` — offline-manual timeout test + warmup backoff test
- [ ] 커밋: `feat(rolestra): 외근 자동 timeout 60분 + warmup backoff retry (R9-Task10)`

**AC**:
- 60분 경과 offline-manual → online 자동 복귀 (getWorkStatus 호출 시 evaluated)
- warmup 실패 3회까지 backoff retry (10s/30s/60s)
- 모두 실패 시 offline-connection 확정
- R8 Member 흐름 회귀 0

**Testing**: Vitest + fake timers.

---

### Task 11 — i18n populate `notification.*` / `autonomy.*` / `queue.*` / `circuitBreaker.*` / `settings.notifications.*`

**목표**: ko/en 양쪽에 R9 신규 문자열 populate. main-process 고정 라벨(`notification.*`) 포함 — R7/R8 에서 deferred 됐던 영역.

- [ ] `src/renderer/i18n/locales/ko.json` + `en.json` 확장:
  - `notification.newMessage.{title,body}` / `notification.approvalPending.{title,body}` / `notification.workDone.{title,body}` / `notification.error.{title,body}`
  - `notification.warmupFailed.{title,body}` / `notification.circuitBreaker.{title,body}`
  - `autonomy.mode.{manual,autoToggle,queue}` + `.tooltip`
  - `autonomy.confirm.{title,description,ack,cancel,submit}`
  - `autonomy.downgrade.{title,reason}`
  - `autonomy.trace.{autoAccepted,downgraded,queueNextStarted}`
  - `autonomy.generalMeetingDone`
  - `queue.panel.{title,empty,add,pause,resume,remove,addPlaceholder,dragHint}`
  - `queue.status.{pending,inProgress,done,failed}`
  - `queue.toast.{added,started,done,failed}`
  - `queue.recovery.banner`
  - `circuitBreaker.tripwire.{filesPerTurn,cumulativeCliMs,queueStreak,sameError}.{title,body,limit,reason}`
  - `settings.notifications.{title,description,testButton}`
- [ ] `i18next-parser.config.js`: `notification.*` / `autonomy.*` / `queue.*` / `circuitBreaker.*` keepRemoved regex 확장 (main-process 사용 orphan-prune 방지)
- [ ] main-process i18n 상수 테이블 (예: `src/main/notifications/notification-labels.ts`) — i18n key 를 직접 참조하되 현재 locale 기반 dictionary lookup (Electron main 에서 `app.getLocale()` 또는 settings 값)
- [ ] 테스트:
  - `__tests__/notification-labels.test.ts` — 4 kind × ko/en 라벨 정확
- [ ] 커밋: `feat(rolestra): i18n populate notification/autonomy/queue/circuitBreaker (R9-Task11)`

**AC**:
- `npm run i18n:check` exit 0 (idempotent)
- typecheck:web exit 0
- 신규 키 ko/en 양쪽 populate
- main-process 라벨 dictionary 에서 resolve 성공

**Testing**: Vitest + i18n:check.

---

### Task 12 — Playwright E2E `autonomy-queue-flow.spec.ts`

**목표**: spec §11 "auto 모드 경고 다이얼로그 → 2단계 확인" + queue 진행 + Circuit Breaker 발동 downgrade 시나리오.

- [ ] `e2e/autonomy-queue-flow.spec.ts` 신규 — 3 단계:
  1. **Step A — auto_toggle 승격 + 2단계 확인**:
     - 프로젝트 열기 → `AutonomyModeToggle` 의 auto_toggle 클릭 → `AutonomyConfirmDialog` open → 체크박스 체크 전 확인 버튼 disabled 확인 → 체크 → 확인 클릭 → 모드 전환 → `stream:autonomy-mode-changed` 수신 → 헤더 mode=auto_toggle
  2. **Step B — queue 항목 추가 + onFinal auto accept + 다음 항목 자동 시작**:
     - QueuePanel 에 2 줄 입력 → 추가 → queue_items 2 개 → mode=queue 로 승격 (다이얼로그 확인) → 첫 항목 in_progress → mock meeting onFinal → `#회의록` 메시지 + `#일반` system message + 다음 항목 자동 시작 → 두 번째 item in_progress
  3. **Step C — Circuit Breaker files_per_turn > 20 → 강제 manual + OS notification mock**:
     - ExecutionService mock 으로 21 파일 변경 dispatch → `circuitBreaker.recordFileChanges(21)` → fired → projectService.setAutonomy('manual') → stream:autonomy-mode-changed → 헤더 mode=manual → NotificationService.show('error') mock 검증
- [ ] `e2e/helpers/mock-provider.ts` / `mock-cli.ts` 재사용 (R4~R8)
- [ ] WSL 런타임 제약 시 R4~R8 와 동일 DONE_WITH_CONCERNS 정책
- [ ] 커밋: `feat(rolestra): E2E autonomy-queue-flow.spec.ts (3 step 시나리오) (R9-Task12)`

**AC**:
- e2e/autonomy-queue-flow.spec.ts 존재
- 3 step 시나리오 명시
- typecheck/lint exit 0
- WSL 제약 시 DONE_WITH_CONCERNS 정책 (mock 의존)

**Testing**: Playwright `_electron.launch`.

---

### Task 13 — R9 Closeout (정식 게이트 + done-checklist + §10 ✓ + tasks 14/14)

**목표**: 모든 정식 게이트 녹색. done-checklist 작성. spec §10 R9 ✓ 전환. tasks 14/14.

- [ ] 정식 게이트:
  - `npm run typecheck` exit 0
  - `npm run typecheck:web` exit 0
  - `npm run lint` exit 0 (errors) — pre-existing warnings 허용
  - `npm run test` — R9 touched domains (autonomy / queue / notification / circuit-breaker / v3-side-effects / member-profile-service / member-warmup-service + renderer R9 신규) 전부 green
  - `npm run i18n:check` exit 0 (idempotent)
  - `npm run theme:check` exit 0
  - `npm run build` exit 0
- [ ] `docs/superpowers/specs/r9-done-checklist.md` 작성:
  - 14 task 산출물 맵
  - 게이트 결과표
  - Known Concerns (R10 인수인계)
  - Decision Log D1~D8 요약
  - R10/R11 forward pointers
- [ ] spec §10 R9 블록: `[ ]` → `[x]` 전환
- [ ] tasks.json 14/14 status='completed'
- [ ] 커밋: `chore(rolestra): R9 closeout — done-checklist + tasks 14/14 (R9-Task13)`

**AC**:
- 정식 게이트 전체 녹색
- r9-done-checklist.md 작성
- §10 R9 모든 ✓
- tasks.json 14/14 completed

**Testing**: 전 게이트 스위트.

---

## Decision Log (D1~D8)

**D1 — AutonomyGate 배치 (R9 에서)**
- 결정: `AutonomyGate` 는 ApprovalService 'created' 이벤트 훅으로 구현. ApprovalService 내부에 if 분기 추가하지 않고 별도 모듈로 분리.
- 이유: (i) ApprovalService 의 단일 책임 유지 (승인 상태 머신), (ii) 테스트 용이 (AutonomyGate 단독 테스트 가능), (iii) R10 에서 autonomy 정책이 복잡해져도 ApprovalService 가 오염되지 않음.
- 대안: ApprovalService.create 내부 분기 — 결합도 상승으로 각하.

**D2 — Circuit Breaker persistence (R9 범위 밖)**
- 결정: `CircuitBreaker` 는 R9 에서도 in-memory. 재시작 시 counter 리셋 (CD-2 명시).
- 이유: (i) `cumulative_cli_ms` 외 3 tripwire 는 turn/queue/error 단위로 자연 리셋, (ii) `cumulative_cli_ms` 는 재시작 시 reset 이 오히려 사용자 친화 (장시간 중단 후 재개), (iii) persist 하려면 새 테이블 + 주기적 flush 필요 — R10 이후.
- 대안: `notification_log` 에 fired 이력 저장 (이미 가능 — audit 용). Counter 자체 persist 는 아님.

**D3 — Drag-and-drop (QueuePanel 순서 변경)**
- 결정: HTML5 native `draggable=true` + React state 로 구현. `@dnd-kit/core` 같은 라이브러리 도입 안 함.
- 이유: (i) 5~20 항목 예상 규모, (ii) mobile 미지원이어도 OK (Electron desktop), (iii) R8 의 "신규 dep 최소화" 기조 유지.
- 대안: R10 에서 접근성/UX 이슈가 생기면 `@dnd-kit` 검토.

**D4 — AutonomyConfirmDialog 적용 범위**
- 결정: manual → auto_toggle / manual → queue 두 전환만 확인 다이얼로그. auto_toggle ↔ queue / 다운그레이드는 바로.
- 이유: (i) 두 전환 모두 circuit breaker 동일 적용, 이미 auto_toggle 에서 확인했으니 queue 로 추가 확인은 노이즈, (ii) manual 로의 다운그레이드는 안전 방향이므로 마찰 최소화.
- 대안: 모든 전환 확인 — 사용자가 싫어할 가능성.

**D5 — AutonomyGate 실패 경로 자동 다운그레이드**
- 결정: `review_outcome=rework/fail` 이나 CLI 실패 등 "실패 조건" 시 해당 approval_item 은 decide 하지 않고 (대기 상태), 프로젝트 autonomyMode 를 manual 로 다운그레이드. 사용자가 봐서 처리.
- 이유: (i) 자동 accept 가 accepted 에만 적용되어야 하는 spec §8 준수, (ii) 실패 시 item 을 자동으로 decide=rejected 하면 사용자가 근거를 잃음.
- 대안: decide('rejected') + downgrade — approval-decision-router 와 충돌 가능.

**D6 — Notification seed 타이밍**
- 결정: 부팅 시 `seedDefaultPrefsIfEmpty()` — 최초 1회 INSERT OR IGNORE. 사용자가 kind 별 prefs 를 수정한 뒤 row 를 삭제하는 일은 없음(UI 는 row UPSERT 만 제공).
- 이유: (i) prefs 가 DB 에 존재해야 `NotificationService.show` 가 gate 판정 가능, (ii) migration 에 DEFAULT value 넣는 대신 seed 로 분리 — 추후 값 변경 유연.
- 대안: migration 011 에 기본 row INSERT — 마이그레이션 재실행 시 덮어쓰지 않도록 `INSERT OR IGNORE` 사용해야 함. 큰 차이 없음 — seed 방식 채택.

**D7 — 외근 자동 timeout 평가 시점**
- 결정: `getWorkStatus` 호출 시 lazy evaluation. 별도 timer/스케줄러 없음.
- 이유: (i) timer 는 Electron 재시작 시 복구 필요, (ii) lazy 는 구현 단순 + 정확, (iii) getWorkStatus 는 자주 호출되므로 실시간성 충분.
- 대안: `node-cron` 또는 setInterval — 과대설계. R10 에서 실시간 UI 요구가 생기면 `stream:member-status-changed` 와 함께 도입.

**D8 — i18n main-process 라벨 전략**
- 결정: `notification.*` top-level namespace 는 ko/en 양쪽 populate + i18next-parser keepRemoved regex 에 `notification.*` 포함. main-process 는 `src/main/notifications/notification-labels.ts` 에 locale resolver dictionary 를 두어 key 로 lookup (main 이 i18next 를 직접 import 하지 않음 — 의존성 방향 유지).
- 이유: (i) main-process 에서 i18next 를 init 하면 번들 크기 상승 + SSR 패턴 흉내, (ii) 대신 간단한 dictionary map 이 충분, (iii) renderer orphan-prune 에서 `notification.*` key 가 살아남아야 Renderer 도 같은 문자열 접근 가능.
- 대안: main-process 도 i18next init — R10 이후 필요시.

---

## Known Concerns (R10 인수인계 — TBD 후 done-checklist 에 기록)

- (R9 진행 중 발생하면 각 Task 내 주석 + 마지막 Task 13 closeout 시점에 done-checklist 에 정리)
- 초기 예상:
  - `circuit_breaker` kind 의 approval UI 정식 편입 (R9 는 kind 만, R10 ApprovalInbox 에 `circuit_breaker` row 표시)
  - Queue pause 중 사용자가 추가한 항목은 resume 시 꺼내지는가? (R9 는 pending 유지 → resume 하면 startNext 에서 꺼냄 — 명세 유지)
  - NotificationService.show 내부에서 `app.isFocused()` 는 macOS BrowserWindow 포커스와 다름 — Electron 네이티브 Focus API 로 대체 (R10)
  - Warmup backoff 중 provider 가 `disable` 되면 retry 취소되는가? — R9 에서는 provider.disabled 체크 추가 필요
  - R8 D8 "stream:member-status-changed" 는 R9 Task 10 의 `emit('status-changed')` 스텁이 있지만 stream broadcast 는 R10 예정

---

(이 plan 은 R9 세션 중 구현 진행에 따라 각 Task 의 `[ ]` 를 `[x]` 로 갱신하며 진화한다. Task 13 의 done-checklist 에 최종 산출물 + Known Concerns 를 정리한다.)
