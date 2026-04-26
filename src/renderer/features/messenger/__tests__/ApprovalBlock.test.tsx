// @vitest-environment jsdom

/**
 * ApprovalBlock — 3-way theme container + miniBtnStyle 버튼 재활용 회귀 + R7-Task5
 * approval:decide IPC wire 검증.
 *
 * R5 ApprovalBlock 은 onDecision placeholder 였으나 R7-Task5 에서 실제 IPC 호출로
 * 교체되었다 (approve → 즉시 invoke, reject/conditional → Dialog → invoke).
 * 하드코드 hex guard 와 3-way 스타일 테스트는 그대로 보존 (회귀 0).
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

// ── jsdom polyfills (Radix Dialog 는 pointer-capture 를 참조) ─────────
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

// ── invoke mock — 모든 IPC 호출을 이 배열로 관찰 ─────────────────────
interface InvokeCall {
  channel: string;
  data: unknown;
}
const invokeCalls: InvokeCall[] = [];
let invokeReject: Error | null = null;
let invokeGate: Promise<void> | null = null;

vi.mock('../../../ipc/invoke', () => ({
  invoke: async (channel: string, data: unknown) => {
    invokeCalls.push({ channel, data });
    if (invokeGate) await invokeGate;
    if (invokeReject) throw invokeReject;
    return { success: true };
  },
}));

// ── throwToBoundary spy — R11-Task15 토스트 발사 검증 ───────────────
const throwToBoundaryCalls: unknown[] = [];
vi.mock('../../../components/ErrorBoundary', () => ({
  useThrowToBoundary: () => (err: unknown) => {
    throwToBoundaryCalls.push(err);
  },
}));

import { ApprovalBlock } from '../ApprovalBlock';
import { i18next } from '../../../i18n';
import { ThemeProvider } from '../../../theme/theme-provider';
import {
  DEFAULT_MODE,
  DEFAULT_THEME,
  useThemeStore,
} from '../../../theme/theme-store';
import type { ThemeKey } from '../../../theme/theme-tokens';
import type { Message as ChannelMessage } from '../../../../shared/message-types';

function makeApprovalMessage(
  overrides: Partial<ChannelMessage> = {},
): ChannelMessage {
  return {
    id: 'msg-a',
    channelId: 'c-plan',
    meetingId: null,
    authorId: 'prov-a',
    authorKind: 'member',
    role: 'assistant',
    content: '이 파일을 삭제해도 될까요?',
    meta: { approvalRef: 'appr-1' },
    createdAt: 1_700_000_000_000,
    ...overrides,
  };
}

function renderWithTheme(
  themeKey: ThemeKey,
  ui: React.ReactElement,
): ReturnType<typeof render> {
  useThemeStore.setState({ themeKey, mode: 'light' });
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

beforeEach(() => {
  useThemeStore.setState({ themeKey: DEFAULT_THEME, mode: DEFAULT_MODE });
  invokeCalls.length = 0;
  invokeReject = null;
  void i18next.changeLanguage('ko');
});

afterEach(() => {
  cleanup();
  useThemeStore.setState({ themeKey: DEFAULT_THEME, mode: DEFAULT_MODE });
});

describe('ApprovalBlock — themeKey 3-way container (R5 회귀 보존)', () => {
  it('warm: rounded-lg container + warning label + plain body', () => {
    renderWithTheme('warm', <ApprovalBlock message={makeApprovalMessage()} />);
    const root = screen.getByTestId('approval-block');
    expect(root.getAttribute('data-theme-variant')).toBe('warm');
    expect(root.className).toContain('rounded-lg');
    expect(root.getAttribute('style')).not.toContain('clip-path');
    expect(screen.getByTestId('approval-block-label').textContent).toBe(
      '⚠ 승인 요청',
    );
    expect(
      screen.getByTestId('approval-block-body').getAttribute('data-style'),
    ).toBe('plain');
  });

  it('tactical: rounded-none + clip-path polygon + warning label plain body', () => {
    renderWithTheme(
      'tactical',
      <ApprovalBlock message={makeApprovalMessage()} />,
    );
    const root = screen.getByTestId('approval-block');
    expect(root.getAttribute('data-theme-variant')).toBe('tactical');
    expect(root.className).toContain('rounded-none');
    expect(root.getAttribute('style')).toContain('clip-path');
    expect(screen.getByTestId('approval-block-label').textContent).toBe(
      '⚠ 승인 요청',
    );
    expect(
      screen.getByTestId('approval-block-body').getAttribute('data-style'),
    ).toBe('plain');
  });

  it('retro: [승인 요청] label + approvalBodyStyle="quote" body', () => {
    renderWithTheme('retro', <ApprovalBlock message={makeApprovalMessage()} />);
    const root = screen.getByTestId('approval-block');
    expect(root.getAttribute('data-theme-variant')).toBe('retro');
    expect(root.getAttribute('data-approval-body-style')).toBe('quote');
    expect(screen.getByTestId('approval-block-label').textContent).toBe(
      '[승인 요청]',
    );
    const body = screen.getByTestId('approval-block-body');
    expect(body.getAttribute('data-style')).toBe('quote');
    expect(body.className).toContain('border-l-2');
    expect(body.className).toContain('font-mono');
  });
});

describe('ApprovalBlock — decision buttons reuse miniBtnStyle via shape="auto"', () => {
  it('warm miniBtnStyle="pill" → buttons have data-shape="pill"', () => {
    renderWithTheme('warm', <ApprovalBlock message={makeApprovalMessage()} />);
    expect(
      screen.getByTestId('approval-block-allow').getAttribute('data-shape'),
    ).toBe('pill');
    expect(
      screen
        .getByTestId('approval-block-conditional')
        .getAttribute('data-shape'),
    ).toBe('pill');
    expect(
      screen.getByTestId('approval-block-deny').getAttribute('data-shape'),
    ).toBe('pill');
  });

  it('tactical miniBtnStyle="notched" → buttons have data-shape="notched"', () => {
    renderWithTheme(
      'tactical',
      <ApprovalBlock message={makeApprovalMessage()} />,
    );
    expect(
      screen.getByTestId('approval-block-allow').getAttribute('data-shape'),
    ).toBe('notched');
  });

  it('retro miniBtnStyle="text" → buttons have data-shape="text"', () => {
    renderWithTheme('retro', <ApprovalBlock message={makeApprovalMessage()} />);
    expect(
      screen.getByTestId('approval-block-allow').getAttribute('data-shape'),
    ).toBe('text');
  });

  it('approvalRef missing → buttons disabled (safe fallback)', () => {
    renderWithTheme(
      'warm',
      <ApprovalBlock message={makeApprovalMessage({ meta: null })} />,
    );
    expect(
      (screen.getByTestId('approval-block-allow') as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (
        screen.getByTestId(
          'approval-block-conditional',
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (screen.getByTestId('approval-block-deny') as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

describe('ApprovalBlock — approval:decide IPC wire (R7-Task5)', () => {
  it('allow click → invoke("approval:decide", { id, decision: "approve" })', async () => {
    renderWithTheme('warm', <ApprovalBlock message={makeApprovalMessage()} />);
    fireEvent.click(screen.getByTestId('approval-block-allow'));
    await waitFor(() => {
      expect(invokeCalls.length).toBe(1);
    });
    expect(invokeCalls[0]).toEqual({
      channel: 'approval:decide',
      data: { id: 'appr-1', decision: 'approve' },
    });
  });

  it('deny click → opens RejectDialog (invoke 0 before submit)', () => {
    renderWithTheme('warm', <ApprovalBlock message={makeApprovalMessage()} />);
    fireEvent.click(screen.getByTestId('approval-block-deny'));
    expect(screen.getByTestId('approval-reject-dialog')).toBeTruthy();
    expect(invokeCalls.length).toBe(0);
  });

  it('conditional click → opens ConditionalDialog (invoke 0 before submit)', () => {
    renderWithTheme('warm', <ApprovalBlock message={makeApprovalMessage()} />);
    fireEvent.click(screen.getByTestId('approval-block-conditional'));
    expect(screen.getByTestId('approval-conditional-dialog')).toBeTruthy();
    expect(invokeCalls.length).toBe(0);
  });

  it('reject cancel → invoke 0 + dialog closes', async () => {
    renderWithTheme('warm', <ApprovalBlock message={makeApprovalMessage()} />);
    fireEvent.click(screen.getByTestId('approval-block-deny'));
    fireEvent.click(screen.getByTestId('approval-reject-cancel'));
    await waitFor(() => {
      expect(screen.queryByTestId('approval-reject-dialog')).toBeNull();
    });
    expect(invokeCalls.length).toBe(0);
  });

  it('reject submit with comment → invoke("approval:decide", { id, decision: "reject", comment })', async () => {
    renderWithTheme('warm', <ApprovalBlock message={makeApprovalMessage()} />);
    fireEvent.click(screen.getByTestId('approval-block-deny'));
    fireEvent.change(screen.getByTestId('approval-reject-comment'), {
      target: { value: '위험한 명령' },
    });
    fireEvent.click(screen.getByTestId('approval-reject-submit'));
    await waitFor(() => {
      expect(invokeCalls.length).toBe(1);
    });
    expect(invokeCalls[0]).toEqual({
      channel: 'approval:decide',
      data: { id: 'appr-1', decision: 'reject', comment: '위험한 명령' },
    });
  });

  it('conditional submit with comment → invoke("approval:decide", { id, decision: "conditional", comment })', async () => {
    renderWithTheme('warm', <ApprovalBlock message={makeApprovalMessage()} />);
    fireEvent.click(screen.getByTestId('approval-block-conditional'));
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
  });

  it('allow IPC error surfaces inline', async () => {
    const err = new Error('boom');
    err.name = 'AlreadyDecidedError';
    invokeReject = err;

    renderWithTheme('warm', <ApprovalBlock message={makeApprovalMessage()} />);
    fireEvent.click(screen.getByTestId('approval-block-allow'));
    await waitFor(() => {
      expect(screen.getByTestId('approval-block-error')).toBeTruthy();
    });
  });
});

describe('ApprovalBlock — R11-Task15 optimistic decide path', () => {
  beforeEach(() => {
    invokeGate = null;
    throwToBoundaryCalls.length = 0;
  });

  it('allow click immediately surfaces data-decision-preview="approve"', async () => {
    // Hold the IPC open so we can observe the in-flight optimistic state.
    let release: () => void = () => undefined;
    invokeGate = new Promise<void>((resolve) => {
      release = resolve;
    });

    renderWithTheme('warm', <ApprovalBlock message={makeApprovalMessage()} />);
    fireEvent.click(screen.getByTestId('approval-block-allow'));

    // Optimistic state must show up synchronously after the click.
    await waitFor(() => {
      expect(
        screen
          .getByTestId('approval-block')
          .getAttribute('data-decision-preview'),
      ).toBe('approve');
    });

    // All gesture buttons disabled while optimistic in flight.
    expect(
      (screen.getByTestId('approval-block-allow') as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (
        screen.getByTestId('approval-block-conditional') as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (screen.getByTestId('approval-block-deny') as HTMLButtonElement).disabled,
    ).toBe(true);

    // Settle the IPC so the test cleanup does not leak the pending promise.
    release();
    await waitFor(() => {
      expect(invokeCalls.length).toBe(1);
    });
  });

  it('allow success keeps decisionPreview latched until the row unmounts', async () => {
    renderWithTheme('warm', <ApprovalBlock message={makeApprovalMessage()} />);
    fireEvent.click(screen.getByTestId('approval-block-allow'));
    await waitFor(() => {
      expect(invokeCalls.length).toBe(1);
    });
    // Server confirmed the decision — the inbox stream removes the row at
    // its own pace; until then the preview must stay 'approve' so the
    // user sees the result.
    expect(
      screen
        .getByTestId('approval-block')
        .getAttribute('data-decision-preview'),
    ).toBe('approve');
    expect(screen.queryByTestId('approval-block-error')).toBeNull();
  });

  it('allow failure rolls back decisionPreview and shows optimisticRollback hint', async () => {
    const err = new Error('boom');
    err.name = 'ApprovalNotFoundError';
    invokeReject = err;

    renderWithTheme('warm', <ApprovalBlock message={makeApprovalMessage()} />);
    fireEvent.click(screen.getByTestId('approval-block-allow'));
    await waitFor(() => {
      expect(screen.getByTestId('approval-block-error')).toBeTruthy();
    });

    // Preview cleared on rollback so the user can re-attempt.
    expect(
      screen
        .getByTestId('approval-block')
        .getAttribute('data-decision-preview'),
    ).toBe('');

    // Buttons re-enabled after rollback so the user can try again.
    expect(
      (screen.getByTestId('approval-block-allow') as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(
      (screen.getByTestId('approval-block-deny') as HTMLButtonElement).disabled,
    ).toBe(false);

    // Inline message uses the optimistic rollback i18n key (not the
    // legacy mapErrorToI18nKey wiring).
    expect(screen.getByTestId('approval-block-error').textContent).toBe(
      '결정을 적용하지 못해 승인 블록을 이전 상태로 되돌렸습니다.',
    );
  });

  it('allow failure publishes the underlying Error to the boundary bus', async () => {
    const err = new Error('boundary-bus-message');
    err.name = 'AlreadyDecidedError';
    invokeReject = err;

    renderWithTheme('warm', <ApprovalBlock message={makeApprovalMessage()} />);
    fireEvent.click(screen.getByTestId('approval-block-allow'));
    await waitFor(() => {
      expect(screen.getByTestId('approval-block-error')).toBeTruthy();
    });

    // throwToBoundary forwards the underlying Error so the boundary
    // publishes the toast — confirms the optimistic rollback uses the
    // R10 D8 toast escalation path (matches use-channel-messages.send /
    // use-autonomy-mode.confirm wiring).
    expect(throwToBoundaryCalls).toContain(err);
  });

  it('allow failure → retry click clears prior error and enters optimistic again', async () => {
    const err = new Error('first-attempt');
    err.name = 'AlreadyDecidedError';
    invokeReject = err;

    renderWithTheme('warm', <ApprovalBlock message={makeApprovalMessage()} />);
    fireEvent.click(screen.getByTestId('approval-block-allow'));
    await waitFor(() => {
      expect(screen.getByTestId('approval-block-error')).toBeTruthy();
    });

    // Retry: clear the reject and click again.
    invokeReject = null;
    fireEvent.click(screen.getByTestId('approval-block-allow'));
    await waitFor(() => {
      expect(invokeCalls.length).toBe(2);
    });

    // After successful retry the preview is back at 'approve' and the
    // inline error banner is cleared.
    expect(
      screen
        .getByTestId('approval-block')
        .getAttribute('data-decision-preview'),
    ).toBe('approve');
    expect(screen.queryByTestId('approval-block-error')).toBeNull();
  });
});

describe('ApprovalBlock — source-level hex color literal guard', () => {
  it('ApprovalBlock.tsx contains zero hex color literals', () => {
    const source = readFileSync(
      resolve(__dirname, '..', 'ApprovalBlock.tsx'),
      'utf-8',
    );
    expect(source.match(/#[0-9a-fA-F]{3,6}\b/g)).toBeNull();
  });
});
