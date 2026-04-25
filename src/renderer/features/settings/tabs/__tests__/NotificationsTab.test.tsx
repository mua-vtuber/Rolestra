// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
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
import { NotificationsTab } from '../NotificationsTab';

function setupArena(): void {
  vi.stubGlobal('arena', {
    platform: 'linux',
    invoke: vi.fn((channel: string) => {
      if (channel === 'notification:get-prefs') {
        return Promise.resolve({
          prefs: {
            new_message: { enabled: true, soundEnabled: true },
            approval_pending: { enabled: true, soundEnabled: true },
            work_done: { enabled: true, soundEnabled: true },
            error: { enabled: true, soundEnabled: true },
            queue_progress: { enabled: true, soundEnabled: true },
            meeting_state: { enabled: true, soundEnabled: true },
          },
        });
      }
      return Promise.reject(new Error(`unexpected ${channel}`));
    }),
    onStream: () => () => undefined,
  });
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  void i18next.changeLanguage('ko');
});

describe('NotificationsTab', () => {
  it('mounts and delegates to NotificationPrefsView', async () => {
    setupArena();

    render(<NotificationsTab />);

    expect(screen.getByTestId('settings-tab-notifications')).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByTestId('notification-prefs-list')).toBeTruthy(),
    );
  });
});
