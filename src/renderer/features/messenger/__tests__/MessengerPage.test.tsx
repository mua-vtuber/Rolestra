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

// ── jsdom polyfills for Radix (Task 10 CRUD modals) ───────────────
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
      case 'meeting:list-active':
        return { meetings: [] };
      case 'message:list-by-channel':
        return { messages: [] };
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

  // R12-C 정리 #8 (2026-05-03): R12-C T8 사이드바 land 후 MessengerPage 는
  // 2 pane (Thread + MemberPanel) 로 축소되고 ChannelRail 은 사이드바로
  // 흡수됐다. 옛 3 pane 검증 it 를 새 2 pane 단위 it 로 통째 대체.
  // ChannelCreateModal 트리거 테스트는 App.test.tsx 의
  // "+ 새 채널 inside an expanded project opens the ChannelCreateModal" it
  // 이 사이드바 기준으로 흡수했으므로 본 파일에서는 제거.
  it('renders the 2 panes (Thread + MemberPanel) when an active project is selected', () => {
    stubEmptyChannelBridge();
    useActiveProjectStore.setState({ activeProjectId: 'p-a' });

    render(<MessengerPage />);

    const page = screen.getByTestId('messenger-page');
    expect(page.getAttribute('data-empty')).toBe('false');

    expect(screen.getByTestId('messenger-thread')).toBeTruthy();
    expect(screen.getByTestId('messenger-member-panel')).toBeTruthy();
    expect(screen.queryByTestId('messenger-empty-state')).toBeNull();

    // 사이드바로 흡수된 옛 3 pane 잔재 testid 는 더 이상 존재하지 않는다.
    expect(screen.queryByTestId('messenger-channel-rail')).toBeNull();
    expect(screen.queryByTestId('channel-rail')).toBeNull();
    expect(screen.queryByTestId('channel-rail-create')).toBeNull();
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
