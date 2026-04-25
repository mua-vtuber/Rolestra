/**
 * R11-Task4: dev-hooks-handler unit test.
 *
 * The handler is registered only when `ROLESTRA_E2E=1`, so production
 * builds never touch this code path. The test focuses on the four
 * tripwires:
 *   - downgrade side-effect chain runs (setAutonomy + approval + notify)
 *   - circuit breaker counter mutation matches the trip kind
 *   - explicit projectId beats auto-discovery
 *   - auto-discovery picks a non-manual project, throws when none exist
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  handleDevTripCircuitBreaker,
  setDevHooksAccessors,
  clearDevHooksAccessors,
  type DevTripCircuitBreakerInput,
} from '../dev-hooks-handler';
import type { ApprovalService } from '../../../approvals/approval-service';
import type { NotificationService } from '../../../notifications/notification-service';
import type { ProjectService } from '../../../projects/project-service';
import type { CircuitBreaker } from '../../../queue/circuit-breaker';
import type { Project } from '../../../../shared/project-types';

interface Mocks {
  projectService: {
    list: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    setAutonomy: ReturnType<typeof vi.fn>;
  };
  approvalService: { create: ReturnType<typeof vi.fn> };
  notificationService: { show: ReturnType<typeof vi.fn> };
  circuitBreaker: {
    recordFileChanges: ReturnType<typeof vi.fn>;
    recordCliElapsed: ReturnType<typeof vi.fn>;
    recordQueueStart: ReturnType<typeof vi.fn>;
    recordError: ReturnType<typeof vi.fn>;
  };
}

function seedProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'proj-1',
    slug: 'arena-sample',
    name: 'Arena Sample',
    description: '',
    kind: 'new',
    externalLink: null,
    permissionMode: 'auto',
    autonomyMode: 'queue',
    status: 'active',
    createdAt: 1,
    archivedAt: null,
    ...overrides,
  };
}

function buildMocks(initial: Project[]): Mocks {
  return {
    projectService: {
      list: vi.fn(() => initial),
      get: vi.fn((id: string) => initial.find((p) => p.id === id) ?? null),
      setAutonomy: vi.fn(),
    },
    approvalService: { create: vi.fn() },
    notificationService: { show: vi.fn() },
    circuitBreaker: {
      recordFileChanges: vi.fn(),
      recordCliElapsed: vi.fn(),
      recordQueueStart: vi.fn(),
      recordError: vi.fn(),
    },
  };
}

function wireMocks(mocks: Mocks): void {
  setDevHooksAccessors({
    projectService: () => mocks.projectService as unknown as ProjectService,
    approvalService: () => mocks.approvalService as unknown as ApprovalService,
    notificationService: () =>
      mocks.notificationService as unknown as NotificationService,
    circuitBreaker: () => mocks.circuitBreaker as unknown as CircuitBreaker,
  });
}

describe('dev-hooks-handler — files_per_turn', () => {
  let mocks: Mocks;
  beforeEach(() => {
    mocks = buildMocks([seedProject()]);
    wireMocks(mocks);
  });
  afterEach(() => clearDevHooksAccessors());

  it('records counter + downgrades autonomy + creates approval + notifies', () => {
    const input: DevTripCircuitBreakerInput = {
      tripwire: 'files_per_turn',
      count: 25,
    };
    const result = handleDevTripCircuitBreaker(input);

    expect(result).toEqual({
      ok: true,
      projectId: 'proj-1',
      tripwire: 'files_per_turn',
    });

    expect(mocks.circuitBreaker.recordFileChanges).toHaveBeenCalledWith(25);

    expect(mocks.projectService.setAutonomy).toHaveBeenCalledWith(
      'proj-1',
      'manual',
      { reason: 'circuit_breaker' },
    );

    expect(mocks.approvalService.create).toHaveBeenCalledTimes(1);
    const approvalCall = mocks.approvalService.create.mock.calls[0]![0];
    expect(approvalCall.kind).toBe('circuit_breaker');
    expect(approvalCall.projectId).toBe('proj-1');
    const payload = approvalCall.payload as Record<string, unknown>;
    expect(payload.tripwire).toBe('files_per_turn');
    expect(payload.previousMode).toBe('queue');

    expect(mocks.notificationService.show).toHaveBeenCalledTimes(1);
    const notifyCall = mocks.notificationService.show.mock.calls[0]![0];
    expect(notifyCall.kind).toBe('error');
    expect(notifyCall.force).toBe(true);
  });
});

describe('dev-hooks-handler — other tripwires', () => {
  let mocks: Mocks;
  beforeEach(() => {
    mocks = buildMocks([seedProject({ autonomyMode: 'auto_toggle' })]);
    wireMocks(mocks);
  });
  afterEach(() => clearDevHooksAccessors());

  it('cumulative_cli_ms calls recordCliElapsed once', () => {
    handleDevTripCircuitBreaker({
      tripwire: 'cumulative_cli_ms',
      ms: 31 * 60 * 1000,
    });
    expect(mocks.circuitBreaker.recordCliElapsed).toHaveBeenCalledWith(
      31 * 60 * 1000,
    );
  });

  it('queue_streak replays recordQueueStart N times', () => {
    handleDevTripCircuitBreaker({ tripwire: 'queue_streak', count: 6 });
    expect(mocks.circuitBreaker.recordQueueStart).toHaveBeenCalledTimes(6);
  });

  it('same_error replays recordError N times with the same category', () => {
    handleDevTripCircuitBreaker({
      tripwire: 'same_error',
      category: 'TIMEOUT',
      count: 4,
    });
    expect(mocks.circuitBreaker.recordError).toHaveBeenCalledTimes(4);
    for (const call of mocks.circuitBreaker.recordError.mock.calls) {
      expect(call[0]).toBe('TIMEOUT');
    }
  });
});

describe('dev-hooks-handler — project resolution', () => {
  afterEach(() => clearDevHooksAccessors());

  it('uses explicit projectId when provided', () => {
    const projectA = seedProject({ id: 'proj-a', autonomyMode: 'manual' });
    const projectB = seedProject({ id: 'proj-b', autonomyMode: 'queue' });
    const mocks = buildMocks([projectA, projectB]);
    wireMocks(mocks);

    const result = handleDevTripCircuitBreaker({
      tripwire: 'files_per_turn',
      count: 25,
      projectId: 'proj-a',
    });

    expect(result.projectId).toBe('proj-a');
    expect(mocks.projectService.setAutonomy).toHaveBeenCalledWith(
      'proj-a',
      'manual',
      expect.anything(),
    );
  });

  it('throws when explicit projectId is unknown', () => {
    const mocks = buildMocks([seedProject({ id: 'proj-a' })]);
    wireMocks(mocks);

    expect(() =>
      handleDevTripCircuitBreaker({
        tripwire: 'files_per_turn',
        count: 25,
        projectId: 'missing',
      }),
    ).toThrow(/project not found/);
    // No side-effects on resolution failure.
    expect(mocks.projectService.setAutonomy).not.toHaveBeenCalled();
    expect(mocks.approvalService.create).not.toHaveBeenCalled();
  });

  it('auto-discovers the first non-manual project', () => {
    const projectA = seedProject({ id: 'proj-a', autonomyMode: 'manual' });
    const projectB = seedProject({ id: 'proj-b', autonomyMode: 'queue' });
    const mocks = buildMocks([projectA, projectB]);
    wireMocks(mocks);

    const result = handleDevTripCircuitBreaker({
      tripwire: 'files_per_turn',
      count: 25,
    });
    expect(result.projectId).toBe('proj-b');
  });

  it('throws when every project is manual', () => {
    const projectA = seedProject({ id: 'proj-a', autonomyMode: 'manual' });
    const mocks = buildMocks([projectA]);
    wireMocks(mocks);

    expect(() =>
      handleDevTripCircuitBreaker({ tripwire: 'files_per_turn', count: 25 }),
    ).toThrow(/no project in auto_toggle\/queue mode/);
  });
});

describe('dev-hooks-handler — accessor lifecycle', () => {
  it('throws when accessors are not initialized', () => {
    clearDevHooksAccessors();
    expect(() =>
      handleDevTripCircuitBreaker({ tripwire: 'files_per_turn', count: 25 }),
    ).toThrow(/services not initialized/);
  });
});
