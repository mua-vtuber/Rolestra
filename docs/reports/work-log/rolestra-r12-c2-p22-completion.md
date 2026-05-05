---
name: R12-C2 T8 P2-2 종결 — OpinionService backend 4 method + IPC + 깊이 cap 3 강제 (2026-05-04)
description: R12-C2 P2-2 OpinionService backend land 완료 (commit `013f690`) — gather / tally / quickVote / freeDiscussionRound + 깊이 cap 3 강제 + 만장일치 → agreed + UnknownScreenIdError / OpinionNotFoundError 4 종 도메인 에러. vitest 신규 44 tests / 전체 3560/13/0 / typecheck 0. 다음 작업 = T9 P2-3 MeetingMinutesService.
type: project
originSessionId: 9001b9e7-r12c2-p22
---

## 진입 위치 + worktree 상태

- **worktree**: `/mnt/d/Taniar/Documents/Git/Rolestra-r12c2`
- **branch**: `feat/r12-c2-meeting-redesign`
- **tip**: `013f690` (T8 P2-2 — OpinionService backend 4 method + IPC + 깊이 cap 3)
- **base**: `e3cdafb` (R12-C 1차 main tip)
- **vitest baseline**: 3560 / 13 / 0 (P2-1 round 3516 → P2-2 +44 신규 = 3560, 회귀 0)
- **typecheck**: 0

## P2-2 land 결과 (commit `013f690`)

### 신규 파일 (10)

| 파일 | 변경 |
|------|------|
| `src/shared/opinion-types.ts` | Opinion + OpinionVote camelCase 매핑 + Step1OpinionGather/Step25QuickVote/Step3FreeDiscussion 응답 타입 + 4 결과 타입 |
| `src/main/meetings/opinion-repository.ts` | opinion + opinion_vote CRUD (FK 정책 그대로 활용) + countDistinctLabelsByAuthor 헬퍼 |
| `src/main/meetings/screen-id.ts` | buildScreenIdMap depth-first (ITEM_NNN / ITEM_NNN_NN / ITEM_NNN_NN_NN) + mapToRecord |
| `src/main/meetings/opinion-service.ts` | 4 method + 도메인 에러 4 종 + nextLabelHint |
| `src/main/ipc/handlers/opinion-handler.ts` | 4 IPC handler + setOpinionServiceAccessor |
| `src/main/meetings/__tests__/screen-id.test.ts` | 9 tests — cap 표현 / orphan / pad |
| `src/main/meetings/__tests__/opinion-repository.test.ts` | 10 tests — CRUD + 필터 |
| `src/main/meetings/__tests__/opinion-service.test.ts` | 17 tests — 4 method × 통상 + edge |
| `src/main/ipc/handlers/__tests__/opinion-handler.test.ts` | 6 tests — 위임 + 에러 전파 |
| (소계 = 신규 9 source + 4 test = 13, 변경 4 = 17 항목, 본문 2678 lines insertion) | |

### 변경 파일 (4)

| 파일 | 변경 |
|------|------|
| `src/shared/ipc-types.ts` | opinion:* 4 channel 추가 (typed invoke) |
| `src/shared/ipc-schemas.ts` | opinion:* 4 channel zod schema 등록 + Step1/2.5/3 payload 검증 |
| `src/main/ipc/router.ts` | opinion:* 4 channel 라우트 등록 |
| `src/main/index.ts` | OpinionRepository + OpinionService boot + accessor wire |

### 도메인 에러 4 종

```
OpinionError              (base)
  ├── UnknownScreenIdError  (직원 응답의 target_id 매핑 실패 → caller 재 tally)
  ├── OpinionDepthCapError  (depth 2 부모에 자식 추가 차단 — silent skip X)
  └── OpinionNotFoundError  (잘못된 opinionId / 다른 회의 opinionId)
```

### IPC 4 channel

| channel | request | response |
|---------|---------|----------|
| `opinion:gather` | `{ meetingId, channelId, round, responses[] }` | `{ result: OpinionGatherResult }` |
| `opinion:tally` | `{ meetingId }` | `{ result: OpinionTallyResult }` |
| `opinion:quickVote` | `{ meetingId, round, responses[] }` | `{ result: OpinionQuickVoteResult }` |
| `opinion:freeDiscussion` | `{ meetingId, opinionId, round, responses[] }` | `{ result: OpinionFreeDiscussionResult }` |

zod 검증: `responses` envelope `{ providerId, payload }` + payload 안 step 별 schema (제목 ≤ 400 / 본문 ≤ 100k / rationale ≤ 50k / quick_votes ≤ 200 / additions ≤ 50 / responses ≤ 32).

### spec 정합 (§11.18.2~§11.18.5 acceptance ↔ land)

| acceptance | 결과 | 위치 |
|------------|------|------|
| 4 method (gather/tally/quickVote/freeDiscussionRound) | ✅ | opinion-service.ts |
| 발화 ID 회의 단위 카운터 헬퍼 | ✅ | nextLabelHint + countDistinctLabelsByAuthor |
| IPC 4 channel + zod 검증 | ✅ | ipc-types.ts + ipc-schemas.ts + opinion-handler.ts |
| 기존 OpinionService 통째 교체 | ✅ | grep 결과 placeholder 주석만 → 신규 작성으로 충족 |
| 깊이 cap 3 강제 | ✅ | OpinionDepthCapError + service-level depth check |
| 만장일치 → status='agreed' 즉시 | ✅ | quickVote + freeDiscussionRound 둘 다 |
| schema 검증 fallback (silent X) | ✅ | invalid 시 throw — 1회 재요청은 T10 orchestrator 책임 |
| vitest unit 4 method × 통상+edge | ✅ | 신규 44 tests / 전체 3560/13/0 |

## 결정사항 (논의 외 / spec 직접 적용)

- **응답 순서 보존 — created_at + ordinal**: gather / freeDiscussionRound 가 같은 round insertion 의 created_at 동률 시 UUID tiebreaker 가 응답 순서와 일치하지 않을 수 있어 `baseNow + ordinal` 마이크로 카운터로 명시적 순서 강제. *테스트 1 회 회귀 fix* — 첫 시도 시 `gather.inserted` 순서 ≠ `tally.tree` 순서 확인.
- **발화 ID = AI 응답 그대로 저장**: `payload.label` 을 *trust* — system 이 검증/재할당 X. `nextLabelHint` 는 prompt 빌더 / 테스트용 best-effort 추정. 진실원천 = T10 orchestrator 의 in-memory 카운터 (회의 단위 리셋).
- **만장일치 strict 해석**: "응답한 voter 모두 'agree' (≥ 1 voter, oppose/abstain 0)". silent voter 는 abstention 처리 X — 응답이 없으면 카운트에서 제외. spec §11.18.4 발췌 "만장일치 (모두 agree)" 의 strict 해석.
- **screen ID = DB 비저장 / 매번 tally() 재구성**: UUID 가 진실원천 (`opinion.id` + `opinion.parent_id`). 직원 응답의 `target_id` 는 *화면 ID* — service 가 매번 screen→UUID 매핑 후 DB 반영.
- **깊이 cap 3 = depth 0+1+2**: root (depth 0) + 자식 (1) + 손자 (2). depth 2 부모에 자식 추가 시 `OpinionDepthCapError` throw. silent skip 금지 — caller 가 prompt 단계에서 cap 안내해야 (CLAUDE.md mock/fallback 금지 rule).
- **screen-id 모듈은 cap 표현은 허용 — 강제는 service**: `screen-id.ts` 는 depth 3 이상 입력도 ITEM_NNN_NN_NN_NN 처럼 자연 확장 표현. "DB 자체에는 cap 강제가 없다 (FK + RESTRICT 만)" 이므로 manual SQL 같은 edge 에서도 안전 표현 + service 진입 시점이 1 차 방어선.

## 4 게이트 워크플로우 적용

```
[1] 설계 — spec §11.18.2~§11.18.7 + tasks.json T8 acceptance + migration 019 컬럼 1:1 ✅
   ↓
[2] 의도 부합 검토 — DB 컬럼 ↔ shared types ↔ service input/output 매핑 표 작성 ✅
   ↓
[3] 구현 — 7 신규 + 4 변경 / vitest 44 tests / typecheck 0 ✅
    회귀 1 회 (테스트) — gather 안 같은 timestamp tie 발견 → ordinal 추가 fix
   ↓
[4] spec 부합 검토 — acceptance 7 항목 ✅ + 도메인 에러 4 종 + IPC 4 channel ✅
   ↓
[5] commit `013f690` + 메모리 갱신 ✅
```

## 다음 세션 첫 작업 — T9 P2-3 MeetingMinutesService

P2 의존 그래프:

```
T7 (migration 019)        ✅ land
   ↓
T8 (OpinionService)       ✅ land
   ↓
T9 (MeetingMinutesService)   ← 다음
   ↓                   ↓
T10 (Orchestrator 재배선)  T12 (회의록 chat block)
   ↓                       ↓
T11 (할 일 큐 트리거)        ↓
                            ↓
                    P3 진입 (T13~T18)
```

### T9 acceptance (tasks.json T9 description)

`src/main/meetings/meeting-minutes-service.ts` 신규 — `compose(meetingId)` 1 method:

- 회의 history (모든 메시지) + 의견 트리 (`opinion` + `opinion_vote`) 통째 모더레이터 prompt 에 동봉
- spec §11.18.6 prompt 양식 강제:
  · truncate 금지 (요약 / 축약 X — 의견 본문 + 근거 통째 보존)
  · `[합의 항목]` + `[제외 항목]` 두 섹션
  · 결정 사유 모더레이터 작성
- 모더레이터 응답 = markdown 본문 → `<ArenaRoot>/<projectId>/consensus/<meetingId>/minutes.md` 저장 + 채팅창 카드로 표시 (P2-6 의존)
- truncate 의심 검출 — 회의록 본문 길이 ↔ 의견 본문 합 비교 + 임계 (회의록 ≥ 의견 본문 합 × 1.2) 하회 시 1 회 재요청
- 옛 `MeetingSummaryService` 의 *deterministic minutes* 자동 정리 mode 는 fallback 으로 보존 (모더레이터 호출 실패 시)

Verify:
- vitest unit + 모더레이터 truncate 검출 회귀 + minutes.md 파일 atomic write + PathGuard 봉인

### T9 진입 전 grep 권장

```bash
# R12-S MeetingSummaryService + getResolvedSummaryModel 위치
grep -rn "MeetingSummaryService\|getResolvedSummaryModel" src/main/llm/ src/main/meetings/

# spec §11.18.6 모더레이터 회의록 prompt + truncate 검출 임계
grep -n "11\.18\.6\|truncate\|모더레이터 회의록" docs/superpowers/specs/2026-05-01-rolestra-channel-roles-design.md

# ArenaRoot consensus 폴더 패턴 (이미 R5+ 시점 land)
grep -rn "consensus.*minutes\|minutes\.md" src/main/arena/ src/main/files/

# PathGuard / atomic write 헬퍼
grep -rn "atomicWrite\|PathGuard.*write" src/main/files/ | head
```

### 진입 순서

1. 본 메모리 + plan T9 description + spec §11.18.6 + R12-S MeetingSummaryService 위치 grep
2. tasks.json T9 status='in_progress' 설정 후 진행
3. 4 게이트 워크플로우 (설계 → 의도 부합 검토 → 구현 → spec 부합 검토 → commit) 따름
4. T9 land 후 commit + 사용자 OK → T10 (P2-4 MeetingOrchestrator 재배선) 진행

## 작업 환경 메모

- **worktree**: `/mnt/d/Taniar/Documents/Git/Rolestra-r12c2` (절대 경로)
- **commit identity**: `mua-vtuber` / `mua.vtuber@gmail.com` 만 (CLAUDE.md global rule)
- **CLAUDE.md mock/fallback 금지** — T9 truncate 검출 시 silent fallback X. 1 회 재요청 후 *deterministic minutes fallback* (옛 MeetingSummaryService 활용) 은 spec 명시 옵션이라 OK
- **WSL ↔ Windows native binding drift 복구**: `npm i --no-save @rollup/rollup-linux-x64-gnu` + `npm rebuild better-sqlite3` (P2-1 진입 시점 / P2-2 진입 시점 모두 적용 X — 회귀 X. 다음 세션도 가능성 있음)
- **package-lock.json 자동 갱신 시 git checkout 으로 복구** (사용자 dev 빌드 후 platform 차이)
- **사용자 = 코딩 무지인** — 코드 / 경로 / 함수명 직접 인용 X. 사무실 메타포 (이번 P2-2 보고 = "회의 시스템 의견함 + 표결 backend 설치")
- **worktree merge reminder**: 작업 끝나면 main merge + worktree remove + branch 삭제 (P8 closeout 시점)
