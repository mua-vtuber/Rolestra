// @vitest-environment jsdom

/**
 * ConditionalDialog (R7-Task5) — comment 필수 + open/close + approval:decide
 * IPC 호출 검증. zod schema 의 refine 규칙을 UI 에서 선반영한다.
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
import { ConditionalDialog } from '../ConditionalDialog';

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

describe('ConditionalDialog — open/close', () => {
  it('renders when open', () => {
    renderWithTheme(
      <ConditionalDialog open onOpenChange={() => {}} approvalId="appr-1" />,
    );
    expect(screen.getByTestId('approval-conditional-dialog')).toBeTruthy();
    expect(screen.getByTestId('approval-conditional-comment')).toBeTruthy();
  });

  it('cancel → onOpenChange(false) + invoke 0', () => {
    const onOpenChange = vi.fn();
    renderWithTheme(
      <ConditionalDialog
        open
        onOpenChange={onOpenChange}
        approvalId="appr-1"
      />,
    );
    fireEvent.click(screen.getByTestId('approval-conditional-cancel'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(invokeCalls.length).toBe(0);
  });
});

describe('ConditionalDialog — comment required', () => {
  it('empty comment → submit disabled', () => {
    renderWithTheme(
      <ConditionalDialog open onOpenChange={() => {}} approvalId="appr-1" />,
    );
    expect(
      (screen.getByTestId('approval-conditional-submit') as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it('whitespace-only comment → submit disabled', () => {
    renderWithTheme(
      <ConditionalDialog open onOpenChange={() => {}} approvalId="appr-1" />,
    );
    fireEvent.change(screen.getByTestId('approval-conditional-comment'), {
      target: { value: '   ' },
    });
    expect(
      (screen.getByTestId('approval-conditional-submit') as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it('approvalId null → submit disabled even with comment', () => {
    renderWithTheme(
      <ConditionalDialog open onOpenChange={() => {}} approvalId={null} />,
    );
    fireEvent.change(screen.getByTestId('approval-conditional-comment'), {
      target: { value: '조건' },
    });
    expect(
      (screen.getByTestId('approval-conditional-submit') as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});

describe('ConditionalDialog — submit path', () => {
  it('submit with comment → invoke + onDecided + onOpenChange(false)', async () => {
    const onOpenChange = vi.fn();
    const onDecided = vi.fn();
    renderWithTheme(
      <ConditionalDialog
        open
        onOpenChange={onOpenChange}
        approvalId="appr-1"
        onDecided={onDecided}
      />,
    );
    fireEvent.change(screen.getByTestId('approval-conditional-comment'), {
      target: { value: '읽기만 허용' },
    });
    fireEvent.click(screen.getByTestId('approval-conditional-submit'));

    await waitFor(() => {
      expect(invokeCalls.length).toBe(1);
    });
    expect(invokeCalls[0]).toEqual({
      channel: 'approval:decide',
      data: {
        id: 'appr-1',
        decision: 'conditional',
        comment: '읽기만 허용',
      },
    });
    expect(onDecided).toHaveBeenCalledWith('appr-1');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('submit trims comment before sending', async () => {
    renderWithTheme(
      <ConditionalDialog open onOpenChange={() => {}} approvalId="appr-2" />,
    );
    fireEvent.change(screen.getByTestId('approval-conditional-comment'), {
      target: { value: '  승인 조건  ' },
    });
    fireEvent.click(screen.getByTestId('approval-conditional-submit'));
    await waitFor(() => {
      expect(invokeCalls.length).toBe(1);
    });
    expect(
      (invokeCalls[0].data as { comment: string }).comment,
    ).toBe('승인 조건');
  });

  it('ApprovalNotFoundError → inline error banner', async () => {
    const err = new Error('missing');
    err.name = 'ApprovalNotFoundError';
    invokeReject = err;

    renderWithTheme(
      <ConditionalDialog open onOpenChange={() => {}} approvalId="appr-3" />,
    );
    fireEvent.change(screen.getByTestId('approval-conditional-comment'), {
      target: { value: '조건' },
    });
    fireEvent.click(screen.getByTestId('approval-conditional-submit'));
    await waitFor(() => {
      expect(screen.getByTestId('approval-conditional-error')).toBeTruthy();
    });
  });
});

describe('ConditionalDialog — source-level hex color literal guard', () => {
  it('ConditionalDialog.tsx contains zero hex color literals', () => {
    const source = readFileSync(
      resolve(__dirname, '..', 'ConditionalDialog.tsx'),
      'utf-8',
    );
    expect(source.match(/#[0-9a-fA-F]{3,6}\b/g)).toBeNull();
  });
});
