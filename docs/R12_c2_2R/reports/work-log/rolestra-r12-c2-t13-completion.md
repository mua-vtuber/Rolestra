---
name: R12-C2 T13 종결 — B NextStep classifier + Orchestrator wire (2026-05-05)
description: R12-C2 Round 2 T13 완료. classifier + 4 wire 위치 + cap interlock + RunStep 영속 + stream emit. 다음 T14 (MessageRenderer 카드 variant) 진입 가이드.
type: project
originSessionId: 21b8aa32-37c6-44e6-bb00-b3f72c45b015
---
# R12-C2 T13 종결 (2026-05-05)

commit `6b5cb59` (`feat/r12-c2-redesign-r2` 위, base `a493619` = T12). 8 파일 / +1354 / -3.

**Why:** spec §11.18.8 의 NextStep 7 카드 분류기 + Orchestrator 재배선이 R12-C2 Round 2 기반층의 마지막 piece. T11 (검사관) + T12 (RunStep 영속) 가 깔린 위에서 T13 = "회의 turn 후 다음 동작 신호". P3 (UI 카드) / P6 (HandoffApprovalModal) 가 본격 사용.

**How to apply:** 새 세션 진입 시 T14 (P3 진입 1 호 — MessageRenderer 카드 variant + 채팅창 의견 카드) 직행. spec §11.13a + plan T14 + tasks.json id=15.

## 산출 요약

### 1. classifier 모듈 (`src/main/meetings/engine/next-step-classifier.ts`)

- `NextStepClassifierInput` / `NextStepClassifierContext` / `classifyNextStep` / `classifyNextStepWithDetails` — 순수 함수 분류기.
- spec §11.18.8b 7 우선순위 (룰 1 additions + cap 미도달 → continue / 룰 4 resolved → minutes / 룰 5 minutes+chain → handoff / 룰 6 cap or no-chain → end / 룰 7 fall-through wait). 룰 2 (approve 키워드) / 3 (tool 키워드) 는 T28+ placeholder.
- §11.18.8d cap interlock — `applyMaxRoundsInterlock(natural, context)` — natural=continue + currentRound >= maxRounds 시 'end' 강제 override + capOverride flag 영속.
- `NextStepClassifierInputError` — phase ↔ response shape mismatch / minutesComposed ↔ phase 정합 / 음수 round 검증. silent fallback 금지.
- 29 unit 테스트 (룰별 + interlock + 우선순위 정합 + assertValid).

### 2. orchestrator wire (`src/main/meetings/engine/meeting-orchestrator.ts`)

- `runStepService` deps 주입 (main/index.ts + 단위 테스트 mock 갱신).
- `classifyAndPersistTurn` private helper — 분류 → `runStepService.appendOne` (step_kind='next_step_classify') → `streamBridge.emitNextStepClassified`. 실패 시 로깅만, 회의 흐름 무중단.
- `snapshotTreeFlags` helper — `opinionService.tally` 결과로 allOpinionsResolved + depthCapReached 산출. `isAllResolved` 트리 walk 추가.
- `turnIndexCounter` — 회의 안 turn 순서 0 부터 monotonically 증가, `run()` 진입 시 0 reset.
- 호출 위치 4 곳:
  - `runGatherPhase` 매 AI turn 직후 (actorKind='employee', currentRound=0)
  - `runQuickVotePhase` 매 AI turn 직후 (actorKind='employee', currentRound=1)
  - `runFreeDiscussionPhase` 매 AI turn 직후 (actorKind='employee', currentRound=opinionRound) — cap interlock 발동 가능 위치
  - `runComposeMinutesPhase` 작성 직후 boundary (actorKind='moderator', actorId=null, minutesComposed=true) — handoff/end 분기

### 3. stream IPC (`src/shared/stream-events.ts` + `src/main/streams/stream-bridge.ts`)

- `StreamNextStepClassifiedPayload` (meetingId / channelId / runStepId / phase / round / turnIndex / card / capOverride).
- `KNOWN_EVENT_TYPES` 에 `'stream:next-step-classified'` 추가.
- `validateShape` case 추가 (모든 필드 type 검증).
- `emitNextStepClassified(payload)` 헬퍼.
- preload `typedOnStream` 은 기존 generic 으로 자동 지원 — renderer 가 `window.arena.onStream('stream:next-step-classified', ...)` 호출 가능.

### 4. orchestrator wire integration 테스트 (3 종)

`src/main/meetings/engine/__tests__/meeting-orchestrator.test.ts` 안 신규 describe block:
- happy-path: gather (2) + quick_vote (2) + compose_minutes boundary (1) = 5 RunStep 영속 + 5 stream emit. turnIndex 0~4 monotonic. moderator boundary card='end' (chain 없음).
- cap interlock: maxRounds=2 채널 + freeDiscussionRound 합의 안 됨 + additions 응답 → free_discussion 안 capOverride 발생 (자연 continue → end). output_json.natural='continue' / row.nextStepCard='end' / stream.capOverride=true.
- classifier throw 회의 무중단: appendOne mockImplementation throw → run() 정상 완료 + meetingService.finish 호출.

## 핵심 결정

1. **T13 = signal layer.** 결과 전파군 카드 (approve/tool/handoff/minutes/end) 의 모달 / pause / 회의 자동 종결 등 behavior change 는 placeholder. T28+ HandoffApprovalModal land 시 본격 wire. 본 sub-task 는 RunStep 영속 + stream emit 만.
2. **per-AI 발화 분류** (spec §11.18.8 "발화 직후" 정확 준수) — gather/quick_vote 는 N AI × 1 = N 분류, free_discussion 은 N AI × M round × K opinion 분류 + compose_minutes boundary 1 추가.
3. **moderator boundary** = compose_minutes 직후 1 회 호출 — actorKind='moderator', actorId=null (RunStep 도메인 정책 따름).
4. **chain 정의 surface 미land** — `hasNextChain` 항상 false. T28+ 채널 chain DB 컬럼 land 시 본격 분기 ('handoff' card 도달).
5. **classifyNextStepWithDetails** 별도 entry point — orchestrator 가 stream payload 의 capOverride flag 채울 때 자연 분류 결과 함께 받기 위함. 외부 텔레메트리 / RunStep output_json 도 자연 분류 ↔ 최종 카드 차이 추적 가능.
6. **assertValid** silent fallback 금지 — phase 'gather' + Step3 response 같은 caller 잘못은 즉시 throw. 음수 round / maxRounds 도 throw.
7. **WSL binding 복구 절차 미적용** — typecheck/vitest 다 통과해서 better-sqlite3 rebuild 불필요. dev 빌드는 Windows 위임.

## 검증

- `npm run typecheck:node` + `typecheck:web` = 0 error
- `npx vitest run` = 3282 PASS / 13 skip / 0 fail
  - T12 baseline 3250 + 32 신규 (29 classifier unit + 3 orchestrator wire)
- `npm run inspect:safety` = 95 hits (T12 baseline 95 와 동일 — T13 가 추가한 위반 0).

## 다음 작업 = T14 (P3 진입 1 호)

T14 — MessageRenderer 카드 variant + 채팅창 카드. spec §11.13a.

산출 (예정):
- `src/renderer/features/messenger/MessageRenderer/CardVariant.tsx` 신규 — opinion kind (root/revise/block/addition/self-raised/user-raised) + meeting-minutes kind 카드 렌더
- Card primitive (R3 land) + themeKey 6 테마 변형
- 본문 truncate 금지 (spec §11.18.7 — 모더레이터 회의록 truncate 금지 정합)

진입 위치: tasks.json id=15. plan T14 단락. spec §11.13a (회의록 카드 + 의견 카드).

블로커 없음 — T13 (분류기 + RunStep) 위에서 T14 (UI 카드) 자유 진행.
