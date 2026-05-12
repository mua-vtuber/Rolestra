/**
 * handoff-package schema 단위 테스트 — R12-C2 P6 T27 land. spec / plan
 * docs/R12_c2_2R/plans/2026-05-04-rolestra-phase-r12-c2.md line 469-482.
 *
 * 검증 (순수 함수 + zod):
 *   - handoffPackageSchema 정상 build / strict 엄수 / mode enum 강제
 *   - sender / target 의 channelRole 필드 nullable 허용 (NULL 가능)
 *   - reason 빈 문자열 거부 / minutesMeetingId nullable 허용
 *   - dispatchedAt 음수 / NaN / non-int 거부
 *   - missionCard 가 mission-card schema 검증을 통과한 객체여야 함 (재검증)
 *   - buildHandoffPackage — 추가 invariant:
 *       - sender.channelId === target.channelId 거부 (self-handoff)
 *       - missionCard.targetChannelId !== target.channelId 거부 (mismatch)
 *   - parseHandoffPackage — 검증된 raw object → HandoffPackage round-trip
 *   - serializeHandoffPackage — JSON round-trip 정합
 *   - HandoffPackageInvariantError cause 보존 (zod ZodError)
 *   - role guard helpers (isReceivableHandoffTarget / isSameRoleHandoff)
 */

import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import {
  buildHandoffPackage,
  handoffPackageSchema,
  HandoffPackageInvariantError,
  isReceivableHandoffTarget,
  isSameRoleHandoff,
  parseHandoffPackage,
  serializeHandoffPackage,
  type HandoffPackage,
  type HandoffSender,
  type HandoffTarget,
} from '../handoff-package';
import { type MissionCard } from '../mission-card';

// ── fixtures ────────────────────────────────────────────────────────

const SENDER_CHANNEL = 'ch-planning-1';
const TARGET_CHANNEL = 'ch-design-1';
const MEETING_UUID = '11111111-1111-4111-8111-111111111111';
const MISSION_CARD_UUID = '22222222-2222-4222-8222-222222222222';

function fullMissionCard(targetChannelId = TARGET_CHANNEL): MissionCard {
  return {
    id: MISSION_CARD_UUID,
    payload: {
      kind: 'spec',
      body: 'implement design wireframe per planning minutes',
      inputFiles: ['src/foo.ts'],
      expectedOutputs: ['src/foo-wireframe.svg'],
      rootOpinionId: 'opinion-uuid-1',
      planningMinutesMarkdown: '# planning minutes\n[합의] 디자인 시작',
    },
    assignedProviderId: 'provider-design-1',
    targetChannelId,
    createdAt: 1_700_000_000_000,
  };
}

function fullPackage(overrides: Partial<HandoffPackage> = {}): HandoffPackage {
  return {
    sender: {
      meetingId: MEETING_UUID,
      channelId: SENDER_CHANNEL,
      channelRole: 'planning',
    },
    target: {
      channelId: TARGET_CHANNEL,
      channelRole: 'design.ui',
    },
    reason: '디자인 단계 진입 — UX 와이어프레임 작성',
    minutesMeetingId: MEETING_UUID,
    nextActions: ['UX 와이어프레임 작성', 'UI 직원과 디자인 회의'],
    missionCard: fullMissionCard(),
    mode: 'check',
    dispatchedAt: 1_700_000_000_000,
    ...overrides,
  };
}

// ── schema basic ────────────────────────────────────────────────────

describe('handoffPackageSchema', () => {
  it('strict — 알 수 없는 필드 거부', () => {
    const result = handoffPackageSchema.safeParse({
      ...fullPackage(),
      extra: 'should be rejected',
    });
    expect(result.success).toBe(false);
  });

  it('mode 는 check / auto 두 enum 만 허용', () => {
    const result = handoffPackageSchema.safeParse({
      ...fullPackage(),
      mode: 'silent',
    });
    expect(result.success).toBe(false);
  });

  it('reason 빈 문자열 거부', () => {
    const result = handoffPackageSchema.safeParse(
      fullPackage({ reason: '' }),
    );
    expect(result.success).toBe(false);
  });

  it('minutesMeetingId 는 NULL 허용', () => {
    const result = handoffPackageSchema.safeParse(
      fullPackage({ minutesMeetingId: null }),
    );
    expect(result.success).toBe(true);
  });

  it('sender.channelRole / target.channelRole 둘 다 NULL 허용', () => {
    const sender: HandoffSender = {
      meetingId: MEETING_UUID,
      channelId: SENDER_CHANNEL,
      channelRole: null,
    };
    const target: HandoffTarget = {
      channelId: TARGET_CHANNEL,
      channelRole: null,
    };
    const result = handoffPackageSchema.safeParse(
      fullPackage({ sender, target }),
    );
    expect(result.success).toBe(true);
  });

  it('dispatchedAt 음수 거부', () => {
    const result = handoffPackageSchema.safeParse(
      fullPackage({ dispatchedAt: -1 }),
    );
    expect(result.success).toBe(false);
  });

  it('dispatchedAt non-integer 거부', () => {
    const result = handoffPackageSchema.safeParse(
      fullPackage({ dispatchedAt: 1.5 }),
    );
    expect(result.success).toBe(false);
  });

  it('nextActions 빈 배열 허용', () => {
    const result = handoffPackageSchema.safeParse(
      fullPackage({ nextActions: [] }),
    );
    expect(result.success).toBe(true);
  });

  it('nextActions 안 빈 문자열 거부', () => {
    const result = handoffPackageSchema.safeParse(
      fullPackage({ nextActions: ['valid', ''] }),
    );
    expect(result.success).toBe(false);
  });
});

// ── buildHandoffPackage 추가 invariant ──────────────────────────────

describe('buildHandoffPackage', () => {
  it('정상 입력 — 검증된 의뢰서 반환', () => {
    const pkg = buildHandoffPackage(fullPackage());
    expect(pkg.target.channelId).toBe(TARGET_CHANNEL);
    expect(pkg.missionCard.targetChannelId).toBe(TARGET_CHANNEL);
  });

  it('schema 위반 시 HandoffPackageInvariantError + cause 에 ZodError 보존', () => {
    let caught: HandoffPackageInvariantError | null = null;
    try {
      buildHandoffPackage(
        fullPackage({ reason: '' }) as HandoffPackage,
      );
    } catch (err) {
      caught = err as HandoffPackageInvariantError;
    }
    expect(caught).toBeInstanceOf(HandoffPackageInvariantError);
    expect(caught?.cause).toBeInstanceOf(ZodError);
  });

  it('sender.channelId === target.channelId 거부 (self-handoff)', () => {
    const pkg = fullPackage({
      sender: {
        meetingId: MEETING_UUID,
        channelId: TARGET_CHANNEL,
        channelRole: 'planning',
      },
      target: {
        channelId: TARGET_CHANNEL,
        channelRole: 'planning',
      },
      missionCard: fullMissionCard(TARGET_CHANNEL),
    });
    expect(() => buildHandoffPackage(pkg)).toThrow(
      HandoffPackageInvariantError,
    );
    expect(() => buildHandoffPackage(pkg)).toThrow(/self-handoff/);
  });

  it('missionCard.targetChannelId !== target.channelId 거부', () => {
    const pkg = fullPackage({
      missionCard: fullMissionCard('ch-other-target'),
    });
    expect(() => buildHandoffPackage(pkg)).toThrow(
      HandoffPackageInvariantError,
    );
    expect(() => buildHandoffPackage(pkg)).toThrow(/does not match/);
  });
});

// ── parseHandoffPackage / serializeHandoffPackage round-trip ───────

describe('parseHandoffPackage / serializeHandoffPackage', () => {
  it('JSON round-trip 정합', () => {
    const original = buildHandoffPackage(fullPackage());
    const json = serializeHandoffPackage(original);
    const parsed = parseHandoffPackage(JSON.parse(json));
    expect(parsed).toEqual(original);
  });

  it('parseHandoffPackage 가 raw object 의 schema 위반 catch', () => {
    expect(() =>
      parseHandoffPackage({
        ...fullPackage(),
        mode: 'unknown',
      }),
    ).toThrow(HandoffPackageInvariantError);
  });

  it('parseHandoffPackage 가 self-handoff 위반도 catch (build invariant 재실행)', () => {
    const broken = {
      ...fullPackage(),
      sender: {
        meetingId: MEETING_UUID,
        channelId: TARGET_CHANNEL,
        channelRole: 'planning',
      },
      missionCard: fullMissionCard(TARGET_CHANNEL),
    };
    expect(() => parseHandoffPackage(broken)).toThrow(/self-handoff/);
  });
});

// ── role guard helpers ────────────────────────────────────────────

describe('role guard helpers', () => {
  it('isReceivableHandoffTarget — channelRole 이 NULL 이면 false', () => {
    const target: HandoffTarget = {
      channelId: TARGET_CHANNEL,
      channelRole: null,
    };
    expect(isReceivableHandoffTarget(target)).toBe(false);
  });

  it('isReceivableHandoffTarget — channelRole 가 채워져 있으면 true', () => {
    const target: HandoffTarget = {
      channelId: TARGET_CHANNEL,
      channelRole: 'design.ui',
    };
    expect(isReceivableHandoffTarget(target)).toBe(true);
  });

  it('isSameRoleHandoff — 같은 role 이면 true', () => {
    const sender: HandoffSender = {
      meetingId: MEETING_UUID,
      channelId: 'ch-a',
      channelRole: 'planning',
    };
    const target: HandoffTarget = {
      channelId: 'ch-b',
      channelRole: 'planning',
    };
    expect(isSameRoleHandoff(sender, target)).toBe(true);
  });

  it('isSameRoleHandoff — 다른 role 이면 false', () => {
    const sender: HandoffSender = {
      meetingId: MEETING_UUID,
      channelId: 'ch-a',
      channelRole: 'planning',
    };
    const target: HandoffTarget = {
      channelId: 'ch-b',
      channelRole: 'implement',
    };
    expect(isSameRoleHandoff(sender, target)).toBe(false);
  });

  it('isSameRoleHandoff — NULL 어느 쪽이든 false (비교 의미 없음)', () => {
    const sender: HandoffSender = {
      meetingId: MEETING_UUID,
      channelId: 'ch-a',
      channelRole: null,
    };
    const target: HandoffTarget = {
      channelId: 'ch-b',
      channelRole: null,
    };
    expect(isSameRoleHandoff(sender, target)).toBe(false);
  });
});
