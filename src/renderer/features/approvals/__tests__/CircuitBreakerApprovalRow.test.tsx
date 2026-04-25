// @vitest-environment jsdom

/**
 * CircuitBreakerApprovalRow (R10-Task4) renderer tests.
 *
 * Coverage:
 *   - tripwire title + readout (한계값 / 측정값) + previousMode are
 *     rendered from the approval payload.
 *   - 재개 click → typedInvoke('approval:decide', { id, approved: true }).
 *   - error path surfaces the i18n fallback when invoke rejects.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

if (typeof globalThis.ResizeObserver === 'undefined') {
  (globalThis as { ResizeObserver: unknown }).ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
}

import { ThemeProvider } from '../../../theme/theme-provider';
import {
  DEFAULT_MODE,
  DEFAULT_THEME,
  useThemeStore,
} from '../../../theme/theme-store';
import '../../../i18n';
import { i18next } from '../../../i18n';
import { CircuitBreakerApprovalRow } from '../CircuitBreakerApprovalRow';
import type { ApprovalItem } from '../../../../shared/approval-types';

function makeItem(overrides: Partial<ApprovalItem> = {}): ApprovalItem {
  return {
    id: 'cb-1',
    kind: 'circuit_breaker',
    projectId: 'p-1',
    channelId: null,
    meetingId: null,
    requesterId: null,
    payload: {
      source: 'circuit_breaker',
      tripwire: 'queue_streak',
      detail: { count: 6, threshold: 5 },
      previousMode: 'queue',
    },
    status: 'pending',
    decisionComment: null,
    createdAt: 1,
    decidedAt: null,
    ...overrides,
  };
}

interface BridgeStub {
  invoke: ReturnType<typeof vi.fn>;
}

function stubBridge(invokeImpl?: (channel: string, data: unknown) => unknown): BridgeStub {
  const invoke = vi.fn(async (channel: string, data: unknown) => {
    if (invokeImpl) return invokeImpl(channel, data);
    if (channel === 'approval:decide') return { success: true };
    throw new Error(`no mock for ${channel}`);
  });
  vi.stubGlobal('arena', { platform: 'linux', invoke, onStream: vi.fn() });
  return { invoke };
}

function renderRow(item: ApprovalItem): ReturnType<typeof render> {
  return render(
    <ThemeProvider>
      <CircuitBreakerApprovalRow item={item} />
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

describe('CircuitBreakerApprovalRow — readout', () => {
  it('renders the tripwire title from the payload tripwire literal', () => {
    stubBridge();
    renderRow(makeItem());
    const title = screen.getByTestId('cb-approval-title');
    expect(title.textContent).toContain('연속 큐 실행');
  });

  it('renders the threshold + measured readout', () => {
    stubBridge();
    renderRow(makeItem());
    const readout = screen.getByTestId('cb-approval-readout');
    expect(readout.textContent).toContain('5');
    expect(readout.textContent).toContain('6');
    expect(readout.textContent).toContain('한계값');
    expect(readout.textContent).toContain('측정값');
  });

  it('renders previousMode when present in the payload', () => {
    stubBridge();
    renderRow(makeItem());
    const meta = screen.getByTestId('cb-approval-previous-mode');
    expect(meta.textContent).toContain('queue');
  });

  it('shows a dash placeholder when measured/threshold are missing', () => {
    stubBridge();
    renderRow(
      makeItem({
        payload: {
          source: 'circuit_breaker',
          tripwire: 'queue_streak',
          previousMode: 'auto_toggle',
        },
      }),
    );
    const readout = screen.getByTestId('cb-approval-readout');
    expect(readout.textContent).toContain('—');
  });

  it('falls back to the generic title when tripwire is unknown', () => {
    stubBridge();
    renderRow(
      makeItem({
        payload: {
          source: 'circuit_breaker',
          tripwire: 'mystery',
          previousMode: 'manual',
        },
      }),
    );
    const title = screen.getByTestId('cb-approval-title');
    expect(title.textContent).toContain('Circuit Breaker');
  });
});

describe('CircuitBreakerApprovalRow — resume button', () => {
  it('재개 click → invoke approval:decide with approve', async () => {
    const h = stubBridge();
    renderRow(makeItem());
    const button = screen.getByTestId('cb-approval-resume');
    fireEvent.click(button);
    await waitFor(() => {
      expect(h.invoke).toHaveBeenCalledWith('approval:decide', {
        id: 'cb-1',
        decision: 'approve',
      });
    });
  });

  it('error path renders the generic error message when invoke fails with no message', async () => {
    stubBridge(() => {
      throw new Error('');
    });
    renderRow(makeItem());
    fireEvent.click(screen.getByTestId('cb-approval-resume'));
    await waitFor(() => {
      expect(screen.getByTestId('cb-approval-error')).toBeTruthy();
    });
    expect(screen.getByTestId('cb-approval-error').textContent).toContain(
      '재개 요청 처리 중 오류',
    );
  });

  it('disables the button while submitting', async () => {
    let resolveInvoke: ((v: unknown) => void) | null = null;
    stubBridge(
      () =>
        new Promise((resolve) => {
          resolveInvoke = resolve;
        }),
    );
    renderRow(makeItem());
    const button = screen.getByTestId('cb-approval-resume') as HTMLButtonElement;
    fireEvent.click(button);
    await waitFor(() => {
      expect(button.disabled).toBe(true);
    });
    resolveInvoke?.({ success: true });
  });
});
