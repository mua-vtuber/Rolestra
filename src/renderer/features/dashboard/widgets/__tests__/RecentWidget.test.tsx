// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RecentMessage } from '../../../../../shared/message-types';
import { DEFAULT_MODE, DEFAULT_THEME, useThemeStore } from '../../../../theme/theme-store';
import { ThemeProvider } from '../../../../theme/theme-provider';
import '../../../../i18n';
import { i18next } from '../../../../i18n';

type HookState = {
  messages: RecentMessage[] | null;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
};

const state: HookState = {
  messages: null,
  loading: true,
  error: null,
  refresh: async () => {},
};

vi.mock('../../../../hooks/use-recent-messages', () => ({
  useRecentMessages: (): HookState => state,
}));

import { RecentWidget } from '../RecentWidget';

const MSG_USER: RecentMessage = {
  id: 'm-1',
  channelId: 'c1',
  channelName: 'general',
  senderId: 'user',
  senderKind: 'user',
  senderLabel: 'user',
  excerpt: 'hello team',
  createdAt: 1700000000000,
};

const MSG_MEMBER: RecentMessage = {
  ...MSG_USER,
  id: 'm-2',
  senderId: 'p-1',
  senderKind: 'member',
  senderLabel: 'Alpha',
  excerpt: 'on it',
};

function renderWidget() {
  return render(
    <ThemeProvider>
      <RecentWidget />
    </ThemeProvider>,
  );
}

beforeEach(() => {
  state.messages = null;
  state.loading = true;
  state.error = null;
  void i18next.changeLanguage('ko');
});

afterEach(() => {
  cleanup();
  useThemeStore.setState({ themeKey: DEFAULT_THEME, mode: DEFAULT_MODE });
});

describe('RecentWidget', () => {
  it('loading state', () => {
    state.messages = null;
    state.loading = true;
    renderWidget();
    expect(screen.getByTestId('recent-widget-loading')).toBeTruthy();
  });

  it('error state shows the message under role=alert', () => {
    state.messages = null;
    state.loading = false;
    state.error = new Error('ipc lost');
    renderWidget();
    expect(screen.getByRole('alert').textContent).toContain('ipc lost');
  });

  it('empty state', () => {
    state.messages = [];
    state.loading = false;
    renderWidget();
    expect(screen.getByTestId('recent-widget-empty')).toBeTruthy();
  });

  it('populated: user sender uses localized "나", member sender uses their label', () => {
    state.messages = [MSG_USER, MSG_MEMBER];
    state.loading = false;
    renderWidget();

    const rows = screen.getAllByTestId('recent-widget-row');
    expect(rows).toHaveLength(2);
    expect(rows[0].getAttribute('data-message-id')).toBe('m-1');

    // ko "나" for the user message, raw label for the member message.
    expect(rows[0].textContent).toContain('나');
    expect(rows[1].textContent).toContain('Alpha');

    // Channel name rendered with leading `#`.
    expect(rows[0].textContent).toContain('#general');
  });
});
