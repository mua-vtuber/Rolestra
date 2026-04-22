# Rolestra Phase R7 — 승인 시스템(ApprovalInbox + CLI permission adapter v3 전면 교체) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** R6 까지 회의(SSM) 본체가 동작하는 상태 위에 **사용자 승인(Approval)** 을 붙인다. R7 종료 시 앱에서 (a) CLI 프로세스가 권한 prompt 를 던지면 Rolestra Main 이 `ApprovalService.create({kind:'cli_permission', ...})` 로 승인 요청을 올리고, `approval:decided` 이벤트로 Promise 를 resolve 하여 CLI 스트림을 흐른다(= v2 `registerPendingCliPermission` 메모리-레지스트리 완전 삭제), (b) `approval_items.status='pending'` 행이 생기는 순간 StreamBridge 가 `stream:approval-created` 를 발사해 Renderer 의 `usePendingApprovals` / `ApprovalInboxView` / `ApprovalsWidget` 이 폴링 없이 실시간 갱신, (c) 사용자가 `#승인-대기` 시스템 채널 또는 Thread 에 뜬 `<ApprovalBlock>` 에서 허가/거절/조건부 3 버튼 중 하나를 누르면 `approval:decide` IPC 가 호출되고 `ApprovalService.decide` 가 row 를 terminal state 로 전이 + 'decided' 이벤트 emit, (d) 거절/조건부 의 `comment` 는 다음 턴 시스템 메시지로 해당 AI 에게 주입(spec §7.7), (e) 프로젝트 `permission_mode` 변경(auto↔hybrid↔approval) 요청은 `kind='mode_transition'` approval 로 게이팅, (f) 회의 합의(SSM=DONE) 결과 역시 `kind='consensus_decision'` approval 로 게이팅해 사용자가 최종 sign-off 해야 `#회의록` 포스팅 + Meeting 종료 레코드가 확정, (g) OS 시스템 알림(NotificationService) 이 `kind='approval_pending'` 으로 트리거, (h) 대시보드 🔔 ApprovalsWidget 의 row 클릭이 `#승인-대기` 채널로 라우팅.

**Overview (자연어, 비코더용):**

- R2~R6 에서 승인 "창고" (approval_items 테이블, ApprovalService, IPC list/decide, 대시보드 위젯, Thread 의 ApprovalBlock) 는 이미 만들어져 있다. 하지만 **어디에서도 실제로 승인 요청을 생성하지 않고**, 누르는 버튼도 placeholder 콜백만 있다. R7 이 그 끊어진 회로를 전부 잇는다.
- 가장 큰 부채는 **CLI permission v2 잔재**다. CLI 프로세스(특히 Codex hybrid 모드 / Claude Bash) 가 권한 prompt 를 던지면, 현재 `MeetingTurnExecutor` 는 v2 시절 메모리 Map `pendingRequests` 에 resolver 를 등록(`registerPendingCliPermission`)하고 renderer 에 `stream:cli-permission-request` 를 날린다. Renderer 는 ApprovalBlock 이 아닌 별도 경로로 허가/거절을 돌려보내고, `cli-permission:respond` IPC 가 그 Map 에서 resolver 를 찾아 부른다. 이 경로는 (i) DB 에 남지 않고 (ii) 대시보드/시스템 채널 연동 0 이고 (iii) 앱 재시작 시 모든 pending 이 증발한다. R7 은 이 경로 전체를 ApprovalService 단일 창구로 redirect 하고, 옛 Map/IPC/stream 이벤트/preload 화이트리스트 전부 제거한다.
- 두 번째 축은 **실시간 스트림**. 지금 대시보드 🔔 위젯과 ApprovalInbox 는 mount 시점에만 `approval:list` 폴링을 한 번 돌린다. ApprovalService 가 이미 EventEmitter 로 `'created'` / `'decided'` 를 쏘니까, main/index.ts 에서 그 listener 를 StreamBridge 로 redirect 만 하면 된다. Renderer `usePendingApprovals` 는 mount 시 초기 fetch + stream 구독으로 naturally 합쳐진다.
- 세 번째 축은 **3 종 approval kind 의 실제 발사 지점**. 
  - `cli_permission` — `MeetingTurnExecutor` 의 `setPermissionRequestCallback` 내부에서 create 호출 (Task 3)
  - `mode_transition` — `ProjectService.updatePermissionMode` (신규) 가 create 호출, decide 후 실제 적용 (Task 8)
  - `consensus_decision` — `v3-side-effects` 의 SSM DONE 리스너가 create 호출, decided 전에는 `MeetingMinutesComposer` 포스팅이 대기(Task 9)
  - (참고) `review_outcome` / `failure_report` 는 R8 이후의 autonomy 시스템에서 발사. R7 에서는 kind enum 만 두고 발사 지점 0.
- 네 번째 축은 **거절/조건부 comment 의 시스템 메시지 주입**(spec §7.7). 거절 코멘트 "이건 건드리지마" 나 조건부 코멘트 "이 파일만, 커밋은 하지마" 는 `ApprovalService` 의 `'decided'` payload 에 실려온다. 신규 `ApprovalSystemMessageInjector` 가 이 이벤트를 구독해서 해당 meeting 의 MessageService 에 `kind='system'` 시스템 메시지로 append 한다. 다음 턴 speaker 의 history 에 자연스럽게 합쳐져 AI 가 사용자의 거절 이유를 읽게 된다.
- 다섯 번째 축은 **UX 잔손질**: ApprovalBlock 의 `onDecision` placeholder 를 실제 `approval:decide` IPC 호출로 교체(+ 거절/조건부 다이얼로그 코멘트 입력). ApprovalInboxView 는 `#승인-대기` 시스템 채널 Thread 에 전용 렌더링 path 를 붙인다 — 일반 Thread 와 달리 `status='pending'` 인 approval 을 ApprovalBlock 리스트로 나열(decided 된 것은 숨김 또는 outcome 시스템 메시지로 내려감). 대시보드 위젯 `onRowActivate` 는 activeChannelStore 의 `setActiveChannel(#승인-대기)` 를 호출하고 messenger 뷰로 라우팅.
- 여섯 번째 축은 **알림 트리거**: NotificationService 가 ApprovalService `'created'` 이벤트를 구독해, `kind ∈ {cli_permission, mode_transition, consensus_decision}` 이고 앱이 포커스 없을 때 OS 알림을 띄운다. 이미 R6 에서 NotificationService 가 부팅되어 있으므로 배선만 추가.
- **SSM 은 건드리지 않는다.** `session-state-machine.ts` 의 `CLI_PERMISSION_REJECTED` 이벤트는 R7 에서는 **발사하지 않는다**. 거절은 Promise resolve(false) 로 CLI 에 반환되고, 코멘트가 시스템 메시지로 주입되는 것으로 충분. SSM 전이는 R10 에서 autonomy 규칙이 생긴 뒤 재검토.
- R6 의 known concern 4번(`CLI permission 흐름 v2 registerPendingCliPermission 유지`) 이 R7 에서 **완전히 해소**된다. `cli-permission-handler.ts` 파일과 `cli-permission:respond` IPC 는 삭제 대상이며, `stream:cli-permission-request` 이벤트 타입과 preload 화이트리스트 항목도 함께 제거한다. 이 3 파일 삭제가 R7 의 물리적 청산 지표.
- **보안 invariant (spec §7.6.1/§7.3 재확인)**: external 프로젝트 + auto 모드 금지 규칙은 R7 의 mode_transition approval 에서도 유지되어야 한다. `ProjectService.updatePermissionMode` 는 decide 후 적용 전 `assertExternalNotAuto` 재검증, 위반 시 approval 이 이미 approved 여도 apply 단계에서 `ApprovalError` 던지고 status 를 `superseded` 로 돌린다. 테스트 커버.
- `spec §10 R7 체크박스` 확장과 Decision Log 는 Task 0 에서 먼저 한다. 구현 중 모호함은 **반드시 spec 을 먼저 갱신**한 뒤 코드를 고친다(R2~R6 규약).
- 데이터 모델은 **추가 이동 없음**. `approval_items` (migration 006) 그대로. 신규 컬럼도 없다. `payload_json` 이 `unknown` 으로 유연하므로 kind 별 payload 스키마는 타입 레벨에서만 zod `ApprovalPayload` discriminated union 으로 추가(Task 1).

**Architecture:**

- Layering: `renderer → shared → preload(contextBridge) → main`. R3~R6 구조 그대로.
- Main 재사용:
  - `src/main/approvals/approval-service.ts` — create / decide / list / expire / supersede (EventEmitter 'created' / 'decided')
  - `src/main/approvals/approval-repository.ts` — idempotent insert + status UPDATE, hard-DELETE 금지 (CB-7)
  - `src/main/ipc/handlers/approval-handler.ts` — `approval:list` / `approval:decide` (IPC 2 endpoint)
  - `src/main/streams/stream-bridge.ts` — 기존 R6 `meeting:*` 옆에 `approval:*` 추가
  - `src/main/notifications/notification-service.ts` — `approval_pending` kind 배선
  - `src/main/meetings/engine/meeting-turn-executor.ts` — CLI permission 경로 교체
  - `src/main/engine/v3-side-effects.ts` — SSM DONE → consensus_decision approval 발사 (추가)
  - `src/main/projects/project-service.ts` — `updatePermissionMode(projectId, targetMode)` 신규 (mode_transition 발사 + decided 후 apply)
- Main 신규 파일:
  - `src/main/approvals/approval-stream-adapter.ts` — ApprovalService EventEmitter → StreamBridge bridge (main/index.ts 에서 1회 wire, disposer 관리)
  - `src/main/approvals/approval-cli-adapter.ts` — MeetingTurnExecutor 가 사용. `createCliPermissionApproval(ctx) → Promise<boolean>` (create + subscribe-once + timeout + auto-expire)
  - `src/main/approvals/approval-system-message-injector.ts` — `'decided'` 이벤트 구독 → reject/conditional comment 를 `MessageService.append(kind='system')` 로 주입
- Main 삭제 (R11 물리 삭제가 아닌 R7 즉시 삭제):
  - `src/main/ipc/handlers/cli-permission-handler.ts` — v2 Map 기반 pending-request
- Shared:
  - `src/shared/approval-types.ts` — `ApprovalPayload` discriminated union 추가 (kind 별 payload 타입)
  - `src/shared/approval-stream-events.ts` — 신규. `stream:approval-created` / `stream:approval-decided` discriminated union + zod
  - `src/shared/ipc-types.ts` — `cli-permission:respond` 채널 제거, 나머지 approval:* 는 R2 에서 이미 선언
  - `src/shared/stream-types.ts` — `stream:cli-permission-request` 제거, `stream:approval-*` 참조 추가
  - `src/shared/stream-events.ts` — 기존 `stream:approval-created/decided` 스키마 재검토, kind 확장 반영
- Renderer 재작성:
  - `src/renderer/features/messenger/ApprovalBlock.tsx` — `onDecision` placeholder 제거, 실 IPC 호출 + 거절/조건부 시 다이얼로그 open
  - `src/renderer/hooks/use-pending-approvals.ts` — mount-fetch → stream 구독 병행 (initial fetch + `stream:approval-*` 리듀서)
  - `src/renderer/features/dashboard/widgets/ApprovalsWidget.tsx` — `onRowActivate` 라우팅 wire (activeChannelStore + view navigation)
  - `src/renderer/features/messenger/Thread.tsx` — `#승인-대기` 채널(kind='system_approval') 분기 렌더 path 추가 (pending approval 리스트 → ApprovalBlock 반복)
- Renderer 신규 파일:
  - `src/renderer/features/approvals/ApprovalInboxView.tsx` — `#승인-대기` 채널 Thread 전용 컨테이너
  - `src/renderer/features/approvals/RejectDialog.tsx` — 코멘트 입력 다이얼로그 (Radix)
  - `src/renderer/features/approvals/ConditionalDialog.tsx` — 조건 입력 다이얼로그
- Renderer 삭제:
  - `src/renderer` 쪽 `stream:cli-permission-request` 구독자 (Thread/Composer 의 legacy subscriber, 존재 시)
- State flow:
  - CLI permission request:
    1. Provider 가 parser 에서 권한 prompt 파싱 → `permissionRequestCallback(participantId, req)` 호출.
    2. `MeetingTurnExecutor.setupCliPermissionCallback` 이 `ApprovalCliAdapter.createCliPermissionApproval({meetingId, channelId, projectId, participantId, request})` 호출 → ApprovalService.create + subscribe-once('decided') → Promise<boolean>.
    3. `ApprovalStreamAdapter` 가 `'created'` 이벤트를 받아 StreamBridge.emit('stream:approval-created') 발사.
    4. Renderer `usePendingApprovals` 가 이벤트 수신 → state 갱신 → ApprovalInboxView / Thread / ApprovalsWidget 재렌더.
    5. 사용자가 ApprovalBlock 버튼 클릭 → `approval:decide` IPC → ApprovalService.decide → 'decided' 이벤트.
    6. `ApprovalCliAdapter` 의 subscribe-once 가 resolve(approved) → CLI Promise 풀림 → CLI 스트림 재개.
    7. 병행: `ApprovalStreamAdapter` 가 StreamBridge.emit('stream:approval-decided'), `ApprovalSystemMessageInjector` 가 reject/conditional comment 를 MessageService.append.
  - Mode transition:
    1. Renderer 설정 UI → `project:update-permission-mode(projectId, targetMode)` IPC → ProjectService.updatePermissionMode.
    2. 활성 Meeting 체크(CB-3), `external + auto` 체크(§7.3), external 실경로 TOCTOU(§7.6.2) 모두 pass 면 ApprovalService.create({kind:'mode_transition', projectId, payload:{currentMode, targetMode, reason}}).
    3. 사용자가 ApprovalInboxView 에서 허가 → ApprovalService.decide('approve') → 'decided' 이벤트 → ProjectService.apply 가 DB `projects.permission_mode` UPDATE + 배너 emit ("다음 회의부터 적용").
    4. 거절 시 apply 없음. 조건부는 spec §7.7 상 조건 의미가 mode 변경에는 애매하므로 R7 에서 **조건부 버튼 비활성 + 툴팁** 으로 시각 처리(D3). R10 UX refine 에서 재검토.
  - Consensus decision:
    1. MeetingOrchestrator 가 SSM DONE 도달 → v3-side-effects 리스너 실행.
    2. R6 은 DONE 순간 바로 MinutesComposer 포스팅했지만, R7 은 그 사이에 ApprovalService.create({kind:'consensus_decision', meetingId, channelId, projectId, payload:{snapshot, votes, finalText}}) 를 끼운다.
    3. 'decided' 이벤트 대기 — approve: MinutesComposer 포스팅 + Meeting.finish(outcome='accepted'), reject: Meeting.finish(outcome='rejected') + `#회의록` 에 거절 시스템 메시지 포스팅, conditional: approve 경로 + 시스템 메시지 주입.
    4. `consensus_decision` approval 은 timeout 이 길다(기본 24h — D4). 사용자 부재 중 회의가 멈추지 않도록 autonomy 모드가 R9 에서 auto-approve 경로 추가 예정(R7 에서는 수동 승인만).
- Testing: Vitest (service adapter, stream adapter, system-message injector, project-service updatePermissionMode), jsdom (ApprovalBlock onDecision + dialogs, ApprovalInboxView, ApprovalsWidget 라우팅, usePendingApprovals 스트림 병합), Playwright `_electron` E2E 1 시나리오(CLI permission 승인 또는 consensus decision 승인 중 택1 — mock provider + mock CLI).

**Tech Stack (R7 추가):**

- 기존(R6까지): TypeScript strict / React 19 / Electron 40 / Vite / Vitest (jsdom) / i18next / zod / zustand / Tailwind / Radix / framer-motion / cva / clsx / @playwright/test
- 신규: **없음**. 기존 IPC/zod/zustand/Radix Dialog 패턴 재활용.

**참조:**

- Spec:
  - `docs/superpowers/specs/2026-04-18-rolestra-design.md` §3 용어집(ApprovalInbox), §5.2 migration 006(approval_items), §6 IPC(`approval:list`/`approval:decide`, `stream:approval-*`), §7.4 `#승인-대기` 시스템 채널, §7.6/§7.3 mode transition 제약(CB-3, 외부+auto 금지), §7.7 허가/거절/조건부 UX + comment→시스템 메시지 주입, §7.8 NotificationService(`approval_pending`), §10 Phase R7(Task 0 에서 R3~R6 템플릿으로 확장), §부록 A v2→v3 델타
  - `docs/superpowers/specs/r6-done-checklist.md` "Known Concerns (R7 인수인계)" 1/4/5항
- R6 plan/done-checklist: `docs/superpowers/plans/2026-04-22-rolestra-phase-r6.md`, `docs/superpowers/specs/r6-done-checklist.md`
- Main 재사용 모듈:
  - `src/main/approvals/{approval-service,approval-repository}.ts` (R2)
  - `src/main/streams/stream-bridge.ts` (R2 + R6 확장)
  - `src/main/meetings/engine/{meeting-orchestrator,meeting-turn-executor}.ts` (R6)
  - `src/main/engine/v3-side-effects.ts` (R2 Task 20, R6 wiring)
  - `src/main/notifications/notification-service.ts` (R6 부팅)
  - `src/main/projects/project-service.ts` (R4)
  - `src/main/providers/cli/{cli-provider,permission-adapter,cli-permission-parser}.ts` (R2)
  - `src/main/ipc/handlers/approval-handler.ts` (R2)
- R7 제거 대상:
  - `src/main/ipc/handlers/cli-permission-handler.ts` — 파일 삭제
  - `src/shared/ipc-types.ts` `cli-permission:respond` — 채널 제거
  - `src/shared/stream-types.ts` `stream:cli-permission-request` — 이벤트 제거
  - preload 화이트리스트의 cli-permission:* — 제거
  - legacy `stream:cli-permission-request` 구독자(renderer) — 제거
- Renderer:
  - `src/renderer/features/messenger/ApprovalBlock.tsx` — onDecision wire
  - `src/renderer/hooks/use-pending-approvals.ts` — stream 전환
  - `src/renderer/features/dashboard/widgets/ApprovalsWidget.tsx` — onRowActivate wire
  - `src/renderer/features/messenger/Thread.tsx` — `#승인-대기` kind='system_approval' 분기 path
  - `src/renderer/stores/active-channel-store.ts` — 라우팅 setActiveChannel 재사용
  - `src/renderer/features/approvals/` — 신규 디렉토리(ApprovalInboxView / RejectDialog / ConditionalDialog)

---

## Prereqs

- [x] R6 전체 완료(14/14) + main ff-merge (2026-04-22)
- [x] R6 done-checklist 작성 및 Known Concerns 6항 문서화
- [x] ApprovalService (create/decide/list/expire/supersede) + repository + IPC handler + DB migration 006 (R2 기반)
- [x] ApprovalBlock (Thread 블록) / ApprovalsWidget (dashboard) / usePendingApprovals (mount-fetch) UI 컴포넌트 (R4/R5)
- [x] StreamBridge 가 meeting:* 이벤트 이미 커버 (R6 Task 1)
- [x] NotificationService 부팅 + MeetingOrchestrator 와 연동 (R6)
- [ ] `rolestra-phase-r7` 브랜치 `main`(`1bfa3e1`)에서 생성 (Task 0 첫 step)
- [ ] spec §10 R7 블록 R3~R6 템플릿으로 확장 (Task 0)

---

## File Structure (R7 종료 시)

```
src/
├── main/
│   ├── approvals/
│   │   ├── approval-service.ts                     # (변경 없음) R2
│   │   ├── approval-repository.ts                  # (변경 없음) R2
│   │   ├── approval-stream-adapter.ts              # NEW (Task 2) ApprovalService → StreamBridge
│   │   ├── approval-cli-adapter.ts                 # NEW (Task 3) MeetingTurnExecutor 용
│   │   ├── approval-system-message-injector.ts    # NEW (Task 6) reject/conditional comment 주입
│   │   └── __tests__/*.test.ts                     # 각 파일 테스트
│   ├── ipc/handlers/
│   │   ├── approval-handler.ts                    # (변경 없음) R2
│   │   └── cli-permission-handler.ts              # DELETE (Task 4) v2 Map 기반 pending-map 폐기
│   ├── streams/
│   │   └── stream-bridge.ts                       # + stream:approval-created/decided 이벤트
│   ├── meetings/engine/
│   │   └── meeting-turn-executor.ts               # setPermissionRequestCallback 전면 교체 (Task 3)
│   ├── engine/
│   │   └── v3-side-effects.ts                     # SSM DONE → consensus_decision approval 게이트 (Task 9)
│   ├── notifications/
│   │   └── notification-service.ts                # + approval_pending 트리거 (Task 11)
│   ├── projects/
│   │   └── project-service.ts                     # + updatePermissionMode (Task 8)
│   └── index.ts                                    # + ApprovalStreamAdapter / ApprovalSystemMessageInjector DI 배선
├── renderer/
│   ├── features/
│   │   ├── messenger/
│   │   │   ├── ApprovalBlock.tsx                  # onDecision wire (Task 5)
│   │   │   └── Thread.tsx                         # #승인-대기 채널 분기 렌더 (Task 7)
│   │   ├── approvals/                             # NEW 디렉토리 (Task 7)
│   │   │   ├── ApprovalInboxView.tsx              # NEW
│   │   │   ├── RejectDialog.tsx                   # NEW
│   │   │   ├── ConditionalDialog.tsx              # NEW
│   │   │   └── __tests__/*.test.tsx
│   │   └── dashboard/widgets/
│   │       └── ApprovalsWidget.tsx                # onRowActivate wire (Task 10)
│   ├── hooks/
│   │   └── use-pending-approvals.ts               # mount-fetch → stream 구독 병행 (Task 2)
│   ├── ipc/
│   │   └── invoke.ts                              # `cli-permission:respond` 제거
│   └── i18n/locales/{ko,en}.json                  # approval.* + messenger.approval.* + dashboard.approvals.* 확장 (Task 12)
├── shared/
│   ├── approval-types.ts                          # + ApprovalPayload discriminated union
│   ├── approval-stream-events.ts                  # NEW stream:approval-* 타입 + zod
│   ├── ipc-types.ts                               # cli-permission:respond 제거
│   ├── stream-types.ts                            # stream:cli-permission-request 제거
│   └── stream-events.ts                           # stream:approval-* 확장 확인
├── preload/
│   └── index.ts                                   # cli-permission:* 제거, approval:* 확인
├── docs/
│   └── superpowers/
│       ├── plans/
│       │   ├── 2026-04-22-rolestra-phase-r7.md       # (this file)
│       │   └── 2026-04-22-rolestra-phase-r7.md.tasks.json
│       └── specs/
│           ├── 2026-04-18-rolestra-design.md        # +§10 R7 체크박스 확장 (Task 0)
│           └── r7-done-checklist.md                 # NEW (Task 13)
├── e2e/
│   └── approval-flow.spec.ts                       # NEW (Task 12)
└── i18next-parser.config.js                         # +approval.* dynamic 키 보호 regex (Task 12 필요 시)
```

**파일 요약:**
- 신규 main: 3 approval adapter 파일 + 각 테스트
- 신규 renderer: 3 feature 파일 (ApprovalInboxView/RejectDialog/ConditionalDialog) + 테스트
- 수정 main: stream-bridge, meeting-turn-executor, v3-side-effects, notification-service, project-service, index.ts
- 수정 renderer: ApprovalBlock, Thread, ApprovalsWidget, use-pending-approvals, invoke, i18n ko/en
- 수정 shared: approval-types, ipc-types, stream-types, stream-events, preload
- 신규 shared: approval-stream-events.ts
- 삭제: cli-permission-handler.ts, cli-permission:respond 채널, stream:cli-permission-request 이벤트, preload 화이트리스트 cli-permission:*, renderer legacy subscriber

---

## Tasks

### Task 0 — Branch + spec §10 R7 확장 + plan + tasks.json + Decision Log

**목표**: R7 브랜치를 main tip(`1bfa3e1`)에서 파고, spec §10 R7 블록을 R3/R4/R5/R6 템플릿(체크박스 + 산출물 링크)으로 확장, Decision Log 기록.

- [x] `git checkout -b rolestra-phase-r7` from main tip (`1bfa3e1`)
- [ ] spec §10 R7 블록 확장:
  - `- [ ]` 항목 13~14개(Task 1~13 산출물과 1:1)
  - **scope 경계** 하단 블록: R8(멤버 프로필/출근 상태), R9(autonomy 자동 승인), R10(UX refine/조건부 mode transition), R11(legacy 파일 물리 삭제 — 단 cli-permission-handler 는 R7 즉시 삭제)
  - plan/done-checklist 링크 placeholder
- [ ] `docs/superpowers/plans/2026-04-22-rolestra-phase-r7.md.tasks.json` 생성 (14 task slot)
- [ ] Decision Log (본 plan 끝에 Decision Log 섹션 추가):
  - **D1 물리 삭제 타이밍**: `cli-permission-handler.ts` 는 R11 의 legacy 5파일 일괄 삭제 정책과 달리 R7 Task 4 에서 즉시 삭제한다. 이유: v2 engine 5파일은 호출자 0 이어도 assets (SSM 등) 와 같은 디렉토리에 있어 R11 에 묶는 가치가 있지만, cli-permission-handler 는 독립 파일이고 남겨두면 import 회귀가 일어난다
  - **D2 CLI permission adapter 계약**: `createCliPermissionApproval(ctx) → Promise<boolean>` 는 timeout 을 기본 **5분** 두고, 만료 시 `ApprovalService.expire` + resolve(false). 이유: CLI 프로세스가 무한정 블락되면 회의 전체가 멈추고, 사용자 부재 시나리오에서는 거절과 동일한 효과가 합리적 default
  - **D3 mode_transition 조건부 허가 보류**: 조건부(conditional) 는 cli_permission / consensus_decision 에만 의미가 있고 mode_transition 에는 "조건" 개념이 애매하다(부분 적용 불가). R7 에서는 ApprovalInboxView 가 `kind='mode_transition'` 일 때 조건부 버튼을 비활성 + 툴팁 "모드 변경에는 조건부 승인이 지원되지 않습니다"
  - **D4 consensus_decision timeout**: 기본 **24시간**. cli_permission 의 5분과 다른 이유는, 사용자가 회의 결과를 즉시 검토하지 않아도 워크플로가 망가지지 않아야 하기 때문. 만료 시 `'expired'` 전이 + `#회의록` 에 "승인 만료로 자동 종료" 시스템 메시지 포스팅. autonomy auto-approve 는 R9
  - **D5 `ApprovalPayload` discriminated union 위치**: `src/shared/approval-types.ts` 에 `cli_permission` / `mode_transition` / `consensus_decision` payload 타입을 추가한다. `review_outcome` / `failure_report` 는 R8 에서 발사 지점이 생길 때 payload 정의. R7 에서는 enum 만 존재하고 payload 타입은 `unknown` 유지
  - **D6 스트림 이벤트 이름**: `stream:approval-created` / `stream:approval-decided` — 기존 `stream-events.ts` 에 이미 선언되어 있으므로 재사용. meeting:* 처럼 접두사를 바꾸지 않는다(이유: approval 은 회의 범위가 아닌 시스템 전역 개념이라 `meeting:*` 접두사가 부적절)
  - **D7 거절 comment 주입 범위**: 거절/조건부 comment 는 해당 approval 의 `meetingId` 가 있을 때만 MessageService.append 로 주입. `meetingId=null` (예: mode_transition) 은 시스템 메시지 주입 없이 UI 만 업데이트. 이유: DM/프로젝트 광역 approval 은 "다음 턴" 이라는 시간 개념이 없고 주입 대상 채널이 모호
  - **D8 v2 `stream:cli-permission-request` 제거**: Task 4 에서 preload/shared 타입/renderer 구독자 일괄 제거. 잔존 legacy subscriber 가 있으면 `legacy-channel-isolation.test.ts` 가 이미 R3 에서 깐 격리 테스트로 회귀 방지
- [ ] 커밋: `docs(rolestra): R7 plan + tasks.json + spec §10 R7 체크리스트 확장 (R7-Task0)`

**AC**:
- `rolestra-phase-r7` 브랜치 존재
- spec §10 R7 블록 체크박스 + scope 경계 + 링크 placeholder
- tasks.json 14-slot skeleton
- Decision Log 8건 기록

**Testing**: N/A (docs-only commit)

---

### Task 1 — Shared `approval-stream-events.ts` + `ApprovalPayload` discriminated union

**목표**: approval 관련 stream 이벤트 타입을 shared 로 추상화하고, `approval-types.ts` 에 kind 별 payload 타입을 추가한다.

- [ ] `src/shared/approval-stream-events.ts` 신규:
  - Discriminated union 2종:
    - `{ type: 'stream:approval-created', item: ApprovalItem }`
    - `{ type: 'stream:approval-decided', item: ApprovalItem, decision: ApprovalDecision, comment: string | null }`
  - 각 타입에 zod schema export (`streamApprovalCreatedSchema`, `streamApprovalDecidedSchema`)
- [ ] `src/shared/approval-types.ts` 확장:
  - `ApprovalPayload` discriminated union:
    - `{ kind: 'cli_permission', cliRequestId: string, toolName: string, target: string, description: string | null, participantId: string, participantName: string }`
    - `{ kind: 'mode_transition', currentMode: PermissionMode, targetMode: PermissionMode, reason?: string }`
    - `{ kind: 'consensus_decision', snapshotHash: string, finalText: string, votes: VoteTally }`
    - (R8 이후 kind 는 R7 에서 미정의)
  - `ApprovalItem.payload` 타입을 `unknown → ApprovalPayload | unknown` 로 점진 이행(기존 row 호환을 위해 `unknown` union 유지)
- [ ] `src/shared/stream-events.ts` — 기존 `stream:approval-created/decided` 선언을 `approval-stream-events.ts` 로 re-export 하고 타입 일치 확인
- [ ] `__tests__/approval-stream-events.test.ts`: zod round-trip 6~8 케이스
- [ ] 커밋: `feat(rolestra): approval stream events + ApprovalPayload discriminated union (R7-Task1)`

**AC**:
- `ApprovalPayload` 3 kind discriminated union
- stream:approval-* 2 이벤트 타입 + zod
- 기존 ApprovalItem 참조 타입 회귀 0 (typecheck exit 0)
- zod round-trip 테스트 green

**Testing**: Vitest schema round-trip, 기존 approval-service 테스트 regression 없음.

---

### Task 2 — ApprovalService → StreamBridge bridge (`ApprovalStreamAdapter`) + `usePendingApprovals` 실시간 전환

**목표**: ApprovalService 의 `'created'` / `'decided'` 이벤트를 StreamBridge 로 redirect 해서 Renderer 가 폴링 없이 실시간 반영.

- [ ] `src/main/approvals/approval-stream-adapter.ts` 신규:
  - `class ApprovalStreamAdapter { constructor(private svc: ApprovalService, private bridge: StreamBridge); wire(): Disposer; }`
  - `svc.on('created', item => bridge.emit('stream:approval-created', { item }))`
  - `svc.on('decided', payload => bridge.emit('stream:approval-decided', payload))`
  - Disposer = off listeners (test cleanup + app shutdown)
- [ ] `src/main/streams/stream-bridge.ts`:
  - `emitApprovalCreated(item)` / `emitApprovalDecided(payload)` 메서드 (개발 모드 zod 검증 경유)
  - (또는 기존 generic `emit(type, payload)` API 가 이미 있으면 활용. R6 meeting:* 패턴 참조)
- [ ] `src/main/index.ts`:
  - `approvalStreamAdapter = new ApprovalStreamAdapter(approvalService, streamBridge); approvalStreamAdapter.wire();`
  - app shutdown 시 disposer 호출
- [ ] `src/preload/index.ts`: `stream:approval-*` 이벤트 구독 API 화이트리스트 추가 (기존 `stream:approval-*` 가 이미 있다면 확인만)
- [ ] `src/renderer/hooks/use-pending-approvals.ts`:
  - mount 시 기존 `approval:list` fetch(초기값) + stream 이벤트 구독을 병행
  - `stream:approval-created` → items 배열에 prepend (status='pending' 이므로 화면 반영)
  - `stream:approval-decided` → 해당 id 를 items 에서 제거(또는 status 업데이트. pending-only 훅이라 제거)
- [ ] `__tests__/approval-stream-adapter.test.ts`: wire/dispose, 이벤트 전파, listener 예외 격리 (service 테스트 패턴 재사용)
- [ ] `__tests__/use-pending-approvals.test.tsx` 확장: mount + stream event 병합 + dispose 누수 0
- [ ] 커밋: `feat(rolestra): ApprovalStreamAdapter + usePendingApprovals live stream (R7-Task2)`

**AC**:
- ApprovalService.create → stream:approval-created emit 확인
- ApprovalService.decide → stream:approval-decided emit 확인
- Renderer hook mount-fetch + stream 병합 결과 정확
- Disposer 호출 시 listener 0
- 신규 테스트 8~12 green

**Testing**: Vitest mock StreamBridge + EventEmitter, React Testing Library hook 테스트.

---

### Task 3 — CLI Permission v3 Adapter (`ApprovalCliAdapter`) + MeetingTurnExecutor 교체

**목표**: MeetingTurnExecutor 의 CLI permission 콜백을 ApprovalService 기반으로 교체. v2 `registerPendingCliPermission` 호출 제거.

- [ ] `src/main/approvals/approval-cli-adapter.ts` 신규:
  - `createCliPermissionApproval(ctx: { meetingId, channelId, projectId, participantId, participantName, request: ParsedCliPermissionRequest, svc: ApprovalService, timeoutMs?: number }): Promise<boolean>`
  - 동작:
    1. `svc.create({ kind: 'cli_permission', meetingId, channelId, projectId, requesterId: participantId, payload: {...} })` → item.id 획득
    2. `Promise<boolean>` 생성. 내부에서 `svc.once('decided', payload => payload.item.id === id 이면 resolve(decision ∈ {approve, conditional} → true, reject → false))`
    3. `setTimeout(timeoutMs ?? 300_000)` 만료 시 `svc.expire(id)` + resolve(false) + listener cleanup
    4. 어느 경로든 listener 반드시 off (EventEmitter leak 방지)
  - conditional 은 approve 로 CLI 에 반환(허가됨). comment 는 Task 6 injector 가 별도로 시스템 메시지 주입
- [ ] `src/main/meetings/engine/meeting-turn-executor.ts`:
  - 생성자 DI 에 `approvalService: ApprovalService` 추가
  - `setPermissionRequestCallback` 내부의 `registerPendingCliPermission` 호출 + `this.legacyEmit('stream:cli-permission-request', ...)` 전체를 `approvalCliAdapter.createCliPermissionApproval({...})` 한 줄로 교체
  - import 삭제: `registerPendingCliPermission`, `stream:cli-permission-request` 관련 타입
- [ ] `src/main/index.ts`: MeetingTurnExecutor 팩토리에 approvalService 주입
- [ ] `src/main/meetings/engine/__tests__/meeting-turn-executor.test.ts` 갱신:
  - 기존 v2 CLI permission 경로 테스트 → ApprovalService.create 호출 확인 / decided 이벤트로 resolve / timeout / reject 경로
- [ ] `__tests__/approval-cli-adapter.test.ts`: 5~8 케이스 (happy approve / conditional→true / reject→false / timeout / listener leak 0)
- [ ] 커밋: `feat(rolestra): ApprovalCliAdapter + MeetingTurnExecutor v3 CLI permission (R7-Task3)`

**AC**:
- `registerPendingCliPermission` 호출 0 (grep 결과)
- MeetingTurnExecutor → ApprovalService.create 호출 인자 검증
- approve/conditional → Promise<true>, reject/timeout → Promise<false>
- Listener leak 0 (테스트에서 counter 검증)
- CLI 스트림 재개 시나리오 integration smoke green

**Testing**: Vitest mock ApprovalService + CLI provider stub.

---

### Task 4 — v2 `cli-permission-handler` 경로 완전 제거

**목표**: 낡은 v2 Map 기반 pending-request 경로를 물리적으로 제거. cli-permission-handler.ts / IPC 채널 / stream 이벤트 / preload / renderer subscriber 일괄 삭제.

- [ ] 파일 삭제: `src/main/ipc/handlers/cli-permission-handler.ts`
- [ ] IPC handler 등록 해제: `src/main/ipc/handler-registry.ts` 또는 `index.ts` 에서 `handleCliPermissionRespond` 참조 제거
- [ ] `src/shared/ipc-types.ts`: `'cli-permission:respond'` 채널 타입 삭제
- [ ] `src/shared/stream-types.ts`: `'stream:cli-permission-request'` 이벤트 + payload 타입 삭제
- [ ] `src/shared/ipc-schemas.ts` (존재 시): 관련 zod 스키마 삭제
- [ ] `src/preload/index.ts`: `cli-permission:respond` 호출 API + `stream:cli-permission-request` 구독 API 제거
- [ ] `src/renderer/`: `stream:cli-permission-request` 구독자가 있다면 일괄 제거 (grep 필수)
- [ ] `src/main/meetings/engine/meeting-turn-executor.ts`: `legacyEmit('stream:cli-permission-request', ...)` 호출 및 import 제거 (Task 3 에서 일부 됐지만 여기서 재확인)
- [ ] `src/main/__tests__/r2-integration-smoke.test.ts` + 관련 테스트: cli-permission 참조 제거 또는 approval-based 로 교체
- [ ] `src/renderer/__tests__/legacy-channel-isolation.test.ts`: `cli-permission:*` 도 isolation 대상 목록에 이미 있으면 제거(파일 자체가 사라졌으므로 격리 불필요), 없으면 변경 없음
- [ ] 커밋: `chore(rolestra): remove v2 cli-permission-handler + stream event (R7-Task4)`

**AC**:
- `grep -r registerPendingCliPermission src/` → 0
- `grep -r cli-permission src/` → 0 (테스트 주석 제외)
- `grep -r stream:cli-permission-request src/` → 0
- typecheck exit 0
- 기존 테스트 회귀 0 (Task 3 에서 교체된 테스트 녹색 유지)

**Testing**: 전체 `npm run typecheck`, 대상 파일 단위 테스트.

---

### Task 5 — ApprovalBlock `onDecision` wire + RejectDialog / ConditionalDialog

**목표**: ApprovalBlock 의 placeholder `onDecision` 를 실 IPC 호출로 교체. 거절/조건부는 다이얼로그에서 코멘트 입력.

- [ ] `src/renderer/features/approvals/RejectDialog.tsx` 신규:
  - Radix Dialog + 코멘트 textarea + 확정 버튼
  - `props: { open, approvalId, onConfirm(comment: string), onCancel }`
- [ ] `src/renderer/features/approvals/ConditionalDialog.tsx` 신규: 동일 패턴(라벨만 다름)
- [ ] `src/renderer/features/messenger/ApprovalBlock.tsx`:
  - `onDecision` placeholder 제거
  - 내부에서 allow 버튼 → `invoke('approval:decide', { id: message.approvalId, decision: 'approve' })`
  - deny 버튼 → `RejectDialog open` → confirm 시 `invoke('approval:decide', { id, decision: 'reject', comment })`
  - conditional 버튼 → `ConditionalDialog open` → confirm 시 `invoke('approval:decide', { id, decision: 'conditional', comment })`
  - approvalId 를 message payload 로 부터 추출 (Task 7 Thread 분기에서 message 에 주입)
  - 버튼 클릭 중 disabled state, 완료 후 블록 자체는 Thread 가 제거(stream:approval-decided 로 인해 pending list 에서 사라짐)
- [ ] i18n 키 추가 (Task 12 에서 일괄 populate 하지만, 새 키 확정):
  - `messenger.approval.rejectDialog.title/body/placeholder/confirm/cancel`
  - `messenger.approval.conditionalDialog.title/body/placeholder/confirm/cancel`
- [ ] `__tests__/ApprovalBlock.test.tsx`: onDecision 클릭 → invoke 호출 인자 검증 (approve/reject+comment/conditional+comment), 다이얼로그 cancel 시 invoke 0
- [ ] `__tests__/RejectDialog.test.tsx` / `ConditionalDialog.test.tsx`: 열림/코멘트 입력/confirm/cancel 기본 동작
- [ ] 커밋: `feat(rolestra): ApprovalBlock onDecision wire + Reject/Conditional dialogs (R7-Task5)`

**AC**:
- approve → `approval:decide(id, 'approve')`
- reject+comment → `approval:decide(id, 'reject', comment)`
- conditional+comment → `approval:decide(id, 'conditional', comment)`
- 다이얼로그 cancel 시 IPC 호출 0
- 기존 ApprovalBlock 렌더 스타일(warm/tactical/retro 3-way) 변경 0

**Testing**: React Testing Library, jsdom.

---

### Task 6 — `ApprovalSystemMessageInjector` — reject/conditional comment → 시스템 메시지 주입

**목표**: `ApprovalService.'decided'` 이벤트 구독 → reject/conditional comment 를 해당 회의 채널에 시스템 메시지로 포스팅. spec §7.7 "comment 는 다음 턴 시스템 메시지로 해당 AI 에게 주입".

- [ ] `src/main/approvals/approval-system-message-injector.ts` 신규:
  - `class ApprovalSystemMessageInjector { constructor(private svc, private msgSvc, private channelSvc); wire(): Disposer; }`
  - `svc.on('decided', payload => this.handle(payload))`
  - handle:
    1. decision ∈ {reject, conditional} + comment != null 만 처리 (approve 만으로는 주입 안 함)
    2. item.meetingId != null + item.channelId != null 필터 (D7: mode_transition 은 channelId=null 이므로 skip)
    3. `msgSvc.append({ channelId, kind: 'system', content: buildSystemMessage(kind, decision, comment, requesterName) })`
    4. 시스템 메시지 포맷: `"⚠ 사용자가 ${requesterName}의 요청을 ${decision==='reject'?'거절':'조건부 허가'}했습니다. ${comment?`이유/조건: ${comment}`:''}"`
  - i18n 키 경유 (Task 12 populate): `approval.systemMessage.rejected` / `approval.systemMessage.conditional`
- [ ] `src/main/index.ts`: `injector = new ApprovalSystemMessageInjector(...); injector.wire();`
- [ ] `__tests__/approval-system-message-injector.test.ts`: 6~8 케이스 (reject+comment / conditional+comment / approve(skip) / meetingId=null(skip) / msgSvc.append 인자 검증)
- [ ] 커밋: `feat(rolestra): ApprovalSystemMessageInjector for reject/conditional comments (R7-Task6)`

**AC**:
- reject+comment → msgSvc.append 호출 + content 에 comment 포함
- conditional+comment → 위와 동일
- approve → skip
- meetingId 또는 channelId null → skip
- 기존 ApprovalService 테스트 회귀 0

**Testing**: Vitest mock MessageService.

---

### Task 7 — `ApprovalInboxView` + Thread `#승인-대기` 채널 분기

**목표**: `#승인-대기` 시스템 채널(kind='system_approval') 을 열면 Thread 가 일반 메시지 리스트가 아닌 pending approval 리스트(ApprovalBlock 반복) 를 렌더한다.

- [ ] `src/renderer/features/approvals/ApprovalInboxView.tsx` 신규:
  - props: `{ projectId }`
  - `usePendingApprovals({ projectId })` 결과를 ApprovalBlock 으로 반복 렌더
  - `message.id` 필드는 approval.id 로 대체, content 는 `buildApprovalPreview(item)` 로 kind 별 프리뷰 생성
  - 각 ApprovalBlock 의 `onDecision` 는 `approval:decide` IPC (Task 5 가 이미 ApprovalBlock 내부에서 처리하므로 prop 불필요)
  - 빈 상태: "대기 중인 승인 요청이 없습니다" (i18n)
- [ ] `src/renderer/features/messenger/Thread.tsx`:
  - 채널 kind 조회 (`useChannel(channelId)` 또는 메타 props)
  - kind === 'system_approval' → `<ApprovalInboxView projectId={projectId} />` 단독 렌더 (DateSeparator/MeetingBanner 전부 숨김)
  - 그 외 kind 는 기존 R6 path 유지
- [ ] `usePendingApprovals` 에 `projectId` 옵션 추가 (filter 가능) — 기존 IPC `approval:list` 가 이미 projectId 받음
- [ ] `__tests__/ApprovalInboxView.test.tsx`: pending 3건 렌더 / 빈 상태 / decide 후 목록에서 사라짐
- [ ] `__tests__/Thread.system-approval.test.tsx`: #승인-대기 채널 진입 시 ApprovalInboxView 렌더
- [ ] 커밋: `feat(rolestra): ApprovalInboxView + Thread system_approval branch (R7-Task7)`

**AC**:
- #승인-대기 채널 열면 pending approval 이 ApprovalBlock 으로 나열
- 다른 채널은 R6 Thread 렌더 유지 (regression 0)
- decide 후 stream:approval-decided 이벤트로 자동 사라짐 (Task 2 흐름과 연결)

**Testing**: React Testing Library + mock invoke + stream event 모사.

---

### Task 8 — Mode Transition Approval — `ProjectService.updatePermissionMode`

**목표**: 프로젝트 `permission_mode` 변경 요청을 ApprovalService 로 게이팅. 활성 회의 체크(CB-3) + external+auto 금지(§7.3) 재검증.

- [ ] `src/main/projects/project-service.ts`:
  - `requestPermissionModeChange(projectId: string, targetMode: PermissionMode, reason?: string): ApprovalItem`
    1. 현재 mode 로드
    2. 활성 회의 존재 시 throw `ProjectBusyError` ("진행 중 회의가 끝나야 변경 가능")
    3. `assertExternalNotAuto` (kind='external' + targetMode='auto' 거절)
    4. `approvalService.create({ kind: 'mode_transition', projectId, payload: { currentMode, targetMode, reason } })`
    5. return item
  - `applyPermissionModeChange(approvalId: string): void` — 내부 호출 (injector 가 호출)
    1. item 로드 + status='approved' 확인 + payload pull
    2. 활성 회의 재체크 + external+auto 재체크 (TOCTOU 방어)
    3. `projectsRepo.updatePermissionMode(projectId, targetMode)`
    4. 실패 시 item.status='superseded' 처리 + throw
- [ ] `src/main/approvals/approval-decision-router.ts` 신규 (또는 SystemMessageInjector 와 병합):
  - ApprovalService 'decided' 이벤트 중 `kind='mode_transition' && decision='approve'` → ProjectService.applyPermissionModeChange 호출
- [ ] IPC 신규 `project:request-permission-mode-change` (필요 시): 설정 UI 는 R10 이지만, 테스트용 최소 IPC 는 필요 — `project-handler.ts` 에 추가
- [ ] `__tests__/project-service.test.ts`: 신규 4~6 케이스 (happy / 활성회의 거절 / external+auto 거절 / apply 후 DB 반영 / apply TOCTOU 재거절)
- [ ] 커밋: `feat(rolestra): ProjectService mode_transition approval flow (R7-Task8)`

**AC**:
- requestPermissionModeChange → approval_items row 생성
- approved decide → permission_mode DB 반영
- external+auto 시도 → ApprovalError
- 활성 회의 시도 → ProjectBusyError
- TOCTOU (approval 생성 이후 회의 시작) 시 apply 거절 + superseded 전이

**Testing**: Vitest full-stack (ProjectService + ApprovalService + DB migration 006).

---

### Task 9 — Consensus Decision Approval — SSM DONE 게이트

**목표**: MeetingOrchestrator 가 SSM DONE 도달 시 즉시 #회의록 포스팅하는 R6 경로 앞에 `consensus_decision` approval 을 끼워 사용자 sign-off 를 받는다.

- [ ] `src/main/engine/v3-side-effects.ts` (또는 MeetingOrchestrator 의 DONE 핸들러):
  - DONE 도달 시 현재 MinutesComposer 포스팅 직전에 `approvalService.create({ kind: 'consensus_decision', meetingId, channelId, projectId, payload: { snapshotHash, finalText, votes } })`
  - `'decided'` 이벤트 once-subscribe (본 meetingId 용)
    - decision='approve' → 기존 R6 로직(MinutesComposer 포스팅 + Meeting.finish(outcome='accepted')) 실행
    - decision='reject' → `#회의록` 에 "사용자 거절: ${comment}" 시스템 메시지 포스팅 + Meeting.finish(outcome='rejected') + MinutesComposer 미포스팅
    - decision='conditional' → approve 경로 + Task 6 injector 가 comment 주입
  - timeout 24h 기본(D4). 만료 시 ApprovalService.expire + Meeting.finish(outcome='expired') + 시스템 메시지
- [ ] `src/main/meetings/engine/meeting-orchestrator.ts`:
  - 기존 DONE 핸들러를 위의 approval 게이트로 교체 (직접 수정 또는 v3-side-effects 에 위임)
  - approval 대기 중에는 orchestrator 를 특별 상태(예: WAITING_CONSENSUS_APPROVAL) 로 두지 말고 단순히 Promise 대기 → 기존 orchestrator registry 에서 회의 id 유지
- [ ] `src/main/notifications/notification-service.ts`: Task 11 에서 approval_pending 일반화 되지만, consensus_decision 은 시각적으로 더 강조 가능 — R7 에서는 동일 notification 이름으로 포스팅
- [ ] `__tests__/meeting-orchestrator.consensus-approval.test.ts`: SSM DONE → approval 생성 → approve → minutes 포스팅 / reject → 거절 메시지 + outcome='rejected' / timeout → expired 경로
- [ ] `__tests__/v3-side-effects.test.ts`: DONE 핸들러 approval wiring 단위 테스트
- [ ] 커밋: `feat(rolestra): consensus_decision approval gate (R7-Task9)`

**AC**:
- SSM DONE → approval_items kind='consensus_decision' row 생성
- approve → MinutesComposer 포스팅 + Meeting.finish(accepted)
- reject → 거절 메시지 포스팅 + Meeting.finish(rejected)
- conditional → approve 경로 + SystemMessageInjector 주입(Task 6 연동)
- timeout 24h → expired + 시스템 메시지

**Testing**: Vitest mock MinutesComposer + ApprovalService + MeetingService.

---

### Task 10 — Dashboard `ApprovalsWidget` → `#승인-대기` 채널 라우팅

**목표**: 대시보드 🔔 위젯의 row 클릭이 messenger 뷰의 `#승인-대기` 채널로 이동.

- [ ] `src/renderer/features/dashboard/widgets/ApprovalsWidget.tsx`:
  - `onRowActivate` 기본값을 zustand store 호출로 교체:
    - `activeChannelStore.setActiveChannel(projectId, approvalChannelId)` (projectId 는 item.projectId, approvalChannelId 는 `ChannelService.findSystemChannel(projectId, 'system_approval')` 로 조회)
    - `appViewStore.setView('messenger')` (R5 에 app view router 이미 있음)
  - projectId=null(광역) 인 경우 기본 activeProject 로 fallback, 그래도 없으면 disable
- [ ] 신규 훅 `use-system-channel.ts` (필요 시): `useSystemChannel(projectId, kind='system_approval')` — 채널 목록 캐시에서 첫 매치
- [ ] `__tests__/ApprovalsWidget.test.tsx` 확장: onRowActivate 기본값이 스토어 호출로 이어지는지
- [ ] 커밋: `feat(rolestra): ApprovalsWidget row → inbox routing (R7-Task10)`

**AC**:
- row 클릭 → activeChannelStore 업데이트 + messenger 뷰 전환
- projectId=null 이어도 크래시 0

**Testing**: React Testing Library + mock store.

---

### Task 11 — `NotificationService` `approval_pending` 트리거

**목표**: ApprovalService 'created' 이벤트 → `kind='approval_pending'` OS notification 발사 (앱 비포커스 시).

- [ ] `src/main/notifications/notification-service.ts`:
  - `wireApprovalSource(approvalService)` 또는 별도 adapter 에서 `svc.on('created', item => this.enqueue('approval_pending', {...}))`
  - 본문: `"${requesterName}의 ${kindLabel(item.kind)} 요청 — 확인해주세요"` (i18n)
  - 클릭 시 `stream:notification-clicked` 로 `#승인-대기` 채널 라우팅 힌트 전달
- [ ] `src/main/index.ts`: wireApprovalSource 호출
- [ ] `__tests__/notification-service.test.ts`: approval_pending 발사 / 중복 suppress / 앱 포커스 시 skip
- [ ] 커밋: `feat(rolestra): NotificationService approval_pending trigger (R7-Task11)`

**AC**:
- ApprovalService.create → Notification enqueue (앱 비포커스)
- 포커스 시 skip

**Testing**: Vitest mock Electron Notification.

---

### Task 12 — i18n populate `approval.*` + `messenger.approval.*` + `dashboard.approvals.*` + E2E `approval-flow.spec.ts`

**목표**: R7 신규 문자열 i18n 완비, Playwright 시나리오 1종(CLI permission 승인 happy path).

- [ ] `src/renderer/i18n/locales/{ko,en}.json`:
  - `approval.kind.{cli_permission,mode_transition,consensus_decision}`
  - `approval.systemMessage.{rejected,conditional}`
  - `messenger.approval.rejectDialog.{title,body,placeholder,confirm,cancel}`
  - `messenger.approval.conditionalDialog.{title,body,placeholder,confirm,cancel}`
  - `messenger.approval.inboxEmpty`
  - `dashboard.approvals.{title,empty,error,count,kind.*}` — 기존 R4 populate 확인 + 누락 보충
  - `notification.approvalPending.{title,body}`
- [ ] `i18next-parser.config.js`: `approval.kind.*` / `approval.systemMessage.*` / `messenger.approval.{reject,conditional}Dialog.*` 등 dynamic 키 keepRemoved regex 확장
- [ ] `npm run i18n:check` idempotent clean 확인
- [ ] `e2e/approval-flow.spec.ts` 신규 (Playwright `_electron`):
  - 시나리오: 프로젝트 열기 → 채널 회의 시작 → mock CLI 가 permission 요청 → ApprovalBlock 등장 → 허가 클릭 → 턴 재개
  - 또는 대안 시나리오: consensus_decision approval happy path (SSM DONE → approval → approve → #회의록 포스팅 확인)
  - WSL 런타임 제약 시 R4/R5/R6 와 동일 DONE_WITH_CONCERNS 정책
- [ ] 커밋: `feat(rolestra): approval.* i18n + E2E approval-flow.spec.ts (R7-Task12)`

**AC**:
- ko/en 신규 키 전체 populate (parser 런 idempotent)
- e2e/approval-flow.spec.ts 존재 + 로컬 실행 또는 DONE_WITH_CONCERNS
- typecheck:web / lint / i18n:check exit 0

**Testing**: Vitest i18n keys 존재 검증(optional), Playwright 1 시나리오.

---

### Task 13 — R7 Closeout — typecheck/lint/test/i18n:check/theme:check/build + done-checklist

**목표**: R7 전체 합격선 확인 + `docs/superpowers/specs/r7-done-checklist.md` 작성 + tasks.json 14/14 처리.

- [ ] `npm run typecheck` 전체 exit 0 (R6 baseline 유지 — legacy 170건 회귀 0)
- [ ] `npm run typecheck:web` exit 0
- [ ] `npm run lint` 0 errors (R6 pre-existing warnings 수준 유지)
- [ ] `npm run test -- approvals meetings projects notifications renderer/features/approvals` R7 신규 테스트 green
- [ ] `npm run i18n:check` idempotent clean
- [ ] `npm run theme:check` exit 0
- [ ] `npm run build` exit 0
- [ ] `docs/superpowers/specs/r7-done-checklist.md` 작성:
  - 14 Task 산출물 링크
  - Known Concerns (R8 인수인계) — review_outcome / failure_report kind 발사 지점, mode_transition 조건부 UX, consensus auto-approve autonomy
  - spec §10 R7 블록 모든 `- [ ]` → `- [x]` 전환
- [ ] `tasks.json` 14/14 completed
- [ ] 커밋: `chore(rolestra): R7 closeout — done-checklist + tasks 14/14 (R7-Task13)`

**AC**:
- 모든 정식 게이트 녹색
- done-checklist 작성 완료
- spec §10 R7 체크박스 전체 ✓
- tasks.json 14/14 completed

**Testing**: 전체 합격선 run.

---

## Decision Log (R7)

**D1 — `cli-permission-handler.ts` 즉시 삭제 정책**  
R11 의 legacy 5파일 일괄 삭제 정책과 달리, cli-permission-handler 는 R7 Task 4 에서 즉시 삭제한다. 이유: (i) 호출자 0 이 된 뒤 남겨두면 의도치 않은 import 회귀 위험이 크다, (ii) v2 engine 5파일(SSM 자산 디렉토리와 공존) 과 달리 독립 파일이라 R11 묶음 청소의 가치가 없다, (iii) 물리 삭제 지표가 R7 성공 기준 중 하나(= legacy map 기반 pending resolver 전면 제거).

**D2 — CLI Permission Adapter timeout 5분**  
`createCliPermissionApproval` 의 timeout 기본값을 5분(300,000ms) 으로 둔다. 이유: CLI 프로세스가 무한정 블락되면 회의 전체가 멈추고 사용자 부재 시나리오에서 거절과 동일한 효과(resolve(false)) 가 합리적 default. 값 자체는 옵션으로 override 가능.

**D3 — `mode_transition` 에서 조건부 버튼 비활성**  
conditional decision 은 cli_permission / consensus_decision 에만 의미 있고 mode_transition 에는 조건 개념이 애매하다(부분 적용 불가). R7 ApprovalInboxView 가 kind 확인 후 조건부 버튼을 비활성 + 툴팁 "모드 변경에는 조건부 승인이 지원되지 않습니다" 로 처리. 재검토는 R10.

**D4 — `consensus_decision` timeout 24시간**  
cli_permission 의 5분과 다르게 24시간 으로 길게 둔다. 이유: 회의 결과 검토가 즉시 이뤄지지 않아도 워크플로가 망가지면 안 된다. 만료 시 `expired` 전이 + `#회의록` 에 "승인 만료로 자동 종료" 시스템 메시지. autonomy auto-approve(R9) 가 들어오면 default 24h 를 줄일 수 있음.

**D5 — `ApprovalPayload` discriminated union 위치 + 범위**  
`src/shared/approval-types.ts` 에 R7 발사 지점이 존재하는 3 kind(`cli_permission` / `mode_transition` / `consensus_decision`) 만 payload 타입을 추가. `review_outcome` / `failure_report` 는 R8+ 에서 발사 지점이 생길 때 payload 정의. 기존 `ApprovalItem.payload: unknown` 은 유지 (타입 점진 이행).

**D6 — 스트림 이벤트 이름 `stream:approval-*` 유지**  
R6 meeting:* 접두사 개편과 달리, approval 은 회의 범위가 아닌 시스템 전역 개념이므로 `meeting:*` 접두사로 바꾸지 않는다. 기존 `stream:approval-created/decided` (이미 stream-events.ts 에 선언) 를 재사용.

**D7 — 거절/조건부 comment 주입 범위**  
`ApprovalSystemMessageInjector` 는 `meetingId != null && channelId != null` 인 approval 만 MessageService.append 로 주입. `mode_transition` 등 meetingId=null 케이스는 UI 상태 업데이트(ApprovalInboxView 에서 자동 사라짐) 만 수행. 이유: DM/프로젝트 광역 approval 은 "다음 턴" 이라는 시간 개념이 없고 주입 대상 채널이 모호.

**D8 — v2 `stream:cli-permission-request` 이벤트 타입 제거**  
Task 4 에서 preload/shared 타입/renderer 구독자 일괄 제거. `legacy-channel-isolation.test.ts` 가 R3 에서 깔린 격리 테스트로 회귀 방지. stream-types.ts 의 해당 type literal 이 사라지면 TypeScript 가 모든 참조를 compile error 로 잡아주므로 누락 위험 낮음.
