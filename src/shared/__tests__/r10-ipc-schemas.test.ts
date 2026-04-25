/**
 * R10-Task1: zod round-trip 테스트 — 신규 IPC 4채널 + `stream:member-status-changed`
 * 이벤트 payload 확장 형태 검증.
 *
 * 각 case 는 (a) valid payload 가 parse 되는지, (b) invalid payload 가
 * reject 되는지 의 쌍으로 작성한다. R9 `ipc-schemas-v3.test.ts` 의 스타일과
 * 동일한 discriminated union + safeParse 체인 패턴.
 */
import { describe, it, expect } from 'vitest';
import {
  dmCreateSchema,
  dmListSchema,
  permissionDryRunFlagsSchema,
  meetingLlmSummarizeSchema,
  v3ChannelSchemas,
} from '../ipc-schemas';
import type { StreamEvent, StreamV3PayloadOf } from '../stream-events';
import type { MemberView } from '../member-profile-types';
import type { PermissionFlagOutput } from '../permission-flag-types';
import {
  CIRCUIT_BREAKER_TRIPWIRES,
  DEFAULT_CIRCUIT_BREAKER_LIMITS,
  type CircuitBreakerStateRecord,
} from '../circuit-breaker-types';

describe('R10 IPC — dm:create schema', () => {
  it('accepts a plain providerId', () => {
    expect(
      dmCreateSchema.safeParse({ providerId: 'ai-claude' }).success,
    ).toBe(true);
  });

  it('rejects empty providerId', () => {
    expect(dmCreateSchema.safeParse({ providerId: '' }).success).toBe(false);
  });

  it('rejects providerId longer than 128 chars', () => {
    expect(
      dmCreateSchema.safeParse({ providerId: 'x'.repeat(129) }).success,
    ).toBe(false);
  });

  it('rejects missing providerId', () => {
    expect(dmCreateSchema.safeParse({}).success).toBe(false);
  });
});

describe('R10 IPC — dm:list schema', () => {
  it('accepts undefined request (no input)', () => {
    expect(dmListSchema.safeParse(undefined).success).toBe(true);
  });

  it('rejects any object on the wire', () => {
    expect(dmListSchema.safeParse({}).success).toBe(false);
  });
});

describe('R10 IPC — permission:dry-run-flags schema', () => {
  const baseInput = {
    providerType: 'claude_cli' as const,
    permissionMode: 'hybrid' as const,
    projectKind: 'new' as const,
    dangerousAutonomyOptIn: false,
  };

  it('accepts a full valid 3×3×3 triple', () => {
    expect(permissionDryRunFlagsSchema.safeParse(baseInput).success).toBe(
      true,
    );
  });

  it('rejects external + auto (spec §7.3 CA-1)', () => {
    const r = permissionDryRunFlagsSchema.safeParse({
      ...baseInput,
      projectKind: 'external',
      permissionMode: 'auto',
    });
    expect(r.success).toBe(false);
  });

  it('accepts external + hybrid', () => {
    const r = permissionDryRunFlagsSchema.safeParse({
      ...baseInput,
      projectKind: 'external',
      permissionMode: 'hybrid',
    });
    expect(r.success).toBe(true);
  });

  it('rejects unknown providerType', () => {
    const r = permissionDryRunFlagsSchema.safeParse({
      ...baseInput,
      providerType: 'bogus_cli',
    });
    expect(r.success).toBe(false);
  });

  it('requires dangerousAutonomyOptIn boolean (not string)', () => {
    const r = permissionDryRunFlagsSchema.safeParse({
      ...baseInput,
      dangerousAutonomyOptIn: 'false',
    });
    expect(r.success).toBe(false);
  });
});

describe('R10 IPC — meeting:llm-summarize schema', () => {
  it('accepts meetingId only (providerId optional → fallback chain)', () => {
    expect(
      meetingLlmSummarizeSchema.safeParse({ meetingId: 'm1' }).success,
    ).toBe(true);
  });

  it('accepts meetingId + providerId', () => {
    expect(
      meetingLlmSummarizeSchema.safeParse({
        meetingId: 'm1',
        providerId: 'ai-claude',
      }).success,
    ).toBe(true);
  });

  it('rejects missing meetingId', () => {
    expect(
      meetingLlmSummarizeSchema.safeParse({ providerId: 'ai-claude' }).success,
    ).toBe(false);
  });

  it('rejects empty meetingId string', () => {
    expect(
      meetingLlmSummarizeSchema.safeParse({ meetingId: '' }).success,
    ).toBe(false);
  });
});

describe('R10 IPC — v3ChannelSchemas registry parity', () => {
  it('has all 4 R10 channels registered', () => {
    expect(v3ChannelSchemas['dm:list']).toBeDefined();
    expect(v3ChannelSchemas['dm:create']).toBeDefined();
    expect(v3ChannelSchemas['permission:dry-run-flags']).toBeDefined();
    expect(v3ChannelSchemas['meeting:llm-summarize']).toBeDefined();
  });
});

describe('R10 stream — stream:member-status-changed payload', () => {
  const member: MemberView = {
    providerId: 'ai-claude',
    role: 'engineer',
    personality: 'calm',
    expertise: 'typescript',
    avatarKind: 'default',
    avatarData: 'blue',
    statusOverride: null,
    updatedAt: 1,
    displayName: 'Claude',
    persona: 'legacy persona text',
    workStatus: 'online',
  };

  it('formalizes providerId + member + status + cause', () => {
    const payload: StreamV3PayloadOf<'stream:member-status-changed'> = {
      providerId: 'ai-claude',
      member,
      status: 'online',
      cause: 'status',
    };
    const evt: StreamEvent = {
      type: 'stream:member-status-changed',
      payload,
    };
    expect(evt.type).toBe('stream:member-status-changed');
    expect(payload.member.workStatus).toBe('online');
  });

  it.each(['status', 'profile', 'warmup'] as const)(
    'accepts cause=%s',
    (cause) => {
      const payload: StreamV3PayloadOf<'stream:member-status-changed'> = {
        providerId: 'ai-claude',
        member,
        status: 'online',
        cause,
      };
      expect(payload.cause).toBe(cause);
    },
  );
});

describe('R10 shared — CircuitBreakerStateRecord persistence schema', () => {
  it('all 4 tripwires have a default limit', () => {
    for (const tw of CIRCUIT_BREAKER_TRIPWIRES) {
      expect(DEFAULT_CIRCUIT_BREAKER_LIMITS[tw]).toBeGreaterThan(0);
    }
  });

  it('record shape compiles with every tripwire literal', () => {
    for (const tw of CIRCUIT_BREAKER_TRIPWIRES) {
      const rec: CircuitBreakerStateRecord = {
        projectId: 'p1',
        tripwire: tw,
        counter: 0,
        limit: DEFAULT_CIRCUIT_BREAKER_LIMITS[tw],
        lastResetAt: 1,
        lastUpdatedAt: 1,
      };
      expect(rec.tripwire).toBe(tw);
    }
  });
});

describe('R10 shared — PermissionFlagOutput blocked path', () => {
  it('accepts blocked=true with a known reason', () => {
    const out: PermissionFlagOutput = {
      flags: [],
      rationale: ['permission.flag.reason.external'],
      blocked: true,
      blockedReason: 'external_auto_forbidden',
    };
    expect(out.blocked).toBe(true);
    expect(out.blockedReason).toBe('external_auto_forbidden');
  });

  it('accepts blocked=false with null reason', () => {
    const out: PermissionFlagOutput = {
      flags: ['--permission-mode', 'acceptEdits'],
      rationale: ['permission.flag.reason.hybrid'],
      blocked: false,
      blockedReason: null,
    };
    expect(out.blocked).toBe(false);
  });
});
