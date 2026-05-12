---
name: R12-C2 T12 종결 — A. migration 020 (run_step) + RunStepService skeleton land + T13 (B NextStep classifier + Orchestrator wire) 진입 가이드
description: T12 (cross-cutting RunStep 영속 레이어 — append-only + atomic write + truncate 금지) commit `a493619` 종결 + T13 진입 가이드
type: project
originSessionId: 58356de8-56b4-4768-a05c-eeb9ec7ad23d
---
## 종결 상태 (2026-05-05)

R12-C2 Round 2 *기반층 sub-task 2 호* (T12 — A. migration 020 + RunStepService skeleton) 통째 land. worktree commit `a493619` (`feat/r12-c2-redesign-r2` 위, base `7e7b97b` = T11).

### 산출 (14 파일 / +1129 line / -6)

| 영역 | 파일 | 핵심 |
|------|------|------|
| migration | `src/main/database/migrations/020-run-step.ts` (NEW) | run_step 테이블 14 컬럼 + 2 인덱스 + FK 정책 (CASCADE meeting/channel + SET NULL actor) |
| migration chain | `src/main/database/migrations/index.ts` | m020 import + chain 추가 |
| 공유 타입 | `src/shared/run-step-types.ts` (NEW) | RunStep / NewRunStep + 3 enum (RunStepActorKind 4 / RunStepKind 10 / NextStepCard 7) |
| repository | `src/main/meetings/run-step/run-step-repository.ts` (NEW) | append-only insert + listByMeeting/Channel/Turn + withTransaction (better-sqlite3 SAVEPOINT) |
| service | `src/main/meetings/run-step/run-step-service.ts` (NEW) | appendForTurn atomic 묶음 + appendOne + 3 list + assertValid 2 종 (silent fallback 금지) |
| service test | `src/main/meetings/run-step/__tests__/run-step-service.test.ts` (NEW) | 16 test — atomic rollback + 50KB truncate 금지 + 4 actor mismatch + 정렬 |
| IPC 타입 | `src/shared/ipc-types.ts` | `meeting:list-run-steps` 채널 + RunStep import |
| IPC schema | `src/shared/ipc-schemas.ts` | zod discriminatedUnion 3 scope + v3ChannelSchemas 등록 |
| handler | `src/main/ipc/handlers/run-step-handler.ts` (NEW) | 3 scope dispatch + accessor pattern |
| handler test | `src/main/ipc/handlers/__tests__/run-step-handler.test.ts` (NEW) | 4 test — dispatch + accessor 미초기화 |
| router | `src/main/ipc/router.ts` | handleMeetingListRunSteps 등록 — `NODE_ENV !== 'production'` 게이팅 |
| 부팅 wire | `src/main/index.ts` | RunStepRepo + RunStepService + setRunStepServiceAccessor |
| migrator test | `src/main/database/__tests__/schema-008-011.test.ts` | 19 → 20 + list +1 |
| tasks.json | `docs/plans/.../tasks.json` | id=13 status=completed |

### 검증 baseline (acceptance 4/4)

- ✅ typecheck:node + typecheck:web **0 error**
- ✅ vitest **3250 PASS / 13 skip / 0 fail** (T11 baseline 3230 + 신규 20 = 3250)
- ✅ inspect:safety 안전 **95 hits** (T11 baseline 92 + 020 의 mig-non-idempotent 3 추가 = CREATE TABLE 1 + CREATE INDEX 2 — 019 와 동일 framework-managed false positive, 진짜 위반 0)
- ✅ T11 mig-non-forward-only inspector 020 통과 (DROP / RENAME 없음)

### 핵심 설계 결정

1. **DB 스키마는 codebase convention 우선**: spec §11.19.2 의 `created_at: string` (ISO 8601) 대신 INTEGER (Unix epoch ms) — opinion + 모든 다른 테이블과 일관. shared 타입도 `createdAt: number`.
2. **Append-only 강제는 SQL 트리거가 아닌 서비스 메서드 비노출**: SQL 트리거로 UPDATE/DELETE 차단은 over-engineering. RunStepService 가 update / delete *공개 메서드를 안 만들음* + 마지막 unit test (`Object.getOwnPropertyNames(proto)`) + F 검사관 phase 2 직접 SQL 룰 보강.
3. **Idempotency 정책**: 019 와 동일하게 `CREATE TABLE` 에 `IF NOT EXISTS` 없음 — Rolestra migrator 가 applied set 으로 1 회 실행 보장. T11 mig-non-idempotent inspector 가 phase 1 report-only 로 인정.
4. **dev-only IPC 등록**: `meeting:list-run-steps` 는 `NODE_ENV !== 'production'` 게이트로 router.ts 가 핸들러 등록 자체를 skip — production 빌드는 채널 부재. schema 는 v3ChannelSchemas 안 *항상* 등록되어 dev 모드 zod round-trip 작동 (dev:trip-circuit-breaker 와 동일 패턴).
5. **검증 2 종 (silent fallback 금지)**: `nextStepCard` 는 `stepKind='next_step_classify'` 외 step 에서 비-NULL 이면 throw. `actorKind='employee'` ↔ `actorId !== null` 정합 강제. 잘못된 입력은 NULL 로 덮어쓰지 않고 즉시 throw — CLAUDE.md 의 mock/fallback 금지 정책 준수.
6. **caller 가 JSON 직접 stringify**: `inputJson` / `outputJson` 은 spec 그대로 `string`. service 가 JSON.stringify 안 하는 이유 = 스키마 자유도 + caller 가 *원본을 그대로 전달했다는 보장* + truncate 금지 정책 책임 명확.

### 사용자 cycle 적용

설계 (spec §11.19 + plan T12 + tasks.json id=13 read) → 구현 (5 sub-task: 탐색 → migration → service+repo+types → IPC + handler + router + index → test) → 검토 (self, acceptance 4/4 PASS) → commit `a493619` → 메모리 (이 파일).

---

## 다음 작업 = T13 (B. NextStep classifier + Orchestrator wire — RunStep 영속 포함)

### 무엇을 (사무실 메타포)

직원이 발언 끝나면 *다음 동작* 7 카드 중 하나로 분류하는 *분류 담당관* (NextStepClassifier) 채용 + 회의 진행 매니저 (MeetingOrchestrator) 가 매 turn 분류 결과 따라 진행. 모든 turn 분류 결과는 RunStep 영속 (T12 적층).

### 사용자가 보는 결과

- 회의 진행 중 직원 발언 후 다음 동작이 *명시*:
  - 「계속 발언」 / 「대기」 = 자동 진행 (사용자 확인 X)
  - 「결재」 / 「도구」 / 「인계」 / 「회의록 정리」 / 「회의 종료」 = 사용자 확인 모달 등장
- 모든 turn 의 분류 결과는 진행 일지에 기록 (T12 RunStep 영속)

### T13 acceptance (plan + spec §11.18.8)

**산출:**
- `src/main/meetings/engine/next-step-classifier.ts` — 7 카드 분류기 (NextStepCard discriminated union):
  - kind: 'continue' | 'wait' | 'approve' | 'tool' | 'handoff' | 'minutes' | 'end'
  - 분류 규칙 7 우선순위 (spec §11.18.8b 그대로)
  - fall-through fallback = 'wait' (안전군)
- `MeetingOrchestrator` 새 모델 wire (Round 1 T10a/b skeleton 위에):
  - 매 turn 후 분류기 호출 → RunStepService 영속 (`step_kind='next_step_classify'`) → 안전군 자동 진행 / 결과 전파군 사용자 확인 모달
  - 분류 결과 stream IPC → renderer 가 모달 표시
- 「인계」 카드의 handoff_mode 우회 룰은 **T28** 에서 wire (HandoffApprovalModal 와 함께)
- maxRounds cap 인터락 land (cap 도달 시 「계속 발언」 → 「회의 종료」 강제 override)

**의존:** T11 + T12 land 후 — T13 진입 가능.

### T13 진입 우선순위 (ADR D8)

1. ✅ T11 = F
2. ✅ T12 = A
3. **→ T13 = B + A wire (다음)**
4. T14~ = P3 부서 워크플로우 (의존 T13)

### 워크트리 환경

- 위치: `/mnt/d/Taniar/Documents/Git/Rolestra-r12c2-r2`
- 브랜치: `feat/r12-c2-redesign-r2`
- 현재 tip: `a493619` (T12 종결)
- node_modules: install 유지

### git hook 활성 상태

- `core.hooksPath = .githooks` (T11 land 시 auto wire)
- pre-commit / pre-push = report-only (phase 1)
- `--no-verify` 로 우회 가능 (phase 1 정책)

### 사용 가능한 surface

- `RunStepService.appendForTurn(steps)` — atomic 묶음, T13 orchestrator 가 매 turn 후 호출
- `RunStepService.appendOne(step)` — 단일 step 편의
- `RunStepService.listByMeeting / listByChannel / listByTurn` — read 표면
- IPC `meeting:list-run-steps` — dev only, 디버깅 / replay
- `MEETING_PHASE_ORDER 8` (T10b) + `state='gather'` 초기값 (T10b) — orchestrator 의 새 phase 문자열

---

## 컨텍스트 절약 팁

- 본 메모리 + spec §11.18.8 정독
- plan T13 단락 (plan line 275~298) read
- tasks.json id=14 (T13) row read
- T12 RunStepService 코드는 read 불필요 (skeleton 안정 land — IPC + appendForTurn 시그니처만 알면 됨)
- T10a/b orchestrator skeleton 은 read 권장 (T13 가 그 위에 wire)

---

## 핵심 참조

- spec: `docs/specs/2026-05-01-rolestra-channel-roles-design.md` §11.18.8
- plan: `docs/R12_c2_2R/plans/2026-05-04-rolestra-phase-r12-c2.md` T13 (line ~275)
- tasks.json: id=14 row
- T12 reference (skeleton API): `src/main/meetings/run-step/run-step-service.ts`
- T10a/b reference (orchestrator skeleton): `src/main/meetings/engine/`
