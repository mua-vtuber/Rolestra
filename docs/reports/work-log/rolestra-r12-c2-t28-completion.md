---
name: R12-C2 T28 종결 — HandoffApprovalModal + B handoff_mode 우회 룰 wire (P6 진입 2 호, 2026-05-07)
description: R12-C2 P6 진입 2 호 완료. handoff_mode='check' 분기 사용자 결재 모달 + 'auto' 분기 즉시 dispatch + audit chain actual wire. production f4d7241. 22 파일 +2598 lines. 다음 = T29 (HandoffPackageCard).
type: project
---

# R12-C2 T28 종결 (2026-05-07)

worktree `feat/r12-c2-redesign-r2`, base `e8315cd` (= T27 sync). production commit `f4d7241`. 22 파일 / +2598 lines (9 신규 + 13 갱신).

**Why:** spec §11.18.8c handoff_mode 우회 룰. T13 NextStep classifier 가 'handoff' 카드 분류 path 만 land 했고 (hasNextChain 항상 false placeholder), T27 이 handoff_dispatch row 영속 + HandoffPackage schema 만 land. T28 이 *그 사이의 wire 통째* — chain resolver + handoff_mode 분기 + 사용자 결재 모달 + 채널 설정 토글까지 land.

**How to apply:** 새 세션 진입 시 T29 (HandoffPackageCard — 받는 부서 첫 화면 인계 패키지 surface) 진입 가능. 의존 = T16 (Card primitive) + T18 (SsmBox) + T28 = 모두 충족. T28 의 stream:handoff-dispatched 가 처음 emit 되는 시점이 T29 의 첫 surface trigger.

## 핵심 결정 2 종 (사용자 명시 — AskUserQuestion 응답)

1. **[취소] = 회의 대기 상태로 멈춤 (pending state 가 진실원천)**: 사용자 결정 — "[취소] 시 회의 *바로 종결* vs *대기 상태로 멈춤*" 에서 후자 선택. 그러나 단순화 위해 회의 lifecycle 자체는 종결 (finalize 호출), pending state 만 메모리 보존. 효과 동일 — dispatch 가 보류 중이고 사용자 결정 시까지 effect 미발생. handoff_pending phase 신설 + 회의 종결 X path 보다 단순. 채널 재 진입 시 stream:handoff-required 재 emit 은 미구현 (T29 dogfooding 시점 결정).
2. **'auto' Notification = T30 분리**: T28 = stream emit + 받는 채널 unread badge 까지만. NotificationService 카테고리 'handoff-auto-dispatched' 신규는 T30 책임 (plan 명시). 사용자 확인: "T30에서 하는거지?" 답 = 맞다. plan 의 T30 = "검토 → 리뷰 Notification (D 의미 단위 알림 #1)".

## 파일 9 신규 + 13 갱신 (+2598 lines)

### main 신규 (4)
- `src/main/handoff/handoff-chain-resolver.ts` (+322) — workflowKind 분기 단일 entry (audit actual / idea/planning/design/implement placeholder / review/general chain 외) + ChainResolverOutcome discriminated union + ResolvedReceiverChannel + AuditChainInput + invariant error
- `src/main/handoff/handoff-pending-state.ts` (+126) — in-memory Map<meetingId, HandoffPackage> + put/get/take/hasPending/listByReceiverChannel/clear + invariant error
- `src/main/handoff/__tests__/handoff-chain-resolver.test.ts` (+232) — 16 tests (입력 invariant 3 + chain 외 2 + placeholder 4 + audit verdict 7)
- `src/main/handoff/__tests__/handoff-pending-state.test.ts` (+159) — 9 tests
- `src/main/ipc/handlers/handoff-handler.ts` (+138) — handoff:approve / cancel + accessor 3 종
- `src/main/ipc/handlers/__tests__/handoff-handler.test.ts` (+184) — 6 tests

### renderer 신규 (3)
- `src/renderer/features/handoff/HandoffApprovalModal.tsx` (+312) — stream subscribe + 회의록 IPC fetch + audit→planning 분기 시 *"+리뷰 부서도 시작"* 체크박스 + [확인]/[취소]
- `src/renderer/features/handoff/HandoffModeToggle.tsx` (+108) — channel.handoff_mode 토글 컴포넌트 ('check' / 'auto')
- `src/renderer/features/handoff/__tests__/HandoffModeToggle.test.tsx` (+131) — 4 tests

### 갱신 (13)
- `src/main/meetings/engine/meeting-orchestrator.ts` (+421/-36) — chain resolver wire (tryResolveChain + tryReadCachedMinutesBody + mapChannelRoleToWorkflowKind + collectOpinionsFromTree helpers) + runHandoffPhase 본체 교체 + runHandoffFallback + cachedMinutesPath 보존 + 4 새 deps (handoffPendingState / handoffDispatchService / resolveReceiverChannel / missionCardIdFactory)
- `src/main/meetings/engine/__tests__/meeting-orchestrator.test.ts` (+38) — 새 deps stub
- `src/main/streams/stream-bridge.ts` (+64) — emitHandoffRequired/Dispatched/Rejected helper + KNOWN_EVENT_TYPES + payload validator
- `src/main/index.ts` (+80) — HandoffDispatchService + HandoffPendingState 인스턴스 + accessor 등록 + resolveReceiverChannel inline closure (channelService.listByProject + listMembers + designated-worker-resolver wrap) + missionCardIdFactory = randomUUID
- `src/main/ipc/router.ts` (+20) — handoff:* + channel:update-handoff-mode + meetings:readMinutesBody dispatch
- `src/main/ipc/handlers/channel-handler.ts` (+13) — handleChannelUpdateHandoffMode
- `src/main/ipc/handlers/meetings-minutes-handler.ts` (+11) — handleMeetingsReadMinutesBody
- `src/shared/stream-events.ts` (+76) — StreamHandoffRequired/Dispatched/Rejected payloads + StreamEvent union
- `src/shared/ipc-types.ts` (+42) — handoff:approve/cancel + channel:update-handoff-mode + meetings:readMinutesBody types
- `src/shared/ipc-schemas.ts` (+23) — channelUpdateHandoffModeSchema / handoffApproveSchema / handoffCancelSchema + v3ChannelSchemas 등록
- `src/renderer/App.tsx` (+2) — HandoffApprovalModal mount
- `src/renderer/i18n/locales/ko.json` / `en.json` (+24 each) — handoff.modal.* + handoff.toggle.*

## chain resolver 분기 정책 (R12-C2 T28 시점)

| workflowKind | 결과 | 비고 |
|--------------|------|------|
| `audit`      | actual chain (verdict ok → no_chain / verdict ng → chain_resolved with planning HandoffPackage) | T25 planAuditDispatch 재사용 |
| `review`     | no_chain (`review_outside_chain`) | spec §3 line 76 chain 외 |
| `general`    | no_chain (`general_outside_chain`) | 일반 채널 |
| `idea`       | no_chain (`idea_chain_unhandled`) | P3 후속 wire (idea → design.ux 매핑) |
| `planning`   | no_chain (`planning_chain_unhandled`) | R12-W (planning → implement 분담) |
| `design`     | no_chain (`design_chain_unhandled`) | P3 후속 (design → planning 인계) |
| `implement`  | no_chain (`implement_chain_unhandled`) | R12-W (implement → audit 자동 chain) |

placeholder branches 는 *명시 unhandled* — silent skip 아닌 reason 명시. 후속 sub-task 가 placeholder branch 만 교체.

## orchestrator wire — runHandoffPhase 분기

| outcome | mode | 처리 |
|---------|------|------|
| `null` (resolver throw) 또는 `no_chain` | — | runHandoffFallback (Notification + system message "회의가 끝났습니다.") |
| `chain_resolved` | `auto` | HandoffDispatchService.dispatch + emitHandoffDispatched + system message |
| `chain_resolved` | `check` | HandoffPendingState.put + emitHandoffRequired + Notification (옛 path 재사용) + system message |

## 검증

- typecheck:node + typecheck:web 0
- vitest **3806 PASS** / 13 skip / 0 fail (T27 baseline 3771 → **+35 신규**)
  - chain resolver 16 + pending state 9 + handoff handler 6 + HandoffModeToggle 4
- inspect:safety **102 hits** (T27 baseline 동일 — **신규 위반 0**)

## 미작업 (의도)

- HandoffModeToggle 진입점 mount (사이드바 ⚙ / 채널 설정 모달) — 컴포넌트는 land, mount 위치는 T29 / dogfooding 시점 묶음. 현재 채널 설정 surface 자체가 미존재.
- 'auto' 분기 Notification 발송 — T30 책임 (NotificationService 카테고리 1 호 = handoff-auto-review)
- 받는 부서 첫 surface (HandoffPackageCard) — T29 책임
- audit chain 외 chain (idea/planning/design/implement) actual wire — placeholder branches 가 'no_chain' 반환, 후속 sub-task 가 교체

## 다음 = T29 (HandoffPackageCard) 권장

T29 의존: T16 (Card primitive) + T18 (SsmBox) + T28 = 모두 충족. T28 의 stream:handoff-dispatched 가 받는 채널의 첫 surface trigger 가 됨. T29 land 직후 dogfooding + main ff merge 체크포인트 (사용자 사전 결정).
