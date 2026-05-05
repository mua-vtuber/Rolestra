# R5 Prep — 메신저 6 테마 시각 분석

> **Scope**: R5 plan(채널 + 메신저 본체) 작성 **전** prep 노트. R5 태스크 AC에 "어느 컴포넌트가 `themeKey` 3-way 분기를 하고, 어느 것은 토큰만으로 충분한가"를 확정한다.

## 0. 배경 — 왜 이 문서가 필요한가

R4 완료 시점(2026-04-21) 사용자 회고: 6 테마가 "공통 형태에 컬러감과 박스만 바뀐 느낌". 원인은 R3가 세운 5개 variant-discriminator(`miniBtnStyle` / `cardTitleStyle` / `avatarShape` / `approvalBodyStyle` / `gaugeGlow`)가 Button / Card / ProgressGauge에만 적용되고, 그 외 R4 신규 컴포넌트들은 토큰만 치환하는 구조라 형태 수준 차이가 안 생겼다.

R5는 메신저 본체(좌측 channel rail · 메시지 스레드 · composer · 참여자 panel)가 주 신규 영역이고, 정본 시안(`02-msg-variants.jsx`)은 **테마별 구조 차이가 크다**. `themeKey` 분기 전략을 R5 plan 작성 전에 고정한다.

## 1. 기준 자료

- **정본 시안**: `docs/Rolestra_sample/02-msg-variants.jsx` (435 lines, 3 테마 × 2 모드 메신저 화면)
- **렌더링 호스트**: `docs/Rolestra_sample/02-Messenger.html` (babel + React 18 in-browser)
- **토큰 정본**: `docs/Rolestra_sample/theme-tokens.jsx` → `npm run theme:build` → `src/renderer/theme/theme-tokens.ts`
- **정렬 체크리스트(2026-04-19 기존)**: `docs/Rolestra_sample/2026-04-19-theme-alignment-checklist.md` — 본 문서가 그 checklist의 §"02 Messenger" 항목을 컴포넌트 단위로 구체화한다.
- **참조 패턴**: `src/renderer/features/dashboard/ProgressGauge.tsx` — `themeKey` 3-way 내부 switch + `data-theme-variant` attribute(테스트 hook).

## 2. 정본 시안 — 메신저 컴포넌트별 테마 차이

### 2.1 `MsgChannelRail` (좌측 채널 목록)

공통 구조: **프로젝트 헤더 · 섹션 타이틀 · 채널 행 리스트 · unread badge**.

| 표현 | warm | tactical | retro |
|---|---|---|---|
| 프로젝트 헤더 prefix | (없음) | (없음) | `${PROJECT_PREFIX_MAP[id]} ` (예: `$ `) |
| 섹션 타이틀 | `채널` (sans, letterSpacing 0.5) | `CHANNELS` (mono, uppercase, letterSpacing 1.5) | `$ channels` (mono, lowercase) |
| 채널 glyph | `#` | `#` | `▶` active / `·` idle (+ active일 때 `textShadow` glow in dark) |
| 행 radius | 6 | 0 | 0 |
| 행 active bg | `itemActiveBg` | `${brand}12~16` alpha | `transparent` (border만) |
| 행 active border | `border` | `${brand}55` | `border` |
| 행 clip-path | none | `polygon(4px 0, 100% 0, 100% calc(100% - 4px), calc(100% - 4px) 100%, 0 100%, 0 4px)` | none |
| 행 font | `theme.font` (sans) | `theme.font` (sans) | `theme.monoFont` |
| unread badge radius | 999 (pill) | 0 | 0 |

**분기 전략**: `themeKey` 3-way 내부 switch (ProgressGauge 패턴). glyph · clip-path · letterSpacing · font 가 모두 테마 종속.

### 2.2 `MsgMeetingBanner` (회의 진행중 배너)

| 표현 | warm | tactical | retro |
|---|---|---|---|
| 전체 구조 | 3-column (dot · pill label · title · meta) | 3-column (line-icon · label · title · meta) | **1-line strip** (`[LIVE] 제목 · crew=3 · elapsed=10m · ssm=9/12`) |
| 배경 | `heroBg` (그라데이션) | `panelHeaderBg` + clip-path | 다크: `rgba(0,0,0,0.28)` / 라이트: `bgSunk` |
| 활성 표시 | 원형 pulse dot (8px, `dashPulse` 애니메이션) | `<LineIcon name="spark" stroke=1.4>` | `[LIVE]` mono 텍스트 + dark mode textShadow glow |
| 라벨 | `회의 진행중` (pill, radius 999, `${success}12` 배경) | `MEETING ACTIVE` (mono, 평면) | (없음 — `[LIVE]` 자체가 라벨) |

**분기 전략**: `themeKey` 3-way. retro는 **완전 별도 JSX** (별도 sub-component), warm/tactical은 유사한 shell에 glyph/label primitive만 교체.

### 2.3 `MsgMessage` (메시지 버블 — 본문 · 시스템 · 승인요청 3 variant)

#### 2.3.1 본문 메시지 (`kind='member'`)

| 표현 | warm | tactical | retro |
|---|---|---|---|
| 아바타 | `<ProfileAvatar shape='circle' size=32>` | `<ProfileAvatar shape='diamond' size=32>` | **없음** |
| 이름 prefix | 헤더 row (name + time + role) | 헤더 row (name + time + role) | mono name 고정폭 64px minWidth, 색 = brand, 헤더 없음 |
| 본문 font | `theme.font` (sans) | `theme.font` (sans) | `theme.monoFont` |

> `avatarShape` token이 이미 'status'(retro)를 값으로 가지지만, 시안 JSX는 retro일 때 아예 ProfileAvatar를 렌더링하지 않는 조건 분기를 쓴다. → 토큰만으론 부족, `themeKey === 'retro'` 분기 필요.

#### 2.3.2 시스템 메시지 (`kind='system'`)

| 표현 | warm | tactical | retro |
|---|---|---|---|
| 내용 형태 | `{content}` as-is | `{content}` + `${brand}10` bg + `${brand}44` border | `— {content.replace(/^[📌🗳✅]\s*/, '')} —` (이모지 제거 + mono dash) |
| 컨테이너 radius | 999 (pill) | 0 | 0 |

#### 2.3.3 승인 요청 (`kind='approval_request'`)

| 표현 | warm | tactical | retro |
|---|---|---|---|
| 상단 라벨 | `⚠ 승인 요청` | `⚠ 승인 요청` | `[APPROVAL REQUESTED]` |
| border | `warning` 1.5px | `warning` 1.5px | `warning` 1.5px |
| 배경 | `${warning}10` | `${warning}10` | `${warning}10` (dark mode `${warning}14`) |
| radius | 8 | 0 + clip-path polygon 6px | 0 |
| 승인 버튼 | `<DashMiniBtn tone>` — miniBtnStyle 'pill' | 'notched' | 'text' |

**분기 전략**: 본문 메시지는 `themeKey` 3-way(retro는 구조 수준 차). 시스템 메시지는 `themeKey` 3-way. 승인 블록은 컨테이너 3-way + 버튼은 `miniBtnStyle` 토큰(R3 기존) 재활용.

### 2.4 `MsgThread` (채널 헤더 + 스레드 + composer)

- 채널 헤더: `#` glyph + 채널명 + 부제 + 참여자 수. 공통 (font는 retro일 때만 mono).
- composer:
  | 표현 | warm | tactical | retro |
  |---|---|---|---|
  | radius | 10 | 0 | 0 |
  | prefix glyph | `✎` | `✎` | `>` |
  | placeholder font | sans | sans | mono |
  | hint `⏎ 전송` | mono | mono | mono |

**분기 전략**: 채널 헤더는 token + font 분기(2-way warm/tactical vs retro). composer는 3-way — 단 retro와 tactical은 radius 동일(0)이므로 사실상 radius 2-way + glyph 3-way.

### 2.5 `MsgMemberPanel` (우측 참여자 + 합의 상태)

- 외곽: `DashCard` (R3 기존) 재사용 — `cardTitleStyle` 토큰(bar/divider/ascii) 이미 분기됨.
- 참여자 행:
  | 표현 | warm | tactical | retro |
  |---|---|---|---|
  | 상태 표시 | `<ProfileAvatar shape='circle' showStatus>` | `<ProfileAvatar shape='diamond'>` | **8px dot만** (avatar 없음) |
  | 이름 font | sans | sans | mono |
- SSM 진행 박스:
  | 표현 | warm | tactical | retro |
  |---|---|---|---|
  | radius | 8 | 0 + clip-path polygon 5px | 0 |

**분기 전략**: DashCard 재사용 + 참여자 행 3-way(retro avatar 생략) + SSM 박스 2-way(tactical clip vs 나머지).

### 2.6 단순 컴포넌트 — token-only로 충분

- `DateSeparator` — 배경 `bgSunk`, 색 `fgSubtle`, radius `panelRadius` 등 토큰만.
- `TypingIndicator` — dot 색 `fgMuted`, 배경 `bgSunk`, font mono 공통.
- `VoteTally` — 공통 mono + token 색만.

## 3. 현재 토큰 커버리지 매핑

| 필요 표현 | 기존 토큰 | 상태 |
|---|---|---|
| active channel background | `itemActiveBg` | ✅ 색 커버, 투명도는 `themeKey` 분기 |
| channel clip-path | (없음) | ❌ 컴포넌트 내 분기 |
| channel glyph `#`/`▶`/`·` | (없음) | ❌ 컴포넌트 내 분기 (i18n 대상 아님 — 순수 시각) |
| 섹션 타이틀 케이스/스페이싱/폰트 | (없음) | ❌ 컴포넌트 내 분기 + **i18n 키 분리 필요**(`messenger.channel.section.channels` 테마별 fallback 여부 결정) |
| meeting banner 3 형태 | `panelHeaderBg` + `heroBg` 재활용 | ⚠️ warm/tactical만 토큰 재활용 가능. retro는 별도 sub-component |
| avatar 유무 | `avatarShape='status'`(retro) | ⚠️ 현재 시안은 `status` 값과 별개로 조건 분기(`isRetro ? dot : <ProfileAvatar>`). 토큰 활용 안됨 → 정책 결정 필요 |
| 메시지 헤더(name+time+role) 유무 | (없음) | ❌ `themeKey === 'retro'` 분기 |
| 승인 블록 radius/clip | `miniBtnStyle`(버튼만 커버) | ❌ 컨테이너 3-way |
| system message shell | (없음) | ❌ 컴포넌트 내 분기 |
| composer radius | `panelRadius`(0/0/12) | ⚠️ 현재 spec과 시안이 일부 불일치 — warm=10, panelRadius=12. 의도 확인 후 `composerRadius` 신규 or `panelRadius` 재활용 결정 |
| composer prefix glyph | (없음) | ❌ 컴포넌트 내 분기 |
| unread badge radius | (없음) | ⚠️ `themeKey==='warm' ? 999 : 0` (4번째 등장 — 토큰 승격 고려 `badgeRadius` or 헬퍼 `themeRadius(theme, 'pill')`) |

## 4. R5 신규 컴포넌트 인벤토리 + 분기 전략

> **명명 규약**: `src/renderer/features/messenger/*` 하위에 배치 (dashboard 패턴 답습). primitive로 승격할 후보는 `src/renderer/components/shell/` 또는 `src/renderer/components/primitives/`.

| 컴포넌트 | 경로 제안 | 분기 전략 | 근거 |
|---|---|---|---|
| `MessengerPage` | `features/messenger/MessengerPage.tsx` | token-only | 레이아웃 컨테이너 |
| `MessengerChannelRail` | `features/messenger/ChannelRail.tsx` | **themeKey 3-way** | §2.1 glyph/clip/title 구조 차 |
| `MessengerChannelRow` | `features/messenger/ChannelRow.tsx` (내부) | **themeKey 3-way** | §2.1 active 표현 |
| `MessengerMeetingBanner` | `features/messenger/MeetingBanner.tsx` | **themeKey 3-way** (retro 완전 별도) | §2.2 |
| `MessengerThread` | `features/messenger/Thread.tsx` | token-only | shell 수준 |
| `MessengerMessage` | `features/messenger/Message.tsx` | **themeKey 3-way** (retro avatar/헤더 생략) | §2.3.1 |
| `MessengerSystemMessage` | `features/messenger/SystemMessage.tsx` | **themeKey 3-way** | §2.3.2 |
| `MessengerApprovalBlock` | `features/messenger/ApprovalBlock.tsx` | **themeKey 3-way** (컨테이너) + `miniBtnStyle`(버튼) | §2.3.3 |
| `MessengerComposer` | `features/messenger/Composer.tsx` | **themeKey 3-way** (glyph) + 2-way (radius warm vs others) | §2.4 |
| `MessengerMemberPanel` | `features/messenger/MemberPanel.tsx` | DashCard 재사용 + 내부 3-way | §2.5 |
| `MessengerMemberRow` | `features/messenger/MemberRow.tsx` (내부) | **themeKey 3-way** (avatar vs dot) | §2.5 |
| `MessengerSsmBox` | `features/messenger/SsmBox.tsx` | 2-way (tactical clip vs 나머지) | §2.5 |
| `MessengerTypingIndicator` | `features/messenger/TypingIndicator.tsx` | token-only | §2.6 |
| `MessengerDateSeparator` | `features/messenger/DateSeparator.tsx` | token-only | §2.6 |
| `MessengerVoteTally` | `features/messenger/VoteTally.tsx` | token-only | §2.6 |

**3-way 분기 컴포넌트: 9개**, 2-way: 1개, token-only: 5개.

## 5. 신규 token / discriminator 결정

두 가지 접근:

### A안 — 컴포넌트 내부 `themeKey` switch (ProgressGauge 패턴) — 권장

- **장점**: theme 객체 inflation 없음, 변경 범위 로컬(컴포넌트 단위), 테스트 격리 쉬움.
- **단점**: 테마 추가/조정 시 여러 컴포넌트 수정. themeKey 분기 로직이 여러 파일에 분산.
- **적용**: §2.1~§2.5 의 9개 3-way 컴포넌트.

### B안 — theme token에 discriminator 추가

후보 신규 field(들 중 필요시에만):
- `messageAvatarPolicy: 'visible' | 'hidden'` — retro만 hidden. `avatarShape='status'`와 semantic 중복이므로 **도입 안함**, 대신 `avatarShape === 'status' ? 생략 : <ProfileAvatar>` 컨벤션 확립.
- `messengerHeaderPolicy: 'stacked' | 'mono-prefix'` — 메시지 이름/시간 표시 방식. retro=mono-prefix. **도입 검토** — 여러 컴포넌트에서 일관된 규칙 필요.
- `composerFrame: 'rounded' | 'sharp'` — 2-way. **도입 안함**, `panelRadius===0 ? sharp : rounded` 규칙 활용.
- `badgeRadius: 'pill' | 'square'` — warm만 pill. **도입 검토** — unread badge + approval block + pill label 등 3곳 이상 재사용.

### 결정 제안 (R5 plan에서 확정)

1. **B안 신규 토큰은 2개만 도입**: `messengerHeaderPolicy`, `badgeRadius`. 사유: 3곳 이상 재사용 + 의미 명확.
2. **나머지는 A안(컴포넌트 내 `themeKey` switch)**. ProgressGauge · Button(`miniBtnStyle`) · DashCard(`cardTitleStyle`) 기존 패턴 유지.
3. **토큰 추가 절차**(R3 규약):
   - `docs/Rolestra_sample/theme-tokens.jsx` schema comment + 6 object 전부 수정
   - `npm run theme:build` → `src/renderer/theme/theme-tokens.ts` 재생성
   - 관련 테스트(`src/renderer/theme/__tests__/theme-tokens.test.ts`) 확장
   - 소비 컴포넌트 구현

## 6. R5 plan 작성 시 필수 반영사항

각 태스크 AC(Acceptance Criteria)에 다음 항목 포함:

1. **`data-theme-variant={themeKey}` attribute** — 3-way 분기 컴포넌트는 반드시 outer element에 부여(ProgressGauge 규약).
2. **테스트 매트릭스** — 각 3-way 컴포넌트 테스트 파일에 warm/tactical/retro 3 시나리오 최소. `useTheme` mock으로 `themeKey` 전환.
3. **하드코딩 색 literal 금지** — hex(`#xxx`) / `rgb()` / `rgba()` 직접 사용 불가. `theme.*` token 또는 Tailwind `bg-brand` 등 utility만. (ProgressGauge 헤더 주석 패턴 따름.)
4. **i18n**: `messenger.*` 네임스페이스. 테마별 다른 라벨(`채널` / `CHANNELS` / `$ channels`)은 **같은 i18n 키 + 컴포넌트 내 테마 분기**가 아니라 **3개 별도 키**로 저장하고 컴포넌트가 `themeKey`로 선택하도록 한다(번역 품질 + 향후 테마 확장 용이). 키 네이밍: `messenger.channelRail.sectionTitle.warm` / `.tactical` / `.retro`.
   - **예외**: 의미가 완전히 같은 라벨(예: `회의 진행중` / `MEETING ACTIVE`)은 기본 키 + `warm`/`tactical`/`retro` variant 키 중 존재하면 사용하는 fallback 패턴.
5. **구조 수준 diff** — 시안 JSX와 R5 구현의 DOM 트리가 구조적으로 일치해야 한다. 즉, 시안이 retro일 때 ProfileAvatar를 렌더하지 않는다면 R5 구현도 동일해야 한다(아바타에 `display:none` 주는 것 금지).
6. **신규 primitive 승격 규칙** — 3개 이상 화면(메신저/승인/Queue/Settings)에서 재사용 예상 시 `components/primitives/` 또는 `components/shell/`로 승격. 그 외에는 `features/messenger/` 로컬 유지.

## 7. R5 진입 조건 (업데이트 반영)

memory `rolestra-phase-status.md` §R5 진입 조건에 본 문서 추가:

- [x] R4 태스크 14/14 완료
- [x] typecheck / lint / test / i18n:check / theme:check / build 모두 pass
- [ ] R4 브랜치 main ff-merge (사용자 결정)
- [ ] 6 테마 대시보드 스크린샷 증빙 (Windows/native)
- [ ] (선택) Playwright 로컬 1회 성공 증빙
- [x] **R5 메신저 테마 분석 prep** — 본 문서
- [ ] R5 plan 작성 — 본 문서의 §4 인벤토리 + §6 필수 반영사항 기반

## 8. 보류 결정 (R5 plan 작성 시 확정)

- **composer radius 불일치**: 시안 warm=10 vs `panelRadius`=12. 의도 확인 후 `composerRadius` 신규 or `panelRadius` 재활용 선택.
- **채널 섹션 타이틀 i18n 전략**: 별도 3개 키 vs 단일 키 + 테마별 fallback. 번역 유지보수성을 고려해 플래너와 confirm.
- **`DashMiniBtn`의 v3 이식 상태**: R3~R4에서 Button/miniBtnStyle 매핑이 끝났는지, 메신저 승인 블록에서 바로 재사용 가능한지 R5 Task 0에서 점검.
- **시안 JSX의 screen-specific 하드코딩 색**(`02-msg-variants.jsx`의 `theme.sidebarBg` 등 미선언 prop 사용) — 2026-04-19 checklist §"02 Messenger" 금지 규칙 §1에 이미 기술됨. R5 구현에서 이 안티패턴을 반복하지 않도록 plan에 명시.

---

**작성**: 2026-04-21 (R4 완료 직후)  
**다음 액션**: 본 문서 기반 R5 plan 초안 작성 → 사용자 confirm → R5 Task 0 시작.
