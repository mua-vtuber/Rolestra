---
name: R12-C2 진입 — 회의 시스템 재설계 P1~P8 (2026-05-04)
description: R12-C 1차 main land 후 새 worktree `feat/r12-c2-meeting-redesign` 진입. 사용자 결정 통째 plan 반영 (회의 절차 새 양식 / 부서 매트릭스 / Q-A/B/E default / P7 우선순위). 다음 세션 진입 = P1 spec round (게이트) 또는 P1.5 일반 채널 회귀 차단 (병렬 가능). 본 메모리 = 새 worktree 진입 가이드.
type: project
originSessionId: 867442d8-0b70-4355-ace5-c55fa2cbd181
---

## 진입 위치 + 기본 사실

> ⚠️ **2026-05-04 갱신**: P1.5 + follow-up rounds land 완료. 진입 위치 + dogfooding 결과는 **`rolestra-r12-c2-p15-completion.md`** 우선. 본 파일은 R12-C2 plan 8 phase + 사용자 결정사항 reference 로 유지.

- **worktree**: `/mnt/d/Taniar/Documents/Git/Rolestra-r12c2`
- **branch**: `feat/r12-c2-meeting-redesign`
- **tip**: `8fcde8a` (P1.5 follow-up round 2 — N턴 + stream subscribe). 작성 시점 tip `3e43b3a` (R12-C2 plan first commit) → rebase 로 hotfix 흡수 (`bb29558`) → P1.5 commits 누적 (`42d9780` / `15873cb` / `98a6be8` / `8fcde8a`).
- **base**: `e3cdafb` (R12-C 1차 closeout). main tip = `bb29558` (router.ts hotfix). worktree 는 main 에 fast-forward 가능.
- **vitest baseline**: 3488 passed / 13 skip / 0 fail / typecheck 0 (R12-C 1차 3486 + P1.5 신규 it 2 = 정합)
- **node_modules**: 설치 완료 (보존). dev 빌드 후 native binding drift 시 `npm rebuild better-sqlite3` + `npm i --no-save @rollup/rollup-linux-x64-gnu` + `git checkout package-lock.json` 복구.
- **WSL ↔ Windows**: 사용자 dev 빌드 후 native binding (better-sqlite3 + rollup) win32 전환 가능 → vitest 시 위 복구 절차 필요

## R12-C2 plan 위치

- **plan 본문**: `docs/superpowers/plans/2026-05-04-rolestra-phase-r12-c2.md`
- **tasks.json**: 같은 폴더 `.tasks.json`
- **이전 plan (R12-C, 일부 task R12-C2 reassign)**: `docs/superpowers/plans/2026-05-02-rolestra-phase-r12-c.md` + `.tasks.json`
- **ADR (R12-C 1차)**: `docs/아키텍처-결정-기록/r12-c-channel-roles.md` (D1~D9)
- **회의 시스템 재설계 결정 통째 메모리**: `rolestra-r12-meeting-system-redesign-2026-05-03.md` — P1 spec round 의 *입력*

## 사용자 결정 통째 (2026-05-04 토론)

### 회의 절차 (새 양식)

```
1. 의견 제시 (화면 보임) — 직원이 JSON 양식. 발화 ID `codex_1` / `claude_1`
   회의 단위 카운터 (회의 끝나면 다음 회의에서 codex_1 부터 리셋). 화면에 발화 ID 표시.

2. 시스템 취합 (화면 안 보임 / SsmBox 에 의견 list) — 의견 ID `ITEM_001`
   부여. 자식 = ITEM_001_01, 손자 = ITEM_001_01_01. 깊이 cap 3.
   DB 저장 = 단순 id (UUID) + parent_id. 화면 표시는 시스템이 parent chain
   따라 가공.

★ 2.5 일괄 동의 투표 (보임, SsmBox 에 vote 진행 표시) — 만장일치 의견은
   즉시 합의 + 자유 토론 skip. 만장일치 못 받은 의견만 step 3 으로.

3. 자유 토론 (보임, SsmBox 반영) — 의견 1 개씩 제시. 직원이 동의/반대/
   수정/추가. 수정/반대/추가 의견은 자식 의견 (`ITEM_001_01`).

4. 합의 → 다음 의견 → step 3 반복.

5. 모더레이터 회의록 작성 (R12-S MeetingSummaryService + getResolvedSummaryModel
   활용). 의견 통째 + 발화 history 받아 [합의 항목] + [제외 항목] 정리.
   ★ truncate 금지 (요약 / 축약 X). 의견 본문 + 근거 통째 보존. 결정 사유 모더레이터 작성.

6. handoff_mode 따라 인계 (auto = 자동 / check = 사용자 결재 모달).
```

### 부서 매트릭스

| 부서 | 한국어 라벨 | 흐름 | chain 위치 |
|------|------------|------|-----------|
| 아이디어 | 아이디어 | D-B-Light + USER_PICK | 표준 시작 |
| 기획 | 기획 | 풀세트 | 표준 hub |
| 디자인 | 디자인 | 7 단계 (와이어프레임 5 + 디자인 2) + Playwright PNG | 표준 |
| 구현 | 구현 | R12-C2 = simple 1 명 / R12-W = 분담 + tier (별 phase) | 표준 |
| **리뷰** | 리뷰 (라벨 정정) | 풀세트 — 주관 평가 / 개선 제안. 두 entry: (a) 사용자 명시 호출 (b) 검토 인계 모달 안 체크박스 / auto 시 Notification | **chain 외** |
| **검토** | 검토 (audit 신규) | 풀세트 — 객관 + 목적 통합 (verify 폐기, 책임 흡수) | 표준 끝 강제 |
| 일반 | 일반 (잡담) | **`[##]` 강제** — 메시지 안 [##본문] 감싸기만 의견 카드 등록 | — |

### Q-A/B/E default 결정 (모두 동의)

- **Q-A 의견 ID**: DB 단순 id (UUID) + parent_id / 화면은 parent chain 가공
- **Q-B 발화 ID 카운터**: 회의 단위 리셋
- **Q-E 검토→리뷰 trigger**: 인계 결재 모달 안 *"+리뷰 부서도 시작"* 체크박스 + auto 인계 시 Notification

### 채팅창 카드 vs SsmBox 카드

- 의견 발화 = *채팅창 메시지 row* + *SsmBox 카드* 둘 다 표시
- 채팅창 = `Card primitive` 활용 + themeKey 따라 변형 (이미 R3 시점 land — 추가 작업 X)
- 본문 truncate 금지 (사용자 명시: "잘리지 말고 다 보여 줘")
- 카드 안 [선택 / 취소] 같은 액션 버튼 (kind 별)

### P7 편의 기능 우선순위 (사용자 명시)

```
1. 프로젝트 삭제 (가장 시급, 자주 사용)
2. 부서장 핀 (구현 부서 작동 의존)
3. 멤버 발화 순서 드래그
4. 스킬 질문 시스템 (제일 마지막 — 없어도 작동)
5. 프로젝트 대시보드 layout (별 design round)
```

**프로젝트 삭제 모달 양식**: 대시보드 상단 삭제 버튼 1 개 + 사이드바 프로젝트 row 옆 X 버튼 → 둘 다 누르면 모달 [보관 / 영구삭제 / 취소] 3 버튼.

**스킬 질문 시스템**: Agestra 참고 — 시스템 (LLM 호출 X 일반 코드) 이 SKILL.md 가공 → prompt 주입. 직원이 직접 SKILL.md 읽지 않음. P7 진입 시 짧은 design round.

## 다음 세션 진입 — P1 spec round 또는 P1.5 회귀 차단

**P1 spec round (T1~T6)** = 모든 후속 phase 의 *게이트*. spec `2026-05-01-rolestra-channel-roles-design.md` 의 §3 / §4 / §5 / §11.x 갱신 + JSON schema 정식화 + P2~P8 sub-task 분할.

**P1.5 일반 채널 회귀 차단 (T0)** = P1 와 *병렬 가능*. dogfooding 시 거슬리지 않게 일반 채널 메시지 자동 의견 등록 차단 우선. 본격 [##] 파서 + 모달은 P4 안에서.

진입 옵션:
- (a) **P1 spec round 먼저** — 모든 phase 의 토대를 정식화 후 P1.5 + P2~P8 진행
- (b) **P1.5 회귀 차단 먼저** — 일반 채널 회귀가 사용자 dogfooding 거슬리지 않게 차단 후 P1 진입
- (c) **둘 다 병렬** — 다른 직원 / 사용자가 동시 진행

**권장**: (b) 후 (a). P1.5 = 코드 영향 작은 회귀 차단이라 빨리 land + sticky main 안정. 그 후 P1 spec round 본격.

## 미land 카드 (R12-C 1차 dogfooding round 1 잔재, 모두 R12-C2 안 매핑)

| # | 항목 | R12-C2 매핑 |
|---|------|--------------|
| 1 | 검토 → 리뷰 라벨 + audit 부서 신규 | P1.1 (spec §3 갱신) + P3 (workflow land) |
| 2 | 부서 채널 회의 트리거 (할 일 큐 entry) | P2 (할 일 큐 → 부서 회의 자동 트리거 wire) |
| 3 | 프로젝트 클릭 → 대시보드 | P7-5 (별 design round 후 land) |
| 4 | DM 읽음 / 작성 중 indicator | R12+ 이연 (R12-C2 외) |
| 신규 | 프로젝트 삭제 (보관 / 영구삭제) | P7-1 |

## R12-C2 외 phase

| Phase | 무엇 | 시점 |
|-------|------|------|
| R12-D | 옵션 부서 (캐릭터 / 배경) UI propagate | R12-C2 후 (사용자 결정 시) |
| R12-W | 구현 분담 + tier system (frontier/mid/local) + worktree 분할 + 부서장 + 머지 + 충돌 승인 | R12-C2 후 |
| R12-H | 외부 수정 감지 (인계 직전 mtime 가드) + 인계 chain 본격 | R12-C2 + R12-W 후 |
| R13 | multi-worker 분산 + 더 본격 자동화 | R12-W + R12-H 후 |
| R12+ | DM 읽음 / 작성 중 indicator + 통합 ergonomics | 별 사이클 |

## 작업 환경 메모

- **사용자 = 코딩 무지인** — 코드 / 경로 / 함수명 직접 인용 X. 시스템이 이렇게 굴러간다 / 사무실 메타포.
- **commit identity**: mua-vtuber / mua.vtuber@gmail.com 만 (CLAUDE.md global rule).
- **CLAUDE.md mock/fallback 금지** — 거짓 UI / silent fallback 절대 X. crash 가 거짓 UI 보다 안전.
- **package-lock.json 자동 갱신 시 git checkout 으로 복구** (사용자 dev 빌드 후 platform 차이).
- **worktree merge reminder**: 작업 끝나면 main merge + worktree remove + branch 삭제 — 사용자가 자주 까먹음.

## 새 worktree 첫 작업

새 세션 진입 시 본 메모리 + plan 본문 (`docs/superpowers/plans/2026-05-04-rolestra-phase-r12-c2.md`) + 회의 시스템 재설계 결정 메모리 (`rolestra-r12-meeting-system-redesign-2026-05-03.md`) 만 읽고 시작.

진입 순서:
1. `git worktree list` 로 worktree 위치 확인 (`/mnt/d/Taniar/Documents/Git/Rolestra-r12c2`)
2. tasks.json 보고 다음 task 결정 (T0 = P1.5 회귀 차단 / T1 = P1.1 spec §3)
3. 사용자 의도 확인 (P1.5 먼저 / P1 먼저 / 병렬)
4. `npm install` (새 worktree 라 1 회 필요)
5. 진행

## 진행 워크플로우 — sub-task 단위 4 게이트 (R12-C 사고 반복 차단)

R12-C 시점에 T10 reverted (acceptance 부합 검토 X) / audit 보고서 환각 (worktree 위치 X) 같은 사고 발생. 차단 위해 각 sub-task 진행 시 4 게이트:

```
[1] 설계 (spec / plan / sub-task 결정)
    ↓
[2] 의도 부합 검토 (claude 자동) — 메모리 / 사용자 발언 ↔ spec / plan 매핑 짧게
    문서 ↔ 문서 비교. 누락 / 어긋남 명시. NG → 설계 다시
    ↓ OK
[3] 구현 (코드 + typecheck + vitest)
    ↓
[4] spec 부합 검토 (claude 자동) — tasks.json acceptance ↔ land 결과 매핑
    작업 ↔ 문서 비교. 각 항목 ✅/❌/△ + worktree 위치 grep 결과 직접 인용 (환각 차단).
    NG → 구현 다시 / spec 갱신 (간혹)
    ↓ OK
[5] commit + 사용자 OK → 다음 sub-task
```

산출 위치: 짧은 acceptance 체크 표 → commit message 안 (5~10 줄). 큰 sub-task (P2 회의 backend 등) 는 별 보고서 (`docs/reports/r12-c2/p[N]-[task].md`) 까지 — 사용자 결정.

**환각 차단 의무화**: claude 가 grep / read 시 *반드시 worktree 위치에서 실행 + 결과 직접 인용*. main 위치 grep 결과 X. R12-C audit 환각 사고 반복 X.

**작은 sub-task (i18n 추가 / 라벨 변경 등)**: 게이트 1+2 생략 OK — 상황 따라 claude 가 자체 판단, 단 commit message 안 *생략 사유* 한 줄.

수동 진행 모델 (사용자 자율 진행 X): 사용자가 매 sub-task 시작 + 종결 시점에 OK / 수정 답. claude 가 게이트 표 만들어 보여주고 사용자 판단.
