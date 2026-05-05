# R3 Done Checklist

> **Phase R3 — 레거시 이동 + 디자인 시스템 초기**
> Branch: `rolestra-phase-r3` (origin)
> Tip commit: see `git log --oneline rolestra-phase-r3` at R3 tip
> Plan: `docs/plans/2026-04-20-rolestra-phase-r3.md`

## Task completion matrix

| Task | Status | Commit |
|---|---|---|
| 1. Spec 갱신 (§7.2 / §7.5 / §7.10 / §10) | ✅ | `f7f554a` |
| 2. v2 renderer → `_legacy/renderer-v1/` | ✅ | `df5541f` |
| 3. New `src/renderer/` skeleton | ✅ | `a3b6a79` |
| 4. Tailwind + Radix + framer-motion + cva/clsx | ✅ | `677eedc` |
| 5. `theme-tokens.jsx` → TS + `tokens.css` auto-extract | ✅ | `4a4d5f7` |
| 6. ThemeProvider + zustand persist + tests | ✅ | `5a78fe4` |
| 7. Shell components (Shell/NavRail/ProjectRail/ShellTopBar/ProfileAvatar/LineIcon) | ✅ | (same commit chain) |
| 8. Primitives (Button/Card/Badge/Separator/Tooltip) | ✅ | |
| 9. App shell wire-up + dev theme-switcher (D3 C안) | ✅ | `499c6f3` |
| 10. i18n 15-domain constants + lint unblock | ✅ | `b86336b` |
| 11. Legacy channel appendix + isolation guard | ✅ | `1939467` |
| 12. R3 종료 확인 + R4 진입 체크리스트 | ✅ | (this document) |

Supporting commits:
- `f48cab4` — baseline: mockups + sample contract + plan
- `653fd50` — fix: gemini-config replace stale PromptOnlyPermissionAdapter (R2 leftover unblock for build)

## Verification — `npm run <check>` exit codes at R3 tip

| Check | Exit | Notes |
|---|---|---|
| `typecheck:web` | 0 | tsconfig.web.json excludes `src/**/__tests__/**` + `_legacy/**` |
| `typecheck:node` | 170 errors (pre-existing) | All in `src/main/**` test-only files referencing `migrations-v2` paths; unchanged by R3. Tracked for R11. |
| `lint` | 0 | 12 warnings, all `i18next/no-literal-string` on test fixtures (allowed by spec §7.10 — no literals in components/). |
| `i18n:check` | 0 | parser stable, ko/en key sets aligned. |
| `theme:check` | 0 | deterministic (two runs → no diff). |
| `build` | 0 | main 479kB, preload 1.36kB, renderer CSS 33.72kB + JS 685kB. |
| `test` | 2139 pass / 64 pre-existing fail / 6 skipped | Pre-existing failures are workspace-permission (27) + session-persistence (3) + v2 adapter leftovers; identical count to R2 tip. R3 added 30+ new tests across theme/shell/primitives/legacy-isolation — all green. |

## Design system artifacts

- **Tokens**: `src/renderer/theme/theme-tokens.ts` (ThemeToken interface + 6 THEMES + THEME_MATRIX + FONTS); `src/renderer/styles/tokens.css` (7 blocks: :root fallback + 6 combos).
- **Provider**: `src/renderer/theme/theme-provider.tsx` + `theme-store.ts` (zustand persist `rolestra.theme.v1`) + `use-theme.ts` hook. FOUC-prevention inline script in `src/renderer/index.html`.
- **Shell**: 6 components in `src/renderer/components/shell/` — Shell, NavRail, ProjectRail, ShellTopBar, ProfileAvatar, LineIcon (17-icon set ported from mockup).
- **Primitives**: 5 components in `src/renderer/components/primitives/` — Button (shape=auto maps miniBtnStyle token), Card + sub-parts (cardTitleStyle token), Badge, Separator (Radix), Tooltip (Radix portal).
- **i18n**: `src/renderer/i18n/keys.ts` with `I18N_NAMESPACES` listing all 15 R4+ domains. Current populated domains at R3 tip: `app`, `shell`, `theme`.

## Legacy isolation

- v2 UI moved to `_legacy/renderer-v1/` via `git mv` (history preserved).
- `docs/specs/appendix/legacy-channels.md` — 27-entry table (channel → caller → R11 replacement).
- `src/renderer/__tests__/legacy-channel-isolation.test.ts` — fails CI if any v3 renderer file references a legacy channel literal.
- `src/main/ipc/router.ts` warnOnceLegacy continues to log per-channel when legacy UI hits v2 IPC (R11 removal target).

## Spec §10 pointer

§10 R3 checklist updated inline with ✓ marks + artifact paths. See `docs/specs/2026-04-18-rolestra-design.md` §10 at R3 tip.

## Manual verification

- **6 테마 × 2 모드 screenshot capture** — ✅ 완료 (2026-04-20). `docs/specs/appendix/r3-evidence/` 에 6 PNG + README. 실제 Electron 런타임에서 DevThemeSwitcher 전환으로 캡처. 모든 테마 조합이 동일 레이아웃 유지하고 정보 밀도 동일, 시각 정체성(Warm amber / Tactical cool gray + cyan / Retro sepia·green)만 달라지는 것 확인.

## R4 entry conditions

Ready to enter **Phase R4 — 대시보드 + 프로젝트 관리** when:

- [x] Shell renders in 6 theme combos without layout drift (Shell.test.tsx matrix pass).
- [x] Tokens pipeline deterministic — changes to `docs/Rolestra_sample/theme-tokens.jsx` regenerate both .ts and .css with no drift.
- [x] IPC boundary clean — no legacy channel literals in v3 renderer (legacy-channel-isolation pass).
- [x] Design primitives ready for Dashboard blocks — Button/Card/Badge surfaces cover dashboard widget skeletons.
- [x] **Manual screenshot pass** — 6 PNG committed under `appendix-r3-evidence/`.
- [ ] **R3 merge to main** — pending user decision.

Once screenshots land and R3 is merged, R4 can begin. R4 work opens `dashboard.*` i18n domain, populates Hero 4 KPI tiles + 4 widgets + Insight strip + ProjectSwitcher block, wires IPC `project:*` / `member:*` / `meeting:*` from R2.

## Scope trades recorded

- **Blocks MessageBubble/MemberCard/ChannelItem/ApprovalCard/DashboardWidget/ProjectSwitcher** deferred to R4+ per spec §10 R3 bullet (re-quoted in plan Self-Review §1). R3 delivers Shell + 5 primitives; domain-tied blocks follow in each dedicated Phase.
- **Storybook not adopted** — DevThemeSwitcher + 6 data-theme combos provide enough local playground through `npm run dev` for R3's tokens/shell review.
- **tsconfig.node.json 170 pre-existing errors** left unresolved — they all live in `src/main/**/__tests__/**` referencing v2 migration paths. Migration test rewrite is outside R3's "move + design baseline" charter; tracked for R11 cleanup phase.
