# Rolestra 테마 정렬 체크리스트

작성일: 2026-04-19

## 목적

- `01-Dashboard`를 Rolestra 디자인 시안의 기준 화면으로 고정한다.
- `02~06`을 `01`과 동일한 수준으로 테마 토큰에 종속시킨다.
- Warm / Tactical / Retro의 차이를 색상 스왑이 아니라 구조적 시각 언어 차이로 유지한다.
- 모든 가시 문자열을 최종적으로 `t()` 추출 가능한 상태로 정리한다.

## 기준 화면

- 기준 파일:
  - `docs/Rolestra_sample/01-Dashboard.html`
  - `docs/Rolestra_sample/01-dash-variants.jsx`
  - `docs/Rolestra_sample/shared-components.jsx`
  - `docs/Rolestra_sample/theme-tokens.jsx`
- 기준 원칙:
  - 화면은 `VariantFrame -> NavRail / ProjectRail / ShellTopBar -> theme-aware primitive` 순으로 조립한다.
  - 카드, 버튼, 아바타, 진행도, 배지, 헤더는 공통 primitive를 기반으로 테마별 분기를 탄다.
  - 시각적 차이는 theme token과 variant 로직에서만 나온다.

## 용어

### NavRail

- `NavRail`은 앱의 최좌측 전역 네비게이션 레일이다.
- 역할:
  - 앱 전체 레벨 이동
  - 현재 활성 화면 표시
  - 제품의 첫 인상과 테마 성격 노출
- 포함 대상:
  - `사무실 / 메시지 / 승인 / 큐 / 설정`
- 구분:
  - `NavRail`은 전역 메뉴
  - `ProjectRail`은 프로젝트/DM 목록

### 테마 종속화

- 데이터는 의미만 가진다.
- 시각은 theme token과 공통 primitive가 결정한다.
- 허용 예시:
  - `selected`
  - `detected`
  - `status`
  - `kind`
- 금지 예시:
  - `color`
  - 화면 전용 badge 색
  - 화면 전용 glow 강도
  - 화면 전용 active 배경색

## 확정 원칙

1. `01-Dashboard`를 시각 기준선으로 사용한다.
2. `02~06`은 `01`처럼 theme token을 깊게 사용한다.
3. 화면 전용 하드코딩 브랜드 색은 허용하지 않는다.
4. 테마별 차이는 반드시 살아 있어야 한다.
5. 카드 헤더 방식, 버튼 방식, 아바타 형태, rail 표현, 배지 표현, 패널 clip, 진행도 표현은 테마별로 달라질 수 있어야 한다.
6. 모든 가시 문자열은 최종적으로 `t()` 추출 대상이다.

## 금지 규칙

### 1. 선언되지 않은 theme prop 사용 금지

- `theme-tokens.jsx`에 없는 key를 화면 파일에서 바로 쓰지 않는다.
- 새 속성이 필요하면 다음을 먼저 수행한다.
  - `theme-tokens.jsx`의 schema comment에 추가
  - 3테마 2모드 6개 token object 전부에 값 추가
  - 공통 primitive에서 소비하도록 연결

현재 제거 대상:

- `02-msg-variants.jsx`의 `theme.sidebarBg`
- `02-msg-variants.jsx`의 `theme.sidebarBorder`
- `03-apv-variants.jsx`의 `theme.sidebarBg`

### 2. 화면 전용 하드코딩 색 금지

- 화면 variant 파일 안에 브랜드 성격을 띠는 색 literal을 두지 않는다.
- 가능한 목표는 "variant 파일에서 의미 있는 색은 전부 theme token에서 읽기"이다.
- 데이터 객체에 시각용 색을 넣지 않는다.

즉시 제거 대상:

- `06-ob-variants.jsx`의 `STAFF_CANDIDATES[].color`
- `06-ob-variants.jsx`의 `cand.color` 기반 배경/글로우
- `02-msg-variants.jsx`의 채널 active 배경용 화면 전용 색 분기

### 3. 화면 전용 시각 규칙 금지

- 화면이 필요로 하는 표현 차이는 공통 primitive 또는 theme variant로 끌어올린다.
- 한 화면에서만 쓰는 카드 헤더, 배너, 토글, 상태칩이라도 재사용 가능한 primitive로 정의할 수 있으면 먼저 그렇게 한다.

### 4. 레트로 쉘 규칙 불일치 금지

- Retro도 좌측 전역 메뉴를 유지한다.
- 다만 표현은 Warm / Tactical과 동일 복제가 아니라 line/manual 성격의 rail 문법을 따른다.
- `01~05`는 Retro에서도 좌측 rail이 보여야 한다.
- `06-Onboarding`은 pre-office 단계이므로 예외적으로 별도 shell을 가질 수 있다.
  - 대신 로고, 헤더, stepper, CTA는 동일한 theme language를 따라야 한다.

## 테마별로 반드시 달라져야 하는 표현

### Warm

- 거실 같은 사무실
- 부드러운 radius
- serif/display 강조
- 이모지 또는 생활감 있는 심벌 허용
- pill 계열 버튼/배지

### Tactical

- 관제실 / 오퍼레이션 센터
- clipped corner
- 라인 아이콘
- segmented gauge
- HUD 성격의 패널 헤더
- square/notched 버튼

### Retro

- 터미널 / 매뉴얼
- mono 중심
- ASCII / status-dot / bracket 문법
- text-button 또는 최소 장식 버튼
- CRT / paper 문법을 shell 수준에서 유지

## 공통 primitive 사용 규칙

다음 primitive를 우선 재사용한다.

- `VariantFrame`
- `NavRail`
- `ProjectRail`
- `ShellTopBar`
- `DashCard`
- `DashMiniBtn`
- `ProfileAvatar`
- `themeClip`
- `themeRadius`

다음 상황에서는 새 primitive를 허용한다.

- 대시보드 primitive와 역할이 분명히 다른 경우
- 여러 화면에서 재사용될 가능성이 높은 경우
- theme token만으로는 화면 의미가 드러나지 않는 경우

새 primitive를 만들면 지켜야 할 규칙:

- 입력은 의미 중심 props로 받는다.
- 시각은 `theme`에서 결정한다.
- 색 literal, screen-only clip, screen-only shadow를 넣지 않는다.

## 파일별 작업 체크리스트

### 02 Messenger

목표:

- 메신저 전용 화면이 아니라 "Rolestra 테마 문법을 따른 메신저"로 보이게 만든다.

정리 항목:

- [ ] `MsgChannelRail`의 `theme.sidebarBg/sidebarBorder` 제거
- [ ] 채널 레일을 공식 token만으로 다시 설계
- [ ] 채널 active 상태 색을 theme token 기반으로 통일
- [ ] 회의 배너를 메신저 전용 primitive로 승격
- [ ] Retro에서도 좌측 `NavRail`이 유지되도록 정렬
- [ ] 승인 요청 박스 문법을 `DashMiniBtn` 및 approval 계열 primitive와 정렬
- [ ] `CHANNELS`, `DIRECT`, `MEETING ACTIVE` 등 혼합된 영어 UI 라벨을 i18n 대상 문자열로 정리
- [ ] composer placeholder와 shortcut 라벨을 `t()` 후보 키로 분리

권장 primitive:

- `MsgStateBanner`
- `MsgChannelRail`
- `MsgApprovalBlock`

### 03 Approvals

목표:

- 엔지니어링 도구형 승인함이 아니라 Rolestra 테마 안의 결재함으로 정렬한다.

정리 항목:

- [ ] list pane의 `theme.sidebarBg` 제거
- [ ] list row active 상태를 공통 selection 문법으로 통일
- [ ] `PENDING / OK / NO` 상태 표기를 도메인 라벨 + i18n 체계로 재정의
- [ ] diff preview를 theme-aware code panel로 승격
- [ ] file list / context block / action bar를 공통 approval primitive로 정리
- [ ] Warm / Tactical / Retro가 list/detail 헤더 방식에서 명확히 갈리게 정리

권장 primitive:

- `ApprovalListPane`
- `ApprovalStatusBadge`
- `ApprovalDiffPanel`
- `ApprovalContextCard`

### 04 Queue

목표:

- 현재 구조는 유지하되, 대시보드 문법을 더 많이 공유하도록 정리한다.

정리 항목:

- [ ] active spotlight를 queue 전용 primitive로 승격
- [ ] segmented progress / status mark를 theme별 방식으로 더 명확히 분기
- [ ] table header / row / action button 문법을 공통화
- [ ] `theme.panelClip`을 쓰는 곳과 화면 전용 clip을 쓰는 곳을 통일
- [ ] queue summary 수치 카드가 dashboard hero와 같은 계열 primitive를 공유하도록 검토

권장 primitive:

- `QueueSummaryStrip`
- `QueueSpotlightCard`
- `QueueStatusMark`

### 05 Settings

목표:

- 현재 5개 화면 중 가장 안정적이므로, 공통 primitive 사용을 유지하면서 디테일만 정리한다.

정리 항목:

- [ ] toggle thumb의 `#fff` 같은 하드코딩 표면색 제거
- [ ] input/chip/select 표현을 form primitive로 추출
- [ ] member table의 header/body/action 문법을 다른 admin 화면과 공유 가능하게 정리
- [ ] warning banner도 공통 상태 배너 primitive로 검토

권장 primitive:

- `FormToggle`
- `FormSelectChips`
- `EntityTable`
- `StatusBanner`

### 06 Onboarding

목표:

- 가장 많이 벗어난 화면이므로 사실상 온보딩 테마 문법을 다시 잡는다.

정리 항목:

- [ ] `STAFF_CANDIDATES`에서 시각용 색 제거
- [ ] `cand.color` 기반 배경/글로우 제거
- [ ] 후보 카드 선택 상태를 theme token 기반으로 재정의
- [ ] vendor identity는 텍스트 또는 theme-colored neutral mark로만 표현
- [ ] stepper를 onboarding 공통 primitive로 승격
- [ ] top bar와 logo 표현을 shell 계열과 같은 문법으로 정리
- [ ] CTA 버튼과 detected badge를 theme-aware 상태 컴포넌트로 정리
- [ ] "벤더 카드 비교 UI"가 아니라 "Rolestra 직원 입사 선택 UI"로 톤 전환

권장 primitive:

- `OnboardingTopBar`
- `OnboardingStepper`
- `StaffCandidateCard`
- `DetectionBadge`

예외 규칙:

- 온보딩은 pre-office 단계이므로 `NavRail`이 없어도 된다.
- 대신 theme identity는 더 강하게 드러나야 한다.

## i18n 정리 기준

스펙 기준:

- `react-i18next` 유지
- ko 기본
- 새 UI 문자열은 전부 `t()` 경유

권장 도메인:

- `dashboard.*`
- `messenger.*`
- `approval.*`
- `queue.*`
- `settings.*`
- `onboarding.*`
- `member.*`
- `project.*`
- `common.*`

예시:

- `messenger.banner.active`
- `messenger.channel.section.channels`
- `messenger.channel.section.direct`
- `messenger.composer.placeholder`
- `approval.filter.pending`
- `approval.status.approved`
- `queue.spotlight.title`
- `settings.policy.defaultMode`
- `onboarding.title.staffSelection`
- `onboarding.candidate.detected`
- `common.action.next`
- `common.action.back`

주의:

- 공급자명 같은 고유명사는 raw identifier로 둘 수 있다.
- 그러나 화면에 노출되는 주변 문장과 상태 라벨은 `t()` 대상이다.

## 완료 기준

다음 조건을 만족하면 정렬 완료로 본다.

1. Warm / Tactical / Retro를 라벨 없이 봐도 즉시 구분할 수 있다.
2. Light / Dark가 바뀌어도 같은 테마의 가족성은 유지된다.
3. `02~06`이 `01`과 같은 shell grammar를 공유한다.
4. 화면 variant 파일에 선언되지 않은 theme prop이 없다.
5. 화면 variant 파일에 화면 전용 브랜드 색이 없다.
6. 데이터 객체에 시각용 색 정보가 없다.
7. 모든 가시 문자열이 `t()` 추출 대상으로 정리돼 있다.

## 구현 순서

1. `02`, `03`의 theme contract 위반 제거
2. `06`의 하드코딩 시각 데이터 제거
3. `04`, `05`의 공통 primitive 정리
4. `02~06` 전체 i18n 키 추출
5. 6개 화면을 3테마 2모드 기준으로 다시 시각 검토

## 메모

- `01`도 incidental literal이 일부 남아 있지만, 현재 라운드의 기준선은 "구조와 문법"이다.
- `02~06` 정렬이 끝난 뒤 필요하면 `01` 포함 공통 primitive 재토큰화 라운드를 별도로 잡는다.
