---
name: R12-C2 T9 P2-3 종결 — MeetingMinutesService + truncate 검출 + atomic write (2026-05-04)
description: R12-C2 P2-3 MeetingMinutesService land 완료 (commit `4b3a9ef`) — compose(meetingId) 1 method + 회의 history + 의견 트리 통째 prompt 동봉 + truncate 검출 (×1.2 임계) + 1 회 재요청 + deterministic fallback + atomic write + PathGuard 봉인. vitest 신규 14 tests / 전체 3574/13/0 / typecheck 0. 다음 작업 = T10 P2-4 MeetingOrchestrator 재배선.
type: project
originSessionId: 9001b9e7-r12c2-p23
---

## 진입 위치 + worktree 상태

- **worktree**: `/mnt/d/Taniar/Documents/Git/Rolestra-r12c2`
- **branch**: `feat/r12-c2-meeting-redesign`
- **tip**: `5021de8` (T9 P2-3 service `4b3a9ef` + tasks.json sync `5021de8`)
- **base**: `e3cdafb` (R12-C 1차 main tip)
- **vitest baseline**: 3574 / 13 / 0 (P2-2 round 3560 → P2-3 +14 신규 = 3574, 회귀 0)
- **typecheck**: 0

## P2-3 land 결과 (commit `4b3a9ef`)

### 신규 파일 (4)

| 파일 | 변경 |
|------|------|
| `src/shared/meeting-minutes-types.ts` | MeetingMinutesComposeInput / Result + Source 3종 (`'moderator' | 'moderator-retry' | 'fallback'`) |
| `src/main/meetings/meeting-minutes-service.ts` | `compose(meetingId)` 1 method + 도메인 에러 2종 + buildPromptBody + composeDeterministicFallback + 헬퍼 5종 |
| `src/main/ipc/handlers/meetings-minutes-handler.ts` | meetings:composeMinutes 위임 + setMeetingMinutesServiceAccessor |
| `src/main/meetings/__tests__/meeting-minutes-service.test.ts` | vitest 14 tests — 통상 / truncate 1회 재요청 / fallback / 의견 0건 / PathGuard / atomic write 등 |

### 변경 파일 (4)

| 파일 | 변경 |
|------|------|
| `src/shared/ipc-types.ts` | meetings:composeMinutes 채널 타입 + import |
| `src/shared/ipc-schemas.ts` | meetingsComposeMinutesSchema + v3ChannelSchemas 등록 |
| `src/main/ipc/router.ts` | meetings:composeMinutes handle 등록 |
| `src/main/index.ts` | MeetingMinutesService boot wire (MeetingSummaryService 직후) |

### 도메인 에러 2종

```
MeetingMinutesError              (base)
  ├── MeetingNotFoundForMinutesError  (caller 의 잘못된 meetingId)
  └── MinutesPathOutsideConsensusError  (path traversal 시 PathGuard throw)
```

### IPC 1 channel

| channel | request | response |
|---------|---------|----------|
| `meetings:composeMinutes` | `{ meetingId }` | `{ result: MeetingMinutesComposeResult }` |

zod 검증: `meetingId` 길이 1~128.

## 결정사항 (논의 외 / spec 직접 적용)

- **저장 경로 = `<ArenaRoot>/consensus/meetings/<meetingId>/minutes.md`**: spec §11.18.6 의 informal 표현 (`<ArenaRoot>/<projectId>/consensus/<meetingId>/minutes.md`) 보다 코드베이스 invariant 우선. `arenaRoot.consensusPath()` + `consensus/meetings/` 가 boot 시점에 ensure 됨. 사용자 의도 ("프로젝트별 회의록 모은 폴더") 는 충족 + PathGuard 1 layer.
- **truncate 임계 = body.length / Σ(opinion.content + rationale) ≥ 1.2** (spec §11.18.7 명시값). 의견 본문 합 ≤ 100 자면 검사 자체 skip — 짧은 회의에서 fallback 본문이 자연 짧아 false-positive 발생 차단.
- **truncate 두 번 연속 또는 모더레이터 호출 실패 → deterministic fallback**. body 안에 "(모더레이터 작성 불가 — 시스템 자동 정리)" plate 명시 — silent fallback 금지 (CLAUDE.md mock/fallback rule). source 필드로 출처 audit 가능.
- **atomic write = `<minutes.md>.<rand>.tmp` + rename**. POSIX/Windows 모두 같은 디렉터리 안 rename atomic 보장. randomBytes(8).toString('hex') 로 충돌 방지.
- **PathGuard 봉인 = path.resolve 후 consensusBase prefix 검사**. path traversal (`../../../etc`) 시 `MinutesPathOutsideConsensusError` throw. TOCTOU 안전 — resolve 후 검증.
- **service 단일 책임 — body / minutesPath / source 만 반환**. 채팅창 카드 표시는 T10 (orchestrator 재배선) + T12 (회의록 chat block) 책임. 큐 트리거는 T11 (P2-5) 책임. status 갱신은 T8 OpinionService (이미 land) 책임. P2 의존 그래프 (T9 → T10 → T11/T12) 깔끔 유지.

## 4 게이트 워크플로우 적용

```
[1] 설계 — spec §11.18.6 + §11.18.7 + tasks.json T9 acceptance + 코드베이스 invariant 매핑 ✅
   ↓
[2] 의도 부합 검토 — DB ↔ shared types ↔ service input/output 매핑 + prompt 양식 매핑 ✅
   ↓
[3] 구현 — 4 신규 + 4 변경 / vitest 14 tests / typecheck 0 ✅
   회귀 0 (테스트 typecheck issue 3 회 즉시 fix — MeetingKind / Project.description / vi.fn type)
   ↓
[4] spec 부합 검토 — acceptance 10 항목 ✅ + 도메인 에러 2종 + IPC 1 channel + atomic write + PathGuard ✅
   ↓
[5] commit `4b3a9ef` (코드) + `5021de8` (tasks.json sync) + 메모리 갱신 ✅
```

## 다음 세션 첫 작업 — T10 P2-4 MeetingOrchestrator 재배선

P2 의존 그래프:

```
T7 (migration 019)        ✅ land
   ↓
T8 (OpinionService)       ✅ land
   ↓
T9 (MeetingMinutesService)   ✅ land
   ↓
T10 (Orchestrator 재배선)  ← 다음
   ↓                       ↓
T11 (할 일 큐 트리거)        T12 (회의록 chat block)
                            ↓
                    P3 진입 (T13~T18)
```

### T10 acceptance (tasks.json T10 description — 본 메모리 작성 시점에는 미열람, 다음 세션에서 grep 권장)

`MeetingOrchestrator` 의 옛 12 SSM 모델 (`OPINION_GATHERING` / `OPINION_TALLY` / `AGREEMENT_VOTE` / `REVISION_NEGOTIATION` / `DISCUSSING` / `PROPOSING` / `VOTING` / `WORK_DISCUSSING` / `SYNTHESIZING` / `EXECUTING` / `REVIEWING` / `DONE`) 통째 폐기 → 새 5 단계 + 2.5 일괄 투표:

1. step 1 의견 제시 → `OpinionService.gather`
2. step 2 시스템 취합 → `OpinionService.tally`
3. step 2.5 일괄 동의 투표 → `OpinionService.quickVote` (만장일치 즉시 agreed)
4. step 3 자유 토론 round → `OpinionService.freeDiscussionRound` (의견 1 건씩 max_rounds 도달 시 사용자 호출)
5. step 5 모더레이터 회의록 → `MeetingMinutesService.compose` + 결과 system_minutes 채널 카드 메시지 insert (T12 의존 가능)

### T10 진입 전 grep 권장

```bash
# tasks.json T10 description 본문
python3 -c "
import json
data = json.load(open('docs/superpowers/plans/2026-05-04-rolestra-phase-r12-c2.md.tasks.json'))
for t in data['tasks']:
    if t.get('id') == 10: print(t['description'])
"

# 옛 12 SSM 진입점 + transition 함수
grep -rn "OPINION_GATHERING\|OPINION_TALLY\|AGREEMENT_VOTE\|REVISION_NEGOTIATION" src/main/meetings/engine/ src/shared/

# MeetingOrchestrator + ConsensusStateMachine
grep -rn "MeetingOrchestrator\|ConsensusStateMachine\|TurnManager" src/main/meetings/engine/

# 기존 회의 시작 / 종료 IPC
grep -n "meeting:start\|meeting:abort\|meeting-orchestrator-registry" src/main/ipc/router.ts src/main/meetings/

# system_minutes 채널 메시지 insert 패턴 (옛 composeMinutes 호출처)
grep -rn "system_minutes\|composeMinutes\|회의록" src/main/meetings/engine/
```

### 진입 순서

1. 본 메모리 + plan T10 description + spec §5/§7 (옛 SSM 모델 폐기 + 새 5 단계) + R10/R11 MeetingOrchestrator 위치 grep
2. tasks.json T10 status='in_progress' 설정 후 진행
3. 4 게이트 워크플로우 (설계 → 의도 부합 검토 → 구현 → spec 부합 검토 → commit) 따름
4. T10 land 후 commit + 사용자 OK → T11 P2-5 (할 일 큐 트리거) 또는 T12 P2-6 (회의록 chat block) 분기 진입

## 작업 환경 메모

- **worktree**: `/mnt/d/Taniar/Documents/Git/Rolestra-r12c2` (절대 경로)
- **commit identity**: `mua-vtuber` / `mua.vtuber@gmail.com` 만 (CLAUDE.md global rule)
- **CLAUDE.md mock/fallback 금지** — T9 fallback (deterministic minutes) 은 spec/plan 명시 옵션이고 source 필드로 audit 가능 → silent fallback 아님 → OK.
- **WSL ↔ Windows native binding drift 복구** (회귀 X — 이번 세션에는 발생 X. 다음 세션도 가능성 있음): `npm i --no-save @rollup/rollup-linux-x64-gnu` + `npm rebuild better-sqlite3`
- **package-lock.json 자동 갱신 시 git checkout 으로 복구** (사용자 dev 빌드 후 platform 차이)
- **사용자 = 코딩 무지인** — 코드 / 경로 / 함수명 직접 인용 X. 사무실 메타포 (이번 P2-3 보고 = "회의 시스템 회의록 작성 기능 + 안전 저장 + truncate 차단 backend")
- **worktree merge reminder**: 작업 끝나면 main merge + worktree remove + branch 삭제 (P8 closeout 시점)
- **T9 → T10 의존**: T10 가 본 service 의 compose() 를 step 5 진입 시점에 호출. caller 책임 = 모든 의견 합의/제외 처리 완료 후 1 회만 호출 (멱등 X — 매 호출 시 모더레이터 재호출 + 파일 덮어쓰기).
