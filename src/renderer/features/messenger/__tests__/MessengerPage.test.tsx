// @vitest-environment jsdom

/**
 * MessengerPage skeleton (R5-Task3) — unit tests.
 *
 * 이 스펙은 3-pane 구조 + active project 유무 분기 + hex literal 금지 3 가지만
 * 본다. Rail/Thread/MemberPanel의 실제 구현은 Task 4~9에서 대체한다.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MessengerPage } from '../MessengerPage';
import { i18next } from '../../../i18n';
import {
  ACTIVE_PROJECT_STORAGE_KEY,
  useActiveProjectStore,
} from '../../../stores/active-project-store';
import {
  ACTIVE_CHANNEL_STORAGE_KEY,
  useActiveChannelStore,
} from '../../../stores/active-channel-store';

function resetStore(): void {
  useActiveProjectStore.setState({ activeProjectId: null });
  localStorage.removeItem(ACTIVE_PROJECT_STORAGE_KEY);
  useActiveChannelStore.setState({ channelIdByProject: {} });
  localStorage.removeItem(ACTIVE_CHANNEL_STORAGE_KEY);
}

function stubEmptyChannelBridge(): void {
  const invoke = vi.fn(async (channel: string) => {
    switch (channel) {
      case 'channel:list':
        return { channels: [] };
      case 'member:list':
        return { members: [] };
      default:
        throw new Error(`no mock for channel ${channel}`);
    }
  });
  vi.stubGlobal('arena', { platform: 'linux', invoke });
}

beforeEach(() => {
  vi.unstubAllGlobals();
  resetStore();
  void i18next.changeLanguage('ko');
});

afterEach(() => {
  cleanup();
  resetStore();
  vi.unstubAllGlobals();
});

describe('MessengerPage — empty / active rendering (R5-Task3)', () => {
  it('renders an empty-state notice when there is no active project', () => {
    render(<MessengerPage />);

    const page = screen.getByTestId('messenger-page');
    expect(page.getAttribute('data-empty')).toBe('true');

    const empty = screen.getByTestId('messenger-empty-state');
    expect(empty.textContent).toContain('프로젝트를 선택');
    // 3 pane은 empty 상태에서 존재하지 않는다.
    expect(screen.queryByTestId('messenger-channel-rail')).toBeNull();
    expect(screen.queryByTestId('messenger-thread')).toBeNull();
    expect(screen.queryByTestId('messenger-member-panel')).toBeNull();
  });

  it('renders all 3 panes when an active project is selected', () => {
    stubEmptyChannelBridge();
    useActiveProjectStore.setState({ activeProjectId: 'p-a' });

    render(<MessengerPage />);

    const page = screen.getByTestId('messenger-page');
    expect(page.getAttribute('data-empty')).toBe('false');

    expect(screen.getByTestId('messenger-channel-rail')).toBeTruthy();
    expect(screen.getByTestId('messenger-thread')).toBeTruthy();
    expect(screen.getByTestId('messenger-member-panel')).toBeTruthy();
    expect(screen.queryByTestId('messenger-empty-state')).toBeNull();
    // Task 4: ChannelRail 이 실제로 마운트되어야 한다.
    expect(screen.getByTestId('channel-rail')).toBeTruthy();
  });
});

describe('MessengerPage — source-level hardcoded color guard', () => {
  it('MessengerPage.tsx contains zero hex color literals', () => {
    const source = readFileSync(
      resolve(__dirname, '..', 'MessengerPage.tsx'),
      'utf-8',
    );
    expect(source.match(/#[0-9a-fA-F]{3,6}\b/g)).toBeNull();
  });
});
