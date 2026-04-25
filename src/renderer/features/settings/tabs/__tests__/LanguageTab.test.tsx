// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import '../../../../i18n';
import { i18next } from '../../../../i18n';
import { LanguageTab } from '../LanguageTab';

function makeRouter(
  routes: Record<string, (data: unknown) => unknown>,
): ReturnType<typeof vi.fn> {
  return vi.fn((channel: string, data: unknown) => {
    const handler = routes[channel];
    if (!handler) {
      return Promise.reject(new Error(`no mock for channel ${channel}`));
    }
    try {
      return Promise.resolve(handler(data));
    } catch (reason) {
      return Promise.reject(reason);
    }
  });
}

function setupArena(invoke: ReturnType<typeof vi.fn>): void {
  vi.stubGlobal('arena', {
    platform: 'linux',
    invoke,
    onStream: () => () => undefined,
  });
}

beforeEach(() => {
  vi.unstubAllGlobals();
  void i18next.changeLanguage('ko');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  void i18next.changeLanguage('ko');
});

describe('LanguageTab', () => {
  it('renders one option per supported locale', () => {
    setupArena(makeRouter({}));

    render(<LanguageTab />);

    const options = screen.getAllByTestId('settings-language-option');
    expect(options.map((el) => el.getAttribute('data-locale'))).toEqual([
      'ko',
      'en',
    ]);
  });

  it('marks the current i18n language as active', () => {
    setupArena(makeRouter({}));

    render(<LanguageTab />);

    const ko = screen
      .getAllByTestId('settings-language-option')
      .find((el) => el.getAttribute('data-locale') === 'ko')!;
    expect(ko.getAttribute('data-active')).toBe('true');
  });

  it('clicking a different locale calls i18n.changeLanguage and config:update-settings', async () => {
    const invoke = makeRouter({
      'config:update-settings': () => ({ settings: {} }),
    });
    setupArena(invoke);

    render(<LanguageTab />);

    const en = screen
      .getAllByTestId('settings-language-option')
      .find((el) => el.getAttribute('data-locale') === 'en')!;
    const radio = en.querySelector('input[type="radio"]')!;

    await act(async () => {
      fireEvent.click(radio);
      await new Promise((r) => setTimeout(r, 0));
    });

    await waitFor(() => expect(i18next.language).toBe('en'));

    const updateCall = invoke.mock.calls.find(
      (c) => c[0] === 'config:update-settings',
    );
    expect(updateCall?.[1]).toEqual({ patch: { language: 'en' } });
  });

  it('surfaces a config:update-settings rejection as an inline error', async () => {
    const invoke = makeRouter({
      'config:update-settings': () => {
        throw new Error('disk full');
      },
    });
    setupArena(invoke);

    render(<LanguageTab />);

    const en = screen
      .getAllByTestId('settings-language-option')
      .find((el) => el.getAttribute('data-locale') === 'en')!;
    const radio = en.querySelector('input[type="radio"]')!;

    await act(async () => {
      fireEvent.click(radio);
      await new Promise((r) => setTimeout(r, 0));
    });

    await waitFor(() =>
      expect(screen.getByTestId('settings-language-error').textContent).toContain(
        'disk full',
      ),
    );
  });
});
