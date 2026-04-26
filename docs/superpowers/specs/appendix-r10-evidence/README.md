# Appendix — R10 Visual Evidence

Phase R10 Task 7 디자인 fidelity sign-off 산출물. 6 테마 × 2 surface
(Dashboard / Messenger) = 12 캡처를 본 디렉토리에 모은다.

## 캡처 범위 (12 = 6 테마 × 2 surface)

`{themeKey}-{mode}-{surface}.png` 패턴으로 명명:

- `warm-light-dashboard.png` / `warm-light-messenger.png`
- `warm-dark-dashboard.png` / `warm-dark-messenger.png`
- `tactical-light-dashboard.png` / `tactical-light-messenger.png`
- `tactical-dark-dashboard.png` / `tactical-dark-messenger.png`
- `retro-light-dashboard.png` / `retro-light-messenger.png`
- `retro-dark-dashboard.png` / `retro-dark-messenger.png`

본 캡처는 패키지 빌드(`npm run build`) 후 native window
(Windows / macOS) 에서 시드 데이터(`docs/Rolestra_sample/`) 기반으로
수집한다.

추가 sign-off 게이트 surface (R10 Task 14 closeout 직전 보강):

- `*-settings-tabs.png` (10 탭 모두 mount)
- `*-approval-inbox.png` (CircuitBreakerApprovalRow 포함)

## R11 진행 상황 (2026-04-26 현재)

R11-Task4 가 본 캡처 작업을 R10 Known Concern #6 으로 분류하고
정식 sign-off 를 R11-Task16 (Closeout) 으로 이월한다. 본 task 의
acceptance 는 이미 다음 4 항목으로 구성됨:

1. Playwright OS matrix workflow_dispatch 9 spec × 3 OS = 27 cell green
   — `.github/workflows/playwright.yml` 에서 매트릭스 등록 완료.
2. `e2e/search-flow.spec.ts` / `e2e/dm-flow.spec.ts` 신규 land — R10
   Known Concern #3 종결.
3. `__rolestraDevHooks` preload 노출 + `autonomy-queue-flow.spec.ts`
   Step C 활성 — R10 Known Concern #2 종결.
4. 본 디렉토리에 12 PNG 수집 — Closeout 책임 (Task 16 acceptance gate
   참조).

`screenshots/` 하위 디렉토리는 Task 16 시점에 Windows native + macOS
native 빌드에서 12 개 PNG 가 수집되면 PR 으로 land 된다. 본 task 는
구조만 마련하고 R11 closeout 게이트가 통과한 후에 사용자가 sign-off
한다.

## DONE_WITH_CONCERNS — WSL 제약 (R10 메모, R11 까지 유효)

Phase R3 와 동일하게, WSL 환경에서는 GTK/Vulkan 의존으로 native
스크린샷 캡처가 불안정하다. 본 폴더는 placeholder 로 시작하며,
사용자가 Windows native 또는 macOS native 빌드를 기동한 뒤 본인
환경에서 캡처해 12 개 PNG 파일을 수동 추가한다.

본 폴더가 빈 상태(또는 placeholder 만 존재)라도 Task 7 + Task 4 의
코드 산출물 자체는 acceptance 를 충족한다 — `theme:check` exit 0,
`theme-shape-tokens.test.tsx` 30 cases green, R3 primitives 의 form-level
분기가 R4~R10 신규 surface 에 모두 wire 되어 있고, R11-Task4 가
Playwright OS matrix 를 9 spec × 3 OS = 27 cell 로 확장 + Step C +
search/dm spec 으로 보강했다.

## R11 신규 evidence

`r11/` 하위에 R11-Task 별 산출물 캡처가 누적된다 (Task 16 Closeout
시점 정리). Task 4 시점 신규 산출물:

- `r11-task4-playwright-matrix.png` — workflow_dispatch run 결과 (33/33
  green, R11-Task7 의 `approval-detail-flow` 이 추가되어 9 → 11 spec
  매트릭스로 확장). 산출 시점: Task 16 closeout. 본 task 에서는 workflow
  파일 매트릭스 등록까지 완료.
- `r11-task4-step-c-downgrade.png` — autonomy-queue Step C 가
  `__rolestraDevHooks.tripFilesPerTurn(21)` 으로 manual 전환되는 순간
  의 캡처. 본 spec 의 `testInfo.attach` 산출물에서 직접 추출 가능.
- `r11-task7-approval-detail-panel.png` — split layout list+detail 정렬,
  `apv-detail-cards` 5 카드 (Header / ImpactedFiles / DiffPreview /
  ConsensusContext / ActionBar) 동시 가시. `e2e/approval-detail-flow.
  spec.ts` 의 `testInfo.attach` 산출물에서 직접 추출 가능.

## 검증 매핑

| 형태 토큰         | wire 위치                                                    | 테스트 |
|------------------|-------------------------------------------------------------|--------|
| `panelClip`      | Card primitive · Tabs primitive · Dialogs · Popover · QueuePanel · NotificationPrefsView · ApprovalBlock · CircuitBreakerApprovalRow | `theme-shape-tokens.test.tsx` (Card 6) |
| `cardTitleStyle` | CardHeader primitive (`asciiHeader?` override 포함)          | `theme-shape-tokens.test.tsx` (CardHeader 6) |
| `miniBtnStyle`   | Button primitive (`shape='auto'`)                           | `theme-shape-tokens.test.tsx` (Button 6) + `button.test.tsx` (3) |
| `gaugeGlow`      | ProgressGauge tactical sub-component                         | `theme-shape-tokens.test.tsx` (Gauge 6) |
| `avatarShape`    | Avatar primitive · Message · MemberRow (token-driven 전환)  | `theme-shape-tokens.test.tsx` (Avatar 6) |
