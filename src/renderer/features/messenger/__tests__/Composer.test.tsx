// @vitest-environment jsdom

/**
 * Composer (spec 2026-10-01-messenger-redesign.md R3-7) — bubbles / log
 * layout, message:append wire, readOnly branch, Enter/Shift+Enter, the send
 * button, and input kept on a failed send.
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

import { Composer } from '../Composer';
import { i18next } from '../../../i18n';
import { ThemeProvider } from '../../../theme/theme-provider';
import {
  DEFAULT_MODE,
  DEFAULT_THEME,
  useThemeStore,
} from '../../../theme/theme-store';
import type { ThemeKey } from '../../../theme/theme-tokens';
import type { Message } from '../../../../shared/message-types';

function makeAppendResult(content: string): { message: Message } {
  return {
    message: {
      id: 'm-new',
      channelId: 'c-plan',
      meetingId: null,
      authorId: 'user',
      authorKind: 'user',
      role: 'user',
      content,
      meta: null,
      createdAt: 1_700_000_000_000,
    },
  };
}

interface BridgeHandlers {
  initialMessages?: Message[];
  onAppend?: (payload: { channelId: string; content: string }) => void;
  appendShouldFail?: boolean;
}

function stubBridge(
  handlers: BridgeHandlers = {},
): ReturnType<typeof vi.fn> {
  const initial = handlers.initialMessages ?? [];
  const invoke = vi.fn(async (channel: string, data: unknown) => {
    if (channel === 'message:list-by-channel') {
      return { messages: initial };
    }
    if (channel === 'message:append') {
      const payload = data as { channelId: string; content: string };
      handlers.onAppend?.(payload);
      if (handlers.appendShouldFail) {
        throw new Error('boom');
      }
      return makeAppendResult(payload.content);
    }
    throw new Error(`no mock for channel ${channel}`);
  });
  vi.stubGlobal('arena', { platform: 'linux', invoke });
  return invoke;
}

function renderWithTheme(
  themeKey: ThemeKey,
  ui: React.ReactElement,
): ReturnType<typeof render> {
  useThemeStore.setState({ themeKey, mode: 'light' });
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

beforeEach(() => {
  vi.unstubAllGlobals();
  useThemeStore.setState({ themeKey: DEFAULT_THEME, mode: DEFAULT_MODE });
  void i18next.changeLanguage('ko');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  useThemeStore.setState({ themeKey: DEFAULT_THEME, mode: DEFAULT_MODE });
});

describe('Composer — bubbles / log layout', () => {
  it('tactical: bubbles input with an icon send button and no prompt', async () => {
    stubBridge();
    renderWithTheme('tactical', <Composer channelId="c-plan" />);

    await waitFor(() =>
      expect(screen.getByTestId('composer').getAttribute('data-theme-variant')).toBe('tactical'),
    );
    expect(screen.getByTestId('composer').getAttribute('data-layout')).toBe('bubbles');
    expect(screen.queryByTestId('composer-prompt')).toBeNull();
    const send = screen.getByTestId('composer-send');
    expect(send.getAttribute('aria-label')).toBe('보내기');
    expect(send.textContent).toBe('');
    expect((screen.getByTestId('composer-textarea') as HTMLTextAreaElement).placeholder).toBe('메시지 보내기');
  });

  it('retro: log prompt and a [보내기] text button', async () => {
    stubBridge();
    renderWithTheme('retro', <Composer channelId="c-plan" />);

    await waitFor(() =>
      expect(screen.getByTestId('composer').getAttribute('data-theme-variant')).toBe('retro'),
    );
    expect(screen.getByTestId('composer').getAttribute('data-layout')).toBe('log');
    expect(screen.getByTestId('composer-prompt').textContent).toBe('나>');
    expect(screen.getByTestId('composer-send').textContent).toBe('[보내기]');
    expect((screen.getByTestId('composer-textarea') as HTMLTextAreaElement).placeholder)
      .toBe('메시지를 입력하고 Enter');
  });

  it('shows the actions slot next to the input in both layouts', async () => {
    stubBridge();
    renderWithTheme('retro', <Composer channelId="c-plan" actions={<button data-testid="slot-action" />} />);
    const row = await screen.findByTestId('composer-input-row');
    expect(row.contains(screen.getByTestId('slot-action'))).toBe(true);
  });
});

describe('Composer — readOnly branch', () => {
  it('readOnly=true → readonly badge rendered + textarea and send disabled', async () => {
    stubBridge();
    renderWithTheme(
      'tactical',
      <Composer channelId="c-plan" readOnly />,
    );

    await waitFor(() =>
      expect(screen.getByTestId('composer').getAttribute('data-readonly')).toBe('true'),
    );
    expect(screen.getByTestId('composer-readonly-badge')).toBeTruthy();
    const textarea = screen.getByTestId('composer-textarea') as HTMLTextAreaElement;
    expect(textarea.disabled).toBe(true);
    expect((screen.getByTestId('composer-send') as HTMLButtonElement).disabled).toBe(true);
  });

  it('readOnly=false → no mention/command hints, textarea enabled', async () => {
    stubBridge();
    renderWithTheme('tactical', <Composer channelId="c-plan" />);

    await waitFor(() =>
      expect(screen.getByTestId('composer').getAttribute('data-readonly')).toBe('false'),
    );
    expect(screen.queryByTestId('composer-readonly-badge')).toBeNull();
    expect(screen.queryByTestId('composer-hints')).toBeNull();
    expect(screen.getByTestId('composer').textContent).not.toContain('멘션');
    const textarea = screen.getByTestId('composer-textarea') as HTMLTextAreaElement;
    expect(textarea.disabled).toBe(false);
  });
});

describe('Composer — keyboard handling + send wire', () => {
  it('Enter → invoke message:append with trimmed content + clear input + onSendSuccess', async () => {
    const onAppend = vi.fn();
    const invoke = stubBridge({ onAppend });
    const onSendSuccess = vi.fn();

    renderWithTheme(
      'tactical',
      <Composer channelId="c-plan" onSendSuccess={onSendSuccess} />,
    );

    const textarea = screen.getByTestId('composer-textarea') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '  안녕하세요  ' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    await waitFor(() => expect(onSendSuccess).toHaveBeenCalledTimes(1));
    expect(onAppend).toHaveBeenCalledWith({
      channelId: 'c-plan',
      content: '안녕하세요',
    });
    expect(textarea.value).toBe('');
    expect(
      invoke.mock.calls.some((c) => c[0] === 'message:append'),
    ).toBe(true);
  });

  it('the send button sends the typed message and is disabled while empty', async () => {
    const onAppend = vi.fn();
    stubBridge({ onAppend });
    renderWithTheme('tactical', <Composer channelId="c-plan" />);

    const send = screen.getByTestId('composer-send') as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.change(screen.getByTestId('composer-textarea'), { target: { value: 'by button' } });
    expect(send.disabled).toBe(false);
    fireEvent.click(send);
    await waitFor(() => expect(onAppend).toHaveBeenCalledWith({ channelId: 'c-plan', content: 'by button' }));
  });

  it('Shift+Enter → does NOT invoke message:append (default newline)', async () => {
    const onAppend = vi.fn();
    stubBridge({ onAppend });
    renderWithTheme('tactical', <Composer channelId="c-plan" />);

    const textarea = screen.getByTestId('composer-textarea') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'hi' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });

    // Allow any potential microtasks to settle.
    await waitFor(() => expect(textarea.value).toBe('hi'));
    expect(onAppend).not.toHaveBeenCalled();
  });

  it('empty / whitespace-only → Enter no-op (no invoke)', async () => {
    const onAppend = vi.fn();
    stubBridge({ onAppend });
    renderWithTheme('tactical', <Composer channelId="c-plan" />);

    const textarea = screen.getByTestId('composer-textarea') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '   ' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    await waitFor(() => expect(textarea.value).toBe('   '));
    expect(onAppend).not.toHaveBeenCalled();
  });
});

describe('Composer — send failure UX', () => {
  it('IPC rejection → value preserved + inline error surfaces', async () => {
    stubBridge({ appendShouldFail: true });
    const onSendSuccess = vi.fn();

    renderWithTheme(
      'tactical',
      <Composer channelId="c-plan" onSendSuccess={onSendSuccess} />,
    );

    const textarea = screen.getByTestId('composer-textarea') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '재시도 메시지' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    await waitFor(() => expect(screen.getByTestId('composer-error')).toBeTruthy());
    expect(textarea.value).toBe('재시도 메시지');
    expect(onSendSuccess).not.toHaveBeenCalled();
    expect(screen.getByTestId('composer-error').textContent).toContain('실패');
  });
});

describe('Composer — source-level hex color literal guard', () => {
  it('Composer.tsx contains zero hex color literals', () => {
    const source = readFileSync(
      resolve(__dirname, '..', 'Composer.tsx'),
      'utf-8',
    );
    expect(source.match(/#[0-9a-fA-F]{3,6}\b/g)).toBeNull();
  });
});
