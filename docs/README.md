# 문서 폴더 정책

Rolestra v3 의 모든 문서가 들어가는 디렉토리. 폴더는 **용도별로 분리**되어 있다 — 폴더만 보고 즉시 어떤 성격의 문서인지 식별 가능해야 한다.

## 폴더 분류 (영어 폴더명 + 한글 파일명)

| 폴더 | 용도 | 안에 들어가는 것 |
|------|------|----------------|
| **루트** (`docs/*.md`) | 권위 문서 — 자주 참조, 활발히 갱신 | 기능-정의서 / 설계-문서 / 코딩-규칙 / 완료-기준 / 구현-현황 |
| `decisions/` | ADR — 아키텍처 결정 기록 (왜 이렇게 했는가) | phase 별 묶음 ADR + cross-cutting + R12 도메인별 |
| `specs/` | 권위 spec — 단일 권위 design 문서 + 토픽별 design 갱신 | `2026-04-18-rolestra-design.md` (134 KB) + R12 design specs |
| `specs/appendix/` | spec 의 부록 — 토픽별 / phase 별 evidence | cli-matrix / legacy-channels / r3-evidence / r10-evidence |
| `plans/` | 실행 plan — phase 단위 작업 분해 + tasks.json | R1~R11 phase plan + R12-S / R12-C plan + 작은 작업 plan |
| `checklists/` | phase 완료 검증용 done-checklist | r3 ~ r11 done-checklist 9 건 |
| `reports/audit/` | 감사 리포트 — 구현 ↔ spec 일치 여부 검증 보고서 | `YYYY-MM-DD-<topic>-audit.md` |
| `reports/analysis/` | 분석 / 조사 보고서 — one-shot 조사 결과 | 참고프로젝트 분석 / WSL CLI 감지 설계 / messenger theme prep 등 |
| `archive/` | 옛날 계획서 — **재설계 필요** 표시. 즉시 폐기는 아니지만 그대로 구현 불가 | `YYYY-MM-DD-<주제>-재설계예정.md` |
| `design/` | 디자인 정식 (테마 시안 + 패키징) | README + 패키징.md |
| `Rolestra_sample/` | 디자인 시안 산출물 (html / jsx / screenshots) | 6 화면 × 6 변형 mockup |
| `superpowers/` | superpowers 플러그인 **받은편지함** — 새로 생성된 산출물 임시 보관 | 비어 있어야 정상. 새 산출물이 들어오면 위 폴더 (plans / specs / checklists / evidence) 로 이동 |

## 명명 규칙

- **권위 문서** (`docs/*.md`) — 한글 파일명 (`기능-정의서.md`, `설계-문서.md`)
- **plan / spec / report / archive** — 날짜 prefix 필수 형식 `YYYY-MM-DD-<주제>.md`
  - 예: `2026-05-05-참고프로젝트-분석.md`
  - 예: `2026-04-18-rolestra-design.md`
- **archive** — `재설계예정` suffix 로 식별
  - 예: `2026-02-21-메모리-RAG-재설계예정.md`
- **checklist** — `r{N}-done-checklist.md` (phase 번호)
- **decisions** — phase 별 묶음 또는 도메인별 (`R10-decisions.md`, `cross-cutting.md`, `r12-c-channel-roles.md`)

## superpowers 받은편지함 동작

`superpowers/` 폴더는 superpowers 플러그인이 새 산출물을 자동 생성하는 출구다. 새 plan / spec / checklist 가 그 안에 들어오면 **즉시 적절한 폴더로 이동**한다:

| superpowers 안 | 옮길 위치 |
|---------------|----------|
| `superpowers/plans/*.md` | `docs/plans/` |
| `superpowers/plans/*.tasks.json` | `docs/plans/` (plan 과 짝으로) |
| `superpowers/specs/*-design.md` | `docs/specs/` |
| `superpowers/specs/r*-done-checklist.md` | `docs/checklists/` |
| `superpowers/specs/appendix-*` | `docs/specs/appendix/` |
| `superpowers/specs/*-prep-*-analysis.md` | `docs/reports/analysis/` |

## 폴더가 비어보이면

- `superpowers/` 비어있는 게 정상 — 새 산출물 대기 상태
- `archive/` 가 비어있으면 좋은 신호 — 재설계 대기 문서가 없다는 뜻
- 그 외 폴더가 비어있으면 의심 — 구조가 바뀌었거나 정리 누락

## 정책 변경 이력

- 2026-05-05 — 폴더 구조 정식화. superpowers 산출물 외부로 이동, 영어 폴더명 통일, reports / archive 신설
