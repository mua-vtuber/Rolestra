# Rolestra v3 — Phase R12-C2 계획서

> 작성: 2026-05-04 / 새 worktree `/mnt/d/Taniar/Documents/Git/Rolestra-r12c2` (branch `feat/r12-c2-meeting-redesign`, base `e3cdafb`)

R12-C 1차 종결 (사이드바 통합 + 부서별 회의실 + Skill 자동 배치 + 멤버 패널 정확화) 위에서 — *회의 진행 본체를 통째 새로 짜는* 단계. R12-C 1차 ADR D9 의 분할 결정 따라 8 phase (P1~P8) 로 구성.

---

## 왜 R12-C2 가 필요한가 (한 페이지 요약)

**옛 모델 (R6 ~ R12-C 1차 시점):** 직원이 모여 회의 시작 → 시스템이 *12 단계 합의 진행* (DISCUSSING / PROPOSING / VOTING / WORK_DISCUSSING / ...) 을 차례로 거치며 발화 → 마지막에 합의 도달 / 작업 분담 / 종결.

**문제:**
1. 12 단계가 *모든 회의에 일괄 적용* — 잡담 / 부서 회의 / 디자인 토론 모두 같은 흐름. 부서마다 책임이 다른데 흐름은 같음.
2. 합의 도달이 *일괄 동의* 한 번이라 *추가 의견 / 수정안 / 반대안* 이 흐름에 자연스럽게 들어가지 않음.
3. 회의록이 *합의된 결과만* 남음 — 사용자가 나중에 "그때 거부됐던 X 안 다시 진행하자" 같은 발화를 할 단서가 없음.
4. *부서 채널 = 회의 archive* 라는 새 사무실 구조와 맞지 않음.

---

## 새 회의 절차 (사용자 결정 통째 반영, 2026-05-04)

```
1. 의견 제시 (화면 보임)
   직원이 JSON 양식으로 의견 작성 — 같은 의견인지 다른 의견인지 시스템이 식별
   가능. 같은 직원이 회의 안에서 여러 의견 제시 가능 → 발화 ID 부여:
       codex_1 / codex_2 / claude_1 / gemini_1 / ... (회의 단위 카운터, 끝나면 리셋)
   화면에 발화 ID 표시 (사용자가 어느 의견을 누가 제시했는지 한눈에)

2. 시스템 취합 + 의견 ID 부여 (화면 안 보임 / SsmBox 에 의견 list 등장)
   시스템이 모은 의견에 트리 ID 매김:
       ITEM_001, ITEM_002, ITEM_003 ... (root 의견)
       ITEM_001_01, ITEM_001_02 ...    (수정 / 반대 / 추가 의견 = ITEM_001 의 자식)
       ITEM_001_01_01 ...                  (자식의 자식, 깊이 무제한 / 디폴트 cap = 3)
   → DB 저장은 단순 (id UUID + parent_id) / 화면 표시는 시스템이 parent chain 따라
      ITEM_NNN_NN_NN 형식 가공.

★ 2.5 일괄 동의 투표 (보임, SsmBox 에 vote 진행 표시)
   모든 직원에게 의견 list 보내고 *한꺼번에 동의 여부* 응답.
   - 만장일치 의견 → 즉시 합의 반영 (자유 토론 skip)
   - 만장일치 못 받은 의견만 step 3 으로
   - 동의하면서 코멘트 가능 (optional)

3. 자유 토론 (화면 보임, SsmBox 반영)
   시스템이 의견 1 개씩 제시 → 직원들이 형식 갖춰 자유 발언 + 동의/반대/수정/추가.
   - 동의 / 반대 / 보류
   - 수정 의견 / 반대 의견 / 추가 의견 = 자체 의견 카드로 등록 (트리 자식)
       예: ITEM_001 의 수정 의견 → ITEM_001_01
       그 수정 의견의 또 다른 수정 → ITEM_001_01_01
   - 다음 라운드에서 다른 직원들이 다시 투표 가능

4. 합의되면 시스템이 *다음 의견* 으로 넘어가서 제시 → step 3 반복

5. 모두 합의 → **회의록 작성 (모더레이터 AI)**
   ★ 회의록 정리 모델 (R12-S 시점 land 된 MeetingSummaryService 의 모더레이터)
     이 회의 통째 발화 history + 의견 통째 받아 직접 정리. 시스템 자동 작성 X.
   ★ 회의록만 보고도 이해 가능한 *상세 설명* (요약 X / 축약 X)
     - 의견 본문 통째 보존 (truncate 금지)
     - 근거 통째 보존
     - 결정 사유 (왜 합의 / 왜 제외) 모더레이터 작성
   두 섹션:
     [합의 항목]  — 합의된 의견 + 통째 본문 + 결정 (X 명 동의)
     [제외 항목]  — 제외된 의견 + 통째 본문 + 제외 사유
                     ☞ 사용자가 회의록 보고 "회의록 X — 제외 항목 #2 다시 진행"
                       같은 발화로 작업 재발화 가능 (정보 손실 방지)

6. handoff_mode 따라 다음 부서 인계
   'auto'  = 자동 인계
   'check' = 사용자 결재 모달 (회의록 미리보기 + 인계 사유 + 확인 버튼)
```

### 직원 응답 JSON schema (P1 spec round 안에서 정식화)

```typescript
// step 1 — 의견 제시
{
  "name": "Codex",                  // 직원 표시명
  "label": "codex_1",               // 회의 단위 발화 ID (시스템이 부여)
  "opinions": [
    {
      "title": "나는 이런 게 좋다",   // 의견 제목 (카드 헤더)
      "content": "어떠고 저떠고 ...", // 의견 본문 (truncate 없이 통째 보존)
      "rationale": "왜냐하면 ..."     // 근거
    }
  ]
}

// step 2.5 — 일괄 동의 투표
{
  "name": "Claude",
  "label": "claude_1",
  "quick_votes": [
    { "target_id": "ITEM_001", "vote": "agree" },
    { "target_id": "ITEM_002", "vote": "oppose", "comment": "Y 안은 비용 큼" }
  ]
}

// step 3 — 자유 토론 (한 턴에 vote + 새 의견 동시 가능)
{
  "name": "Claude",
  "label": "claude_2",
  "votes": [
    { "target_id": "ITEM_002", "vote": "agree" },
    { "target_id": "ITEM_002_01", "vote": "oppose" }
  ],
  "additions": [
    {
      "parent_id": "ITEM_002",
      "kind": "revise",            // revise / block / addition
      "title": "Y'' 하자",
      "content": "...",
      "rationale": "..."
    }
  ]
}
```

---

## 부서 매트릭스 (R12-C2 결정)

| 부서 | 한국어 라벨 | 흐름 | chain 위치 |
|------|------------|------|-----------|
| 아이디어 | 아이디어 | D-B-Light + USER_PICK (사용자 카드 선택 + 자유 코멘트) | 표준 chain 시작 |
| 기획 | 기획 | 풀세트 (1~5) | 표준 (chain hub) |
| 디자인 | 디자인 | **7 단계** — 와이어프레임 회의 (5 단계) + 디자인 회의 (2 단계). Playwright PNG (desktop 1280x720 + mobile 375x812) | 표준 |
| 구현 | 구현 | R12-C2 = simple 1 명 (회의 X). **R12-W = 분담 + tier system + worktree 분할** (별 phase) | 표준 |
| **리뷰** | 리뷰 (라벨 정정) | 풀세트 — 주관 평가 / 개선 제안. **두 entry**: (a) 사용자 명시 호출 (할 일 entry 부서 라디오 = 리뷰) (b) 검토 부서 인계 결재 모달 안 *"+리뷰 부서도 시작"* 체크박스 — auto 인계 시 Notification 등장 | **chain 외** |
| **검토** | 검토 (신규 부서, 옛 verify 흡수) | 풀세트 — 객관 + 목적 통합 (하드코딩 / 메모리 누수 / 보안 + spec 의도 부합 / 누락 / 추가 감지) | 표준 chain 끝 강제 |
| 일반 | 일반 (잡담) | **`[##]` 강제** — 메시지 안에 `[##본문]` 으로 감싸야만 의견 카드 등록. 그 외 메시지는 일반 채팅 (자동 의견 등록 X). 동의/반대 카운터 + 사용자 동의/반대 가능 | — |

*verify 부서 통째 폐기* — 검토 (audit) 가 객관 + 목적 통합 책임.

### 디자인 7 단계 흐름 (사용자 검토 OK)

```
[와이어프레임 단계 — 5 단계]
1. 시스템 → UX 직원에게 "기획서 받고 와이어프레임 작성" 지시
2. UX → 와이어프레임 (구조도) 작성
3. 시스템 → 그 와이어프레임을 *의견 #1* 로 회의에 등록 (SsmBox 카드)
4. UI + UX 직원이 풀세트 회의 (의견 + 투표 + 자유 토론)
5. 합의 시 → 시스템이 UI 직원에게 "합의 결과대로 와이어프레임 수정" 지시

[디자인 단계 — 2 단계]
6. 시스템 → UI 직원에게 "수정된 와이어프레임 받고 디자인 (HTML/CSS) 만들기" 지시
7. UI 디자인 → 의견 #2 로 회의 등록 → 풀세트 회의 → 합의 → 설정에 따라
   사용자 호출 / 기획 인계
```

결과물 = HTML / CSS + Playwright PNG 두 viewport.

---

## 의견 ID — 저장 vs 화면 표시 분리 (Q-A 결정)

| 영역 | 형식 |
|------|------|
| DB 저장 | `id` (UUID) + `parent_id` (UUID 또는 NULL) — 단순 |
| 화면 표시 | 시스템이 parent chain 따라 가공 — `ITEM_001` / `ITEM_001_01` / `ITEM_001_01_01` |

깊이 무제한 / 디폴트 cap = 3.

## 회의 단위 발화 ID 카운터 (Q-B 결정)

- 한 회의 안에서 직원 (provider) 별 카운터: `codex_1` → `codex_2` → ...
- 회의 끝나면 리셋. 다음 회의에서 다시 `codex_1` 부터.
- DB 안에 `author_label` 컬럼 (회의 단위 카운터 결과) 저장.

---

## R12-C2 phase 분할 (P1~P8)

### P1 — spec 갱신 round (게이트, 모든 후속 phase 의 토대)

**무엇을:** 회의 진행 재설계 결정사항 + 부서 매트릭스 변경 + 저장 schema 를 spec 문서에 정식화. 코드 변경 X.

**사용자가 보는 결과:** 변경 X (spec 문서만 갱신).

**핵심 산출:**
- spec §3 부서 카탈로그 (verify 폐기 / 검토 신규 / 리뷰 라벨 정정)
- spec §4 부서별 회의 매트릭스 (디자인 7 단계 / 구현 단계적 / 일반 [##] 강제)
- spec §5 D-B 흐름 (의견 트리 ITEM_NNN_NN_NN + 일괄 투표 + 자유 토론 + 모더레이터 회의록 [합의]+[제외])
- spec §11.x 신규 (SsmBox 부서별 layout / channels.max_rounds / providers.capability_tier R12-W ALTER 명시 / 부서 lock 사이클 보강 / 변경 요청 분기)
- JSON schema 명시 (의견 제시 / 일괄 투표 / 자유 토론 응답 — 위 양식 그대로)
- P2~P8 의 sub-task 정식 분할

**의존:** 없음 (게이트). 메모리 `rolestra-r12-meeting-system-redesign-2026-05-03.md` + 본 plan 의 결정사항이 입력.

---

### P1.5 — 일반 채널 회귀 차단 (별 task, P1 spec round 와 병렬 가능)

**무엇을:** 일반 채널 메시지가 *모두 의견 카드로 자동 등록* 되는 회귀 차단. `[##본문]` 으로 감싸야만 의견 카드 등록 + 그 외 메시지는 일반 채팅.

**사용자가 보는 결과:**
- 일반 채널에 "오늘 점심 뭐 먹지?" 같은 메시지 → 의견 카드 등록 X (일반 채팅으로만 표시)
- "[##너네는 요즘 게임 시장이 죽었다고 봐?] 어때?" → 채팅 메시지 그대로 보존 + `[##]` 본문이 의견 카드로 등록

**핵심 산출:**
- 일반 채널 메시지 entry point 의 자동 의견 등록 코드 차단 (UI / IPC 양쪽)
- `[##]` 파서 미land 시점이지만 *자동 등록만 차단* — 본격 [##] 파서 + 의견 게시 모달은 P4 안에서 land

**의존:** 없음. P1 spec round 와 *병렬 가능* (회귀 차단은 spec 결정 영향 X).

**왜 별 task:** 사용자 dogfooding 시 일반 채널이 거슬리지 않게 *우선 차단*. 본격 일반 채널 [##] 흐름 (P4) 까지 기다리지 않음.

---

### P2 — 회의 기능 (backend 본체)

**무엇을:** 회의 진행의 새 모델 (의견 트리 + 일괄 투표 + 자유 토론 + 모더레이터 회의록) 의 backend service 본체. *부서별 분기 X — 모든 부서가 공유하는 토대*.

**사용자가 보는 결과:**
- 부서 채널의 *할 일 큐* 에 일을 적으면 → 시스템이 그 부서로 회의 자동 시작
- 회의 진행이 새 모델 따라: 의견 제시 (카드 형식 + `codex_1` 발화 ID) → 일괄 동의 투표 → 자유 토론 → 모더레이터 회의록 ([합의] + [제외])
- 회의록 = 채팅 안에 *상세 설명 카드* 로 표시. 사용자는 회의록 보고 자연스럽게 다음 작업

**핵심 산출:**
- DB migration 019 — opinion 테이블 (id UUID + parent_id + kind + author_provider_id + author_label + title + content + rationale + status + exclusion_reason + round + created_at) + opinion_vote 테이블
- `OpinionService` (main backend) — gather / tally / quickVote / freeDiscussionRound
- `MeetingMinutesService` — 모더레이터 호출 (R12-S MeetingSummaryService + getResolvedSummaryModel 활용) + truncate 금지 prompt 강제 + [합의] + [제외] 두 섹션 정식화
- `MeetingOrchestrator` 새 모델 재배선 (12 단계 SSM 폐기)
- *T10 의 옛 ProjectEntryView reverted 의 재구현* — 할 일 큐 textarea → 부서 회의 자동 트리거 + 부서 채널 입력란 enable 분기 wire (T11 disabled 토대 위)
- 회의록 chat block (Card primitive 활용 + themeKey 따라 변형 + truncate X)

**의존:** P1 spec land 후.

**병렬 가능:** P3 의 SsmBox 골격 + P4 일부.

---

### P3 — 부서 워크플로우 + 채팅창 카드 + SsmBox 부서별 화면

**무엇을:** P2 backend 위에 *부서별 회의 화면* + 부서별 흐름 분기. 검토 / 리뷰 분리 + verify 폐기 적용. **채팅창 카드 + SsmBox 카드 둘 다 land**.

**사용자가 보는 결과:**
- *아이디어 부서* — 직원들이 의견을 *채팅창에 카드 형식 메시지* 로 발화. ssmbox 우측에도 카드 list 누적. 카드 안 [선택 / 취소] 버튼으로 사용자 카드 선택 + 자유 코멘트 → 기획 부서 인계
- *기획 부서* — 풀세트 회의 (의견 + 투표 + 모더레이터 회의록)
- *디자인 부서* — 와이어프레임 회의 (5 단계) → 합의 → UI 디자인 회의 (2 단계) → 합의 → Playwright PNG 미리보기 (desktop / mobile)
- *리뷰 부서* (chain 외, 두 entry) — (a) 사용자 명시 호출 (b) 검토 인계 결재 모달 안 체크박스 / Notification (auto 인계 시)
- *검토 부서* (chain 끝 강제) — 객관 + 목적 통합. NG 시 기획 부서 자동 인계
- 우측 패널 SsmBox = 부서별 다른 layout (의견 카드 list / 트리 + 진행도 / 디자인 시안 미리보기)

**핵심 산출:**
- `MessageRenderer` 의 *카드 variant* 추가 — opinion kind 메시지면 Card primitive (themeKey 따라 변형) 로 렌더. 본문 truncate X. [선택/취소] 액션 버튼 noinline
- `idea-workflow.ts` (D-B-Light + USER_PICK) + IdeaCardList (SsmBox 우측)
- `design-workflow.ts` (와이어프레임 5 + 디자인 2) + Playwright snapshot service (HTML/CSS → off-screen Chromium → PNG, PathGuard 봉인)
- `review-workflow.ts` (리뷰 부서, chain 외) + 두 entry wire
- `audit-workflow.ts` (검토 부서, chain 끝)
- SsmBox 부서별 variant 5 종

**의존:** P2 backend land 후. P1 spec 의 부서 매트릭스 정식화 필수.

---

### P4 — 일반 채널 [##] 본격 흐름 (P1.5 회귀 차단 위에)

**무엇을:** P1.5 회귀 차단 위에 본격 [##] 파서 + 의견 게시 모달 + SsmBox 카드 누적 list.

**사용자가 보는 결과:**
- 일반 채널 메시지에 `[##본문]` 감싸면 → 채팅 메시지 그대로 보존 + 본문이 *우측 SsmBox 카드* 등록 + 직원들이 동의/반대 카운터 + 자유 응답
- 한 메시지에 `[##]` 여러 개 가능 — 각각 별 카드
- *의견 게시* 버튼 (별 entry) 도 지원 — 사용자가 모달에서 본문 + 제목 입력
- 사용자도 동의 / 반대 가능
- 합의 / 회의록 / 인계 X — 잡담의 정체성 유지

**핵심 산출:**
- 일반 채널 메시지 [##본문] 파서 (opinion kind = 'self-raised' / 'user-raised')
- 일반 채널용 SsmBox variant (카드 누적 list + 동의/반대 카운터 + 사용자 동의/반대 버튼)
- 일반 채널 별 entry button + 의견 게시 모달

**의존:** P2 backend (opinion 테이블) + P1.5 회귀 차단. P3 와 *독립* — 병렬 가능.

---

### P5 — 구현 부서 (simple 1 명) + 검증 인계

**무엇을:** 구현 부서 designated 1 명 spec 받아 작성 + ExecutionService dryRun + 사용자 승인 + atomic apply. 그 후 검토 부서 자동 인계 (chain 끝). 검토 NG 시 기획 부서로 자동 인계.

**사용자가 보는 결과:**
- 구현 부서에 작업 인계되면 → 부서장 핀 또는 디폴트 알고리즘으로 1 명 designated
- designated 직원이 spec 받아 코드 작성 → 변경 미리보기 (dryRun) → 사용자 승인 → 적용
- 적용 후 검토 부서 자동 인계 → 검토 회의 → OK 시 사용자 승인 게이트 / NG 시 기획 부서 자동 인계

**핵심 산출:**
- `implement-workflow.ts` (designated 1 명 simple)
- `designated-worker-resolver.ts` (부서장 핀 우선 / drag_order 1 번 / fallback)
- 검증 NG → 기획 인계 분기 (audit-workflow 결과 = NG 시 기획 부서 회의 자동 시작)

**의존:** P3 (audit-workflow + 부서 workflow 골격) 후.

**범위 제한:** R12-C2 = simple 1 명. **분담 + tier system + worktree 분할 = R12-W 별 phase**.

---

### P6 — 인계 기능

**무엇을:** 부서 ↔ 부서 인계 흐름 정식화. 인계 모달 + auto/check 분기 + 부서 lock 사이클 + 변경 요청 분기 + 리뷰 부서 두 entry wire.

**사용자가 보는 결과:**
- 부서 회의 종결 시 → 다음 부서로 인계할지 결정. handoff_mode 따라:
  - `auto` — 자동 인계 (사용자 개입 X). 단 검토 → 인계 시 *Notification* 등장 ("리뷰 부서 진행할까요?")
  - `check` — *인계 결재 모달* (회의록 미리보기 + 다음 부서 + 인계 사유 + 확인 버튼). **검토 → 기획 인계 시 모달 안 *"+리뷰 부서도 시작"* 체크박스**
- 부서가 *작업 중* (lock) 일 때 새 일 = *대기 큐* 자동 진입 + UI "회의 종료 후 시작"
- 작업 중 변경 요청 시 → 모달에서 규모 선택 (작은 / 중간 / 큰)

**핵심 산출:**
- `HandoffApprovalModal` (kind 별 미리보기 + 리뷰 체크박스)
- `HandoffModeToggle` (채널 설정 + 사이드바)
- 검토 → 리뷰 *Notification* (auto 인계 시)
- 부서 lock 매트릭스 + 대기 큐 (정리 #7 §11.12 위에 frontend land)
- 변경 요청 모달 (3 분기)
- 외부 수정 감지 (인계 직전 mtime 가드) — *R12-H 보류*

**의존:** P3 + P5 후.

---

### P7 — 편의 기능 (사용자 우선순위)

**무엇을:** R12-C 1차 dogfooding + R12-C2 결정으로 모인 편의 surface 들. **사용자 명시 우선순위 따라 진행** — 시급 / 자주 사용 / 없으면 작업 막힘 순서.

**우선순위 (사용자 결정, 2026-05-04):**

```
1. 프로젝트 삭제 (가장 시급)
   - 프로젝트 대시보드 상단 삭제 버튼 1 개
   - 사이드바 프로젝트 row 옆 X 버튼
   - 둘 다 누르면 → 모달 [보관 / 영구삭제 / 취소] 3 버튼
   - 보관 = list 에서 숨김 + 데이터 보존 + 보관함 메뉴에서 복구 가능
   - 영구삭제 = DB row + 회의록 + 채널 + 메시지 + 파일 모두 영구 삭제

2. 부서장 핀 (구현 부서 작동 의존)
   - StaffEditModal 안 직원에 핀 토글
   - providers.is_department_head 컬럼 (migration 020)
   - designated-worker-resolver 가 핀 우선 사용

3. 멤버 발화 순서 드래그
   - dnd-kit ChannelMemberOrderPanel
   - 드래그 결과 = channel_members.drag_order 영구 보관 (R12-C T1 시점 컬럼 이미 land)
   - 드래그 1 번 = designated worker fallback

4. 스킬 질문 시스템 (제일 마지막 — 없어도 시스템 정상 작동)
   - 시스템 (LLM 호출 X 일반 코드) 이 SKILL.md / 다른 자료에서 정보 추출 + 취합
     → 정리된 문서를 직원에게 prompt 로 전달
   - 직원이 직접 SKILL.md 읽는 대신 *시스템이 가공한 정리 문서* 만 받음
   - Agestra 참고 — P7 진입 시 짧은 design round 후 land

5. 프로젝트 대시보드 layout (별 design round 작은 사이클 후 land)
   - 프로젝트 헤더 클릭 시 메신저 X / 그 프로젝트 대시보드 진입
   - 위젯 5 종 (active 회의 / 부서별 진행도 / 큐 상태 / 멤버 상태 / 최근 회의록)
   - 사용자 + 디자인 시안 짧은 토론 라운드 후 layout 결정
```

**의존:** P3 (멤버 패널 안정) 후.

**별도 design round 필요:** *프로젝트 대시보드* + *스킬 질문 시스템* 둘 모두 — P7 진입 시 짧은 사용자 + 디자인 라운드.

---

### P8 — closeout

**무엇을:** R12-C2 종결 commit + main fast-forward merge + 새 phase 진입 준비.

**사용자가 보는 결과:** 변경 X (문서만).

**핵심 산출:**
- `tasks.json` sync (P1~P7 모두 completed)
- `docs/구현-현황.md` R12-C2 행 추가 (한글, 사무실 메타포)
- `docs/아키텍처-결정-기록/r12-c2-meeting-redesign.md` ADR (회의 진행 재설계 + 부서 매트릭스 + 인계 흐름 + 편의 surface 통째)
- main fast-forward merge + worktree 정리
- 다음 phase (R12-W = implement 분담 / R12-H = 인계 본격 + 외부 수정 감지) 진입 준비

**의존:** P1~P7 모두 land 후.

---

## phase 의존 그래프

```
P1 (spec round, 게이트)        P1.5 (회귀 차단, 병렬)
 │                                │
 ├─► P2 (회의 backend) ◄──────────┘
 │    │
 │    ├─► P3 (부서 workflow + 채팅창 카드)
 │    │    │
 │    │    ├─► P5 (구현 + 검증)
 │    │    │    │
 │    │    │    └─► P6 (인계)
 │    │    │         │
 │    │    │         └─► P7 (편의 — 우선순위 정렬)
 │    │    │              │
 │    │    │              └─► P8 (closeout)
 │    │    └─► P7 (멤버 패널 안정)
 │    │
 │    └─► P4 (일반 채널 [##] 본격)  ※ P3 와 독립, 병렬 가능
```

병렬 가능:
- P1 + P1.5 (회귀 차단은 spec 결정 영향 X)
- P3 + P4 (둘 다 P2 후)

---

## R12-C2 외 (별 phase)

| Phase | 무엇 | 시점 |
|-------|------|------|
| R12-D | 옵션 부서 (캐릭터 / 배경) UI propagate | R12-C2 후 (사용자 결정 시) |
| R12-W | 구현 부서 분담 + tier system (frontier/mid/local) + worktree 분할 + 부서장 + 머지 + 충돌 승인 | R12-C2 후 |
| R12-H | 외부 수정 감지 (인계 직전 mtime 가드) + 인계 chain 본격 (사용자 vision 4 phase 묶음의 마지막) | R12-C2 + R12-W 후 |
| R13 | multi-worker 분산 + 더 본격 자동화 | R12-W + R12-H 후 |
| R12+ | DM 읽음 / 작성 중 indicator + 통합 ergonomics | 별 사이클 |

---

## 검증 게이트

각 phase 종결 시 (closeout 전):
- vitest 전체 PASS (현재 baseline 3486 / 13 skip / 0 fail 위에 누적)
- typecheck 0 error
- 사용자 dogfooding round (Windows dev 빌드 직접 실행)

P8 종결 시:
- 모든 phase 의 검증 누적
- main fast-forward merge 가능 여부 (worktree commit 깨끗)
- ADR + 구현현황 갱신
- 새 phase 진입 메모리 + MEMORY.md ⚠️ 항목 갱신

---

## 작업 환경 메모

- **worktree**: `/mnt/d/Taniar/Documents/Git/Rolestra-r12c2` (branch `feat/r12-c2-meeting-redesign`)
- **base**: `e3cdafb` (R12-C 1차 closeout, main tip)
- **node_modules**: 새 worktree 라 `npm install` 1 회 필요 (P1.5 또는 P2 진입 직전)
- **WSL ↔ Windows**: 사용자 dev 빌드 후 native binding (better-sqlite3 + rollup) win32 전환 가능 → vitest 시 `npm rebuild better-sqlite3` + `npm i --no-save @rollup/rollup-linux-x64-gnu` + `git checkout package-lock.json` 복구 절차 필요
- **메모리**: `rolestra-r12-meeting-system-redesign-2026-05-03.md` + 본 plan = P1 spec round 의 *입력*. 결정사항 정식화 시 그 메모리 + plan 모든 항목 spec 에 반영 후 메모리 갱신
