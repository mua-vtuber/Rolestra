# Rolestra v3 — Phase R12-C2 계획서

> Round 1: 2026-05-04 / worktree `/mnt/d/Taniar/Documents/Git/Rolestra-r12c2` (branch `feat/r12-c2-meeting-redesign`, base `e3cdafb`) — **종결 + main land 완료** (`5472bef` ff merge / main tip `8e6a602`)
> Round 2: 2026-05-05 / worktree `/mnt/d/Taniar/Documents/Git/Rolestra-r12c2-r2` (branch `feat/r12-c2-redesign-r2`, base `8e6a602`) — **진행 중**

R12-C 1차 종결 (사이드바 통합 + 부서별 회의실 + Skill 자동 배치 + 멤버 패널 정확화) + R12-C2 Round 1 (T0~T10b) main land 위에서 — *참고 프로젝트 (Symphony 운영 / oa-py 실행 / alex-core invariant) 의 8 후보 (A~H)* 를 Round 2 안에 흡수하는 단계. R12-C 1차 ADR D9 + R12-C2 ADR `r12-c2-reference-projects-absorb.md` 의 4 결정 (R1 / B1 / H1+H2 / F2) 따라 R1 sub-task 재분해.

---

## Round 2 = 8 후보 흡수 (개요)

Round 1 (T0~T10b) land 자산 (옛 12 단계 SSM 폐기 / OpinionService backend / MeetingMinutesService / migration 019 = opinion + opinion_vote + max_rounds / spec §3 §4 §5 §11.13~§11.18) 위에서 — 참고 프로젝트 8 후보를 *반영 단계 단위* (기반 → 시스템 → 화면 → 인계) 로 P2~P8 에 분포.

| 후보 | 무엇 (사무실 메타포) | 진입 phase | 핵심 sub-task ID |
|------|------------------|-----------|----------------|
| **A** | 진행 일지 (RunStep 영속 기록부) | P2 (기반) + 모든 phase 영속 | T12 + 분산 |
| **B** | 다음 동작 카드 (NextStep 7 종 분류 + B1 안전 카드만 자동) | P2 (기반) + P6 (handoff_mode 우회 wire) | T13 + T28 |
| **C** | 현장 배치판 (큐 운영 시스템) | P6 (디자인 라운드 + land) | T31 + T32 |
| **D** | 의미 단위 알림 (situation cards) | P6 (검토 → 리뷰 + 다른 카테고리) | T30 + T34 |
| **E** | 임무 카드 (capability manifest) | P5 (designated worker schema) | T23 |
| **F** | 6 헌법 감사관 (검사관 catalog, F2 단계적 fail-closed) | P2 (phase 1 report-only) + P7 (phase 2) | T11 + T41 |
| **G** | 외주 의뢰서 (handoff_dispatch payload 정형화) | P6 (인계 backend) | T27 |
| **H1** | 대시보드 진행률 (합계 surface) | P7 (대시보드 layout 라운드 + land) | T39 + T40 |
| **H2** | 받는 부서 첫 화면 (인계 패키지 surface) | P6 (HandoffApprovalModal 후) | T29 |

**진입 우선순위 (ADR D8 그대로)**:
1. **F (T11)** — 즉시 시작. 다른 후보의 평가 기준 + report-only 라 부담 작음 + Round 1 정리와 병행 안전.
2. **A (T12)** — F 직후. B/F/H 의 데이터 source. P2 backend 와 함께 land.
3. **B (T13) + E (T23) + G (T27)** — 부서 회의 흐름 sub-task 와 함께.
4. **H (T29 + T40)** — D-B 흐름 P6~P7 안에서 인계 정리 + 진행률.
5. **C (T31~T32)** — 큐 surface 디자인 라운드 후 land.
6. **D (T30 + T34)** — A 위에 additive (Notification 확장).

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

## R12-C2 phase 분할 (P1~P8) — Round 2 갱신

### P1 + P1.5 — Round 1 종결 (history reference)

R12-C2 Round 1 (2026-05-04) 에서 모두 land 됨. 자세한 결정 + commit SHA 는 본 plan 의 *§ Round 1 land 결과 history* + ADR `r12-c2-reference-projects-absorb.md` D7 reference.

| Sub-task | 내용 | Status | Commit |
|----------|------|--------|--------|
| T0 | P1.5 일반 채널 회귀 차단 + dogfooding 3 round | ✅ 완료 | `42d9780` + 3 follow-up |
| T1 | P1.1 spec §3 부서 카탈로그 (verify 폐기 / 검토 신규 / 리뷰 라벨) | ✅ 완료 | `e082882` |
| T2 | P1.2 spec §4 부서별 회의 매트릭스 + 디자인 7 단계 + 일반 [##] | ✅ 완료 | `6628abb` |
| T3 | P1.3 spec §5 D-B 흐름 (의견 트리 + 일괄 투표 + 모더레이터 회의록) | ✅ 완료 | `f46b206` |
| T4 | P1.4 spec §11.13~§11.18 신규 (SsmBox / max_rounds / 부서 lock) | ✅ 완료 | `767d310` |
| T5 | P1.5 spec JSON schema 4 종 정식 | ✅ 완료 | `35de0e7` |
| T6 | P1.6 P2~P8 sub-task 정식 분할 | ✅ 완료 | `420ec9a` |

---

### P2 — 회의 기능 본체 + 기반층 (Round 1 일부 land + Round 2 마무리)

**Round 1 land 자산 (보존)**:

| Sub-task | 내용 | Status | Commit |
|----------|------|--------|--------|
| T7 | P2-1 migration 019 (opinion + opinion_vote + max_rounds) | ✅ 완료 | `62533be` |
| T8 | P2-2 OpinionService backend (gather / tally / quickVote / freeDiscussionRound + IPC 4 channel) | ✅ 완료 | `013f690` |
| T9 | P2-3 MeetingMinutesService (모더레이터 호출 + truncate 검출 + atomic write) | ✅ 완료 | `4b3a9ef` |
| T10a | P2-4a MeetingOrchestrator 새 backend skeleton + 새 IPC | ✅ 완료 | `d4823e0` |
| T10b | P2-4b 옛 SSM + consensus_decision approval + voting-history 통째 정리 | ✅ 완료 | `a171c01` |

→ T10c (e2e + closeout) **폐기** — Round 2 R1 분해 (T11~T13) 에 흡수.

**Round 2 새 sub-task — 기반층 + Orchestrator wire**:

#### T11 — F. 검사관 catalog phase 1 (report-only, 12 카테고리 통째)

**무엇을 (사무실 메타포):** 사무실 규칙 6 가지 (SSoT / SoC / Consistency / Atomicity / Idempotency / NoSilentFallback) 를 *감사관* 12 명이 각자 한 카테고리씩 검사. phase 1 = 보고서만 작성, 빌드 차단 X.

**사용자가 보는 결과:**
- 변경 X (도구 추가만). `npm run inspect` 실행 시 위반 list 보고서 생성.

**핵심 산출:**
- 검사관 룰 12 카테고리 통째 작성 (안전 7 + 비안전 5):
  - 안전: secrets-plaintext / exec-shell-string / mig-non-idempotent / mig-non-forward-only / ipc-untyped-invoke / approval-bypass / path-guard-bypass
  - 비안전: ui-string-hardcoded / mock-fixture-import / magic-number / duplicate-constant / unused-export
- 위치: `tools/inspectors/<category>.ts` (룰 본체) + `tools/inspectors/run.ts` (실행 엔트리)
- 명령: `npm run inspect` (전체) + `npm run inspect:safety` (안전 7)
- 출력: `tools/inspectors/report.json` (위반 list + 위치 + severity, gitignore + CI artifact 만)
- CI hook:
  - **pre-commit**: 변경 파일 한정 inspector 실행 (빠른 피드백)
  - **pre-push**: 전체 inspector 실행 (report-only — 빌드 차단 X)
- spec reference: §11.20

**의존:** Round 1 T10b land 후. **A (T12) / B (T13) 의 *진입 전*** — 검사관이 다른 후보의 평가 기준이라 가장 먼저.

[후보 F]

#### T12 — A. migration 020 + RunStepService skeleton

**무엇을 (사무실 메타포):** 회의 안 *모든 turn 의 진행 일지* 를 적어두는 캐비닛 (`run_step` 테이블) 설치 + 일지 적는 직원 (RunStepService) 채용.

**사용자가 보는 결과:**
- 변경 X (DB 캐비닛 + 서비스 추가만). 다음 sub-task 부터 일지가 *영속* — 회의 끝나도 보존.

**핵심 산출:**
- migration 020 — `run_step` 테이블:
  - id (UUID) / meeting_id / channel_id / round / turn_index / actor_kind / actor_id / step_kind / input_json / output_json / next_step_card / side_effect_summary / duration_ms / created_at
  - step_kind enum: opinion_gather / opinion_tally / quick_vote / free_discussion / minutes_compose / next_step_classify / handoff_dispatch / tool_invoke / approval_request / inspector_check
  - 인덱스: (meeting_id, turn_index), (channel_id, created_at)
- `src/main/meetings/run-step/run-step-service.ts` — append-only + atomic write + truncate 금지 + transaction 묶음
- IPC `meeting:list-run-steps` (디버깅 / replay 용 — dev 전용)
- spec reference: §11.19

**의존:** T11 land 후. T11 의 mig-non-forward-only 검사관이 020 통과 검증.

[후보 A]

#### T13 — B. NextStep classifier + Orchestrator wire (RunStep 영속 포함)

**무엇을 (사무실 메타포):** 직원이 발언 끝나면 *다음 동작* 7 카드 중 하나로 분류하는 *분류 담당관* 채용 + 회의 진행 매니저 (MeetingOrchestrator) 가 매 turn 분류 결과 따라 진행.

**사용자가 보는 결과:**
- 회의 진행 중 직원 발언 후 다음 동작이 *명시* 됨:
  - 「계속 발언」 / 「대기」 = 자동 진행 (사용자 확인 X)
  - 「결재」 / 「도구」 / 「인계」 / 「회의록 정리」 / 「회의 종료」 = 사용자 확인 모달 등장
- 모든 turn 의 분류 결과는 진행 일지에 기록 (T12 RunStep 영속)

**핵심 산출:**
- `src/main/meetings/engine/next-step-classifier.ts` — 7 카드 분류기 (NextStepCard discriminated union):
  - kind: 'continue' | 'wait' | 'approve' | 'tool' | 'handoff' | 'minutes' | 'end'
  - 분류 규칙 7 우선순위 (spec §11.18.8b 그대로)
  - fall-through fallback = 'wait' (안전군)
- `MeetingOrchestrator` 새 모델 wire (Round 1 T10a/b skeleton 위에):
  - 매 turn 후 분류기 호출 → RunStepService 영속 (`step_kind='next_step_classify'`) → 안전군 자동 진행 / 결과 전파군 사용자 확인 모달
  - 분류 결과 stream IPC → renderer 가 모달 표시
- 「인계」 카드의 handoff_mode 우회 룰은 **T28** 에서 wire (HandoffApprovalModal 와 함께)
- maxRounds cap 인터락 land (cap 도달 시 「계속 발언」 → 「회의 종료」 강제 override)
- spec reference: §11.18.8

**의존:** T11 + T12 land 후.

[후보 B + A]

---

### P3 — 부서 워크플로우 + 채팅창 카드 + SsmBox 부서별

#### T14 — MessageRenderer 카드 variant + 채팅창 카드

**무엇을 (사무실 메타포):** 회의 안 의견 발화는 *카드 모양* 메시지로 표시. 일반 채팅과 시각 구분.

**사용자가 보는 결과:**
- 의견 발화 = 채팅창 안 *카드* (Card primitive, themeKey 따라 변형)
- 본문 truncate X (잘리지 말고 통째)
- 카드 헤더 = 발화 ID (`codex_1`) + 의견 트리 ID (`ITEM_001_01`)
- 카드 안 액션 버튼 (kind 별 — 동의/반대/선택/취소)

**핵심 산출:**
- `MessageRenderer` 의 카드 variant — opinion kind 메시지면 Card primitive 렌더
- DM / 일반 채널 / 부서 채널 모두 같은 Card primitive 사용
- spec reference: §11.13a

**의존:** T13 land 후.

#### T15 — idea-workflow (D-B-Light + USER_PICK)

**무엇을:** 아이디어 부서 = 의견 모으기만 (step 1~2) + 사용자가 카드 선택 + 자유 코멘트 → 기획 부서 인계.

**핵심 산출:**
- `src/main/meetings/workflows/idea-workflow.ts` — D-B-Light 흐름 (step 2.5 / 3 / 4 / 5 surface X)
- IdeaCardList (SsmBox 우측) — 카드 list + 사용자 선택 체크 + 자유 코멘트 textarea + [기획 부서로 보내기] 버튼

**의존:** T13 land 후.

#### T16 — design-workflow (와이어프레임 5 + 디자인 2) + Playwright snapshot

**무엇을:** 디자인 부서 = 와이어프레임 회의 (5 단계) → UI 디자인 회의 (2 단계) → Playwright PNG 미리보기 (desktop / mobile).

**핵심 산출:**
- `src/main/meetings/workflows/design-workflow.ts` — 7 단계 흐름
- `src/main/snapshot/playwright-snapshot.ts` — HTML/CSS → off-screen Chromium → PNG (PathGuard 봉인, ArenaRoot 안 저장)
- `<DesignPreview>` — desktop 1280x720 / mobile 375x812 탭

**의존:** T13 + T14 land 후.

#### T17 — review-workflow + audit-workflow

**무엇을:** 리뷰 부서 (chain 외, 두 entry) + 검토 부서 (chain 끝, NG 시 기획 자동 인계).

**핵심 산출:**
- `src/main/meetings/workflows/review-workflow.ts` — 사용자 명시 호출 + 검토 인계 결재 모달 안 체크박스 entry
- `src/main/meetings/workflows/audit-workflow.ts` — 객관 + 목적 통합 + NG → 기획 인계 분기 (분기 본체는 T25 에서)
- 검토 → 리뷰 자동 인계 시 Notification 발송 (T30 wire)

**의존:** T13 + T14 land 후.

#### T18 — SsmBox 부서별 5 variant 통합

**무엇을:** 부서별 SsmBox layout 5 variant (idea / planning / design / implement / general) 을 단일 컴포넌트 안 분기.

**핵심 산출:**
- `src/renderer/features/messenger/SsmBox/index.tsx` — channelId props 하나만 받고 channel.role 보고 variant 결정
- 5 variant 파일 분리 (같은 폴더 안)
- spec reference: §11.13

**의존:** T15 + T16 + T17 land 후.

#### T19 — 부서별 RunStep step_kind 집계 hook (H1 데이터 source)

**무엇을:** A RunStep 영속 위에 *부서별 진행률 집계* hook 추가. H1 대시보드 (T40) 의 데이터 source.

**핵심 산출:**
- `src/main/meetings/run-step/run-step-aggregator.ts` — 부서별 step_kind 분포 + 진행도 계산 (idle / in-meeting / handoff-pending / done)
- IPC `dashboard:progress-snapshot` (H1 fetch entry)
- IPC stream `dashboard:progress-changed` (RunStep 새 row 작성 시 push)

**의존:** T12 + T18 land 후.

[후보 A → H 데이터 source]

---

### P4 — 일반 채널 [##] 본격 흐름

#### T20 — [##] 파서 + 의견 게시 모달

**무엇을:** 일반 채널 메시지에 `[##본문]` 감싸면 의견 카드 등록 + 별 entry 모달도 제공.

**핵심 산출:**
- `src/shared/parsers/double-hash-parser.ts` — `[##본문]` 검출 + opinion kind 분기 (self-raised / user-raised)
- 일반 채널 별 entry button + 의견 게시 모달 (제목 + 본문 입력)

**의존:** T13 + T14 land 후.

#### T21 — 일반 SsmBox final variant

**무엇을:** 일반 채널용 SsmBox layout — 카드 누적 list + 가벼운 동의/반대 카운터 + 사용자 동의/반대 버튼 + 합의/회의록/인계 surface X.

**핵심 산출:**
- T18 의 general variant 본체 완성 (T18 에서는 골격만, T21 에서 카운터 + 사용자 버튼 land)
- spec reference: §11.13 general row

**의존:** T20 land 후.

#### T22 — 일반 채널 RunStep 분기

**무엇을:** 일반 채널 = 회의 X 라 step_kind 분포 다름. RunStepService 가 일반 채널 메시지도 영속 (step_kind='opinion_gather' + actor_kind='employee'/'user').

**핵심 산출:**
- RunStepService 의 일반 채널 분기 — meeting_id NULL 허용 (회의 외 발화 영속)
- T19 aggregator 가 일반 채널 카드 카운트 → 대시보드 위젯 ("일반 — 잡담 카드 12" 표시)

**의존:** T12 + T19 + T20 land 후.

[후보 A]

---

### P5 — 구현 부서 (simple 1 명) + 검증 인계

#### T23 — E. 임무 카드 schema + designated-worker-resolver

**무엇을 (사무실 메타포):** 구현 부서가 받는 *작업 단위 = 임무 카드*. capability manifest 형식. 누가 그 임무 받을지 (designated worker) 결정 알고리즘.

**핵심 산출:**
- `src/shared/schema/mission-card.ts` — MissionCard discriminated union:
  - kind: 'spec' (의견 + 기획서) | 'fix' (audit NG 보고) | 'change-request' (변경 요청)
  - payload: 작업 본문 + 입력 파일 list + 출력 기대치
  - assigned_provider_id: designated worker
- `src/main/meetings/designated-worker-resolver.ts` — 부서장 핀 우선 → drag_order 1 번 → fallback (자율 모드 default 직원)

**의존:** T13 + T17 land 후.

[후보 E]

#### T24 — implement-workflow (simple 1 명)

**무엇을:** 구현 부서 designated 1 명 임무 카드 받아 코드 작성 → ExecutionService dryRun → 사용자 승인 → atomic apply.

**핵심 산출:**
- `src/main/meetings/workflows/implement-workflow.ts` — designated worker 1 명 spec 받아 작성 + dryRun + apply
- 분담 / tier system / worktree 분할 = R12-W 별 phase (R12-C2 안 X)

**의존:** T23 land 후.

#### T25 — audit NG → 기획 인계 분기

**무엇을:** 검토 부서 (audit) 가 NG 판정하면 기획 부서로 자동 인계 → 기획 회의 자동 시작.

**핵심 산출:**
- audit-workflow 결과 = NG 시 handoff_dispatch row 생성 (target = 기획 채널)
- 자동 회의 트리거 (T24 land 후 P6 의 G handoff backend 와 함께 wire)

**의존:** T17 + T24 land 후.

#### T26 — ExecutionService dryRun 의 RunStep 영속

**무엇을:** ExecutionService 의 dryRun / apply / rollback 모든 step 을 RunStep 에 영속 (`step_kind='tool_invoke'`).

**핵심 산출:**
- ExecutionService hook — 각 step 시점에 RunStepService 호출
- side_effect_summary 1-line 작성 ("파일 X 작성 (3 lines)" / "명령 Y 실행 (exit 0)")

**의존:** T12 + T24 land 후.

[후보 A — ExecutionService 영속]

---

### P6 — 인계 + 큐 + 알림 (디자인 라운드 포함)

#### T27 — G. 외주 의뢰서 schema + handoff_dispatch 테이블 (migration 021)

**무엇을 (사무실 메타포):** 부서 → 부서 인계 시 *정형 외주 의뢰서*. handoff_dispatch 테이블 + 의뢰서 schema 정식화.

**핵심 산출:**
- migration 021 — `handoff_dispatch` 테이블:
  - id (UUID) / meeting_id (보낸 회의) / from_channel_id / to_channel_id / reason / minutes_id (회의록 reference) / mission_card_json (임무 카드 본문) / mode ('auto' | 'check') / dispatched_at / opened_at (받는 부서 첫 진입 시점) / created_at
- `src/shared/schema/handoff-package.ts` — HandoffPackage 정식 schema (외주 의뢰서)
  - sender / minutes (통째) / reason / next_actions[] / mission_card
- HandoffDispatchService — dispatch / open / track

**의존:** T11 + T12 + T17 + T26 land 후.

[후보 G]

#### T28 — HandoffApprovalModal + B handoff_mode 우회 룰 wire

**무엇을:** 「인계」 카드 발생 → 받는 부서 channel.handoff_mode 따라 모달 / 자동 분기 wire.

**핵심 산출:**
- `HandoffApprovalModal` — kind 별 미리보기 + 회의록 통째 + 인계 사유 + [확인 / 취소]
  - 검토 → 기획 인계 시 *"+리뷰 부서도 시작"* 체크박스
- `HandoffModeToggle` (채널 설정 모달 + 사이드바 channel row 우측 ⚙)
- T13 의 NextStep classifier 가 「인계」 카드 발행 → handoff_mode 분기 wire:
  - check (디폴트) = 모달 등장
  - auto (부서별 명시) = 자동 진행 + Notification 만 (모달 X)
- spec reference: §11.18.8c

**의존:** T13 + T27 land 후.

[후보 B + G]

#### T29 — H2. 받는 부서 첫 화면 인계 패키지

**무엇을 (사무실 메타포):** 인계 받은 부서 채널 *첫 진입* 시 외주 의뢰서를 *맨 위* 카드로 표시. 회의록 + 인계 사유 + 받는 부서 작업 list + [의견 모아 회의 시작] 버튼.

**핵심 산출:**
- `<HandoffPackageCard>` — 받는 부서 채널 SsmBox top 영역
  - 보낸 부서 + 시각 + 인계 사유 + 회의록 미리보기 (truncate X scroll) + 받는 부서 작업 list
  - [회의록 통째 보기] → 모달
  - [의견 모아 회의 시작] → step 1 회의 자동 시작 (회의록 통째 컨텍스트로 동봉)
  - [닫기] → archive 영역으로 이동 (collapsed, 채널 헤더 [패키지 다시 보기] 버튼으로 재표시)
- 컨텍스트 주입 — 회의 시작 시 step 1 prompt 안 인계 회의록 본문 통째 + 받는 부서 작업 list
- spec reference: §11.22

**의존:** T16 (Card primitive) + T18 (SsmBox) + T28 (handoff dispatch) land 후.

[후보 H2]

#### T30 — 검토 → 리뷰 Notification (D 의미 단위 알림 #1)

**무엇을:** handoff_mode='auto' 에서 검토 → 리뷰 자동 인계 시 사용자에게 Notification 발송 ("리뷰 부서 진행할까요?").

**핵심 산출:**
- NotificationService (R10 시점 land) 위에 *알림 카테고리 1 호 = handoff-auto-review*
- 알림 클릭 시 리뷰 부서 채널 진입 + H2 패키지 카드 표시 (T29 reuse)

**의존:** T28 + T29 land 후.

[후보 D #1]

#### T31 — C 큐 surface 디자인 라운드

**무엇을 (사무실 메타포):** 현장 배치판 (큐) UI 위치 결정. 사용자 답 = 메신저 채팅창 *상단 strip* + 프로젝트 대시보드 위젯. 짧은 디자인 토론 라운드 — 시안 2~3 종 + 사용자 선택.

**핵심 산출:**
- 시안 documents (`docs/design/2026-05-x-queue-strip-options.md`):
  - 옵션 1 — 메신저 상단 *항상 보이는* strip (예: "큐: 2 / 진행: 1")
  - 옵션 2 — 메신저 상단 *접힘 가능* strip (사용자 toggle)
  - 옵션 3 — 사이드바 row (별 섹션) — 단점 명시
- 사용자 + 디자인 라운드 (Codex / Gemini / 사용자 의견) → 시안 결정
- 결정 commit + 메모리 갱신

**의존:** T29 land 후 (회의 흐름 안정화 시점).

[후보 C — 디자인 단계]

#### T32 — C 큐 운영 시스템 land (선택된 시안)

**무엇을:** T31 시안 결정 따라 큐 strip + queue_items 데이터 source wire.

**핵심 산출:**
- 메신저 상단 strip 컴포넌트 (T31 시안 따라)
- queue_items 테이블 (정리 #7 §11.12 시점 land — Round 1 자산) 데이터 source bind
- IPC `queue:list-items` + stream `queue:items-changed`
- spec reference: §11.16 부서 lock + 정리 #7 §11.12

**의존:** T31 land 후.

[후보 C]

#### T33 — 변경 요청 모달 (작은/중간/큰 분기)

**무엇을:** 부서 작업 중 변경 요청 시 규모 선택 모달 → 분기 따라 처리.

**핵심 산출:**
- `<ChangeRequestModal>` — 3 라디오 (작은/중간/큰) + 변경 내용 textarea + 확인 버튼
- 분기 본체:
  - 작은 = active 부서 끼어들기 (D-A T2.5 dispatcher 재사용 — 이미 land)
  - 중간 = 현재 chain 일시정지 + 기획 부서 변경 인계 + 재계획 + 재개
  - 큰 = 현재 chain 그대로 + 큐에 새 task 등록
- spec reference: §11.17

**의존:** T28 + T32 land 후.

#### T34 — D 의미 단위 알림 카테고리 추가 (회의/큐/검토 결과)

**무엇을:** Notification 카테고리 3 종 추가:
- 회의 종료 (사용자 호출 — maxRounds cap 도달 시)
- 큐 진입 (현재 chain 끝나고 다음 task 시작 시)
- 검토 결과 (NG → 기획 인계 / OK → 사용자 승인)

**핵심 산출:**
- NotificationService 카테고리 4 종 (T30 #1 + 3 추가) 통째
- 알림 라벨 dictionary (i18n)
- spec reference: §11.20 NoSilentFallback (위반 시 Notification 발송)

**의존:** T30 + T32 + T25 land 후.

[후보 D #2~4]

---

### P7 — 편의 + 대시보드 + H1 + F2 phase 2 (디자인 라운드 포함)

#### T35 — 프로젝트 삭제 (보관 / 영구 / 취소)

**무엇을:** 프로젝트 대시보드 상단 + 사이드바 row 옆 X 버튼 → 모달 [보관 / 영구삭제 / 취소].

**핵심 산출:**
- `<ProjectDeleteModal>` 3 버튼
- 보관 = projects.archived_at 설정 + list 에서 숨김 + 보관함 메뉴 복구
- 영구삭제 = DB row + 회의록 + 채널 + 메시지 + 파일 모두 cascade 삭제

**의존:** T34 land 후.

#### T36 — 부서장 핀 (migration 022)

**무엇을:** StaffEditModal 안 직원에 핀 토글 → designated-worker-resolver 핀 우선 사용.

**핵심 산출:**
- migration 022 — providers.is_department_head BOOLEAN DEFAULT 0
- StaffEditModal 핀 토글 + 시각 인디케이터
- T23 designated-worker-resolver 핀 우선 분기 wire

**의존:** T23 + T35 land 후.

#### T37 — 멤버 발화 순서 드래그

**무엇을:** dnd-kit ChannelMemberOrderPanel — 드래그 결과 = channel_members.drag_order 영구 보관.

**핵심 산출:**
- `<ChannelMemberOrderPanel>` (dnd-kit)
- IPC `channel:reorder-members` (drag_order 갱신)
- T23 designated-worker-resolver fallback = drag_order 1 번

**의존:** T36 land 후.

#### T38 — 스킬 질문 시스템 (디자인 라운드 + land)

**무엇을:** SKILL.md 정보 추출 + 정리 → 직원에게 prompt 로 전달. 짧은 디자인 라운드 후 land.

**핵심 산출:**
- 디자인 라운드 — 시안 documents (`docs/design/2026-05-x-skill-question-system.md`)
  - 옵션: SKILL.md 통째 prompt 동봉 vs 시스템 가공 후 동봉 vs 부분 caching
- 사용자 + 디자인 라운드 (Codex / Gemini 의견) → 시안 결정
- 결정 따라 land (LLM 호출 X 일반 코드 — Agestra 참고)

**의존:** T37 land 후.

#### T39 — 프로젝트 대시보드 layout 디자인 라운드

**무엇을 (사무실 메타포):** 프로젝트 헤더 클릭 시 메신저 X / 대시보드 진입. layout 시안 결정 라운드. *H1 합계 패널 + C 큐 위젯 + 다른 위젯 4 종* 통합 위치 결정.

**핵심 산출:**
- 시안 documents (`docs/design/2026-05-x-project-dashboard-layout.md`)
  - 위젯 7 종: H1 진행률 / C 큐 / active 회의 / 부서별 진행도 / 멤버 상태 / 최근 회의록 / 알림 ribbon
  - layout 시안 2~3 종 (grid 배치 / 위젯 우선순위 / 모바일 대응)
- 사용자 + 디자인 라운드 (Codex / Gemini / 사용자 의견) → 시안 결정

**의존:** T38 land 후.

[후보 H1 — 디자인 단계]

#### T40 — 프로젝트 대시보드 land (선택된 시안 + H1 합계)

**무엇을:** T39 시안 따라 대시보드 land + H1 합계 패널 통합.

**핵심 산출:**
- `<ProjectDashboard>` 컴포넌트 + 7 위젯
- H1 합계 패널 = T19 aggregator data source + IPC stream subscribe + zustand store
- 프로젝트 헤더 클릭 라우팅 wire

**의존:** T39 land 후.

[후보 H1]

#### T41 — F 검사관 phase 2 fail-closed 전환 (안전 경계 7 카테고리)

**무엇을:** T11 phase 1 (report-only) → phase 2 (안전 경계 fail-closed). 안전 7 카테고리 위반 = 빌드 실패. 비안전 5 카테고리 = report-only 유지.

**핵심 산출:**
- `tools/inspectors/run.ts` 의 severity 분기 — 안전 카테고리 → exit 1
- pre-push hook 강제 (skip 허용 X)
- 회피 패턴 = `// inspector-disable-next-line <category> <이유>` 주석 (안전 카테고리는 PR review 강제)
- false positive 0 건 검증 게이트:
  - 모든 안전 7 카테고리 룰의 false positive 0 건 (T11 land 후 누적 검증)
  - 사용자 명시 승인 (별 게이트)

**의존:** T11 land 후 *모든 후속 sub-task* (T12~T40) 위반 0 건 + 사용자 승인.

[후보 F phase 2]

---

### P8 — closeout

#### T42 — R12-C2 종결

**무엇을:** R12-C2 Round 2 종결 commit + main fast-forward merge + 새 phase 진입 준비.

**핵심 산출:**
- `tasks.json` sync (P1~P7 모두 completed)
- `docs/구현-현황.md` R12-C2 행 추가 (한글, 사무실 메타포)
- ADR `r12-c2-reference-projects-absorb.md` 갱신 (실제 land 결과 + cross-cutting C8/C9 정식화 link)
- `decisions/cross-cutting.md` 에 C8 (A RunStep) + C9 (F 검사관) 추가
- main fast-forward merge + worktree 정리
- 다음 phase (R12-W = implement 분담 / R12-H = 인계 본격 + 외부 수정 감지) 진입 준비

**의존:** T11~T41 모두 land 후.

---

## phase 의존 그래프 (Round 2 갱신)

```
[Round 1 종결 — main `8e6a602`]
P1 + P1.5 (T0~T6) ✅ + P2 일부 (T7~T10b) ✅
                    │
                    ▼
[Round 2 진입]
P2 마무리 (기반층 + Orchestrator wire)
    T11 (F catalog) → T12 (A RunStep) → T13 (B classifier + Orchestrator)
                    │
                    ▼
P3 (부서 workflow)
    T14 (MessageRenderer) → T15 (idea) + T16 (design) + T17 (review/audit)
                          → T18 (SsmBox 5 variant) → T19 (RunStep aggregator)
                    │
                    ├─► P4 (일반 [##]) ※ P3 와 독립, 병렬 가능
                    │      T20 → T21 → T22
                    │
                    ▼
P5 (구현 + 검증)
    T23 (E 임무 카드 + resolver) → T24 (implement) → T25 (audit NG → 기획)
                                                  → T26 (ExecutionService RunStep)
                    │
                    ▼
P6 (인계 + 큐 + 알림)
    T27 (G handoff_dispatch) → T28 (HandoffApprovalModal + B 우회)
                            → T29 (H2 패키지) → T30 (D #1 검토→리뷰)
                            → T31 [디자인 라운드] → T32 (C 큐 land)
                            → T33 (변경 요청) → T34 (D #2~4 알림)
                    │
                    ▼
P7 (편의 + 대시보드 + H1 + F2 phase 2)
    T35 (프로젝트 삭제) → T36 (부서장 핀) → T37 (멤버 드래그)
                       → T38 [디자인 라운드 + land] (스킬 질문)
                       → T39 [디자인 라운드] (대시보드 layout)
                       → T40 (대시보드 land + H1)
                       → T41 (F2 phase 2 fail-closed 전환)
                    │
                    ▼
P8 (closeout)
    T42 (ADR + 구현현황 + cross-cutting C8/C9 + main merge)
```

**병렬 가능 구간**:
- P3 + P4 (둘 다 T13 후 독립)
- P3 안 T15 + T16 + T17 (각 부서 workflow 독립)
- P5 안 T24 + T25 + T26 (T23 후 독립)
- P7 안 T35 + T36 + T37 (각 편의 surface 독립)

**디자인 라운드 진입 게이트** (사용자 + AI 의견 라운드 → 시안 결정):
- T31 — C 큐 surface 시안 (P6 안 큐 land 직전)
- T38 — 스킬 질문 시스템 시안 (P7 안 land 직전)
- T39 — 프로젝트 대시보드 layout 시안 (P7 안 H1 land 직전)

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

### Round 2 (현재)

- **worktree**: `/mnt/d/Taniar/Documents/Git/Rolestra-r12c2-r2` (branch `feat/r12-c2-redesign-r2`)
- **base**: `8e6a602` (Round 1 종결 + main tip)
- **node_modules**: 새 worktree 라 `npm install` 1 회 필요 (T11 진입 직전)
- **WSL ↔ Windows**: 사용자 dev 빌드 후 native binding (better-sqlite3 + rollup) win32 전환 가능 → vitest 시 `npm rebuild better-sqlite3` + `npm i --no-save @rollup/rollup-linux-x64-gnu` + `git checkout package-lock.json` 복구 절차 필요
- **그래프**: `graphify-out/` (main 의 14M / 13:57 데이터 — Round 2 worktree 도 main 의 데이터 참조)

### Round 1 (종결)

- **worktree**: `/mnt/d/Taniar/Documents/Git/Rolestra-r12c2` (제거 완료)
- **branch**: `feat/r12-c2-meeting-redesign` (삭제 완료)
- **base**: `e3cdafb` (R12-C 1차 closeout, main tip — Round 1 진입 시점)
- **종결**: `5472bef` ff merge → main `8e6a602` (push `e3cdafb..8e6a602` 완료)

### 메모리 reference

- `rolestra-r12-c2-reference-projects-a3.md` — Round 2 진입 가이드 (4 결정 + 8 후보 + 우선순위)
- `rolestra-r12-c2-t10b-completion.md` — Round 1 T10b 종결 (옛 SSM 통째 정리 reference)
- `rolestra-r12-meeting-system-redesign-2026-05-03.md` — Round 1 spec round 입력 (의견 트리 + 일괄 투표 + 모더레이터 결정)

---

## Round 1 land 결과 history (2026-05-04 종결, main tip `8e6a602`)

R12-C2 Round 1 = T0~T10b 통째 land + main fast-forward merge. Round 2 의 *기반 입력*. 자세한 결정 + commit SHA 는 ADR `r12-c2-reference-projects-absorb.md` D7 reference.

### Round 1 commit 19 종 (worktree `feat/r12-c2-meeting-redesign` → ff merge `5472bef`)

| Sub-task | 내용 | Commit |
|----------|------|--------|
| T0 | P1.5 일반 채널 회귀 차단 | `42d9780` + `15873cb` + `98a6be8` + `8fcde8a` |
| T1 | P1.1 spec §3 부서 카탈로그 | `e082882` |
| T2 | P1.2 spec §4 부서별 회의 매트릭스 | `6628abb` |
| T3 | P1.3 spec §5 D-B 흐름 | `f46b206` |
| T4 | P1.4 spec §11.13~§11.18 신규 | `767d310` |
| T5 | P1.5 spec JSON schema 4 종 | `35de0e7` |
| T6 | P1.6 sub-task 분할 + tasks.json | `420ec9a` |
| T7 | P2-1 migration 019 (opinion + opinion_vote + max_rounds) | `62533be` |
| T8 | P2-2 OpinionService backend | `013f690` |
| T9 | P2-3 MeetingMinutesService | `4b3a9ef` + `5021de8` |
| T10a | P2-4a MeetingOrchestrator 새 backend skeleton | `d4823e0` |
| T10b | P2-4b 옛 SSM + consensus_decision approval + voting-history 통째 정리 | `a171c01` |

### Round 1 자산 → Round 2 입력

- **spec §3 부서 카탈로그** (verify 폐기 / 검토 신규 / 리뷰 라벨) → Round 2 모든 부서 workflow sub-task 의 *부서 정의*
- **spec §4 회의 매트릭스 + 디자인 7 단계 + 일반 [##] + Migration 019/020/021** → Round 2 P3 부서 workflow + P4 일반 + P2 mig sub-task 직접 입력
- **spec §5 D-B 흐름 + 의견 트리 + 일괄 투표 + 모더레이터 회의록** → Round 2 모든 회의 흐름의 *공유 토대*
- **spec §11.13~§11.18** (SsmBox 5 variant + 채팅창 카드 + max_rounds + 부서 lock R12-C2 + 변경 요청 + JSON schema 4 종) → Round 2 P3 / P4 / P6 직접 입력
- **migration 019** (opinion + opinion_vote + max_rounds) → Round 2 T12 mig 020 의 *직전 마이그레이션*
- **OpinionService + MeetingMinutesService + MeetingOrchestrator skeleton** → Round 2 T13 (B classifier + Orchestrator wire) 의 *직접 의존*
- **옛 12 단계 SSM 통째 폐기** → Round 2 새 모델 wire (T13) 의 *전제 (충돌 없는 backend)*

### Round 2 추가 입력 (2026-05-05 land)

| 자산 | 위치 | 역할 |
|------|------|------|
| 옵션안 | `docs/reports/analysis/2026-05-05-참고프로젝트-반영-옵션안.md` | 4 결정 (R1/B1/H1+H2/F2) 근거 |
| ADR | `docs/R12_c2_2R/decisions/r12-c2-reference-projects-absorb.md` | 4 결정 + 8 후보 도입 + 진입 우선순위 D8 |
| spec §11.18.8 | channel-roles-design.md | B1 NextStep 카드 7 종 + handoff_mode 우회 + maxRounds cap 인터락 |
| spec §11.19 | channel-roles-design.md | A. RunStep 영속 기록부 |
| spec §11.20 | channel-roles-design.md | F. 6 헌법 + 검사관 catalog (12 카테고리, F2 정책) |
| spec §11.21 | channel-roles-design.md | H1. 대시보드 진행률 패널 |
| spec §11.22 | channel-roles-design.md | H2. 받는 부서 첫 화면 인계 패키지 |

---

## Round 2 진입 (2026-05-05) — 다음 작업 가이드

### 첫 sub-task = T11 (F. 검사관 catalog phase 1)

진입 우선순위 (ADR D8) 따라 *F 가 가장 먼저*. 이유:
- 다른 후보 (A/B/C/D/E/G/H) 의 평가 기준
- phase 1 = report-only → 빌드 차단 X → land 부담 작음
- Round 1 정리 작업 (T10b 종결 직후) 와 병행 안전 (코드 변경 룰 추가만)

### T11 진입 시 작업 흐름 (CLAUDE.md cycle)

1. **구현** — `tools/inspectors/<category>.ts` 12 카테고리 + `tools/inspectors/run.ts` + npm script + CI hook
2. **검토** — qa agent 또는 self-검토 (spec §11.20 acceptance 대비):
   - 안전 7 + 비안전 5 = 12 카테고리 전부 작성됐는가
   - `npm run inspect` 실행 시 보고서 생성되는가
   - report-only 단계 = 빌드 차단 X 인가
   - pre-commit + pre-push hook wire 됐는가
3. **commit** — 검토 PASS 시 ff commit (`feat(rolestra): R12-C2 T11 — F 검사관 catalog phase 1 ...`)
4. **메모리** — sub-task 종결 메모리 (다음 sub-task = T12 진입 가이드 포함)

### Round 2 land 자산 (현재)

```
8e6a602 (main tip, Round 2 base)
        │
        ▼ Round 2 worktree feat/r12-c2-redesign-r2
?       docs(spec): channel-roles-design §11.18.8 + §11.19~§11.22 (B1/A/F/H1/H2)
?       docs(adr): r12-c2-reference-projects-absorb (D1~D8 4 결정 + 진입 우선순위)
?       docs(plan): R12-C2 plan 통째 재작성 (Round 2 = 8 후보 흡수)
?       chore(plan): tasks.json sync (Round 2 sub-task T11~T42)
        │
        ▼ T11 진입 (다음 작업)
```

### 검증 baseline (Round 2 진입 시점)

- vitest **3230 PASS / 13 skip / 0 fail** (Round 1 T10b 종결 시점)
- typecheck:node + typecheck:web **0 error**
- lint baseline 유지

Round 2 의 모든 sub-task land 시 위 baseline 위에 누적. baseline 회귀 시 sub-task land 차단.
