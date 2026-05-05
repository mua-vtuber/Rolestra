# R12-C2 round 2 — 참고 프로젝트 8 후보 흡수 결정

R12-C2 Round 1 (T0~T10b) main land 후 — 참고 프로젝트 (Symphony / oa-py / alex-core) 의 8 후보 (A~H) 를 R12-C2 안에 흡수하는 결정 8 건. 사용자 결정 4 항 (R1 / B1 / H1+H2 / F2) 정식화 + 8 후보 도입 근거 + Round 1 종결 + Round 2 진입 정리.

본 ADR 은 spec `2026-05-01-rolestra-channel-roles-design.md` §11.18.8 + §11.19~§11.22 의 *결정 근거* 를 묶는다. 구현 acceptance 는 plan `docs/plans/2026-05-04-rolestra-phase-r12-c2.md` 에서 정의.

---

## D1. R12-C2 sub-task 재구성 = R1 (전체 재분해)

**결정:**
- R12-C2 Round 1 (T0~T10b) 의 main land 자산은 보존
- *미land 영역* (T10c + T11~T35) 을 모두 폐기 후 8 후보를 *반영 단계 단위* (기반 → 시스템 → 화면 → 인계) 로 sub-task 새로 분해
- 새 plan = `docs/plans/2026-05-04-rolestra-phase-r12-c2.md` 통째 재작성

**왜:**
1. 8 후보의 *기반층* (A RunStep + F 검사관) 이 다른 후보 (B/C/D/E/G/H) 의 *전제 조건* — 기존 plan 의 부서 흐름 sub-task 안에 후보를 *추가 acceptance* 로 묻으면 (R2 옵션) 같은 후보가 여러 sub-task 에 분산됨.
2. R1 = 후보 1 개 = sub-task 1~3 개로 *국소화*. 후보별 acceptance 가 sub-task 경계와 정렬.
3. T0~T10b land 자산 (옛 SSM 폐기 / OpinionService / MeetingMinutesService / migration 019) 은 양 옵션 모두 보존. R1 의 폐기 비용은 미land 영역 (T10c + T11~T35) 한정.
4. 옵션 R3 (additive plan 병행) 는 두 plan 이 동일 회의 surface 를 동시에 손대 *동작 안정성 회귀* 직접 발생 — 평가 정책 (절대 위반 금지 규칙) 정합 안 함 → 옵션 자체에서 제외.

**대안:** R2 (기반 신설 + 기존 흐름 조정) — 작업량 작으나 후보가 sub-task 안에서 분산. R3 (additive plan 병행) — 동작 안정성 회귀 직접 발생.

**산출:**
- Round 1 종결 자산 (T0~T10b) main land — `5472bef` merge + `8e6a602` tip
- Round 2 새 worktree `/mnt/d/Taniar/Documents/Git/Rolestra-r12c2-r2` (브랜치 `feat/r12-c2-redesign-r2`, base `8e6a602`)
- spec §11.19 (A) §11.20 (F) 신규 — R1 plan 의 *입력*

---

## D2. B (NextStep 카드) 자율 정책 = B1 (안전 카드만 자동)

**결정:**
- 발화 직후 시스템이 응답 → 7 카드 중 하나 분류
- 안전군 (「계속 발언」「대기」) = **자동** (사용자 확인 X)
- 결과 전파군 (「결재」「도구」「인계」「회의록 정리」「회의 종료」) = **항상 사용자 확인**
- 「인계」 카드 → 받는 부서 channel.handoff_mode 따라 분기 (auto = 자동 / check = 모달)
- maxRounds cap 도달 시 「계속 발언」 자동을 「회의 종료」 강제로 override

**왜:**
1. 결과 전파군 5 카드 = 회의 *밖* 결과 (파일 변경 / approval 결정 / 다른 부서 진입 / 회의록 fix / 큐 진행). 자동 진행 = 사용자 검토 없는 영향 — *절대 위반 금지 규칙 #3 (승인 없는 파일 반영 금지)* 와 직접 충돌.
2. 옵션 B2 (자율 모드 따름) / B3 (카드별 사용자 정책) 은 사용자가 결재 / 인계 카드를 자동 토글 가능 → 절대 규칙 #3 우회 가능 → 평가 정책 (절대 위반 금지 규칙 위반 옵션 제외) 정합 안 함 → 옵션 자체에서 제외.
3. NextStep 분류 규칙이 *안전군 / 결과 전파군* 두 분류만 가짐 — 단순. 모호 / 빈 카드 = 안전 wait fallback.
4. handoff_mode='auto' 의 의미가 *명시 opt-in 우회* 로 좁아짐 — 정책 자체는 유지, 의미는 더 명확.

**대안:** B2 (자율 모드 따름) / B3 (카드별 토글) — 절대 규칙 #3 위반 가능 → 제외.

**산출:**
- spec §11.18.8a 카드 7 종 + 안전 / 결과 전파 분류
- spec §11.18.8b 분류 규칙 (시스템 → 카드)
- spec §11.18.8c handoff_mode 우회 룰
- spec §11.18.8d maxRounds cap 인터락
- spec §11.18.8e 4 레이어 정리 (자율 모드 / max_rounds / handoff_mode / B1)
- 구현 = `src/main/meetings/engine/next-step-classifier.ts` (R12-C2 P2 신규)

---

## D3. H (진행률 surface) = H1 + H2 (대시보드 합계 + 받는 부서 첫 화면)

**결정:**
- **H1 — 대시보드 합계** : 프로젝트 *전체* 진행률 패널을 dashboard 메인에 도입. 부서별 chain 위치 + lock 부서 + 큐 길이 + 최근 회의록 표시.
- **H2 — 받는 부서 첫 화면 인계 패키지** : B1 「인계」 카드 → 받는 부서 채널 진입 시 *첫 surface* = 보낸 부서 회의록 + 인계 사유 + 받는 부서 작업 list.

**왜:**
1. 두 surface 가 *서로 다른 정보* 다룸 — 사용자의 두 질문에 1:1 대응:
   - "전체가 어디까지 왔나" = H1 (합계)
   - "이 부서가 무슨 패키지를 받았나" = H2 (컨텍스트)
2. 옵션 H1 단독 — 인계 시점의 *받는 부서 진입 첫 화면* 강한 게이트 surface 사라짐 (모달로 약화).
3. 옵션 H2 단독 — 합계 surface 미해결 (사용자가 부서별 헤더 차례로 봐야 전체 이해).
4. 옵션 H3 (부서별 채널 헤더 분산) — 6 부서 + 일반 + DM 헤더 분산 + 합계 surface 미해결 + 헤더 영역 좁아 진행률 + 인계 요약 함께 담기 어려움.
5. H1 + H2 결합 = 두 정보 분리 + 중복 X.

**대안:** H1 단독 / H2 단독 / H3 (부서별 분산) — 모두 합계 또는 컨텍스트 한 쪽 미해결.

**산출:**
- spec §11.21 H1 대시보드 진행률 패널 (data source = RunStep 집계 + meetings + queue_items)
- spec §11.22 H2 받는 부서 첫 화면 인계 패키지 (data source = handoff_dispatch 테이블 + minutes.md)
- 구현 = R12-C2 P5~P6 안에서 land (P5 = handoff_dispatch / P6 = HandoffApprovalModal + H2 surface / P7 = H1 dashboard layout)

---

## D4. F (검사관) 강도 = F2 (단계적 fail-closed — 안전 경계 한정)

**결정:**
- **6 헌법** = SSoT / SoC / Consistency / Atomicity / Idempotency / NoSilentFallback. CLAUDE.md 절대 위반 금지 규칙 7 항의 *코드 표현*.
- **검사관 catalog** = 6 헌법 위반 검출 룰 set. 카테고리별 안전 경계 / 비안전 영역 분류.
- **F2 단계적 fail-closed**:
  - phase 1 = 모든 카테고리 report-only (false positive 정리)
  - phase 2 = 안전 경계 7 카테고리 (secrets / exec / migration / IPC / approval / path-guard) fail-closed (빌드 실패), 비안전 5 카테고리 (UI 한글 / mock / 매직넘버 / 중복 상수 / unused export) report-only 유지
- phase 1 → phase 2 전환 게이트 = 모든 안전 경계 룰의 false positive 0 건 + 사용자 명시 승인 (별 sub-task)

**왜:**
1. 옵션 F1 (report-only) — 절대 규칙 #2 (silent fallback / mock 데이터) 가 검사관에서 강제되지 않음 → CLAUDE.md 절대 규칙과 *코드 표현* 사이 갭. NoSilentFallback / Atomicity / Idempotency 의 동작 안정성 보장 부분이 *개발자 의지* 에 의존.
2. 옵션 F3 (즉시 hard gate) — false positive 가 빌드 차단 → 회피 패턴 (`// disable` 회피 주석) 등장 → 헌법 자체가 *무력화*. 검사관 자체가 false positive 로 빌드를 막으면 *그것 자체가 동작 불안정*.
3. F2 — 안전 경계 = 절대 위반 금지 규칙 7 항과 1:1 정렬 + 비안전 영역 점진 강화 옵션 보존. *최소 강제 범위*.
4. F = 다른 후보 (A/B/C/D/E/G/H) 의 평가 기준 → R12-C2 *기반층 sub-task 1 호* (A 보다 먼저 진입). 진입 우선순위 §A2 메모리 그대로.

**대안:** F1 (report-only) — 절대 규칙 갭. F3 (즉시 hard gate) — false positive 회피 패턴으로 헌법 무력화.

**산출:**
- spec §11.20 6 헌법 정의 + 검사관 catalog (안전 7 / 비안전 5)
- spec §11.20.3 F2 단계적 fail-closed 정책 (phase 1 → phase 2 게이트)
- spec §11.20.4 위치 (`tools/inspectors/`) + CI hook (pre-commit + pre-push)
- 구현 = R12-C2 *기반층 sub-task 1 호* (P2 진입 직후, A 보다 먼저)

---

## D5. A (RunStep 영속 기록부) 도입

**결정:**
- 회의 안 모든 turn 의 의도 / 입력 / 출력 / 사이드이펙트 / 분류 결과를 영속 저장하는 *진행 일지* 레이어 도입
- DB: `run_step` 테이블 (P2 migration 020 신규) — id / meeting_id / channel_id / round / turn_index / actor_kind / actor_id / step_kind / input_json / output_json / next_step_card / side_effect_summary / duration_ms / created_at
- 저장 정책: append-only / atomic write / truncate 금지

**왜:**
1. 회의록 = 사람이 읽는 *결정 기록*. RunStep = 시스템이 읽는 *추적 기록*. 두 surface 정보가 다르므로 *공존* — 중복 X.
2. 다른 후보 (B/F/H) 의 *데이터 source*:
   - **B 분류기** = `step_kind='next_step_classify'` row 영속 → 디버깅 / 회의 재현
   - **F 검사관** = `step_kind='inspector_check'` row 영속 → 6 헌법 위반 감사 추적
   - **H 진행률** = 부서별 RunStep count + step_kind 분포 → 합계 산출
3. 회의 turn-by-turn replay 가능 → 회귀 분석 + 디버깅 토대.
4. 옛 SSM `state_snapshot_json` (cross-cutting C1) 은 *상태* 기록, RunStep 은 *행위* 기록 — surface 다름.

**대안:** turn 단위 영속 X (메모리만) — B / F / H 의 데이터 source 부재.

**산출:**
- spec §11.19 A. RunStep 영속 기록부
- 구현 = R12-C2 *기반층 sub-task 2 호* (F 직후 진입, P2 backend 와 함께)

---

## D6. C (큐 운영 시스템) / D (의미 단위 알림) / E (임무 카드) / G (외주 의뢰서) — plan-level acceptance

**결정:**
- 4 후보 (C / D / E / G) 는 spec 신규 §11.x 추가 X — plan 안 sub-task acceptance criteria 로 정의.
- C 큐 운영 시스템 = 정리 #7 §11.12 의 부서 lock + 대기 큐 위에 *현장 배치판* surface (R12-C2 P6 안). E (임무 카드) 가 큐 항목 schema.
- D 의미 단위 알림 = situation cards. R12-C2 안 Notification surface 정식화 (P6 안 검토 → 리뷰 자동 인계 시 등). A RunStep 위에 additive.
- E 임무 카드 = capability manifest. R12-C2 P5 (구현) + P6 (인계) sub-task 안 designated worker 의 *작업 단위* schema.
- G 외주 의뢰서 = 부서 ↔ 부서 인계 시 *정형 schema*. H2 surface (§11.22) 의 backend payload — handoff_dispatch 테이블 row + minutes.md reference.

**왜:**
1. 4 후보는 *surface 신규* 보다 *기존 surface 정형화* 성격 — spec 면적 최소화 + plan 유연성 확보.
2. C / E 는 §11.16 부서 lock + §11.17 변경 요청 + 정리 #7 §11.12 큐 위에 layered.
3. D 는 R10 시점 land 된 NotificationService + notification-labels 위에 layered.
4. G 는 H2 (§11.22) 의 데이터 source 정형화 — 별 spec 섹션 X.
5. plan acceptance 로 정의하면 sub-task 단위 검증 가능 (qa agent 의 PASS/FAIL 판정 입력).

**대안:** 4 후보 모두 spec §11.x 신규 — spec 비대 + plan 사이 정보 중복.

**산출:**
- plan 안 sub-task acceptance — C/D/E/G 항목별
- 구현 acceptance criteria 가 spec 의 §11.16 / §11.17 / §11.22 / 정리 #7 §11.12 reference

---

## D7. R12-C2 Round 1 (T0~T10b) 종결 + main land

**결정:**
- R12-C2 Round 1 (T0~T10b) 19 commit ff merge → main `5472bef`. 옵션안 `6b45778` + CLAUDE.md graphify section `8e6a602` = main 최종 HEAD.
- push 완료 (`e3cdafb..8e6a602`).
- Round 1 worktree (`/mnt/d/Taniar/Documents/Git/Rolestra-r12c2`) + 브랜치 `feat/r12-c2-meeting-redesign` 정리.
- graphify-out / .graphifyignore 는 main 에 보존 (main 의 13:57 데이터가 worktree 02:57 보다 11 시간 더 최신).

**왜:**
1. T0~T10b 자산 (옛 SSM 폐기 / OpinionService / MeetingMinutesService / migration 019 / spec §3 §4 §5 §11.13~§11.18) 은 그 자체로 land 가치 — main 에 *안정 기반* 으로 유지.
2. Round 2 새 worktree = 옛 plan 잔재 없이 깨끗.
3. 사용자 결정 + A3 옵션안 진입 전 *Round 1 종결* 가 다음 phase baseline 명료화.

**대안:** Round 1 main land 안 함 + Round 2 same worktree 진입 — 옛 plan T11~T35 잔재 + 새 R1 분해 *섞임*. 회귀 분리 어려움.

**산출:**
- main `8e6a602` 까지 land + push 완료
- Round 2 새 worktree `/mnt/d/Taniar/Documents/Git/Rolestra-r12c2-r2` (브랜치 `feat/r12-c2-redesign-r2`, base `8e6a602`)
- 본 ADR + spec §11.18.8 + §11.19~§11.22 + plan 통째 재작성 = Round 2 진입의 *입력*

---

## D8. 진입 우선순위 (Round 2 sub-task 순서)

**결정:**

```
1. F (즉시 시작) — 검사관 catalog
   다른 후보의 평가 기준 + R12-C2 Round 1 정리와 병행 안전.
   안전 경계 7 카테고리 phase 1 (report-only) 부터 land.

2. A (T10c closeout 흡수 직후) — RunStep 영속 기록부
   B/F/H 의 데이터 source. P2 backend 와 함께 land.
   migration 020 (run_step 테이블).

3. B + E + G (R12-C2 부서 회의 흐름 sub-task 와 함께)
   B = NextStep 분류기 (P2 안)
   E = 임무 카드 (P5 안 designated worker schema)
   G = 외주 의뢰서 (P6 안 handoff_dispatch payload)

4. H (D-B 흐름 P5~P8 안에서 인계 정리 + 진행률)
   H1 = P7 dashboard layout 통합
   H2 = P6 HandoffApprovalModal + 받는 부서 첫 surface

5. C (회의 ↔ 큐 연결 정책 합의 후) — 큐 운영 시스템
   §11.16 부서 lock + 정리 #7 §11.12 큐 위에 layered.
   P6 안 land.

6. D (A 위에 additive) — 의미 단위 알림
   A RunStep 위에 NotificationService 확장.
   P6 안 land (검토 → 리뷰 자동 인계 Notification + 큐 진입 알림 등).
```

**왜:**
1. F 가 가장 먼저 → 다른 후보의 코드 품질 *검출 가능* + phase 1 report-only 라 land 부담 작음 + R12-C2 Round 1 정리 작업과 병행 안전 (코드 변경 없는 룰 추가).
2. A 가 두 번째 → B/F/H 의 데이터 source 미리 깔림. P2 backend (OpinionService + MeetingOrchestrator 새 모델) 와 함께 land 시 자연.
3. B/E/G 묶음 → 부서 회의 흐름 sub-task 안에서 자연 흡수.
4. H 마지막 → A 데이터 source 영속 후 합계 산출 가능 + B 「인계」 카드 분류 후 H2 surface 가 이어짐.

**대안:** A 먼저 → B/F/H 데이터 source 깔리지만 *F 가 다른 후보의 평가 기준* 라 F 가 더 우선.

**산출:**
- plan 안 sub-task 순서 (P2 → P3 → P4 → P5 → P6 → P7 → P8) + 각 phase 안 후보별 sub-task 분해
- *기반층 sub-task 1 호* = F (R12-C2 P2 진입 직후)
- *기반층 sub-task 2 호* = A (F 직후, P2 backend 와 함께)

---

## graphify 그래프 활용 근거

- Hyperedge "Four runtime-stability pillars" = A + B + E + F (1:1 일치) → R12-C2 의 *기반 4 축*
- Hyperedge "Three reference projects → three runtime layers" = Symphony=운영 / oa-py=실행 / alex-core=invariant → 후보 분류 근거
- God nodes (invoke 66 / SSM 49 / SessionStateMachine 48) = R1 plan 의 *기반 sub-task* 가 가장 많이 건드릴 추상화

R1 plan sub-task 분할 시 위 hyperedge / god nodes 를 *단서* 로 활용.

---

## 검증 게이트

본 ADR + spec 갱신 land 후:
- typecheck 0 error (spec/ADR 만 수정 — 코드 변경 0)
- vitest baseline 유지 (3230 PASS / 13 skip — Round 1 T10b 시점)
- plan 통째 재작성 + tasks.json sync 후 *기반층 sub-task 1 호 (F)* 진입

---

## 핵심 참조

- spec: `docs/specs/2026-05-01-rolestra-channel-roles-design.md` §11.18.8 + §11.19 + §11.20 + §11.21 + §11.22
- plan: `docs/plans/2026-05-04-rolestra-phase-r12-c2.md` (통째 재작성 — 본 ADR D1 결정 따라)
- 옵션안 (Round 2 진입 입력): `docs/reports/analysis/2026-05-05-참고프로젝트-반영-옵션안.md`
- Round 1 ADR: `docs/decisions/r12-c-channel-roles.md` (R12-C 1차 종결)
- 메모리 (Round 2 진입 가이드): `rolestra-r12-c2-reference-projects-a3.md`

---

## 관련 ADR

- `cross-cutting.md` C1 (ConsensusStateMachine) — Round 1 T10b 시점 옛 SSM 12 단계 통째 폐기. Round 2 의 새 회의 모델 (의견 트리 + 일괄 투표 + 자유 토론) 이 C1 의 *재정의* — Round 2 종결 시 cross-cutting 섹션 갱신.
- `cross-cutting.md` C8 (예약 — A RunStep) / C9 (예약 — F 검사관) — R12-C2 종결 시 cross-cutting 정식화 위치.
- `r12-c-channel-roles.md` D9 — Round 1 분할 결정. 본 ADR 의 *전제*.

---

## 미결 항목 (Round 2 진입 후 결정)

- C (큐 운영 시스템) 의 surface 위치 — 사이드바 row 통합 vs 전용 패널 (P6 진입 시 short design round)
- D (의미 단위 알림) 의 카테고리 분류 — 회의 / 인계 / 큐 / 검토 결과 4 종 (P6 진입 시 결정)
- F2 phase 1 → phase 2 전환 게이트 — *모든 안전 경계 룰 false positive 0 건* 의 측정 기간 (1 주 / 2 주 / 사용자 dogfooding 라운드 통과 시 등)
- 외부 수정 감지 (인계 직전 mtime 가드) — R12-H 보류 그대로
