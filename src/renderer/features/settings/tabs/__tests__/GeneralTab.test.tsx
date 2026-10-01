// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import '../../../../i18n';
import { i18next } from '../../../../i18n';
import { ThemeProvider } from '../../../../theme/theme-provider';
import { DEFAULT_MODE, DEFAULT_THEME, THEME_STORAGE_KEY, useThemeStore } from '../../../../theme/theme-store';
import { GeneralTab } from '../GeneralTab';
import { makeNotificationPrefs } from '../../__tests__/notification-prefs-fixture';

type Routes = Record<string, (data: unknown) => unknown>;
const ARENA_PATH = 'D:/Users/me/Documents/Rolestra';

function setupArena(overrides: Routes = {}): ReturnType<typeof vi.fn> {
  const routes: Routes = {
    'notification:get-prefs': () => ({ prefs: makeNotificationPrefs() }),
    'arena-root:get': () => ({ path: ARENA_PATH }),
    'arena-root:open-folder': () => ({ success: true }),
    'config:update-settings': () => ({ settings: {} }),
    'notification:set-locale': (data) => data,
    ...overrides,
  };
  const invoke = vi.fn((channel: string, data: unknown) => {
    const handler = routes[channel];
    if (!handler) return Promise.reject(new Error(`no mock for channel ${channel}`));
    try {
      return Promise.resolve(handler(data));
    } catch (reason) {
      return Promise.reject(reason);
    }
  });
  vi.stubGlobal('arena', { platform: 'linux', invoke, onStream: () => () => undefined });
  return invoke;
}

function stubMatchMedia(dark: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: dark, media: query,
      addEventListener: () => undefined, removeEventListener: () => undefined,
    }),
  });
}

function renderTab() {
  return render(<ThemeProvider><GeneralTab /></ThemeProvider>);
}

beforeEach(() => {
  useThemeStore.setState({ themeKey: DEFAULT_THEME, mode: DEFAULT_MODE });
  void i18next.changeLanguage('ko');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, 'matchMedia');
  localStorage.removeItem(THEME_STORAGE_KEY);
  useThemeStore.setState({ themeKey: DEFAULT_THEME, mode: DEFAULT_MODE });
  void i18next.changeLanguage('ko');
});

describe('GeneralTab — sections', () => {
  it('shows language, theme, brightness, the conversation-log folder and notifications', async () => {
    setupArena();
    renderTab();

    expect(screen.getByTestId('settings-language')).toBeTruthy();
    expect(screen.getByTestId('settings-theme')).toBeTruthy();
    expect(screen.getByTestId('settings-brightness')).toBeTruthy();
    expect(screen.getByTestId('settings-data-folder')).toBeTruthy();
    expect(await screen.findAllByTestId('notification-prefs-row')).toHaveLength(2);
  });
});

describe('GeneralTab — theme cards', () => {
  it('offers exactly tactical and retro, previewing bubbles and the log layout', () => {
    setupArena();
    renderTab();

    const cards = screen.getAllByTestId('settings-theme-card');
    expect(cards.map((card) => card.getAttribute('data-key'))).toEqual(['tactical', 'retro']);
    const layouts = screen.getAllByTestId('settings-theme-preview').map((p) => p.getAttribute('data-layout'));
    expect(layouts).toEqual(['bubbles', 'log']);
    expect(cards[0].getAttribute('aria-checked')).toBe('true');
  });

  it('choosing retro switches the theme and the <html> theme attribute', async () => {
    setupArena();
    const user = userEvent.setup();
    renderTab();

    await user.click(screen.getAllByTestId('settings-theme-card')[1]);

    expect(useThemeStore.getState().themeKey).toBe('retro');
    expect(document.documentElement.dataset.theme).toBe('retro');
    expect(screen.getAllByTestId('settings-theme-card')[1].getAttribute('aria-checked')).toBe('true');
  });
});

describe('GeneralTab — brightness', () => {
  it('offers light, dark and follow-system', () => {
    setupArena();
    renderTab();

    const options = screen.getAllByTestId('settings-brightness-option');
    expect(options.map((o) => o.getAttribute('data-mode'))).toEqual(['light', 'dark', 'system']);
    expect(options.map((o) => o.textContent)).toEqual(['라이트', '다크', '시스템 따라가기']);
  });

  it('"system" stores the preference and renders the OS scheme', async () => {
    stubMatchMedia(false);
    setupArena();
    const user = userEvent.setup();
    renderTab();

    await user.click(screen.getAllByTestId('settings-brightness-option')[2]);

    expect(useThemeStore.getState().mode).toBe('system');
    expect(document.documentElement.dataset.mode).toBe('light');
  });
});

describe('GeneralTab — language', () => {
  it('switching to English changes the UI language and persists it', async () => {
    const invoke = setupArena();
    const user = userEvent.setup();
    renderTab();

    await user.click(screen.getAllByTestId('settings-language-option')[1]);

    await waitFor(() => expect(i18next.language).toBe('en'));
    expect(invoke).toHaveBeenCalledWith('config:update-settings', { patch: { language: 'en' } });
    expect(invoke).toHaveBeenCalledWith('notification:set-locale', { locale: 'en' });
  });

  it('shows a failed save instead of pretending it worked', async () => {
    setupArena({ 'config:update-settings': () => { throw new Error('disk full'); } });
    const user = userEvent.setup();
    renderTab();

    await user.click(screen.getAllByTestId('settings-language-option')[1]);

    expect((await screen.findByTestId('settings-language-error')).textContent).toContain('disk full');
  });
});

describe('GeneralTab — conversation-log folder', () => {
  it('shows the folder main resolved, read-only', async () => {
    setupArena();
    renderTab();

    await waitFor(() => expect(screen.getByTestId('settings-data-folder-path').textContent).toBe(ARENA_PATH));
    expect(screen.getByTestId('settings-data-folder').querySelector('input')).toBeNull();
  });

  it('"폴더 열기" asks main to open its own folder — no path is sent', async () => {
    const invoke = setupArena();
    const user = userEvent.setup();
    renderTab();
    await waitFor(() => expect(screen.getByTestId('settings-data-folder-path').textContent).toBe(ARENA_PATH));

    await user.click(screen.getByTestId('settings-data-folder-open'));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('arena-root:open-folder', undefined));
    expect(screen.queryByTestId('settings-data-folder-open-error')).toBeNull();
  });

  it('shows why the folder could not be opened', async () => {
    setupArena({ 'arena-root:open-folder': () => { throw new Error('Could not open the conversation-log folder X: denied'); } });
    const user = userEvent.setup();
    renderTab();
    await waitFor(() => expect(screen.getByTestId('settings-data-folder-path').textContent).toBe(ARENA_PATH));

    await act(async () => { await user.click(screen.getByTestId('settings-data-folder-open')); });

    expect((await screen.findByTestId('settings-data-folder-open-error')).textContent).toContain('denied');
  });

  it('shows a failed folder lookup and keeps the open button disabled', async () => {
    setupArena({ 'arena-root:get': () => { throw new Error('arena-root handler: service not initialized'); } });
    renderTab();

    expect((await screen.findByTestId('settings-data-folder-error')).textContent).toContain('not initialized');
    expect((screen.getByTestId('settings-data-folder-open') as HTMLButtonElement).disabled).toBe(true);
  });
});
