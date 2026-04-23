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
import { NotificationPrefsView } from '../NotificationPrefsView';
import type { NotificationPrefs } from '../../../../shared/notification-types';

function makePrefs(overrides: Partial<NotificationPrefs> = {}): NotificationPrefs {
  return {
    new_message: { enabled: true, soundEnabled: true },
    approval_pending: { enabled: true, soundEnabled: true },
    work_done: { enabled: true, soundEnabled: true },
    error: { enabled: true, soundEnabled: true },
    queue_progress: { enabled: true, soundEnabled: true },
    meeting_state: { enabled: true, soundEnabled: true },
    ...overrides,
  };
}

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
  it('renders 4 rows for the core kinds (new_message / approval_pending / work_done / error)', async () => {
    const invoke = makeRouter({
      'notification:get-prefs': () => ({ prefs: makePrefs() }),
    });
    setupArena(invoke);

    render(<NotificationPrefsView />);

    await waitFor(() =>
      expect(screen.getByTestId('notification-prefs-list')).toBeTruthy(),
    );

    const rows = screen.getAllByTestId('notification-prefs-row');
    expect(rows).toHaveLength(4);

    const kinds = rows.map((r) => r.getAttribute('data-kind'));
    expect(kinds).toEqual(['new_message', 'approval_pending', 'work_done', 'error']);
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

    expect(screen.getAllByTestId('notification-prefs-display')).toHaveLength(4);
    expect(screen.getAllByTestId('notification-prefs-sound')).toHaveLength(4);
    expect(screen.getAllByTestId('notification-prefs-test')).toHaveLength(4);
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
        prefs: makePrefs({ work_done: { enabled: false, soundEnabled: true } }),
      }),
    });
    setupArena(invoke);

    render(<NotificationPrefsView />);
    await waitFor(() =>
      expect(screen.getByTestId('notification-prefs-list')).toBeTruthy(),
    );

    const workDoneDisplay = screen
      .getAllByTestId('notification-prefs-display')
      .find(
        (el) => el.getAttribute('data-kind') === 'work_done',
      ) as HTMLInputElement;

    await act(async () => {
      fireEvent.click(workDoneDisplay);
      await new Promise((r) => setTimeout(r, 0));
    });

    const updateCall = invoke.mock.calls.find(
      (c) => c[0] === 'notification:update-prefs',
    );
    expect(updateCall?.[1]).toEqual({
      patch: { work_done: { enabled: false } },
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

    const approvalTestBtn = screen
      .getAllByTestId('notification-prefs-test')
      .find(
        (el) => el.getAttribute('data-kind') === 'approval_pending',
      ) as HTMLButtonElement;

    await act(async () => {
      fireEvent.click(approvalTestBtn);
      await new Promise((r) => setTimeout(r, 0));
    });

    const testCall = invoke.mock.calls.find(
      (c) => c[0] === 'notification:test',
    );
    expect(testCall?.[1]).toEqual({ kind: 'approval_pending' });
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
