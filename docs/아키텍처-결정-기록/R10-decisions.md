# R10 결정 기록

R10 (다듬기 — Polish) 단계의 D1~D10. R1~R9 내내 "R10 deferred" 라벨로 미뤄둔 항목 + R9 Known Concerns 6 건 + 디자인 fidelity 갭을 일괄 수확.

---

## D1. DM 데이터 모델 = 기존 `channels.kind='dm'` 재사용 (별도 `dm_sessions` 테이블 X)

**결정:** R10 의 DM 정식 land 는 기존 `channels` 테이블 + `kind='dm'` + `idx_dm_unique_per_provider` 재사용. 별도 `dm_sessions` 테이블 미도입.

- DmListView / DmCreateModal / Thread `kind='dm'` 분기 / `channel-service.createDm` / `dm:list`/`dm:create` handler 모두 channels 위에 layer

**왜:** DM 도 결국 채널 — 메시지 저장 / 검색 / 권한 모두 동일. 별도 테이블 분리는 schema 분기 + JOIN 비용. R6 D7 ("MeetingSession 은 participants ≥ 2") 과도 일치 — DM 은 회의 흐름 사용 안 함, channels 는 그대로 reusable.

**대안:** 별도 `dm_sessions` 테이블 — 각하 (schema 분기 비용 + 메시지 저장 분리 시 검색 통합 어려움).

---

## D2. MessageSearch UI = Radix Dialog 모달 (사이드 패널 X — V4 이연)

**결정:** R10 Task 2 MessageSearchView 는 Radix Dialog 모달. ChannelView 사이드 패널은 V4 이연.

**왜:** 사이드 패널은 ChannelView 레이아웃 자체 변경 — 6 테마 fidelity 까지 영향. 모달은 layout 영향 0 + 빠른 land. V4 에서 사이드 패널 옵션 추가 시 모달 → 사이드 전환은 자연.

---

## D3. 설정 UI 10 탭 = horizontal Radix Tabs (vertical sidebar nav 각하)

**결정:** Settings 10 tab 컴포넌트 (Members / Notifications / AutonomyDefaults / ApiKeys / Theme / Language / Path / Cli / Security / About) 는 horizontal Radix Tabs. vertical sidebar nav 각하.

**왜:** vertical sidebar = 별도 layout state + 모바일 반응형 복잡. horizontal Tabs 가 6 테마 token 과 자연스럽게 일관.

---

## D4. 6 테마 fidelity 전략 = 형태 토큰 정식 wire (R10 sign-off, R11 이연 X)

**결정:** R3 시점 도입한 형태 토큰 (`panelClip` / `cardTitleStyle` / `miniBtnStyle` / `gaugeGlow` / `avatarShape`) 을 R4~R9 신규 surface (MessengerView / ApprovalInboxView / MemberProfilePopover / AutonomyConfirmDialog / QueuePanel / NotificationPrefsView / SettingsTabs / R10 신규 MessageSearchView + DmListView) 에 실제 wire — Tactical 12 분절 게이지 / Retro ASCII 게이지 / Warm 라운드 패널 등 시각적으로 분명한 차이가 모든 surface 에 적용.

- 12 스크린샷 증빙 (6 테마 × 2 모드)
- 사용자 sign-off — 메모리 `rolestra-design-fidelity-gap.md` (R4 시점 "토큰 스왑만으로 공통 형태 + 색만") 해소
- design polish 라운드 1·2 (commit `b35a7d3` / `281b6bd` / `0485ddc` / `dc4a763`) 까지 land

**왜:** R4 시점 사용자 피드백 ("토큰 스왑만으로 공통 형태 + 색만 느낌") 이 R5+ themeKey 형태-레벨 분기 필수. R11 이연 시 사용자 출시 전 fidelity 불완전.

---

## D5. Playwright CI matrix = GitHub Actions 표준 hosted runner (self-hosted X)

**결정:** GitHub Actions 표준 hosted runner — Windows + Linux + macOS. self-hosted 미사용. macOS hosted minutes 비용 monitoring 은 R11 Task 14.

**왜:** self-hosted 는 인프라 운영 비용. R10 시점에는 hosted 충분. R11 Task 14 (PR/cron trigger 분리) 가 비용 cap.

---

## D6. `circuit_breaker_state` PRIMARY KEY = (project_id, tripwire) — 단일 row × 4 tripwire = project 당 4 row max

**결정:** R10 Task 9 마이그레이션 012 의 `circuit_breaker_state` 테이블 PRIMARY KEY = `(project_id, tripwire)`. 단일 row × 4 tripwire = project 당 최대 4 row.

- 4 tripwire: `files_per_turn` / `cumulative_cli_ms` / `queue_streak` / `same_error`
- hydrate / flush 패턴 — 부팅 시 prepare statement 로 한 번에 hydrate, mutation 시 즉시 flush
- 재시작 후 counter 유지

**왜:** project 당 4 row 가 최대 — auto-incr id 보다 composite key 가 lookup 빠름.

---

## D7. LLM 회의록 요약 = capability `summarize` fallback chain (사용자 명시 선택 X)

**결정:** R10 Task 11 `meeting-summary-service` 는 capability fallback chain 으로 첫 번째 `summarize=true` provider 호출. 사용자가 회의별로 provider 명시 선택 안 함.

- R10 임시: `'streaming'` capability 로 우회 (R10 Known Concern #7)
- R11 Task 9 — `'summarize'` capability literal 정식 도입 + 6 provider config 갱신 (Claude API/Codex/Gemini/Anthropic/OpenAI/Local Ollama) → R10 D7 정식 종결
- R11 Task 8 — token usage 추출 + 비용 가시화 (마이그레이션 014) → R10 D7 첫 항목 종결

**왜:** 사용자가 회의별 provider 선택은 step 추가 + UX 마찰. capability fallback 이 자연스러운 default. provider drop-down 추가는 V4 이연.

---

## D8. Optimistic UI scope = R10 에서 3 hook 만 (메시지/autonomy/queue)

**결정:** Optimistic UI 는 R10 에서 3 hook (`use-channel-messages.send` / `use-autonomy-mode.confirm` / `use-queue.addLines`) 만. invoke 전 zustand store 에 `{status:'pending', tempId}` 임시 row 추가 → 성공 시 server-issued id swap, 실패 시 rollback + ErrorBoundary toast.

- R7 `ApprovalBlock.decide` / R8 `MemberProfile.edit` 은 R11 Task 15 에서 확장 → 5 hook
- 추가 확장은 V4

**왜:** 3 hook 이 가장 빈번한 사용자 액션 — 가장 큰 체감 개선. 모든 mutation 에 optimistic 적용은 reducer ordering 복잡도 폭증.

---

## D9. `stream:member-status-changed` = invalidation 패턴과 공존 (replace 안 함)

**결정:** R10 Task 10 의 stream broadcast 와 R8 의 mutation invalidation 공존. 통합 금지 — 둘 다 필요.

- stream: 다중 surface 실시간 broadcast (member status 변경 시 PeopleWidget / Popover / MemberRow 동시 갱신)
- invalidation: mutation 호출 측 자체 refetch (Popover 의 "편집" 후 자기 화면 갱신)

**왜:** stream 만 사용 시 자기 화면 갱신은 stream broadcast 거치는 우회 + race 위험. invalidation 만 사용 시 다른 surface 갱신 누락. 둘 다 필요.

---

## D10. R10 신규 마이그레이션 = 1 건만 허용 (012 `circuit_breaker_state`)

**결정:** R10 의 forward-only 마이그레이션 1 건만 — `012-circuit-breaker-state.ts`. 다른 task 에서 마이그레이션 추가 금지.

- R11 마이그레이션 추가 — D3 (013 `onboarding_state`) + D4 (014 `llm_cost_audit_log`) 2 건 한정
- spec §5.2 마이그레이션 chain 위에 등록

**왜:** 마이그레이션은 schema 안정성 핵심 — phase 당 신규 1~2 건이 안전 한계. 누적 시 forward-only 보장 어려움.

---

## R10 통합 영향

- D1 (DM channels 재사용) + D2 (검색 모달) + D3 (Settings 10 탭) 가 R10 신규 surface 디자인 일관성 확보
- D4 (형태 토큰 fidelity) 가 R11 Task 13 의 디자인 폴더 정식 (sign-off) 기반
- D5 (CI matrix) + D6 (circuit_breaker schema) 가 R11 Task 4 (OS matrix 안정화) + Task 9 (circuit_breaker UI 정식 편입) 의 의존성
- D7 (summarize capability) + D8 (Optimistic UI scope) 가 R11 Task 9 / Task 15 의 직접 후속
- D9 (stream + invalidation 공존) 가 R10 → R11 → V4 까지 유효 (multi-window 도입 시 재검토)
- D10 (마이그레이션 단일) 이 R11 의 D3+D4 (013+014) 제약 근거
