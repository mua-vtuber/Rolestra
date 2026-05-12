---
name: R12-C2 T11 종결 — F 검사관 catalog phase 1 land + T12 (A migration 020 + RunStepService) 진입 가이드
description: T11 (안전 7 + 비안전 5 = 12 카테고리 통째 land + report-only + git hook auto wire) commit `7e7b97b` 종결 + T12 진입 가이드
type: project
originSessionId: 95743b7b-91e0-4505-aba9-66ecac8cd977
---
## 종결 상태 (2026-05-05)

R12-C2 Round 2 *기반층 sub-task 1 호* (T11 — F. 검사관 catalog phase 1) 통째 land. worktree commit `7e7b97b` (`feat/r12-c2-redesign-r2` 위, base `d74c390`).

### 산출 (22 파일 / +1735 line)

| 영역 | 파일 | 핵심 |
|------|------|------|
| inspector framework | `tools/inspectors/{types,walker,run,install-hooks}.ts` | 4 파일 — Inspector 인터페이스 + 파일 walker + orchestrator + git hook auto wire |
| 안전 7 카테고리 | `tools/inspectors/<category>.ts` × 7 | secrets-plaintext / exec-shell-string / mig-non-idempotent / mig-non-forward-only / ipc-untyped-invoke / approval-bypass / path-guard-bypass |
| 비안전 5 카테고리 | `tools/inspectors/<category>.ts` × 5 | ui-string-hardcoded / mock-fixture-import / magic-number / duplicate-constant / unused-export |
| 문서 | `tools/inspectors/README.md` | catalog + phase 정책 + 회피 주석 + 룰 추가 절차 |
| CI hook | `.githooks/pre-commit` + `.githooks/pre-push` | phase 1 = 모두 report-only (exit 0) |
| 설정 | `package.json` (3 script) + `.gitignore` (report.json) | `inspect` / `inspect:safety` / `prepare` (auto wire) |

### Phase 1 첫 inspect 결과 = 864 hits

| 카테고리 | hits | 분류 |
|---------|------|------|
| secrets-plaintext | 0 | OK |
| exec-shell-string | **4** | **진짜 위반** — database-manager.ts / migrator.ts / hybrid-search.ts |
| mig-non-idempotent | **54** | **false positive** — Rolestra migrator 가 1 회 실행 보장 (T41 룰 정밀화 대상) |
| mig-non-forward-only | 2 | 검토 필요 |
| ipc-untyped-invoke | 0 | OK |
| approval-bypass | 15 | 일부 false positive 가능 |
| path-guard-bypass | 17 | 일부 false positive 가능 |
| ui-string-hardcoded | 99 | 비안전 — phase 2 도 report-only |
| mock-fixture-import | 0 | OK |
| magic-number | 61 | 비안전 — 보수적 (>= 1000) |
| duplicate-constant | 233 | 비안전 — noise 예상 |
| unused-export | 379 | 비안전 — barrel export 까지 잡힘 |

→ T41 (phase 2 진입) 직전 안전 7 의 false positive 정리 필요. 특히 mig-non-idempotent 54 = "외부 도구가 같은 DB 건드릴 때만 위험" 으로 좁히거나 allowlist 화. exec-shell-string 4 는 진짜 위반 → 후속 sub-task 가 fix 시 신호 좁아짐.

### 검증 baseline

- typecheck:node + typecheck:web **0 error**
- inspector 자체 strict tsc **0 error**
- vitest **3230 PASS / 13 skip / 0 fail** (Round 2 baseline 정확 유지)
- pre-commit hook dry-run **exit 0** (16 staged 파일)
- install-hooks 가 stale `core.hooksPath` (project rename `AI_Chat_Arena` 잔재) 자동 override

### 사용자 cycle 적용

설계 → 구현 → 검토 (self, acceptance 9/9 PASS) → commit `7e7b97b` → 메모리 (이 파일).

---

## 다음 작업 = T12 (A. migration 020 + RunStepService skeleton)

### 무엇을 (사무실 메타포)

회의 안 *모든 turn 의 진행 일지* 를 적어두는 캐비닛 (`run_step` 테이블) 설치 + 일지 적는 직원 (RunStepService) 채용. 이후 sub-task 부터 일지 영속.

### T12 acceptance (plan + spec §11.19)

**산출:**
- `src/main/database/migrations/020-run-step.ts`:
  - `run_step` 테이블 — id (UUID) / meeting_id / channel_id / round / turn_index / actor_kind / actor_id / step_kind / input_json / output_json / next_step_card / side_effect_summary / duration_ms / created_at
  - step_kind enum 10 종: opinion_gather / opinion_tally / quick_vote / free_discussion / minutes_compose / next_step_classify / handoff_dispatch / tool_invoke / approval_request / inspector_check
  - 인덱스: (meeting_id, turn_index), (channel_id, created_at)
- `src/main/database/migrations/index.ts` — m020 추가
- `src/main/meetings/run-step/run-step-service.ts`:
  - append-only + atomic write + truncate 금지
  - transaction 묶음 (better-sqlite3)
  - 도메인 에러 (RunStepValidationError 등)
- `src/main/meetings/run-step/__tests__/run-step-service.test.ts`:
  - 신규 row 추가 / index 정렬 / atomic rollback / truncate 차단
- IPC `meeting:list-run-steps` (디버깅 / replay 용 — dev 전용):
  - `src/shared/ipc-types.ts` 채널 정의
  - `src/main/ipc/handlers/meeting-handler.ts` (또는 신규 run-step-handler.ts) wire

**Verify:**
- typecheck 0
- vitest 3230 + 신규 RunStepService 테스트 N 건 PASS
- migrator 가 020 forward apply 성공 (T11 의 mig-non-forward-only 검사관이 020 통과 검증)
- T11 의 mig-non-idempotent 검사관 hit 추가 발생 가능 (false positive — phase 1 그대로)

### T12 진입 우선순위 (ADR D8)

1. ✅ T11 = F (지금 종결)
2. **→ T12 = A (다음)**
3. T13 = B + A wire (NextStep classifier)
4. ...

### 워크트리 환경

- 위치: `/mnt/d/Taniar/Documents/Git/Rolestra-r12c2-r2`
- 브랜치: `feat/r12-c2-redesign-r2`
- 현재 tip: `7e7b97b` (T11 종결)
- node_modules: 이미 install 됨 (T11 진입 시점 install)

### git hook 활성 상태

- `core.hooksPath = .githooks` 자동 wire 완료
- pre-commit / pre-push = report-only (phase 1)
- `--no-verify` 로 우회 가능 (phase 1 정책)

### 주의 — T11 land 후 알려진 false positive

T12 작업 중 inspect 가 **추가 hit** 보고할 수 있음 (정상):
- migration 020 의 새 CREATE TABLE = mig-non-idempotent +N
- run-step-service.ts 의 fs.write* 사용 = approval-bypass / path-guard-bypass 가능

→ phase 1 = report-only 라 빌드 차단 X. T41 (phase 2 진입) 직전 일괄 정밀화.

---

## 컨텍스트 절약 팁

- 본 메모리 + ADR `r12-c2-reference-projects-absorb.md` D5 (RunStep) 정독
- spec §11.19 만 read (다른 §11.x 는 후속 sub-task 진입 시점)
- plan T12 단락 (line 255~273) read
- tasks.json id=13 (T12) row read
- T11 inspector 코드는 read 불필요 (framework 안정 land)

---

## 핵심 참조

- 진입 ADR: `docs/R12_c2_2R/decisions/r12-c2-reference-projects-absorb.md` D5 + D8
- spec: `docs/specs/2026-05-01-rolestra-channel-roles-design.md` §11.19
- plan: `docs/R12_c2_2R/plans/2026-05-04-rolestra-phase-r12-c2.md` T12
- tasks.json: id=13 row
- T11 reference: `tools/inspectors/README.md` (검사관 catalog 표)
