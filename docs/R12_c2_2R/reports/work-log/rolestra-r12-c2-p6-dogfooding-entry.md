---
name: R12-C2 P6 dogfooding 진입 가이드 (T27+T28+T29 land 후)
description: 보낸 부서 → 받는 부서 인계 chain 통째 동작 검증 시나리오. 사용자 Windows 위임. 회귀 발견 시 fix round, 회귀 0 시 worktree → main ff merge + push.
type: project
---

# R12-C2 P6 dogfooding 진입 가이드 (2026-05-07)

worktree `feat/r12-c2-redesign-r2` 안 P6 진입 1~3 호 (T27 + T28 + T29) 모두 land 완료. chain 양 끝 (보낸 부서 회의 종결 → 사용자 결재 / 자동 인계 → 받는 부서 카드 → 회의 시작 + 컨텍스트 주입) 이 처음 닿는 시점.

## 회의 흐름 — 무엇을 하는지

**평소 회의** (이전과 동일):
1. 채널에서 [회의 시작]
2. 직원들이 의견 제시 / 투표 / 자유 토론
3. 모더레이터가 회의록 작성
4. 회의 종결 — 알림 + 채팅창 시스템 메시지

**P6 새 동작** (T27 + T28 + T29 land 후):
1. 회의 종결 시점에 시스템이 *어디로 인계할지* 판정 (감사 부서 → 기획 부서 만 actual wire, 나머지는 chain 끝)
2. 받는 부서 채널의 *인계 모드* 따라 분기:
   - **확인 모드 (디폴트)** — 결재 모달 등장 → 사용자 [확인] / [취소] 결정
   - **자동 모드 (opt-in)** — 모달 없이 즉시 받는 부서로 의뢰서 발송 (Notification은 T30 책임이라 T29 시점 미land)
3. 사용자 [확인] → 의뢰서 영속 + 받는 부서 unread 표시
4. 받는 부서 채널 진입 시 → 외주 의뢰서 카드가 채널 위에 표시
5. 카드의 [의견 모아 회의 시작] 클릭 → 받는 부서 회의 시작 + 보낸 부서 회의록 + 작업 list 가 첫 system 메시지로 prepend → 받는 부서 직원들이 컨텍스트 잃지 않고 의견 제시

## 사용자 위임 시나리오

### 사전 준비

1. WSL → Windows 위임. worktree 안 dev 빌드:
   ```
   cd D:\Taniar\Documents\Git\Rolestra-r12c2-r2
   npm install
   npm run dev:start
   ```
   native binding (better-sqlite3) 재빌드 필요시 `npm rebuild` 1 회.

2. 테스트 프로젝트 한 개 — *기획 부서* 채널 + *검토 부서* (audit) 채널 모두 등록되어 있어야 함. 직원 (provider) 도 각 부서에 1 명 이상.

### 시나리오 1 — 검토 부서에서 NG 결과 → 기획 부서 인계 (확인 모드)

**목표**: 검토 부서 회의가 NG 판정 시 기획 부서로 자동 인계 후보가 생기고, 사용자 결재 모달이 등장 → [확인] → 받는 부서 카드 → 회의 시작 시 컨텍스트 동봉 검증.

**단계**:

1. 기획 부서 채널의 인계 모드 확인 — 디폴트 *확인 모드* (사용자가 따로 설정 안 했으면).
2. 검토 부서 채널 → [회의 시작] → 주제 입력. 직원들이 의견 제시 → 일부를 *agreed* 로 합의 (= NG 문제로 분류).
3. 회의 종결 직후:
   - **기대 동작 A**: 채팅창에 *"회의 종결 — 다음 부서 인계는 사용자 승인 대기 중입니다."* 시스템 메시지.
   - **기대 동작 B**: 결재 모달 자동 등장. 모달 안:
     - "기획 → 인계 흐름" 라벨 (audit → planning)
     - "검토 부서 NG 판정 — N 건 문제 발견 ..." 인계 사유
     - 회의록 본문 통째 (truncate X scroll)
     - "+ 리뷰 부서도 시작" 체크박스 (audit→planning 분기에서만 등장)
4. 모달 [취소] 클릭 → 모달 닫힘 + 받는 부서로 인계 X. 받는 부서 채널에 카드 X.
5. 다시 같은 시나리오 진행해서 모달 [확인] 클릭 → 모달 닫힘 + 받는 부서 (기획) unread 표시.
6. 기획 부서 채널 진입 → **카드가 채널 위에 등장**. 카드 안:
   - 보낸 부서 / 시각 / 인계 사유 / 회의록 미리보기 (5~6 줄 정도) / [회의록 통째 보기] 링크
   - "받는 부서가 처리할 작업" list — 문제 처리 항목 + "처리 작업 분배" / "재기획 회의록" (mission card 의 expectedOutputs 그대로)
   - [의견 모아 회의 시작] / [닫기] 버튼
7. [회의록 통째 보기] 클릭 → 모달에 회의록 통째 (긴 본문 scroll).
8. [의견 모아 회의 시작] 클릭 → **기획 부서 회의 자동 시작**. 첫 turn 직원 응답 안에 *보낸 부서 회의록 + 작업 list 보고 의견 제시* 한 흔적이 있는지 확인 (직원이 해당 NG 항목들을 처리 작업으로 분배하는 답변).

### 시나리오 2 — 자동 인계 모드 (auto)

**목표**: 받는 부서의 인계 모드를 *자동* 으로 켜면 모달 없이 즉시 의뢰서 발송 검증.

**현재 상태**: HandoffModeToggle 컴포넌트는 land 했지만 **진입점 mount 는 후속 — 사이드바 ⚙ / 채널 설정 모달 안 mount 자체가 미land**. UI 에서 모드 변경 entry 없음.

**우회 검증**:

1. SQLite 직접 수정 (또는 dev tools migration) — `UPDATE channels SET handoff_mode='auto' WHERE id='기획채널ID'`
2. dev 재시작.
3. 검토 부서 회의 → NG 판정 → 회의 종결.
4. **기대 동작**: 모달 X. 채팅창에 *"회의 종결 — 받는 부서로 자동 인계 완료."* 시스템 메시지. 기획 채널에 카드 등장.
5. T30 (Notification 발송) 미land 라 사용자 알림 X — 받는 채널 unread 만 신호.

만약 SQLite 직접 수정이 어려우면 **이 시나리오는 skip 권장** — HandoffModeToggle 진입점 mount 가 land 된 후 dogfooding 묶음 검증.

### 시나리오 3 — 검토 부서에서 OK 결과 (chain 끝)

**목표**: 검토 부서 회의가 OK (모든 의견 *excluded*) 판정 시 인계 미발생 + 회의 종결만 검증.

**단계**:

1. 검토 부서 [회의 시작]. 직원들이 의견 제시 → 모두 *excluded* (수용 가능) 로 처리.
2. 회의 종결 직후 **기대 동작**: 일반 회의 종결 path — 모달 X / 받는 부서 카드 X / 채팅창 *"회의가 끝났습니다."* 시스템 메시지.

### 시나리오 4 — 다른 부서 회의 (기획 / 디자인 / 아이디어 / 구현)

**목표**: chain resolver placeholder branches 가 'no_chain' 반환 → 받는 부서 카드 미발생 검증.

**단계**:

1. 기획 부서 [회의 시작] → 종결.
2. **기대 동작**: 평소 회의 종결 path. 모달 X / 받는 부서 카드 X.

→ T29 시점에는 *검토 → 기획* chain 만 actual wire. 다른 chain (idea→design / planning→implement / design→planning / implement→audit) 은 placeholder 라 회의 종결 후 카드 surface 안 됨. 정상 동작.

### 시나리오 5 — 받는 부서 카드 닫기 + 같은 채널 재진입

**목표**: 카드 [닫기] → 카드 hide → 같은 세션 안에서 재진입해도 카드 미surface 검증.

**단계**:

1. 시나리오 1 의 6 단계 (받는 부서 카드 등장) 까지 진행.
2. [닫기] 클릭 → 카드 hide → SsmBox 일반 layout 표시.
3. 다른 채널로 이동 후 다시 받는 부서 채널 재진입.
4. **기대 동작**: 카드 미surface (열람 도장 = opened_at 이미 set 되어 unopenedOnly list 에서 빠짐).

→ "[패키지 다시 보기]" 채널 헤더 버튼은 T29 시점 mount 미land — dogfooding 시점 묶음 mount 권장 (회귀 발견 시 fix round 안에 포함).

## 회귀 발견 시 분기

발견 패턴 별 처리:

| 회귀 종류 | fix 위치 | 우선순위 |
|----------|---------|---------|
| chain resolver — receiver lookup 실패 (planning 채널 0 건) | `src/main/index.ts` resolveReceiverChannel closure | P0 (chain 자체 깨짐) |
| 결재 모달 trigger 안 함 (stream:handoff-required emit 누락) | `src/main/meetings/engine/meeting-orchestrator.ts` runHandoffPhase | P0 |
| 모달 [확인] 시 dispatch 실패 | `src/main/ipc/handlers/handoff-handler.ts` handleHandoffApprove | P0 |
| 받는 부서 카드 미surface (list-by-channel 결과 빈) | `src/main/handoff/handoff-dispatch-service.ts` trackByChannel | P1 |
| 카드 안 회의록 본문 누락 | `src/main/ipc/handlers/handoff-handler.ts` handleHandoffReadWithMinutes | P1 |
| [의견 모아 회의 시작] 후 첫 turn prompt 안 컨텍스트 누락 | `src/main/meetings/engine/meeting-session.ts` priorContextSystemMessage | P0 |
| 작업 list 표시 누락 / 잘못된 형식 | `src/shared/handoff/next-actions.ts` extractNextActions | P2 |
| i18n 누락 / 영어 노출 | `src/renderer/i18n/locales/ko.json` | P2 |

회귀 0 → main ff merge 진입.

## main ff merge 진입 (회귀 0 확인 후)

worktree → main ff merge + push:

```
cd D:\Taniar\Documents\Git\Rolestra
git fetch
git checkout main
git pull
git merge --ff-only feat/r12-c2-redesign-r2
git push origin main

# worktree 정리
git worktree remove D:\Taniar\Documents\Git\Rolestra-r12c2-r2
git branch -d feat/r12-c2-redesign-r2
```

## 사용자 위임 — 시나리오 우선순위

가장 핵심 시나리오 = **시나리오 1** (확인 모드 검토→기획 chain 통째). 이게 동작하면 P6 의 main path land 검증 완료.

차순위 = **시나리오 3** (OK 분기 chain 끝) + **시나리오 4** (다른 부서 placeholder).

자동 모드 (시나리오 2) + 카드 재진입 (시나리오 5) 은 회귀 발견 시 또는 묶음 fix 시점에 검증 권장.

## 보고 형식 (검증 후)

각 시나리오 별:
- ✅ 통과 / ❌ 회귀 발견
- 회귀 시: 구체 동작 (어떤 단추 누르고, 무엇이 기대되었고, 무엇이 실제 발생) 1~3 줄

dogfooding 결과 받고 fix round 진행 또는 main ff merge.
