/**
 * Unit tests for ApprovalNotificationBridge (R7-Task11).
 *
 * Coverage:
 *   - 'created' → notificationService.show(kind='approval_pending')
 *   - show() returning null (gated by prefs or focus) is a no-op — the
 *     bridge never asserts delivery.
 *   - title / body per approval kind (cli_permission / mode_transition /
 *     consensus_decision) use the Korean fixed labels.
 *   - dedupe: repeat emit of the same id within the window fires show once.
 *   - dedupe expiry: outside the window the same id fires show again.
 *   - notificationService.show throws → swallowed with warn.
 *   - wire() disposer removes the listener.
 */

import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ApprovalItem } from '../../../shared/approval-types';
import { APPROVAL_CREATED_EVENT } from '../approval-service';
import {
  ApprovalNotificationBridge,
  type ApprovalNotificationSink,
} from '../approval-notification-bridge';

function makeItem(overrides: Partial<ApprovalItem> = {}): ApprovalItem {
  return {
    id: 'appr-1',
    kind: 'cli_permission',
    projectId: 'p-1',
    channelId: 'c-1',
    meetingId: 'm-1',
    requesterId: 'prov-a',
    payload: {
      kind: 'cli_permission',
      cliRequestId: 'cli-1',
      toolName: 'Bash',
      target: 'rm build',
      description: 'Clean',
      participantId: 'prov-a',
      participantName: 'Alpha',
    },
    status: 'pending',
    decisionComment: null,
    createdAt: 1_700_000_000_000,
    decidedAt: null,
    ...overrides,
  };
}

interface Harness {
  approvalService: EventEmitter;
  sink: ApprovalNotificationSink;
  showSpy: ReturnType<typeof vi.fn>;
  now: { value: number };
  bridge: ApprovalNotificationBridge;
  dispose: () => void;
  emitCreated(item: ApprovalItem): void;
}

function makeHarness(
  options: {
    showReturns?: unknown;
    showThrows?: Error;
    dedupeWindowMs?: number;
  } = {},
): Harness {
  const approvalService = new EventEmitter();
  const showSpy = vi.fn(() => {
    if (options.showThrows) throw options.showThrows;
    return options.showReturns ?? null;
  });
  const sink: ApprovalNotificationSink = { show: showSpy as unknown as ApprovalNotificationSink['show'] };
  const now = { value: 1_700_000_000_000 };
  const bridge = new ApprovalNotificationBridge({
    approvalService,
    notificationService: sink,
    dedupeWindowMs: options.dedupeWindowMs,
    now: () => now.value,
  });
  const dispose = bridge.wire();
  return {
    approvalService,
    sink,
    showSpy,
    now,
    bridge,
    dispose,
    emitCreated(item) {
      approvalService.emit(APPROVAL_CREATED_EVENT, item);
    },
  };
}

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  warnSpy.mockRestore();
});

describe('ApprovalNotificationBridge — created → show', () => {
  it('cli_permission → notificationService.show with proper title/body', () => {
    const h = makeHarness();
    h.emitCreated(makeItem());
    expect(h.showSpy).toHaveBeenCalledTimes(1);
    const arg = h.showSpy.mock.calls[0][0];
    expect(arg.kind).toBe('approval_pending');
    expect(arg.title).toBe('CLI 권한 요청');
    expect(arg.body).toContain('Alpha');
    expect(arg.body).toContain('Bash');
    expect(arg.body).toContain('rm build');
    expect(arg.channelId).toBe('c-1');
    h.dispose();
  });

  it('mode_transition → title + "current → target" body', () => {
    const h = makeHarness();
    h.emitCreated(
      makeItem({
        kind: 'mode_transition',
        channelId: null,
        meetingId: null,
        payload: {
          kind: 'mode_transition',
          currentMode: 'hybrid',
          targetMode: 'approval',
        },
      }),
    );
    expect(h.showSpy).toHaveBeenCalledTimes(1);
    const arg = h.showSpy.mock.calls[0][0];
    expect(arg.title).toBe('권한 모드 변경 요청');
    expect(arg.body).toBe('hybrid → approval');
    expect(arg.channelId).toBeNull();
    h.dispose();
  });

  it('consensus_decision → title + truncated finalText body', () => {
    const h = makeHarness();
    const long = 'a'.repeat(120);
    h.emitCreated(
      makeItem({
        kind: 'consensus_decision',
        payload: {
          kind: 'consensus_decision',
          snapshotHash: 'x',
          finalText: long,
          votes: { yes: 1, no: 0, pending: 0 },
        },
      }),
    );
    const arg = h.showSpy.mock.calls[0][0];
    expect(arg.title).toBe('합의 결과 승인 요청');
    expect(arg.body.endsWith('…')).toBe(true);
    expect(arg.body.length).toBeLessThanOrEqual(81);
    h.dispose();
  });
});

describe('ApprovalNotificationBridge — dedupe', () => {
  it('repeat emit within window → show called once', () => {
    const h = makeHarness({ dedupeWindowMs: 1000 });
    h.emitCreated(makeItem());
    h.emitCreated(makeItem()); // same id
    expect(h.showSpy).toHaveBeenCalledTimes(1);
    h.dispose();
  });

  it('emit outside window → show called again', () => {
    const h = makeHarness({ dedupeWindowMs: 1000 });
    h.emitCreated(makeItem());
    h.now.value += 2000; // advance past window
    h.emitCreated(makeItem());
    expect(h.showSpy).toHaveBeenCalledTimes(2);
    h.dispose();
  });

  it('different ids → show called for each', () => {
    const h = makeHarness({ dedupeWindowMs: 1000 });
    h.emitCreated(makeItem({ id: 'appr-a' }));
    h.emitCreated(makeItem({ id: 'appr-b' }));
    expect(h.showSpy).toHaveBeenCalledTimes(2);
    h.dispose();
  });
});

describe('ApprovalNotificationBridge — failure isolation', () => {
  it('notificationService.show throws → warn logged, no rethrow', () => {
    const h = makeHarness({ showThrows: new Error('adapter down') });
    expect(() => h.emitCreated(makeItem())).not.toThrow();
    expect(warnSpy).toHaveBeenCalled();
    expect(String(warnSpy.mock.calls[0][0])).toContain(
      '[rolestra.approvals.notification-bridge]',
    );
    h.dispose();
  });
});

describe('ApprovalNotificationBridge — lifecycle', () => {
  it('wire() disposer removes listener', () => {
    const h = makeHarness();
    h.dispose();
    h.emitCreated(makeItem());
    expect(h.showSpy).not.toHaveBeenCalled();
    expect(
      (h.approvalService as EventEmitter).listenerCount(APPROVAL_CREATED_EVENT),
    ).toBe(0);
  });

  it('wire() called twice attaches only once', () => {
    const h = makeHarness();
    h.bridge.wire(); // idempotent
    expect(
      (h.approvalService as EventEmitter).listenerCount(APPROVAL_CREATED_EVENT),
    ).toBe(1);
    h.dispose();
  });
});
