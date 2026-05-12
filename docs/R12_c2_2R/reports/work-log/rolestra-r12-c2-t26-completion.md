---
name: R12-C2 T26 종결 — run-step-bridge thin module (ExecutionService → RunStep 영속, P5 진입 4 호, 2026-05-07)
description: R12-C2 Round 2 P5 진입 4 호 완료. ExecutionService 의 PatchSet/ApplyResult + CommandRequest/CommandResult 를 NewRunStep (`step_kind='tool_invoke'`) 1 row 로 변환하는 thin module. T15/T16a/T17/T24/T25 와 동일 thin 패턴 — types + 순수 helper 만, orchestrator wire 0, ExecutionService 본체에 RunStepService 의존 *주입 X*. side_effect_summary 1-line 합성 + actor / context invariants 검증. 다음 T27 (P6 진입 1 호 — handoff_dispatch table migration 021) 진입 가이드.
type: project
originSessionId: continuation
---
# R12-C2 T26 종결 (2026-05-07)

worktree `feat/r12-c2-redesign-r2`, base `b00e774` (= T25 tasks.json sync). production commit `5155adb`. 2 파일 / +1007 / -0 (2 신규).

**Why:** spec docs/specs/2026-05-01-rolestra-channel-roles-design.md §11.19.2 (RunStep 도메인 — step_kind='tool_invoke' / actor 정합 / next_step_card NULL 정책) + §11.19.4 (영속 정책 — truncate 금지 / atomic write / append-only) + plan docs/R12_c2_2R/plans/2026-05-04-rolestra-phase-r12-c2.md line 453-462 (T26 산출 = ExecutionService hook → RunStepService 영속 + side_effect_summary 1-line 합성). T12 land 로 RunStepService skeleton + assertValid 가 정식화되었으나, ExecutionService 의 *결과 객체* 를 NewRunStep 으로 변환하는 *전용 helper* 가 부재. T26 = (a) `RunStepBridgeInvariantError` 통합 throw class (b) `assertActorIdentity` + `assertContextInvariants` 1차 차단 (RunStepService.assertValid 의 pre-flight) (c) `buildPatchApplyRunStep` — PatchSet + ApplyResult → NewRunStep (d) `composePatchApplySideEffect` exported helper — 5 분기 1-line 합성 (e) `buildCommandRunStep` — CommandRequest + (CommandResult|error) → NewRunStep, success/failure 2 분기. 5 항목 통째 land.

**How to apply:** 새 세션 진입 시 T27 (P6 진입 1 호 — handoff_dispatch table migration 021) 진입 가능. T27 의존 = T12 (RunStepService skeleton) + T13 (NextStep classifier) + T17 (review/audit workflow) + T26 = 모두 충족. T26 의 `buildPatchApplyRunStep` / `buildCommandRunStep` 결과는 caller (회의 orchestrator / approval-decision-router 등) 가 RunStepService.appendOne 에 그대로 넘기면 영속됨 — bridge 자체는 *변환만* 하고 영속 시점은 caller 책임. T28 (HandoffApprovalModal wire) / T29 (HandoffPackageCard) / T31~T34 (H 진행률 위젯) 가 본 bridge 호출 위치를 추가.

## 핵심 결정

### thin module 패턴 보존 — ExecutionService 본체에 RunStepService 주입 X

T15 (idea) / T16a (design) / T17 (audit / review) / T24 (implement) / T25 (audit-handoff-dispatch) workflow 들은 모두 *types + 순수 helper* 만 — orchestrator / DB / IPC / 파일 시스템 의존 X. T26 도 동일 패턴 그대로:
- 본 모듈은 PatchSet / ApplyResult / CommandRequest / CommandResult → NewRunStep 변환 까지만.
- RunStepService.appendOne 호출은 *호출자 책임* — bridge 는 그 직전 단계까지만.
- ExecutionService 본체에 RunStepService 의존 *주입 X* — security boundary (audit log + circuit breaker) 와 영속 boundary (RunStep) 를 분리.

근거:
- T15 ~ T25 6 회 동일 패턴 통과한 검증된 설계.
- *분할 책임* — 변환 / 직렬화 / sideEffect 합성 = 본 모듈 / 호출 시점 결정 / 영속 = caller. 둘이 섞이면 회귀 발생률 ↑.
- 회의 외 ExecutionService 호출 (예: 사용자 직접 결재 후 적용) 시 meetingId / turnIndex 가 없어 RunStep 영속을 *안 해야 함* — 본 bridge 가 ExecutionService 안에 박혀 있다면 if 분기로 우회해야 하지만, 분리 시 caller 가 깔끔하게 skip.

### `composePatchApplySideEffect` exported — 1-line 합성 정밀 검증

5 분기 매트릭스 (dryRun × success × rolledBack):

| dryRun | success | rolledBack | sideEffectSummary |
|---|---|---|---|
| true | true | — | `dry-run 미적용 (N files)` |
| true | false | — | `dry-run 실패: <error>` |
| false | true | — | `파일 N 개 적용` (appliedCount) |
| false | false | true | `적용 실패 + rollback: <error>` |
| false | false | false | `적용 실패: <error>` |

근거:
- caller 가 직접 메시지 합성하면 일관성 깨질 위험 ↑ — helper 강제.
- exported 라서 단위 테스트가 정밀하게 *문자열 contract* 까지 검증 가능 (Korean text, parens, error fallback).
- `error` 필드 누락 시 `'unknown'` fallback — silent fallback 금지 정책 외 (메시지 합성은 *표시* 영역, 영속 자체는 outputJson 의 raw `error` 전파).

### inputJson / outputJson — newContent / stdout 본문 보존 X

`spec §11.19.4 truncate 금지` 와 *모순 아님* — bridge 는 *직렬화 정책* 을 정의:
- PatchSet: targetPaths 만 보존 (newContent / originalContent 직접 X — audit log + 파일 시스템 양쪽에 이미 보존, RunStep 안 중복 X).
- CommandResult: stdout / stderr 의 *byte length* 만 (본문 X — caller 가 별도 보관).
- truncate ≠ 본문 보존 X. truncate = "1KB 만 자르고 ..." 같은 손상 — 본 모듈은 *전체 메타데이터* 보존, 본문은 *애초에 다른 store* 위치.

근거:
- RunStep row 1 개가 거대해지면 SQLite write latency ↑ + audit log replay 시 메모리 폭발.
- newContent / stdout 은 별도 보관 — RunStep 은 *시스템 단계 단위* 누적 (spec §11.19), *내용물* 추적은 audit log + 파일 시스템.
- caller 가 raw 본문이 필요하면 inputJson 의 operationId 로 audit log 매핑.

### actor / context invariants — RunStepService.assertValid 의 pre-flight

`assertActorIdentity` + `assertContextInvariants` 가 RunStepService.assertValid 와 동일 rule 을 *bridge 시점* 에 1차 검증:
- actorKind=employee + actorId blank/null → throw
- actorKind=user/system/moderator + actorId set → throw
- meetingId / channelId blank → throw
- round / turnIndex 음수 또는 비정수 → throw
- durationMs 음수 또는 Infinity → throw

근거:
- 잘못된 입력이 RunStepService.assertValid 까지 가면 메시지가 흐릿 — bridge 에서 1차 throw 하면 호출 위치 빠르게 특정.
- `Number.isInteger` / `Number.isFinite` 강제 — JS 의 `NaN`, `Infinity`, `1.5` 가 silent 통과 차단.
- *디버깅 용이* + 회의 abort 회피 (FK / CHECK 위반은 SqliteError 까지 갔다가 throw — 이미 transaction 시작 후라 rollback overhead).

### `CommandBridgeInput` — discriminated union (success / failure)

ExecutionService.runCommand 는 *성공 시 CommandResult 반환* / *실패 시 throw*. caller 가 두 분기를 모두 영속하고 싶으면 try-catch 로 잡아 본 bridge 에 분기 표시 (`kind: 'success' | 'failure'`) 와 함께 호출.

근거:
- 한 input 안에 result / error 가 둘 다 있으면 invariant 위반 — discriminated union 으로 *애초에 표현 불가* 하게 강제.
- caller 코드가 self-describing — `{ kind: 'success', result }` / `{ kind: 'failure', error }` 라서 grep 시 분기 즉시 식별.
- 향후 partial 분기 (예: timeout 으로 stdout 일부 + exit -1) 추가하기 쉬움 — union 에 새 kind 만 추가.

## 신규 2 = 2 파일

**신규 2:**
- `src/main/execution/run-step-bridge.ts` (399 lines) —
  · `RunStepBridgeInvariantError` — invariant 위반 통합 throw class.
  · `assertActorIdentity(actorKind, actorId)` — RunStepService.assertValid pre-flight.
  · `assertContextInvariants({ meetingId, channelId, round, turnIndex, durationMs })` — context 검증.
  · `PatchApplyBridgeInput` interface — apply 호출 입력 매핑.
  · `buildPatchApplyRunStep(input): NewRunStep` — apply 변환 + sideEffectSummary 합성.
  · `composePatchApplySideEffect(args): string` — exported, 1-line 합성 정밀 검증용.
  · `CommandBridgeInput` discriminated union — `'success' | 'failure'`.
  · `buildCommandRunStep(input): NewRunStep` — command 변환 + sideEffectSummary 합성.
  · `byteLength(s)` — UTF-8 byte length helper (Buffer 의존 X, TextEncoder 사용).

- `src/main/execution/__tests__/run-step-bridge.test.ts` (608 lines) — 37 항목 / 3 describe block:
  · `composePatchApplySideEffect` (6 항목) — 5 분기 합성 + error 누락 fallback.
  · `buildPatchApplyRunStep` (19 항목) — dryRun+success / apply+success(N=2) / 부분 success / failure+rollback / failure+no-rollback / actor invariants 4 / context invariants 6 / inputJson targetPaths 보존 / inputJson 에 newContent 보존 X / empty entries no-op / stepKind+nextStepCard 강제.
  · `buildCommandRunStep` (12 항목) — success outputJson+sideEffect / exit 1 도 success kind / failure outputJson+sideEffect / command blank throw / cwd blank throw / failure error blank throw / actor identity throw / context invariant throw / args 배열 truncate 없음 / UTF-8 byte length 정확 (한글 3 byte) / stepKind+nextStepCard 강제.

## 검증

- typecheck:node + typecheck:web **0**
- vitest **3714 PASS / 13 skip** (T25 baseline 3677 → +37 신규)
  - 신규 37 (run-step-bridge 37)
  - 순증 +37
- inspect:safety **99** (T25 baseline 99, 신규 코드 hit 0 — child_process.exec / migration / IPC / approval / pathguard 모두 무관)

## 미작업 (의도)

- ExecutionService 본체에 RunStepService 의존 *주입 X* — caller (회의 orchestrator / approval-decision-router) 에서 명시 호출. 회의 외 호출 (사용자 직접 결재 후 적용) 시 caller 가 영속 자체 skip.
- 회의 turn 안 *어느 단계* 에서 본 bridge 를 호출할지 (round / turnIndex 결정) 는 orchestrator 책임 — 본 bridge 는 입력 그대로 받음.
- T28 HandoffApprovalModal + handoff_mode 분기 wire 가 `outcome.kind === 'planning_handoff'` 시 mission_card_json 영속과 함께 본 bridge 도 호출 (handoff dispatch 자체도 tool_invoke 로 RunStep 영속 — `step_kind` 는 'handoff_dispatch' 가 더 정확하지만, 본 모듈은 ExecutionService 결과 변환만 — handoff RunStep 은 caller 가 직접 NewRunStep 합성).
- T31~T34 H 진행률 위젯이 RunStep listByChannel + listByMeeting 결과로 dashboard 표시 — 본 모듈과 무관.
- inputJson 의 newContent / outputJson 의 stdout 본문은 별도 store (audit log) — 본 모듈은 byte length / count 만.

## 다음 = T27 (P6 진입 1 호) 권장

### T27 — G. 외주 의뢰서 schema + handoff_dispatch 테이블 (migration 021)

T27 의존 = T12 + T13 + T17 + T26 = 모두 충족. **T27 핵심:**
- `migrations/021-handoff-dispatch.ts` 신규 — handoff_dispatch 테이블 (id / meeting_id / from_channel_id / to_channel_id / reason / minutes_id / mission_card_json / mode / dispatched_at / opened_at / created_at).
- `src/shared/schema/handoff-package.ts` 신규 — HandoffPackage 정식 schema (sender + minutes 통째 + reason + next_actions + mission_card).
- `HandoffDispatchService` — dispatch / open / track 메서드.

**T27 *주의*:**
- T11 mig-non-forward-only 검사관 통과 필수 — IF NOT EXISTS / DROP 금지 / 컬럼 추가만.
- mission_card_json 컬럼은 `parseMissionCardJson` (T23 schema) 으로만 deserialize — boundary 검증 1 회.
- spec §11.16 부서 lock + §11.22 H2 부합.
- T25 의 `planAuditDispatch` outcome.kind='planning_handoff' branch 에서 missionCard 직렬화해 handoff_dispatch.mission_card_json 영속.
- handoff_dispatch row INSERT 자체는 audit-handoff-dispatch 모듈 X — T27 의 HandoffDispatchService.dispatch 메서드 책임.

T27 진입 시 *반드시* 확인:
- T26 의 `buildPatchApplyRunStep` / `buildCommandRunStep` 결과 → handoff_dispatch row 와 *별개 영속* (RunStep = 단계 일지 / handoff_dispatch = 인계 추적). 두 영속이 같은 transaction 안에 묶일지, 별도 transaction 으로 분리할지는 T28 wire 시점 결정.
- T25 의 `outcome.kind === 'planning_handoff'` branch 가 T27 의 HandoffDispatchService 와 어떻게 wire 되는지 spec §11.22.4 (인계 패키지 = 회의록 본문 통째 + metadata) 그대로.
- plan line 467-482 (T27) 그대로.
