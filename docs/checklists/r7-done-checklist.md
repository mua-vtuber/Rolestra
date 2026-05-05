# R7 Done Checklist — 승인 시스템 전면 통합

**Branch:** `rolestra-phase-r7`
**Plan:** `docs/plans/2026-04-22-rolestra-phase-r7.md`
**Tasks:** 14/14 completed
**Spec:** `docs/specs/2026-04-18-rolestra-design.md` §10 Phase R7

## 산출물 인덱스

### Task 0 — Branch + Plan + Spec 확장 + Decision Log
- 브랜치 `rolestra-phase-r7` (main tip `1bfa3e1`)
- `docs/plans/2026-04-22-rolestra-phase-r7.md`
- `docs/plans/2026-04-22-rolestra-phase-r7.md.tasks.json`
- spec §10 Phase R7 체크박스+산출물 템플릿 + Decision Log D1~D8

### Task 1 — Shared approval stream events + ApprovalPayload union
- `src/shared/approval-stream-events.ts` (신규, re-export)
- `src/shared/approval-types.ts` (payload union: `cli_permission` / `mode_transition` / `consensus_decision`)
- `src/shared/__tests__/approval-stream-events.test.ts` (zod round-trip)

### Task 2 — ApprovalStreamAdapter + usePendingApprovals 실시간
- `src/main/streams/stream-bridge.ts` (`connect({approvals})` → stream:approval-*)
- `src/main/index.ts` wire
- `src/renderer/hooks/use-pending-approvals.ts` (mount fetch + stream merge)
- `src/preload/index.ts` typedOnStream (generic, 자동 포함)

### Task 3 — ApprovalCliAdapter + MeetingTurnExecutor v3 교체
- `src/main/approvals/approval-cli-adapter.ts` (createCliPermissionApproval Promise bridge, 5min timeout)
- `src/main/meetings/engine/meeting-turn-executor.ts` (v2 registerPendingCliPermission 제거)
- `src/main/meetings/engine/__tests__/meeting-turn-executor.test.ts`
- `src/main/index.ts` DI

### Task 4 — v2 cli-permission-handler + IPC + stream + preload 완전 제거
- `src/main/ipc/handlers/cli-permission-handler.ts` **삭제**
- `src/shared/ipc-types.ts` / `src/shared/stream-types.ts` 정리
- `src/preload/index.ts` 화이트리스트 축소
- grep `-r "cli-permission" src/` 코드 결과 0 (주석 제외)

### Task 5 — ApprovalBlock onDecision wire + Reject/ConditionalDialog
- `src/renderer/features/messenger/ApprovalBlock.tsx` (직접 `invoke('approval:decide')` wire, `message.meta.approvalRef` 에서 approvalId 추출)
- `src/renderer/features/approvals/RejectDialog.tsx` (Radix Dialog, optional comment)
- `src/renderer/features/approvals/ConditionalDialog.tsx` (Radix Dialog, required comment)
- `src/renderer/features/approvals/__tests__/{RejectDialog,ConditionalDialog}.test.tsx`
- `src/renderer/features/messenger/__tests__/ApprovalBlock.test.tsx` (32 tests green)
- `src/renderer/i18n/locales/{ko,en}.json` — `messenger.approval.{rejectDialog,conditionalDialog,errors}.*`
- `i18next-parser.config.js` — `messenger.approval.errors` keepRemoved regex

### Task 6 — ApprovalSystemMessageInjector (reject/conditional comment → 시스템 메시지)
- `src/main/approvals/approval-system-message-injector.ts` (wire() + disposer idempotent)
- `src/main/approvals/__tests__/approval-system-message-injector.test.ts` (11 tests)
- `src/main/index.ts` wire(approvalService + messageService)

### Task 7 — ApprovalInboxView + Thread `#승인-대기` 분기
- `src/renderer/features/approvals/ApprovalInboxView.tsx` (kindLabel i18n anchor 포함 — Task 12 참조)
- `src/renderer/features/approvals/__tests__/ApprovalInboxView.test.tsx` (11 tests)
- `src/renderer/features/messenger/Thread.tsx` — `activeChannel.kind === 'system_approval'` 분기
- `src/renderer/features/messenger/__tests__/Thread.test.tsx` — system_approval 분기 커버
- `src/renderer/hooks/use-pending-approvals.ts` — `projectId` 필터 + stream projectId 매칭
- `src/renderer/i18n/locales/{ko,en}.json` — `messenger.approval.inbox.{empty,error,loading}`

### Task 8 — ProjectService.requestPermissionModeChange + ApprovalDecisionRouter
- `src/main/projects/project-service.ts` (requestPermissionModeChange / applyPermissionModeChange + 4 에러 클래스 + ProjectServiceOptions.{approvalService,hasActiveMeeting})
- `src/main/projects/__tests__/project-service.test.ts` (+8 tests)
- `src/main/approvals/approval-decision-router.ts` (wire() disposer, kind 별 dispatch)
- `src/main/approvals/__tests__/approval-decision-router.test.ts` (9 tests)
- `src/main/ipc/handlers/project-handler.ts` + `src/shared/ipc-types.ts` + `src/shared/ipc-schemas.ts` + `src/main/ipc/router.ts` — `project:request-permission-mode-change` 채널
- `src/main/index.ts` — ApprovalService 생성 순서 조정 + DI + Router wire

### Task 9 — Consensus Decision Approval (SSM DONE 게이트)
- `src/main/engine/v3-side-effects.ts` — DONE 의 `#회의록` 포스팅을 approval 뒤로 미룸 (FAILED 는 기존 유지)
- `src/main/meetings/engine/meeting-orchestrator.ts` — openConsensusDecisionGate + handleConsensusDecision + handleConsensusTimeout + buildConsensusDecisionPayload + stop() 시 disposer + `consensusDecisionTimeoutMs` opt (기본 24h)
- `src/main/meetings/engine/__tests__/meeting-orchestrator.test.ts` (+6 DONE approval-gate tests)
- `src/main/engine/__tests__/v3-side-effects.test.ts` — DONE 테스트 재작성

### Task 10 — Dashboard ApprovalsWidget → `#승인-대기` 라우팅
- `src/renderer/features/dashboard/widgets/ApprovalsWidget.tsx` — default onRowActivate = activeChannelStore.setActiveChannelId + appViewStore.setView('messenger')
- `src/renderer/features/dashboard/widgets/__tests__/ApprovalsWidget.test.tsx` (+4 activation tests)
- `src/renderer/hooks/use-system-channel.ts` (useReducer 기반, projectId=null safe null)
- `src/renderer/stores/app-view-store.ts` (ephemeral view store)
- `src/renderer/App.tsx` — `useState<AppView>` → `useAppViewStore`

### Task 11 — ApprovalNotificationBridge + stream:notification-clicked
- `src/main/approvals/approval-notification-bridge.ts` (ApprovalService 'created' → NotificationService.show(approval_pending), kind 별 title/body + 5s dedupe + warn-on-throw)
- `src/main/approvals/__tests__/approval-notification-bridge.test.ts` (10 tests)
- `src/shared/stream-events.ts` — `stream:notification-clicked` 이벤트 + payload 타입
- `src/main/streams/stream-bridge.ts` — `connect({notifications})` → 'clicked' → stream:notification-clicked
- `src/main/index.ts` — 순서 조정(NotificationService before StreamBridge connect) + wire

### Task 12 — i18n populate + E2E approval-flow.spec.ts
- `src/renderer/i18n/locales/{ko,en}.json` — top-level `approval.kind.*` + `approval.systemMessage.*` + `messenger.approval.{rejectDialog,conditionalDialog,errors,inbox}.*` (Task 5/7 누적)
- `src/renderer/features/approvals/ApprovalInboxView.tsx` — `kindLabel(t, kind)` 정적 t() 앵커(namespace orphan-prune 방지)
- `i18next-parser.config.js` — `messenger.approval.errors` + `approval.systemMessage.*` keepRemoved regex
- `e2e/approval-flow.spec.ts` (Playwright Electron, messenger → `#승인-대기` → empty state 내비게이션)

### Task 13 — 정식 게이트 + done-checklist + 14/14
- 본 문서
- `docs/specs/2026-04-18-rolestra-design.md` §10 Phase R7 체크박스 전체 ✓
- `docs/plans/2026-04-22-rolestra-phase-r7.md.tasks.json` 14/14 completed

## 게이트 실행 결과 (2026-04-23)

| 게이트 | 명령 | 결과 |
|---|---|---|
| typecheck (node) | `npm run typecheck:node` | **exit 0** |
| typecheck (web) | `npm run typecheck:web` | **exit 0** |
| lint | `npm run lint` | **0 errors, 20 warnings** (모두 기존 테스트 파일의 literal-string warning — 신규 errors 0) |
| i18n:check | `npm run i18n:check` / `npx i18next-parser` 2회 | **idempotent** (ko/en 2차 diff 0) |
| theme:check | `npm run theme:check` | **clean** |
| build | `npm run build` | **success** (main + preload + renderer) |
| approval + project + dashboard + meeting 도메인 vitest | `npm run test -- ApprovalBlock RejectDialog ConditionalDialog ApprovalInboxView Thread ApprovalsWidget approval project-service meeting-orchestrator v3-side-effects approval-decision-router approval-notification-bridge approval-system-message-injector use-pending-approvals use-system-channel` | **257+ tests green** (세부 횟수는 작업별 커밋 메시지 참조) |

**전체 vitest 제외 사유:** 레거시 v2 도메인(database-branch-operations / conversation-repository / memory-integration / recovery / remote) 13 files 기존 failing — R7 코드 경로 밖이며 Task 0 기준선도 동일 상태(`git stash` 재확인 2026-04-23 00:13). R11 legacy-cleanup 에서 제거/정리 예정.

## Known Concerns (R8+ 인수인계)

1. **`notification.approvalPending.*` i18n** — main-process ApprovalNotificationBridge 의 title/body 는 한국어 고정 라벨. renderer-side t() 마이그레이션 경로는 R10 i18n 완성 시점에 구축 예정 (현재 renderer consumer 없음 → parser orphan-prune 방지 수단 없음). deferred 사유는 config `notification.approvalPending.*` regex 주석에 명시.

2. **consensus_decision 24h timeout app 재시작 시 손실** — 타이머는 `timer.unref()` 로 in-process 만 유지한다. 앱 재시작 사이 pending 승인은 남아있지만 expire 트리거는 재생성되지 않는다. Task 11 의 NotificationService approval_pending 이 재시작 시 OS 알림으로 사용자를 인박스로 유도하므로 R7 scope 에서는 용인 가능. R9 autonomy + 이력 복구 작업에서 타이머 rehydrate 설계.

3. **Dashboard KPI 실시간 approval count** — R4 KPI 패널은 mount-fetch + 정기 invalidate 로 충분하다(R10 이연 범위). Task 11 은 OS 알림만 담당.

4. **E2E approval-flow DONE_WITH_CONCERNS** — WSL 런타임 제약으로 실행 0 (R4/R5/R6 과 동일). 스펙 + 픽스처는 lands. CI matrix 실행은 R10.

5. **`review_outcome` / `failure_report` kind** — ApprovalKind enum 에는 존재하지만 발사 지점 0. R8 autonomy / review 도입 시 payload 정의 + injector/router 확장.

6. **Mode transition conditional UX (D3 deferred)** — 모드 전환 approval 에서 conditional 선택 시 UX 가 불명확(조건을 어떻게 모드 메타에 붙일지). 현재 apply 는 approve 와 동일하게 target mode 로 전이. R10 설정 UI 때 재검토.

7. **cli-permission-handler 물리 삭제 외의 v2 engine 5 파일** — conversation/turn-executor/execution-coordinator/memory-coordinator/orchestrator 는 R11 legacy-cleanup 에서 제거(D1 합의).

## Decision Log (D1~D8 요약)

- **D1** cli-permission-handler 는 Task 4 에서 즉시 삭제, 그 외 v2 engine 5 파일 R11 연기.
- **D2** ApprovalCliAdapter 는 Promise 기반 1회성 구독(vs. 영속 Map) — CLI 스트림의 단일 요청 수명에 맞춤.
- **D3** mode_transition conditional UX 는 R10 재검토(D3 연기).
- **D4** Approval Inbox 프로젝트 필터는 usePendingApprovals 훅 레벨(vs. 서버 zod) — renderer stream 필터 비용이 낮아서.
- **D5** review_outcome / failure_report 는 kind enum 만 R7 scope, 페이로드 정의 R8.
- **D6** Consensus approval 24h timeout 은 in-process `timer.unref()` — R9 rehydrate 설계까지.
- **D7** system-message injector content 포맷은 main-side 고정 라벨(`[승인 거절] …`). t() 대체 가능성은 R10 i18n 마이그레이션.
- **D8** notification approval_pending dedupe 는 bridge 내부 5s 윈도우 — NotificationService의 prefs+focus 게이트와 독립.

## 메시지

R7 을 통해 v2 의 "pending-map + legacy IPC" 조립이 v3 의 "ApprovalService 이벤트 허브 + 여러 독립 구독자(SystemMessageInjector / DecisionRouter / NotificationBridge / StreamBridge)" 로 재구성됐다. 각 구독자는 자신의 실패를 warn 으로 흡수해 서로에게 전파하지 않고, ApprovalService.decide 는 IPC 로만 건드릴 수 있다(create 는 시스템 플로우 전용). CLI 권한 / 모드 전환 / 합의 결정 세 kind 가 동일 계층을 공유하므로 R8+ 의 review_outcome / failure_report 는 kind 엔트리 하나와 per-kind 로직만 추가하면 된다.
