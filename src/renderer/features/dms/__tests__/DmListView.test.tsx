// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nextProvider } from 'react-i18next';
import i18next, { type i18n as I18next } from 'i18next';

import { DmListView } from '../DmListView';

function buildI18n(): I18next {
  const instance = i18next.createInstance();
  void instance.init({
    lng: 'ko',
    fallbackLng: 'ko',
    resources: {
      ko: {
        translation: {
          dm: {
            alreadyExists: '이미 DM 있음',
            createError: 'DM 생성 실패: {{msg}}',
            create: {
              body: '본문',
              close: '닫기',
              existsBadge: '이미 있음',
              loading: '불러오는 중',
              newBadge: '새로 만들기',
              title: '새 DM 시작',
            },
            empty: 'DM 없음',
            listTitle: 'DM',
            loading: '불러오는 중',
            newDm: '새 DM',
          },
        },
      },
    },
    interpolation: { escapeValue: false },
  });
  return instance;
}

describe('DmListView', () => {
  let invoke: ReturnType<typeof vi.fn>;
  let onSelectSpy: ReturnType<typeof vi.fn<(channelId: string) => void>>;
  let onSelectDm: (channelId: string) => void;

  beforeEach(() => {
    invoke = vi.fn();
    onSelectSpy = vi.fn<(channelId: string) => void>();
    onSelectDm = (channelId) => onSelectSpy(channelId);
    vi.stubGlobal('arena', { platform: 'linux', invoke });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows empty state when no DMs exist', async () => {
    invoke.mockResolvedValue({
      items: [
        {
          providerId: 'claude',
          providerName: 'Claude',
          channel: null,
          exists: false,
        },
      ],
    });
    const i18n = buildI18n();
    render(
      <I18nextProvider i18n={i18n}>
        <DmListView activeChannelId={null} onSelectDm={onSelectDm} />
      </I18nextProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId('dm-list-empty')).toBeTruthy(),
    );
  });

  it('renders existing DMs only and marks active', async () => {
    invoke.mockResolvedValue({
      items: [
        {
          providerId: 'claude',
          providerName: 'Claude',
          channel: null,
          exists: false,
        },
        {
          providerId: 'codex',
          providerName: 'Codex',
          channel: {
            id: 'ch-codex',
            projectId: null,
            name: 'dm:codex',
            kind: 'dm',
            readOnly: false,
            createdAt: 1,
          },
          exists: true,
        },
      ],
    });
    const i18n = buildI18n();
    render(
      <I18nextProvider i18n={i18n}>
        <DmListView activeChannelId="ch-codex" onSelectDm={onSelectDm} />
      </I18nextProvider>,
    );

    const row = await screen.findByTestId('dm-list-item-codex');
    expect(row.getAttribute('data-active')).toBe('true');
    expect(screen.queryByTestId('dm-list-item-claude')).toBeNull();
  });

  it('calls onSelectDm(channelId) on row click', async () => {
    invoke.mockResolvedValue({
      items: [
        {
          providerId: 'codex',
          providerName: 'Codex',
          channel: {
            id: 'ch-codex',
            projectId: null,
            name: 'dm:codex',
            kind: 'dm',
            readOnly: false,
            createdAt: 1,
          },
          exists: true,
        },
      ],
    });
    const i18n = buildI18n();
    render(
      <I18nextProvider i18n={i18n}>
        <DmListView activeChannelId={null} onSelectDm={onSelectDm} />
      </I18nextProvider>,
    );

    fireEvent.click(await screen.findByTestId('dm-list-item-codex'));
    expect(onSelectSpy).toHaveBeenCalledWith('ch-codex');
  });

  it('clicking + opens the DmCreateModal', async () => {
    invoke.mockResolvedValue({ items: [] });
    const i18n = buildI18n();
    render(
      <I18nextProvider i18n={i18n}>
        <DmListView activeChannelId={null} onSelectDm={onSelectDm} />
      </I18nextProvider>,
    );

    fireEvent.click(screen.getByTestId('dm-list-new-button'));
    await waitFor(() =>
      expect(screen.getByTestId('dm-create-dialog')).toBeTruthy(),
    );
  });
});
