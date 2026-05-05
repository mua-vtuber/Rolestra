# Rolestra v3 디자인

R11 Task 13 에서 정식 land 한 디자인 문서화 폴더. 시안 / 패키징 / 스크린샷 sign-off / 배포 안내를 단일 진입점으로 정리.

## 폴더 구성

| 항목 | 위치 | 비고 |
|------|------|------|
| 시안 (source-of-truth) | [`docs/Rolestra_sample/`](../Rolestra_sample/) | R3~R10 동안 land 된 6 화면 × 6 변형 시안 (HTML + JSX). **코드 import 의존성 (`tools/theme/extract-tokens.ts` / `src/renderer/theme/theme-tokens.ts` / `src/shared/__tests__/rolestra-sample-contract.test.ts`)** 으로 위치 이동 불가. |
| 패키징 가이드 | [`패키징.md`](패키징.md) | electron-builder + Windows NSIS + macOS dmg unsigned + Linux AppImage + Gatekeeper 우회 안내 (R11 Task 12 land) |
| 시안 정렬 체크리스트 | [`docs/Rolestra_sample/2026-04-19-theme-alignment-checklist.md`](../Rolestra_sample/2026-04-19-theme-alignment-checklist.md) | R5 prep 단계 — 시안 ↔ 코드 정렬 기준 (R5 messenger fidelity 분석 근거) |

## 6 화면 × 6 변형 시안

R3 시점 land. 코드 스타일 자동 생성 source.

| 화면 | HTML | JSX | 스크린샷 (시안) |
|------|------|-----|----------------|
| 01 Dashboard | [01-Dashboard.html](../Rolestra_sample/01-Dashboard.html) | [01-dash-variants.jsx](../Rolestra_sample/01-dash-variants.jsx) | `screenshots/01_*.png` (6 변형) |
| 02 Messenger | [02-Messenger.html](../Rolestra_sample/02-Messenger.html) | [02-msg-variants.jsx](../Rolestra_sample/02-msg-variants.jsx) | `screenshots/02_*.png` |
| 03 Approvals | [03-Approvals.html](../Rolestra_sample/03-Approvals.html) | [03-apv-variants.jsx](../Rolestra_sample/03-apv-variants.jsx) | `screenshots/03_*.png` |
| 04 Queue | [04-Queue.html](../Rolestra_sample/04-Queue.html) | [04-q-variants.jsx](../Rolestra_sample/04-q-variants.jsx) | `screenshots/04_*.png` |
| 05 Settings | [05-Settings.html](../Rolestra_sample/05-Settings.html) | [05-set-variants.jsx](../Rolestra_sample/05-set-variants.jsx) | `screenshots/05_*.png` |
| 06 Onboarding | [06-Onboarding.html](../Rolestra_sample/06-Onboarding.html) | [06-ob-variants.jsx](../Rolestra_sample/06-ob-variants.jsx) | `screenshots/06_*.png` |

6 변형 = 3 테마 (Warm / Tactical / Retro) × 2 모드 (Light / Dark).

## 6 테마 디자인 토큰

[`docs/Rolestra_sample/theme-tokens.jsx`](../Rolestra_sample/theme-tokens.jsx) 가 single source of truth.
빌드 시 자동 생성 산출물:
- `src/renderer/theme/theme-tokens.ts` — TypeScript 타입 + 상수
- `src/renderer/styles/tokens.css` — CSS variable

`npm run theme:build` 가 idempotent 변환 (R3 D2). `npm run theme:check` 가 diff 0 검증.

## 형태 토큰 (R10 D4)

R3 시점 도입한 5 형태 토큰을 R10 에서 모든 surface 에 정식 wire:
- `panelClip` — 패널 모서리 클리핑 (Tactical 12 분절 / Retro ASCII / Warm round)
- `cardTitleStyle` — 카드 제목 스타일
- `miniBtnStyle` — 작은 버튼 스타일
- `gaugeGlow` — 게이지 글로우
- `avatarShape` — 아바타 형태 (`circle` / `square` / `status`)

## 12 스크린샷 sign-off (R10 Task 7 + R11 Task 16)

R10 Task 7 정식 게이트로 land 된 형태 토큰 fidelity 검증의 12 PNG 캡처는
`docs/specs/appendix/r10-evidence/screenshots/` 에서 관리한다.

R10 시점 sign-off 진행 상황은 [`appendix-r10-evidence/README.md`](../superpowers/specs/appendix-r10-evidence/README.md) 참조.

R11 Closeout (Task 16) 에서 Windows native + macOS native 빌드 시 12 PNG
수집 + 사용자 sign-off 완료 후 본 문서에서 status 갱신. WSL 환경에서는 GTK/Vulkan
의존으로 native 캡처 불가.

| 스크린샷 | R11 status |
|----------|-----------|
| warm-light-dashboard.png | sign-off pending (Closeout) |
| warm-light-messenger.png | sign-off pending |
| warm-dark-dashboard.png | sign-off pending |
| warm-dark-messenger.png | sign-off pending |
| tactical-light-dashboard.png | sign-off pending |
| tactical-light-messenger.png | sign-off pending |
| tactical-dark-dashboard.png | sign-off pending |
| tactical-dark-messenger.png | sign-off pending |
| retro-light-dashboard.png | sign-off pending |
| retro-light-messenger.png | sign-off pending |
| retro-dark-dashboard.png | sign-off pending |
| retro-dark-messenger.png | sign-off pending |

추가 surface (R10 Task 14 closeout 직전 보강):
- `*-settings-tabs.png` (10 탭 모두 mount)
- `*-approval-inbox.png` (CircuitBreakerApprovalRow 포함)

## design polish 라운드 1·2 (R10 closeout 직후)

| 라운드 | commit | 핵심 |
|--------|--------|------|
| 1차 | `b35a7d3` | Approvals 필터바·상태 배지 + Queue ASCII status mark |
| 2차 D | `281b6bd` | Card retro ASCII frame + tactical corner brackets |
| 2차 C | `0485ddc` | Queue 4-stat strip + active spotlight |
| 2차 A | `dc4a763` | Onboarding pre-office wizard (시안 06 step 2/5) |
| 2차 B | (R11 이월) | Approvals 상세 패널 — R11 Task 7 commit `7a034c5` 에서 land |

## V4 forward pointers (R11 종료 후 차기 메이저)

- Hero strip 통합 (G5)
- InsightStrip footer 변경 (G4)
- Queue 6-column 테이블 (Q3)
- Onboarding 시안 06 step 3/4/5 페이지 풍부화 (시안 추가 캡처 대기)
- DM read-receipt / typing indicator 실 이벤트
- 음성 메모 / 파일 첨부 드래그앤드롭
- ComfyUI / SD 연동 (메모리 `rolestra-idea-comfyui-sd.md`)
