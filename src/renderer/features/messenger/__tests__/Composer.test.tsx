// @vitest-environment jsdom

/**
 * Composer (R5-Task8) — themeKey 3-way glyph/radius/font + message:append
 * wire + readOnly 분기 + Enter/Shift+Enter + 전송 실패 시 입력 유지.
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

describe('Composer — themeKey 3-way glyph / radius / font', () => {
  it('warm: ✎ glyph + panelRadius=12 + font-sans', async () => {
    stubBridge();
    renderWithTheme('warm', <Composer channelId="c-plan" />);

    await waitFor(() =>
      expect(screen.getByTestId('composer').getAttribute('data-theme-variant')).toBe('warm'),
    );
    const glyph = screen.getByTestId('composer-glyph');
    expect(glyph.getAttribute('data-glyph-value')).toBe('✎');
    const wrap = screen.getByTestId('composer-input-wrap');
    expect(wrap.getAttribute('data-panel-radius')).toBe('12');
    expect(wrap.getAttribute('style')).toContain('border-radius: 12px');
    const textarea = screen.getByTestId('composer-textarea');
    expect(textarea.className).toContain('font-sans');
  });

  it('tactical: ✎ glyph + panelRadius=0 + font-sans', async () => {
    stubBridge();
    renderWithTheme('tactical', <Composer channelId="c-plan" />);

    await waitFor(() =>
      expect(screen.getByTestId('composer').getAttribute('data-theme-variant')).toBe('tactical'),
    );
    const glyph = screen.getByTestId('composer-glyph');
    expect(glyph.getAttribute('data-glyph-value')).toBe('✎');
    const wrap = screen.getByTestId('composer-input-wrap');
    expect(wrap.getAttribute('data-panel-radius')).toBe('0');
    expect(wrap.getAttribute('style')).toContain('border-radius: 0px');
    expect(screen.getByTestId('composer-textarea').className).toContain('font-sans');
  });

  it('retro: > glyph + panelRadius=0 + font-mono', async () => {
    stubBridge();
    renderWithTheme('retro', <Composer channelId="c-plan" />);

    await waitFor(() =>
      expect(screen.getByTestId('composer').getAttribute('data-theme-variant')).toBe('retro'),
    );
    const glyph = screen.getByTestId('composer-glyph');
    expect(glyph.getAttribute('data-glyph-value')).toBe('>');
    const wrap = screen.getByTestId('composer-input-wrap');
    expect(wrap.getAttribute('data-panel-radius')).toBe('0');
    expect(screen.getByTestId('composer-textarea').className).toContain('font-mono');
  });
});

describe('Composer — readOnly branch', () => {
  it('readOnly=true → readonly badge rendered + textarea disabled + hints hidden', async () => {
    stubBridge();
    renderWithTheme(
      'warm',
      <Composer channelId="c-plan" readOnly />,
    );

    await waitFor(() =>
      expect(screen.getByTestId('composer').getAttribute('data-readonly')).toBe('true'),
    );
    expect(screen.getByTestId('composer-readonly-badge')).toBeTruthy();
    const textarea = screen.getByTestId('composer-textarea') as HTMLTextAreaElement;
    expect(textarea.disabled).toBe(true);
    expect(screen.queryByTestId('composer-hints')).toBeNull();
  });

  it('readOnly=false → hints rendered + textarea enabled', async () => {
    stubBridge();
    renderWithTheme('warm', <Composer channelId="c-plan" />);

    await waitFor(() =>
      expect(screen.getByTestId('composer').getAttribute('data-readonly')).toBe('false'),
    );
    expect(screen.queryByTestId('composer-readonly-badge')).toBeNull();
    expect(screen.getByTestId('composer-hints')).toBeTruthy();
    expect(screen.getByTestId('composer-hint-mention').textContent).toContain('@');
    expect(screen.getByTestId('composer-hint-command').textContent).toContain('⌘');
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
      'warm',
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

  it('Shift+Enter → does NOT invoke message:append (default newline)', async () => {
    const onAppend = vi.fn();
    stubBridge({ onAppend });
    renderWithTheme('warm', <Composer channelId="c-plan" />);

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
    renderWithTheme('warm', <Composer channelId="c-plan" />);

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
      'warm',
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
