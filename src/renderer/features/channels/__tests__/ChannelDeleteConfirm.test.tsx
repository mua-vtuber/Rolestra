// @vitest-environment jsdom

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

// ── jsdom polyfills ─────────────────────────────────────────────────
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

import type { Channel } from '../../../../shared/channel-types';
import { DEFAULT_MODE, DEFAULT_THEME, useThemeStore } from '../../../theme/theme-store';
import { ThemeProvider } from '../../../theme/theme-provider';
import '../../../i18n';
import { i18next } from '../../../i18n';

// ── invoke mock ─────────────────────────────────────────────────────
interface InvokeCall {
  channel: string;
  data: unknown;
}
const invokeCalls: InvokeCall[] = [];
let invokeReject: Error | null = null;

vi.mock('../../../ipc/invoke', () => ({
  invoke: async (channel: string, data: unknown) => {
    invokeCalls.push({ channel, data });
    if (invokeReject) throw invokeReject;
    return { success: true };
  },
}));

import { ChannelDeleteConfirm } from '../ChannelDeleteConfirm';

function renderWithTheme(ui: React.ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

const USER_CH: Channel = {
  id: 'ch-1',
  projectId: 'p-1',
  name: '기획',
  kind: 'user',
  readOnly: false,
  createdAt: 1_700_000_000_000,
};

const DM_CH: Channel = {
  id: 'ch-dm',
  projectId: null,
  name: 'dm:prov-a',
  kind: 'dm',
  readOnly: false,
  createdAt: 1_700_000_000_000,
};

beforeEach(() => {
  invokeCalls.length = 0;
  invokeReject = null;
  void i18next.changeLanguage('ko');
});

afterEach(() => {
  cleanup();
  useThemeStore.setState({ themeKey: DEFAULT_THEME, mode: DEFAULT_MODE });
});

describe('ChannelDeleteConfirm — open/close', () => {
  it('renders with channel body', () => {
    renderWithTheme(
      <ChannelDeleteConfirm open onOpenChange={() => {}} channel={USER_CH} />,
    );
    expect(screen.getByTestId('channel-delete-confirm')).toBeTruthy();
    expect(
      screen.getByTestId('channel-delete-confirm-body').textContent,
    ).toContain('기획');
  });

  it('does not render when open=false', () => {
    renderWithTheme(
      <ChannelDeleteConfirm
        open={false}
        onOpenChange={() => {}}
        channel={USER_CH}
      />,
    );
    expect(screen.queryByTestId('channel-delete-confirm')).toBeNull();
  });

  it('ESC closes', async () => {
    const onOpenChange = vi.fn();
    renderWithTheme(
      <ChannelDeleteConfirm
        open
        onOpenChange={onOpenChange}
        channel={USER_CH}
      />,
    );
    fireEvent.keyDown(screen.getByTestId('channel-delete-confirm'), {
      key: 'Escape',
      code: 'Escape',
    });
    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it('cancel button closes', () => {
    const onOpenChange = vi.fn();
    renderWithTheme(
      <ChannelDeleteConfirm
        open
        onOpenChange={onOpenChange}
        channel={USER_CH}
      />,
    );
    fireEvent.click(screen.getByTestId('channel-delete-cancel'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe('ChannelDeleteConfirm — DM label variant', () => {
  it('DM channel → "대화 닫기" title + "닫기" submit', () => {
    renderWithTheme(
      <ChannelDeleteConfirm open onOpenChange={() => {}} channel={DM_CH} />,
    );
    const content = screen.getByTestId('channel-delete-confirm');
    expect(content.getAttribute('data-channel-kind')).toBe('dm');
    const submit = screen.getByTestId('channel-delete-submit');
    expect(submit.textContent).toBe('닫기');
  });
});

describe('ChannelDeleteConfirm — success path', () => {
  it('calls channel:delete and onDeleted', async () => {
    const onOpenChange = vi.fn();
    const onDeleted = vi.fn();

    renderWithTheme(
      <ChannelDeleteConfirm
        open
        onOpenChange={onOpenChange}
        channel={USER_CH}
        onDeleted={onDeleted}
      />,
    );
    fireEvent.click(screen.getByTestId('channel-delete-submit'));

    await waitFor(() => {
      expect(onDeleted).toHaveBeenCalledWith('ch-1');
    });
    expect(invokeCalls).toEqual([
      { channel: 'channel:delete', data: { id: 'ch-1' } },
    ]);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe('ChannelDeleteConfirm — server errors', () => {
  it('SystemChannelProtectedError → systemProtected inline', async () => {
    const err = new Error('protected');
    err.name = 'SystemChannelProtectedError';
    invokeReject = err;

    renderWithTheme(
      <ChannelDeleteConfirm open onOpenChange={() => {}} channel={USER_CH} />,
    );
    fireEvent.click(screen.getByTestId('channel-delete-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('channel-delete-error').textContent).toContain(
        '시스템 채널',
      );
    });
  });

  it('generic error → generic inline', async () => {
    invokeReject = new Error('boom');

    renderWithTheme(
      <ChannelDeleteConfirm open onOpenChange={() => {}} channel={USER_CH} />,
    );
    fireEvent.click(screen.getByTestId('channel-delete-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('channel-delete-error').textContent).toContain(
        '삭제하지 못했',
      );
    });
  });
});

describe('ChannelDeleteConfirm — hardcoded color guard', () => {
  it('ChannelDeleteConfirm.tsx contains zero hex color literals', () => {
    const source = readFileSync(
      resolve(__dirname, '..', 'ChannelDeleteConfirm.tsx'),
      'utf-8',
    );
    expect(source.match(/#[0-9a-fA-F]{3,6}\b/g)).toBeNull();
  });
});
