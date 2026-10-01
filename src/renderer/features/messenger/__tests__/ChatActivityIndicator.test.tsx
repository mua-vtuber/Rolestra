// @vitest-environment jsdom

import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ChatActivityIndicator } from '../ChatActivityIndicator';
import { i18next } from '../../../i18n';
import { useChatActivityStore } from '../../../stores/chat-activity-store';
import { ThemeProvider } from '../../../theme/theme-provider';
import { DEFAULT_MODE, DEFAULT_THEME, useThemeStore } from '../../../theme/theme-store';

const names = new Map([['ai-a', 'Alice'], ['ai-b', 'Bob'], ['ai-c', 'Carol']]);

beforeEach(() => {
  useChatActivityStore.getState().reset();
  void i18next.changeLanguage('ko');
});
afterEach(() => cleanup());

describe('ChatActivityIndicator (spec 2026-10-01 F5)', () => {
  it('announces who is writing, whispering or waiting, by snapshot name, politely', () => {
    render(<ChatActivityIndicator channelId="room" names={names} />);
    const line = screen.getByTestId('chat-activity-indicator');
    expect(line.getAttribute('role')).toBe('status');
    expect(line.getAttribute('aria-live')).toBe('polite');
    expect(line.hasAttribute('aria-label')).toBe(false);
    expect(line.textContent).toBe('');

    act(() => useChatActivityStore.getState().apply({ channelId: 'room', providerId: 'ai-a', phase: 'writing', kind: 'turn' }));
    expect(line.textContent).toBe('Alice 입력 중…');

    act(() => {
      const { apply } = useChatActivityStore.getState();
      apply({ channelId: 'room', providerId: 'ai-a', phase: 'idle', kind: 'turn' });
      apply({ channelId: 'room', providerId: 'ai-b', phase: 'writing', kind: 'whisper', peerProviderId: 'ai-a' });
    });
    expect(line.textContent).toBe('Bob → Alice 귓속말 입력 중…');

    act(() => {
      const { apply } = useChatActivityStore.getState();
      apply({ channelId: 'room', providerId: 'ai-b', phase: 'idle', kind: 'whisper', peerProviderId: 'ai-a' });
      apply({ channelId: 'room', providerId: 'ai-c', phase: 'queued', kind: 'turn' });
      apply({ channelId: 'other', providerId: 'ai-a', phase: 'writing', kind: 'turn' });
    });
    expect(line.textContent).toBe('Carol 대기 중…');

    act(() => useChatActivityStore.getState().apply({ channelId: 'room', providerId: 'ai-c', phase: 'idle', kind: 'turn' }));
    expect(line.textContent).toBe('');
  });

  it('never shows a raw provider id and speaks English when the app does', () => {
    void i18next.changeLanguage('en');
    render(<ChatActivityIndicator channelId="room" names={names} />);
    act(() => useChatActivityStore.getState().apply({ channelId: 'room', providerId: 'ai-gone', phase: 'writing', kind: 'whisper', peerProviderId: 'ai-b' }));
    const line = screen.getByTestId('chat-activity-indicator');
    expect(line.textContent).toBe('Unknown participant → Bob is writing a whisper…');
    expect(line.textContent).not.toContain('ai-gone');
  });
});

describe('ChatActivityIndicator — log layout (spec 2026-10-01-messenger-redesign.md R3-6)', () => {
  afterEach(() => useThemeStore.setState({ themeKey: DEFAULT_THEME, mode: DEFAULT_MODE }));

  it('writes "* 이름 입력 중…" with a cursor block instead of the dots bubble', () => {
    useThemeStore.setState({ themeKey: 'retro', mode: 'dark' });
    render(<ThemeProvider><ChatActivityIndicator channelId="room" names={names} /></ThemeProvider>);
    const line = screen.getByTestId('chat-activity-indicator');
    act(() => useChatActivityStore.getState().apply({ channelId: 'room', providerId: 'ai-a', phase: 'writing', kind: 'turn' }));
    expect(line.textContent).toBe('* Alice 입력 중…');
    expect(line.querySelector('[aria-hidden="true"].bg-brand')).not.toBeNull();
  });
});
