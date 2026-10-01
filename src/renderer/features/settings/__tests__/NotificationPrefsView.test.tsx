// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import '../../../i18n';
import { i18next } from '../../../i18n';
import { NotificationPrefsView, VISIBLE_KINDS } from '../NotificationPrefsView';
import { makeNotificationPrefs } from './notification-prefs-fixture';
import type { NotificationPrefs } from '../../../../shared/notification-types';

/** 공유 kind 목록에서 만든다 — 종류를 더해도 이 fixture 는 낡지 않는다. */
const makePrefs = makeNotificationPrefs;

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

function setupArena(invoke: ReturnType<typeof vi.fn>): {
  emit: (type: string, payload: unknown) => void;
} {
  const subs = new Map<string, ((p: unknown) => void)[]>();
  vi.stubGlobal('arena', {
    platform: 'linux',
    invoke,
    onStream: (type: string, cb: (p: unknown) => void) => {
      const list = subs.get(type) ?? [];
      list.push(cb);
      subs.set(type, list);
      return () => {
        subs.set(type, (subs.get(type) ?? []).filter((h) => h !== cb));
      };
    },
  });
  return {
    emit: (type, payload) =>
      (subs.get(type) ?? []).forEach((cb) => cb(payload)),
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  void i18next.changeLanguage('ko');
});

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('NotificationPrefsView', () => {
  it('shows only new-message and error controls from the full stored prefs', async () => {
    const invoke = makeRouter({
      'notification:get-prefs': () => ({ prefs: makePrefs() }),
    });
    setupArena(invoke);

    render(<NotificationPrefsView />);

    await waitFor(() =>
      expect(screen.getByTestId('notification-prefs-list')).toBeTruthy(),
    );

    const rows = screen.getAllByTestId('notification-prefs-row');
    expect(VISIBLE_KINDS).toEqual(['new_message', 'error']);
    expect(rows).toHaveLength(2);

    const kinds = rows.map((r) => r.getAttribute('data-kind'));
    expect(kinds).toEqual([...VISIBLE_KINDS]);
  });

  it('keeps retired work categories out of the mounted controls', async () => {
    const invoke = makeRouter({
      'notification:get-prefs': () => ({ prefs: makePrefs() }),
    });
    setupArena(invoke);

    render(<NotificationPrefsView />);

    await waitFor(() =>
      expect(screen.getByTestId('notification-prefs-list')).toBeTruthy(),
    );

    const kinds = screen
      .getAllByTestId('notification-prefs-row')
      .map((r) => r.getAttribute('data-kind'));
    expect(kinds).toEqual(['new_message', 'error']);
    expect(kinds).not.toContain('approval_pending');
    expect(kinds).not.toContain('work_done');
    expect(kinds).not.toContain('handoff_auto_review');
    expect(kinds).not.toContain('queue_item_started');
    expect(kinds).not.toContain('audit_result');
  });

  it('설정 화면에서 뺀 두 종류는 줄로 나오지 않는다 (spec 7.5)', async () => {
    const invoke = makeRouter({
      'notification:get-prefs': () => ({ prefs: makePrefs() }),
    });
    setupArena(invoke);

    render(<NotificationPrefsView />);

    await waitFor(() =>
      expect(screen.getByTestId('notification-prefs-list')).toBeTruthy(),
    );

    const kinds = screen
      .getAllByTestId('notification-prefs-row')
      .map((r) => r.getAttribute('data-kind'));
    expect(kinds).not.toContain('queue_progress');
    expect(kinds).not.toContain('meeting_state');
  });

  it('모든 줄이 종류 이름이 아닌 번역된 이름을 보여 준다', async () => {
    const invoke = makeRouter({
      'notification:get-prefs': () => ({ prefs: makePrefs() }),
    });
    setupArena(invoke);

    render(<NotificationPrefsView />);

    await waitFor(() =>
      expect(screen.getByTestId('notification-prefs-list')).toBeTruthy(),
    );

    for (const row of screen.getAllByTestId('notification-prefs-row')) {
      const label = row.querySelector('span')?.textContent ?? '';
      expect(label.length, `${row.getAttribute('data-kind')} 라벨 없음`).toBeGreaterThan(0);
      // 키 문자열이 그대로 뜨면 번역이 빠진 것.
      expect(label).not.toContain('settings.notifications.kind.');
    }
  });

  it('each row has 2 switches (display / sound) and a test button', async () => {
    const invoke = makeRouter({
      'notification:get-prefs': () => ({ prefs: makePrefs() }),
    });
    setupArena(invoke);

    render(<NotificationPrefsView />);
    await waitFor(() =>
      expect(screen.getByTestId('notification-prefs-list')).toBeTruthy(),
    );

    expect(screen.getAllByTestId('notification-prefs-display')).toHaveLength(
      VISIBLE_KINDS.length,
    );
    expect(screen.getAllByTestId('notification-prefs-sound')).toHaveLength(
      VISIBLE_KINDS.length,
    );
    expect(screen.getAllByTestId('notification-prefs-test')).toHaveLength(
      VISIBLE_KINDS.length,
    );
  });

  it('display switch reflects current prefs (enabled=false renders unchecked)', async () => {
    const invoke = makeRouter({
      'notification:get-prefs': () => ({
        prefs: makePrefs({
          new_message: { enabled: false, soundEnabled: true },
        }),
      }),
    });
    setupArena(invoke);

    render(<NotificationPrefsView />);
    await waitFor(() =>
      expect(screen.getByTestId('notification-prefs-list')).toBeTruthy(),
    );

    const displaySwitches = screen.getAllByTestId(
      'notification-prefs-display',
    ) as HTMLInputElement[];
    const newMessage = displaySwitches.find(
      (el) => el.getAttribute('data-kind') === 'new_message',
    );
    expect(newMessage?.checked).toBe(false);
  });

  it('toggling display → invokes notification:update-prefs with { enabled } patch', async () => {
    const invoke = makeRouter({
      'notification:get-prefs': () => ({ prefs: makePrefs() }),
      'notification:update-prefs': () => ({
        prefs: makePrefs({ new_message: { enabled: false, soundEnabled: true } }),
      }),
    });
    setupArena(invoke);

    render(<NotificationPrefsView />);
    await waitFor(() =>
      expect(screen.getByTestId('notification-prefs-list')).toBeTruthy(),
    );

    const newMessageDisplay = screen
      .getAllByTestId('notification-prefs-display')
      .find(
        (el) => el.getAttribute('data-kind') === 'new_message',
      ) as HTMLInputElement;

    await act(async () => {
      fireEvent.click(newMessageDisplay);
      await new Promise((r) => setTimeout(r, 0));
    });

    const updateCall = invoke.mock.calls.find(
      (c) => c[0] === 'notification:update-prefs',
    );
    expect(updateCall?.[1]).toEqual({
      patch: { new_message: { enabled: false } },
    });
  });

  it('toggling sound → invokes notification:update-prefs with { soundEnabled } patch', async () => {
    const invoke = makeRouter({
      'notification:get-prefs': () => ({ prefs: makePrefs() }),
      'notification:update-prefs': () => ({
        prefs: makePrefs({ error: { enabled: true, soundEnabled: false } }),
      }),
    });
    setupArena(invoke);

    render(<NotificationPrefsView />);
    await waitFor(() =>
      expect(screen.getByTestId('notification-prefs-list')).toBeTruthy(),
    );

    const errorSound = screen
      .getAllByTestId('notification-prefs-sound')
      .find(
        (el) => el.getAttribute('data-kind') === 'error',
      ) as HTMLInputElement;

    await act(async () => {
      fireEvent.click(errorSound);
      await new Promise((r) => setTimeout(r, 0));
    });

    const updateCall = invoke.mock.calls.find(
      (c) => c[0] === 'notification:update-prefs',
    );
    expect(updateCall?.[1]).toEqual({
      patch: { error: { soundEnabled: false } },
    });
  });

  it('test button → invokes notification:test with the row kind', async () => {
    const invoke = makeRouter({
      'notification:get-prefs': () => ({ prefs: makePrefs() }),
      'notification:test': () => ({ success: true }),
    });
    setupArena(invoke);

    render(<NotificationPrefsView />);
    await waitFor(() =>
      expect(screen.getByTestId('notification-prefs-list')).toBeTruthy(),
    );

    const errorTestBtn = screen
      .getAllByTestId('notification-prefs-test')
      .find(
        (el) => el.getAttribute('data-kind') === 'error',
      ) as HTMLButtonElement;

    await act(async () => {
      fireEvent.click(errorTestBtn);
      await new Promise((r) => setTimeout(r, 0));
    });

    const testCall = invoke.mock.calls.find(
      (c) => c[0] === 'notification:test',
    );
    expect(testCall?.[1]).toEqual({ kind: 'error' });
  });

  it('stream:notification-prefs-changed updates row switch state in place', async () => {
    const invoke = makeRouter({
      'notification:get-prefs': () => ({ prefs: makePrefs() }),
    });
    const { emit } = setupArena(invoke);

    render(<NotificationPrefsView />);
    await waitFor(() =>
      expect(screen.getByTestId('notification-prefs-list')).toBeTruthy(),
    );

    act(() => {
      emit('stream:notification-prefs-changed', {
        prefs: makePrefs({
          new_message: { enabled: false, soundEnabled: false },
        }),
      });
    });

    const newMessageDisplay = screen
      .getAllByTestId('notification-prefs-display')
      .find(
        (el) => el.getAttribute('data-kind') === 'new_message',
      ) as HTMLInputElement;
    expect(newMessageDisplay.checked).toBe(false);
  });

  it('renders loading placeholder until first fetch resolves', async () => {
    let resolveFetch: ((value: { prefs: NotificationPrefs }) => void) | null =
      null;
    const invoke = vi.fn((channel: string) => {
      if (channel === 'notification:get-prefs') {
        return new Promise<{ prefs: NotificationPrefs }>((resolve) => {
          resolveFetch = resolve;
        });
      }
      return Promise.reject(new Error(`no mock for channel ${channel}`));
    });
    vi.stubGlobal('arena', {
      platform: 'linux',
      invoke,
      onStream: () => () => {},
    });

    render(<NotificationPrefsView />);
    expect(screen.getByTestId('notification-prefs-loading')).toBeTruthy();

    await act(async () => {
      resolveFetch?.({ prefs: makePrefs() });
      await new Promise((r) => setTimeout(r, 0));
    });

    await waitFor(() =>
      expect(screen.getByTestId('notification-prefs-list')).toBeTruthy(),
    );
    expect(screen.queryByTestId('notification-prefs-loading')).toBeNull();
  });
});
