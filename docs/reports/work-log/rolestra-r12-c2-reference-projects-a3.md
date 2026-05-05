---
name: R12-C2 참고프로젝트 반영 — A3 결정 종결 + R1 재분해 진입 (2026-05-05)
description: A3 옵션안 land + 사용자 결정 (R1/B1/H1+H2/F2) + B1 인터락 + R12-C2 Round 1 main land + 새 worktree 생성 후 R1 plan 통째 재작성 진입 가이드
type: project
originSessionId: a6a13f35-c831-464e-8add-e612fa13c2e6
---
## 종결 상태 (2026-05-05)

### A3 옵션안 land

옵션안 파일: `docs/reports/analysis/2026-05-05-참고프로젝트-반영-옵션안.md` (commit `6b45778`)

### 사용자 결정 (4 세부 항목 확정)

| 항목 | 결정 |
|------|------|
| 7.1 R12-C2 sub-task 재구성 | **R1** — 전체 재분해. T10c + T11~T35 폐기 후 8후보 단계 단위 sub-task 새로 분해 |
| 7.2 B 자율 정책 | **B1** — 안전 카드만 자동 (「계속 발언」「대기」). 결과 전파 5 카드 = 항상 사용자 확인 |
| 7.3 H 진행률 surface | **H1 + H2** — 대시보드 = 합계 / 받는 부서 채널 첫 화면 = 인계 패키지 |
| 7.4 F 검사관 강도 | **F2** — 단계적 fail-closed (안전 경계만). 비안전 영역은 report-only 유지 |

### B1 인터락 (옵션안 §2 보강)

| 기존 정책 | B1 와 관계 |
|---------|-----------|
| handoff_mode = check (디폴트) | **정합** — B1 「인계」카드 = 사용자 확인과 동일 |
| handoff_mode = auto (부서별 opt-in) | **계층** — B1 디폴트 위에서 부서별 명시 켠 자동 우회. `channel-roles-design.md` line 200 의 `DEFAULT 'check'` 와 정합 |
| maxRounds = 5 (회의 cap) | **독립** — 회의 라이프사이클 cap. cap 도달 시 시스템이 「회의 종료」카드 강제 발행 |
| 자율 모드 (manual/auto_toggle/queue) | **독립** — B1 = 회의 *내부* 발언 후 분류. 자율 모드 = 회의 *외부* 시작·큐. surface 분리 |

→ 사라지는 정책 없음. handoff_mode auto 의 의미만 *명시 opt-in 우회* 로 좁아짐.

### spec 갱신 시 명시할 점 (R1 진행 시)

`channel-roles-design.md` §11.18 안에 *카드 분류 → handoff_mode 우회 룰* 1 줄 명세 추가. 「인계」카드 도착 시 → handoff_mode = auto 부서면 자동 진행, 아니면 사용자 확인 모달.

## R12-C2 Round 1 종결 (2026-05-05)

### main land 완료

- merge commit: `5472bef` — R12-C2 Round 1 (T0~T10b) 19 commit ff merge (--no-ff, SHA 보존)
- 옵션안: `6b45778`
- CLAUDE.md graphify section: `8e6a602`
- main 최종 HEAD: `8e6a602`
- push: 완료 (`e3cdafb..8e6a602`)

### land 자산 (R1 plan 의 *기반 입력* 으로 활용)

- 옛 SSM 폐기 (T10b)
- OpinionService backend (T8 P2-2)
- MeetingMinutesService (T9 P2-3)
- migration 019 = opinion + opinion_vote + channels.max_rounds (T7 P2-1)
- spec §3 부서 카탈로그 / §4 부서별 회의 매트릭스 / §5 D-B 흐름 / §11.13~§11.18 + JSON schema 4 종 (P1 spec round)

### 폐기/재정의 대상 (R1 plan 에서 통째 재작성)

- T10c (e2e + closeout) — R1 sub-task 재분해에 흡수
- T11~T35 (P3~P8 sub-task 30 건) — R1 의 8후보 단계 단위 sub-task 로 대체

### worktree 정리

- R12-C2 Round 1 worktree (`/mnt/d/Taniar/Documents/Git/Rolestra-r12c2`) 제거 완료
- 브랜치 `feat/r12-c2-meeting-redesign` 삭제 완료
- graphify-out / .graphifyignore 는 main 에 보존 (main 의 14M / 13:57 데이터가 worktree 18M / 02:57 보다 11시간 더 최신)

## 다음 세션 첫 작업 — R1 plan 통째 재작성

### 새 worktree

- 위치: `/mnt/d/Taniar/Documents/Git/Rolestra-r12c2-r2`
- 브랜치: `feat/r12-c2-redesign-r2`
- base: `8e6a602` (main HEAD)

### 진행 순서 (권장)

1. **spec 갱신** (`channel-roles-design.md` + `2026-04-18-rolestra-design.md`) — 8후보 흡수 결과 반영. R1 plan 의 *입력* 이 됨.
   - §11.18 에 B1 카드 7종 + handoff_mode 우회 룰 + maxRounds cap 인터락
   - cross-cutting 영역에 A (RunStep ledger) / F (검사관 catalog) 도입
   - §11.x 신규 — H1 (대시보드 진행률 패널) + H2 (받는 부서 첫 화면 인계 패키지)
2. **ADR 작성** — 통합 1 건 추천: `r12-c2-reference-projects-absorb.md`. 4 결정 + 8후보 도입 근거 + R12-C2 Round 1 종결 + Round 2 진입 정리.
3. **R12-C2 plan 통째 재작성** (`docs/plans/2026-05-04-rolestra-phase-r12-c2.md`) — 8후보 단계 단위 (기반 → 시스템 → 화면 → 인계) sub-task 분해.
4. **tasks.json sync** — 새 sub-task list.
5. 새 sub-task 진입 — 첫 sub-task 는 *기반층* (A RunStep ledger + F 검사관 catalog).

### 진입 우선순위 (A2 메모리 §"진입 순서" 그대로)

1. F (즉시 시작 — 다른 후보의 평가 기준 + R12-C2 Round 1 정리와 병행 안전)
2. A (T10c closeout 흡수 직후 — 새 sub-task 진입 전 기반 설치)
3. B + E + G (R12-C2 부서 회의 흐름 sub-task 와 함께)
4. H (D-B 흐름 P5~P8 안에서 인계 정리 + 진행률)
5. C (회의↔큐 연결 정책 합의 후)
6. D (A 위에 additive)

### 8후보 (사무실 메타포)

- **A** RunStep 영속 기록부
- **B** NextStep 결정 카드 (B1 = 안전 카드만 자동)
- **C** 큐 운영 시스템 (현장 배치판)
- **D** 의미 단위 알림 (situation cards)
- **E** 임무 카드 (capability manifest)
- **F** 6 헌법 + 검사관 (F2 = 단계적 fail-closed 안전 경계)
- **G** 외주 의뢰서 정형화
- **H** 인계 진행률 surface (H1 = 대시보드 + H2 = 받는 부서 첫 화면)

## 평가 정책 (작성 시 준수)

- [feedback memory: 설계 옵션 제시 시 품질 우선](feedback_design_options_quality_first.md)
- 코드 품질 / 코드 정리 / 동작 안정성 *만*
- 작업량 / 난이도 / 일정 부담 X
- 절대 위반 금지 규칙 위반 옵션 = 옵션 자체에서 제외 (R3 / B2 / B3 가 이 사유로 제외됨)

## graphify 그래프 활용

- 위치: `graphify-out/` (main, 14M, 2026-05-05 13:57)
- hyperedge "Four runtime-stability pillars" = A + B + E + F (1:1 일치)
- hyperedge "Three reference projects → three runtime layers" = Symphony=운영 / oa-py=실행 / alex-core=invariant
- god nodes (invoke 66 / SSM 49 / SessionStateMachine 48) = R1 plan 의 *기반 sub-task* 가 가장 많이 건드릴 추상화

R1 plan 작성 시 그래프 hyperedge / surprising connection / god nodes 를 sub-task 분할 *단서* 로 활용.

## 컨텍스트 절약 팁

- 옵션안 (`docs/reports/analysis/2026-05-05-참고프로젝트-반영-옵션안.md`) 만 정독, 매트릭스 / 분석 / 영향분석 정독 X
- spec/ADR 는 *변경할 부분만* read
- graphify-out/GRAPH_REPORT.md + wiki/index.md 를 raw 코드 read 보다 우선
