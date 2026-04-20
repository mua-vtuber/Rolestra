# Rolestra Phase R3 — 레거시 이동 + 디자인 시스템 초기 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** v2 렌더러 코드를 격리(삭제 아님)하고, `docs/Rolestra_sample/`에서 락된 6 테마(warm/tactical/retro × light/dark) 디자인 시안을 실제 TypeScript + React + Tailwind 기반으로 정식화한다. R4(대시보드 + 프로젝트 관리)가 착수 가능한 **재사용 가능한 기반**까지만 만든다. 화면 콘텐츠는 R4 이후에 채운다.

**Overview (자연어, 비코더용):**

- 지금까지 v2에서 보이던 화면(좌측 프로젝트바 + 설정 뷰 + 기존 채팅 UI)은 **지워지지 않고** `_legacy/renderer-v1/`으로 이동한다. 빌드 경로에서 빠질 뿐, 참조가 필요한 경우 언제든 열어볼 수 있다.
- v2 UI가 사용하던 IPC 채널은 R2에서 이미 "레거시 경고"로 찍어두었고, 본 R3에서는 **경고를 유지한 채 새 렌더러로 전환**한다. 레거시 채널 자체의 제거는 R11.
- 새 렌더러는 시안 6 변형을 **정본**으로 간주한다. 디자인 토큰(색·간격·테두리 반경·폰트 등)은 `docs/Rolestra_sample/theme-tokens.jsx`에서 타입 안전한 TS로 옮기고, CSS variable + `data-theme` + `data-mode` 체계로 실제 DOM에 적용한다.
- R3 범위는 "골격만". 각 화면 안에 들어가는 실제 콘텐츠(대시보드 위젯/메신저 말풍선/결재함 등)는 R4 이후 각 Phase에서 채운다. R3가 끝나면 앱을 열었을 때 NavRail + ProjectRail + ShellTopBar + 빈 메인 영역이 **6 테마 전부에서 정확히 렌더되어야** 한다.
- spec 문서 §7.2 / §7.5 / §7.10 / §10은 **Task 1에서 먼저 갱신**한다. 구현이 문서를 앞서지 않도록 순서를 고정한다.

**Architecture:**

- Layering: `renderer(new) → shared → preload(contextBridge) → main`. 기존 구조 유지, 새 렌더러는 `src/renderer/` 자리에 다시 들어온다.
- Styling: Tailwind CSS + CSS variables. Tailwind는 **테마 색을 직접 쓰지 않고** `var(--color-*)`만 참조한다. `data-mode="dark"` 셀렉터로 darkMode 전환.
- Theme runtime: `ThemeProvider`가 `<html>`에 `data-theme` / `data-mode`를 세팅하고, `tokens.css`가 각 조합마다 CSS variable 블록을 정의한다. 6 조합 전부 **정적 CSS**로 발행(런타임 inline style 계산 없음) → 성능/캐시 친화.
- Components: Radix UI primitive 래핑 + `class-variance-authority(cva)` + `clsx`. 시안의 `shared-components.jsx`(NavRail/ProjectRail/ProfileAvatar/LineIcon/ShellTopBar)를 정식화.
- Framer Motion은 shell 레벨 motion 훅만 스캐폴딩. 실제 애니메이션은 R4 이후.
- Zustand `themeStore` 하나 추가(현재 theme/mode + persist). 나머지 스토어는 R5 이후.

**Tech Stack (R3 추가):**

- 기존: TypeScript strict / React 19 / Electron / Vite / Vitest / i18next / zod / zustand
- 신규: TailwindCSS / PostCSS + autoprefixer / @radix-ui/react-\* (minimum set) / framer-motion / class-variance-authority / clsx

**참조:**

- Spec: `docs/superpowers/specs/2026-04-18-rolestra-design.md` §7.2, §7.5, §7.10, §10
- 시안 정본 (락): `docs/Rolestra_sample/theme-tokens.jsx`, `docs/Rolestra_sample/shared-components.jsx`, `docs/Rolestra_sample/2026-04-19-theme-alignment-checklist.md`, `docs/Rolestra_sample/01-Dashboard.html` ~ `06-Onboarding.html`
- R2 레거시 경고: `src/main/ipc/router.ts:248` `LEGACY_V2_CHANNELS`
- 포맷 참고: `docs/superpowers/plans/2026-04-18-rolestra-phase-r1.md`, `docs/superpowers/plans/2026-04-18-rolestra-phase-r1.md.tasks.json`

---

## Prereqs

- [x] R2 Task 0–21 전부 완료(누적 22/22)
- [x] 시안 lock (`docs/Rolestra_sample/` 6화면 × 6변형 검토 완료)
- [x] R2 브랜치 origin push + main fast-forward 병합 + 로컬/원격 브랜치 삭제 (D1 결정 완료 — 2026-04-20)
- [x] `rolestra-phase-r3` 브랜치 `main`에서 생성 (2026-04-20)

---

## File Structure (R3 종료 시)

```
_legacy/
├── migrations-v2/                    # (기존)
└── renderer-v1/                      # R3 Task 2에서 이동
    ├── App.tsx
    ├── components/ ... (v2 전체 UI)
    ├── hooks/ ...
    ├── stores/ ...
    ├── i18n/ ...
    ├── styles/ ...
    ├── env.d.ts
    ├── index.html
    └── main.tsx

src/
  renderer/                           # R3에서 새로 만듦
    index.html                        # <html data-theme="warm" data-mode="light">
    main.tsx                          # createRoot + ThemeProvider + App
    App.tsx                           # Shell만 렌더, 라우트는 R4 이후
    env.d.ts
    i18n/                             # 빈 도메인 네임스페이스만 미리 선언
      index.ts
      locales/
        ko.json
        en.json
    styles/
      global.css                      # reset + font imports + base
      tokens.css                      # 6 테마 × CSS variable 블록 (자동 생성 권장)
    theme/
      theme-tokens.ts                 # 시안 jsx의 TS 정식화 (타입 + 상수 export)
      theme-provider.tsx              # data-theme/data-mode + store 연결
      theme-store.ts                  # zustand (persist)
      use-theme.ts                    # 훅
    components/
      shell/
        Shell.tsx                     # 전역 레이아웃 root (rail 64 + rail 240 + main)
        NavRail.tsx                   # 좌측 전역 네비
        ProjectRail.tsx               # 프로젝트/DM 목록
        ShellTopBar.tsx               # 사무실·시간·인사 한 줄
        ProfileAvatar.tsx             # default 8 + custom
        LineIcon.tsx                  # icon 래퍼
      primitives/
        button.tsx                    # cva + Radix slot
        card.tsx
        badge.tsx
        separator.tsx
        tooltip.tsx
      index.ts                        # barrel
    hooks/
      use-media-query.ts              # 추후 필요
  shared/                             # (기존 유지)
  preload/                            # (기존 유지)
  main/                               # (기존 유지)

tailwind.config.ts                    # content + theme.extend (var 참조) + darkMode selector
postcss.config.js                     # tailwindcss + autoprefixer
tools/
  theme/
    extract-tokens.ts                 # theme-tokens.jsx → theme-tokens.ts + tokens.css 생성기
```

**루트 변경점 요약:**

- `electron.vite.config.ts`: renderer root 경로는 그대로 `src/renderer` 지만, **기존 `src/renderer`가 비어 있어야** 정상 빌드됨 → Task 2에서 이동, Task 3에서 새 껍데기 생성.
- `package.json` dependencies: tailwindcss, postcss, autoprefixer, @radix-ui/react-slot, @radix-ui/react-tooltip, @radix-ui/react-separator, framer-motion, class-variance-authority, clsx 추가.
- `vitest.config.ts` include/exclude: `_legacy/renderer-v1/**` 제외, `src/renderer/**/__tests__/**/*.test.{ts,tsx}` 유지.
- `i18next-parser.config.js`: input path를 새 `src/renderer/**`로 유지 (이동 후 경로 동일 → 추가 작업 없음). `_legacy/` 제외 확인.

---

## Task 1: Spec 갱신 (§7.2 / §7.5 / §7.10 / §10)

**Goal:** 구현 전에 **문서를 먼저 바꾼다**(planner 원칙). 시안 lock 내용을 spec에 반영하고, R3 항목 템플릿을 체크박스+실제 산출물 필드로 확장.

**Files:**

- Modify: `docs/superpowers/specs/2026-04-18-rolestra-design.md`
  - §7.2 출근 상태 라벨 테이블 수정 (UI 라벨 "퇴근" → "외근", "연결끊김" → "점검 필요"). 영향 범위로 `MemberProfileService` 상수·번역키 식별(`member.status.offlineManual`, `member.status.offlineConnection`) 명시.
  - §7.5 대시보드 전면 재작성: 위젯 5종 → 4종(📝 공지 제거, Hero + Insight 띠로 흡수), 비대칭 2x2 그리드(`tasks tasks approvals / people recent approvals`), Hero(4 KPI + 빠른 액션 2), Insight 띠 문구(데이터 소스는 R4 이후), 진행률 게이지의 테마별 분기(warm=라운드, tactical=12분절 다이아 + alpha gradient, retro=ASCII `[█░]`).
  - §7.10 디자인 시스템: 6 테마 토큰 명시, CSS variable + `data-theme`/`data-mode` 분기 체계, 폰트 매트릭스(warm=Fraunces serif + sans / tactical=sans + mono(헤더·게이지) / retro=sans + mono(헤더·게이지)), 금지사항(게이미피케이션 단어 XP/CREDITS/LV/MISSION/REWARD/UNLOCK, 본문 모노폰트, 마케팅 카피 헤더, 테마 간 시각 정보 밀도 변경).
  - §10 R3 항목: 체크박스 + 실제 산출물 링크 필드 템플릿 갱신.
- Modify: `docs/superpowers/specs/2026-04-18-rolestra-design.md`의 §13 또는 부록으로 **시안 → TS 매핑 테이블** 1개 추가(선택). theme-tokens.jsx 키 ↔ theme-tokens.ts 타입 ↔ CSS variable 이름 3열 표.

**Acceptance Criteria:**

- [ ] §7.2 상태 표의 "UI 라벨" 컬럼이 4상태 전부 명시됨 (online / connecting / offline-connection="점검 필요" / offline-manual="외근")
- [ ] §7.5에 "위젯 4종" 명시 + 비대칭 2x2 그리드 ASCII 다이어그램 교체 + Insight 띠 문구 + 게이지 테마별 분기 표
- [ ] §7.10에 6 테마 × 토큰 schema(theme-tokens.jsx와 동일 key set) + CSS variable 명명 규칙(`--color-bg-canvas` 등) + 금지사항 bullet 포함
- [ ] §10 R3 항목이 체크박스 리스트로 변경되고, 각 항목에 "산출물" 줄 비워둠(구현 완료 시 채움)
- [ ] `grep -nE 'XP|CREDITS|LV |MISSION|REWARD|UNLOCK' docs/Rolestra_sample/` 에서 게이미피케이션 단어가 spec에 남아 있지 않음

**Verify:**

- `git diff docs/superpowers/specs/2026-04-18-rolestra-design.md` 리뷰로 §7.2/§7.5/§7.10/§10 네 곳 변경 확인
- 시안 정본(`docs/Rolestra_sample/theme-tokens.jsx`, `2026-04-19-theme-alignment-checklist.md`)과 용어·컬러 키 이름 일치 확인

---

## Task 2: v2 renderer를 `_legacy/renderer-v1/`로 격리

**Goal:** 현재 `src/renderer/` 전체를 `_legacy/renderer-v1/`로 이동한다. 삭제 금지. import 경로 변경 금지(옮긴 후 어느 곳에서도 import되지 않아야 함). `_legacy/migrations-v2/`와 동일 패턴.

**Files:**

- Move (preserve git history): `src/renderer/` → `_legacy/renderer-v1/`
- Modify: `vitest.config.ts` — include에서 `_legacy/renderer-v1/**/*` 배제, `tools/cli-smoke/__tests__/**` 및 `src/main/**/__tests__/**` 유지
- Modify: `i18next-parser.config.js` — input glob에서 `_legacy/**` 제외 확인
- Modify: `.gitignore` — `_legacy/renderer-v1/` 자체는 git 추적(삭제 아님, 이동이 목적)
- Modify: `electron.vite.config.ts` — **수정 없음**(경로는 동일하게 `src/renderer`, Task 3에서 새 껍데기가 채움)

**Acceptance Criteria:**

- [ ] `_legacy/renderer-v1/`에 기존 9개 엔트리(App.tsx, components/, hooks/, stores/, i18n/, styles/, env.d.ts, index.html, main.tsx) 전부 존재
- [ ] `git log --follow _legacy/renderer-v1/App.tsx` 가 v2 커밋 히스토리를 보여줌(이동이 git rename으로 인식됨)
- [ ] `src/renderer/`는 **비어 있음**(Task 3에서 다시 채움) — 본 태스크 직후 `electron-vite build`는 실패해도 무방(Task 3 완료 시 복구)
- [ ] `src/main/**`, `src/shared/**`, `src/preload/**`에서 `_legacy/renderer-v1/` 경로를 import하는 코드 없음
- [ ] `npx tsc --noEmit -p tsconfig.node.json` 0 errors (main/preload/shared는 영향 없음)
- [ ] R2 integration smoke(`src/shared/__tests__/rolestra-sample-contract.test.ts`) 여전히 통과

**Verify:**

- `test -d _legacy/renderer-v1 && ls _legacy/renderer-v1/` → 9 entries
- `grep -r "_legacy/renderer-v1" src/main src/shared src/preload` → 0 hits
- `npm run typecheck:node` → exit 0

**Steps (순서 고정):**

1. `git mv src/renderer _legacy/renderer-v1` (한 번에, 히스토리 보존)
2. `vitest.config.ts` include/exclude 갱신 — `_legacy/**/__tests__/**` 배제
3. `i18next-parser.config.js` input이 `src/renderer/**/*.{ts,tsx}`에만 매치되는지 확인(이미 그렇다면 변경 없음)
4. `npm run typecheck:node` 확인
5. 커밋: `chore(rolestra): move v2 renderer to _legacy/renderer-v1 (R3-Task2)`

---

## Task 3: 새 `src/renderer/` 빈 껍데기

**Goal:** Task 2로 비워진 `src/renderer/`에 **부팅 가능한 최소 껍데기**를 넣는다. 화면에는 "Rolestra R3 shell booting..." 1줄만 보여도 됨. Task 4 이후부터 Tailwind/토큰/Shell이 붙는다.

**Files:**

- Create: `src/renderer/index.html` (`<html lang="ko" data-theme="warm" data-mode="light">` 기본)
- Create: `src/renderer/main.tsx` — createRoot + `<App />`만
- Create: `src/renderer/App.tsx` — `<div id="boot">Rolestra R3</div>` 한 줄
- Create: `src/renderer/env.d.ts` — Vite client types
- Create: `src/renderer/i18n/index.ts` — 기본 i18next init(ko/en). 네임스페이스는 Task 10에서 확장.
- Create: `src/renderer/i18n/locales/ko.json`, `en.json` — 빈 객체 `{}`로 시작
- Create: `src/renderer/styles/global.css` — `* { box-sizing: border-box }` 최소 reset + 폰트 import 플레이스홀더(실값은 Task 5)

**Acceptance Criteria:**

- [ ] `npm run dev`로 electron-vite 기동 시 renderer가 에러 없이 뜨고 "Rolestra R3" 텍스트가 렌더됨
- [ ] `npm run build` (`electron-vite build`) 성공
- [ ] `npm run typecheck:web` 0 errors
- [ ] preload에서 노출되는 IPC bridge는 **접근 안 함**(Task 3 범위에서 IPC 호출 금지)

**Verify:**

- `npm run build` → exit 0
- `npm run typecheck` → exit 0

---

## Task 4: 패키지 추가 + Tailwind/PostCSS 설정

**Goal:** Tailwind + Radix + framer-motion + cva/clsx 설치. Tailwind는 테마 색을 **직접 지정하지 않음**(모두 CSS var 참조). darkMode는 `['selector', '[data-mode="dark"]']`.

**Files:**

- Modify: `package.json` — dependencies 추가:
  - `tailwindcss`, `postcss`, `autoprefixer`
  - `@radix-ui/react-slot`, `@radix-ui/react-tooltip`, `@radix-ui/react-separator`
  - `framer-motion`
  - `class-variance-authority`, `clsx`
- Create: `tailwind.config.ts`

  ```ts
  import type { Config } from 'tailwindcss';
  const config: Config = {
    content: ['./src/renderer/**/*.{ts,tsx,html}'],
    darkMode: ['selector', '[data-mode="dark"]'],
    theme: {
      extend: {
        colors: {
          canvas: 'var(--color-bg-canvas)',
          elev: 'var(--color-bg-elev)',
          sunk: 'var(--color-bg-sunk)',
          fg: 'var(--color-fg)',
          'fg-muted': 'var(--color-fg-muted)',
          'fg-subtle': 'var(--color-fg-subtle)',
          border: 'var(--color-border)',
          'border-soft': 'var(--color-border-soft)',
          brand: 'var(--color-brand)',
          'brand-deep': 'var(--color-brand-deep)',
          accent: 'var(--color-accent)',
          success: 'var(--color-success)',
          warning: 'var(--color-warning)',
          danger: 'var(--color-danger)',
        },
        fontFamily: {
          sans: 'var(--font-body)',
          display: 'var(--font-display)',
          mono: 'var(--font-mono)',
        },
        borderRadius: {
          panel: 'var(--radius-panel)',
        },
      },
    },
    plugins: [],
  };
  export default config;
  ```

- Create: `postcss.config.js`
- Modify: `src/renderer/styles/global.css` — `@tailwind base; @tailwind components; @tailwind utilities;`

**Acceptance Criteria:**

- [ ] `npm install`이 lockfile 업데이트 후 성공
- [ ] `npm run build` 통과 (Tailwind가 tokens.css 없이도 빌드 통과해야 하므로, var fallback은 Task 5에서 주입)
- [ ] `tailwind.config.ts`에 **하드코딩 색 리터럴이 없음** (`#` 또는 `rgb(` 미포함) — 모두 `var(--...)`
- [ ] darkMode 셀렉터가 `[data-mode="dark"]`임

**Verify:**

- `grep -E "#[0-9a-fA-F]{3,6}|rgb\(" tailwind.config.ts` → 0 hits
- `npm run build` → exit 0

---

## Task 5: theme-tokens.jsx → theme-tokens.ts 정식화 + tokens.css 생성

**Goal:** 시안 `theme-tokens.jsx`의 6 토큰 객체(warm × {light,dark} / tactical × {light,dark} / retro × {light,dark})를 TypeScript로 옮긴다. 동시에 CSS variable 블록을 **자동 생성**해 `src/renderer/styles/tokens.css`에 출력. 추출 스크립트(`tools/theme/extract-tokens.ts`)를 `npm run theme:build`로 호출 가능하게 한다. 수기 편집이 아닌 **스크립트화**가 요지(시안 변경 시 재생성).

**Files:**

- Create: `src/renderer/theme/theme-tokens.ts`
  - `type ThemeKey = 'warm' | 'tactical' | 'retro'`
  - `type ThemeMode = 'light' | 'dark'`
  - `interface ThemeToken { themeKey; mode; font; displayFont; monoFont; bgCanvas; bgElev; bgSunk; fg; fgMuted; fgSubtle; border; borderSoft; brand; brandDeep; accent; success; warning; danger; avatarShape: 'circle'|'diamond'|'status'; useLineIcons: boolean; panelRadius: number; panelClip: string; cardTitleStyle: 'bar'|'divider'|'ascii'; miniBtnStyle: 'pill'|'notched'|'text'; gaugeGlow: number; ... }` — 시안 schema의 모든 key 전수 포함
  - `export const THEMES: Record<\`${ThemeKey}-${ThemeMode}\`, ThemeToken>` — 6 entry
  - `export const THEME_MATRIX: ReadonlyArray<{ key: ThemeKey; mode: ThemeMode }>`
  - `export const FONTS = { body, display, mono } as const`
- Create: `src/renderer/styles/tokens.css` — 자동 생성물. 구조:

  ```css
  :root[data-theme='warm'][data-mode='light'] {
    --color-bg-canvas: #f7f1e6;
    --color-bg-elev: #fff;
    ...
    --font-body: '...';
    --radius-panel: 12px;
  }
  :root[data-theme='warm'][data-mode='dark'] {
    ...
  }
  /* 6 blocks total */
  ```

- Create: `tools/theme/extract-tokens.ts` — `docs/Rolestra_sample/theme-tokens.jsx`를 텍스트로 읽어 **파싱**(간단한 AST or 정규식 기반)하고, `theme-tokens.ts`/`tokens.css` 두 파일을 생성. `npm run theme:build` 스크립트로 바인딩.
- Modify: `package.json` scripts: `"theme:build": "tsx tools/theme/extract-tokens.ts"`, `"theme:check": "npm run theme:build && git diff --exit-code src/renderer/theme/theme-tokens.ts src/renderer/styles/tokens.css"`
- Modify: `src/renderer/styles/global.css` — `@import './tokens.css';`를 `@tailwind base;` 앞에 추가
- Modify: `src/renderer/index.html` — `<link rel="preconnect">` + Google Fonts(Fraunces, IBM Plex Sans, Space Grotesk, JetBrains Mono, IBM Plex Mono) import. 오프라인 빌드 대비 **로컬 폰트 fallback 체인 유지**(시안 상수).

**Acceptance Criteria:**

- [ ] `npm run theme:build` 실행 시 `theme-tokens.ts` + `tokens.css` 두 파일이 결정론적(determinstic)으로 생성됨(두 번 실행해도 diff 없음)
- [ ] `tokens.css`가 6 블록(`[data-theme][data-mode]` 조합 전부) + `:root` 기본값 폴백 블록 포함
- [ ] `theme-tokens.ts`의 `THEMES` 객체 keys가 정확히 `'warm-light'|'warm-dark'|'tactical-light'|'tactical-dark'|'retro-light'|'retro-dark'`
- [ ] 하드코딩 금지 — `src/renderer/components/**` 어디에도 `#[0-9a-f]{3,6}` 컬러 리터럴 없음(향후 guard 테스트로 고정)
- [ ] `npm run theme:check` → exit 0 (생성물이 최신)
- [ ] 게이미피케이션 단어(`XP|CREDITS|LV |MISSION|REWARD|UNLOCK`)가 토큰 string 값/주석에 0회

**Verify:**

- `npm run theme:build && git diff --exit-code src/renderer/theme/theme-tokens.ts src/renderer/styles/tokens.css` → exit 0
- `grep -rE "#[0-9a-fA-F]{3,6}" src/renderer/components` → 0 hits (이 태스크에서는 components/가 비어 있으므로 자동 통과, Task 7~9에서 유지)

---

## Task 6: ThemeProvider + themeStore

**Goal:** `<html data-theme data-mode>`를 런타임에 세팅하는 provider와, 사용자 선택을 저장하는 zustand persist store를 만든다. 기본값은 `warm` / `light`(spec §7.10 추천).

**Files:**

- Create: `src/renderer/theme/theme-store.ts` — zustand (`persist` middleware, localStorage key `rolestra.theme.v1`). state: `{ themeKey: ThemeKey; mode: ThemeMode; setTheme(k); setMode(m); toggleMode() }`. initial: `warm`/`light`.
- Create: `src/renderer/theme/theme-provider.tsx` — `<ThemeProvider>`: mount 시 `document.documentElement.setAttribute('data-theme', themeKey)` + `data-mode`, store 구독으로 변경 반영. 내부에서 `useTheme()` context 제공.
- Create: `src/renderer/theme/use-theme.ts` — `useTheme()` 훅(`themeKey`, `mode`, `token: ThemeToken`, setters 포함)
- Modify: `src/renderer/main.tsx` — `<ThemeProvider><App /></ThemeProvider>`
- Modify: `src/renderer/index.html` — initial `data-theme`/`data-mode`를 서버-HTML에서 지정(persist 값 로드 전 깜빡임 방지는 script inline에서 localStorage 읽어 attribute 세팅)
- Create: `src/renderer/theme/__tests__/theme-provider.test.tsx` — Vitest + @testing-library/react
- Create: `src/renderer/theme/__tests__/theme-tokens.test.ts` — THEMES 6 key 존재 + 필수 필드 존재 snapshot

**Acceptance Criteria:**

- [ ] provider가 mount된 직후 `document.documentElement.dataset.theme` / `.dataMode`가 store 값과 일치
- [ ] `setTheme('tactical')` 호출 후 attribute + localStorage 둘 다 갱신
- [ ] 초기 깜빡임 방지 inline script가 `index.html`에 존재(localStorage 읽고 attribute 선세팅 실패 시 기본값으로 fallback, try/catch 포함)
- [ ] Vitest 2 파일 all green
- [ ] provider는 **Electron main/preload를 참조하지 않음** (shared 타입만 사용)

**Verify:**

- `npm run test -- theme` → 2+ tests pass
- `npm run typecheck:web` → 0 errors

---

## Task 7: Shell 컴포넌트(Shell / NavRail / ProjectRail / ShellTopBar / ProfileAvatar / LineIcon)

**Goal:** 시안 `shared-components.jsx`의 `NavRail` / `ProjectRail` / `ShellTopBar` / `ProfileAvatar` / `LineIcon`과 `VariantFrame` 개념을 정식 React + TypeScript + Tailwind로 옮긴다. 각 컴포넌트는 **의미 중심 props**만 받고, 시각은 `useTheme()`가 반환하는 토큰에서만 분기한다(체크리스트 §"테마 종속화" 규정).

**Files:**

- Create: `src/renderer/components/shell/Shell.tsx` — 레이아웃 root. grid: `[NavRail 64px] [ProjectRail 240px] [Main 1fr]`. children은 Main 슬롯. className은 cva로 테마별 bg/text 결정.
- Create: `src/renderer/components/shell/NavRail.tsx` — 좌측 64px. 아이콘 리스트 props(`items: { key; icon; label; active? }[]`). 활성 표시만 수행, 라우팅은 R4 이후.
- Create: `src/renderer/components/shell/ProjectRail.tsx` — 240px. props(`projects: { id; name; active? }[]; dmList?`). 섹션 헤더("PROJECTS", "DIRECT") — 라벨은 i18n 키(`shell.rail.projects`, `shell.rail.direct`).
- Create: `src/renderer/components/shell/ShellTopBar.tsx` — 한 줄("사무실 · 시간 · 인사"). props: `officeName; greeting` — 실제 데이터는 R4+. 여기서는 placeholder prop 수용만.
- Create: `src/renderer/components/shell/ProfileAvatar.tsx` — 8 default palette(시안 schema의 avatar palette 상수) + custom image url 경로. `avatarShape` 토큰에 따라 circle/diamond/status 분기.
- Create: `src/renderer/components/shell/LineIcon.tsx` — `useLineIcons` 토큰이 true이면 line style, false면 filled style. 전용 svg sprite 또는 inline svg 8~12개.
- Create: `src/renderer/components/shell/__tests__/Shell.test.tsx` — 6 테마 × 2 모드 × 렌더 1회씩(총 6) 스냅샷: attribute + 핵심 구조 존재(`[data-testid="nav-rail"]`, `[data-testid="project-rail"]`).
- Create: `src/renderer/components/shell/__tests__/NavRail.test.tsx` — active item aria 속성, 아이콘 slot.
- Create: `src/renderer/components/shell/__tests__/ProfileAvatar.test.tsx` — 3가지 `avatarShape` × 렌더.

**Acceptance Criteria:**

- [ ] 6 테마 전부에서 Shell이 렌더되고 `data-theme`/`data-mode` attribute가 reflect됨
- [ ] 컴포넌트 내부에 `#[0-9a-fA-F]{3,6}` 하드코딩 색 **0건** (모두 tailwind class + var)
- [ ] 시안 `shared-components.jsx`의 **키가 아닌 시각 정체성(clip/radius/글로우 등)이 토큰으로부터만 결정**되는지 리뷰
- [ ] i18n 키 placeholder: `shell.rail.projects`, `shell.rail.direct`, `shell.topbar.greeting` 등이 ko.json/en.json에 등록
- [ ] 게이미피케이션 단어 **0건** (테스트 스냅샷 출력물에도 0건)
- [ ] Vitest 3 파일 all green
- [ ] 마케팅 카피 헤더 금지 — ShellTopBar가 임의의 홍보 문구를 렌더하지 않음(placeholder 텍스트 길이 제한 검사)

**Verify:**

- `grep -rE "#[0-9a-fA-F]{3,6}" src/renderer/components/shell` → 0 hits
- `grep -rE "XP|CREDITS|\\bLV\\b|MISSION|REWARD|UNLOCK" src/renderer/components src/renderer/theme` → 0 hits
- `npm run test -- shell` → all pass

---

## Task 8: Primitive 스텁(Button / Card / Badge / Separator / Tooltip)

**Goal:** R4~R9가 사용할 가장 기본적인 primitive만 **cva 래핑**으로 제공. 실 콘텐츠는 R4+에서 확장. shell과 달리 primitive는 테마 분기를 variants로 받아들임(예: `variant="pill" | "notched" | "text"`는 토큰 `miniBtnStyle`에 자동 매핑).

**Files:**

- Create: `src/renderer/components/primitives/button.tsx` — Radix `Slot` 포함, cva variants: `size(sm|md|lg)`, `tone(primary|secondary|ghost|danger)`, `shape(auto|pill|notched|text)`. `shape="auto"`이면 `useTheme().token.miniBtnStyle`에 따라 자동 선택.
- Create: `src/renderer/components/primitives/card.tsx` — Card/CardHeader/CardBody/CardFooter. 헤더 스타일은 토큰 `cardTitleStyle`에 따라 bar/divider/ascii.
- Create: `src/renderer/components/primitives/badge.tsx` — tone + dot 옵션.
- Create: `src/renderer/components/primitives/separator.tsx` — Radix Separator 래핑.
- Create: `src/renderer/components/primitives/tooltip.tsx` — Radix Tooltip 래핑, portal 사용, themed surface.
- Create: `src/renderer/components/index.ts` — barrel export
- Create: `src/renderer/components/primitives/__tests__/button.test.tsx` — 4 variants × render OK, tone=primary일 때 brand 토큰 var 참조 class 포함.
- Create: `src/renderer/components/primitives/__tests__/card.test.tsx` — `cardTitleStyle` 3종 분기 snapshot.

**Acceptance Criteria:**

- [ ] Button `shape="auto"`가 3 테마에서 각기 다른 class string을 반환(warm=pill, tactical=notched, retro=text) — snapshot 검증
- [ ] Tooltip portal이 body에 attach되고 `data-state="open"` 시 visible(Radix default)
- [ ] primitive 내부 하드코딩 색 0건
- [ ] barrel export로 `import { Button, Card, Badge, Separator, Tooltip } from '@/renderer/components'` 가능(또는 상대경로)
- [ ] Vitest 2 파일 all green

**Verify:**

- `npm run test -- primitives` → all pass
- `npm run typecheck:web` → 0 errors

---

## Task 9: App 루트 — Shell 와이어업(빈 메인)

**Goal:** `App.tsx`에서 `<Shell>`을 렌더하고, NavRail/ProjectRail/ShellTopBar에 **샘플 placeholder 데이터**를 주입해 6 테마가 실제로 앱에서 전환되도록 연결. 메인 영역은 "R4에서 대시보드가 여기에 들어옵니다" 안내 1줄. **실 데이터 훅업 금지**(IPC 호출 없음).

**Files:**

- Modify: `src/renderer/App.tsx` — `<Shell>` + children = 1줄 placeholder(i18n 키 `app.mainPlaceholder`)
- Create: `src/renderer/components/shell/theme-switcher.tsx` — 개발 편의용 6 combo dropdown. ShellTopBar 오른쪽에 mount. **R10에서 설정 탭으로 이관 예정**(현재는 dev affordance 주석).
- Modify: `src/renderer/i18n/locales/ko.json`, `en.json` — `app.mainPlaceholder`, `shell.rail.*`, `shell.topbar.*`, `theme.switcher.*` 등록

**Acceptance Criteria:**

- [ ] `npm run dev`로 실행 시 Shell이 모든 구역과 함께 뜨고, 우상단 switcher로 6 조합을 전부 전환하며 스타일이 바뀜
- [ ] 새로고침 후에도 last selected theme 유지(persist)
- [ ] preload/IPC 호출 없음(DevTools network/ipc 0회)
- [ ] Main 영역 placeholder 문구가 t() 경유
- [ ] 게이미피케이션 단어 0건

**Verify:**

- `npm run dev` 수동 확인 (theme-switcher로 6 조합 전환 성공)
- `grep -rE "XP|CREDITS|\\bLV\\b|MISSION|REWARD|UNLOCK" src/renderer` → 0 hits

---

## Task 10: i18n 도메인 네임스페이스 사전 선언

**Goal:** R4~R10에서 사용할 도메인 네임스페이스(`dashboard|messenger|channel|member|project|approval|queue|notification|settings|onboarding|common|error|shell|theme|app`)를 빈 객체로 미리 선언해, 이후 Phase가 키를 추가만 하면 되도록 scaffolding. `2026-04-19-theme-alignment-checklist.md`의 i18n 섹션 준수.

**Files:**

- Modify: `src/renderer/i18n/index.ts` — namespace resource 초기화(또는 단일 translation + dot-prefix 컨벤션)
- Modify: `src/renderer/i18n/locales/ko.json`, `en.json` — 위 도메인 top-level key에 `{}` 배치(기존 Task 9 키는 해당 도메인 하위로 이동)
- Create: `src/renderer/i18n/keys.ts` — 타입화된 key constants(선택, R4+에서 활용). 최소한 Task 9에서 등록한 키에 대한 `as const` 레이블만.
- Modify: `i18next-parser.config.js` — `output` 경로를 `src/renderer/i18n/locales/$LOCALE.json`로 유지, `input` 글롭 확인

**Acceptance Criteria:**

- [ ] `npm run i18n:check` 통과(parser가 고아 키 없음 / 신규 키는 JSON에 반영됨)
- [ ] eslint-plugin-i18next가 `src/renderer/**`에서 하드코딩 UI 문자열 0건 보고
- [ ] 12개 도메인 최소 빈 객체로 선언됨(ko.json / en.json 동일 key set)

**Verify:**

- `npm run i18n:check` → exit 0
- `npm run lint` → exit 0

---

## Task 11: legacy channel warning 현황 문서화 + R3 제거 대상 목록(미제거)

**Goal:** R2 `router.ts`의 `LEGACY_V2_CHANNELS`이 warn을 내는 채널을 **현재 누가 부르는가** 조사해 `docs/superpowers/specs/appendix-legacy-channels.md`에 표로 기록. R3는 **경고 유지, 제거 안 함**(제거는 R11). 새 렌더러는 legacy 채널 호출 0건이어야 함 — 이를 테스트로 고정.

**Files:**

- Create: `docs/superpowers/specs/appendix-legacy-channels.md` — 표 3열: `채널명 / 현재 호출 위치 / R11 제거 시 마이그레이션 계획`. 현재 호출 위치 컬럼에는 `_legacy/renderer-v1/` 하위 파일 path만 오게 된다.
- Create: `src/renderer/__tests__/legacy-channel-isolation.test.ts` — `_legacy/**`를 제외한 `src/renderer/**` 파일을 grep해 `chat:*`, `workspace:*`, `consensus-folder:*`, `consensus:*`, `session:*` 호출이 **0건**임을 검증(fs + text match 기반 테스트).

**Acceptance Criteria:**

- [ ] appendix 문서에 5개 prefix(`chat:*|workspace:*|consensus-folder:*|consensus:*|session:*`) 하위의 실제 채널명이 전부 열거됨(router.ts의 `LEGACY_V2_CHANNELS`와 동일 set)
- [ ] 각 채널의 R11 마이그레이션 계획은 "대응 v3 IPC 채널(spec §6)" 또는 "제거(사용처 없음)"로 명시
- [ ] `legacy-channel-isolation.test.ts`가 새 renderer 경로에서 legacy 채널 호출을 0건으로 보고(통과)
- [ ] 새 렌더러 파일에서 legacy 채널을 호출하면 즉시 테스트가 fail(guard 확인용 negative case 1개 포함 — 주석 처리 or `.skip`)

**Verify:**

- `npm run test -- legacy-channel-isolation` → pass
- `diff <(grep -oE "'[a-z]+:[a-z-]+'" src/main/ipc/router.ts | sort -u) <(grep -oE "'[a-z]+:[a-z-]+'" docs/superpowers/specs/appendix-legacy-channels.md | sort -u)` 에서 legacy prefix 일치(완전 일치가 아니더라도 5 prefix 전부 포함)

---

## Task 12: R3 종료 확인 + R4 진입 체크리스트

**Goal:** 전체 typecheck/lint/test/i18n:check/theme:check/build 통과, 6 테마 × 2 모드가 실제로 화면에서 전환되는 스크린샷 증빙 추가(Playwright 자동 캡처 또는 수동 업로드), R4 진입 체크리스트 문서화.

**Files:**

- Create: `docs/superpowers/specs/appendix-r3-evidence/` — 6 테마 × 2 모드 = 6 PNG(Playwright MCP 또는 수동 dev 캡처). 파일명 `warm-light.png` 등.
- Modify: `docs/superpowers/specs/2026-04-18-rolestra-design.md` §10 R3 항목 — 체크박스 전부 ✓ + 산출물 링크(`_legacy/renderer-v1/`, `src/renderer/theme/`, `src/renderer/components/shell/`, `src/renderer/styles/tokens.css`, `docs/superpowers/specs/appendix-legacy-channels.md`, `appendix-r3-evidence/`)
- Create: `docs/superpowers/specs/r3-done-checklist.md` — 완료 확인 항목 및 R4 착수 조건
- Modify: `tools/cli-smoke/README.md` — R3 상태 반영(`R3 completed — renderer moved, design system baseline in place`)

**Acceptance Criteria:**

- [ ] `npm run typecheck && npm run lint && npm run test && npm run i18n:check && npm run theme:check && npm run build` 전부 exit 0
- [ ] 스크린샷 6장 존재(또는 Playwright 자동 캡처 스크립트 첨부)
- [ ] spec §10 R3 항목 체크박스 전부 ✓
- [ ] R4 진입 체크리스트에 "대시보드 위젯 4종 골격 스텁 필요 여부" 명시(답: R4에서 시작)

**Verify:**

- `npm run typecheck && npm run lint && npm run test && npm run i18n:check && npm run theme:check && npm run build` → exit 0
- `ls docs/superpowers/specs/appendix-r3-evidence/ | wc -l` ≥ 6

---

## Dependency Graph

```
Task 1 (spec 갱신) ─────────────────────┐
                                        │
Task 2 (v2 renderer → _legacy) ─────────┤
                                        ▼
Task 3 (new renderer shell 부팅) ──── Task 4 (tailwind/postcss/deps)
                                        │
                                        ▼
Task 5 (theme-tokens.ts + tokens.css 자동 생성)
                                        │
                                        ▼
Task 6 (ThemeProvider + store)
                                        │
                                        ▼
Task 7 (Shell/NavRail/ProjectRail/ShellTopBar/ProfileAvatar/LineIcon)
                                        │
                       ┌────────────────┼────────────────┐
                       ▼                ▼                ▼
               Task 8 (primitives)  Task 10 (i18n)   Task 11 (legacy warn doc)
                       │                │                │
                       └────────┬───────┴────────┬───────┘
                                ▼                ▼
                        Task 9 (App wire-up)
                                │
                                ▼
                        Task 12 (R3 종료)
```

### 병렬화 가능 그룹

- **Group A (직렬 필수):** Task 1 → Task 2 → Task 3 → Task 4 → Task 5 → Task 6 → Task 7 (각 단계 산출물이 다음 단계 전제)
- **Group B (Task 7 완료 후 병렬):** Task 8 / Task 10 / Task 11
- **Group C (수렴):** Task 9 (Group B 셋 중 최소 Task 8·10 필요, Task 11은 Task 9와 병렬 가능하나 동일 범위 guard 테스트라 Task 9 이후 동작 확인 권장)
- **Group D (마감):** Task 12 — 모든 이전 태스크 완료 전제

총 태스크 12개. 최대 병렬성 = 3 (Group B).

---

## Decisions (사용자 승인 완료 — 2026-04-20)

| ID | 항목 | 결정 | 반영 방침 |
|---|---|---|---|
| **D1** | R2 origin push / main 병합 시점 | **`rolestra-phase-r2` 브랜치를 origin push → main 병합(fast-forward) → 브랜치 삭제(로컬+원격)** | 완료. R3는 `rolestra-phase-r3` 브랜치에서 `main` 위로 쌓인다. |
| **D2** | `theme:build` 스크립트의 `theme-tokens.jsx` 파싱 전략 | **B안 — Node import 후 객체 직렬화** | Task 5: `tsx`로 jsx를 import해 순수 상수 객체를 읽고 deterministic하게 `theme-tokens.ts` + `tokens.css` 생성. 시안 jsx export 구조(`export { themeWarmLight, ... }`)는 Task 5 첫 step에서 확인·준수. |
| **D3** | ShellTopBar 개발용 theme-switcher 노출 시점 | **C안 — `import.meta.env.DEV`에서만 노출** | Task 9: `if (import.meta.env.DEV)` 가드로 프로덕션 번들에서 컴파일 타임 제거. Vitest는 provider override 또는 env 강제로 force-mount. 사용자 대면 테마 전환은 R10 설정 탭이 정식 경로. |

---

## Self-Review (plan 작성자 체크)

### 1. Spec 커버리지 (§10 R3 요구사항 → Task 매핑)

| Spec R3 요구사항 | Task |
|---|---|
| `src/renderer/` → `_legacy/renderer-v1/` | Task 2 |
| 새 `src/renderer/` 뼈대 (App shell, routes, design tokens, Tailwind/Radix 설정) | Task 3, 4, 7 |
| Design System primitives (5~6 blocks는 R4+로 이연, R3는 Button/Card/Badge/Separator/Tooltip만) | Task 8 |
| 핵심 blocks (MessageBubble, MemberCard, ChannelItem, ApprovalCard, DashboardWidget, ProjectSwitcher) | **R4+로 이연 확정** — R3 범위는 shell과 primitive까지. spec §10 문구를 본 plan에서 축소 해석함(D1/D2/D3와 별개, 암묵 결정). |
| i18n 설정(react-i18next, ko 기본) | Task 10 |
| Storybook 또는 최소 플레이그라운드(옵션) | **채택 안 함** — dev theme-switcher가 최소 플레이그라운드 역할(Task 9) |
| §7.2/§7.5/§7.10 spec 갱신 | Task 1 |
| legacy channel 제거 대상 식별 | Task 11 (식별, 제거는 R11) |
| R2 origin push / main 병합 검토 | Open Decision D1 |

### 2. 하드코딩 금지 원칙 커버

- 색: Task 4 (tailwind var 참조) + Task 5 (tokens.css 생성) + Task 7/8/9 guard grep
- 폰트: Task 5 (FONTS 상수) + Task 4 (tailwind fontFamily var 참조)
- 문자열: Task 10 (i18n) + Task 9 (t() 경유)
- 경로: electron.vite.config.ts는 변경 없음(기존 상수 유지)

### 3. 사일런트 폴백 금지

- ThemeProvider에서 persist 값 로드 실패 시 기본값으로 fallback하되 **console.warn 출력**(Task 6)
- tokens.css 미생성 시 Tailwind var fallback이 무색으로 보일 수 있음 → Task 5 `:root` 기본 폴백 블록으로 브랜드 정체성이 깨지지 않게(warm-light 값 복제)

### 4. 시안 이탈 위험 구간

- **위험 A (낮음):** Task 7 NavRail의 active 상태 글로우/shadow가 시안과 정확히 재현되지 않을 수 있음. 시안 `VariantFrame`/`shared-components.jsx`를 픽셀 대조로 수동 검증 요(Task 12 스크린샷이 증빙).
- **위험 B (낮음):** Task 5 auto-extract가 시안의 미세한 token(예: `panelShadow` string) 누락 가능. schema comment에서 선언된 key 전수를 테스트로 고정(Task 6 theme-tokens.test.ts).
- **위험 C (중):** Task 9 theme-switcher가 시안의 shell 언어를 훼손하면 안 됨 — dev 모드 가드(D3 C안) + 프로덕션 번들에서는 제거.

### 5. Placeholder scan

- "TBD"/"TODO"/"implement later" **없음**. 모든 파일 경로, 커맨드, 수락 기준은 exact.

---

## 참고

이 plan은 **Rolestra Phase R3만** 다룬다. R4 이후 Phase는 R3 완료 후 각각 별도 plan 문서로 작성된다. spec §10의 Phase 분할과 1:1 대응.
