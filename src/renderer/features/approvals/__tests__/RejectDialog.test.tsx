// @vitest-environment jsdom

/**
 * RejectDialog (R7-Task5) — open/close + approval:decide IPC 호출 검증.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

interface InvokeCall {
  channel: string;
  data: unknown;
}
const invokeCalls: InvokeCall[] = [];
let invokeReject: Error | null = null;

vi.mock('../../../ipc/invoke', () => ({
  invoke: async (channel: string, data: unknown) => {
    invokeCalls.push({ channel, data });
    if (invokeReject) throw invokeReject;
    return { success: true };
  },
}));

import { ThemeProvider } from '../../../theme/theme-provider';
import { DEFAULT_MODE, DEFAULT_THEME, useThemeStore } from '../../../theme/theme-store';
import '../../../i18n';
import { i18next } from '../../../i18n';
import { RejectDialog } from '../RejectDialog';

function renderWithTheme(ui: React.ReactElement): ReturnType<typeof render> {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

beforeEach(() => {
  invokeCalls.length = 0;
  invokeReject = null;
  void i18next.changeLanguage('ko');
});

afterEach(() => {
  cleanup();
  useThemeStore.setState({ themeKey: DEFAULT_THEME, mode: DEFAULT_MODE });
});

describe('RejectDialog — open/close', () => {
  it('renders when open', () => {
    renderWithTheme(
      <RejectDialog open onOpenChange={() => {}} approvalId="appr-1" />,
    );
    expect(screen.getByTestId('approval-reject-dialog')).toBeTruthy();
    expect(screen.getByTestId('approval-reject-comment')).toBeTruthy();
  });

  it('does not render when closed', () => {
    renderWithTheme(
      <RejectDialog
        open={false}
        onOpenChange={() => {}}
        approvalId="appr-1"
      />,
    );
    expect(screen.queryByTestId('approval-reject-dialog')).toBeNull();
  });

  it('cancel button → onOpenChange(false) + invoke 0', () => {
    const onOpenChange = vi.fn();
    renderWithTheme(
      <RejectDialog open onOpenChange={onOpenChange} approvalId="appr-1" />,
    );
    fireEvent.click(screen.getByTestId('approval-reject-cancel'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(invokeCalls.length).toBe(0);
  });
});

describe('RejectDialog — submit path', () => {
  it('submit with comment → invoke + onDecided + onOpenChange(false)', async () => {
    const onOpenChange = vi.fn();
    const onDecided = vi.fn();
    renderWithTheme(
      <RejectDialog
        open
        onOpenChange={onOpenChange}
        approvalId="appr-1"
        onDecided={onDecided}
      />,
    );
    fireEvent.change(screen.getByTestId('approval-reject-comment'), {
      target: { value: '보안상 위험' },
    });
    fireEvent.click(screen.getByTestId('approval-reject-submit'));

    await waitFor(() => {
      expect(invokeCalls.length).toBe(1);
    });
    expect(invokeCalls[0]).toEqual({
      channel: 'approval:decide',
      data: { id: 'appr-1', decision: 'reject', comment: '보안상 위험' },
    });
    expect(onDecided).toHaveBeenCalledWith('appr-1');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('submit with blank comment → invoke omits comment field', async () => {
    renderWithTheme(
      <RejectDialog open onOpenChange={() => {}} approvalId="appr-2" />,
    );
    // default comment '' → trimmed '' → undefined
    fireEvent.click(screen.getByTestId('approval-reject-submit'));
    await waitFor(() => {
      expect(invokeCalls.length).toBe(1);
    });
    expect(invokeCalls[0]).toEqual({
      channel: 'approval:decide',
      data: { id: 'appr-2', decision: 'reject', comment: undefined },
    });
  });

  it('approvalId null → submit disabled', () => {
    renderWithTheme(
      <RejectDialog open onOpenChange={() => {}} approvalId={null} />,
    );
    expect(
      (screen.getByTestId('approval-reject-submit') as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it('AlreadyDecidedError → inline error banner', async () => {
    const err = new Error('already');
    err.name = 'AlreadyDecidedError';
    invokeReject = err;

    renderWithTheme(
      <RejectDialog open onOpenChange={() => {}} approvalId="appr-3" />,
    );
    fireEvent.click(screen.getByTestId('approval-reject-submit'));
    await waitFor(() => {
      expect(screen.getByTestId('approval-reject-error')).toBeTruthy();
    });
  });
});

describe('RejectDialog — source-level hex color literal guard', () => {
  it('RejectDialog.tsx contains zero hex color literals', () => {
    const source = readFileSync(
      resolve(__dirname, '..', 'RejectDialog.tsx'),
      'utf-8',
    );
    expect(source.match(/#[0-9a-fA-F]{3,6}\b/g)).toBeNull();
  });
});
