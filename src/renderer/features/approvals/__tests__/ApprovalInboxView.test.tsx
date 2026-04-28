// @vitest-environment jsdom

/**
 * ApprovalInboxView (R7-Task7) — #승인-대기 채널 단독 본문.
 *
 * pending list 렌더 + 빈 상태 i18n + decide 후 stream 이벤트 제거 경로.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── jsdom polyfills (Radix Dialog pointer-capture) ─────────────────
if (typeof globalThis.ResizeObserver === 'undefined') {
  (globalThis as { ResizeObserver: unknown }).ResizeObserver = class {
    observe(): void {
      /* noop */
    }
    unobserve(): void {
      /* noop */
    }
    disconnect(): void {
      /* noop */
    }
  };
}
if (typeof Element !== 'undefined') {
  const proto = Element.prototype as unknown as {
    hasPointerCapture?: (id: number) => boolean;
    releasePointerCapture?: (id: number) => void;
    setPointerCapture?: (id: number) => void;
    scrollIntoView?: () => void;
  };
  if (!proto.hasPointerCapture) proto.hasPointerCapture = () => false;
  if (!proto.releasePointerCapture) proto.releasePointerCapture = () => {};
  if (!proto.setPointerCapture) proto.setPointerCapture = () => {};
  if (!proto.scrollIntoView) proto.scrollIntoView = () => {};
}

import { ThemeProvider } from '../../../theme/theme-provider';
import {
  DEFAULT_MODE,
  DEFAULT_THEME,
  useThemeStore,
} from '../../../theme/theme-store';
import '../../../i18n';
import { i18next } from '../../../i18n';
import { ApprovalInboxView } from '../ApprovalInboxView';
import type { ApprovalItem } from '../../../../shared/approval-types';

const PROJECT_ID = 'p-1';

function makeItem(overrides: Partial<ApprovalItem> = {}): ApprovalItem {
  return {
    id: 'appr-1',
    kind: 'cli_permission',
    projectId: PROJECT_ID,
    channelId: 'c-plan',
    meetingId: 'm-1',
    requesterId: 'prov-a',
    payload: {
      kind: 'cli_permission',
      cliRequestId: 'cli-1',
      toolName: 'Bash',
      target: 'rm -rf build',
      description: '빌드 정리',
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

interface StreamHarness {
  invoke: ReturnType<typeof vi.fn>;
  onStream: ReturnType<typeof vi.fn>;
  trigger(type: string, payload: unknown): void;
}

function stubBridge(items: ApprovalItem[], invokeFallback?: (channel: string, data: unknown) => unknown): StreamHarness {
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const onStream = vi.fn((type: string, cb: (payload: unknown) => void) => {
    let bucket = listeners.get(type);
    if (!bucket) {
      bucket = new Set();
      listeners.set(type, bucket);
    }
    bucket.add(cb);
    return () => {
      bucket?.delete(cb);
    };
  });
  // F6-T1: the inbox now issues an `approval:count` IPC alongside the
  // existing `approval:list` so the tab badges can show real counters
  // instead of guessing from the active filter's items.length. The stub
  // splits the canonical fixture by `status` for both endpoints so the
  // assertions stay coherent across list + count.
  const invoke = vi.fn(async (channel: string, data: unknown) => {
    if (channel === 'approval:list') {
      const req = (data ?? {}) as { status?: string };
      const filtered =
        req.status === undefined
          ? items
          : items.filter((it) => it.status === req.status);
      return { items: filtered };
    }
    if (channel === 'approval:count') {
      const pending = items.filter((it) => it.status === 'pending').length;
      const approved = items.filter((it) => it.status === 'approved').length;
      const rejected = items.filter((it) => it.status === 'rejected').length;
      return {
        pending,
        approved,
        rejected,
        all: pending + approved + rejected,
      };
    }
    if (channel === 'approval:decide') {
      return { success: true };
    }
    if (invokeFallback) return invokeFallback(channel, data);
    throw new Error(`no mock for channel ${channel}`);
  });
  vi.stubGlobal('arena', { platform: 'linux', invoke, onStream });
  return {
    invoke,
    onStream,
    trigger(type, payload) {
      listeners.get(type)?.forEach((cb) => cb(payload));
    },
  };
}

function renderInbox(projectId = PROJECT_ID): ReturnType<typeof render> {
  return render(
    <ThemeProvider>
      <ApprovalInboxView projectId={projectId} />
    </ThemeProvider>,
  );
}

beforeEach(() => {
  vi.unstubAllGlobals();
  useThemeStore.setState({ themeKey: DEFAULT_THEME, mode: DEFAULT_MODE });
  void i18next.changeLanguage('ko');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ApprovalInboxView — list rendering', () => {
  it('renders pending rows with ApprovalBlock and meta.approvalRef wired', async () => {
    stubBridge([makeItem(), makeItem({ id: 'appr-2', createdAt: 1_700_000_001_000 })]);
    renderInbox();

    await waitFor(() => {
      expect(screen.getByTestId('approval-inbox-list')).toBeTruthy();
    });
    const rows = screen.getAllByTestId('approval-inbox-row');
    expect(rows.length).toBe(2);
    expect(rows[0].getAttribute('data-approval-id')).toBe('appr-1');
    expect(rows[1].getAttribute('data-approval-id')).toBe('appr-2');

    // ApprovalBlock reads approvalRef from message.meta → data-approval-id.
    const blocks = screen.getAllByTestId('approval-block');
    expect(blocks[0].getAttribute('data-approval-id')).toBe('appr-1');
  });

  it('filters approval:list by projectId', async () => {
    const h = stubBridge([makeItem()]);
    renderInbox();
    await waitFor(() => expect(h.invoke).toHaveBeenCalledWith(
      'approval:list',
      { status: 'pending', projectId: PROJECT_ID },
    ));
  });

  it('renders cli_permission summary with participant + tool + description', async () => {
    stubBridge([makeItem()]);
    renderInbox();
    await waitFor(() => {
      expect(screen.getByTestId('approval-inbox-list')).toBeTruthy();
    });
    const body = screen.getByTestId('approval-block-body');
    expect(body.textContent).toContain('Alpha');
    expect(body.textContent).toContain('Bash');
    expect(body.textContent).toContain('rm -rf build');
    expect(body.textContent).toContain('빌드 정리');
  });
});

describe('ApprovalInboxView — empty + error states (i18n)', () => {
  it('empty state uses i18n key messenger.approval.inbox.empty', async () => {
    stubBridge([]);
    renderInbox();
    await waitFor(() => {
      expect(screen.getByTestId('approval-inbox-empty')).toBeTruthy();
    });
    expect(screen.getByTestId('approval-inbox-empty').textContent).toBe(
      '대기 중인 승인 요청이 없습니다.',
    );
  });

  it('error state surfaces i18n fallback when the Error has no message', async () => {
    const failure = new Error('');
    const invoke = vi.fn().mockRejectedValue(failure);
    vi.stubGlobal('arena', { platform: 'linux', invoke });

    renderInbox();
    await waitFor(() => {
      expect(screen.getByTestId('approval-inbox-error')).toBeTruthy();
    });
    expect(screen.getByTestId('approval-inbox-error').textContent).toBe(
      '승인 목록을 불러오지 못했습니다.',
    );
  });
});

describe('ApprovalInboxView — live stream merge', () => {
  it('stream:approval-decided removes the row from the list', async () => {
    const h = stubBridge([makeItem(), makeItem({ id: 'appr-2' })]);
    renderInbox();

    await waitFor(() => {
      expect(screen.getAllByTestId('approval-inbox-row').length).toBe(2);
    });

    act(() => {
      h.trigger('stream:approval-decided', {
        item: { ...makeItem(), status: 'approved', decidedAt: Date.now() },
        decision: 'approve',
        comment: null,
      });
    });

    await waitFor(() => {
      const rows = screen.queryAllByTestId('approval-inbox-row');
      expect(rows.length).toBe(1);
      expect(rows[0].getAttribute('data-approval-id')).toBe('appr-2');
    });
  });

  it('stream:approval-created for another project is ignored', async () => {
    const h = stubBridge([]);
    renderInbox();

    await waitFor(() => {
      expect(screen.getByTestId('approval-inbox-empty')).toBeTruthy();
    });

    act(() => {
      h.trigger('stream:approval-created', {
        item: makeItem({ id: 'appr-other', projectId: 'p-other' }),
      });
    });

    // No new row; still empty.
    expect(screen.queryAllByTestId('approval-inbox-row').length).toBe(0);
  });

  it('stream:approval-created for this project prepends the row', async () => {
    const h = stubBridge([]);
    renderInbox();
    await waitFor(() => {
      expect(screen.getByTestId('approval-inbox-empty')).toBeTruthy();
    });

    act(() => {
      h.trigger('stream:approval-created', {
        item: makeItem({ id: 'appr-live' }),
      });
    });

    await waitFor(() => {
      const rows = screen.queryAllByTestId('approval-inbox-row');
      expect(rows.length).toBe(1);
      expect(rows[0].getAttribute('data-approval-id')).toBe('appr-live');
    });
  });
});

describe('ApprovalInboxView — approve click invokes approval:decide', () => {
  it('clicking approve on a row issues the decide IPC with the correct id', async () => {
    const h = stubBridge([makeItem()]);
    renderInbox();
    await waitFor(() => {
      expect(screen.getByTestId('approval-inbox-list')).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId('approval-block-allow'));
    await waitFor(() => {
      expect(h.invoke).toHaveBeenCalledWith('approval:decide', {
        id: 'appr-1',
        decision: 'approve',
      });
    });
  });
});

describe('ApprovalInboxView — filter bar (Set 1 polish)', () => {
  it('renders the 4-tab filter bar with pending active by default', async () => {
    stubBridge([makeItem(), makeItem({ id: 'appr-2' })]);
    renderInbox();
    await waitFor(() => {
      expect(screen.getByTestId('approval-filter-bar')).toBeTruthy();
    });
    const tabs = screen.getAllByTestId('approval-filter-tab');
    expect(tabs.map((t) => t.getAttribute('data-filter'))).toEqual([
      'pending',
      'approved',
      'rejected',
      'all',
    ]);
    expect(tabs[0].getAttribute('data-active')).toBe('true');
  });

  it('F6-T1: tab counters reflect the approval:count IPC, including inactive tabs', async () => {
    // Mixed-status fixture so the count IPC has a non-trivial answer
    // for every bucket — the inbox should show all four numbers, not
    // just the active filter's `items.length`.
    stubBridge([
      makeItem({ id: 'appr-1', status: 'pending' }),
      makeItem({ id: 'appr-2', status: 'pending' }),
      makeItem({ id: 'appr-3', status: 'approved' }),
      makeItem({ id: 'appr-4', status: 'rejected' }),
      makeItem({ id: 'appr-5', status: 'rejected' }),
    ]);
    renderInbox();
    await waitFor(() => {
      expect(screen.getByTestId('approval-filter-bar')).toBeTruthy();
    });
    await waitFor(() => {
      const counts = screen.getAllByTestId('approval-filter-count');
      expect(counts[0].textContent).toBe('2'); // pending
      expect(counts[1].textContent).toBe('1'); // approved
      expect(counts[2].textContent).toBe('2'); // rejected
      expect(counts[3].textContent).toBe('5'); // all = sum of three
    });
  });

  it('R11-Task7: switching to the approved tab refetches with status=approved', async () => {
    // Mock filters items by the request's status so the approved tab
    // receives an empty result and renders the empty state.
    const allItems = [makeItem({ id: 'appr-1', status: 'pending' })];
    const listeners = new Map<string, Set<(p: unknown) => void>>();
    const onStream = vi.fn((type: string, cb: (p: unknown) => void) => {
      let bucket = listeners.get(type);
      if (!bucket) {
        bucket = new Set();
        listeners.set(type, bucket);
      }
      bucket.add(cb);
      return () => {
        bucket?.delete(cb);
      };
    });
    const invoke = vi.fn(async (channel: string, data: unknown) => {
      if (channel === 'approval:list') {
        const req = data as { status?: string };
        const filtered =
          req.status === undefined
            ? allItems
            : allItems.filter((it) => it.status === req.status);
        return { items: filtered };
      }
      if (channel === 'approval:count') {
        return { pending: 1, approved: 0, rejected: 0, all: 1 };
      }
      throw new Error(`no mock for ${channel}`);
    });
    vi.stubGlobal('arena', { platform: 'linux', invoke, onStream });

    renderInbox();
    await waitFor(() => {
      expect(screen.getByTestId('approval-inbox-list')).toBeTruthy();
    });
    fireEvent.click(screen.getAllByTestId('approval-filter-tab')[1]);
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('approval:list', {
        status: 'approved',
        projectId: PROJECT_ID,
      });
    });
    await waitFor(() => {
      expect(screen.getByTestId('approval-inbox-empty')).toBeTruthy();
    });
  });

  it('R11-Task7: row badge reflects each row\'s persisted status', async () => {
    stubBridge([
      makeItem({ id: 'appr-pending', status: 'pending' }),
      makeItem({ id: 'appr-approved', status: 'approved' }),
    ]);
    renderInbox();
    // Default tab is 'pending' which only surfaces pending rows; click
    // the 'all' tab so both statuses materialise and the badge mapping
    // can be verified across decisions.
    await waitFor(() => {
      expect(screen.getByTestId('approval-filter-bar')).toBeTruthy();
    });
    fireEvent.click(screen.getAllByTestId('approval-filter-tab')[3]);
    await waitFor(() => {
      expect(screen.getAllByTestId('approval-inbox-row').length).toBe(2);
    });
    const rows = screen.getAllByTestId('approval-inbox-row');
    const badges = rows
      .map((row) => row.querySelector('[data-testid="approval-status-badge"]'))
      .filter((b): b is HTMLElement => b !== null);
    expect(badges.length).toBe(2);
    const decisions = badges.map((b) => b.getAttribute('data-decision'));
    expect(decisions).toContain('pending');
    expect(decisions).toContain('approved');
  });
});

describe('ApprovalInboxView — R11-Task7 split layout', () => {
  it('renders a detail pane alongside the list', async () => {
    stubBridge([makeItem()]);
    renderInbox();
    await waitFor(() => {
      expect(screen.getByTestId('approval-inbox-list-pane')).toBeTruthy();
      expect(screen.getByTestId('approval-inbox-detail-pane')).toBeTruthy();
    });
    // Empty selection initially — detail panel shows the zero-state.
    expect(screen.getByTestId('approval-detail-panel')).toBeTruthy();
    expect(screen.getByTestId('apv-detail-empty')).toBeTruthy();
  });

  it('clicking a row sets selection and triggers detail-fetch', async () => {
    const detail = {
      detail: {
        approval: makeItem(),
        impactedFiles: [],
        diffPreviews: [],
        consensusContext: null,
      },
    };
    const listeners = new Map<string, Set<(p: unknown) => void>>();
    const onStream = vi.fn((type: string, cb: (p: unknown) => void) => {
      let bucket = listeners.get(type);
      if (!bucket) {
        bucket = new Set();
        listeners.set(type, bucket);
      }
      bucket.add(cb);
      return () => {
        bucket?.delete(cb);
      };
    });
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'approval:list') return { items: [makeItem()] };
      if (channel === 'approval:detail-fetch') return detail;
      if (channel === 'approval:count') {
        return { pending: 1, approved: 0, rejected: 0, all: 1 };
      }
      throw new Error(`no mock for ${channel}`);
    });
    vi.stubGlobal('arena', { platform: 'linux', invoke, onStream });

    renderInbox();
    await waitFor(() => {
      expect(screen.getByTestId('approval-inbox-row')).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId('approval-inbox-row'));
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('approval:detail-fetch', {
        approvalId: 'appr-1',
      });
    });
    await waitFor(() => {
      expect(screen.getByTestId('apv-detail-cards')).toBeTruthy();
    });
  });
});

describe('ApprovalInboxView — source-level hex color literal guard', () => {
  it('ApprovalInboxView.tsx contains zero hex color literals', () => {
    const source = readFileSync(
      resolve(__dirname, '..', 'ApprovalInboxView.tsx'),
      'utf-8',
    );
    expect(source.match(/#[0-9a-fA-F]{3,6}\b/g)).toBeNull();
  });
});
