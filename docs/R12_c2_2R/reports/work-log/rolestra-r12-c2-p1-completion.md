---
name: R12-C2 P1 spec round 종결 — 5 commit + sub-task 30 분할 (2026-05-04)
description: R12-C2 P1 spec round (T1~T6) 5 commit land + tasks.json placeholder 6 개 → sub-task 30 (T7~T35) 분할 + plan 본문 P1 결과 단락 추가 + 메모리 closed 표기. 다음 작업 = T7 P2-1 migration 019 진입.
type: project
originSessionId: 9001b9e7-r12c2-p1
---

## 진입 위치 + worktree 상태

- **worktree**: `/mnt/d/Taniar/Documents/Git/Rolestra-r12c2`
- **branch**: `feat/r12-c2-meeting-redesign`
- **tip**: `420ec9a` (T6 P1.6 — tasks.json sub-task 29 분할 + plan 본문 P1 결과 + 메모리 closed). P1 spec round 6 commit 종결.
- **base**: `e3cdafb` (R12-C 1차 main tip)
- **vitest baseline**: 3488 / 13 / 0 (P1 = 코드 변경 0 이라 회귀 X — 검증 자체 안 함)
- **typecheck**: 0 (코드 변경 0)

## P1 spec round 6 commit 누적 (R12-C 1차 land 위)

```
420ec9a  docs(plan): P1.6 — P2~P8 sub-task 29 분할 + plan 본문 P1 결과 단락 + 메모리 closed
35de0e7  docs(spec): P1.5 — §11.18 JSON schema 정식 (의견 제시 / 일괄 투표 / 자유 토론 / 모더레이터)
767d310  docs(spec): P1.4 — §11.13~§11.18 신규 (SsmBox layout / max_rounds / capability_tier / 부서 lock R12-C2 / 변경 요청 / JSON schema 자리)
f46b206  docs(spec): P1.3 — §5 D-B 흐름 갱신 (의견 트리 + 일괄 투표 + 모더레이터 회의록)
6628abb  docs(spec): P1.2 — §4 부서별 회의 매트릭스 갱신 (디자인 7 단계 / 구현 단계적 / 일반 [##] 강제)
e082882  docs(spec): P1.1 — §3 부서 카탈로그 갱신 (verify 폐기 / 검토 신규 / 리뷰 라벨 정정)
```

## spec 갱신 섹션 (5 종)

| commit | spec 섹션 | 핵심 |
|--------|-----------|------|
| `e082882` | §3 부서 카탈로그 + §11.9 SKILL_CATALOG 갯수 | 11 능력 (부서 10 + meeting-summary) / review→리뷰 / audit 신규 (한국어 '검토') / 부서 템플릿 9 |
| `6628abb` | §4 통째 — 채널 데이터 모델 + 부서별 회의 흐름 표 + 디자인 7 단계 sub-section + 일반 부서 새 정의 + 채널 입력란 분기 + 사이드바 ASCII + 작업 모드 deprecate + 3 분기 + Migration 019/020/021 | SSM 12 단계 통째 폐기 명시 / 디자인 7 단계 / 일반 [##] 강제 / review/audit 분리 |
| `f46b206` | §5 D-B 흐름 통째 재작성 — 5 단계 + 2.5 일괄 투표 + 모더레이터 [합의]+[제외] + opinion 트리 + 깊이 cap 3 + 발화 ID 회의 단위 카운터 + 컨텍스트/token | 모든 풀세트 부서 공유 토대 / 옛 4 phase + opinion_revisions 폐기 |
| `767d310` | §11.13~§11.18 신규 — SsmBox 5 variant + 채팅창 카드 + max_rounds + capability_tier R12-W + 부서 lock R12-C2 정정 + 변경 요청 UI + JSON schema 자리 | 11.16 lock 매트릭스 7 행 (review/audit 분리) / 11.17 변경 요청 모달 |
| `35de0e7` | §11.18 직원 응답 JSON schema 4 종 + schema 검증 fallback | 발화 ID `<provider>_<n>` 회의 단위 리셋 / 화면 ID `ITEM_NNN_NN_NN` / 깊이 cap 3 / truncate 의심 검출 1 회 재요청 |

## sub-task 30 분할 (P2~P8) — placeholder T7~T13 → T7~T35

| Phase | Task ID 범위 | 개수 | sub-task 키워드 |
|-------|-------------|------|----------------|
| P2 회의 backend | T7~T12 | 6 | migration 019 / OpinionService / MeetingMinutesService / MeetingOrchestrator 재배선 / 할 일 큐 트리거 / 회의록 chat block |
| P3 부서 워크플로우 | T13~T18 | 6 | MessageRenderer 카드 variant / idea-workflow / design-workflow + Playwright snapshot / review-workflow / audit-workflow / SsmBox 부서별 5 variant 통합 |
| P4 일반 [##] 본격 | T19~T21 | 3 | [##] 파서 / 일반 SsmBox final / 의견 게시 모달 |
| P5 구현 + 검증 | T22~T24 | 3 | implement-workflow / designated-worker-resolver / NG → 기획 인계 분기 |
| P6 인계 | T25~T29 | 5 | HandoffApprovalModal / HandoffModeToggle / 검토→리뷰 Notification / 부서 lock + 대기 큐 / 변경 요청 모달 |
| P7 편의 | T30~T34 | 5 | 프로젝트 삭제 / 부서장 핀 / 멤버 드래그 / 스킬 질문 / 대시보드 layout |
| P8 closeout | T35 | 1 | ADR + 구현현황 + tasks.json sync + main merge |

T0 (P1.5 회귀 차단) + T1~T6 (P1 sub-task) 모두 land 완료 → 다음 진입 = **T7 (P2-1 migration 019)**.

## 다음 세션 첫 작업 — T7 P2-1 migration 019 진입

P2 = 회의 backend 본체. P2-1 (migration) 부터 sequential 진행. P2 의존 그래프:

```
T7 (migration 019) ── 토대
   ↓
T8 (OpinionService) ── opinion 테이블 사용
   ↓
T9 (MeetingMinutesService)
   ↓                   ↓
T10 (Orchestrator 재배선)  T12 (회의록 chat block)
   ↓                       ↓
T11 (할 일 큐 트리거)        ↓
                            ↓
                    P3 진입 (T13~T18)
```

P2-1 acceptance:
- `019-opinion-tables.ts` 신규 — opinion + opinion_vote + channels.max_rounds
- 옛 `opinion_revisions` 테이블 (R5 시점 land 됐으면) drop — `opinion.parent_id` + `opinion.kind` 흡수
- 옛 SSM phase 컬럼 (DISCUSSING / PROPOSING / ...) drop 또는 deprecate 마킹 — 결정 필요
- forward-only / idempotent / 실패 시 앱 시작 차단 (CLAUDE.md migration 규칙)
- vitest migration test (idempotent 재실행 + drop 확인) + typecheck 0 + better-sqlite3 native binding 회귀 X

진입 순서:
1. 본 메모리 + plan 본문 + spec §4 Migration / §5 데이터 모델 / §11.18 schema 읽고 시작
2. tasks.json T7 (P2-1) status='in_progress' 설정 후 진행
3. 4 게이트 워크플로우 (설계 → 의도 부합 검토 → 구현 → spec 부합 검토 → commit) 따름
4. P2-1 land 후 commit + 사용자 OK → T8 (P2-2 OpinionService) 진행

## 결정원칙 (이번 P1 round 적용 + 차후 적용)

P1 round 6 commit 모두 *spec 결정 그대로 정식화* + *옵션 묻지 않고 적용*. 이는 R12-C2 P1.5 round 1 시점 사용자 발화 *"문서 확인하면 기록 있을 텐데..."* 가 enforce 한 결정원칙:

- **spec / 메모리에 박혀 있을 때는 옵션을 묻지 말고 그대로 적용** (R12-C T10 의 "옵션 추측해서 진행" 안티패턴 반복 차단)
- **"미루면 작업이 밀린다"** (P1.5 round 2 사용자 결정원칙) — 큰 phase 가 멀고 dogfooding 차단 surface 가 있을 때 *minimal 부분 fix* 가 정직. 단 본격 phase 의 핵심 결정사항을 부분 fix 로 *암묵적 land* 시키지 않게 메모리에 명시 안전장치 둠.

## 4 게이트 워크플로우 적용 (P1 round 6 commit 모두 적용)

R12-C 시점 T10 reverted 사고 차단용:

```
[1] 설계 (spec / plan / sub-task 결정)
    ↓
[2] 의도 부합 검토 (claude 자동) — 메모리 / 사용자 발언 ↔ spec / plan 매핑 짧게
    문서 ↔ 문서 비교. 누락 / 어긋남 명시. NG → 설계 다시
    ↓ OK
[3] 구현 (코드 + typecheck + vitest)        ← P1 = 코드 변경 0 이라 spec Edit
    ↓
[4] spec 부합 검토 (claude 자동) — tasks.json acceptance ↔ land 결과 매핑
    작업 ↔ 문서 비교. 각 항목 ✅/❌/△ + worktree 위치 grep 결과 직접 인용
    NG → 구현 다시 / spec 갱신 (간혹)
    ↓ OK
[5] commit + 사용자 OK → 다음 sub-task
```

P1 round 에서 게이트 1+2 = 메모리 + plan + tasks.json 결정사항 ↔ spec 매핑 짧게. 게이트 3 = spec Edit. 게이트 4 = grep 결과 직접 인용 + acceptance ↔ land 매핑 표 (각 commit message 안 5~10 줄). 작은 sub-task 라 게이트 1+2 짧게 통과.

## 작업 환경 메모

- **worktree**: `/mnt/d/Taniar/Documents/Git/Rolestra-r12c2` (절대 경로 사용 — 환각 차단)
- **commit identity**: `mua-vtuber` / `mua.vtuber@gmail.com` 만 (CLAUDE.md global rule)
- **CLAUDE.md mock/fallback 금지** — P2-1 migration 019 안 fallback 절대 X
- **package-lock.json 자동 갱신 시 git checkout 으로 복구** (사용자 dev 빌드 후 platform 차이)
- **사용자 = 코딩 무지인** — 코드 / 경로 / 함수명 직접 인용 X. 사무실 메타포
- **worktree merge reminder**: 작업 끝나면 main merge + worktree remove + branch 삭제
