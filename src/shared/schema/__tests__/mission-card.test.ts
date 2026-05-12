/**
 * mission-card schema 단위 테스트 — R12-C2 P5 T23 land. spec / plan
 * docs/R12_c2_2R/plans/2026-05-04-rolestra-phase-r12-c2.md line 418-431.
 *
 * 검증 (순수 함수 + zod):
 *   - MissionCardKind 3 종 + ALL_MISSION_CARD_KINDS 정렬 invariant
 *   - 종별 payload schema:
 *       'spec'           rootOpinionId + planningMinutesMarkdown 필수
 *       'fix'            auditMinutesMarkdown + problemList(≥1) 필수
 *       'change-request' userMessage 필수
 *   - 공통 base shape — body / inputFiles / expectedOutputs invariant
 *   - buildMissionCard — 정상 build / 빈 body throw / id non-uuid throw /
 *     createdAt 음수 throw / 종별 metadata 누락 throw
 *   - parseMissionCardJson — 정상 parse / JSON malformed throw / schema
 *     mismatch throw
 *   - serializeMissionCard — JSON round-trip 정합
 *   - MissionCardInvariantError 의 cause 보존 (zod ZodError)
 */

import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import {
  ALL_MISSION_CARD_KINDS,
  buildMissionCard,
  missionCardPayloadSchema,
  missionCardSchema,
  MissionCardInvariantError,
  parseMissionCardJson,
  serializeMissionCard,
  type MissionCard,
  type MissionCardPayload,
} from '../mission-card';

// ── fixtures ────────────────────────────────────────────────────────

const VALID_UUID = '11111111-2222-4333-8444-555555555555';

function specPayload(): MissionCardPayload {
  return {
    kind: 'spec',
    body: 'implement authentication module',
    inputFiles: ['src/auth/types.ts'],
    expectedOutputs: ['src/auth/service.ts'],
    rootOpinionId: 'opinion-uuid-1',
    planningMinutesMarkdown: '# 회의록\n\n[합의] 인증 모듈 추가',
  };
}

function fixPayload(): MissionCardPayload {
  return {
    kind: 'fix',
    body: 'fix audit-found problems',
    inputFiles: [],
    expectedOutputs: [],
    auditMinutesMarkdown: '# audit 회의록\n\n[합의] 누락된 입력 검증',
    problemList: [
      {
        opinionId: 'opinion-uuid-2',
        title: '입력 검증 누락',
        content: '비밀번호 길이 검증 없음',
      },
    ],
  };
}

function changeRequestPayload(): MissionCardPayload {
  return {
    kind: 'change-request',
    body: 'apply user change request',
    inputFiles: ['src/foo.ts'],
    expectedOutputs: ['src/foo.ts patched'],
    userMessage: '버튼 라벨 변경 요청',
  };
}

function fullCard(payload: MissionCardPayload): MissionCard {
  return {
    id: VALID_UUID,
    payload,
    assignedProviderId: 'provider-1',
    targetChannelId: 'channel-1',
    createdAt: 1_700_000_000_000,
  };
}

// ── ALL_MISSION_CARD_KINDS ──────────────────────────────────────────

describe('ALL_MISSION_CARD_KINDS', () => {
  it('exactly 3 kinds — spec / fix / change-request', () => {
    expect([...ALL_MISSION_CARD_KINDS]).toEqual([
      'spec',
      'fix',
      'change-request',
    ]);
  });
});

// ── payload schema (discriminated union) ────────────────────────────

describe('missionCardPayloadSchema', () => {
  it("'spec' payload accepted with full metadata", () => {
    const result = missionCardPayloadSchema.safeParse(specPayload());
    expect(result.success).toBe(true);
  });

  it("'fix' payload accepted with full metadata", () => {
    const result = missionCardPayloadSchema.safeParse(fixPayload());
    expect(result.success).toBe(true);
  });

  it("'change-request' payload accepted with full metadata", () => {
    const result = missionCardPayloadSchema.safeParse(changeRequestPayload());
    expect(result.success).toBe(true);
  });

  it('unknown kind rejected', () => {
    const bogus = { ...specPayload(), kind: 'unknown-kind' as never };
    const result = missionCardPayloadSchema.safeParse(bogus);
    expect(result.success).toBe(false);
  });

  it('empty body rejected (invariant — 모든 종 공통)', () => {
    const result = missionCardPayloadSchema.safeParse({
      ...specPayload(),
      body: '',
    });
    expect(result.success).toBe(false);
  });

  it('inputFiles 빈 배열 허용 ("scratch 구현" path)', () => {
    const result = missionCardPayloadSchema.safeParse({
      ...specPayload(),
      inputFiles: [],
    });
    expect(result.success).toBe(true);
  });

  it('expectedOutputs 빈 배열 허용 ("자율 산출 위임" path)', () => {
    const result = missionCardPayloadSchema.safeParse({
      ...specPayload(),
      expectedOutputs: [],
    });
    expect(result.success).toBe(true);
  });

  it("'spec' payload missing rootOpinionId rejected", () => {
    const { rootOpinionId: _omit, ...rest } = specPayload() as Extract<
      MissionCardPayload,
      { kind: 'spec' }
    >;
    const result = missionCardPayloadSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("'spec' payload empty planningMinutesMarkdown rejected", () => {
    const result = missionCardPayloadSchema.safeParse({
      ...specPayload(),
      planningMinutesMarkdown: '',
    });
    expect(result.success).toBe(false);
  });

  it("'fix' payload empty problemList rejected (≥ 1 invariant)", () => {
    const result = missionCardPayloadSchema.safeParse({
      ...fixPayload(),
      problemList: [],
    });
    expect(result.success).toBe(false);
  });

  it("'fix' payload empty auditMinutesMarkdown rejected", () => {
    const result = missionCardPayloadSchema.safeParse({
      ...fixPayload(),
      auditMinutesMarkdown: '',
    });
    expect(result.success).toBe(false);
  });

  it("'change-request' payload empty userMessage rejected", () => {
    const result = missionCardPayloadSchema.safeParse({
      ...changeRequestPayload(),
      userMessage: '',
    });
    expect(result.success).toBe(false);
  });

  it("'spec' payload extra unknown field rejected (strict)", () => {
    const result = missionCardPayloadSchema.safeParse({
      ...specPayload(),
      bogusExtra: 1,
    });
    expect(result.success).toBe(false);
  });
});

// ── missionCardSchema 본체 ──────────────────────────────────────────

describe('missionCardSchema', () => {
  it('full valid card accepted', () => {
    const result = missionCardSchema.safeParse(fullCard(specPayload()));
    expect(result.success).toBe(true);
  });

  it('non-uuid id rejected', () => {
    const result = missionCardSchema.safeParse({
      ...fullCard(specPayload()),
      id: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
  });

  it('empty assignedProviderId rejected', () => {
    const result = missionCardSchema.safeParse({
      ...fullCard(specPayload()),
      assignedProviderId: '',
    });
    expect(result.success).toBe(false);
  });

  it('empty targetChannelId rejected', () => {
    const result = missionCardSchema.safeParse({
      ...fullCard(specPayload()),
      targetChannelId: '',
    });
    expect(result.success).toBe(false);
  });

  it('negative createdAt rejected', () => {
    const result = missionCardSchema.safeParse({
      ...fullCard(specPayload()),
      createdAt: -1,
    });
    expect(result.success).toBe(false);
  });

  it('non-integer createdAt rejected', () => {
    const result = missionCardSchema.safeParse({
      ...fullCard(specPayload()),
      createdAt: 1.5,
    });
    expect(result.success).toBe(false);
  });
});

// ── buildMissionCard ────────────────────────────────────────────────

describe('buildMissionCard', () => {
  it('returns the validated card on valid input', () => {
    const input = fullCard(specPayload());
    const card = buildMissionCard(input);
    expect(card.id).toBe(VALID_UUID);
    expect(card.payload.kind).toBe('spec');
  });

  it('throws MissionCardInvariantError on schema mismatch', () => {
    expect(() => buildMissionCard({ ...fullCard(specPayload()), id: 'bad' }))
      .toThrow(MissionCardInvariantError);
  });

  it('error.cause carries ZodError for diagnostics', () => {
    try {
      buildMissionCard({ ...fullCard(specPayload()), id: 'bad' });
      expect.unreachable('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(MissionCardInvariantError);
      expect((err as MissionCardInvariantError).cause).toBeInstanceOf(ZodError);
    }
  });

  it("'fix' card with full metadata accepted", () => {
    const card = buildMissionCard(fullCard(fixPayload()));
    expect(card.payload.kind).toBe('fix');
    if (card.payload.kind === 'fix') {
      expect(card.payload.problemList).toHaveLength(1);
    }
  });

  it("'change-request' card with full metadata accepted", () => {
    const card = buildMissionCard(fullCard(changeRequestPayload()));
    expect(card.payload.kind).toBe('change-request');
    if (card.payload.kind === 'change-request') {
      expect(card.payload.userMessage).toBe('버튼 라벨 변경 요청');
    }
  });
});

// ── parseMissionCardJson ────────────────────────────────────────────

describe('parseMissionCardJson', () => {
  it('parses a serialized card and returns equivalent object', () => {
    const original = fullCard(specPayload());
    const json = serializeMissionCard(original);
    const parsed = parseMissionCardJson(json);
    expect(parsed).toEqual(original);
  });

  it('throws MissionCardInvariantError on malformed JSON', () => {
    expect(() => parseMissionCardJson('{not valid json'))
      .toThrow(MissionCardInvariantError);
  });

  it('throws MissionCardInvariantError on schema mismatch', () => {
    const wrong = JSON.stringify({ ...fullCard(specPayload()), id: 'bad' });
    expect(() => parseMissionCardJson(wrong))
      .toThrow(MissionCardInvariantError);
  });

  it('throws on JSON whose payload kind is unknown', () => {
    const wrong = JSON.stringify({
      ...fullCard(specPayload()),
      payload: { ...specPayload(), kind: 'totally-bogus' },
    });
    expect(() => parseMissionCardJson(wrong))
      .toThrow(MissionCardInvariantError);
  });
});

// ── serializeMissionCard ────────────────────────────────────────────

describe('serializeMissionCard', () => {
  it('produces JSON that round-trips through parseMissionCardJson', () => {
    const cards: MissionCard[] = [
      fullCard(specPayload()),
      fullCard(fixPayload()),
      fullCard(changeRequestPayload()),
    ];
    for (const card of cards) {
      const json = serializeMissionCard(card);
      expect(typeof json).toBe('string');
      const back = parseMissionCardJson(json);
      expect(back).toEqual(card);
    }
  });
});
