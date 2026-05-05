# R7~R9 결정 기록

R7 (승인 인박스 + 5 kind discriminated union) / R8 (멤버 프로필 + 출근 + Warmup) / R9 (자율 모드 + Notification + Queue + Circuit Breaker) 단계의 phase 별 결정.

---

## R7 — 승인 인박스 (5 kind discriminated union)

### R7-D1. `cli-permission-handler.ts` 즉시 삭제 (R11 묶음 X)

**결정:** R11 의 legacy 5 파일 일괄 삭제 정책과 달리, `cli-permission-handler` 는 R7 Task 4 에서 즉시 삭제.

**왜:** (i) 호출자 0 인 채로 남기면 의도치 않은 import 회귀 위험 큼, (ii) v2 engine 5 파일 (SSM 자산 디렉토리와 공존) 과 달리 독립 파일이라 R11 묶음 청소의 가치 없음, (iii) 물리 삭제 지표가 R7 성공 기준 (= legacy map 기반 pending resolver 전면 제거).

### R7-D2. CLI Permission Adapter timeout = 5 분 default

**결정:** `createCliPermissionApproval` 의 timeout 기본값 = 5 분 (300,000 ms). 옵션 override 가능.

**왜:** CLI 프로세스 무한정 블락 시 회의 전체가 멈춤. 사용자 부재 시나리오에서 5 분 후 자동 거절 (resolve(false)) 이 합리적 default.

### R7-D3. `mode_transition` 에서 조건부 버튼 비활성

**결정:** conditional decision 은 `cli_permission` / `consensus_decision` 에만 의미 있고 `mode_transition` 에는 조건 개념이 애매 (부분 적용 불가). R7 ApprovalInboxView 가 kind 확인 후 조건부 버튼 비활성 + 툴팁 "모드 변경에는 조건부 승인이 지원되지 않습니다".

- R10 재검토 결과: 조건부 버튼 자체는 그대로 비활성, 단 `mode_transition` 의 conditional comment 가 입력되면 다음 회의 system message 로 자동 주입 — R10 Known Concern #4 → R11 Task 10 (D7 in-memory `pendingAdvisory` slot) 종결.

**왜:** mode_transition 의 "조건부" = "다음 회의에 advisory 로만 반영" 이 자연 — 즉시 부분 적용은 의미 없음.

### R7-D4. `consensus_decision` timeout = 24 시간

**결정:** cli_permission 의 5 분과 다르게 24 시간으로 길게. 만료 시 `expired` 전이 + `#회의록` 에 "승인 만료로 자동 종료" 시스템 메시지.

**왜:** 회의 결과 검토는 즉시 이뤄지지 않을 수 있음. 워크플로 망가지면 안 됨. autonomy auto-approve (R9) 들어오면 default 24h 줄일 수 있음.

### R7-D5. `ApprovalPayload` discriminated union — R7 에선 3 kind 만

**결정:** `src/shared/approval-types.ts` 에 R7 발사 지점이 존재하는 3 kind (`cli_permission` / `mode_transition` / `consensus_decision`) 만 payload 타입 추가. `review_outcome` / `failure_report` 는 R8+ 에서 발사 지점 생길 때 payload 정의.

- 기존 `ApprovalItem.payload: unknown` 유지 (타입 점진 이행)
- R8 Task 9 가 `review_outcome` payload 추가, R9 가 `failure_report` + `circuit_breaker` 추가 → 5 kind 완성

**왜:** 발사 지점 없는 kind 의 payload 정의는 미사용 코드 — Just-in-time 정의가 안전.

### R7-D6. 스트림 이벤트 이름 = `stream:approval-*` 유지 (`meeting:*` 접두사 X)

**결정:** R6 meeting:* 접두사 개편과 달리, approval 은 회의 범위가 아닌 시스템 전역 개념이므로 `meeting:*` 로 바꾸지 않음. 기존 `stream:approval-created/decided` (R3 stream-events.ts 선언) 재사용.

**왜:** approval 은 회의 + DM + 프로젝트 광역 모두 발생. meeting:* 접두사는 잘못된 분류.

### R7-D7. 거절/조건부 comment 주입 범위 = `meetingId != null && channelId != null`

**결정:** `ApprovalSystemMessageInjector` 는 `meetingId != null && channelId != null` 인 approval 만 `MessageService.append` 로 주입. `mode_transition` 등 meetingId=null 케이스는 UI 상태 업데이트 (ApprovalInboxView 자동 사라짐) 만.

- R11 Task 10 — `mode_transition` 만 filter 예외 (D7 in-memory `pendingAdvisory` slot 으로 다음 회의 system message 자동 주입)

**왜:** DM/프로젝트 광역 approval 은 "다음 턴" 시간 개념 없고 주입 대상 채널 모호. R11 의 advisory slot 이 conditional 의 자연스러운 수신처.

### R7-D8. v2 `stream:cli-permission-request` 이벤트 타입 제거

**결정:** Task 4 에서 preload / shared 타입 / renderer 구독자 일괄 제거. `legacy-channel-isolation.test.ts` (R3 격리 테스트) 가 회귀 방지.

**왜:** stream-types.ts 의 해당 type literal 사라지면 TypeScript 가 모든 참조를 compile error 로 잡음 — 누락 위험 낮음.

---

## R8 — 멤버 프로필 + 출근 + Warmup

### R8-D1. v3 PersonaBuilder swap 범위 = `meeting-turn-executor` 만

**결정:** R8 은 `src/main/meetings/engine/meeting-turn-executor.ts` 의 v2 `buildEffectivePersona(provider, opts)` 호출만 v3 `MemberProfileService.buildPersona(providerId)` + permission rules append shim 으로 교체.

- v2 `src/main/engine/turn-executor.ts` + `src/main/engine/persona-builder.ts` 는 R6 deprecation + tsconfig exclude → 호출자 0
- R11 Task 2 에서 v2 engine 5 파일 + persona-builder 일괄 삭제 (legacy cleanup 묶음)

**왜:** R8 에서 따로 삭제할 가치 0 — R11 묶음 일관성.

### R8-D2. Custom avatar 저장 = `<ArenaRoot>/avatars/<providerId>.<ext>` (DB 는 상대 경로)

**결정:** spec §7.1 그대로 `<ArenaRoot>/avatars/<providerId>.<ext>` 로 복사. DB 컬럼 `member_profiles.avatar_data` 에는 상대 경로 (`avatars/<providerId>.<ext>`) 만 저장.

- 절대 경로 저장 — 사용자가 ArenaRoot 이동 시 깨짐 → 금지
- base64 저장 — 이미지 binary 가 DB 비대화 → 금지
- file:// URL — Renderer 가 file:// 직접 다루면 path-guard 충돌 → 금지

**왜:** ArenaRoot 안 봉인 + portable + DB 가벼움 동시 만족.

### R8-D3. 부팅 warmup = `Promise.allSettled` + 5 초 timeout (fire-and-forget)

**결정:** `MemberWarmupService.warmAll(ids)` 를 await 하지 않음. 각 provider 에 대해 `Promise.race([svc.reconnect(id), timeout(5000)])` 만들고 `Promise.allSettled` 로 한 번에 시작.

- timeout 후에도 `svc.reconnect` 는 background 계속 (cancellation 미구현 — Electron `provider.warmup` 자체에 abort signal 없음)
- 5 초 timeout 은 spec §7.2 `connecting` 라벨 의미와 일치

**왜:** (i) 직렬은 첫 화면 30 초+ 블락, (ii) await 는 빠른 provider 가 느린 provider 에 묶임, (iii) 5 초 timeout 이 사용자 체감 자연.

### R8-D4. TurnManager skip 정책 = turn 단위, 회의 진행 유지

**결정:** `online` 이 아닌 멤버는 그 턴만 skip. 회의는 계속. 새 SSM 상태 (`WAITING_PARTICIPANTS` 등) R8 에서 도입 안 함.

- 모든 participant 가 offline 인 edge case 는 SSM 기존 timeout 흐름이 abort 처리 — 회의 자연 종료
- autonomy 와 함께 R10 재검토 (자동 retry / queue 보류)

**왜:** SSM 12 상태 + 가드는 R2 land 안정 자산 — 추가 상태는 리뷰 비용 큼.

### R8-D5. 클릭 트리거 통일 = 3 surface → 동일 Popover

**결정:** 메시지 버블 아바타 / MemberRow / PeopleWidget 의 아바타 클릭은 모두 같은 `MemberProfilePopover`. anchor 만 클릭한 element.

**왜:** UX 일관성 + 컴포넌트 재사용. surface 별 차이는 anchor 위치 뿐 (Radix Popover 자동 처리).

### R8-D6. Popover (보기) vs Modal (편집) 2 단계

**결정:** 프로필 보기 = Radix Popover (가벼움, hover-like), 편집 = Radix Dialog (풀스크린, 의도적 진입).

- spec §7.1 명시 — "프로필 팝업 → 편집 버튼 → 프로필 모달"

**왜:** 매번 모달 풀스크린은 (i) 빠른 확인 무거움 (ii) 우발적 수정 위험. Popover 의 "편집" 버튼이 명시적 의도.

### R8-D7. Custom avatar 업로드 검증 = ext 화이트리스트 + 5MB + EXIF 무시

**결정:**
- ext: `png` / `jpg` / `jpeg` / `webp` / `gif`
- 크기: 5 MB 제한
- EXIF 등 metadata 읽지 않음
- base64 변환 없음 (항상 파일 복사)

**왜:** (i) sharp 등 이미지 라이브러리 의존성 0, (ii) path-guard 적용 (저장 경로는 ArenaRoot 안), (iii) 5 MB = 일반 프로필 충분, (iv) EXIF 위치 정보 의도치 않은 노출 차단.

### R8-D8. Stream vs Invalidation = R8 은 invalidation 만

**결정:** `member:set-status` / `member:reconnect` / `member:update-profile` 결과는 단순 IPC 응답으로 받고 호출 측 (popover) 에서 mount-fetch 다시. `stream:member-status-changed` 등 실시간 broadcast 는 R10 으로 이연 → R10 Task 10 land + R11 D9 dual-path 공존.

**왜:** Popover 자체에서만 사용하는 mutation 이라 다중 surface 실시간 broadcast 가 과대. R10 에서 autonomy / 다중 surface 도입 시 자연스럽게 추가.

---

## R9 — 자율 모드 + Notification + Queue + Circuit Breaker

### R9-D1. AutonomyGate 배치 = ApprovalService 'created' 이벤트 훅

**결정:** `AutonomyGate` 는 ApprovalService 'created' 이벤트 훅으로 구현. ApprovalService 내부에 if 분기 추가하지 않고 별도 모듈.

**왜:** (i) ApprovalService 의 단일 책임 유지 (승인 상태 머신), (ii) 테스트 용이 (AutonomyGate 단독 테스트), (iii) R10 에서 autonomy 정책 복잡해져도 ApprovalService 오염 0.

### R9-D2. Circuit Breaker persistence = R9 범위 밖 (R10 D10 신규 마이그레이션 012)

**결정:** R9 에서 `CircuitBreaker` 는 in-memory. 재시작 시 counter 리셋 (CD-2 명시).

- R10 Task 9 가 마이그레이션 012 (`circuit_breaker_state`) 신규 + hydrate/flush 정식 → R10 D10
- R11 신규 마이그레이션 추가 금지 (R10 D10 한 건만 — R11 의 013/014 는 onboarding/llm 신규 도메인)

**왜:** R9 시점에는 4 tripwire 중 3 (turn/queue/error) 가 turn 단위로 자연 리셋. `cumulative_cli_ms` 만 재시작 시 리셋이 오히려 사용자 친화 (장시간 중단 후 재개).

### R9-D3. Drag-and-drop = HTML5 native + React state (`@dnd-kit/core` X)

**결정:** QueuePanel 의 drag-and-drop 은 HTML5 native `draggable=true` + React state 로 구현. `@dnd-kit/core` 같은 라이브러리 도입 안 함.

**왜:** (i) 5~20 항목 예상 규모, (ii) mobile 미지원이어도 OK (Electron desktop), (iii) R8 의 "신규 dep 최소화" 기조 유지.

### R9-D4. AutonomyConfirmDialog 적용 범위 = manual → auto_toggle / queue 만

**결정:** manual → auto_toggle / manual → queue 두 전환만 확인 다이얼로그. auto_toggle ↔ queue / 다운그레이드는 바로.

**왜:** 두 전환 모두 circuit breaker 동일 적용 — 이미 auto_toggle 에서 확인했으니 queue 추가 확인은 노이즈. manual 로의 다운그레이드는 안전 방향이라 마찰 최소화.

### R9-D5. AutonomyGate 실패 경로 = 자동 다운그레이드 (decide X)

**결정:** `review_outcome=rework/fail` 이나 CLI 실패 등 "실패 조건" 시 해당 approval_item 은 decide 하지 않고 (대기 상태), 프로젝트 autonomyMode 를 manual 로 다운그레이드. 사용자가 봐서 처리.

**왜:** (i) 자동 accept 가 accepted 에만 적용되어야 하는 spec §8 준수, (ii) 실패 시 item 을 자동 decide=rejected 하면 사용자가 근거 잃음.

### R9-D6. Notification seed 타이밍 = 부팅 시 `seedDefaultPrefsIfEmpty()` (INSERT OR IGNORE)

**결정:** 부팅 시 seed — 최초 1회 INSERT OR IGNORE. 사용자가 kind 별 prefs 수정 후 row 삭제하는 일은 없음 (UI 는 row UPSERT 만).

**왜:** (i) prefs 가 DB 에 존재해야 `NotificationService.show` 가 gate 판정, (ii) migration 에 DEFAULT value 넣는 대신 seed 분리 — 추후 값 변경 유연.

### R9-D7. 외근 자동 timeout 평가 = `getWorkStatus` 호출 시 lazy

**결정:** lazy evaluation. 별도 timer/스케줄러 없음. `getWorkStatus` 자주 호출되므로 실시간성 충분.

**왜:** (i) timer 는 Electron 재시작 시 복구 필요, (ii) lazy 는 구현 단순 + 정확.

**대안:** R10+ 에서 실시간 UI 요구 생기면 `stream:member-status-changed` 와 함께 도입 — R10 Task 10 에서 land.

### R9-D8. i18n main-process 라벨 전략 = `notification-labels.ts` dictionary

**결정:** `notification.*` top-level namespace 는 ko/en 양쪽 populate + i18next-parser keepRemoved regex 에 `notification.*` 포함. main-process 는 `src/main/notifications/notification-labels.ts` 의 locale resolver dictionary 로 lookup (main 이 i18next 를 직접 import 하지 않음 — 의존성 방향 유지).

- R11 D9 — 한국어 유지 + locale 분기 default. R11 Task 11 이 dictionary 23 신규 leaf 확장 (approvalNotificationBridge.* / autonomyGate.* )

**왜:** main-process 가 i18next init 하면 번들 크기 + SSR 흉내 — dictionary map 이 충분 + 의존성 깨끗.

---

## R7~R9 통합 영향

- R7 의 5 kind discriminated union 이 R9 (autonomy decide) / R10 (CircuitBreakerApprovalRow) / R11 (mode_transition advisory) 의 단일 진입점
- R8 의 PersonaBuilder + Warmup + 클릭 트리거가 R9 의 autonomy mode 변경 흐름과 결합 (`AutonomyConfirmDialog` 가 같은 Modal 패턴)
- R9 의 `notification-labels.ts` dictionary 가 R10 (member-status / approvalSystemMessage / meetingMinutes) + R11 (approvalNotificationBridge / autonomyGate) 의 확장 기반
