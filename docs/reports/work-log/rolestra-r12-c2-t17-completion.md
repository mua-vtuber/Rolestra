---
name: R12-C2 T17 종결 — review-workflow + audit-workflow types + helper + 'audit' RoleId 정식 추가 (2026-05-06)
description: R12-C2 Round 2 P3 진입 6 호 완료. workflow 2 신규 + audit RoleId 카탈로그 prerequisite. orchestrator wire (T25 NG → 기획 인계 / T30 Notification) 는 미래. 다음 T18 (SsmBox 5 variant) 진입 가이드.
type: project
originSessionId: f7c3c472-906c-4d2a-9cdf-627ff01402e1
---
# R12-C2 T17 종결 (2026-05-06)

worktree `feat/r12-c2-redesign-r2`, base `e7eeb09` (= T16 work-log mirror, T16c production `e1e27f0` 위). 14 파일 / +925 -35 lines (production +500, test +320, ui +30, types/카탈로그 +50, tasks.json +1, 도큐 ~25).

production commit `0101667`.

**Why:** spec §3 line 76+77+88 / §4 line 144+145 / §11.12.1 line 955+957+959 / §11.16 / §11.18.6 / §11.22.4+.6 — 풀세트 5+2.5 phase loop (planning / design / review / audit 공유 backend) 위에 review (chain 외 + 두 entry) / audit (chain 끝 + OK/NG verdict) 의 *handoff routing 분기 helper* 만 다른 패턴. 본 sub-task = P3 backend 본체 마지막 1 호 (T15 = idea, T16 = design, T17 = review/audit). T15/T16 패턴 재활용 (thin extension + 순수 helper). orchestrator wire (audit handoff 시 review 채널 자동 소집 / NG → 기획 인계 dispatch) 는 T25 (NG → 기획 인계) / T30 (Notification) 책임 — 본 sub-task 는 *types + 순수 helper* 만 land.

**How to apply:** 새 세션 진입 시 T18 (P3-5 SsmBox 부서별 5 variant 통합) 진입. T17 의 `classifyAuditVerdict` / `extractAuditProblemList` / `buildAuditHandoffPayload` 는 T25 가 import 만 하면 됨 — verdict 결정 로직은 모두 결정적이라 caller 가 opinion 집합만 정확히 넘기면 결과 일관. T16/T15/T14 의 patterns + T13 NextStep classifier + T12 RunStep 영속과 결합해 P4 진입 가능.

## 산출 4 신규

### 1. `src/main/meetings/workflows/review-workflow.ts`

리뷰 부서 (chain 외) workflow 의 *types + 순수 helper* — design-workflow.ts (T16a) 와 같은 thin extension 설계.

- `ReviewEntryKind` union — `'user_explicit'` (사용자 명시 호출) / `'audit_handoff_checkbox'` (audit 결재 모달 체크박스 또는 auto Notification).
- `ReviewHandoffPackage` — case (b) 인계 패키지 형식. spec §11.22.4 카논 = *minutes.md 본문 통째* + metadata. 6 필드 (sourceAuditMeetingId / sourceAuditChannelId / targetReviewChannelId / auditMinutesMarkdown / generatedAt / trigger).
- `ReviewHandoffTrigger` union — `'user_checkbox'` / `'auto_notification'` (audit trail + Notification 메시지 분기).
- `buildReviewHandoffPackageFromAudit(input)` — 순수 builder. 빈 회의록 (whitespace-only 포함) / NaN epoch / 음수 epoch 시 `ReviewHandoffPackageInvariantError` throw. caller (T25 wire) 가 catch 후 회의 abort.
- `shouldSpawnReviewFromAudit({ auditChannelHandoffMode, reviewCheckboxChecked })` — 진리표 helper. `'auto'` → 항상 spawn (trigger='auto_notification', 체크박스 무시) / `'check'` + 체크박스 → spawn (trigger='user_checkbox') / 그 외 → no-spawn. spec §11.16 카논.
- `isReviewDepartmentRole(role)` — design 의 isDesignDepartmentRole 패턴 그대로.

### 2. `src/main/meetings/workflows/audit-workflow.ts`

검토 부서 (chain 끝 강제) workflow 의 *types + 순수 helper* — verdict 분류 + NG 인계 payload builder.

- `AuditVerdict` union — `'ok'` (agreed root 0 = 문제 없음) / `'ng'` (agreed root ≥ 1 = 문제 발견).
- `AuditVerdictOpinionView` — `classifyAuditVerdict` 의 입력 contract (kind / status 만, Opinion 의 structural subset).
- `classifyAuditVerdict(opinions)` — 결정적 분류. for-loop 한 번 — `kind === 'root' && status === 'agreed'` 가 1 건이라도 있으면 'ng'. 자식 의견 (revise/block/addition) status='agreed' 는 root 의 합의 처리에 흡수되므로 verdict 에 직접 영향 X (root 만 본다). self-raised / user-raised 는 audit 회의에서 발생 X invariant — silent ignore (kind !== 'root' 라 자연 제외).
- `AuditProblem` interface — agreed root opinion 1 건 view (opinionId / title / content / rationale / authorLabel). NULL 필드는 빈 문자열로 normalize (받는 부서 prompt 에서 NULL 분기 회피).
- `extractAuditProblemList(opinions)` — agreed root 만 추출 + AuditProblem[] 변환. NULL → 빈 문자열 normalize.
- `AuditHandoffPayload` interface — NG case 인계 패키지. minutes.md 본문 통째 + problemList + metadata 7 필드.
- `buildAuditHandoffPayload({ verdict, ... })` — `'ok'` → null (chain 종료 + 사용자 승인 게이트만) / `'ng'` → AuditHandoffPayload. NG 인데 problemList 비어있음 / 빈 markdown / NaN/음수 epoch → `AuditHandoffPayloadInvariantError` throw.
- `AUDIT_NG_TARGET_ROLE = 'planning'` 상수 — spec line 77 카논 단일 진실 원천 (NG 대상 부서 정책 변경 시 본 상수만 수정).
- `isAuditDepartmentRole(role)`.

### 3. `src/main/meetings/workflows/__tests__/review-workflow.test.ts`

13 테스트:
- shouldSpawnReviewFromAudit 진리표 (3 case — auto / check×true / check×false. auto 에서 체크박스 값 무시 회귀 가드 1 추가)
- buildReviewHandoffPackageFromAudit (6 case — 정상 build / trigger 보존 / 빈 markdown / whitespace-only / NaN epoch / 음수 epoch)
- isReviewDepartmentRole role guard (2 case — 'review' true / 6 다른 role + null false)

### 4. `src/main/meetings/workflows/__tests__/audit-workflow.test.ts`

17 테스트:
- classifyAuditVerdict (6 case — 빈 list / agreed root 1 / agreed root 다수 / 자식 의견만 agreed / root 모두 rejected/excluded/pending / self-raised+user-raised silent ignore)
- extractAuditProblemList (3 case — agreed root 만 / NULL normalize / authorLabel 보존)
- buildAuditHandoffPayload (7 case — 'ok' null / 'ok' with empty problemList still null / 'ng' payload shape / 4 invariant violation throw)
- AUDIT_NG_TARGET_ROLE === 'planning' (1)
- isAuditDepartmentRole role guard (2 case — 'audit' true / 5 다른 role + null false)

## 의존 갱신 — 'audit' RoleId 정식 추가 (T17 prerequisite)

R12-C2 spec §3 line 87+88 가 옛 단일 'review' 를 분리 명시 (`review` = 주관 평가 / `audit` = 객관 + 목적 통합) 했으나 *카탈로그 코드 갱신이 누락된 갭*. T17 의 `audit-workflow.ts` 가 `role === 'audit'` 비교 못 하면 typecheck 실패 → 본 sub-task 가 함께 land.

### 5. `src/shared/role-types.ts`

- `RoleId` union 9 → 10 종 — `'audit'` 신규.
- `ALL_ROLE_IDS` array 'review' 와 'general' 사이에 'audit' 삽입 (spec §3 line 87 순서 정합).

### 6. `src/shared/skill-catalog.ts`

- `review` SkillTemplate 의미 재정의 — 옛 PASS/FAIL + 위반 항목 시맨틱이 audit 으로 이전. 새 review = 주관 평가 / 개선 제안 / ergonomics. label 한글 '검토' → '리뷰'. tool grants = file.read + db.read + web.search ON / command.exec + file.write OFF. systemPromptKo 통째 재작성 (spec line 76 + 144 카논 — 결과물 인상 / 누락 시나리오 / 더 나은 안 / 사용자 ergonomics, chain 외 인계 X 명시).
- `audit` SkillTemplate 신규 — 객관 + 목적 통합. label 한글 '검토' (옛 review 한글 라벨 그대로 보존, 시맨틱은 audit 의 본질). tool grants = file.read + db.read + command.exec ON / file.write + web.search OFF. systemPromptKo 새 작성 (spec line 77 + 145 카논 — lint/typecheck/test PASS, 하드코딩/메모리누수/보안/스파게티/spec 의도 부합 검증, 회의록 [합의]=문제 / [제외]=수용 가능 분류, OK → 사용자 승인 게이트 + 종료, NG → 기획 자동 인계, 한 의견 = 한 문제 단위).

## UI 의존 갱신

### 7. `src/renderer/features/onboarding/steps/Step3RoleAssignment.tsx`

- `ROLE_ICON` 매트릭스 갱신 — review '✅' → '📝', audit '🔍' 신규.
- 도큐 주석 9 능력 → 10 능력 + 'audit' 분리 사유.

### 8. `src/renderer/features/sidebar/ProjectAccordion.tsx`

- 동일 ROLE_ICON 갱신.
- `DEPARTMENT_ROLE_ORDER` 끝 'review' 뒤에 'audit' 추가 (spec line 218 채널 list 순서).

### 9. `src/renderer/features/onboarding/OnboardingPage.tsx`

- 도큐 주석 9 능력 → 10 능력 (R12-C2 P3 T17 명시).

## 테스트 데이터 갱신 — 9 → 10 능력 의존

### 10. `src/renderer/features/onboarding/__tests__/OnboardingPage.test.tsx`

- `SKILLS_TO_TOGGLE_FOR_CLAUDE` 에 `'audit'` 추가 — step 3 → 4 진행 조건 (10 능력 ≥ 1명) 충족.
- 도큐 주석 9 → 10 + 'audit' 분리 명시.

### 11. `src/main/skills/__tests__/project-skill-sync-service.test.ts`

- "writes 18 SKILL.md (9 roles × 2 roots)" → "writes 20 SKILL.md (10 roles × 2 roots)" + assert 18 → 20.
- "lays out 9 directories" → "lays out 10" + array 정렬 안 'audit' 첫 entry (alphabetical).
- "reports all 18 entries unchanged" → "reports all 20".

### 12. `src/main/skills/__tests__/skill-service.test.ts`

옛 'review skill grants command.exec but not file.write' 1 테스트를 2 로 분기:
- review (재정의) — web.search ON + file.read ON / command.exec OFF + file.write OFF.
- audit (신규) — command.exec ON + file.read ON / file.write OFF + web.search OFF.

### 13. `src/main/ipc/handlers/__tests__/skill-handler.test.ts`

- "skill:list returns 9 employee roles" → "10 employee roles" + assert 9 → 10.

## tasks.json

T17 status: pending → completed.

## 검증

- typecheck:node **0** / typecheck:web **0**
- vitest **3432 PASS / 13 skip / 0 FAIL** (T16c 베이스라인 3400 + 32 신규: review-workflow 13 + audit-workflow 17 + skill-service audit row 1 + onboarding test data 갱신 1)
- inspect:safety **95** hits — T16c 베이스라인 동일 (T17 위반 0 — 신규 코드 모두 순수 helper, child_process / migration / approval 표면 무관). buildShouldFail=False 보존.
- 4 workflow 테스트 파일 / 61 테스트 PASS (T16c idea 12 + design 14 + 본 sub-task review 13 + audit 17 + 5 base 통합).

## 핵심 결정

- **review/audit 의 본질 = handoff routing 분기 helper** — 풀세트 5+2.5 phase loop 자체는 planning/design (T16) 과 동일 backend 재사용. 별도 phase loop 정의 X. orchestrator dispatch 분기는 채널 role 기준 한 줄 추가 (T25 wire 시).
- **audit verdict 결정성** — agreed root opinion 수만 본다. 회의록 markdown / fallback 여부 / 모더레이터 응답 / turn 수 모두 무관. caller (T25) 가 opinion 집합만 정확히 넘기면 결과 일관. 자식 의견 (revise/block/addition) 의 agreed 는 root 의 합의 처리에 흡수되므로 verdict 직접 영향 X (root 만 필터).
- **audit/review 한글 라벨 보존** — 옛 review SkillTemplate 의 한글 '검토' 라벨이 실제로 audit 시맨틱에 부합. R12-C2 분리 후 새 review = '리뷰' (영문 Review 그대로) / audit = '검토' (옛 한글 라벨 그대로). 도메인 라벨 정합성 유지.
- **AUDIT_NG_TARGET_ROLE 단일 진실 원천 상수** — spec line 77 ("NG → 항상 기획") 정책을 한 곳에 잠금. T25 / 향후 audit 인계 정책 변경 시 본 상수만 수정.
- **순수 helper 만 land — orchestrator wire = T25/T30** — design-workflow T16a/b/c 처럼 split 단계 분리 가능하지만 review/audit 은 phase loop 자체가 풀세트와 동일이라 본 sub-task 안 한 commit 으로 충분. orchestrator wire 가 본 helper 위에 얇게 얹는 라우팅만 추가.
- **'audit' RoleId 카탈로그 prerequisite 함께 land** — plan T17 명시 산출물은 workflow 2 파일이지만 코드 컴파일 자체가 'audit' role 의존. plan 갭. spec §3 line 87 정합 갱신.

## 다음 진입

**T18 (P3-5 SsmBox 부서별 5 variant 통합)** — 의존 = T15 + T16 + T17 land 후 (이제 모두 충족).

핵심 산출:
- `src/renderer/features/messenger/SsmBox/index.tsx` — channelId props 하나만 받고 channel.role 보고 variant 결정
- 5 variant 파일 분리 (idea / planning / design / implement / general). review/audit 는 planning variant 재사용 (spec §11.13 line 881 카논 — `planning / review / audit` 동일 variant).
- spec reference: §11.13

`audit` 의 신규 SkillTemplate / DEPARTMENT_ROLE_ORDER 갱신은 T18 가 직접 의존 X — UI variant 만 추가.

## reference

- spec: `docs/specs/2026-05-01-rolestra-channel-roles-design.md`
  - §3 line 76+77+88 부서 카탈로그 (review/audit 분리 + 옛 verify 흡수)
  - §4 line 144+145 부서별 매트릭스 (review chain 외 + audit chain 끝)
  - §11.12.1 line 955+957+959 lock 모델 (review = 회의록 작성 직후 / audit NG = 인계 시점)
  - §11.16 handoff_mode (check / auto)
  - §11.18.6 minutes.md 양식
  - §11.22.4 인계 패키지 = minutes.md 본문 통째 + metadata
  - §11.22.6 review 의 H2 surface (두 entry 별)
- plan: `docs/plans/2026-05-04-rolestra-phase-r12-c2.md` line 343-352 T17 정의
- 의존 reference: `rolestra-r12-c2-t16c-completion.md` (T16 직전 완료) / `rolestra-r12-c2-t15-completion.md` (T15 idea-workflow 패턴)
