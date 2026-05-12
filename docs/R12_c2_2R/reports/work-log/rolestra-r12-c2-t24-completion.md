---
name: R12-C2 T24 종결 — implement-workflow simple 1 명 (P5 진입 2 호, 2026-05-07)
description: R12-C2 Round 2 P5 진입 2 호 완료. 구현 부서 simple 1 명 흐름의 thin module — designated worker JSON 응답 schema (zod) + kind 별 prompt builder + path-guard 검증 + PatchSet wrapper + 사용자 dryRun 승인 대기 ImplementApplyPending + abort 단계별 분류 union + role guard. orchestrator wire (mission card 수신 → resolve → ExecutionService → audit 인계) 는 T25/T26/T27 책임. 다음 T25 (audit NG → 기획 인계) 진입 가이드.
type: project
originSessionId: continuation
---
# R12-C2 T24 종결 (2026-05-07)

worktree `feat/r12-c2-redesign-r2`, base `33bcadf` (= T23 tasks.json sync). production commit `4647f08`. 2 파일 / +1197 / -0 (2 신규).

**Why:** spec docs/specs/2026-05-01-rolestra-channel-roles-design.md line 143 (구현 매트릭스 row — R12-C2 = simple 1 명 / 회의 X / ExecutionService apply) + plan docs/R12_c2_2R/plans/2026-05-04-rolestra-phase-r12-c2.md line 433-441 (T24 산출 — `implement-workflow.ts` 신규). T23 land 로 임무 카드 schema + designated-worker-resolver 가 정식화되었으나, *카드를 받은 직원의 응답 형식 / 응답 → PatchSet 변환 / 사용자 dryRun 승인 대기 / abort 단계별 분류* 의 thin module 이 부재. T24 = (a) designated worker JSON 응답 zod 정식화 (b) kind 별 prompt body 합성 (c) path-guard 봉인 (절대 경로 거부 + `..` traversal 거부) (d) PatchSet wrapper (e) 사용자 dryRun 승인 대기 promise holder (f) abort 단계별 분류 union — 6 항목 통째 land.

**How to apply:** 새 세션 진입 시 T25 (P5 진입 3 호 — audit NG → 기획 인계 분기) 권장. T25 의존 = T17 (audit-workflow) + T24 = 모두 충족. T25 = audit-workflow 의 `buildAuditHandoffPayload` 결과 → MissionCard `'fix'` 변환 + handoff_dispatch row 영속 + planning 채널 자동 회의 트리거 wire. T24 의 `implementResponseSchema` / `extractImplementPatchEntries` / `ImplementApplyPending` 은 P5/P6 의 orchestrator wire 가 직접 소비 — 본 T24 시점엔 *공급* 면만 land.

## 핵심 결정

### thin module 패턴 보존 — orchestrator wire 0

T15 (idea) / T16a (design) / T17 (audit / review) workflow 들은 모두 *types + 순수 helper* 만 — orchestrator / DB / IPC / 파일 시스템 의존 X. T24 도 동일 패턴 그대로:
- 본 모듈은 mission card 받아 prompt body 합성 + 응답 검증 + PatchSet 변환 까지만.
- ExecutionService 호출 / 사용자 IPC 모달 / audit 인계 dispatch 는 *호출자 책임*.
- 단위 테스트가 격리되어 회귀 위험 0 (mission card / PatchSet / Pending state 모두 in-memory pure).

근거:
- T16b (design 배선) / T25 (audit handoff) / T27 (handoff_dispatch) 가 *위에 얹는 형태* — thin 모듈이 P3-P4 5 회 동일 패턴 통과한 검증된 설계.
- *분할 책임* — schema invariant 위반 / path-guard 위반 = 본 모듈 / orchestrator stop / 사용자 cancel 분기 = caller. 둘이 섞이면 회귀 발생률 ↑.

### abort 분기 6 종 — 사용자 알림 + audit log 분리 위해 명시적 union

`ImplementWorkflowAbortReason` = 6 분기 discriminated union:
| kind | 트리거 | UX 분리 |
|------|--------|--------|
| `'aborted'` | orchestrator.stop() (회의 중단 버튼 / 큐 cancel) | 일반 abort 메시지 |
| `'designated_worker_failed'` | turn skip / provider error 2 회 누적 | "직원 응답 실패 — 1/2 회" 알림 |
| `'invalid_response'` | schema 통과 X (truncate / patches 0) | "직원 응답 형식 오류" 알림 |
| `'dryrun_rejected_by_user'` | 사용자 dryRun preview 모달에서 거부 | "사용자 거부 — apply 안 함" 알림 |
| `'apply_failed'` | atomic apply 실패 + rollback | "파일 적용 실패 — rollback" 알림 + 시스템 에러 |
| `'replaced'` | 사용자 reset / 새 임무 카드로 교체 | silent (UI replace) |

근거:
- 단일 `'aborted'` 1 종으로 통합하면 사용자가 *왜 멈췄는지* 보지 못함. UX 흐려짐.
- audit log row 별로 분리 추적 가능 — 향후 telemetry / 사용자 재시도 알림 분기 토대.
- `'designated_worker_failed'` vs `'invalid_response'` 의 차이는 *직원 거부 (반복 turn skip)* vs *응답이 schema 미스 (1 회 재요청 후 실패)* — caller (orchestrator) 가 결정.

### 응답 schema 새 형식 — `opinions` 가 아닌 `patches` + `summary`

implement 는 회의 X 라 step1-style `opinions` 배열 (Step1OpinionGatherSchema = Step6DesignedTaskSchema) 재사용 X. 새 schema:
```typescript
{
  name: string,           // 발화자 (provider displayName)
  label: string,          // 발화 ID (예: claude_1)
  summary: string,        // 무엇을 했는지 1~3 줄 (audit log + UI)
  patches: Array<{
    operation: 'create' | 'modify' | 'delete',
    targetPath: string,   // workspaceRoot 기준 상대 경로
    newContent?: string,  // create / modify 시 필수
    reasoning: string,    // 왜 이 변경이 필요한지
  }>,                     // ≥ 1 (빈 배열 거부)
}
```

근거:
- `opinions` 배열은 의견 트리 (root + revise + block + addition) 용 — 코드 변경 list 와 의미 다름.
- `patches` 형식은 ExecutionService 의 PatchEntry 와 1:1 매핑 — `extractImplementPatchEntries` 가 path-guard + workspaceRoot join 만 추가하면 직접 변환 가능.
- `strict()` = extra field 거부 — 미래 schema 진화 시 silent drop 차단.

### path-guard 봉인 — workspaceRoot escape 거부 (4-tier)

`extractImplementPatchEntries` 가 caller 의 workspaceRoot 받아 4 tier 검증:
1. workspaceRoot 자체 검증 — 절대 경로 + non-empty.
2. 절대 경로 거부 (`/etc/passwd` / `C:\foo` 등) — `path.isAbsolute(rel)` throw.
3. `..` traversal 거부 — `path.relative(root, resolved).startsWith('..')` throw.
4. 빈 path / 공백만 거부 — `rel.trim().length === 0` throw.

근거:
- C6 PathGuard ArenaRoot 봉인 (CA-3 TOCTOU) 패턴 — implement 부서가 직원 응답을 그대로 파일 시스템에 적용 직전 1 회 검증.
- PatchApplier (ExecutionService) 가 다시 검증하지만, *boundary 검증* 을 두 곳 (응답 변환 시 / 적용 직전) 두는 것이 정합 — silent fallback 차단.
- 응답 prompt 안 "절대 경로 / `..` traversal 은 시스템이 거부합니다" 안내 → 직원이 잘못된 path 보내면 즉시 재요청 가능.

### ImplementApplyPending — IdeaUserPickPending 패턴 재사용

idea-workflow 의 `IdeaUserPickPending` 의 single-use Promise holder 패턴 그대로:
- `wait()` 호출 후 `commit(decision)` 시 promise resolve.
- `cancel(reason)` 시 reject — orchestrator.stop() 분기.
- settled 후 재사용 X — single-use 봉인 (single 모달 / single response).

근거:
- `await pending.wait()` 가 phase loop 의 자연스러운 정지점 (sync IPC 응답까지 대기).
- IPC 핸들러는 `pending.commit(decision)` 1 줄 호출만 — DB / state 의존 X.
- 회귀 위험 낮음 — 같은 패턴이 idea-workflow 에서 P3 phase 중 검증됨.

`ImplementApplyDecision = { approved: true } | { approved: false, reason: string }` discriminated union. `reason` 은 사용자가 모달에서 작성한 거부 이유 (선택) → audit log + 알림에 보존.

### 모든 mission card kind → 'implement' capability (R12-C2 시점)

`capabilityForMissionKind(kind: MissionCardKind): RoleId` = 항상 `'implement'` 반환 (3 종 통일). 근거:
- R12-C2 시점에 sub-task 분담 (frontend / backend / test 등) 미존재 — 단일 'implement' role 1 개로 충분.
- R12-W phase 진입 시 sub-skill 정식화 (예: 'implement.frontend' / 'implement.backend' / 'implement.test') — 본 helper 만 갱신하면 즉시 분담 발동.
- 단일 진실 원천 — 호출자 (orchestrator) 가 capability 매핑 코드 안 흩어지지 않도록 helper 1 곳 강제.

## 신규 2 = 2 파일

**신규 2:**
- `src/main/meetings/workflows/implement-workflow.ts` (482 lines) —
  · `implementResponseSchema` zod (designated worker JSON 응답 형식, summary + patches array).
  · `ImplementResponse` inferred type.
  · `ImplementMissionContext` (missionCard + speakerDisplayName + suggestedLabel + inputFileSnippets).
  · `buildImplementPromptBody(ctx)` — kind 별 헤더 / 미션 / 추가 컨텍스트 / 입력 파일 list + snippet / 출력 기대치 / 응답 schema 안내 합성.
  · `extractImplementPatchEntries({response, workspaceRoot})` — response → PatchEntry[] (path-guard 4 tier).
  · `buildImplementPatchSet({entries, operationId, aiId, conversationId, dryRun})` — PatchSet wrapper + 빈 entries / metadata 거부.
  · `ImplementApplyPending` — single-use Promise holder (wait / commit / cancel + isSettled / isWaiting).
  · `ImplementApplyDecision = { approved: true } | { approved: false, reason: string }`.
  · `ImplementApplyAbortReason = { kind: 'aborted' } | { kind: 'replaced', message: string }`.
  · `ImplementWorkflowResult` (meetingId + outcome + appliedEntries / abortReason).
  · `ImplementWorkflowAbortReason` 6 분기 union.
  · `ImplementResponseInvariantError` — schema / path-guard / metadata 위반.
  · `isImplementDepartmentRole(role)` role guard.
  · `capabilityForMissionKind(kind): RoleId` — 모든 kind → 'implement' (R12-C2 시점).

- `src/main/meetings/workflows/__tests__/implement-workflow.test.ts` (487 lines) — 39 항목 / 8 describe block:
  · implementResponseSchema (6 항목) — 정상 통과 / 빈 patches / 빈 summary / 알 수 없는 operation / strict mode extra field / delete newContent 생략.
  · buildImplementPromptBody (8 항목) — kind 3 종 헤더 + 추가 컨텍스트 / inputFiles list / inputFileSnippets / 출력 기대치 / schema 안내 / escape (`"` `\`).
  · extractImplementPatchEntries (8 항목) — 정상 변환 / delete newContent 무시 / 절대 경로 거부 / `..` traversal 거부 / 빈 path 거부 / create/modify newContent 누락 throw / workspaceRoot empty/relative throw / `./` 정규화.
  · buildImplementPatchSet (4 항목) — dryRun=true / dryRun=false / 빈 entries 거부 / 빈 metadata 거부.
  · ImplementApplyPending (10 항목) — pristine / wait / commit(approve) / commit(reject) / cancel(aborted) / cancel(replaced) / settled wait throw / duplicate commit throw / pre-wait commit throw / settled / pristine cancel no-op.
  · isImplementDepartmentRole (2 항목).
  · capabilityForMissionKind (1 항목).

## 검증

- typecheck:node + typecheck:web **0**
- vitest **3653 PASS / 13 skip** (T23 baseline 3614 → +39 신규)
  - 신규 39 (implement-workflow 39)
  - 순증 +39
- inspect:safety **99** (T23 baseline +0, 신규 코드 모두 순수 helper / 마이그레이션 0)

## 미작업 (의도)

- ExecutionService 호출 자체는 P5/P6 다른 sub-task 책임 — 본 T24 시점엔 helper 만, 실 ExecutionService.applyPatch 호출은 orchestrator wire (T25 / T26 이후) 가 본 모듈의 `buildImplementPatchSet` 결과 직접 소비.
- ImplementApplyPending 의 IPC 핸들러 (사용자 모달 응답 → commit) 도 wire 시점 — 본 sub-task 는 promise holder 계약만.
- ImplementVariant SsmBox (T18 land) 의 designated AI 표시 / 진행도 / 작업 중 파일 list 실 데이터 hookup 도 wire 시점 — 본 sub-task 는 backend helper 만.
- T26 (ExecutionService dryRun 의 RunStep 영속) — `step_kind='tool_invoke'` row 생성 로직은 T26 ExecutionService hook 책임. 본 모듈은 PatchSet 까지만.
- mission card 의 IPC 등록 = T27 (handoff-service) 책임 — 본 sub-task 시점엔 schema 정의만.

## 다음 = T25 (P5 진입 3 호)

T25 의존 = T17 (audit-workflow) + T24 = 모두 충족. **T25 핵심:**
- `audit-workflow.ts` 의 `buildAuditHandoffPayload` 결과 → MissionCard `'fix'` 변환 (auditMinutesMarkdown + problemList → MissionCard.payload.fix)
- handoff_dispatch row 영속 (mission_card_json 컬럼에 serializeMissionCard 결과 INSERT) — *T27 handoff_dispatch 테이블 land 후*
- planning 채널 자동 회의 트리거 wire (handoff_mode='auto' Notification or 'check' 모달)

**T25 *주의*:**
- T27 (handoff_dispatch 테이블 마이그레이션 021) 가 *T25 의 영속 면* 이라 T25 가 T27 의존 — plan blockedBy 명시. 다만 *audit verdict='ng' 분류 + MissionCard 'fix' 변환* 자체는 본 sub-task 스코프 (T27 의 row INSERT 만 미진입).
- planning 부서 채널 lookup — `ChannelService.getByRole(projectId, 'planning')` 1 곳만 호출 (다중 planning 채널 시 첫 1 곳 디폴트, R13+ 사용자 선택).
- audit handoff 와 review handoff 는 *별 분기* — T17 의 `shouldSpawnReviewFromAudit` 와 T25 의 audit→planning 인계는 동시 발생 가능 (audit verdict='ng' + handoff_mode='auto' or checkbox).

T25 진입 시 *반드시* 확인:
- T23 의 `buildMissionCard` + `serializeMissionCard` 호출 path — T25 가 'fix' MissionCard 직접 생성.
- audit-workflow.ts 의 `extractAuditProblemList` 결과 → MissionCard.payload.fix.problemList (1:1 매핑).
- plan line 443-451 (T25 산출) 그대로.
