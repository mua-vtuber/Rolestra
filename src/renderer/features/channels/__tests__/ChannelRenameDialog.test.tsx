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
let invokeResult: unknown = null;
let invokeReject: Error | null = null;

vi.mock('../../../ipc/invoke', () => ({
  invoke: async (channel: string, data: unknown) => {
    invokeCalls.push({ channel, data });
    if (invokeReject) throw invokeReject;
    return invokeResult;
  },
}));

import { ChannelRenameDialog } from '../ChannelRenameDialog';

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

const RENAMED: Channel = { ...USER_CH, name: '새이름' };

beforeEach(() => {
  invokeCalls.length = 0;
  invokeResult = null;
  invokeReject = null;
  void i18next.changeLanguage('ko');
});

afterEach(() => {
  cleanup();
  useThemeStore.setState({ themeKey: DEFAULT_THEME, mode: DEFAULT_MODE });
});

describe('ChannelRenameDialog — open/close', () => {
  it('renders with current channel name prefilled', () => {
    renderWithTheme(
      <ChannelRenameDialog open onOpenChange={() => {}} channel={USER_CH} />,
    );
    expect(screen.getByTestId('channel-rename-dialog')).toBeTruthy();
    const input = screen.getByTestId('channel-rename-name') as HTMLInputElement;
    expect(input.value).toBe('기획');
  });

  it('does not render when open=false', () => {
    renderWithTheme(
      <ChannelRenameDialog
        open={false}
        onOpenChange={() => {}}
        channel={USER_CH}
      />,
    );
    expect(screen.queryByTestId('channel-rename-dialog')).toBeNull();
  });

  it('ESC closes', async () => {
    const onOpenChange = vi.fn();
    renderWithTheme(
      <ChannelRenameDialog
        open
        onOpenChange={onOpenChange}
        channel={USER_CH}
      />,
    );
    fireEvent.keyDown(screen.getByTestId('channel-rename-dialog'), {
      key: 'Escape',
      code: 'Escape',
    });
    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });
});

describe('ChannelRenameDialog — validation', () => {
  it('empty name → nameRequired', () => {
    renderWithTheme(
      <ChannelRenameDialog open onOpenChange={() => {}} channel={USER_CH} />,
    );
    fireEvent.change(screen.getByTestId('channel-rename-name'), {
      target: { value: '   ' },
    });
    fireEvent.click(screen.getByTestId('channel-rename-submit'));
    expect(screen.getByTestId('channel-rename-error').textContent).toContain(
      '채널 이름을 입력하세요',
    );
  });

  it('unchanged name → close without IPC', async () => {
    const onOpenChange = vi.fn();
    renderWithTheme(
      <ChannelRenameDialog
        open
        onOpenChange={onOpenChange}
        channel={USER_CH}
      />,
    );
    fireEvent.click(screen.getByTestId('channel-rename-submit'));
    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
    expect(invokeCalls.length).toBe(0);
  });
});

describe('ChannelRenameDialog — success path', () => {
  it('calls channel:rename and onRenamed', async () => {
    invokeResult = { channel: RENAMED };
    const onOpenChange = vi.fn();
    const onRenamed = vi.fn();

    renderWithTheme(
      <ChannelRenameDialog
        open
        onOpenChange={onOpenChange}
        channel={USER_CH}
        onRenamed={onRenamed}
      />,
    );
    fireEvent.change(screen.getByTestId('channel-rename-name'), {
      target: { value: '새이름' },
    });
    fireEvent.click(screen.getByTestId('channel-rename-submit'));

    await waitFor(() => {
      expect(onRenamed).toHaveBeenCalledWith(RENAMED);
    });
    expect(invokeCalls).toEqual([
      {
        channel: 'channel:rename',
        data: { id: 'ch-1', name: '새이름' },
      },
    ]);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe('ChannelRenameDialog — server errors', () => {
  it('DuplicateChannelNameError → duplicateName inline', async () => {
    const err = new Error('dup');
    err.name = 'DuplicateChannelNameError';
    invokeReject = err;

    renderWithTheme(
      <ChannelRenameDialog open onOpenChange={() => {}} channel={USER_CH} />,
    );
    fireEvent.change(screen.getByTestId('channel-rename-name'), {
      target: { value: '다른이름' },
    });
    fireEvent.click(screen.getByTestId('channel-rename-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('channel-rename-error').textContent).toContain(
        '이미 있습니다',
      );
    });
  });

  it('SystemChannelProtectedError → systemProtected inline', async () => {
    const err = new Error('protected');
    err.name = 'SystemChannelProtectedError';
    invokeReject = err;

    renderWithTheme(
      <ChannelRenameDialog open onOpenChange={() => {}} channel={USER_CH} />,
    );
    fireEvent.change(screen.getByTestId('channel-rename-name'), {
      target: { value: '다른이름' },
    });
    fireEvent.click(screen.getByTestId('channel-rename-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('channel-rename-error').textContent).toContain(
        '시스템 채널',
      );
    });
  });
});

describe('ChannelRenameDialog — hardcoded color guard', () => {
  it('ChannelRenameDialog.tsx contains zero hex color literals', () => {
    const source = readFileSync(
      resolve(__dirname, '..', 'ChannelRenameDialog.tsx'),
      'utf-8',
    );
    expect(source.match(/#[0-9a-fA-F]{3,6}\b/g)).toBeNull();
  });
});
