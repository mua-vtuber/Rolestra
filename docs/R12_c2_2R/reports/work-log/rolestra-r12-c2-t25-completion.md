---
name: R12-C2 T25 종결 — audit-handoff-dispatch (NG → planning 인계 분기, P5 진입 3 호, 2026-05-07)
description: R12-C2 Round 2 P5 진입 3 호 완료. 검토 부서 audit verdict 분기 wire — verdict='ok' → chain end / verdict='ng' → planning 자동 인계 + mission card kind='fix' 생성. T17 audit-workflow 의 분류/추출/payload + T23 mission-card schema 의 'fix' payload 합성. T16a/T17/T24 와 같은 thin module 패턴 — orchestrator wire 0, types + 순수 helper 만. 다음 T26 (ExecutionService dryRun 의 RunStep 영속) 또는 T27 (handoff_dispatch table migration 021) 진입 가이드.
type: project
originSessionId: continuation
---
# R12-C2 T25 종결 (2026-05-07)

worktree `feat/r12-c2-redesign-r2`, base `99dbcbf` (= T24 tasks.json sync). production commit `9208202`. 2 파일 / +810 / -0 (2 신규).

**Why:** spec docs/specs/2026-05-01-rolestra-channel-roles-design.md line 77 (audit = 객관 + 목적 통합 / chain 끝 강제 / NG → 항상 기획) + line 145 (audit 매트릭스 row — OK / NG 분기) + plan docs/R12_c2_2R/plans/2026-05-04-rolestra-phase-r12-c2.md line 247-255 (T25 산출 — audit-workflow 종결 분류 + 기획 인계 분기 정식 wire). T17 land 로 audit verdict 분기 + problem 추출 + handoff payload builder 가 정식화되었으나, *payload → mission card 변환* 과 *verdict 분기 single entry plan* 의 thin module 이 부재. T25 = (a) `AuditDispatchOutcome` discriminated union 정의 (b) `planAuditDispatch` single entry — verdict 분기 별 outcome 합성 (c) `buildFixMissionCardFromAuditPayload` — T17 payload + T23 mission card schema 변환 (d) `composeFixMissionBody` 기본 body 합성 (e) `AuditDispatchInvariantError` — T17 의 `AuditHandoffPayloadInvariantError` wrap + 자체 invariant 통합. 5 항목 통째 land.

**How to apply:** 새 세션 진입 시 T26 (P5 진입 4 호 — ExecutionService dryRun 의 RunStep 영속) 또는 T27 (P6 진입 1 호 — handoff_dispatch table migration 021) 진입 가능. T26 의존 = T13 (NextStep classifier) + T24 = 모두 충족. T27 의존 = T12 (RunStepService skeleton) + T13 + T17 + T26 — T26 land 후 진입 가능. T25 의 `planAuditDispatch` 결과는 P6 의 orchestrator wire (T28 HandoffApprovalModal + handoff_mode 분기) 가 직접 소비 — `outcome.kind === 'planning_handoff'` 면 missionCard JSON 직렬화해 handoff_dispatch.mission_card_json 영속 + targetChannelId 받는 부서 회의 boot.

## 핵심 결정

### thin module 패턴 보존 — orchestrator wire 0

T15 (idea) / T16a (design) / T17 (audit / review) / T24 (implement) workflow 들은 모두 *types + 순수 helper* 만 — orchestrator / DB / IPC / 파일 시스템 의존 X. T25 도 동일 패턴 그대로:
- 본 모듈은 audit 회의 결과 받아 verdict 분류 + payload 변환 + mission card 생성 까지만.
- handoff_dispatch row INSERT / 받는 부서 회의 boot / Notification 발송은 *호출자 책임*.
- 단위 테스트가 격리되어 회귀 위험 0 (mission card / payload 모두 in-memory pure).

근거:
- T27 (handoff_dispatch 테이블 영속) / T28 (HandoffApprovalModal wire) 가 *위에 얹는 형태* — thin 모듈이 P3-P5 6 회 동일 패턴 통과한 검증된 설계.
- *분할 책임* — verdict 분류 / mission card schema 위반 = 본 모듈 / 채널 lookup / IPC 발송 / DB 영속 = caller. 둘이 섞이면 회귀 발생률 ↑.

### `AuditDispatchOutcome` discriminated union — verdict 분기 self-describing

`'end'` | `'planning_handoff'` 2 종 union. 각 분기에 `verdict` 필드 *중복* (kind 와 동일 정보) 명시:

| outcome.kind | verdict | 의미 |
|---|---|---|
| `'end'` | `'ok'` | chain 종료 + 사용자 승인 게이트만 surface |
| `'planning_handoff'` | `'ng'` | planning 자동 인계 + mission card 'fix' 동봉 |

근거:
- caller 가 단일 필드 비교만으로 verdict 추출 가능 — audit log / 분석 시 parse 오버헤드 ↓.
- JSON 직렬화 시 self-describing — 향후 telemetry / 사용자 재시도 분기 토대.
- 외래 DB 영속 시 (T27 handoff_dispatch row) verdict 컬럼 매핑 1:1.

### `planAuditDispatch` single entry — 합성 패턴

T17 의 `classifyAuditVerdict` / `extractAuditProblemList` / `buildAuditHandoffPayload` + T23 의 `buildMissionCard` 를 1 함수에 합성. caller 입장에서는 *audit 회의 결과 통째 + planning 채널 identity + 시간 + UUID* 만 넘기면 outcome 1 객체가 떨어짐.

근거:
- caller (orchestrator) 가 6 helper 를 직접 호출하면 invariant 어긋남 위험 ↑ (예: classify=ng 인데 extract=[] 누락 — 본 single entry 가 즉시 throw).
- verdict='ok' branch 는 planning 채널 dummy 값을 *허용* — caller 가 verdict 모르는 상태에서 호출 가능 (조건부 lookup 분기 회피).
- `'ng'` branch 에서만 invariant 검증 (channel id blank / payload invariant / mission card schema) — 'ok' 분기 단순화.

### Mission card 'fix' payload 변환 시 rationale + authorLabel 제거

T17 `AuditProblem` 은 `{opinionId, title, content, rationale, authorLabel}` 5 필드. T23 mission card 'fix' payload 의 `problemList` 는 `{opinionId, title, content}` 3 필드만. T25 변환 시 rationale + authorLabel *제거*.

근거:
- rationale / authorLabel 정보는 mission card 의 `auditMinutesMarkdown` 본문 (compose_minutes 결과) 에 이미 포함 — 받는 부서 (planning) 가 회의록 본문에서 동일 정보 추출 가능.
- mission card schema 를 *최소 면* 으로 유지 — JSON 직렬화 / IPC payload 크기 ↓.
- caller 가 본 변환을 직접 했다면 휘발 가능 — helper 가 강제 → 일관성 보장.

### `composeFixMissionBody` 기본 body 합성 — caller override 가능

mission card schema 의 `body` 는 `min(1)` 강제. 빈 body 거부. T25 가 *기본 body* 자동 합성 — problem 1-line 요약 (opinionId + title) + count 표기 + 안내문.

```
검토 부서 NG 판정 — 3 건 문제 발견. 기획 회의에서 각 문제를 처리할 작업으로 분배해 주세요.

[발견된 문제]
1. (op-A) 하드코딩 발견
2. (op-B) 마이그레이션 누락
3. (op-C) 의존성 순환

회의록 본문은 mission card 의 `auditMinutesMarkdown` 자리에 통째 보존. 발견된 문제는 회의에서 agreed 처리된 root opinion 만 — excluded 는 처리 X (논의 결과 수용 가능 항목으로 분류).
```

근거:
- caller 가 매번 body 작성하는 부담 ↓ — 단순한 case 는 helper 1 호출만.
- caller 가 더 풍부한 prompt 컨텍스트 (예: 사용자 우선순위 / 선행 작업 목록) 추가하고 싶으면 `missionBody` 인자로 override.
- title 누락 (`Opinion.title` NULL 가능) → '(제목 없음)' normalize → 받는 부서 prompt 가 NULL 분기 가질 필요 X.

### `AuditDispatchInvariantError` — T17 invariant wrap

T17 의 `AuditHandoffPayloadInvariantError` 가 throw 하면 T25 는 `AuditDispatchInvariantError` 로 wrap 후 re-throw. caller 는 T25 의 invariant 1 종만 catch.

근거:
- 호출자 (orchestrator) 가 *어디서 invariant 가 깨졌는지* 단일 catch 로 처리 가능 — error type 매트릭스 단순화.
- 원본 메시지는 wrap message 안 보존 → 디버그 시 trace 가능.
- T23 `MissionCardInvariantError` (zod 위반) 은 wrap 안 함 — schema 위반은 audit-dispatch invariant 가 아닌 별개 영속 boundary 에러로 분리.

## 신규 2 = 2 파일

**신규 2:**
- `src/main/meetings/workflows/audit-handoff-dispatch.ts` (401 lines) —
  · `AuditDispatchOutcome` discriminated union — `'end'` | `'planning_handoff'`.
  · `AuditDispatchInvariantError` — invariant 위반 통합 throw class.
  · `DEFAULT_FIX_MISSION_EXPECTED_OUTPUTS` 상수 — 자유 텍스트 list 2 종.
  · `composeFixMissionBody({problemList})` — body 합성 + count + opinionId/title 1-line + blank title normalize.
  · `buildFixMissionCardFromAuditPayload({payload, assignedProviderId, missionCardId, createdAt, body?, inputFiles?, expectedOutputs?})` — T17 payload → T23 MissionCard 'fix' 변환 (rationale + authorLabel 제거).
  · `planAuditDispatch({opinions, auditMinutesMarkdown, sourceAuditMeetingId, sourceAuditChannelId, targetPlanningChannelId, assignedPlanningProviderId, missionCardId, generatedAt, missionBody?, missionInputFiles?, missionExpectedOutputs?})` — single entry. classify / extract / buildPayload / buildMissionCard 합성.

- `src/main/meetings/workflows/__tests__/audit-handoff-dispatch.test.ts` (409 lines) — 24 항목 / 3 describe block:
  · `composeFixMissionBody` (5 항목) — 빈 list throw / 단일 / 다수 / blank title normalize / whitespace title normalize.
  · `buildFixMissionCardFromAuditPayload` (10 항목) — 정상 build / body override / inputFiles override / expectedOutputs override / assignedProviderId blank throw / missionCardId blank throw / createdAt NaN throw / createdAt 음수 throw / targetChannelId 매핑 / problemList rationale+authorLabel 제거.
  · `planAuditDispatch` (9 항목) — verdict='ok' end / verdict='ok' planning dummy 허용 / verdict='ng' planning_handoff / verdict='ng' channel blank throw / verdict='ng' 빈 회의록 wrap throw / verdict='ng' provider blank throw / body+inputFiles+expectedOutputs override 전파 / generatedAt 동기화 / agreed root 다수 모두 포함.

## 검증

- typecheck:node + typecheck:web **0**
- vitest **3677 PASS / 13 skip** (T24 baseline 3653 → +24 신규)
  - 신규 24 (audit-handoff-dispatch 24)
  - 순증 +24
- inspect:safety **99** (T24 baseline +0, 신규 코드 모두 순수 helper / 마이그레이션 0)

## 미작업 (의도)

- handoff_dispatch row 영속 자체는 T27 (P6 진입 1 호) 책임 — 본 T25 시점엔 mission card 객체까지만, 실제 DB INSERT 는 T27 land 후 wire.
- planning 채널 lookup (`ChannelService.getByRole(projectId, 'planning')`) 자체는 caller (orchestrator) 책임 — 본 모듈은 resolved channelId 를 입력 받음.
- assigned provider resolve (`designated-worker-resolver` 호출) 도 caller 책임 — 본 모듈은 resolved providerId 를 입력 받음.
- HandoffApprovalModal + handoff_mode 분기 wire 는 T28 책임 — `outcome.kind === 'planning_handoff'` 받아 모달 등장 / auto Notification 분기.
- 받는 부서 첫 화면 인계 패키지 카드 (`HandoffPackageCard`) 표시는 T29 책임 — 본 모듈은 payload 까지만.
- audit handoff 와 review handoff 는 *별 분기* — T17 의 `shouldSpawnReviewFromAudit` 와 T25 의 audit→planning 인계는 동시 발생 가능 (audit verdict='ng' + handoff_mode='auto' or checkbox). 두 분기 결합 wire 는 T28 책임.

## 다음 = T26 (P5 진입 4 호) 또는 T27 (P6 진입 1 호)

### T26 권장 — ExecutionService dryRun 의 RunStep 영속

T26 의존 = T13 (NextStep classifier) + T24 = 모두 충족 (T25 와 무관). **T26 핵심:**
- ExecutionService 의 dryRun / apply / rollback step 별 RunStep 영속 — `step_kind='tool_invoke'` row 생성.
- side_effect_summary 1-line 작성 ("파일 X 작성 (3 lines)" / "명령 Y 실행 (exit 0)").

**T26 *주의*:**
- T12 RunStepService skeleton 호출 path 활용 — 본 모듈은 ExecutionService hook 만 추가.
- dryRun 과 apply 는 *서로 다른 operationId* — T24 의 PatchSet 호출에서도 보존 (audit log row 별 분리).
- 영속 실패 시 silent skip 금지 — invariant throw + 회의 abort.

### T27 — G. handoff_dispatch 테이블 (migration 021)

T27 의존 = T12 + T13 + T17 + T26 — T26 land 후 진입 가능. **T27 핵심:**
- `migrations/021-handoff-dispatch.ts` 신규 — handoff_dispatch 테이블 (id / meeting_id / from_channel_id / to_channel_id / reason / minutes_id / mission_card_json / mode / dispatched_at / opened_at / created_at).
- `src/shared/schema/handoff-package.ts` 신규 — HandoffPackage 정식 schema (sender + minutes 통째 + reason + next_actions + mission_card).
- `HandoffDispatchService` — dispatch / open / track 메서드.

**T27 *주의*:**
- T11 mig-non-forward-only 검사관 통과 필수 — IF NOT EXISTS / DROP 금지 / 컬럼 추가만.
- mission_card_json 컬럼은 `parseMissionCardJson` 으로만 deserialize — boundary 검증 1 회.
- spec §11.16 부서 lock + §11.22 H2 부합.

T26 / T27 진입 시 *반드시* 확인:
- T25 의 `planAuditDispatch` 결과 → T27 의 handoff_dispatch row 매핑 (outcome.kind === 'planning_handoff' branch).
- T24 의 `buildImplementPatchSet` 결과 → T26 의 RunStep row 매핑 (operationId 일치).
- plan line 257-265 (T26) / line 267-277 (T27) 그대로.
