---
name: R12-C2 T29 종결 — H2 받는 부서 첫 화면 인계 패키지 (P6 진입 3 호, 2026-05-07)
description: 받는 부서 H2 카드 (HandoffPackageCard) + 회의록 보기 모달 + IPC 4 신규 + 회의 시작 시 handoff context 주입 wire. production ad99d83. dogfooding + main ff merge 체크포인트 진입.
type: project
---

# R12-C2 T29 종결 (2026-05-07)

worktree `feat/r12-c2-redesign-r2`, base `a166bc8` (= T28 sync). production commit `ad99d83`. 14 파일 (5 신규 + 9 갱신) / +579 lines.

**Why:** spec §11.22 H2. 받는 부서가 인계받은 의뢰서를 *첫 진입 시* 카드로 surface — 회의록 + 인계 사유 + 작업 list + [의견 모아 회의 시작] 버튼. T28 (handoff_mode 분기 wire) + T27 (handoff_dispatch row 영속) 위에 *받는 측 첫 surface* 를 land.

**How to apply:** dogfooding + main ff merge 체크포인트 (사용자 사전 결정 — 메모리 `rolestra-r12-c2-p6-merge-checkpoint.md`). T29 land 직후 *반드시* (1) Windows dogfooding 위임 → (2) 회귀 발견 시 fix round → (3) 회귀 0 확인 시 worktree → main ff merge + push.

## 사용자 결정 (2026-05-07, AskUserQuestion 응답)

1. **받는 부서 작업 list = mission card payload 의 expectedOutputs 재사용**: 사용자 답 = 옵션 1 (Recommended). 회의록 양식 재설계 (spec §11.18.6 [합의]/[제외] 2 섹션 유지) 안 함. 사용자 명시: "이미 명세당 있는 임무 카드 안의 예상 산출물 재사용".
2. **회의 소집 = 새 전용 IPC handoff:start-meeting-from-package**: 사용자가 옵션 설명 오타로 명확 결정 X — 기본값 (Recommended) 따라 새 전용 IPC. 사용자 명시: "내부 구조 결정은 우리에게 맡기는 게 맞다". 사용자 입장에서는 [의견 모아 회의 시작] 단추 하나만 보임.

## 신규 파일 5

- `src/shared/handoff/next-actions.ts` (+105) — missionCard.payload → 작업 list 변환. kind 별: spec=expectedOutputs / fix=problem 1-line + expectedOutputs / change-request=expectedOutputs.
- `src/shared/handoff/__tests__/next-actions.test.ts` (+97) — 6 tests
- `src/shared/handoff/dispatch-row-summary.ts` (+24) — IPC 경계 payload (id + HandoffPackage + openedAt + createdAt)
- `src/renderer/features/handoff/HandoffPackageCard.tsx` (+178) — 받는 부서 SsmBox top 카드
- `src/renderer/features/handoff/HandoffMinutesViewerModal.tsx` (+57) — [회의록 통째 보기] 모달 (truncate X)
- `src/renderer/features/handoff/use-handoff-package.ts` (+118) — 받는 채널 단위 unopened lookup hook + open mark + dismiss + stream:handoff-dispatched 재 fetch

## IPC 4 신규

- `handoff:list-by-channel(channelId, unopenedOnly?)` — 받는 채널 의뢰서 list. 첫 surface 결정.
- `handoff:open(dispatchRowId)` — 의뢰서 열람 도장 (idempotent — 첫 호출만 set).
- `handoff:read-with-minutes(dispatchRowId)` — 의뢰서 1 통 + 회의록 본문 + nextActions 묶음 read. UI 단일 진입점.
- `handoff:start-meeting-from-package(dispatchRowId, topic)` — [의견 모아 회의 시작] 단일 entry. 4 단계: row read → open mark → MeetingService.start → orchestrator boot via factory.createAndRun + priorContextSystemMessage.

## 회의 시작 wire — handoff context 주입

- **MeetingSession 옵션에 `priorContextSystemMessage` 신규** — topic system message 직후 prepend (provider history 안 두 번째 system message).
- **MeetingOrchestratorFactory.createAndRun input 에 `priorContextSystemMessage` 옵션 추가** — 기존 channel:start-meeting path 는 undefined, handoff:start-meeting-from-package 는 composeHandoffContextSystemMessage 결과.
- **composeHandoffContextSystemMessage** (handoff-handler 안 helper) — 양식: `[보낸 부서 인계 회의록]` + minutesBody + `[당신이 처리할 작업]` + nextActions list + `[인계 사유]` + reason + 응답 schema 안내.
- **HandoffStartMeetingResolver interface** — channelId → participants + ssmCtx 합성 helper. main/index.ts 에서 channel:start-meeting 와 동일 형식 wire (members.map → providerId 기반 Participant + projectPath: '' + permissionMode: 'hybrid').

## SsmBox 통합

받는 채널 (role !== null + !== 'general') 진입 시 useHandoffPackage hook 호출 → unopened 의뢰서 1 통 surface. pending 있으면 HandoffPackageCard 우선 표시 + role variant hide. 사용자 [닫기] 후 일반 layout.

dismiss state 는 same-session memory — 같은 채널 재진입 시 unopenedOnly false 결과로 빠짐 (사용자 [패키지 다시 보기] 채널 헤더 버튼은 후속 sub-task / dogfooding 시점 mount).

## i18n keys 신규

`handoff.card.*` (title / subtitle / reason / minutesPreview / viewFullMinutes / nextActions / startMeeting / close / actionError / defaultTopic) + `handoff.minutesViewer.*` (ko + en).

## 검증

- typecheck:node + typecheck:web 0
- vitest **3812 PASS** / 13 skip / 0 fail (T28 baseline 3806 → **+6 신규**: nextActions extractor 6)
- inspect:safety **102 hits** (T28 baseline 동일 — 신규 위반 0)

## 미작업 (의도, 후속)

- HandoffModeToggle 진입점 mount (사이드바 ⚙ / 채널 설정 모달) — 컴포넌트 (T28) + HandoffPackageCard (T29) 모두 land 후 dogfooding 시점 묶음 mount 권장
- 'auto' 분기 Notification 발송 — T30 책임 (NotificationService 카테고리 1 호 = handoff-auto-review)
- 채널 헤더 [패키지 다시 보기] 버튼 — 사용자가 카드 닫은 후 재 surface entry. 현재 dismiss state 가 same-session 만 보존
- audit chain 외 chain (idea/planning/design/implement) actual wire — chain resolver placeholder branches 가 후속 sub-task 가 교체

## 다음 = dogfooding + main ff merge 체크포인트

P6 진입 1 호 (T27) → 2 호 (T28) → 3 호 (T29) 모두 land. chain 한쪽 끝 (보낸 부서 회의 종결 → 결재 모달) 부터 다른 끝 (받는 부서 카드 → 회의 시작 + 컨텍스트 주입) 까지 처음 닿는 시점. 사용자 사전 결정에 따라:

1. Windows dogfooding 위임 (사용자 직접 실행)
2. 회귀 발견 시 fix round
3. 회귀 0 확인 시 worktree `feat/r12-c2-redesign-r2` → main ff merge + push

이후 T30 (검토 → 리뷰 Notification — D 의미 단위 알림 #1) 이 다음 sub-task. T28 + T29 모두 충족.
