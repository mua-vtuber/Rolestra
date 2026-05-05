# inspectors — R12-C2 T11 (F. 검사관 catalog phase 1)

6 헌법 (SSoT / SoC / Consistency / Atomicity / Idempotency / NoSilentFallback)
위반 검출 룰 set. CLAUDE.md 절대 위반 금지 규칙 7 항의 *코드 표현*.

spec: `docs/specs/2026-05-01-rolestra-channel-roles-design.md` §11.20
plan: `docs/plans/2026-05-04-rolestra-phase-r12-c2.md` T11

## 카테고리 (12)

### 안전 경계 7 — phase 2 fail-closed 후보

| 카테고리 | 헌법 | 룰 |
|---------|------|-----|
| `secrets-plaintext` | NoSilentFallback | safeStorage 우회 평문 저장 |
| `exec-shell-string` | Atomicity | child_process.exec / shell: true |
| `mig-non-idempotent` | Idempotency | CREATE TABLE 가 IF NOT EXISTS 없음 |
| `mig-non-forward-only` | SSoT | migration 안 DROP / RENAME |
| `ipc-untyped-invoke` | SoC | ipcRenderer.invoke 직접 호출 |
| `approval-bypass` | NoSilentFallback | fs.write 가 허가 writer 모듈 밖 |
| `path-guard-bypass` | NoSilentFallback | fs.write 가 PathGuard 미참조 |

### 비안전 영역 5 — 항상 report-only

| 카테고리 | 헌법 | 룰 |
|---------|------|-----|
| `ui-string-hardcoded` | Consistency | renderer 안 평문 한글 |
| `mock-fixture-import` | NoSilentFallback | production 파일이 fixture import |
| `magic-number` | SSoT | 숫자 literal >= 1000 (보수적) |
| `duplicate-constant` | SSoT | 같은 문자열이 3+ 파일 등장 |
| `unused-export` | SoC | named export 가 어디서도 import 안 됨 |

## 사용법

```bash
npm run inspect           # 전체 (12 카테고리)
npm run inspect:safety    # 안전 7 만
```

세부 옵션 (직접 호출):

```bash
tsx tools/inspectors/run.ts --safety
tsx tools/inspectors/run.ts --changed src/main/foo.ts src/renderer/bar.tsx
tsx tools/inspectors/run.ts --phase=2  # 안전 카테고리 hit > 0 = exit 1
tsx tools/inspectors/run.ts --silent   # 콘솔 출력 X (CI artifact 만)
```

## 출력

- **콘솔**: 카테고리별 hit count + 상위 10 hit
- **JSON**: `tools/inspectors/report.json` (gitignore — CI artifact 만)

## Phase 정책 (spec §11.20.3)

| Phase | 효과 | 상태 |
|-------|------|------|
| phase-1 | 모두 report-only — 빌드 차단 X | **현재** (R12-C2 T11) |
| phase-2 | 안전 7 카테고리 = `exit 1` | T41 진입 시 (false positive 0 + 사용자 승인) |

phase 1 의 목적 = false positive 정리 + 룰 정확도 검증. 룰을 add 한 직후
`npm run inspect` 실행 → false positive 패턴을 룰 안 allowlist 로 회수 →
다시 inspect → 모든 안전 룰의 false positive 0 건 확인 후 phase 2 진입.

## 회피 주석

`// inspector-disable-next-line <category> <reason>` 으로 다음 줄 한정 회피
가능. phase 1 = 자유. phase 2 = 안전 카테고리는 PR review 에서 reason 검증
강제.

## CI hook

`.githooks/pre-commit` (변경 파일 한정 — 빠른 피드백) + `.githooks/pre-push`
(전체 — phase 1 = report-only). `prepare` npm script 가 자동으로
`git config core.hooksPath .githooks` 적용 — 별도 husky 의존 X.

`--no-verify` 로 우회 가능 (phase 1 정책 부합). phase 2 진입 시 안전
카테고리 hit > 0 면 빌드 자체 (CI) 가 실패.

## 룰 추가 절차

1. `tools/inspectors/<category>.ts` 신규 — `Inspector` 인터페이스 구현
2. `tools/inspectors/types.ts` 의 `Category` union 에 카테고리 추가
3. `tools/inspectors/run.ts` 의 `ALL_INSPECTORS` 에 import 추가
4. `npm run inspect` 실행 — false positive 정리 → allowlist 갱신
5. README 표 업데이트
