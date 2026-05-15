// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IdeaPickCard } from '../IdeaPickCard';
import { i18next } from '../../../i18n';
import { ThemeProvider } from '../../../theme/theme-provider';
import {
  DEFAULT_MODE,
  DEFAULT_THEME,
  useThemeStore,
} from '../../../theme/theme-store';
import type { StreamIdeaPickSnapshotPayload } from '../../../../shared/stream-events';

const SNAPSHOT: StreamIdeaPickSnapshotPayload = {
  meetingId: 'meeting-idea-1',
  channelId: 'channel-idea-1',
  cards: [
    {
      uuid: 'op-1',
      screenId: 'ITEM_001',
      title: '문서 자동 정리',
      content: '흩어진 회의 내용을 하나의 실행 문서로 묶는다.',
      rationale: '초기 기획 속도를 줄인다.',
      authorLabel: 'codex_1',
    },
    {
      uuid: 'op-2',
      screenId: 'ITEM_002',
      title: '검토 알림',
      content: '사용자가 확인해야 하는 지점만 알림으로 보여준다.',
      rationale: '자동 흐름과 안전 승인 경계를 분리한다.',
      authorLabel: 'claude_1',
    },
  ],
  selectedScreenIds: [],
};

function installArenaStub(): ReturnType<typeof vi.fn> {
  const invoke = vi.fn(async (channel: string) => {
    if (channel === 'meeting:idea-finalize-selection') {
      return {
        ok: true,
        agreedIds: ['op-1'],
        excludedIds: ['op-2'],
        userOpinionId: null,
      };
    }
    if (channel === 'meeting:idea-request-more') {
      return {
        ok: true,
        selectedIds: ['op-1'],
        userOpinionId: 'op-user-1',
      };
    }
    throw new Error(`unexpected IPC channel ${channel}`);
  });
  vi.stubGlobal('arena', {
    platform: 'linux',
    invoke,
    onStream: () => () => undefined,
  });
  return invoke;
}

function renderCard(
  snapshot: StreamIdeaPickSnapshotPayload = SNAPSHOT,
): ReturnType<typeof render> {
  return render(
    <ThemeProvider>
      <IdeaPickCard snapshot={snapshot} />
    </ThemeProvider>,
  );
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

describe('IdeaPickCard', () => {
  it('blocks both actions until the user selects a card or writes an opinion', () => {
    installArenaStub();
    renderCard();

    expect(
      (screen.getByTestId('idea-pick-request-more') as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByTestId('idea-pick-approve') as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('final approval invokes meeting:idea-finalize-selection with selected ids and comment', async () => {
    const user = userEvent.setup();
    const invoke = installArenaStub();
    renderCard();

    await user.click(screen.getAllByTestId('idea-pick-option')[0]!);
    await user.type(
      screen.getByTestId('idea-pick-comment'),
      '이 아이디어로 기획을 시작합니다.',
    );
    await user.click(screen.getByTestId('idea-pick-approve'));

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('meeting:idea-finalize-selection', {
        meetingId: 'meeting-idea-1',
        selectedScreenIds: ['ITEM_001'],
        userComment: '이 아이디어로 기획을 시작합니다.',
      }),
    );
    expect(screen.getByTestId('idea-pick-success').textContent).toContain(
      '기획 부서',
    );
  });

  it('request-more keeps preselected cards and calls meeting:idea-request-more', async () => {
    const user = userEvent.setup();
    const invoke = installArenaStub();
    renderCard({
      ...SNAPSHOT,
      selectedScreenIds: ['ITEM_002'],
    });

    expect(screen.getByTestId('idea-pick-kept-list').textContent).toContain(
      '검토 알림',
    );
    await user.type(
      screen.getByTestId('idea-pick-comment'),
      '선택은 유지하고 더 모아주세요.',
    );
    await user.click(screen.getByTestId('idea-pick-request-more'));

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('meeting:idea-request-more', {
        meetingId: 'meeting-idea-1',
        selectedScreenIds: ['ITEM_002'],
        userComment: '선택은 유지하고 더 모아주세요.',
      }),
    );
    expect(
      screen.getByTestId('idea-pick-more-requested').textContent,
    ).toContain('추가');
  });
});
