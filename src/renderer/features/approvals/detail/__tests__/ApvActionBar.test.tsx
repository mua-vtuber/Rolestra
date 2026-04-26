// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ThemeProvider } from '../../../../theme/theme-provider';
import { DEFAULT_MODE, DEFAULT_THEME, useThemeStore } from '../../../../theme/theme-store';
import '../../../../i18n';
import { ApvActionBar } from '../ApvActionBar';
import type { ApprovalItem } from '../../../../../shared/approval-types';

// Radix Dialog pointer-capture polyfills
if (typeof globalThis.ResizeObserver === 'undefined') {
  (globalThis as { ResizeObserver: unknown }).ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
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

function renderBar(approval: ApprovalItem, onDecided?: () => void) {
  useThemeStore.getState().setTheme(DEFAULT_THEME);
  useThemeStore.getState().setMode(DEFAULT_MODE);
  return render(
    <ThemeProvider>
      <ApvActionBar approval={approval} onDecided={onDecided} />
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

describe('ApvActionBar (R11-Task7)', () => {
  it('shows three buttons (approve / conditional / reject) for a pending row', () => {
    renderBar(makeItem());
    expect(screen.getByTestId('apv-action-bar-approve')).toBeTruthy();
    expect(screen.getByTestId('apv-action-bar-conditional')).toBeTruthy();
    expect(screen.getByTestId('apv-action-bar-reject')).toBeTruthy();
  });

  it('approve click invokes approval:decide and fires onDecided', async () => {
    const invoke = vi.fn(async () => ({ success: true }));
    vi.stubGlobal('arena', { platform: 'linux', invoke });
    const onDecided = vi.fn();
    renderBar(makeItem(), onDecided);
    fireEvent.click(screen.getByTestId('apv-action-bar-approve'));
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('approval:decide', {
        id: 'app-1',
        decision: 'approve',
      });
    });
    await waitFor(() => {
      expect(onDecided).toHaveBeenCalledTimes(1);
    });
  });

  it('non-pending status disables every button', () => {
    renderBar(makeItem({ status: 'approved' }));
    const approve = screen.getByTestId('apv-action-bar-approve');
    const conditional = screen.getByTestId('apv-action-bar-conditional');
    const reject = screen.getByTestId('apv-action-bar-reject');
    expect((approve as HTMLButtonElement).disabled).toBe(true);
    expect((conditional as HTMLButtonElement).disabled).toBe(true);
    expect((reject as HTMLButtonElement).disabled).toBe(true);
  });

  it('IPC failure surfaces an inline error', async () => {
    const invoke = vi.fn(async () => {
      throw new Error('boom');
    });
    vi.stubGlobal('arena', { platform: 'linux', invoke });
    renderBar(makeItem());
    fireEvent.click(screen.getByTestId('apv-action-bar-approve'));
    await waitFor(() => {
      const err = screen.queryByTestId('apv-action-bar-error');
      expect(err).not.toBeNull();
      expect(err?.textContent).toBe('boom');
    });
  });

  it('reject button opens the RejectDialog (data-approval-id wired)', () => {
    renderBar(makeItem());
    fireEvent.click(screen.getByTestId('apv-action-bar-reject'));
    // RejectDialog binds data-approval-id on its content; just assert the
    // attribute appears somewhere in the document so the dialog opened.
    const dialog = document.querySelector('[data-approval-id="app-1"]');
    expect(dialog).not.toBeNull();
  });
});
