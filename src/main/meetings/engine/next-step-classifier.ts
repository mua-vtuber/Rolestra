/**
 * NextStep classifier — R12-C2 P2 T13 신규.
 *
 * spec §11.18.8 B1 NextStep 카드 분류기. 발화 직후 *직원 응답 본문* +
 * *회의 상태 컨텍스트* 를 받아 7 카드 중 하나로 매핑한다. 카드는 *그 발언
 * 후 한 턴 동안의 다음 동작* 만 통제 — 회의 라이프사이클 / 자율 모드 /
 * handoff_mode 와는 다른 레이어 (§11.18.8e 4 레이어 정리 참조).
 *
 * 본 sub-task (T13) 의 분류기는 *signal layer* — 결과를 RunStep 에 영속하고
 * stream:next-step-classified 로 renderer 에 통지만 한다. 결과 전파군 카드의
 * 모달 등장 / 회의 자동 종결 등 *behavior change* 는 T28+ (HandoffApprovalModal
 * + 회의 lock 풀림 wire) 가 책임진다.
 *
 * spec docs/superpowers/specs/2026-05-01-rolestra-channel-roles-design.md
 *  §11.18.8a  카드 7 종 + 안전군 / 결과 전파군
 *  §11.18.8b  분류 규칙 7 우선순위 (rule 1 ~ 7)
 *  §11.18.8c  handoff_mode 우회 룰 (받는 부서 정책)
 *  §11.18.8d  maxRounds cap 인터락 ('continue' → 'end' override)
 *
 * 입력 책임 (caller = MeetingOrchestrator):
 *   - phase / response / context 모두 *현재 회의 시점* 의 사실값. classifier 는
 *     도메인 서비스 호출 X — 순수 함수.
 *   - silent fallback 금지: caller 가 잘못된 phase ↔ response 조합을 넘기면
 *     `NextStepClassifierInputError` throw (예: phase='gather' 인데 response 가
 *     Step3FreeDiscussionSchemaType).
 *
 * 본 모듈은 *순수 함수만* — 외부 IO / 로깅 / 영속 X. 단위 테스트로 7 카드 결정
 * + cap interlock + 우선순위 fall-through 통째 검증 (run-step / stream wire 는
 * orchestrator 통합 테스트가 책임).
 */

import type {
  MeetingPhase,
  Step1OpinionGatherSchemaType,
  Step25QuickVoteSchemaType,
  Step3FreeDiscussionSchemaType,
} from '../../../shared/meeting-flow-types';
import type { NextStepCard } from '../../../shared/run-step-types';

// ── 입력 타입 ──────────────────────────────────────────────────────────

/**
 * 분류 시점의 회의 상태. caller (orchestrator) 가 직접 측정해 채워 넘긴다.
 *
 * `currentRound` / `maxRounds` 는 자유 토론의 *현재 의견* 단위 카운터.
 * `maxRounds = Infinity` 는 채널 max_rounds = NULL (무제한) 를 표현.
 */
export interface NextStepClassifierContext {
  /**
   * 모든 의견 status가 `'agreed'` / `'rejected'` / `'excluded'` 중 하나
   * (즉 `'pending'` 인 의견 0 건). spec §11.18.8b 룰 4.
   */
  allOpinionsResolved: boolean;
  /**
   * 의견 트리 어딘가에 `depth = OPINION_DEPTH_CAP - 1` 도달한 노드 존재.
   * spec §11.18.8b 룰 1 의 부정 조건 (additions 있어도 cap 도달이면 'continue' X).
   *
   * 본 컨텍스트는 *전체 트리* 기준 — 특정 의견이 cap 인지 여부와는 다름. caller 가
   * `collectDepthCapReached(tree).length > 0` 로 산출.
   */
  depthCapReached: boolean;
  /**
   * 자유 토론 phase 안 *현재 의견* 의 라운드 카운터. `free_discussion` phase 외
   * 에서는 0. spec §11.18.8d cap interlock 의 비교 기준.
   */
  currentRound: number;
  /**
   * `channels.max_rounds` 해석값. NULL → `Infinity`. spec §11.18.8d cap interlock.
   */
  maxRounds: number;
  /**
   * 이 회의 결과를 인계받을 부서 채널 chain 이 정의됨 (spec §11.16~§11.22).
   * T13 시점에는 chain 정의 surface 자체가 미land — caller 가 항상 `false`
   * 를 넘긴다 (T28+ HandoffApprovalModal land 시 채널 chain DB 컬럼 참조).
   */
  hasNextChain: boolean;
  /**
   * 본 분류 호출이 *모더레이터의 minutes.md 작성 직후* 에 발생함을 caller 가
   * 명시적으로 표시. spec §11.18.8b 룰 5 / 6 분기 트리거.
   *
   * orchestrator 의 `runComposeMinutesPhase` 종료 직후 한 번만 `true` 로 호출.
   * 그 외 모든 호출 (gather / quick_vote / free_discussion 안 AI turn 직후) 은
   * `false`.
   */
  minutesComposed: boolean;
}

/**
 * 분류기 입력. `response` 는 직원 응답 (3 phase schema 중 하나) 또는 시스템
 * boundary 호출에서 `null`.
 */
export interface NextStepClassifierInput {
  phase: MeetingPhase;
  response:
    | Step1OpinionGatherSchemaType
    | Step25QuickVoteSchemaType
    | Step3FreeDiscussionSchemaType
    | null;
  context: NextStepClassifierContext;
}

// ── 에러 ───────────────────────────────────────────────────────────────

/**
 * caller 가 phase ↔ response 조합 / 컨텍스트 도메인을 어긴 경우. silent
 * fallback 금지 (CLAUDE.md) — 잘못된 입력은 즉시 throw.
 */
export class NextStepClassifierInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NextStepClassifierInputError';
  }
}

// ── 본체 ───────────────────────────────────────────────────────────────

/**
 * spec §11.18.8b 7 우선순위 규칙 + §11.18.8d cap interlock 통째 적용.
 *
 * 흐름:
 *   1. 입력 정합 검증 (assertValid)
 *   2. 자연 분류 (classifyNatural — 룰 1 ~ 7 우선순위)
 *   3. cap interlock (applyMaxRoundsInterlock — natural='continue' + cap 도달 → 'end')
 *
 * caller 는 결과 카드를 RunStepService.appendOne 의 nextStepCard 필드로
 * 영속 + StreamBridge.emit('stream:next-step-classified', ...) 로 통지.
 *
 * cap interlock 발동 여부 / 자연 분류 결과를 함께 알아야 하면
 * {@link classifyNextStepWithDetails} 사용.
 */
export function classifyNextStep(
  input: NextStepClassifierInput,
): NextStepCard {
  return classifyNextStepWithDetails(input).card;
}

/**
 * 분류 결과 + 자연 분류 결과 + cap interlock 발동 여부 통째 반환.
 *
 * orchestrator 가 stream payload 에 `capOverride` 필드를 채울 때 사용. 외부
 * 텔레메트리 / RunStep output_json 보존에도 useful — 같은 final card 라도
 * 자연 분류가 무엇이었는지 (continue → end? 본래 end?) 추적 가능.
 */
export function classifyNextStepWithDetails(
  input: NextStepClassifierInput,
): {
  /** 최종 카드 (cap interlock 적용 후). */
  card: NextStepCard;
  /** 자연 분류 결과 (룰 1~7 만 적용, interlock 미적용). */
  natural: NextStepCard;
  /** cap interlock 으로 'continue' → 'end' 변환됐는지 (§11.18.8d). */
  capOverride: boolean;
} {
  assertValid(input);
  const natural = classifyNatural(input);
  const card = applyMaxRoundsInterlock(natural, input.context);
  return {
    card,
    natural,
    capOverride: natural === 'continue' && card === 'end',
  };
}

/**
 * spec §11.18.8b 룰 1 ~ 7 우선순위 적용. cap interlock 은 미적용 — caller
 * (또는 {@link classifyNextStep}) 가 별도 단계로 처리.
 *
 * 우선순위 (spec 명시):
 *   1. free_discussion + response.additions[] 비어있지 않음 + depth cap 미도달 → 'continue'
 *   2. 응답이 명시 결재 요청              → 'approve'   (T13 placeholder — 항상 false)
 *   3. 응답이 명시 도구 호출              → 'tool'      (T13 placeholder — 항상 false)
 *   4. 모든 의견 resolved + minutes 미작성 → 'minutes'
 *   5. minutes 작성 직후 + chain 정의      → 'handoff'
 *   6. cap 도달 / minutes 작성 + chain 없음 → 'end'
 *   7. fall-through                        → 'wait'
 */
function classifyNatural(input: NextStepClassifierInput): NextStepCard {
  const { phase, response, context } = input;

  // Rule 1 — free_discussion 발화에 자식 의견 추가 + 트리 cap 미도달.
  if (
    phase === 'free_discussion' &&
    response !== null &&
    isStep3Response(response) &&
    response.additions.length > 0 &&
    !context.depthCapReached
  ) {
    return 'continue';
  }

  // Rule 2 / 3 — 명시 결재 / 도구 호출 키워드 검출. T13 placeholder. T28+ 의
  // 응답 본문 NLP / 키워드 매칭이 land 되면 본 분기 활성. 현재는 항상 미일치.

  // Rule 4 — 모든 의견 처리 완료. 회의록 미작성이면 작성 단계로.
  if (context.allOpinionsResolved && !context.minutesComposed) {
    return 'minutes';
  }

  // Rule 5 — 회의록 작성 직후 + 다음 부서 chain 정의됨.
  if (context.minutesComposed && context.hasNextChain) {
    return 'handoff';
  }

  // Rule 6 — cap 도달 또는 회의록 작성 + chain 없음.
  if (
    hasReachedCap(context) ||
    (context.minutesComposed && !context.hasNextChain)
  ) {
    return 'end';
  }

  // Rule 7 — 모호 / 빈 응답 / 안전군 fall-through.
  return 'wait';
}

/**
 * spec §11.18.8d — cap 도달 시 'continue' 자동 분류를 'end' 강제 override.
 *
 * 이유: 사용자가 max_rounds 를 명시한 시점에 *"N 라운드 도달 시 호출"* 의도가
 * 1 회 명시됨 → 자유 토론 자연 진행 ('continue') 을 무효화하고 회의를 종결한다.
 *
 * 다른 카드 ('approve' / 'tool' / 'minutes' / 'handoff' / 'wait') 는 override
 * 대상 X — 룰 6 의 자연 분류로 'end' 가 이미 결정된 경우 외에는 cap 영향 없음.
 */
function applyMaxRoundsInterlock(
  card: NextStepCard,
  context: NextStepClassifierContext,
): NextStepCard {
  if (card === 'continue' && hasReachedCap(context)) {
    return 'end';
  }
  return card;
}

/**
 * cap 도달 판정. `maxRounds = Infinity` (NULL → 무제한) 는 항상 false. 정수
 * 일 때 `currentRound >= maxRounds` 면 도달.
 */
function hasReachedCap(context: NextStepClassifierContext): boolean {
  if (!Number.isFinite(context.maxRounds)) return false;
  if (context.maxRounds <= 0) return false;
  return context.currentRound >= context.maxRounds;
}

// ── input 정합 검증 ────────────────────────────────────────────────────

/**
 * caller (orchestrator) 가 phase ↔ response ↔ minutesComposed 의 도메인 정합을
 * 어기지 않았는지 검사. 위반 시 즉시 throw — silent fallback 금지.
 *
 * 검증 항목:
 *   - response 가 채워져 있을 때 그 schema 가 phase 와 매칭되는지
 *     (gather → Step1, quick_vote → Step25, free_discussion → Step3)
 *   - minutesComposed=true 인데 phase != 'compose_minutes' 이면 의미 불명확
 *   - currentRound / maxRounds 가 음수가 아닌지
 */
function assertValid(input: NextStepClassifierInput): void {
  const { phase, response, context } = input;

  if (response !== null) {
    if (phase === 'gather' && !isStep1Response(response)) {
      throw new NextStepClassifierInputError(
        `classifyNextStep: phase='gather' requires Step1 response shape`,
      );
    }
    if (phase === 'quick_vote' && !isStep25Response(response)) {
      throw new NextStepClassifierInputError(
        `classifyNextStep: phase='quick_vote' requires Step25 response shape`,
      );
    }
    if (phase === 'free_discussion' && !isStep3Response(response)) {
      throw new NextStepClassifierInputError(
        `classifyNextStep: phase='free_discussion' requires Step3 response shape`,
      );
    }
    // tally / compose_minutes / handoff / aborted / done — 직원 응답 X.
    // response 가 채워졌어도 schema 매칭 룰은 적용 안 — caller 의도 존중.
  }

  if (context.minutesComposed && phase !== 'compose_minutes') {
    throw new NextStepClassifierInputError(
      `classifyNextStep: minutesComposed=true requires phase='compose_minutes' (got '${phase}')`,
    );
  }

  if (context.currentRound < 0) {
    throw new NextStepClassifierInputError(
      `classifyNextStep: currentRound must be >= 0 (got ${context.currentRound})`,
    );
  }
  if (context.maxRounds < 0) {
    throw new NextStepClassifierInputError(
      `classifyNextStep: maxRounds must be >= 0 or Infinity (got ${context.maxRounds})`,
    );
  }
}

// ── response shape narrows ─────────────────────────────────────────────

/**
 * Step1 (gather) 응답 narrow. `opinions` 필드 존재 + array.
 *
 * runtime instanceof X — schema 자체가 zod 로 검증되어 들어온 객체이므로
 * 구조 추정으로 충분. silent fallback 없음 — 매칭 실패는 false 반환.
 */
function isStep1Response(
  response: unknown,
): response is Step1OpinionGatherSchemaType {
  return (
    typeof response === 'object' &&
    response !== null &&
    'opinions' in response &&
    Array.isArray((response as { opinions: unknown }).opinions)
  );
}

function isStep25Response(
  response: unknown,
): response is Step25QuickVoteSchemaType {
  return (
    typeof response === 'object' &&
    response !== null &&
    'quick_votes' in response &&
    Array.isArray((response as { quick_votes: unknown }).quick_votes)
  );
}

function isStep3Response(
  response: unknown,
): response is Step3FreeDiscussionSchemaType {
  return (
    typeof response === 'object' &&
    response !== null &&
    'votes' in response &&
    'additions' in response &&
    Array.isArray((response as { votes: unknown }).votes) &&
    Array.isArray((response as { additions: unknown }).additions)
  );
}
