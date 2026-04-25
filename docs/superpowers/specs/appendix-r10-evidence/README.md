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

## DONE_WITH_CONCERNS — WSL 제약

Phase R3 와 동일하게, WSL 환경에서는 GTK/Vulkan 의존으로 native
스크린샷 캡처가 불안정하다. 본 폴더는 placeholder 로 시작하며,
사용자가 Windows native 또는 macOS native 빌드를 기동한 뒤 본인
환경에서 캡처해 12 개 PNG 파일을 수동 추가한다.

본 폴더가 빈 상태(또는 placeholder 만 존재)라도 Task 7 의 코드
산출물 자체는 acceptance 를 충족한다 — `theme:check` exit 0,
`theme-shape-tokens.test.tsx` 30 cases green, R3 primitives 의 form-level
분기가 R4~R10 신규 surface 에 모두 wire 되어 있다.

## 검증 매핑

| 형태 토큰         | wire 위치                                                    | 테스트 |
|------------------|-------------------------------------------------------------|--------|
| `panelClip`      | Card primitive · Tabs primitive · Dialogs · Popover · QueuePanel · NotificationPrefsView · ApprovalBlock · CircuitBreakerApprovalRow | `theme-shape-tokens.test.tsx` (Card 6) |
| `cardTitleStyle` | CardHeader primitive (`asciiHeader?` override 포함)          | `theme-shape-tokens.test.tsx` (CardHeader 6) |
| `miniBtnStyle`   | Button primitive (`shape='auto'`)                           | `theme-shape-tokens.test.tsx` (Button 6) + `button.test.tsx` (3) |
| `gaugeGlow`      | ProgressGauge tactical sub-component                         | `theme-shape-tokens.test.tsx` (Gauge 6) |
| `avatarShape`    | Avatar primitive · Message · MemberRow (token-driven 전환)  | `theme-shape-tokens.test.tsx` (Avatar 6) |
