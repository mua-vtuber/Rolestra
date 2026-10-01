// @vitest-environment jsdom

/**
 * SystemMessage (spec 2026-10-01-messenger-redesign.md R3-5) — a notice
 * row (silence, all-silent, failure, pass): a centered band in the bubble
 * layout, a `* 문구` line in the log layout (leading emoji dropped), plus
 * the hex guard and the translated notice codes.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { SystemMessage } from '../SystemMessage';
import { i18next } from '../../../i18n';
import { ThemeProvider } from '../../../theme/theme-provider';
import {
  DEFAULT_MODE,
  DEFAULT_THEME,
  useThemeStore,
} from '../../../theme/theme-store';
import type { ThemeKey } from '../../../theme/theme-tokens';
import type { Message as ChannelMessage } from '../../../../shared/message-types';

function makeSystemMessage(
  overrides: Partial<ChannelMessage> = {},
): ChannelMessage {
  return {
    id: 'm-sys-1',
    channelId: 'c-sys',
    meetingId: null,
    authorId: 'system',
    authorKind: 'system',
    role: 'system',
    content: '새 프로젝트가 생성되었습니다.',
    meta: null,
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

afterEach(() => {
  cleanup();
  useThemeStore.setState({ themeKey: DEFAULT_THEME, mode: DEFAULT_MODE });
});

describe('SystemMessage — layout shape', () => {
  it('tactical: a centered band in the notice colors, content as-is', () => {
    renderWithTheme(
      'tactical',
      <SystemMessage message={makeSystemMessage()} />,
    );
    const root = screen.getByTestId('system-message');
    expect(root.getAttribute('data-theme-variant')).toBe('tactical');
    expect(root.className).toContain('justify-center');

    const body = screen.getByTestId('system-message-body');
    expect(body.getAttribute('data-shape')).toBe('band');
    expect(body.className).toContain('bg-notice-bg');
    expect(body.textContent).toBe('새 프로젝트가 생성되었습니다.');
  });

  it('retro: a "* 문구" log line', () => {
    renderWithTheme(
      'retro',
      <SystemMessage message={makeSystemMessage()} />,
    );
    const root = screen.getByTestId('system-message');
    expect(root.getAttribute('data-theme-variant')).toBe('retro');

    const body = screen.getByTestId('system-message-body');
    expect(body.getAttribute('data-shape')).toBe('log-star');
    expect(body.textContent).toBe('* 새 프로젝트가 생성되었습니다.');
  });
});

describe('SystemMessage — the log layout strips a leading emoji prefix', () => {
  it.each([
    '📌 공지사항이 있습니다.',
    '🗳 투표가 시작되었습니다.',
    '✅ 승인이 완료되었습니다.',
  ])('strips emoji from "%s"', (content) => {
    renderWithTheme(
      'retro',
      <SystemMessage message={makeSystemMessage({ content })} />,
    );
    const body = screen.getByTestId('system-message-body');
    expect(body.textContent?.startsWith('* ')).toBe(true);
    expect(body.textContent).not.toContain('📌');
    expect(body.textContent).not.toContain('🗳');
    expect(body.textContent).not.toContain('✅');
  });

  it('the bubble layout keeps the emoji prefix intact', () => {
    renderWithTheme(
      'tactical',
      <SystemMessage
        message={makeSystemMessage({ content: '📌 공지사항' })}
      />,
    );
    expect(screen.getByTestId('system-message-body').textContent).toBe(
      '📌 공지사항',
    );
  });
});

describe('SystemMessage — source-level hex color literal guard', () => {
  it('SystemMessage.tsx contains zero hex color literals', () => {
    const source = readFileSync(
      resolve(__dirname, '..', 'SystemMessage.tsx'),
      'utf-8',
    );
    expect(source.match(/#[0-9a-fA-F]{3,6}\b/g)).toBeNull();
  });
});

describe('SystemMessage — sanitized group errors', () => {
  it.each([
    ['ko', '루나: 지쳐서 응답할 수 없습니다. 사용량 한도에 도달했습니다.'],
    ['en', '루나 is too exhausted to respond. The usage limit has been reached.'],
  ])('names the exhausted AI in %s without exposing technical output', async (language, expected) => {
    await i18next.changeLanguage(language);
    renderWithTheme('tactical', <SystemMessage message={makeSystemMessage({
      authorId: 'p-claude', authorKind: 'member', content: 'raw CLI quota output',
      meta: { chatError: 'usage_limit', chatErrorSpeakerName: '루나', chatErrorDetail: 'technical CLI output' },
    })} />);
    expect(screen.getByTestId('system-message-body').textContent).toBe(expected);
  });

  it.each([undefined, '   '])('uses the generic AI name when the stored name is %j', async (name) => {
    await i18next.changeLanguage('ko');
    renderWithTheme('tactical', <SystemMessage message={makeSystemMessage({
      content: 'usage_limit', meta: { chatError: 'usage_limit', chatErrorSpeakerName: name },
    })} />);
    expect(screen.getByTestId('system-message-body').textContent)
      .toBe('AI: 지쳐서 응답할 수 없습니다. 사용량 한도에 도달했습니다.');
  });

  it('translates the persisted code instead of displaying provider output', () => {
    void i18next.changeLanguage('ko');
    renderWithTheme('tactical', <SystemMessage message={makeSystemMessage({
      content: 'provider secret should never show', meta: { chatError: 'invalid_response' },
    })} />);
    expect(screen.getByTestId('system-message-body').textContent).toContain('응답 형식');
    expect(screen.getByTestId('system-message-body').textContent).not.toContain('provider secret');
  });

  it('adds the short DM cause after the translated failure text', () => {
    void i18next.changeLanguage('ko');
    renderWithTheme('tactical', <SystemMessage message={makeSystemMessage({
      authorId: 'p-claude', authorKind: 'member', content: 'provider_error',
      meta: { chatError: 'provider_error', chatErrorDetail: 'rate limited' },
    })} />);
    expect(screen.getByTestId('system-message-body').textContent)
      .toBe('AI 응답에 실패했습니다. (원인: rate limited)');
    cleanup();
    void i18next.changeLanguage('en');
    renderWithTheme('tactical', <SystemMessage message={makeSystemMessage({
      authorId: 'p-claude', authorKind: 'member', content: 'provider_error',
      meta: { chatError: 'provider_error', chatErrorDetail: 'rate limited' },
    })} />);
    expect(screen.getByTestId('system-message-body').textContent)
      .toBe('An AI response failed. (Cause: rate limited)');
    void i18next.changeLanguage('ko');
  });
});

describe('SystemMessage — silence notices (W4)', () => {
  it.each(['tactical', 'retro'] as const)('shows a quiet, non-error line in %s', (theme) => {
    void i18next.changeLanguage('ko');
    renderWithTheme(theme, <SystemMessage message={makeSystemMessage({
      authorId: 'p-claude', authorKind: 'member', content: 'turn_passed',
      meta: { chatSilence: { code: 'turn_passed', speakerName: '루나' } },
    })} />);
    expect(screen.getByTestId('system-message').getAttribute('data-tone')).toBe('quiet');
    expect(screen.getByTestId('system-message-body').getAttribute('data-shape')).toBe(theme === 'retro' ? 'log-star' : 'band');
    expect(screen.getByTestId('system-message-body').textContent).toContain('루나은(는) 이번에 말하지 않았습니다');
    expect(screen.getByTestId('system-message-body').textContent).not.toContain('turn_passed');
  });

  it('names who declined to reply, in ko and en', () => {
    void i18next.changeLanguage('ko');
    const notice = makeSystemMessage({
      authorId: 'p-claude', authorKind: 'member', content: 'reply_passed',
      meta: { chatSilence: { code: 'reply_passed', speakerName: 'Bob' } },
    });
    renderWithTheme('tactical', <SystemMessage message={notice} />);
    expect(screen.getByTestId('system-message-body').textContent).toBe('Bob은(는) 답장하지 않았습니다');
    cleanup();
    void i18next.changeLanguage('en');
    renderWithTheme('tactical', <SystemMessage message={notice} />);
    expect(screen.getByTestId('system-message-body').textContent).toBe('Bob chose not to reply.');
    expect(screen.getByTestId('system-message').getAttribute('data-tone')).toBe('quiet');
    void i18next.changeLanguage('ko');
  });

  it('shows the all-silent round notice as a quiet line with no name, in ko and en (F3)', () => {
    void i18next.changeLanguage('ko');
    const notice = makeSystemMessage({
      content: 'round_all_silent', meta: { chatSilence: { code: 'round_all_silent' } },
    });
    renderWithTheme('tactical', <SystemMessage message={notice} />);
    expect(screen.getByTestId('system-message-body').textContent).toBe('모두 조용해졌습니다');
    expect(screen.getByTestId('system-message').getAttribute('data-tone')).toBe('quiet');
    cleanup();
    void i18next.changeLanguage('en');
    renderWithTheme('tactical', <SystemMessage message={notice} />);
    expect(screen.getByTestId('system-message-body').textContent).toBe('Everyone has gone quiet.');
    void i18next.changeLanguage('ko');
  });

  it('keeps failure notices at the normal tone', () => {
    renderWithTheme('tactical', <SystemMessage message={makeSystemMessage({
      content: 'timeout', meta: { chatError: 'timeout' },
    })} />);
    expect(screen.getByTestId('system-message').getAttribute('data-tone')).toBe('normal');
  });
});
