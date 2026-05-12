---
name: R12-C2 T16c 종결 — playwright-snapshot 본체 + DesignPreview UI + step 7c handoff (P3 진입 5 호 split, 2026-05-06)
description: T16 (디자인 부서 7 단계 + Playwright snapshot) 의 *snapshot 본체* + DesignPreview UI + step 7c handoff wire 누적 land. T16a/T16b 위에 9 파일 / +1350 / -31. T16 통째 종결.
type: project
originSessionId: d1e978e9-ebce-4741-9c49-c34e698cbe44
---
# R12-C2 T16c 종결 (2026-05-06)

worktree `feat/r12-c2-redesign-r2`, base `fc88d53` = T16b. T16c production commit `e1e27f0`.
10 파일 / +1350 / -31 (lint 룰 fix 포함). work-log mirror 미발행 — T16 = T16a+T16b+T16c 누적 후 단일 mirror 권장 (다음 진입 시점).

**Why:** T16b 의 generating_snapshot placeholder throw 를 실제 본체로 교체 — 디자인 부서 회의가 outcome='aborted'/snapshot_failed 로 항상 끝나던 상태를 정상 happy-path (committed + snapshot paths) 로 land. step 7c handoff 도 풀세트의 runHandoffPhase 재사용으로 wire — design-workflow 7-step 통째 종결.

**How to apply:** 새 세션 진입 시 (a) T16 work-log mirror 1 회 (T16a/T16b/T16c 누적 본문) — docs/reports/work-log/ 안 단일 entry, (b) T17 (review-workflow + audit-workflow) 권장 — P3 진입 6 호. T16c 안 DesignPreview 는 standalone 컴포넌트로 land — T18 SsmBox DesignVariant 가 children 으로 흡수 예정 (props 시그니처 그대로).

## 핵심 결정

- **Playwright 의존성 X** → Electron BrowserWindow show:false + loadURL(data:...) + webContents.capturePage() 로 contract 충족. 파일 이름은 spec convention `playwright-snapshot.ts` 유지 (혼동 회피 주석 module 헤더).
- **electron import 격리** — DesignSnapshotService 본체는 Node-only vitest 환경에서도 import 가능. production 어댑터 (electron-snapshot-capture.ts) 만 BrowserWindow import. notification-service / electron-notifier-adapter 와 같은 패턴.
- **javascript:false + sandbox + contextIsolation** — spec §11.18.9d 정적 mockup 가정 + 캡처 결정성 + 보안 격리 동시. data: URL 사용으로 file:// 접근 불가.
- **Step 7b 실패 시 회의록은 land** — snapshot 만 X. spec §11.18.9d 부합. caller (runDesignWorkflow) 의 통합 catch 가 `abortReason='snapshot_failed'` 로 매핑.
- **DesignPreview cache keyed by meetingId** — useEffect 안 setState 분리 패턴 대신 derived 형태 (`cache.meetingId === meetingId ? cache.payload : null`) 로 React 19 cascading-render lint 룰 회피.
- **inspector allowlist** — `src/main/snapshot/` 추가는 ArenaRoot/consensus 산출물 작성자 분류 결정. meeting-minutes-service (`src/main/meetings/`) 와 같은 카테고리 — 다만 minutes 는 baseline 에 이미 포함된 상태로 미추가, snapshot 은 새 모듈이라 allowlist 추가 (미래 동급 모듈 들어올 때 같은 패턴 적용).

## 산출 9 항목

1. **`src/main/snapshot/playwright-snapshot.ts` (신규, 263 lines)** — `DesignSnapshotService` class. PathGuard 봉인 (path.resolve + startsWith) + atomic write (tmp+rename) + viewport 분기. exports: `DESIGN_SNAPSHOT_DESKTOP_VIEWPORT/MOBILE_VIEWPORT` (1280x720 / 375x812) + `DESIGN_SNAPSHOT_DESKTOP_FILENAME/MOBILE_FILENAME` + `SnapshotPathOutsideConsensusError` + `SnapshotCaptureError(viewport)` + `SnapshotCaptureFn` contract.
2. **`src/main/snapshot/electron-snapshot-capture.ts` (신규, 75 lines)** — production `SnapshotCaptureFn` 어댑터. `createElectronSnapshotCapture()` factory → BrowserWindow off-screen + capturePage + destroy. data URL 변환 helper (`htmlToDataUrl`).
3. **`src/main/snapshot/__tests__/playwright-snapshot.test.ts` (신규, 240 lines)** — unit 6 (정상 흐름 / PathGuard `..` escape 차단 / capture throw → SnapshotCaptureError(desktop) + mobile skip / 빈 PNG buffer → SnapshotCaptureError / mobile-only fail (desktop 1 회 land 후 mobile throw) / atomic write 패턴 — tmp 파일 → rename).
4. **`src/main/meetings/engine/meeting-orchestrator.ts` (+135/-31)** — `runGeneratingSnapshotPhase` 본체 wire (placeholder throw 교체) + step 7c handoff (`runHandoffPhase`) wire + `findLatestDesignImplementationOpinion` 가 `{id, content}` 반환으로 확장 (빈 content throw 가드) + `designSnapshotService` deps 추가 + `DesignSnapshotPaths` import + catch 블록 주석 갱신.
5. **`src/main/meetings/engine/__tests__/meeting-orchestrator.test.ts` (+441 lines)** — design happy-path 2 건. (1) committed: snapshot 호출 + sourceOpinionUuid='op-3' (3 root 누적 후 마지막 = step 6 = design_implementation) + emitDesignSnapshotReady payload 검증 + meetingService.finish('accepted'). (2) snapshot_failed: captureDesignSnapshot throw → outcome aborted, 회의록 compose 2 회 land 검증 (snapshot 만 X).
6. **`src/main/index.ts` (+18 lines)** — DesignSnapshotService 인스턴스화 + createElectronSnapshotCapture 어댑터 wire + orchestrator factory deps 주입 (`designSnapshotService`).
7. **`src/renderer/features/messenger/DesignPreview.tsx` (신규, 145 lines)** — desktop/mobile 탭 UI. stream:design-snapshot-ready 구독 + meetingId 일치 시만 캐시 갱신 + 빈 상태 2 종 (no-meeting / pending) + file:// URL 변환 (`pathToFileUrl` — Windows backslash 정규화). `data-testid` 4 개 (T18 SsmBox 통합 시 e2e 활용).
8. **`src/renderer/i18n/locales/{ko,en}.json` (+8 ko / +8 en)** — messenger.designPreview namespace 6 키. `emptyNoMeeting` / `emptyPending` / `tabsAriaLabel` / `tabDesktop` / `tabMobile` / `imgAlt({{viewport}})`.
9. **`tools/inspectors/approval-bypass.ts` (+5 lines)** — `src/main/snapshot/` writer allowlist 추가. 4 hits 흡수 → T16b baseline 95 매치.

## 검증

- typecheck:node + typecheck:web **0**
- vitest **3400 PASS / 13 skip / 0 fail** (T16b 3392 + 8 신규 = snapshot 6 + orchestrator design happy-path 2)
- inspect:safety **95** (T16b 동일 — T16c 위반 **0**, allowlist 추가로 +4 hit 흡수)
- lint **clean** for 신규 파일 (DesignPreview / playwright-snapshot / electron-snapshot-capture / 테스트)
- pre-commit inspector hook PASS

## 다음 권장 진입

1. **T16 work-log mirror 1 회** — `docs/reports/work-log/2026-05-06-r12-c2-t16-design-workflow.md` (T16a/T16b/T16c 누적 본문 단일 entry).
2. **T17 (review-workflow + audit-workflow)** — P3 진입 6 호. tasks.json id=18. blockedBy = T14 + T15 (둘 다 land 종결).
3. T16b 안 capability-first-match resolver 는 T23 (E. designated-worker-resolver) land 시점에 정식 resolver (부서장 핀 + drag_order + fallback) 로 교체 — `resolveDesignatedWorker` 함수 시그니처 호환 유지하면 helper 통째 삭제.

## 미land / 미완성 잔여 (T16 외부)

- **T18 SsmBox DesignVariant 통합** — DesignPreview 를 SsmBox 우측 패널에 흡수. 현재는 standalone 컴포넌트로 land. T18 진입 시 props { meetingId } 그대로 사용.
- **DesignPreview 테스트** — vitest snapshot 미land. 현재는 typecheck + lint clean 만. T18 시점에 SsmBox 통합 테스트 안에서 같이 커버 권장.
- **e2e** — Playwright Electron 으로 실제 BrowserWindow capture → ArenaRoot PNG land → DesignPreview img src 검증은 P3 마무리 / T28+ 사용자 dogfooding 시점.
