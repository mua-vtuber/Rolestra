/**
 * MissionCard schema — R12-C2 P5 T23 land. spec docs/R12_c2_2R/plans/2026-05-04-rolestra-phase-r12-c2.md
 * line 418-431 (E. 임무 카드 schema) + line 475 (handoff_dispatch.mission_card_json
 * persistence target).
 *
 * 사무실 메타포: 부서가 다른 부서로 보내는 *임무 카드* — 작업 1 건 = 카드 1 장.
 * 받는 부서 (현재는 implement / planning 만) 가 카드를 펼쳐 designated worker 1 명에게
 * 작업을 분배. 카드 자체는 capability manifest — 누가 만들 수 있는 작업인지, 본문은
 * 무엇인지, 입력 / 출력 기대치는 무엇인지를 정형화한다.
 *
 * 본 sub-task (T23) 의 스코프:
 *
 *   1. {@link MissionCardKind} discriminated union 정의 — 'spec' / 'fix' /
 *      'change-request' 3 종.
 *   2. {@link MissionCardPayload} 종별 payload 형식 (zod discriminatedUnion).
 *   3. {@link MissionCard} 본체 — id + payload + assignedProviderId +
 *      targetChannelId + createdAt.
 *   4. {@link buildMissionCard} 빌더 + zod 검증 + invariant throw.
 *   5. {@link parseMissionCardJson} / {@link serializeMissionCard} —
 *      handoff_dispatch.mission_card_json 영속 boundary.
 *   6. {@link MissionCardInvariantError} — caller (T24 implement-workflow / T27
 *      handoff-service) 가 catch 후 회의 abort + 사용자 노출 에러 분기.
 *
 * 본 모듈은 순수 함수 + 타입만 land — IO / DB / IPC 의존 X. T24
 * implement-workflow 가 본 schema 받아 designated worker 1 명에게 prompt 합성 +
 * ExecutionService 호출. T27 handoff-service 가 본 schema JSON 직렬화해
 * handoff_dispatch row 의 mission_card_json 컬럼에 영속.
 *
 * Mission card kind 분기 근거:
 *
 *   - `'spec'` — 기획 부서 회의 종결 시 root agreed opinion + planning minutes
 *     를 묶어 implement 부서에 송출 (정상 chain). 의견 본문은 payload.body 에
 *     축약 (root opinion content), 원본 회의록은 planningMinutesMarkdown 에 통째.
 *
 *   - `'fix'` — audit 부서 NG verdict 시 발견된 문제 list 를 묶어 planning 부서에
 *     재인계 (chain 재진입). audit-workflow.ts 의 AuditHandoffPayload 와 1:1 매핑 —
 *     T25 (audit NG → 기획 인계) 가 AuditHandoffPayload → MissionCard 변환 본
 *     수행.
 *
 *   - `'change-request'` — 사용자가 직접 작성한 변경 요청 (회의 외 진입). spec
 *     §11.18.7 변경 요청 형식 — 사용자 free-form 메시지 + 대상 channel + body
 *     해석은 받는 부서 회의 시 designated worker 가 수행.
 */

import { z } from 'zod';

// ── kind ────────────────────────────────────────────────────────────

/**
 * 임무 카드 종류 discriminator.
 *
 * - `'spec'`            기획 → 구현 정상 chain (의견 + 기획서)
 * - `'fix'`             audit NG → 기획 재인계 (문제 list + audit 회의록)
 * - `'change-request'`  사용자 발화 변경 요청 (회의 외 직접 진입)
 */
export type MissionCardKind = 'spec' | 'fix' | 'change-request';

/** {@link MissionCardKind} 의 readonly array — UI chip / 검증 enum. */
export const ALL_MISSION_CARD_KINDS: readonly MissionCardKind[] = [
  'spec',
  'fix',
  'change-request',
] as const;

// ── 공통 payload base ───────────────────────────────────────────────

/**
 * 모든 종 mission card payload 가 공유하는 *작업 1 건* 의 최소 정보:
 *
 *   - `body`            받는 부서 designated worker 가 보고 작업 시작할 본문.
 *                       종별로 다르게 합성: 'spec' = root opinion content,
 *                       'fix' = audit problem list 요약, 'change-request' =
 *                       사용자 메시지 그대로. 빈 문자열 거부 (invariant).
 *
 *   - `inputFiles`      designated worker 가 *읽어야* 할 파일 path list.
 *                       ArenaRoot 또는 프로젝트 루트 기준 상대 경로.
 *                       빈 배열 허용 (특정 파일 의존 X 작업 가능 — 예: scratch
 *                       구현). path-guard 검증은 받는 측 (ExecutionService)
 *                       책임 — 본 schema 는 *경로 list 형식* 만 검증.
 *
 *   - `expectedOutputs` designated worker 가 *생성해야* 할 산출물 형식 표현.
 *                       자유 텍스트 list (예: "src/foo.ts new file" / "test
 *                       coverage ≥ 80%"). 빈 배열 허용 (자율 산출 위임).
 *
 * 본 base 는 zod 안 z.object().extend() 패턴으로 종별 payload 가 상속 — kind
 * literal 추가 + 종별 metadata 만 추가하는 thin extension.
 */
const baseMissionPayloadShape = {
  body: z.string().min(1, 'mission body must not be empty'),
  inputFiles: z.array(z.string().min(1)).readonly(),
  expectedOutputs: z.array(z.string().min(1)).readonly(),
} as const;

// ── 종별 payload schema ─────────────────────────────────────────────

/**
 * `'spec'` payload — 기획 → 구현 정상 chain. spec §5.2 / §11.18.6 minutes.md
 * 본문 통째 + root opinion id reference.
 */
const specMissionPayloadSchema = z
  .object({
    kind: z.literal('spec'),
    ...baseMissionPayloadShape,
    /**
     * planning 회의에서 합의된 root opinion id (UUID). T24 implement-workflow
     * 가 OpinionService 로 본 row 조회 + revise / addition 자식 의견 추출 시
     * reference.
     */
    rootOpinionId: z.string().min(1),
    /**
     * planning 회의록 markdown 본문 (§11.18.6 minutes.md 통째, truncate 금지).
     * implement 부서 designated worker prompt 가 본 markdown 을 컨텍스트로
     * prepend.
     */
    planningMinutesMarkdown: z
      .string()
      .min(1, 'planning minutes markdown must not be empty'),
  })
  .strict();

/**
 * `'fix'` payload — audit NG → planning 재인계. AuditHandoffPayload (T17 land)
 * 와 1:1 매핑.
 */
const fixMissionPayloadSchema = z
  .object({
    kind: z.literal('fix'),
    ...baseMissionPayloadShape,
    /**
     * audit 회의록 markdown 본문 (§11.18.6 minutes.md 통째). audit verdict='ng'
     * 시 NG 판정 근거 포함. planning 부서 designated worker prompt 컨텍스트.
     */
    auditMinutesMarkdown: z
      .string()
      .min(1, 'audit minutes markdown must not be empty'),
    /**
     * audit 회의에서 발견된 문제 list — `extractAuditProblemList` 결과 .
     * planning 부서가 본 list 를 *처리 작업 list* 로 분배 (회의 첫 turn
     * gather phase 에서 사용).
     */
    problemList: z
      .array(
        z
          .object({
            opinionId: z.string().min(1),
            title: z.string(),
            content: z.string(),
          })
          .strict(),
      )
      .min(1, 'fix mission card requires at least 1 problem')
      .readonly(),
  })
  .strict();

/**
 * `'change-request'` payload — 사용자 free-form 변경 요청. 회의 외 직접 진입.
 * spec §11.18.7 변경 요청 형식 — 사용자가 채팅창에서 작성한 메시지 본문이
 * 그대로 들어간다 (system 가 prompt 합성 X).
 */
const changeRequestMissionPayloadSchema = z
  .object({
    kind: z.literal('change-request'),
    ...baseMissionPayloadShape,
    /**
     * 사용자가 입력한 변경 요청 본문 — 자유 텍스트. 받는 부서 designated
     * worker 가 자체 해석 (system 합성 prompt 안 user_message 자리).
     */
    userMessage: z
      .string()
      .min(1, 'change-request user message must not be empty'),
  })
  .strict();

/**
 * MissionCardPayload zod discriminated union — 종별 payload 합집합. T24
 * implement-workflow / T25 audit→planning / T27 handoff-service 가 본 schema
 * 로 parse / build.
 */
export const missionCardPayloadSchema = z.discriminatedUnion('kind', [
  specMissionPayloadSchema,
  fixMissionPayloadSchema,
  changeRequestMissionPayloadSchema,
]);

/** {@link missionCardPayloadSchema} 의 inferred type. */
export type MissionCardPayload = z.infer<typeof missionCardPayloadSchema>;

/** `'spec'` payload 의 inferred type — 종별 narrowing 시 활용. */
export type SpecMissionPayload = z.infer<typeof specMissionPayloadSchema>;

/** `'fix'` payload 의 inferred type. */
export type FixMissionPayload = z.infer<typeof fixMissionPayloadSchema>;

/** `'change-request'` payload 의 inferred type. */
export type ChangeRequestMissionPayload = z.infer<
  typeof changeRequestMissionPayloadSchema
>;

// ── 카드 본체 schema ────────────────────────────────────────────────

/**
 * MissionCard 본체 schema — payload 외에 *어디서 어디로 누가 처리* metadata
 * 포함.
 *
 *   - `id`                   카드 식별 UUID — handoff_dispatch row 와 별개로
 *                            카드 자체의 로컬 식별자. 동일 회의에서 여러 카드
 *                            발행 시 (예: planning 가 multi-feature 한 번에
 *                            정리) 각 카드 1 UUID.
 *
 *   - `assignedProviderId`   designated worker = 받는 부서 1 명. resolver 결과
 *                            (designated-worker-resolver.ts).
 *
 *   - `targetChannelId`      받는 부서 채널 id. handoff_dispatch.to_channel_id
 *                            와 동일.
 *
 *   - `createdAt`            Unix epoch ms. handoff_dispatch.dispatched_at 자리.
 */
export const missionCardSchema = z
  .object({
    id: z.uuid('mission card id must be a UUID'),
    payload: missionCardPayloadSchema,
    assignedProviderId: z.string().min(1),
    targetChannelId: z.string().min(1),
    createdAt: z
      .number()
      .int()
      .min(0, 'createdAt must be a non-negative epoch ms'),
  })
  .strict();

/** {@link missionCardSchema} 의 inferred type. */
export type MissionCard = z.infer<typeof missionCardSchema>;

// ── invariant error ─────────────────────────────────────────────────

/**
 * MissionCard schema 위반 / build / parse 실패 시 throw. T24 implement-workflow
 * / T27 handoff-service 가 catch 후 회의 abort + 사용자 알림.
 *
 * `cause` 필드는 zod {@link z.ZodError} 보존 — UI 디버그 / 원격 진단 시
 * 회복 가능한 형태로 노출.
 */
export class MissionCardInvariantError extends Error {
  readonly cause?: z.ZodError;

  constructor(message: string, cause?: z.ZodError) {
    super(`[MissionCard] ${message}`);
    this.name = 'MissionCardInvariantError';
    this.cause = cause;
  }
}

// ── builder + parser ────────────────────────────────────────────────

/**
 * MissionCard builder + zod 검증. 입력 객체가 schema 와 일치하면 검증된 카드를
 * 반환, 아니면 {@link MissionCardInvariantError} throw.
 *
 * caller 책임:
 *   - `id` 는 caller 가 생성 (예: `crypto.randomUUID()`). 본 함수는 형식만
 *     검증.
 *   - `createdAt` 은 caller 가 결정 (보통 `Date.now()`). 본 함수는 음수 / NaN
 *     거부.
 *   - `payload` 종별 metadata (예: 'spec' rootOpinionId / 'fix' problemList)
 *     누락 시 zod 가 거부.
 */
export function buildMissionCard(input: MissionCard): MissionCard {
  const result = missionCardSchema.safeParse(input);
  if (!result.success) {
    throw new MissionCardInvariantError(
      'invalid mission card input — see cause for details',
      result.error,
    );
  }
  return result.data;
}

/**
 * mission_card_json 컬럼 (handoff_dispatch.mission_card_json) 또는 IPC payload
 * 에서 받은 raw JSON 문자열 → MissionCard. JSON 파싱 실패 / schema 불일치 시
 * {@link MissionCardInvariantError} throw.
 *
 * 본 함수는 *경계 (boundary) parser* — DB / IPC / 파일 등 외부에서 들어오는
 * raw 문자열 1 회 검증 후 내부에서는 검증된 {@link MissionCard} 만 통용.
 */
export function parseMissionCardJson(raw: string): MissionCard {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new MissionCardInvariantError(
      `mission card JSON parse failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  const result = missionCardSchema.safeParse(parsed);
  if (!result.success) {
    throw new MissionCardInvariantError(
      'parsed JSON did not match MissionCard schema — see cause for details',
      result.error,
    );
  }
  return result.data;
}

/**
 * MissionCard → JSON 문자열. handoff_dispatch.mission_card_json 영속 시 caller
 * 가 본 결과를 그대로 컬럼에 INSERT.
 *
 * 본 함수는 검증 X — 입력이 이미 {@link buildMissionCard} 또는
 * {@link parseMissionCardJson} 통과한 검증된 카드라고 가정.
 */
export function serializeMissionCard(card: MissionCard): string {
  return JSON.stringify(card);
}
