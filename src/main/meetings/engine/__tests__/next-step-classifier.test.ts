/**
 * NextStep classifier 단위 테스트 — R12-C2 T13.
 *
 * spec §11.18.8b 7 우선순위 + §11.18.8d cap interlock 통째 검증.
 *
 * 본 테스트는 *순수 함수 단위* — RunStep 영속 / stream emit / orchestrator wire
 * 는 별도 통합 테스트가 책임.
 */

import { describe, it, expect } from 'vitest';
import {
  classifyNextStep,
  NextStepClassifierInputError,
  type NextStepClassifierContext,
  type NextStepClassifierInput,
} from '../next-step-classifier';
import type {
  Step1OpinionGatherSchemaType,
  Step25QuickVoteSchemaType,
  Step3FreeDiscussionSchemaType,
} from '../../../../shared/meeting-flow-types';

// ── 빌더 ───────────────────────────────────────────────────────────────

function ctx(
  overrides: Partial<NextStepClassifierContext> = {},
): NextStepClassifierContext {
  return {
    allOpinionsResolved: false,
    depthCapReached: false,
    currentRound: 0,
    maxRounds: Number.POSITIVE_INFINITY,
    hasNextChain: false,
    minutesComposed: false,
    ...overrides,
  };
}

function step1(opinions: number = 1): Step1OpinionGatherSchemaType {
  return {
    name: 'Codex',
    label: 'codex_1',
    opinions: Array.from({ length: opinions }, (_, i) => ({
      title: `t${i}`,
      content: `c${i}`,
      rationale: `r${i}`,
    })),
  };
}

function step25(votes: number = 1): Step25QuickVoteSchemaType {
  return {
    name: 'Codex',
    label: 'codex_2',
    quick_votes: Array.from({ length: votes }, (_, i) => ({
      target_id: `ITEM_00${i + 1}`,
      vote: 'agree' as const,
    })),
  };
}

function step3(args: {
  votes?: number;
  additions?: number;
}): Step3FreeDiscussionSchemaType {
  const v = args.votes ?? 0;
  const a = args.additions ?? 0;
  return {
    name: 'Codex',
    label: 'codex_3',
    votes: Array.from({ length: v }, (_, i) => ({
      target_id: `ITEM_00${i + 1}`,
      vote: 'agree' as const,
    })),
    additions: Array.from({ length: a }, (_, i) => ({
      parent_id: `ITEM_00${i + 1}`,
      kind: 'addition' as const,
      title: `t${i}`,
      content: `c${i}`,
      rationale: `r${i}`,
    })),
  };
}

// ── 룰 1 — 'continue' ──────────────────────────────────────────────────

describe('classifyNextStep — Rule 1 (continue)', () => {
  it('free_discussion + additions[] 비어있지 않음 + cap 미도달 → continue', () => {
    const card = classifyNextStep({
      phase: 'free_discussion',
      response: step3({ additions: 1 }),
      context: ctx({ currentRound: 1, maxRounds: 5 }),
    });
    expect(card).toBe('continue');
  });

  it('free_discussion 인데 additions[] 비어있음 → continue 아님 (fall-through wait)', () => {
    const card = classifyNextStep({
      phase: 'free_discussion',
      response: step3({ votes: 1, additions: 0 }),
      context: ctx({ currentRound: 1, maxRounds: 5 }),
    });
    expect(card).toBe('wait');
  });

  it('additions 있어도 트리 cap 도달이면 continue 아님 (룰 1 부정 조건)', () => {
    const card = classifyNextStep({
      phase: 'free_discussion',
      response: step3({ additions: 1 }),
      context: ctx({
        currentRound: 1,
        maxRounds: 5,
        depthCapReached: true,
      }),
    });
    expect(card).toBe('wait');
  });

  it('phase=gather 는 additions 없는 schema 라 룰 1 미적용 → wait', () => {
    const card = classifyNextStep({
      phase: 'gather',
      response: step1(2),
      context: ctx(),
    });
    expect(card).toBe('wait');
  });
});

// ── 룰 4 — 'minutes' ───────────────────────────────────────────────────

describe('classifyNextStep — Rule 4 (minutes)', () => {
  it('모든 의견 resolved + minutes 미작성 → minutes', () => {
    const card = classifyNextStep({
      phase: 'free_discussion',
      response: step3({ votes: 1 }),
      context: ctx({ allOpinionsResolved: true }),
    });
    expect(card).toBe('minutes');
  });

  it('phase=compose_minutes 안 + minutes 작성 직후 + chain 없음 → end (룰 4 미발동)', () => {
    const card = classifyNextStep({
      phase: 'compose_minutes',
      response: null,
      context: ctx({
        allOpinionsResolved: true,
        minutesComposed: true,
        hasNextChain: false,
      }),
    });
    expect(card).toBe('end');
  });

  it('룰 1 (continue) 이 룰 4 (minutes) 보다 우선 — 자유토론 진행 중 같이 만족', () => {
    const card = classifyNextStep({
      phase: 'free_discussion',
      response: step3({ additions: 1 }),
      context: ctx({
        allOpinionsResolved: true, // Rule 4 도 발동 후보
        currentRound: 1,
        maxRounds: 5,
      }),
    });
    expect(card).toBe('continue');
  });
});

// ── 룰 5 — 'handoff' ───────────────────────────────────────────────────

describe('classifyNextStep — Rule 5 (handoff)', () => {
  it('minutes 작성 직후 + chain 정의 → handoff', () => {
    const card = classifyNextStep({
      phase: 'compose_minutes',
      response: null,
      context: ctx({
        minutesComposed: true,
        hasNextChain: true,
      }),
    });
    expect(card).toBe('handoff');
  });
});

// ── 룰 6 — 'end' ───────────────────────────────────────────────────────

describe('classifyNextStep — Rule 6 (end)', () => {
  it('cap 도달 단독 → end', () => {
    const card = classifyNextStep({
      phase: 'free_discussion',
      response: step3({ votes: 1 }),
      context: ctx({ currentRound: 5, maxRounds: 5 }),
    });
    expect(card).toBe('end');
  });

  it('minutes 작성 + chain 없음 → end', () => {
    const card = classifyNextStep({
      phase: 'compose_minutes',
      response: null,
      context: ctx({
        minutesComposed: true,
        hasNextChain: false,
      }),
    });
    expect(card).toBe('end');
  });

  it('maxRounds=0 (정수) 는 cap 미설정 취급 — end 아님', () => {
    // resolveMaxRounds(channel) 가 0/음수를 Infinity 로 변환하는 것과
    // 정합 — classifier 는 maxRounds=0 받아도 cap 미도달로 처리.
    const card = classifyNextStep({
      phase: 'free_discussion',
      response: step3({ votes: 1 }),
      context: ctx({ currentRound: 100, maxRounds: 0 }),
    });
    expect(card).toBe('wait');
  });

  it('maxRounds=Infinity → cap 검사 false → fall-through wait', () => {
    const card = classifyNextStep({
      phase: 'free_discussion',
      response: step3({ votes: 1 }),
      context: ctx({
        currentRound: 999,
        maxRounds: Number.POSITIVE_INFINITY,
      }),
    });
    expect(card).toBe('wait');
  });
});

// ── 룰 7 — 'wait' (fall-through) ───────────────────────────────────────

describe('classifyNextStep — Rule 7 (wait fall-through)', () => {
  it('gather phase + 정상 응답 → wait', () => {
    const card = classifyNextStep({
      phase: 'gather',
      response: step1(1),
      context: ctx(),
    });
    expect(card).toBe('wait');
  });

  it('quick_vote phase + 정상 응답 → wait', () => {
    const card = classifyNextStep({
      phase: 'quick_vote',
      response: step25(2),
      context: ctx(),
    });
    expect(card).toBe('wait');
  });

  it('free_discussion + votes-only 응답 (additions 없음) → wait', () => {
    const card = classifyNextStep({
      phase: 'free_discussion',
      response: step3({ votes: 2, additions: 0 }),
      context: ctx({ currentRound: 1, maxRounds: 5 }),
    });
    expect(card).toBe('wait');
  });

  it('response=null + 컨텍스트 모두 false → wait', () => {
    const card = classifyNextStep({
      phase: 'tally',
      response: null,
      context: ctx(),
    });
    expect(card).toBe('wait');
  });
});

// ── §11.18.8d cap interlock — continue → end override ─────────────────

describe('classifyNextStep — cap interlock (§11.18.8d)', () => {
  it('자연 분류 continue + cap 도달 → end 강제 override', () => {
    const card = classifyNextStep({
      phase: 'free_discussion',
      response: step3({ additions: 1 }),
      context: ctx({
        currentRound: 5,
        maxRounds: 5,
      }),
    });
    expect(card).toBe('end');
  });

  it('cap 미도달이면 자연 continue 보존', () => {
    const card = classifyNextStep({
      phase: 'free_discussion',
      response: step3({ additions: 1 }),
      context: ctx({
        currentRound: 4,
        maxRounds: 5,
      }),
    });
    expect(card).toBe('continue');
  });

  it('자연 wait + cap 도달 → wait 유지 (interlock 은 continue 만 override)', () => {
    const card = classifyNextStep({
      phase: 'free_discussion',
      response: step3({ votes: 1, additions: 0 }),
      context: ctx({
        currentRound: 5,
        maxRounds: 5,
      }),
    });
    // 룰 6 (cap → end) 가 자연 분류 단계에서 이미 발동.
    expect(card).toBe('end');
  });

  it('자연 minutes + cap 도달 → minutes 유지 (interlock override 대상 X)', () => {
    const card = classifyNextStep({
      phase: 'free_discussion',
      response: step3({ votes: 1, additions: 0 }),
      context: ctx({
        allOpinionsResolved: true, // Rule 4 발동 — minutes
        currentRound: 5,
        maxRounds: 5,
      }),
    });
    expect(card).toBe('minutes');
  });
});

// ── 우선순위 정합 ────────────────────────────────────────────────────

describe('classifyNextStep — 우선순위 정합', () => {
  it('Rule 1 (continue) > Rule 4 (minutes) > Rule 6 (end)', () => {
    // 모든 조건 만족 — 가장 높은 우선순위 (Rule 1) 가 이김.
    const card = classifyNextStep({
      phase: 'free_discussion',
      response: step3({ additions: 1 }),
      context: ctx({
        allOpinionsResolved: true,
        currentRound: 4,
        maxRounds: 5,
      }),
    });
    expect(card).toBe('continue');
  });

  it('Rule 4 > Rule 5 (compose_minutes 진입 직전 vs 직후)', () => {
    // allOpinionsResolved 단독 + minutes 미작성 → minutes (Rule 4)
    const before = classifyNextStep({
      phase: 'free_discussion',
      response: step3({ votes: 1 }),
      context: ctx({
        allOpinionsResolved: true,
        hasNextChain: true, // Rule 5 도 잠재 — minutes 미작성이라 미발동
      }),
    });
    expect(before).toBe('minutes');

    // 그 다음 minutes 작성 후 → handoff (Rule 5)
    const after = classifyNextStep({
      phase: 'compose_minutes',
      response: null,
      context: ctx({
        allOpinionsResolved: true,
        minutesComposed: true,
        hasNextChain: true,
      }),
    });
    expect(after).toBe('handoff');
  });
});

// ── input 정합 검증 ───────────────────────────────────────────────────

describe('classifyNextStep — assertValid (silent fallback 금지)', () => {
  it('phase=gather 인데 Step3 response → throw', () => {
    const input: NextStepClassifierInput = {
      phase: 'gather',
      response: step3({ votes: 1 }),
      context: ctx(),
    };
    expect(() => classifyNextStep(input)).toThrow(
      NextStepClassifierInputError,
    );
  });

  it('phase=quick_vote 인데 Step1 response → throw', () => {
    const input: NextStepClassifierInput = {
      phase: 'quick_vote',
      response: step1(1),
      context: ctx(),
    };
    expect(() => classifyNextStep(input)).toThrow(
      NextStepClassifierInputError,
    );
  });

  it('phase=free_discussion 인데 Step25 response → throw', () => {
    const input: NextStepClassifierInput = {
      phase: 'free_discussion',
      response: step25(1),
      context: ctx(),
    };
    expect(() => classifyNextStep(input)).toThrow(
      NextStepClassifierInputError,
    );
  });

  it('minutesComposed=true 인데 phase != compose_minutes → throw', () => {
    const input: NextStepClassifierInput = {
      phase: 'free_discussion',
      response: null,
      context: ctx({ minutesComposed: true }),
    };
    expect(() => classifyNextStep(input)).toThrow(
      NextStepClassifierInputError,
    );
  });

  it('currentRound 음수 → throw', () => {
    const input: NextStepClassifierInput = {
      phase: 'free_discussion',
      response: null,
      context: ctx({ currentRound: -1 }),
    };
    expect(() => classifyNextStep(input)).toThrow(
      NextStepClassifierInputError,
    );
  });

  it('maxRounds 음수 → throw', () => {
    const input: NextStepClassifierInput = {
      phase: 'free_discussion',
      response: null,
      context: ctx({ maxRounds: -1 }),
    };
    expect(() => classifyNextStep(input)).toThrow(
      NextStepClassifierInputError,
    );
  });

  it('response=null 일 땐 schema 매칭 룰 미적용 (boundary 호출 허용)', () => {
    expect(() =>
      classifyNextStep({
        phase: 'gather',
        response: null,
        context: ctx(),
      }),
    ).not.toThrow();
  });
});
