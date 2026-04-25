/**
 * Unit tests for ApprovalSystemMessageInjector (R7-Task6).
 *
 * Coverage:
 *   - reject + non-empty comment + meetingId + channelId → append 호출
 *   - conditional + non-empty comment + meetingId + channelId → append 호출
 *   - approve → skip
 *   - reject + null comment → skip
 *   - reject + whitespace-only comment → skip
 *   - reject + meetingId=null → skip
 *   - reject + channelId=null → skip
 *   - append throws → swallowed (no rethrow, warn only)
 *   - wire() disposer removes listener
 *
 * Tests use a fake ApprovalService (EventEmitter) + spy MessageService so
 * no DB / migration is required.
 */

import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ApprovalItem } from '../../../shared/approval-types';
import { APPROVAL_DECIDED_EVENT } from '../approval-service';
import type { ApprovalDecidedPayload } from '../approval-service';
import {
  ApprovalSystemMessageInjector,
  type ApprovalSystemMessageSink,
} from '../approval-system-message-injector';

function makeItem(overrides: Partial<ApprovalItem> = {}): ApprovalItem {
  return {
    id: 'appr-1',
    kind: 'cli_permission',
    projectId: 'p-1',
    channelId: 'c-plan',
    meetingId: 'm-1',
    requesterId: 'prov-a',
    payload: null,
    status: 'approved',
    decisionComment: '보안 우려',
    createdAt: 1_700_000_000_000,
    decidedAt: 1_700_000_001_000,
    ...overrides,
  };
}

interface Harness {
  approvalService: EventEmitter;
  messageService: ApprovalSystemMessageSink;
  appendSpy: ReturnType<typeof vi.fn>;
  injector: ApprovalSystemMessageInjector;
  dispose: () => void;
  emitDecided(payload: ApprovalDecidedPayload): void;
}

function makeHarness(
  options: { appendThrows?: Error } = {},
): Harness {
  const approvalService = new EventEmitter();
  const appendSpy = vi.fn((input: Parameters<ApprovalSystemMessageSink['append']>[0]) => {
    if (options.appendThrows) throw options.appendThrows;
    return {
      id: 'msg-new',
      channelId: input.channelId,
      meetingId: input.meetingId ?? null,
      authorId: input.authorId,
      authorKind: input.authorKind,
      role: input.role,
      content: input.content,
      meta: input.meta ?? null,
      createdAt: Date.now(),
    };
  });
  const messageService: ApprovalSystemMessageSink = {
    append: appendSpy as unknown as ApprovalSystemMessageSink['append'],
  };
  const injector = new ApprovalSystemMessageInjector({
    approvalService,
    messageService,
  });
  const dispose = injector.wire();
  return {
    approvalService,
    messageService,
    appendSpy,
    injector,
    dispose,
    emitDecided(payload) {
      approvalService.emit(APPROVAL_DECIDED_EVENT, payload);
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

describe('ApprovalSystemMessageInjector — happy paths', () => {
  it('reject + comment + meetingId + channelId → append with system kind', () => {
    const h = makeHarness();
    h.emitDecided({
      item: makeItem(),
      decision: 'reject',
      comment: '이건 건드리지마',
    });
    expect(h.appendSpy).toHaveBeenCalledTimes(1);
    const call = h.appendSpy.mock.calls[0][0];
    expect(call.channelId).toBe('c-plan');
    expect(call.meetingId).toBe('m-1');
    expect(call.authorId).toBe('system');
    expect(call.authorKind).toBe('system');
    expect(call.role).toBe('system');
    expect(call.content).toContain('[승인 거절]');
    expect(call.content).toContain('이건 건드리지마');
    expect(call.meta).toEqual({ approvalRef: 'appr-1' });
    h.dispose();
  });

  it('conditional + comment → append with conditional label', () => {
    const h = makeHarness();
    h.emitDecided({
      item: makeItem({ id: 'appr-c' }),
      decision: 'conditional',
      comment: '읽기만 허용',
    });
    expect(h.appendSpy).toHaveBeenCalledTimes(1);
    const call = h.appendSpy.mock.calls[0][0];
    expect(call.content).toContain('[조건부 승인]');
    expect(call.content).toContain('읽기만 허용');
    expect(call.meta).toEqual({ approvalRef: 'appr-c' });
    h.dispose();
  });

  it('trims comment whitespace before formatting', () => {
    const h = makeHarness();
    h.emitDecided({
      item: makeItem(),
      decision: 'reject',
      comment: '  공백 있는 사유  ',
    });
    expect(h.appendSpy).toHaveBeenCalledTimes(1);
    expect(h.appendSpy.mock.calls[0][0].content).toBe(
      '[승인 거절] 공백 있는 사유',
    );
    h.dispose();
  });
});

describe('ApprovalSystemMessageInjector — skip paths', () => {
  it('approve → no append', () => {
    const h = makeHarness();
    h.emitDecided({
      item: makeItem(),
      decision: 'approve',
      comment: '허락한다',
    });
    expect(h.appendSpy).not.toHaveBeenCalled();
    h.dispose();
  });

  it('null comment → no append', () => {
    const h = makeHarness();
    h.emitDecided({
      item: makeItem(),
      decision: 'reject',
      comment: null,
    });
    expect(h.appendSpy).not.toHaveBeenCalled();
    h.dispose();
  });

  it('whitespace-only comment → no append', () => {
    const h = makeHarness();
    h.emitDecided({
      item: makeItem(),
      decision: 'conditional',
      comment: '   \n  ',
    });
    expect(h.appendSpy).not.toHaveBeenCalled();
    h.dispose();
  });

  it('meetingId=null → no append', () => {
    const h = makeHarness();
    h.emitDecided({
      item: makeItem({ meetingId: null }),
      decision: 'reject',
      comment: '사유',
    });
    expect(h.appendSpy).not.toHaveBeenCalled();
    h.dispose();
  });

  it('channelId=null → no append', () => {
    const h = makeHarness();
    h.emitDecided({
      item: makeItem({ channelId: null }),
      decision: 'reject',
      comment: '사유',
    });
    expect(h.appendSpy).not.toHaveBeenCalled();
    h.dispose();
  });

  // ── R11-Task10: mode_transition 은 Router/advisory slot 으로 라우팅 ──

  it('R11-Task10: mode_transition + comment + null channel/meeting → no append (Router 가 advisory 로 라우팅)', () => {
    const h = makeHarness();
    h.emitDecided({
      item: makeItem({
        kind: 'mode_transition',
        channelId: null,
        meetingId: null,
      }),
      decision: 'conditional',
      comment: '읽기만 허용',
    });
    expect(h.appendSpy).not.toHaveBeenCalled();
    h.dispose();
  });

  it('R11-Task10: mode_transition + 가상의 channel/meeting 이 살아있어도 skip (kind 자체가 advisory 경로)', () => {
    // 방어적 케이스 — repository 가 실수로 mode_transition 에 channel/meeting
    // 을 채워 보내도 Router/advisory 경로가 정답이므로 Injector 는 침묵해야
    // 한다. 이중 주입(Router 의 advisory + Injector 의 system message) 방지.
    const h = makeHarness();
    h.emitDecided({
      item: makeItem({
        kind: 'mode_transition',
        channelId: 'c-stray',
        meetingId: 'm-stray',
      }),
      decision: 'conditional',
      comment: '동시 라우팅 방지',
    });
    expect(h.appendSpy).not.toHaveBeenCalled();
    h.dispose();
  });
});

describe('ApprovalSystemMessageInjector — failure isolation', () => {
  it('messageService.append throws → swallowed + warn logged', () => {
    const h = makeHarness({ appendThrows: new Error('trigger abort') });
    expect(() =>
      h.emitDecided({
        item: makeItem(),
        decision: 'reject',
        comment: '사유',
      }),
    ).not.toThrow();
    expect(warnSpy).toHaveBeenCalled();
    const logCall = warnSpy.mock.calls[0];
    expect(String(logCall[0])).toContain(
      '[rolestra.approvals.injector] messages.append failed',
    );
    h.dispose();
  });
});

describe('ApprovalSystemMessageInjector — lifecycle', () => {
  it('wire() disposer removes listener (no append after dispose)', () => {
    const h = makeHarness();
    h.dispose();
    h.emitDecided({
      item: makeItem(),
      decision: 'reject',
      comment: '사유',
    });
    expect(h.appendSpy).not.toHaveBeenCalled();
    expect(h.approvalService.listenerCount(APPROVAL_DECIDED_EVENT)).toBe(0);
  });

  it('wire() called twice attaches only once', () => {
    const h = makeHarness();
    h.injector.wire(); // idempotent
    expect(h.approvalService.listenerCount(APPROVAL_DECIDED_EVENT)).toBe(1);
    h.dispose();
    expect(h.approvalService.listenerCount(APPROVAL_DECIDED_EVENT)).toBe(0);
  });
});
