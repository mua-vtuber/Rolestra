---
name: R12-C2 T27 종결 — handoff_dispatch table (migration 022) + HandoffPackage schema + HandoffDispatchService (P6 진입 1 호, 2026-05-07)
description: R12-C2 Round 2 P6 진입 1 호 완료. 부서 → 부서 *외주 의뢰서* 영속 레이어 + 정식 schema + service 3 method (dispatch / open / track) thin module. T15/T16a/T17/T24/T25/T26 와 동일 thin 패턴 — types + 순수 helper + 영속 boundary 만, orchestrator wire X, IPC handler 미생성. migration 번호 plan-vs-actual drift (021 → 022) 처리. 회의록 본문 보존 정책 *옵션 B* 결정 (파일 한 곳 SSoT, 의뢰서 안에는 식별자만). 다음 T28 (HandoffApprovalModal + B handoff_mode 우회 룰 wire) 진입 가이드.
type: project
originSessionId: continuation
---
# R12-C2 T27 종결 (2026-05-07)

worktree `feat/r12-c2-redesign-r2`, base `a76ce66` (= T26 tasks.json sync). production commit `0a8e4f3`. 8 파일 / +1754 / +8 -4 (8 신규 + 2 갱신).

**Why:** spec docs/specs/2026-05-01-rolestra-channel-roles-design.md §11.16 (부서 lock 사이클 — 인계 시점 = lock 풀림) + §11.18.8c (handoff_mode 우회 룰 — B1 「인계」 카드 → 채널 정책 적용, 'check' = 사용자 결재 모달 / 'auto' = 자동 + Notification) + §11.22 (H2. 받는 부서 첫 화면 인계 패키지 — 위치 / 표시 항목 / 데이터 source / 컨텍스트 주입 / chain 외 review surface). plan docs/R12_c2_2R/plans/2026-05-04-rolestra-phase-r12-c2.md line 469-482 (T27 산출 = handoff_dispatch 테이블 + HandoffPackage schema + HandoffDispatchService 3 method). T17 (review-workflow) + T25 (audit-handoff-dispatch) 가 이미 *주석 자리* 로 handoff_dispatch 컬럼 자리 (`handoff_dispatch.from_meeting_id` / `from_channel_id` / etc.) 를 명시했고, T23 (mission-card schema) 는 `mission_card_json` 컬럼 자리에 들어갈 정식 schema 를 제공. T27 = 이 *주석 자리* 들을 진짜 SQL 컬럼 + zod schema + service 본체로 land 하는 *접합* 단계.

**How to apply:** 새 세션 진입 시 T28 (HandoffApprovalModal + B handoff_mode 우회 룰 wire) 진입 가능. T28 의존 = T13 (NextStep classifier) + T27 = 모두 충족. T27 의 `HandoffDispatchService.dispatch` 는 orchestrator / approval-decision-router 가 회의 종결 직후 호출하면 row 영속됨 — service 자체는 *영속만* 하고 IPC / UI 는 caller 책임. T28 의 HandoffApprovalModal 은 (a) handoff_mode='check' 일 때 사용자 결재 모달 surface (b) 사용자 [확인] 시 `dispatch` 호출 → row 영속 (c) handoff_mode='auto' 일 때 모달 skip → 즉시 `dispatch` + Notification (T30 책임). T29 (HandoffPackageCard) 는 받는 부서 채널 첫 진입 시 `trackByChannel(channelId, { unopenedOnly: true })` 으로 미열람 row lookup → surface → 사용자 [의견 모아 회의 시작] 클릭 시 `open(id, now)` 호출 + 회의 boot.

## 핵심 결정

### 1) 회의록 본문 보존 정책 — 옵션 B (파일 한 곳 SSoT)

설계 결정 포인트 = HandoffPackage schema 안에 회의록 본문을 *통째 포함* (옵션 A) 할지 *위치 식별자만* 보존 (옵션 B) 할지.

옵션 A 의 단점:
- 회의록이 *두 곳* (파일 + DB row 안 mission_card_json) 에 존재 → 한 쪽 수정 시 어긋남.
- DB row 가 무거워짐 (회의록 길이가 megabyte 단위 가능).
- 기존 spec §11.22.3 ("회의록 본문: `<ArenaRoot>/.../minutes.md`") + T17 / T25 의 helper 패턴 (`auditMinutesMarkdown` / `planningMinutesMarkdown` 등 mission_card payload 안에서만 본문 보존) 과 일관 X.

옵션 B 채택:
- `HandoffPackage.minutesMeetingId` 식별자만 보존 (NULL 가능 — 회의 외 진입).
- 받는 부서 surface 시 caller (UI 프로세스) 가 식별자 → path resolve → file read 의 1-direction workflow.
- mission_card payload 안에 *맥락 분담된* 회의록 본문 (예: `planningMinutesMarkdown` for 'spec' / `auditMinutesMarkdown` for 'fix') 은 그대로 보존 — 직원 prompt 컨텍스트가 mission card 단독으로 충분.
- 사용자 확인: "여러곳으로 복제하면 결국 내용차이가 발생했을 경우 혼란이 가중 될 것이라 생각해" — 정합성 우선 결정.

### 2) Migration 번호 drift (021 → 022)

T27 plan description (line 474) 은 'migration 021' 표기 — plan 작성 시점 (P1 round, 2026-05-04) 기준 다음 번호. P4 진행 중 T21 (opinion-vote-light, P4 일반 채널 가벼운 투표 토대) 이 021 을 먼저 점유 → T27 land 시 022 가 다음 번호. plan 의 'migration 021' 표기는 *plan 작성 시점의 다음 번호* 였을 뿐, 실제 number 는 land 시점에 결정.

미래 sub-task 도 같은 drift 가능 — plan description 의 마이그레이션 번호는 *예시* 로 받고, 실제 land 시 `migrations/index.ts` 의 마지막 번호 + 1 사용.

### 3) thin module 패턴 보존 — orchestrator wire X

T15 (idea) / T16a (design) / T17 (audit / review) / T24 (implement) / T25 (audit-handoff-dispatch) / T26 (run-step-bridge) 6 회 동일 thin 패턴 통과. T27 도 동일:
- 본 모듈 = HandoffPackage 검증 + row 매핑 + 영속까지만.
- IPC handler 등록 / orchestrator 호출 위치 / UI surface = caller 책임.
- caller 는 P6 다른 sub-task: T28 (HandoffApprovalModal) / T29 (HandoffPackageCard) / T30 (Notification 분기).

근거:
- T15~T26 6 회 동일 패턴 통과한 검증된 설계.
- *분할 책임* — 영속 / 검증 = 본 모듈 / 호출 시점 결정 = caller. 둘이 섞이면 회귀 발생률 ↑.
- 회의 외 dispatch (예: 사용자 변경 요청 직접 인계 — §11.17 § 11.12.5 큰 변경 = 큐 추가) 시 minutesMeetingId 가 null. 본 service 가 그 분기를 caller 알게 하지 않고 *항상 동일 entry* 로 노출.

### 4) self-handoff 거부 — buildHandoffPackage 의 invariant

`sender.channelId === target.channelId` 거부. 자기 자신에게 인계는 *의미 없음* (cycle 방지의 가장 단순한 첫 단계).

더 깊은 cycle 검출 (A → B → A) 은 R12-H 단계의 caller 책임 (handoffs.parent_handoff_id depth 추적, spec §6 "Cycle prevention"). T27 시점 = self-loop 1 차 차단만, 다단 cycle 은 R12-H 의 별 layer.

### 5) `mission_card_json` ↔ HandoffPackage 의 `missionCard` 단방향

DB row 의 `mission_card_json` 컬럼은 `serializeMissionCard(pkg.missionCard)` 결과만 보관. HandoffPackage 의 *minutesMeetingId* 와 *nextActions* 는 row 의 별 컬럼이 아닌 다른 보존 위치:
- `minutesMeetingId` → row.minutes_id 컬럼.
- `nextActions` → row 안 어디에도 없음. caller 가 회의록 "## 다음 단계" 단락에서 추출 — surface 시점에 다시 추출 (R12-C2 시점 자동 추출 wire X, T29 land 시점 추가).

`serializeRowToPackage` helper 는 row → JSON 변환 시 nextActions 를 *caller 가 명시적으로 주입* — silent fallback 금지. caller 가 ""(빈 배열) 을 명시해 넘기든 회의록 추출 결과를 넘기든 자기 결정.

## 파일 구조 (8 파일, +1754 lines)

```
src/main/database/
  migrations/
    022-handoff-dispatch.ts                  +77   신규 마이그레이션
    index.ts                                 +2    chain 등록
  __tests__/
    migration-022.test.ts                    +264  schema contract 테스트
    schema-008-011.test.ts                   ±10   tracking 카운트 21 → 22 갱신

src/shared/schema/
  handoff-package.ts                         +267  zod schema + builder + parser
  __tests__/
    handoff-package.test.ts                  +301  schema 단위 테스트

src/main/handoff/                            (신규 디렉토리)
  handoff-dispatch-types.ts                  +72   row + NewHandoffDispatch 타입
  handoff-dispatch-repository.ts             +177  better-sqlite3 thin layer
  handoff-dispatch-service.ts                +244  3 method + helper
  __tests__/
    handoff-dispatch-service.test.ts         +352  service 단위 테스트
```

## 컬럼 11 종 명세 (handoff_dispatch)

| 컬럼 | 타입 | 의미 | 정책 |
|---|---|---|---|
| `id` | TEXT PK | 의뢰서 식별자 (UUID v4) | service 가 `randomUUID` 생성 |
| `from_meeting_id` | TEXT FK CASCADE → meetings | 보낸 회의 | 회의 삭제 시 의뢰서 cascade |
| `from_channel_id` | TEXT FK CASCADE → channels | 보낸 부서 채널 | 채널 삭제 시 cascade |
| `to_channel_id` | TEXT FK CASCADE → channels | 받는 부서 채널 | 채널 삭제 시 cascade |
| `reason` | TEXT NOT NULL | 인계 사유 | service 가 trim 으로 빈 문자열 차단 |
| `minutes_id` | TEXT NULLABLE | 회의록 식별자 | NULL = 회의 외 진입. FK 없음 — 본문은 파일 SSoT |
| `mission_card_json` | TEXT NOT NULL | MissionCard 직렬화 | `serializeMissionCard(pkg.missionCard)` |
| `mode` | TEXT CHECK ('check'\|'auto') | handoff_mode 분기 | §11.18.8c |
| `dispatched_at` | INTEGER NOT NULL | 보낸 시각 epoch ms | caller 가 `Date.now()` 또는 테스트 주입 |
| `opened_at` | INTEGER NULLABLE | 받는 부서 첫 진입 시각 | NULL = 미열람. service.open 이 NULL → epoch 1 회 update (idempotent) |
| `created_at` | INTEGER NOT NULL | row insert 시각 | service 가 `Date.now()` 자동 채움. 향후 retry 시 dispatchedAt 와 분리 가능 |

## 인덱스 2 종

- `idx_handoff_dispatch_to_channel` ON (to_channel_id, dispatched_at) — 받는 채널 entry 시 H2 candidate list lookup (DESC 정렬).
- `idx_handoff_dispatch_from_meeting` ON (from_meeting_id) — 회의 삭제 cascade lookup + 회의 단위 의뢰서 추적.

## 검증

- typecheck:node + typecheck:web 0 에러
- vitest **3771 PASS** / 13 skip / 0 fail (T26 baseline 3714 → +57 신규 = migration-022 26 + handoff-package 21 + handoff-dispatch-service 26 + schema-008-011 갱신 -16 +0)
- inspect:safety **102 hits** (T26 baseline 99 → +3)
  - 신규 hit 3 = migration 022 의 `CREATE TABLE handoff_dispatch` 1 + `CREATE INDEX idx_handoff_dispatch_to_channel` 1 + `CREATE INDEX idx_handoff_dispatch_from_meeting` 1
  - 모두 framework-managed false positive — migrator 가 applied set 으로 1 회 실행 보장 (T11 phase 1 시점 인정 패턴, 모든 기존 마이그레이션 동일).
  - mig-non-forward-only 변동 0 (022 는 DROP / RENAME 없는 신규 추가만 — forward-only 정책 정상 준수).

## 미작업 (의도)

본 sub-task 는 thin module 1 단계만 land. 다음 단계는 별 sub-task 책임:

- **IPC handler / channel listener** — T28 (HandoffApprovalModal + handoff_mode 분기 wire) 책임.
- **받는 부서 첫 surface UI** — T29 (HandoffPackageCard) 책임. spec §11.22 의 "보낸 부서 / 보낸 시각 / 인계 사유 / 회의록 미리보기 / 받는 부서 작업 list / [의견 모아 회의 시작] / [닫기]" 모두 T29 가 담당.
- **handoff_mode='auto' Notification 발송** — T30 (검토 → 리뷰 Notification, D 의미 단위 알림 #1) 책임.
- **orchestrator 호출 위치** — caller 가 audit-handoff-dispatch (T25) `planAuditDispatch` 결과 + review-workflow (T17) `buildReviewHandoffPackageFromAudit` 결과를 HandoffDispatchService.dispatch 에 주입. 본 sub-task 는 *받을 입구* 만 만들고 호출 하지 않음.
- **회의록 "## 다음 단계" 추출 자동 wire** — T29 의 nextActions 자동 합성 시 추가. 본 sub-task 시점은 caller 가 명시 주입.

## 다음 진입 가이드

**T28 — HandoffApprovalModal + B handoff_mode 우회 룰 wire 권장.**

T28 의존:
- T13 (NextStep classifier) ✓
- T27 (handoff_dispatch + HandoffPackage + HandoffDispatchService) ✓ (본 sub-task land 분)

T28 산출 (plan line 484-499):
- `HandoffApprovalModal` — kind 별 미리보기 + 회의록 통째 + 인계 사유 + [확인 / 취소]
  - 검토 → 기획 인계 시 *"+리뷰 부서도 시작"* 체크박스
- `HandoffModeToggle` (채널 설정 모달 + 사이드바 channel row 우측 ⚙)
- T13 의 NextStep classifier 가 「인계」 카드 발행 → handoff_mode 분기 wire:
  - check (디폴트) = 모달 등장
  - auto (부서별 명시) = 자동 진행 + Notification 만 (모달 X)
- spec reference: §11.18.8c

T28 시점에 본 service 의 `dispatch` 가 처음으로 호출됨 — 모달 [확인] / auto 분기 모두에서.

## 메모리 갱신

R12-C2 T27 production 종결 + main merge 대기 (P6 진입 1 호). 다음 세션 첫 작업 = T28 또는 dogfooding (T27 이 IPC 노출 X 라 dogfooding 가치 작음 — T28 / T29 land 시점에 묶음 dogfooding 권장).
