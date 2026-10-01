// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import '../../../i18n';
import { i18next } from '../../../i18n';
import { SETTINGS_TAB_KEYS, SettingsTabs } from '../SettingsTabs';
import { makeNotificationPrefs } from './notification-prefs-fixture';

type Routes = Record<string, (data: unknown) => unknown>;

function setupArena(routes: Routes): ReturnType<typeof vi.fn> {
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

function defaultRoutes(): Routes {
  return {
    'notification:get-prefs': () => ({ prefs: makeNotificationPrefs() }),
    'member:list': () => ({ members: [] }),
    'provider:list': () => ({ providers: [] }),
    'provider:list-inactive-cli': () => ({ inactive: [] }),
    'provider:detect-cli': () => ({ detected: [] }),
    'provider:detect-local': () => ({ detection: {
      status: 'not-responding', endpoint: 'http://127.0.0.1:11434', cause: 'refused', detail: 'ECONNREFUSED',
    } }),
    'arena-root:get': () => ({ path: '/home/test/Rolestra' }),
  };
}

function trigger(tab: string): HTMLElement {
  const found = screen.getAllByTestId('settings-tabs-trigger').find((t) => t.getAttribute('data-tab') === tab);
  if (!found) throw new Error(`no trigger for ${tab}`);
  return found;
}

beforeEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
  void i18next.changeLanguage('ko');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  void i18next.changeLanguage('ko');
});

describe('SettingsTabs — 일반 / AI / 정보', () => {
  it('renders exactly the general, AI and about tabs, in that order', () => {
    setupArena(defaultRoutes());
    render(<SettingsTabs />);

    const triggers = screen.getAllByTestId('settings-tabs-trigger');
    expect(triggers.map((t) => t.getAttribute('data-tab'))).toEqual(['general', 'ai', 'about']);
    expect(Array.from(SETTINGS_TAB_KEYS)).toEqual(['general', 'ai', 'about']);
    expect(triggers.map((t) => t.textContent)).toEqual(['일반', 'AI', '정보']);
    for (const removed of ['members', 'notifications', 'apiKeys', 'theme', 'language', 'path', 'cli']) {
      expect(screen.queryAllByTestId('settings-tabs-trigger').some((t) => t.getAttribute('data-tab') === removed))
        .toBe(false);
    }
  });

  it('defaults to the general tab when no hash is set', async () => {
    setupArena(defaultRoutes());
    render(<SettingsTabs />);

    expect(await screen.findByTestId('settings-tab-general')).toBeTruthy();
    expect(trigger('general').getAttribute('data-state')).toBe('active');
  });

  it('honours the #settings/ai deep link', async () => {
    window.history.replaceState(null, '', '#settings/ai');
    setupArena(defaultRoutes());
    render(<SettingsTabs />);

    expect(await screen.findByTestId('settings-tab-ai')).toBeTruthy();
    expect(trigger('ai').getAttribute('data-state')).toBe('active');
  });

  it('opens the general tab for a link to a tab that no longer exists', async () => {
    window.history.replaceState(null, '', '#settings/apiKeys');
    setupArena(defaultRoutes());
    render(<SettingsTabs />);

    expect(await screen.findByTestId('settings-tab-general')).toBeTruthy();
  });

  it('writes the hash when the user picks another tab', async () => {
    setupArena(defaultRoutes());
    const user = userEvent.setup();
    render(<SettingsTabs />);

    await user.click(trigger('ai'));

    await waitFor(() => expect(window.location.hash).toBe('#settings/ai'));
    expect(trigger('ai').getAttribute('data-state')).toBe('active');
  });

  it('follows an external hash change while mounted', async () => {
    setupArena(defaultRoutes());
    render(<SettingsTabs />);

    await act(async () => {
      window.history.replaceState(null, '', '#settings/about');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });

    await waitFor(() => expect(trigger('about').getAttribute('data-state')).toBe('active'));
  });

  it('respects the initialTab prop over the hash', async () => {
    window.history.replaceState(null, '', '#settings/about');
    setupArena(defaultRoutes());
    render(<SettingsTabs initialTab="ai" />);

    expect(await screen.findByTestId('settings-tab-ai')).toBeTruthy();
  });

  it('has no path tab and no screen that edits a folder path', async () => {
    setupArena(defaultRoutes());
    render(<SettingsTabs />);

    await screen.findByTestId('settings-tab-general');
    expect(screen.queryByTestId('settings-tab-path')).toBeNull();
    expect(screen.queryByTestId('settings-data-folder-path')).toBeTruthy();
    expect(screen.getByTestId('settings-data-folder').querySelector('input')).toBeNull();
  });
});

describe('SettingsTabs — AI add entry point', () => {
  it('shows "AI 추가" in the AI tab and not in the general tab', async () => {
    setupArena(defaultRoutes());
    const user = userEvent.setup();
    render(<SettingsTabs />);

    await screen.findByTestId('settings-tab-general');
    expect(screen.queryByTestId('settings-ai-add')).toBeNull();

    await user.click(trigger('ai'));
    expect(await screen.findByTestId('settings-ai-add')).toBeTruthy();
  });

  it('"AI 추가" opens the AI connect dialog', async () => {
    window.history.replaceState(null, '', '#settings/ai');
    setupArena(defaultRoutes());
    const user = userEvent.setup();
    render(<SettingsTabs />);

    await user.click(await screen.findByTestId('settings-ai-add'));

    expect(await screen.findByTestId('provider-connect-dialog')).toBeTruthy();
  });

  // 2026-10-01 user decision: AI add lives only in the AI tab.
  it('the about tab has no AI add button', async () => {
    window.history.replaceState(null, '', '#settings/about');
    setupArena(defaultRoutes());
    render(<SettingsTabs />);

    expect(await screen.findByTestId('settings-tab-about')).toBeTruthy();
    expect(screen.queryByTestId('settings-about-onboarding-cta')).toBeNull();
    expect(screen.getByTestId('settings-tab-about').textContent).not.toContain('AI 추가');
  });

  it("after adding an AI, '이름·캐릭터 설정 편집' opens the new AI's profile editor", async () => {
    window.history.replaceState(null, '', '#settings/ai');
    setupArena({
      ...defaultRoutes(),
      'provider:detect-cli': () => ({ detected: [{ command: 'claude', displayName: 'Claude Code', path: '/usr/bin/claude' }] }),
      'provider:add': (data) => ({ provider: { id: 'new-ai', displayName: (data as { displayName: string }).displayName } }),
      'member:get-profile': () => ({ profile: {
        providerId: 'new-ai', characterSheet: '', avatarKind: 'default', avatarData: null,
        statusOverride: null, updatedAt: 1,
      } }),
    });
    const user = userEvent.setup();
    render(<SettingsTabs />);

    await user.click(await screen.findByTestId('settings-ai-add'));
    await user.click(await screen.findByTestId('provider-connect-cli-claude'));
    await user.click(await screen.findByTestId('provider-connect-edit-profile'));

    expect(await screen.findByTestId('profile-editor-dialog')).toBeTruthy();
    expect(screen.queryByTestId('provider-connect-dialog')).toBeNull();
    expect((await screen.findByTestId('profile-editor-name') as HTMLInputElement).value).toBe('Claude Code');
  });
});
