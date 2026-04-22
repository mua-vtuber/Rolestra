// @vitest-environment jsdom

/**
 * MemberProfileTrigger — wraps an arbitrary clickable element with the
 * popover + edit-modal handoff (R8-Task7).
 */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import '../../../i18n';

if (typeof globalThis.ResizeObserver === 'undefined') {
  (globalThis as { ResizeObserver: unknown }).ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
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

const invokeCalls: { channel: string; data: unknown }[] = [];
vi.mock('../../../ipc/invoke', () => ({
  invoke: async (channel: string, data: unknown) => {
    invokeCalls.push({ channel, data });
    if (channel === 'member:get-profile') {
      return {
        profile: {
          providerId: 'p1',
          role: '',
          personality: '',
          expertise: '',
          avatarKind: 'default',
          avatarData: 'blue-dev',
          statusOverride: null,
          updatedAt: 0,
        },
      };
    }
    return undefined;
  },
}));

vi.mock('../../../hooks/channel-invalidation-bus', () => ({
  notifyChannelsChanged: vi.fn(),
}));

import { MemberProfileTrigger } from '../MemberProfileTrigger';
import type { MemberView } from '../../../../shared/member-profile-types';

const MEMBER: MemberView = {
  providerId: 'p1',
  role: 'Engineer',
  personality: 'Direct',
  expertise: 'TS',
  avatarKind: 'default',
  avatarData: 'blue-dev',
  statusOverride: null,
  updatedAt: 0,
  displayName: 'Claude',
  persona: '',
  workStatus: 'online',
};

beforeEach(() => {
  invokeCalls.length = 0;
});

afterEach(() => {
  cleanup();
});

describe('MemberProfileTrigger', () => {
  it('opens the popover when the wrapped element is clicked', async () => {
    render(
      <MemberProfileTrigger member={MEMBER}>
        <button data-testid="trigger-anchor">trigger</button>
      </MemberProfileTrigger>,
    );
    expect(screen.queryByTestId('profile-popover')).toBeNull();
    fireEvent.click(screen.getByTestId('trigger-anchor'));
    await waitFor(() => {
      expect(screen.getByTestId('profile-popover')).toBeTruthy();
    });
  });

  it('clicking 편집 in the popover closes the popover and opens the edit modal', async () => {
    render(
      <MemberProfileTrigger member={MEMBER}>
        <button data-testid="trigger-anchor">trigger</button>
      </MemberProfileTrigger>,
    );
    fireEvent.click(screen.getByTestId('trigger-anchor'));
    await waitFor(() => screen.getByTestId('profile-popover-edit'));
    fireEvent.click(screen.getByTestId('profile-popover-edit'));
    await waitFor(() => {
      expect(screen.getByTestId('profile-editor-dialog')).toBeTruthy();
      // Popover should have closed after edit-handoff
      expect(screen.queryByTestId('profile-popover')).toBeNull();
    });
  });
});
