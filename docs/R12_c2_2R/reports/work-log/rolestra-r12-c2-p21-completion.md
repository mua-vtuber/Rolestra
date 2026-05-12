---
name: R12-C2 T7 P2-1 종결 — migration 019 opinion + opinion_vote + channels.max_rounds (2026-05-04)
description: R12-C2 P2-1 migration 019 land 완료 (commit `62533be`) — opinion + opinion_vote + channels.max_rounds + 인덱스 6 종 + FK 정책 (RESTRICT/CASCADE/SET NULL). vitest 3516/13/0 / typecheck 0 / migration-019.test.ts 28 tests. 다음 작업 = T8 P2-2 OpinionService backend.
type: project
originSessionId: 9001b9e7-r12c2-p21
---

## 진입 위치 + worktree 상태

- **worktree**: `/mnt/d/Taniar/Documents/Git/Rolestra-r12c2`
- **branch**: `feat/r12-c2-meeting-redesign`
- **tip**: `62533be` (T7 P2-1 — migration 019 opinion + opinion_vote + channels.max_rounds)
- **base**: `e3cdafb` (R12-C 1차 main tip)
- **vitest baseline**: 3516 / 13 / 0 (P1 round 3488 → P2-1 +28 신규 = 3516, 회귀 0)
- **typecheck**: 0

## P2-1 land 결과 (commit `62533be`)

### 신규 / 변경 파일 (5)

| 파일 | 변경 |
|------|------|
| `src/main/database/migrations/019-opinion-tables.ts` | 신규 — opinion + opinion_vote 테이블 + channels.max_rounds ALTER + 인덱스 6 종 |
| `src/main/database/migrations/index.ts` | m019 import + 배열 추가 |
| `src/main/database/__tests__/migration-019.test.ts` | 신규 28 tests — 컬럼 shape / CHECK 제약 / FK 정책 / 인덱스 / max_rounds / tracking / idempotency |
| `src/main/database/__tests__/schema-008-011.test.ts` | 마이그레이션 카운트 18 → 19 갱신 (2 곳) |
| `docs/superpowers/plans/2026-05-04-rolestra-phase-r12-c2.md.tasks.json` | T6 in_progress → completed (commit `420ec9a` sync) + T7 pending → completed (본 commit) |

### opinion 테이블 컬럼

```
id            TEXT PRIMARY KEY (UUID)
parent_id     TEXT NULL FK opinion(id) ON DELETE RESTRICT
meeting_id    TEXT NULL FK meetings(id) ON DELETE CASCADE      ← NULL 허용 (일반 채널 [##])
channel_id    TEXT NOT NULL FK channels(id) ON DELETE CASCADE
kind          TEXT NOT NULL CHECK 6 enum
              ('root','revise','block','addition','self-raised','user-raised')
author_provider_id TEXT NULL FK providers(id) ON DELETE SET NULL
author_label  TEXT NOT NULL                                     ← 회의 단위 발화 카운터 (예 codex_1)
title         TEXT NULL
content       TEXT NULL
rationale     TEXT NULL
status        TEXT NOT NULL CHECK 4 enum
              ('pending','agreed','rejected','excluded')
exclusion_reason TEXT NULL
round         INTEGER NOT NULL DEFAULT 0
created_at    INTEGER NOT NULL
updated_at    INTEGER NOT NULL
```

### opinion_vote 테이블 컬럼

```
id            TEXT PRIMARY KEY
target_id     TEXT NOT NULL FK opinion(id) ON DELETE CASCADE
voter_provider_id TEXT NULL FK providers(id) ON DELETE SET NULL
vote          TEXT NOT NULL CHECK 3 enum ('agree','oppose','abstain')
comment       TEXT NULL
round         INTEGER NOT NULL DEFAULT 0
round_kind    TEXT NOT NULL CHECK 2 enum ('quick_vote','free_discussion')
created_at    INTEGER NOT NULL
```

### channels ALTER

```sql
ALTER TABLE channels ADD COLUMN max_rounds INTEGER;
```

→ NULL = 무제한 / N 라운드 도달 시 사용자 호출 (§11.14 채널 헤더 ⚙ 모달 옵션, P3/P6 land).

### 인덱스 6 종

```
idx_opinion_meeting        ON opinion(meeting_id)
idx_opinion_channel        ON opinion(channel_id)
idx_opinion_parent         ON opinion(parent_id)
idx_opinion_status         ON opinion(status)
idx_opinion_vote_target    ON opinion_vote(target_id)
idx_opinion_vote_round     ON opinion_vote(round)
```

### 결정사항 — drop X

| 항목 | 결정 | 근거 |
|------|------|------|
| 옛 `opinion_revisions` 테이블 drop | drop X | `grep -rn opinion_revisions src/` 결과 0 — R5 시점 land 된 적 없음 (조건부 "land 됐으면 drop" → 조건 false) |
| 옛 `meetings.state` SSM phase 컬럼 drop | drop X | T10 MeetingOrchestrator 재배선 시 state 문자열만 새로 (`opinion_gather` / `tally` / `quick_vote` / `free_discussion` / `minutes` / `done`) → 컬럼 자체는 보존 |

### 4 게이트 워크플로우 적용 (R12-C T10 reverted 사고 차단용)

```
[1] 설계 — spec §4 Migration 019 / §5 데이터 모델 / §11.14 max_rounds 매핑 ✅
   ↓
[2] 의도 부합 검토 — spec 명세 ↔ 마이그레이션 SQL 1:1 매핑 + drop X 결정 근거 ✅
   ↓
[3] 구현 — migration 파일 + index.ts + 28 tests + count fix ✅
   ↓
[4] spec 부합 검토 — commit message 안 acceptance ↔ land 매핑 명시 ✅
   ↓
[5] commit `62533be` + 메모리 갱신 ✅
```

## 다음 세션 첫 작업 — T8 P2-2 OpinionService backend

P2 의존 그래프:

```
T7 (migration 019)        ✅ land
   ↓
T8 (OpinionService)       ← 다음
   ↓
T9 (MeetingMinutesService)
   ↓                   ↓
T10 (Orchestrator 재배선)  T12 (회의록 chat block)
   ↓                       ↓
T11 (할 일 큐 트리거)        ↓
                            ↓
                    P3 진입 (T13~T18)
```

### T8 acceptance (tasks.json T8 description)

`src/main/meetings/opinion-service.ts` 신규 — 4 method:

| method | 역할 | spec 참조 |
|--------|------|----------|
| `gather(meetingId, schemaResponses)` | step 1 직원 응답 수집 + opinion row 생성 | spec §11.18.2 (Step1OpinionGather) |
| `tally(meetingId)` | step 2 시스템 취합 + 화면 ID (ITEM_NNN/ITEM_NNN_NN) 부여 알고리즘 (parent chain depth-first) | spec §11.18.3 (OpinionRow + 화면 ID 부여 알고리즘) |
| `quickVote(meetingId, voteResponses)` | step 2.5 일괄 동의 투표 + 만장일치 의견 즉시 status='agreed' + opinion_vote row 생성 | spec §11.18.4 (Step25QuickVote) |
| `freeDiscussionRound(meetingId, opinionId, voteResponses, additions)` | step 3 자유 토론 + 자식 의견 추가 + 깊이 cap 3 강제 | spec §11.18.5 (Step3FreeDiscussion votes + additions) |

부수:
- 발화 ID (`author_label`) 회의 단위 카운터 — `MeetingService` 안 카운터 map 또는 DB 집계
- IPC: `opinion:gather` / `opinion:tally` / `opinion:quickVote` / `opinion:freeDiscussion` (typedInvoke + zod)
- 기존 `OpinionService` (R12-C 시점 OPINION_GATHERING + OPINION_TALLY 분리) — *통째 교체* (옛 service 삭제 + 새 service 로 명세 통일)

Verify:
- vitest unit (4 method × 통상 + edge) + IPC 검증
- 깊이 cap 3 강제 (parent_id ON DELETE RESTRICT 가 자식 있는 부모 삭제 차단)
- schema 검증 fallback (1 회 재요청 + 2 회 skip)

### 진입 순서

1. 본 메모리 + plan T8 description + spec §11.18.2/3/4/5 + 기존 OpinionService 위치 grep
2. tasks.json T8 status='in_progress' 설정 후 진행
3. 4 게이트 워크플로우 (설계 → 의도 부합 검토 → 구현 → spec 부합 검토 → commit) 따름
4. T8 land 후 commit + 사용자 OK → T9 (P2-3 MeetingMinutesService) 진행

### T8 진입 전 grep 권장

```bash
# 기존 OpinionService 위치 + 호출자
grep -rn "OpinionService\|OPINION_GATHERING\|OPINION_TALLY" src/main/meetings/ src/main/ipc/

# spec §11.18.2~§11.18.5 schema 정식 (Step1OpinionGather / OpinionRow / Step25QuickVote / Step3FreeDiscussion)
grep -n "Step1OpinionGather\|OpinionRow\|Step25QuickVote\|Step3FreeDiscussion" docs/superpowers/specs/2026-05-01-rolestra-channel-roles-design.md

# IPC zod schema 패턴 (typed invoke)
grep -rn "ipc-schemas\|typedInvoke" src/shared/ src/preload/ | head
```

## 작업 환경 메모

- **worktree**: `/mnt/d/Taniar/Documents/Git/Rolestra-r12c2` (절대 경로 사용 — 환각 차단)
- **commit identity**: `mua-vtuber` / `mua.vtuber@gmail.com` 만 (CLAUDE.md global rule)
- **CLAUDE.md mock/fallback 금지** — T8 OpinionService 안 fallback 절대 X / spec 의도대로 throw
- **WSL ↔ Windows native binding drift 복구**: `npm i --no-save @rollup/rollup-linux-x64-gnu` + `npm rebuild better-sqlite3` (P2-1 진입 시점에 적용함 — 다음 세션도 동일 가능성)
- **package-lock.json 자동 갱신 시 git checkout 으로 복구** (사용자 dev 빌드 후 platform 차이)
- **사용자 = 코딩 무지인** — 코드 / 경로 / 함수명 직접 인용 X. 사무실 메타포 (이번 P2-1 보고 = "회의 시스템 서류함 통째 교체")
- **worktree merge reminder**: 작업 끝나면 main merge + worktree remove + branch 삭제 (P8 closeout 시점)

## P2-1 결정원칙 적용 회고

- **spec 옵션 묻지 않고 그대로 적용** ✅ — opinion 컬럼 명세 / opinion_vote 명세 / max_rounds 모두 spec 직접 인용
- **drop X 결정 = 코드 검증 후 명시** — 옛 opinion_revisions / SSM phase 컬럼 둘 다 grep 결과 + T10 의존 분석으로 근거 제시
- **회귀 차단 첫 검증** — 마이그레이션 카운트 하드코딩 테스트 (`schema-008-011.test.ts` toBe(18) → toBe(19)) 동시 갱신
- **WSL binding 복구 절차 = 메모리 명시 절차 그대로** — 메모리 reference (`rolestra-r12-c-dogfooding-round1.md`) 가 P2-1 진입 시 즉시 활용됨
