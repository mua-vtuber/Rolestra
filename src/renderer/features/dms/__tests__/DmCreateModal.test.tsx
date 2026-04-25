// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nextProvider } from 'react-i18next';
import i18next, { type i18n as I18next } from 'i18next';

import { DmCreateModal } from '../DmCreateModal';

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
          },
        },
      },
    },
    interpolation: { escapeValue: false },
  });
  return instance;
}

describe('DmCreateModal', () => {
  let invoke: ReturnType<typeof vi.fn>;
  let onCreatedSpy: ReturnType<typeof vi.fn<(ch: { id: string }) => void>>;
  let onOpenChangeSpy: ReturnType<typeof vi.fn<(open: boolean) => void>>;
  let onCreated: (ch: { id: string }) => void;
  let onOpenChange: (open: boolean) => void;

  beforeEach(() => {
    invoke = vi.fn().mockResolvedValue({
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
    onCreatedSpy = vi.fn<(ch: { id: string }) => void>();
    onOpenChangeSpy = vi.fn<(open: boolean) => void>();
    onCreated = (ch) => onCreatedSpy(ch);
    onOpenChange = (open: boolean) => onOpenChangeSpy(open);
    vi.stubGlobal('arena', { platform: 'linux', invoke });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders title + provider list with exists flag', async () => {
    const i18n = buildI18n();
    render(
      <I18nextProvider i18n={i18n}>
        <DmCreateModal open onOpenChange={onOpenChange} onCreated={onCreated} />
      </I18nextProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId('dm-create-dialog')).toBeTruthy(),
    );

    const claudeBtn = await screen.findByTestId('dm-create-provider-claude');
    const codexBtn = screen.getByTestId('dm-create-provider-codex');
    expect(claudeBtn.getAttribute('data-exists')).toBe('false');
    expect(codexBtn.getAttribute('data-exists')).toBe('true');
    expect((codexBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('calls dm:create + onCreated + closes modal on click', async () => {
    invoke
      .mockResolvedValueOnce({
        items: [
          {
            providerId: 'claude',
            providerName: 'Claude',
            channel: null,
            exists: false,
          },
        ],
      })
      .mockResolvedValueOnce({
        channel: {
          id: 'ch-claude',
          projectId: null,
          name: 'dm:claude',
          kind: 'dm',
          readOnly: false,
          createdAt: 1,
        },
      });

    const i18n = buildI18n();
    render(
      <I18nextProvider i18n={i18n}>
        <DmCreateModal open onOpenChange={onOpenChange} onCreated={onCreated} />
      </I18nextProvider>,
    );

    const claudeBtn = await screen.findByTestId('dm-create-provider-claude');
    fireEvent.click(claudeBtn);

    await waitFor(() => expect(onCreatedSpy).toHaveBeenCalledTimes(1));
    expect(invoke).toHaveBeenNthCalledWith(2, 'dm:create', {
      providerId: 'claude',
    });
    expect(onOpenChangeSpy).toHaveBeenCalledWith(false);
  });

  it('shows error banner when dm:create throws a duplicate error', async () => {
    invoke
      .mockResolvedValueOnce({
        items: [
          {
            providerId: 'claude',
            providerName: 'Claude',
            channel: null,
            exists: false,
          },
        ],
      })
      .mockRejectedValueOnce(new Error('DuplicateDmError: ...'));

    const i18n = buildI18n();
    render(
      <I18nextProvider i18n={i18n}>
        <DmCreateModal open onOpenChange={onOpenChange} onCreated={onCreated} />
      </I18nextProvider>,
    );

    const claudeBtn = await screen.findByTestId('dm-create-provider-claude');
    fireEvent.click(claudeBtn);

    const err = await screen.findByTestId('dm-create-error');
    expect(err.textContent).toContain('이미 DM 있음');
    expect(onCreatedSpy).not.toHaveBeenCalled();
  });

  it('shows generic error banner when dm:create throws other errors', async () => {
    invoke
      .mockResolvedValueOnce({
        items: [
          {
            providerId: 'claude',
            providerName: 'Claude',
            channel: null,
            exists: false,
          },
        ],
      })
      .mockRejectedValueOnce(new Error('database is locked'));

    const i18n = buildI18n();
    render(
      <I18nextProvider i18n={i18n}>
        <DmCreateModal open onOpenChange={onOpenChange} onCreated={onCreated} />
      </I18nextProvider>,
    );

    fireEvent.click(await screen.findByTestId('dm-create-provider-claude'));

    const err = await screen.findByTestId('dm-create-error');
    expect(err.textContent).toContain('database is locked');
  });

  it('does nothing when clicking an exists=true row', async () => {
    const i18n = buildI18n();
    render(
      <I18nextProvider i18n={i18n}>
        <DmCreateModal open onOpenChange={onOpenChange} onCreated={onCreated} />
      </I18nextProvider>,
    );

    const codexBtn = await screen.findByTestId('dm-create-provider-codex');
    fireEvent.click(codexBtn);

    // Only the initial dm:list invocation — no dm:create.
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('dm:list', undefined);
    expect(onCreatedSpy).not.toHaveBeenCalled();
  });
});
