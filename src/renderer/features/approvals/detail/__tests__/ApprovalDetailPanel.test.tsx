// @vitest-environment jsdom

import {
  cleanup,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ThemeProvider } from '../../../../theme/theme-provider';
import {
  DEFAULT_MODE,
  DEFAULT_THEME,
  useThemeStore,
} from '../../../../theme/theme-store';
import '../../../../i18n';
import { ApprovalDetailPanel } from '../ApprovalDetailPanel';
import type { ApprovalDetail } from '../../../../../shared/approval-detail-types';
import type { ApprovalItem } from '../../../../../shared/approval-types';

if (typeof globalThis.ResizeObserver === 'undefined') {
  (globalThis as { ResizeObserver: unknown }).ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
}

function makeItem(overrides: Partial<ApprovalItem> = {}): ApprovalItem {
  return {
    id: 'app-1',
    kind: 'cli_permission',
    projectId: null,
    channelId: null,
    meetingId: null,
    requesterId: null,
    payload: null,
    status: 'pending',
    decisionComment: null,
    createdAt: 0,
    decidedAt: null,
    ...overrides,
  };
}

function makeDetail(overrides: Partial<ApprovalDetail> = {}): ApprovalDetail {
  return {
    approval: makeItem(),
    impactedFiles: [
      {
        path: '/tmp/x',
        addedLines: 0,
        removedLines: 0,
        changeKind: 'modified',
      },
    ],
    diffPreviews: [{ path: '/tmp/x', preview: 'edit', truncated: false }],
    consensusContext: null,
    ...overrides,
  };
}

function installArena(invokeImpl: (channel: string, data: unknown) => unknown) {
  const fn = vi.fn(invokeImpl);
  vi.stubGlobal('arena', { platform: 'linux', invoke: fn });
  return fn;
}

function renderPanel(approvalId: string | null, onDecided?: () => void) {
  useThemeStore.getState().setTheme(DEFAULT_THEME);
  useThemeStore.getState().setMode(DEFAULT_MODE);
  return render(
    <ThemeProvider>
      <ApprovalDetailPanel approvalId={approvalId} onDecided={onDecided} />
    </ThemeProvider>,
  );
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ApprovalDetailPanel (R11-Task7)', () => {
  it('approvalId=null → renders the empty zero-state, no IPC', async () => {
    const invoke = installArena(() => {
      throw new Error('should not be called');
    });
    renderPanel(null);
    await waitFor(() => {
      expect(screen.getByTestId('apv-detail-empty')).toBeTruthy();
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('approvalId set → fetches and renders 5-card cluster', async () => {
    const invoke = installArena(() =>
      Promise.resolve({ detail: makeDetail() }),
    );
    renderPanel('app-1');
    await waitFor(() => {
      expect(screen.getByTestId('apv-detail-cards')).toBeTruthy();
    });
    expect(screen.getByTestId('apv-detail-header')).toBeTruthy();
    expect(screen.getByTestId('apv-impacted-files-card')).toBeTruthy();
    expect(screen.getByTestId('apv-diff-preview-card')).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith('approval:detail-fetch', {
      approvalId: 'app-1',
    });
  });

  it('consensus card renders only when context is non-null', async () => {
    const detailWithContext = makeDetail({
      approval: makeItem({ meetingId: 'mtg-1' }),
      consensusContext: {
        meetingId: 'mtg-1',
        participantVotes: [{ providerId: 'p-a', vote: 'approve' }],
      },
    });
    installArena(() => Promise.resolve({ detail: detailWithContext }));
    renderPanel('app-1');
    await waitFor(() => {
      expect(screen.getByTestId('apv-consensus-card')).toBeTruthy();
    });
  });

  it('error path renders the inline error block', async () => {
    installArena(() => Promise.reject(new Error('network down')));
    renderPanel('app-1');
    await waitFor(() => {
      const err = screen.queryByTestId('apv-detail-error');
      expect(err).not.toBeNull();
      expect(err?.textContent).toContain('network down');
    });
  });

  it('action bar renders only after detail loaded', async () => {
    installArena(() => Promise.resolve({ detail: makeDetail() }));
    renderPanel('app-1');
    expect(screen.queryByTestId('apv-action-bar')).toBeNull();
    await waitFor(() => {
      expect(screen.getByTestId('apv-action-bar')).toBeTruthy();
    });
  });

  it('panel root carries approvalId attribute for selection tracing', async () => {
    installArena(() => Promise.resolve({ detail: makeDetail() }));
    renderPanel('app-1');
    const panel = screen.getByTestId('approval-detail-panel');
    expect(panel.getAttribute('data-approval-id')).toBe('app-1');
  });

  it('transition null → "app-1" loads detail without leaving the empty state stuck', async () => {
    let calls = 0;
    installArena(() => {
      calls += 1;
      return Promise.resolve({ detail: makeDetail() });
    });
    const { rerender } = renderPanel(null);
    expect(screen.getByTestId('apv-detail-empty')).toBeTruthy();
    rerender(
      <ThemeProvider>
        <ApprovalDetailPanel approvalId="app-1" />
      </ThemeProvider>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('apv-detail-cards')).toBeTruthy();
    });
    expect(calls).toBe(1);
  });

  it('renders no hex literal colour anywhere', async () => {
    installArena(() => Promise.resolve({ detail: makeDetail() }));
    renderPanel('app-1');
    await waitFor(() => {
      expect(screen.getByTestId('apv-detail-cards')).toBeTruthy();
    });
    const root = screen.getByTestId('approval-detail-panel');
    expect(root.outerHTML.match(/#[0-9a-fA-F]{3,6}\b/g)).toBeNull();
  });
});
