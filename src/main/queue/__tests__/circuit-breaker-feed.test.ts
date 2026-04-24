/**
 * Integration-lite tests for the four CircuitBreaker feed sites wired
 * in R9-Task6. Each describe block drives the single code path that
 * now talks to the breaker and asserts that the matching tripwire
 * fires. We share one real CircuitBreaker per scenario — the class is
 * pure in-memory state, so the test surface is "does the hook
 * actually record, and does the resulting counter cross the default
 * threshold exactly once?"
 *
 * What these tests DO NOT cover:
 *   - The `on('fired')` → downgrade / approval / notification glue.
 *     That flow lives in `v3-side-effects.test.ts` — wiring
 *     feed→downgrade end-to-end through a real SSM is outside the
 *     Task 6 atom (Task 7+ owns the queue + orchestrator story).
 *   - I18n populate of the notification copy. Task 11.
 *
 * Atomic unit: one CircuitBreaker per scenario + the minimal stub
 * around the feeding service so the record hook runs deterministically
 * without subprocess / DB I/O.
 */

import { describe, it, expect, vi } from 'vitest';
import { CircuitBreaker, CIRCUIT_BREAKER_FIRED_EVENT } from '../circuit-breaker';
import {
  setCircuitBreakerAccessor,
  getCircuitBreaker,
} from '../circuit-breaker-accessor';
import { ExecutionService } from '../../execution/execution-service';
import { QueueService } from '../queue-service';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type {
  PatchSet,
  PatchEntry,
} from '../../../shared/execution-types';
import type { QueueRepository } from '../queue-repository';
import type { QueueItem } from '../../../shared/queue-types';

// ── Helpers ──────────────────────────────────────────────────────────

function makeBreaker(): {
  breaker: CircuitBreaker;
  fires: Array<{ reason: string; detail: unknown }>;
} {
  const breaker = new CircuitBreaker();
  const fires: Array<{ reason: string; detail: unknown }> = [];
  breaker.on(CIRCUIT_BREAKER_FIRED_EVENT, (evt) => fires.push(evt));
  return { breaker, fires };
}

function makeTmpWorkspace(): { root: string; cleanup: () => void } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-feed-'));
  return {
    root,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

function makePatchEntry(
  root: string,
  name: string,
  content = 'hello',
): PatchEntry {
  const targetPath = path.join(root, name);
  return {
    targetPath,
    operation: 'create',
    newContent: content,
  };
}

function makePatchSet(
  root: string,
  names: string[],
  dryRun = false,
): PatchSet {
  return {
    operationId: `op-${names.join('-')}`,
    aiId: 'ai-1',
    conversationId: 'conv-1',
    entries: names.map((n) => makePatchEntry(root, n)),
    dryRun,
  };
}

// ── files_per_turn via ExecutionService.applyPatch ───────────────────

describe('CircuitBreaker feed — ExecutionService.applyPatch', () => {
  it('fires files_per_turn when a single apply overshoots the 20-file limit', async () => {
    const ws = makeTmpWorkspace();
    try {
      const { breaker, fires } = makeBreaker();
      const svc = new ExecutionService({
        workspaceRoot: ws.root,
        circuitBreaker: breaker,
      });

      const names = Array.from({ length: 21 }, (_, i) => `file-${i}.txt`);
      const result = await svc.applyPatch(makePatchSet(ws.root, names));
      expect(result.success).toBe(true);
      expect(result.appliedEntries).toHaveLength(21);

      expect(fires).toHaveLength(1);
      expect(fires[0]).toEqual({
        reason: 'files_per_turn',
        detail: { count: 21 },
      });
    } finally {
      ws.cleanup();
    }
  });

  it('accumulates across apply calls within the same turn', async () => {
    const ws = makeTmpWorkspace();
    try {
      const { breaker, fires } = makeBreaker();
      const svc = new ExecutionService({
        workspaceRoot: ws.root,
        circuitBreaker: breaker,
      });

      const first = Array.from({ length: 12 }, (_, i) => `a-${i}.txt`);
      const second = Array.from({ length: 10 }, (_, i) => `b-${i}.txt`);
      await svc.applyPatch(makePatchSet(ws.root, first));
      expect(fires).toHaveLength(0);
      await svc.applyPatch(makePatchSet(ws.root, second));

      expect(fires).toHaveLength(1);
      expect(fires[0]!.reason).toBe('files_per_turn');
      // 12 + 10 = 22 > 20.
      expect((fires[0]!.detail as { count: number }).count).toBe(22);
    } finally {
      ws.cleanup();
    }
  });

  it('dry-run previews do NOT record (threshold crossed, breaker silent)', async () => {
    const ws = makeTmpWorkspace();
    try {
      const { breaker, fires } = makeBreaker();
      const svc = new ExecutionService({
        workspaceRoot: ws.root,
        circuitBreaker: breaker,
      });

      const names = Array.from({ length: 25 }, (_, i) => `preview-${i}.txt`);
      await svc.applyPatch(makePatchSet(ws.root, names, /* dryRun */ true));

      expect(fires).toHaveLength(0);
      expect(breaker.getState().filesChangedThisTurn).toBe(0);
    } finally {
      ws.cleanup();
    }
  });

  it('no breaker DI: applyPatch still works, no throw', async () => {
    const ws = makeTmpWorkspace();
    try {
      const svc = new ExecutionService({ workspaceRoot: ws.root });
      const result = await svc.applyPatch(
        makePatchSet(ws.root, ['loose-1.txt']),
      );
      expect(result.success).toBe(true);
    } finally {
      ws.cleanup();
    }
  });
});

// ── cumulative_cli_ms via circuit-breaker-accessor ───────────────────

describe('CircuitBreaker feed — cli-process accessor', () => {
  it('accessor returns null when nothing is installed (default no-op)', () => {
    setCircuitBreakerAccessor(null);
    expect(getCircuitBreaker()).toBeNull();
  });

  it('accessor returns the installed breaker and survives repeat reads', () => {
    const { breaker } = makeBreaker();
    setCircuitBreakerAccessor(() => breaker);
    try {
      expect(getCircuitBreaker()).toBe(breaker);
      expect(getCircuitBreaker()).toBe(breaker);
    } finally {
      setCircuitBreakerAccessor(null);
    }
  });

  it('recordCliElapsed via accessor fires cumulative_cli_ms once past 30 min', () => {
    const { breaker, fires } = makeBreaker();
    setCircuitBreakerAccessor(() => breaker);
    try {
      // Simulate the cli-process.ts wireCliElapsedRecorder hook path
      // without actually spawning a child: ten CLI runs totalling >30 min.
      for (let i = 0; i < 10; i += 1) {
        const b = getCircuitBreaker();
        if (b) b.recordCliElapsed(4 * 60 * 1000); // 4 min each
      }
      expect(fires).toHaveLength(1);
      expect(fires[0]!.reason).toBe('cumulative_cli_ms');
    } finally {
      setCircuitBreakerAccessor(null);
    }
  });
});

// ── queue_streak via QueueService.claimNext ───────────────────────────

describe('CircuitBreaker feed — QueueService.claimNext', () => {
  function makeRepoStub(items: QueueItem[]): QueueRepository {
    const state = { queue: [...items] };
    const stub = {
      transaction: <T>(fn: () => T): T => fn(),
      nextPending: () =>
        state.queue.find((q) => q.status === 'pending') ?? null,
      setStatus: vi.fn((id: string, status: QueueItem['status']) => {
        const row = state.queue.find((q) => q.id === id);
        if (row) row.status = status;
      }),
    } as unknown as QueueRepository;
    return stub;
  }

  function makeQueueItem(id: string): QueueItem {
    return {
      id,
      projectId: 'proj-1',
      targetChannelId: null,
      orderIndex: 1000,
      prompt: `p-${id}`,
      status: 'pending',
      startedMeetingId: null,
      startedAt: null,
      finishedAt: null,
      lastError: null,
      createdAt: Date.now(),
    };
  }

  it('records queue_start on each successful claim', () => {
    const { breaker, fires } = makeBreaker();
    const items = Array.from({ length: 6 }, (_, i) =>
      makeQueueItem(`item-${i}`),
    );
    const repo = makeRepoStub(items);
    const svc = new QueueService(repo, { circuitBreaker: breaker });

    // Default queue streak limit = 5; 5 successful claims → fires.
    for (let i = 0; i < 5; i += 1) {
      const claimed = svc.claimNext('proj-1');
      expect(claimed).not.toBeNull();
    }

    expect(fires).toHaveLength(1);
    expect(fires[0]!.reason).toBe('queue_streak');
    expect((fires[0]!.detail as { count: number }).count).toBe(5);
  });

  it('empty queue: claim returns null + breaker counter stays at 0', () => {
    const { breaker, fires } = makeBreaker();
    const repo = makeRepoStub([]);
    const svc = new QueueService(repo, { circuitBreaker: breaker });

    const claimed = svc.claimNext('proj-1');
    expect(claimed).toBeNull();
    expect(fires).toHaveLength(0);
    expect(breaker.getState().consecutiveQueueRuns).toBe(0);
  });

  it('no breaker DI: claim still returns the next item', () => {
    const repo = makeRepoStub([makeQueueItem('solo')]);
    const svc = new QueueService(repo);
    const claimed = svc.claimNext('proj-1');
    expect(claimed?.id).toBe('solo');
  });
});
