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
import { MembersTab } from '../MembersTab';
import type { MemberView } from '../../../../../shared/member-profile-types';

function makeMember(overrides: Partial<MemberView> = {}): MemberView {
  return {
    providerId: 'p1',
    role: 'researcher',
    personality: '',
    expertise: '',
    avatarKind: 'default',
    avatarData: 'aurora',
    statusOverride: null,
    updatedAt: 0,
    displayName: 'Member One',
    persona: 'researcher',
    workStatus: 'online',
    ...overrides,
  };
}

function setupArena(members: MemberView[]): void {
  vi.stubGlobal('arena', {
    platform: 'linux',
    invoke: vi.fn((channel: string) => {
      if (channel === 'member:list') {
        return Promise.resolve({ members });
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

describe('MembersTab', () => {
  it('renders the empty placeholder when the roster is empty', async () => {
    setupArena([]);

    render(<MembersTab />);

    await waitFor(() =>
      expect(screen.getByTestId('settings-members-empty')).toBeTruthy(),
    );
  });

  it('renders one row per member with status', async () => {
    setupArena([
      makeMember({ providerId: 'p1', displayName: 'Alice' }),
      makeMember({
        providerId: 'p2',
        displayName: 'Bob',
        workStatus: 'offline-manual',
      }),
    ]);

    render(<MembersTab />);

    await waitFor(() =>
      expect(screen.getAllByTestId('settings-members-row')).toHaveLength(2),
    );

    const statuses = screen
      .getAllByTestId('settings-members-status')
      .map((el) => el.getAttribute('data-status'));
    expect(statuses).toEqual(['online', 'offline-manual']);
  });
});
