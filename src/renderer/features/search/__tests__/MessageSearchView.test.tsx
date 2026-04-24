// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nextProvider } from 'react-i18next';
import i18next, { type i18n as I18next } from 'i18next';

import { MessageSearchView } from '../MessageSearchView';

function buildI18n(): I18next {
  const instance = i18next.createInstance();
  void instance.init({
    lng: 'ko',
    fallbackLng: 'ko',
    resources: {
      ko: {
        translation: {
          message: {
            search: {
              title: '메시지 검색',
              placeholder: '검색어를 입력하세요',
              loading: '검색 중…',
              empty: '검색 결과 없음',
              error: '검색 실패: {{msg}}',
              close: '닫기',
              dmLabel: 'DM',
              shortcutHint: 'Cmd/Ctrl+K',
              filter: {
                currentChannel: '현재 채널: #{{name}}',
                currentProject: '현재 프로젝트: {{name}}',
                noScope: '활성 프로젝트 없음',
              },
            },
          },
        },
      },
    },
    interpolation: { escapeValue: false },
  });
  return instance;
}

describe('MessageSearchView', () => {
  let onOpenChange: (open: boolean) => void;
  let onNavigate: (channelId: string, messageId: string) => void;
  let invoke: ReturnType<typeof vi.fn>;
  let onOpenChangeSpy: ReturnType<typeof vi.fn<(open: boolean) => void>>;
  let onNavigateSpy: ReturnType<
    typeof vi.fn<(channelId: string, messageId: string) => void>
  >;

  beforeEach(() => {
    onOpenChangeSpy = vi.fn<(open: boolean) => void>();
    onNavigateSpy = vi.fn<(channelId: string, messageId: string) => void>();
    onOpenChange = (open) => onOpenChangeSpy(open);
    onNavigate = (channelId, messageId) => onNavigateSpy(channelId, messageId);
    invoke = vi.fn();
    vi.stubGlobal('arena', { platform: 'linux', invoke });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders title + placeholder + scope label when open', () => {
    const i18n = buildI18n();
    render(
      <I18nextProvider i18n={i18n}>
        <MessageSearchView
          open
          onOpenChange={onOpenChange}
          activeProjectId="p1"
          activeChannelId="c1"
          activeProjectName="Alpha"
          activeChannelName="general"
          onNavigate={onNavigate}
        />
      </I18nextProvider>,
    );

    expect(screen.getByTestId('message-search-dialog')).toBeTruthy();
    expect(screen.getByTestId('message-search-input')).toBeTruthy();
    expect(
      screen.getByTestId('message-search-scope-toggle').textContent,
    ).toContain('#general');
  });

  it('falls back to currentProject scope when activeChannelId is null', () => {
    const i18n = buildI18n();
    render(
      <I18nextProvider i18n={i18n}>
        <MessageSearchView
          open
          onOpenChange={onOpenChange}
          activeProjectId="p1"
          activeChannelId={null}
          activeProjectName="Alpha"
          activeChannelName={null}
          onNavigate={onNavigate}
        />
      </I18nextProvider>,
    );
    expect(
      screen.getByTestId('message-search-scope-toggle').textContent,
    ).toContain('Alpha');
  });

  it('disables input when no active project or channel (global sentinel)', () => {
    const i18n = buildI18n();
    render(
      <I18nextProvider i18n={i18n}>
        <MessageSearchView
          open
          onOpenChange={onOpenChange}
          activeProjectId={null}
          activeChannelId={null}
          activeProjectName={null}
          activeChannelName={null}
          onNavigate={onNavigate}
        />
      </I18nextProvider>,
    );
    const input = screen.getByTestId(
      'message-search-input',
    ) as HTMLInputElement;
    expect(input.disabled).toBe(true);
  });

  it('invokes message:search with the active channel scope after debounce', async () => {
    invoke.mockResolvedValue({
      hits: [
        {
          id: 'm1',
          channelId: 'c1',
          meetingId: null,
          authorId: 'user',
          authorKind: 'user',
          role: 'user',
          content: 'hello',
          meta: null,
          createdAt: 1,
          rank: -2,
          snippet: '<mark>hi</mark>',
          channelName: 'general',
          projectName: 'Alpha',
        },
      ],
    });
    const i18n = buildI18n();
    render(
      <I18nextProvider i18n={i18n}>
        <MessageSearchView
          open
          onOpenChange={onOpenChange}
          activeProjectId="p1"
          activeChannelId="c1"
          activeProjectName="Alpha"
          activeChannelName="general"
          onNavigate={onNavigate}
        />
      </I18nextProvider>,
    );

    const input = screen.getByTestId(
      'message-search-input',
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'hi' } });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 250));
    });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        'message:search',
        expect.objectContaining({
          query: 'hi',
          scope: { kind: 'channel', channelId: 'c1' },
        }),
      );
    });
  });

  it('clicking a result fires onNavigate + closes the dialog', async () => {
    invoke.mockResolvedValue({
      hits: [
        {
          id: 'msg-42',
          channelId: 'ch-7',
          meetingId: null,
          authorId: 'user',
          authorKind: 'user',
          role: 'user',
          content: 'found',
          meta: null,
          createdAt: 1,
          rank: -2,
          snippet: '<mark>found</mark>',
          channelName: 'random',
          projectName: 'Alpha',
        },
      ],
    });
    const i18n = buildI18n();
    render(
      <I18nextProvider i18n={i18n}>
        <MessageSearchView
          open
          onOpenChange={onOpenChange}
          activeProjectId="p1"
          activeChannelId="c1"
          activeProjectName="Alpha"
          activeChannelName="general"
          onNavigate={onNavigate}
        />
      </I18nextProvider>,
    );

    fireEvent.change(screen.getByTestId('message-search-input'), {
      target: { value: 'found' },
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 250));
    });
    await waitFor(() => {
      expect(screen.queryByTestId('search-result-row')).not.toBeNull();
    });

    fireEvent.click(screen.getByTestId('search-result-row'));
    expect(onNavigateSpy).toHaveBeenCalledWith('ch-7', 'msg-42');
    expect(onOpenChangeSpy).toHaveBeenCalledWith(false);
  });

  it('renders empty state when no hits for a non-empty query', async () => {
    invoke.mockResolvedValue({ hits: [] });
    const i18n = buildI18n();
    render(
      <I18nextProvider i18n={i18n}>
        <MessageSearchView
          open
          onOpenChange={onOpenChange}
          activeProjectId="p1"
          activeChannelId="c1"
          activeProjectName="Alpha"
          activeChannelName="general"
          onNavigate={onNavigate}
        />
      </I18nextProvider>,
    );

    fireEvent.change(screen.getByTestId('message-search-input'), {
      target: { value: 'nothing' },
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 250));
    });

    await waitFor(() =>
      expect(screen.getByTestId('message-search-empty')).toBeTruthy(),
    );
  });
});
