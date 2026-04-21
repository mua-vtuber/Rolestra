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
type Handler = (data: unknown) => unknown;
let handlers: Record<string, Handler> = {};

vi.mock('../../../ipc/invoke', () => ({
  invoke: async (channel: string, data: unknown) => {
    invokeCalls.push({ channel, data });
    const handler = handlers[channel];
    if (!handler) throw new Error(`no mock for ${channel}`);
    return handler(data);
  },
}));

import { StartDmButton } from '../StartDmButton';

function renderWithTheme(ui: React.ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

const NEW_DM: Channel = {
  id: 'dm-new',
  projectId: null,
  name: 'dm:prov-a',
  kind: 'dm',
  readOnly: false,
  createdAt: 1_700_000_000_000,
};

const EXISTING_DM: Channel = {
  id: 'dm-existing',
  projectId: null,
  name: 'dm:prov-a',
  kind: 'dm',
  readOnly: false,
  createdAt: 1_600_000_000_000,
};

beforeEach(() => {
  invokeCalls.length = 0;
  handlers = {};
  void i18next.changeLanguage('ko');
});

afterEach(() => {
  cleanup();
  useThemeStore.setState({ themeKey: DEFAULT_THEME, mode: DEFAULT_MODE });
});

describe('StartDmButton — new DM creation path', () => {
  it('channel:create 성공 시 onStarted(newChannel) 호출', async () => {
    handlers['channel:create'] = () => ({ channel: NEW_DM });
    const onStarted = vi.fn();

    renderWithTheme(
      <StartDmButton providerId="prov-a" displayName="Alice" onStarted={onStarted} />,
    );
    fireEvent.click(screen.getByTestId('start-dm-button'));

    await waitFor(() => {
      expect(onStarted).toHaveBeenCalledWith(NEW_DM);
    });
    expect(invokeCalls).toEqual([
      {
        channel: 'channel:create',
        data: {
          projectId: null,
          name: 'prov-a',
          kind: 'dm',
          memberProviderIds: ['prov-a'],
        },
      },
    ]);
  });
});

describe('StartDmButton — existing DM fallback path', () => {
  it('DuplicateDmError → channel:list 에서 기존 DM 찾아 onStarted', async () => {
    const err = new Error('dup');
    err.name = 'DuplicateDmError';
    handlers['channel:create'] = () => {
      throw err;
    };
    handlers['channel:list'] = () => ({ channels: [EXISTING_DM] });
    const onStarted = vi.fn();

    renderWithTheme(
      <StartDmButton providerId="prov-a" onStarted={onStarted} />,
    );
    fireEvent.click(screen.getByTestId('start-dm-button'));

    await waitFor(() => {
      expect(onStarted).toHaveBeenCalledWith(EXISTING_DM);
    });
    expect(invokeCalls.map((c) => c.channel)).toEqual([
      'channel:create',
      'channel:list',
    ]);
  });

  it('DuplicateDmError but list 에 없음 → inline 에러', async () => {
    const err = new Error('dup');
    err.name = 'DuplicateDmError';
    handlers['channel:create'] = () => {
      throw err;
    };
    handlers['channel:list'] = () => ({ channels: [] });

    renderWithTheme(<StartDmButton providerId="prov-a" />);
    fireEvent.click(screen.getByTestId('start-dm-button'));

    await waitFor(() => {
      expect(screen.getByTestId('start-dm-error')).toBeTruthy();
    });
    expect(screen.getByTestId('start-dm-error').textContent).toContain(
      '찾지 못했',
    );
  });
});

describe('StartDmButton — generic error path', () => {
  it('알 수 없는 에러 → generic 에러 표면', async () => {
    handlers['channel:create'] = () => {
      throw new Error('boom');
    };

    renderWithTheme(<StartDmButton providerId="prov-a" />);
    fireEvent.click(screen.getByTestId('start-dm-button'));

    await waitFor(() => {
      expect(screen.getByTestId('start-dm-error').textContent).toContain(
        '시작하지 못했',
      );
    });
  });
});

describe('StartDmButton — hardcoded color guard', () => {
  it('StartDmButton.tsx contains zero hex color literals', () => {
    const source = readFileSync(
      resolve(__dirname, '..', 'StartDmButton.tsx'),
      'utf-8',
    );
    expect(source.match(/#[0-9a-fA-F]{3,6}\b/g)).toBeNull();
  });
});
