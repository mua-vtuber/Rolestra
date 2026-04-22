/**
 * R7-Task3 — ApprovalCliAdapter unit tests.
 *
 * Uses a real ApprovalService + in-memory ApprovalRepository stub so the
 * 'decided' EventEmitter bridge is exercised end-to-end. A lightweight
 * repository stub (Map-backed) keeps the test hermetic — we do not need
 * the SQLite migration chain just to drive the approval lifecycle.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApprovalCliAdapter } from '../approval-cli-adapter';
import {
  APPROVAL_DECIDED_EVENT,
  ApprovalService,
} from '../approval-service';
import type { ApprovalRepository } from '../approval-repository';
import type { ApprovalItem, ApprovalStatus } from '../../../shared/approval-types';
import type { ParsedCliPermissionRequest } from '../../providers/cli/cli-permission-parser';

/** Minimal `ApprovalRepository` stand-in sufficient for service calls used
 *  by the adapter (`insert`, `get`, `updateStatus`). Matches the real
 *  repository's behaviour: idempotent inserts, status transitions on
 *  decide/expire/supersede.
 */
function makeRepoStub(): ApprovalRepository {
  const rows = new Map<string, ApprovalItem>();
  return {
    insert(item: ApprovalItem): void {
      rows.set(item.id, item);
    },
    get(id: string): ApprovalItem | null {
      return rows.get(id) ?? null;
    },
    updateStatus(
      id: string,
      status: ApprovalStatus,
      comment: string | null,
      decidedAt: number,
    ): boolean {
      const row = rows.get(id);
      if (!row) return false;
      rows.set(id, {
        ...row,
        status,
        decisionComment: comment,
        decidedAt,
      });
      return true;
    },
    list(filter: { status?: ApprovalStatus; projectId?: string } = {}) {
      let arr = Array.from(rows.values());
      if (filter.status) arr = arr.filter((r) => r.status === filter.status);
      if (filter.projectId) arr = arr.filter((r) => r.projectId === filter.projectId);
      return arr.sort((a, b) => b.createdAt - a.createdAt);
    },
  } as unknown as ApprovalRepository;
}

const BASE_REQUEST: ParsedCliPermissionRequest = {
  cliRequestId: 'cli-req-1',
  toolName: 'Edit',
  target: 'src/index.ts',
  description: 'touch up imports',
  rawLine: '{"type":"permission_request"}',
};

function makeCtx(overrides: Partial<{ timeoutMs: number; request: ParsedCliPermissionRequest }> = {}) {
  return {
    meetingId: 'mtg-1',
    channelId: 'ch-1',
    projectId: 'prj-1',
    participantId: 'provider-claude',
    participantName: 'Claude',
    request: overrides.request ?? BASE_REQUEST,
    ...(overrides.timeoutMs !== undefined ? { timeoutMs: overrides.timeoutMs } : {}),
  };
}

describe('ApprovalCliAdapter', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates a cli_permission approval with the full payload', () => {
    const svc = new ApprovalService(makeRepoStub());
    const adapter = new ApprovalCliAdapter(svc);
    const ctx = makeCtx();
    adapter.createCliPermissionApproval(ctx);

    const [item] = svc.list({ status: 'pending' });
    expect(item).toBeDefined();
    expect(item.kind).toBe('cli_permission');
    expect(item.meetingId).toBe('mtg-1');
    expect(item.channelId).toBe('ch-1');
    expect(item.projectId).toBe('prj-1');
    expect(item.requesterId).toBe('provider-claude');
    expect(item.payload).toEqual({
      kind: 'cli_permission',
      cliRequestId: 'cli-req-1',
      toolName: 'Edit',
      target: 'src/index.ts',
      description: 'touch up imports',
      participantId: 'provider-claude',
      participantName: 'Claude',
    });
  });

  it('resolves true when the user approves', async () => {
    const svc = new ApprovalService(makeRepoStub());
    const adapter = new ApprovalCliAdapter(svc);
    const promise = adapter.createCliPermissionApproval(makeCtx());

    const [item] = svc.list({ status: 'pending' });
    svc.decide(item.id, 'approve');

    await expect(promise).resolves.toBe(true);
  });

  it('resolves true when the user chooses conditional (comment delivered elsewhere)', async () => {
    const svc = new ApprovalService(makeRepoStub());
    const adapter = new ApprovalCliAdapter(svc);
    const promise = adapter.createCliPermissionApproval(makeCtx());

    const [item] = svc.list({ status: 'pending' });
    svc.decide(item.id, 'conditional', 'only touch imports');

    await expect(promise).resolves.toBe(true);
  });

  it('resolves false when the user rejects', async () => {
    const svc = new ApprovalService(makeRepoStub());
    const adapter = new ApprovalCliAdapter(svc);
    const promise = adapter.createCliPermissionApproval(makeCtx());

    const [item] = svc.list({ status: 'pending' });
    svc.decide(item.id, 'reject', 'do not run shell');

    await expect(promise).resolves.toBe(false);
  });

  it('ignores decided events for unrelated approval ids (parallel CLI prompts)', async () => {
    const svc = new ApprovalService(makeRepoStub());
    const adapter = new ApprovalCliAdapter(svc);

    // Two concurrent prompts.
    const pA = adapter.createCliPermissionApproval(makeCtx());
    const pB = adapter.createCliPermissionApproval(
      makeCtx({ request: { ...BASE_REQUEST, cliRequestId: 'cli-req-2' } }),
    );

    const pending = svc.list({ status: 'pending' });
    expect(pending).toHaveLength(2);

    // Decide only the second — the first must still be pending.
    svc.decide(pending[0].id, 'reject');
    const ordered = svc.list({ status: 'pending' });
    expect(ordered).toHaveLength(1);

    // Finish the other one so the harness doesn't leave a dangling promise.
    svc.decide(ordered[0].id, 'approve');

    // Either pA or pB finished first — just assert both resolved.
    await expect(Promise.all([pA, pB])).resolves.toEqual(
      expect.arrayContaining([true, false]),
    );
  });

  it('resolves false and expires the row when the timeout fires', async () => {
    vi.useFakeTimers();
    const svc = new ApprovalService(makeRepoStub());
    const adapter = new ApprovalCliAdapter(svc);
    const promise = adapter.createCliPermissionApproval(
      makeCtx({ timeoutMs: 1000 }),
    );

    // Advance past the timeout. Assert both the boolean resolution and
    // the row transition to `expired` (audit trail stays intact).
    await vi.advanceTimersByTimeAsync(1000);
    await expect(promise).resolves.toBe(false);

    const expired = svc.list({});
    expect(expired).toHaveLength(1);
    expect(expired[0].status).toBe('expired');
  });

  it('removes the decided listener after every resolution (no leak)', async () => {
    const svc = new ApprovalService(makeRepoStub());
    const adapter = new ApprovalCliAdapter(svc);
    const before = svc.listenerCount(APPROVAL_DECIDED_EVENT);

    const promise = adapter.createCliPermissionApproval(makeCtx());
    expect(svc.listenerCount(APPROVAL_DECIDED_EVENT)).toBe(before + 1);

    const [item] = svc.list({ status: 'pending' });
    svc.decide(item.id, 'approve');
    await promise;

    expect(svc.listenerCount(APPROVAL_DECIDED_EVENT)).toBe(before);
  });

  it('still resolves via decide if timeout has not fired yet (race)', async () => {
    vi.useFakeTimers();
    const svc = new ApprovalService(makeRepoStub());
    const adapter = new ApprovalCliAdapter(svc);
    const promise = adapter.createCliPermissionApproval(
      makeCtx({ timeoutMs: 10_000 }),
    );

    await vi.advanceTimersByTimeAsync(500);
    const [item] = svc.list({ status: 'pending' });
    svc.decide(item.id, 'approve');
    await expect(promise).resolves.toBe(true);

    // Advance past the original timeout to prove the timer no-ops after
    // the listener is removed (a second settleOnce would throw if it
    // weren't idempotent).
    await vi.advanceTimersByTimeAsync(20_000);

    // Row stays approved — the expire path is not taken.
    const row = svc.get(item.id);
    expect(row?.status).toBe('approved');
  });

  it('defaults description to null when the parser omitted it', () => {
    const svc = new ApprovalService(makeRepoStub());
    const adapter = new ApprovalCliAdapter(svc);
    const req: ParsedCliPermissionRequest = {
      cliRequestId: 'cli-req-3',
      toolName: 'Bash',
      target: 'git status',
      rawLine: '{"type":"permission_request","cmd":"git"}',
    };
    adapter.createCliPermissionApproval(makeCtx({ request: req }));

    const [item] = svc.list({ status: 'pending' });
    const payload = item.payload as { description: unknown };
    expect(payload.description).toBeNull();
  });

  it('swallows expire() errors if the row was already decided at timeout fire', async () => {
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const svc = new ApprovalService(makeRepoStub());
    // Break `expire` to simulate a decided-before-timeout race on the DB
    // side (repository would throw if the id is missing). This proves the
    // adapter does not bubble the error up past the Promise.
    const originalExpire = svc.expire.bind(svc);
    svc.expire = (id: string): void => {
      originalExpire(id);
      throw new Error('simulated race');
    };

    const adapter = new ApprovalCliAdapter(svc);
    const promise = adapter.createCliPermissionApproval(
      makeCtx({ timeoutMs: 50 }),
    );
    await vi.advanceTimersByTimeAsync(50);
    await expect(promise).resolves.toBe(false);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
