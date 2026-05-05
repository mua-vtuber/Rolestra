---
name: R12-C2 T10 sub-task 분할 land + 다음 세션 T10a 진입 (2026-05-04)
description: T10 (904+815+417 lines orchestrator/turn-executor/session 재작성 + 옛 SSM 일체 정리 + 옛 IPC + 옛 SsmBox + e2e) 가 한 commit 으로 묶기엔 커서 T10a/b/c 3 분할. plan + tasks.json 갱신 commit `1686947` land. 다음 세션 첫 작업 = T10a 진입.
type: project
originSessionId: r12c2-t10-split
---

## 진입 위치 + worktree 상태

- **worktree**: `/mnt/d/Taniar/Documents/Git/Rolestra-r12c2`
- **branch**: `feat/r12-c2-meeting-redesign`
- **tip**: `1686947` (T10 분할 commit) ← T9 P2-3 land `5021de8` 위에
- **base**: `e3cdafb` (R12-C 1차 main tip)
- **vitest baseline**: 3574 / 13 / 0 (P2-3 종결 시점, 본 commit 은 plan/tasks.json 만)
- **typecheck**: 0

## T10 분할 결정 — 사용자 답변 통째 (Q1~Q5)

| 질문 | 답변 |
|------|------|
| Q1 작업 범위 | **분할** — sub-task로 split (T7~T9 land 패턴 일관) |
| Q2 지원 부서 | **풀세트 3 부서 backend 토대** — 기획 / 리뷰 / 검토. 아이디어 = D-B-Light (P3), 디자인 = 7 단계 (P3), 구현 = 회의 X (P5) |
| Q3 자유 토론 진행 | **spec 그대로** — 라운드 누적 (의견 1 개씩 prompt → 합의 / 깊이 cap 3 / max_rounds 도달). 사용자가 처음 질문 오해 ("유저가 추가하는 회의실인줄") 후 정정 — 아이디어 부서는 풀세트 X (D-B-Light 그대로) |
| Q4 제어 통로 | **A — 옛 IPC 통로 통째 정리**. 새 통로 = `meeting:start` + `meeting:abort` 2 종. mode-transition / worker-selection / consensus_decision approval 등 옛 통로 통째 삭제 |
| Q5 화면 박스 | **A — backend 만**. 옛 SsmBox 비활성 (placeholder), P3 = 카드 + 박스 새 layout |

→ 사용자 발화: "정리를 철저하게하자. 필요없는 통로는 정리해야해", "어짜피 P3이 카드랑 박스작업이지않아?"

## T10 분할 내용 (3 sub-task)

### T10a (id 10) — P2-4a — 새 backend skeleton + 새 IPC + phase loop

- **Goal**: 새 5+2.5 phase loop 가 OpinionService + MeetingMinutesService 위에서 동작. 옛 SSM 호출 X (옛 파일 보존 — 본 sub-task 끝 시점에 dead code).
- **변경 (신규/재작성)**:
  - `src/main/meetings/engine/meeting-orchestrator.ts` 통째 재작성 — phase enum (`'gather' | 'tally' | 'quick_vote' | 'free_discussion' | 'compose_minutes' | 'handoff'`)
  - `src/main/meetings/engine/meeting-turn-executor.ts` 통째 재작성 — 단순화 (옛 WORK_DISCUSSING / EXECUTING / REVIEWING 분기 폐기)
  - `src/main/meetings/engine/meeting-session.ts` 통째 재작성 — 새 phase enum + 발화 ID 회의 단위 카운터 통합
  - `src/shared/meeting-flow-types.ts` 신규
  - `src/shared/ipc-types.ts` + `ipc-schemas.ts` 갱신 — 새 통로 시그니처
  - `src/main/ipc/handlers/meeting-handler.ts` 통째 재작성
  - `src/main/ipc/router.ts` — 새 통로 등록 (옛 통로 일시 graceful no-op)
  - 새 흐름 단위 테스트 land
- **Verify**: vitest 새 흐름 단위 테스트 PASS + typecheck 0 + 새 orchestrator 가 옛 SSM 호출 X (grep)
- **blockedBy**: [8, 9] (T8 OpinionService + T9 MeetingMinutesService — 둘 다 land 완료)

### T10b (id 36 신규) — P2-4b — 옛 SSM + 옛 IPC + 옛 SsmBox 통째 정리

- **Goal**: spec verify "옛 SSM 코드 잔존 X" 충족.
- **삭제 대상**:
  - `src/main/engine/consensus-machine.ts`
  - `src/main/engine/session-state-machine.ts`
  - `src/main/engine/consensus-evaluator.ts`
  - `src/main/engine/decision-collector.ts`
  - `src/main/engine/v3-side-effects.ts` (옛 SSM 분기)
  - `src/main/meetings/engine/meeting-minutes-composer.ts` (옛 — T9 service 가 대체)
  - 옛 테스트 (consensus-machine.test / consensus-evaluator.test / consensus-execution-integration.test / decision-collector.test 있으면 / 옛 minutes-composer.test 2 종)
- **재정의**:
  - `src/shared/consensus-types.ts` — 옛 12 상태 union 제거
  - `src/shared/session-state-types.ts` — 옛 SessionState 정리 또는 파일 삭제
  - `src/shared/constants.ts` — 옛 진행 list 정리
  - 옛 IPC 통로 + consensus_decision approval 흐름 통째 삭제
  - 렌더러 옛 SsmBox 비활성 (placeholder) + 옛 stream 구독 hook 정리
- **Verify**: grep `ConsensusStateMachine\|OPINION_GATHERING\|...` 결과 0 + typecheck 0 + vitest 0 fail
- **blockedBy**: [10] (T10a)

### T10c (id 37 신규) — P2-4c — e2e + T10 closeout

- **Goal**: 회의 1 round 시뮬레이션 e2e + 통합 검증 + T10 closeout.
- **변경 (신규)**:
  - vitest 통합 — fake provider 3 명 + 4 시나리오:
    1. **만장일치**: step1 의견 2 개 → step2.5 만장일치 → 자유 토론 skip → step5 회의록 → handoff
    2. **자유 토론**: step1 의견 1 개 → step2.5 비만장일치 → step3 라운드 누적 (3 라운드 + 깊이 cap 3 자식 의견 추가) → 합의 → step5 회의록
    3. **max_rounds 도달**: step3 5 라운드 진행 → 합의 미도달 → 사용자 호출 (Notification + 일시 정지)
    4. **abort**: step3 진행 중 `meeting:abort` → 즉시 중단 + 회의록 미생성 + outcome='aborted'
  - 옛 흐름 의존 테스트 정리 (T10b 못 지운 잔재)
- **Verify**: vitest 통합 4 종 PASS + 4 게이트 [4] spec 부합 검토 acceptance 통째 확인 (§5 + §11.18 + 깊이 cap 3 + 발화 ID 회의 단위 카운터 + 회의록 truncate 금지 + handoff_mode 분기) + typecheck 0
- **blockedBy**: [36] (T10b)

## tasks.json 변경 (commit `1686947`)

- T10 (id 10) subject 갱신 + description T10a 로 통째 재작성
- T10b (id 36 신규) + T10c (id 37 신규) append
- T11 (id 11) blockedBy [10] → [37]
- T25 (id 25) blockedBy [10, 16, 17] → [37, 16, 17]
- 총 task 36 → 38

P2 sub-task 개수 6 → 8 (plan markdown 표 갱신).

## 다음 세션 첫 작업 — T10a 진입

### 진입 절차 (4 게이트 워크플로우)

```
[1] 설계 — T10a description (tasks.json id 10) + spec §5 + §11.18 + 옛 orchestrator 진입점 audit
   → 사용자 OK 후 진행
   ↓
[2] 의도 부합 검토 — DB ↔ shared types ↔ service input/output 매핑 + StreamBridge phase 이벤트 페이로드 정의
   ↓
[3] 구현 — 새 orchestrator + 새 turn-executor + 새 session 통째 재작성 + 새 IPC + vitest 신규
   ↓
[4] spec 부합 검토 — acceptance 통째 (§5 phase 흐름 / §11.18 schema 4 종 / 발화 ID 회의 단위 카운터)
   ↓
[5] commit + 메모리 land summary + 사용자 OK
```

### 진입 전 grep 권장

```bash
# T10a description 본문
python3 -c "
import json
data = json.load(open('docs/superpowers/plans/2026-05-04-rolestra-phase-r12-c2.md.tasks.json'))
t = next(x for x in data['tasks'] if x['id'] == 10)
print(t['description'])
"

# 옛 orchestrator 진입점 + 의존 그래프
grep -n "export class\|export interface\|export type" src/main/meetings/engine/meeting-orchestrator.ts src/main/meetings/engine/meeting-session.ts src/main/meetings/engine/meeting-turn-executor.ts

# 옛 IPC 통로 호출처 (channel-handler triggerMeeting 진입점 등)
grep -rn "MeetingOrchestratorFactory\|setMeetingOrchestratorFactory\|triggerMeeting" src/main/

# OpinionService API surface (T8 land — 본 sub-task caller)
grep -n "^  [a-z].*(\|^export" src/main/meetings/opinion-service.ts

# MeetingMinutesService API (T9 land)
grep -n "^  [a-z].*(\|^export" src/main/meetings/meeting-minutes-service.ts

# spec 새 흐름 정식
sed -n '282,405p' docs/superpowers/specs/2026-05-01-rolestra-channel-roles-design.md  # §5 D-B 구조화된 합의
sed -n '937,1156p' docs/superpowers/specs/2026-05-01-rolestra-channel-roles-design.md  # §11.18 schema 4 종
```

### T10a 설계 시 결정 필요 항목 (사용자 사전 입력)

본 메모리에서 이미 답변된 항목 (재질문 X):
- 풀세트 3 부서 backend (Q2)
- 라운드 누적 자유 토론 (Q3)
- 새 IPC = `meeting:start` + `meeting:abort` 2 종 (Q4)
- 옛 SsmBox 비활성, backend 만 (Q5)

T10a 진입 시 새로 결정 필요할 수 있는 항목 (설계 게이트에서 사용자 confirm 받기):
- StreamBridge phase 이벤트 이름 + 페이로드 형식 (P3 SsmBox 가 subscribe)
- 발화 ID 회의 단위 카운터 위치 — Session 내부 vs OpinionService.nextLabelHint 활용
- handoff_mode (auto/check/manual) 의 기본값 + 부서별 디폴트 분기 (P3 책임이지만 backend 가 표현은 해야 함)
- max_rounds 디폴트 — channels.max_rounds 컬럼 (T7 migration 019 land) 기본값 = 5 인지 확인

## 작업 환경 메모

- **commit identity**: `mua-vtuber` / `mua.vtuber@gmail.com` 만
- **CLAUDE.md mock/fallback 금지** — fake provider 는 vitest 통합 테스트 한정 (`__tests__/` 안)
- **WSL ↔ Windows native binding drift** 가능성: `npm i --no-save @rollup/rollup-linux-x64-gnu` + `npm rebuild better-sqlite3`
- **사용자 = 코딩 무지인** — 사무실 메타포로 보고 (T10a = "회의 시스템 진행 엔진 통째 새로 + 외부 명령 통로 새로")
- **worktree merge reminder**: 작업 끝나면 (P8 closeout 시점) main merge + worktree remove + branch 삭제
- **현 세션 종료 시점**: T10 분할 plan + tasks.json land 만 — 본체 구현 X. 사용자에게 새 세션 진입 명시 안내됨.

## 의존 그래프 갱신

```
P2 의존 그래프 (T10 분할 후):

T7 (migration 019)        ✅ land
   ↓
T8 (OpinionService)       ✅ land
   ↓
T9 (MeetingMinutesService)   ✅ land
   ↓
T10a (새 backend skeleton)   ← 다음 세션
   ↓
T10b (옛 SSM + IPC + SsmBox 정리)
   ↓
T10c (e2e + T10 closeout)
   ↓                       ↓
T11 (할 일 큐 트리거)        T12 (회의록 chat block) — T9 의존이라 T10c 없이도 진입 가능
                            ↓
                    P3 진입 (T13~T18)
```
