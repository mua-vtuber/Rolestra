---
name: R12-C2 T22 종결 — 일반 채널 RunStep 분기 (옵션 C, P4 진입 4 호, 2026-05-07)
description: R12-C2 Round 2 P4 진입 4 호 완료. 일반 채널 = 회의 X invariant 유지하면서 대시보드 진행률 패널의 "잡담 (카드 N)" 라벨 데이터 source 확장. RunStepAggregator 분기 — 일반 채널은 opinion 폴더에서 카드 수만 직접 카운트, RunStep 안 적음 (옵션 C). 마이그레이션 0 / 검사관 위반 +0 — 옵션 C 의 미덕. 다음 T23 (E. 임무 카드 schema + designated-worker-resolver) 진입 가이드.
type: project
originSessionId: continuation
---
# R12-C2 T22 종결 (2026-05-07)

worktree `feat/r12-c2-redesign-r2`, base `e694eb7` (= T21 SHA sync). production commit `236a20f`. 4 파일 / +206 / -10 (3 변경 + 1 신규 시나리오 묶음).

**Why:** spec §11.21.2 dashboard 위젯 라벨 "일반 — 잡담 (카드 12)" 의 N 출처 정식화. spec §11.19.5 본문은 "일반 부서 = `opinion_gather` 만" 으로 RunStep 토대 공유를 시사하지만 §11.3 은 "회의 X" 명시 — 두 진술이 충돌. **사용자 결정 (옵션 C)**: 잡담은 가벼운 surface 라 RunStep 안 적음, 추적 가치 없음. 진지한 작업 논의는 user 자유 채널 만들고 역할을 부서 중 하나로 변경 (시스템에 이미 가능한 동작 — 별도 dogfooding 거리).

**How to apply:** 새 세션 진입 시 T23 (P5 진입 1 호 — E. 임무 카드 schema + designated-worker-resolver) 권장. T23 의존 = T14 + T18 = 모두 충족. T23 = `src/shared/schema/mission-card.ts` 신규 (MissionCard discriminated union 'spec'/'fix'/'change-request') + `src/main/meetings/designated-worker-resolver.ts` 신규 (부서장 핀 > drag_order 1번 > fallback 자율 모드). T23 *주의*: 부서장 핀 실 컬럼 (T36) / drag_order 컬럼 (T37) 는 P7 phase — 본 T23 는 *resolver 의 알고리즘 + fallback path* 만 land, 실 데이터 source 는 T36/T37 이후 wire (자율 모드 default 만 일단 동작).

## 핵심 결정

### 옵션 A vs C 토론 (사용자 결정 = C)

| 옵션 | 핵심 | 채택 X 근거 |
|------|------|----|
| A. m022 ALTER `meeting_id` NULL 허용 | run_step 12-step rebuild (m021 패턴) | 잡담 추적 가치 없음 — 보관함 schema 손대는 비용이 직관적 가치보다 큼 |
| B. Synthetic "general" meeting | 잡담방마다 영원 활성 meeting row | "회의 X" invariant 와 정면 충돌, SSoT 위반 |
| **C. RunStep 회의 전용 유지, aggregator 가 opinion 폴더 직접 카운트** | DashboardProgress.cardCount 신규 + isGeneralChannel 분기 | **채택** — "잡담 가볍게" 사용자 직관 + 마이그레이션 0 / 검사관 추가 위반 0 |

핵심 결정 근거 (사용자 발화 그대로): "잡담방은 그냥 가볍게 논의하는거라 추적까지는 할 필요 없을 것 같아. 작업 관련 논의였다면 따로 유저가 생성 할 수 있는 회의채널을 추가해서 하게 할까싶은데?" → **확인 결과 시스템에 이미 가능** (사용자 자유 채널 만들고 역할을 부서 중 하나로 변경하면 그 채널은 부서처럼 회의 가능 — spec §11.4 "사용자 자유 채널 (선택)" + role 매핑 자유).

### DepartmentStatus 신규 'chatting' (vs 'idle' 재사용)

'chatting' 별도 추가 채택. 'idle' 재사용 안 한 근거:
- 'idle' = "회의 한 번도 없음" 의미 명시 (회의 부서 안 안 시작 상태)
- 'chatting' = "회의 개념 자체가 없는 잡담방"
- 두 의미가 다름 — 'idle' 재사용 시 UI 가 "잠재적 회의 시작" affordance 잘못 노출 위험

### cardCount: number | null (회의 부서 = null)

회의 부서 cardCount=null = "잡담 surface 아님" 명시. 0 이 아닌 null:
- 0 은 "잡담방인데 카드 0건" 의미
- null 은 "이 부서는 잡담 surface 자체가 없음"

UI 에서 `cardCount === null` → "잡담 (카드 N)" 라벨 안 그림 / `cardCount >= 0` → 그림.

### 일반 채널 식별 = isGeneralChannel(channel) helper 재사용

T20 land 시 export 한 helper 재사용 — `kind === 'system_general'` OR (`kind === 'user' && role === 'general'`). 본 aggregator 호출 시점 = `channel.role === null` 분기 직후라 두 번째 OR 분기 (user role='general') 만 도달 가능. 전역 #일반 (system_general, projectId NULL) 은 `channelRepo.listByProject` 가 애초 안 돌려주므로 본 surface 도달 X.

## 신규 4 + 변경 0 = 4 파일

**변경 4:**
- `src/shared/dashboard-progress-types.ts` — DepartmentStatus union 에 'chatting' 추가 + ALL_DEPARTMENT_STATUSES readonly 갱신 + DepartmentProgress 에 `cardCount: number | null` 필드 추가 + jsdoc.
- `src/main/meetings/run-step/run-step-aggregator.ts` — 생성자에 OpinionRepository 의존 추가 + `getProgressSnapshot` 안 isGeneralChannel 분기 → buildGeneralProgress helper 호출 + 회의 부서 row 들에 `cardCount: null` 명시 + buildGeneralProgress helper 신규 (status='chatting' / cardCount=opinion 폴더 길이 / 나머지 RunStep 관련 모두 null/0).
- `src/main/index.ts` — RunStepAggregator 생성자 호출에 opinionRepo 추가 (이미 line 227 에서 생성된 인스턴스 재사용).
- `src/main/meetings/run-step/__tests__/run-step-aggregator.test.ts` — describe block 'general channel (T22 option C)' 신규 (4 케이스: 빈 잡담방 / postFromGeneralChannel 카드 등록 정합 / RunStep 안 적힘 invariant / 같은 프로젝트 잡담방 2개 격리) + 기존 'currentRound=null...' 시나리오 role 변경 ('general' → 'idea' — 일반 채널 회의 X invariant 와 충돌 회피) + 회의 부서 1건 'status=idle' 케이스에 cardCount=null 단언 추가 + opinionRepo / opinionService 셋업 추가.

## 검증

- typecheck:node + typecheck:web **0**
- vitest **3572 PASS / 13 skip** (T21 baseline 3568 → +4)
  - 신규 4 (general channel describe block)
- inspect:safety **99** (T21 동일, T22 위반 +0 — 마이그레이션 추가 안 함이 옵션 C 의 미덕)

## 미작업 (의도)

- **마이그레이션 0건** — 옵션 C 의 미덕. 옵션 A 였으면 +4 false positive (m021 와 동일 framework-managed 패턴) 가 깔렸을 것.
- **i18n / UI 위젯 본체** — spec 상 T40 (P7-5 dashboard layout) 책임. T22 는 데이터 source 확장만 — T40 시점에 ko/en "잡담 (카드 N)" / "Chat (N cards)" 키 추가 + DepartmentStatus 'chatting' UI chip 라벨.
- **잡담방 카드 추가 시 위젯 자동 갱신 stream 신호** — mount + zustand TTL 1분 으로 충분 (사용자 결정 — 잡담은 가볍게). 회의 부서는 RunStep 'appended' → `stream:dashboard-progress-changed` 통로 이미 있음 (T19 land). 잡담방용 별도 stream 통로 미연결 — 후속 H 단계에서 필요 판단 시 OpinionService 'card-changed' 이벤트 + StreamBridge 변환 추가 가능.

## 지연 follow-up

- **사용자 자유 채널 → 부서 역할 변경 UI 친화도 점검** — 시스템에 이미 가능한 동작 (spec §11.4 + role 매핑 자유). 사용자 의도 ("작업 관련 논의는 따로 유저가 생성할 수 있는 회의채널") 가 이미 만족됨. 다만 채널 만들고 역할 바꾸기 메뉴 동선이 직관적인지 dogfooding 라운드에서 확인 거리.

## 다음 = T23 (P5 진입 1 호 — E. 임무 카드 schema + designated-worker-resolver) 권장

T23 의존 = T14 + T18 = 모두 충족. T23 산출:
- `src/shared/schema/mission-card.ts` 신규 — MissionCard discriminated union (`'spec'` 의견+기획서 / `'fix'` audit NG 보고 / `'change-request'` 변경 요청) + payload (작업 본문 + 입력 파일 list + 출력 기대치) + `assigned_provider_id` (designated worker)
- `src/main/meetings/designated-worker-resolver.ts` 신규 — 우선순위 (부서장 핀 T36 > drag_order 1번 T37 > fallback 자율 모드 default)

T23 *주의*: 부서장 핀 / drag_order 실 컬럼은 P7 phase (T36/T37). T23 는 *resolver 알고리즘 + fallback path* 만 land — 실 데이터 source 는 T36/T37 이후 wire (자율 모드 default 만 일단 동작).
