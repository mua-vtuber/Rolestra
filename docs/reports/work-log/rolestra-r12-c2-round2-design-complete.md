---
name: R12-C2 Round 2 설계 종결 — spec + ADR + plan + tasks.json land + T11 진입 가이드 (2026-05-05)
description: Round 2 설계 단계 (Task #1~#4) 통째 land + commit `d74c390` + T11 (F 검사관 catalog phase 1) 진입 가이드
type: project
originSessionId: 0e0261af-bf48-4d01-a5ab-f3fe6adffd1a
---
## 종결 상태 (2026-05-05)

R12-C2 Round 2 *설계 단계* 통째 land. 코드 변경 0 (docs 5 파일만). worktree commit `d74c390` (`feat/r12-c2-redesign-r2` 위, base `8e6a602`).

### 5 파일 변경 요약

| 파일 | 변경 | 핵심 |
|------|------|------|
| `docs/specs/2026-05-01-rolestra-channel-roles-design.md` | +341 lines | §11.18.8 (B1 카드 7종) + §11.19 (A RunStep) + §11.20 (F 검사관 catalog) + §11.21 (H1 대시보드) + §11.22 (H2 인계 패키지) 5 섹션 신규 |
| `docs/decisions/r12-c2-reference-projects-absorb.md` | 신규 266 lines | ADR D1~D8 — 4 사용자 결정 (R1/B1/H1+H2/F2) + 8 후보 도입 + Round 1 종결 + 진입 우선순위 |
| `docs/decisions/README.md` | +3 lines | R12-S / R12-C / R12-C2 ADR 3 row 추가 |
| `docs/plans/2026-05-04-rolestra-phase-r12-c2.md` | +407 lines | 통째 재작성 — Round 2 흡수 섹션 + P2~P8 sub-task 재분해 (T11~T42) + 의존 그래프 갱신 + Round 1 history + Round 2 진입 가이드 |
| `docs/plans/2026-05-04-rolestra-phase-r12-c2.md.tasks.json` | 통째 재작성 | 44 entries (Round 1 완료 12 + Round 2 신규 32). planPath 정정. ID = 0~43 (id 12~ = T-number 11~ 매핑) |

### 사용자 결정 cycle 적용

사용자가 명시 확인한 작업 cycle = **설계 → 구현 → 설계 문서에 맞게 구현되었는지 검토 → 맞게 구현되었으면 → 깃에 커밋 → 메모리 저장**.

설계 단계는 코드 변경 X 라 *검토 = 사용자 명시 승인* 으로 갈음. 사용자 승인 = "옵션 A 로 진행하자" (Q4 답).

---

## 사용자 결정 4 항 (Round 2 진입 입력)

| 항목 | 결정 | 근거 |
|------|------|------|
| 7.1 R12-C2 sub-task 재구성 | **R1** — 전체 재분해 | 8 후보 sub-task 단위 국소화 + 기존 plan 잔재 0 |
| 7.2 B 자율 정책 | **B1** — 안전 카드만 자동 | B2/B3 = 절대 위반 금지 규칙 #3 위반 가능 → 제외 |
| 7.3 H 진행률 surface | **H1 + H2** — 대시보드 합계 + 받는 부서 첫 화면 | 두 surface 정보 다름 (전체 어디까지 / 부서가 무슨 패키지) → 중복 X |
| 7.4 F 검사관 강도 | **F2** — 단계적 fail-closed (안전 경계 한정) | F1 = 절대 규칙 갭 / F3 = 회피 패턴으로 무력화 → 둘 다 제외 |

### Q1~Q4 사용자 추가 답 (plan 재작성 직전)

| 결정 | 사용자 답 | 적용 |
|------|----------|------|
| Q1 검사관 룰 한꺼번에 vs 나눠서 | **한꺼번에 12 카테고리** (엮이고 꼬임 방지) | T11 = 12 카테고리 통째 작성 (안전 7 + 비안전 5) report-only |
| Q2 migration 020 시점 | **초반 (mig 019 직후)** | T12 = T11 직후 진입 |
| Q3 C 큐 surface 위치 | **메신저 채팅창 상단 strip + 프로젝트 대시보드 위젯** + 디자인 대화 타이밍 필요 | T31 (디자인 라운드) → T32 (land) / T39 (대시보드 라운드) → T40 (land) |
| Q4 새 plan 에 P1/P1.5 history | **옵션 A — 함께 적기** | Round 1 land 자산 표 한 줄씩 (T0~T10b) + 자세한 결정은 ADR / 옛 plan reference |

---

## Round 2 phase 분할 (T11~T42, 32 sub-task)

```
P2 기반층 (T11~T13)
  T11 F. 검사관 catalog phase 1 — 12 카테고리 report-only
  T12 A. migration 020 + RunStepService skeleton
  T13 B. NextStep classifier + Orchestrator wire (RunStep 영속 포함)

P3 부서 workflow (T14~T19)
  T14 MessageRenderer 카드 variant
  T15 idea-workflow / T16 design-workflow + Playwright / T17 review/audit-workflow
  T18 SsmBox 5 variant 통합
  T19 RunStep aggregator (H1 데이터 source)

P4 일반 [##] (T20~T22)
  T20 [##] 파서 + 의견 게시 모달 / T21 SsmBox final / T22 RunStep 분기

P5 구현 + 검증 (T23~T26)
  T23 E. 임무 카드 schema + designated-worker-resolver
  T24 implement-workflow (simple 1 명) / T25 audit NG → 기획 / T26 ExecutionService RunStep

P6 인계 + 큐 + 알림 (T27~T34)
  T27 G. handoff_dispatch + migration 021
  T28 HandoffApprovalModal + B handoff_mode 우회 wire
  T29 H2 받는 부서 첫 화면 / T30 D 검토→리뷰 Notification (#1)
  T31 [디자인 라운드 1] C 큐 surface 시안 / T32 C 큐 land
  T33 변경 요청 모달 / T34 D 알림 #2~4

P7 편의 + 대시보드 + H1 + F2 phase 2 (T35~T41)
  T35 프로젝트 삭제 / T36 부서장 핀 mig 022 / T37 멤버 드래그
  T38 [디자인 라운드 2 + land] 스킬 질문 시스템
  T39 [디자인 라운드 3] 대시보드 layout / T40 대시보드 land + H1
  T41 F2 phase 2 fail-closed 전환 (안전 경계 7)

P8 closeout (T42)
  T42 ADR + 구현현황 + cross-cutting C8/C9 + main merge
```

**병렬 가능 구간**: P3 + P4 (T13 후) / P3 안 T15+T16+T17 / P5 안 T24+T25+T26 / P7 안 T35+T36+T37.

**디자인 라운드 진입 게이트 3 개**: T31 (C 큐) / T38 (스킬 질문) / T39 (대시보드 layout).

---

## 다음 작업 = T11 진입 (F. 검사관 catalog phase 1)

### 왜 T11 부터 (ADR D8 우선순위)

1. F = 다른 후보 (A/B/C/D/E/G/H) 의 *평가 기준*
2. phase 1 = report-only → 빌드 차단 X → land 부담 작음
3. Round 1 정리 작업 (T10b 종결 직후) 와 병행 안전 (코드 변경 룰 추가만)

### T11 acceptance (spec §11.20)

**산출:**
- `tools/inspectors/<category>.ts` 12 파일:
  - **안전 7**: secrets-plaintext / exec-shell-string / mig-non-idempotent / mig-non-forward-only / ipc-untyped-invoke / approval-bypass / path-guard-bypass
  - **비안전 5**: ui-string-hardcoded / mock-fixture-import / magic-number / duplicate-constant / unused-export
- `tools/inspectors/run.ts` (실행 엔트리, severity 분기 placeholder — phase 1 = 모두 report-only)
- npm scripts: `inspect` (전체) + `inspect:safety` (안전 7)
- pre-commit hook (변경 파일 한정) + pre-push hook (전체, report-only)
- 출력: `tools/inspectors/report.json` (gitignore + CI artifact)

**Verify:**
- 12 카테고리 모두 작성 + `npm run inspect` 실행 시 보고서 생성
- report-only 단계 = 빌드 차단 X
- pre-commit + pre-push hook wire
- typecheck 0 / vitest baseline (3230) 유지

### T11 작업 흐름 (cycle)

1. **구현** — 12 카테고리 룰 + run.ts + npm scripts + CI hook
2. **검토** — qa agent 또는 self-검토 (spec §11.20 acceptance 대비)
3. **commit** — 검토 PASS 시 ff commit
4. **메모리** — sub-task 종결 메모리 (다음 = T12 진입 가이드)

### 워크트리 환경

- 위치: `/mnt/d/Taniar/Documents/Git/Rolestra-r12c2-r2`
- 브랜치: `feat/r12-c2-redesign-r2`
- base: `8e6a602` (main HEAD)
- 현재 tip: `d74c390` (Round 2 설계 land)
- node_modules: `npm install` 1 회 필요 (T11 진입 직전)

### 검증 baseline (Round 2 진입 시점)

- vitest **3230 PASS / 13 skip / 0 fail** (Round 1 T10b 종결)
- typecheck:node + typecheck:web **0 error**
- lint baseline 유지

---

## 컨텍스트 절약 팁 (다음 세션)

- 본 메모리 + ADR (`docs/decisions/r12-c2-reference-projects-absorb.md`) 만 정독
- spec 은 §11.20 (F 검사관 catalog) 만 read — 나머지 §11.18.8 / §11.19 / §11.21 / §11.22 는 T13 / T12 / T40 / T29 진입 시점에 read
- plan 은 T11 단락만 read (line 별 jump)
- tasks.json 의 id=12 (T11) row 만 read
- 매트릭스 / 분석 / 옵션안 = 정독 X (이미 ADR 에 결론 정리됨)
