// @vitest-environment jsdom

/**
 * MemberProfilePopover — 4 액션 IPC wire (R8-Task6).
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

// Radix Popover relies on the same DOM polyfills as Dialog under jsdom.
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

interface InvokeCall {
  channel: string;
  data: unknown;
}
const invokeCalls: InvokeCall[] = [];
const invokeResponses = new Map<string, unknown>();
let invokeReject: Error | null = null;
let invokeRejectChannels: string[] | null = null;

vi.mock('../../../ipc/invoke', () => ({
  invoke: async (channel: string, data: unknown) => {
    invokeCalls.push({ channel, data });
    if (
      invokeReject &&
      (invokeRejectChannels === null || invokeRejectChannels.includes(channel))
    ) {
      throw invokeReject;
    }
    return invokeResponses.get(channel);
  },
}));

vi.mock('../../../hooks/channel-invalidation-bus', () => ({
  notifyChannelsChanged: vi.fn(),
}));

import { MemberProfilePopover } from '../MemberProfilePopover';
import type { MemberView } from '../../../../shared/member-profile-types';

function makeMember(over: Partial<MemberView> = {}): MemberView {
  return {
    providerId: 'p1',
    role: 'Senior Engineer',
    personality: 'Direct',
    expertise: 'TS, React',
    avatarKind: 'default',
    avatarData: 'blue-dev',
    statusOverride: null,
    updatedAt: 0,
    displayName: 'Claude',
    persona: '',
    workStatus: 'online',
    ...over,
  };
}

beforeEach(() => {
  invokeCalls.length = 0;
  invokeResponses.clear();
  invokeReject = null;
  invokeRejectChannels = null;
});

afterEach(() => {
  cleanup();
});

describe('MemberProfilePopover — 편집 액션', () => {
  it('clicking 편집 calls onEdit (no IPC)', async () => {
    const onEdit = vi.fn();
    render(
      <MemberProfilePopover
        open
        onOpenChange={() => {}}
        member={makeMember()}
        onEdit={onEdit}
      />,
    );
    await waitFor(() => screen.getByTestId('profile-popover-edit'));
    fireEvent.click(screen.getByTestId('profile-popover-edit'));
    expect(onEdit).toHaveBeenCalled();
    expect(invokeCalls.length).toBe(0);
  });
});

describe('MemberProfilePopover — 외근↔출근 토글', () => {
  it('online → toggle invokes member:set-status with offline-manual', async () => {
    invokeResponses.set('member:set-status', { success: true });
    render(
      <MemberProfilePopover
        open
        onOpenChange={() => {}}
        member={makeMember({ workStatus: 'online' })}
        onEdit={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId('profile-popover-toggle'));
    await waitFor(() => {
      const call = invokeCalls.find((c) => c.channel === 'member:set-status');
      expect(call?.data).toEqual({
        providerId: 'p1',
        status: 'offline-manual',
      });
    });
  });

  it('offline-manual → toggle invokes member:set-status with online', async () => {
    invokeResponses.set('member:set-status', { success: true });
    render(
      <MemberProfilePopover
        open
        onOpenChange={() => {}}
        member={makeMember({ workStatus: 'offline-manual' })}
        onEdit={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId('profile-popover-toggle'));
    await waitFor(() => {
      const call = invokeCalls.find((c) => c.channel === 'member:set-status');
      expect(call?.data).toEqual({
        providerId: 'p1',
        status: 'online',
      });
    });
  });

  it('toggle button reflects aria-pressed when current state is offline-manual', async () => {
    render(
      <MemberProfilePopover
        open
        onOpenChange={() => {}}
        member={makeMember({ workStatus: 'offline-manual' })}
        onEdit={() => {}}
      />,
    );
    const btn = await screen.findByTestId('profile-popover-toggle');
    expect(btn.getAttribute('aria-pressed')).toBe('true');
  });
});

describe('MemberProfilePopover — 연락해보기', () => {
  it('reconnect → connecting indicator → success status applied locally', async () => {
    invokeResponses.set('member:reconnect', { status: 'online' });
    render(
      <MemberProfilePopover
        open
        onOpenChange={() => {}}
        member={makeMember({ workStatus: 'offline-connection' })}
        onEdit={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId('profile-popover-reconnect'));
    await waitFor(() => {
      const call = invokeCalls.find((c) => c.channel === 'member:reconnect');
      expect(call?.data).toEqual({ providerId: 'p1' });
    });
    // After resolution the local indicator should reflect 'online'
    await waitFor(() => {
      const dot = screen.getByTestId('work-status-dot');
      expect(dot.getAttribute('data-status')).toBe('online');
    });
  });

  it('reconnect failure surfaces error banner + reverts to offline-connection', async () => {
    invokeReject = new Error('warmup failed');
    invokeRejectChannels = ['member:reconnect'];
    render(
      <MemberProfilePopover
        open
        onOpenChange={() => {}}
        member={makeMember({ workStatus: 'online' })}
        onEdit={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId('profile-popover-reconnect'));
    await waitFor(() => {
      expect(screen.getByTestId('profile-popover-error')).toBeTruthy();
      const dot = screen.getByTestId('work-status-dot');
      expect(dot.getAttribute('data-status')).toBe('offline-connection');
    });
  });
});

describe('MemberProfilePopover — DM 시작', () => {
  it('happy path: channel:create succeeds → onDmStarted + popover closes', async () => {
    const channel = {
      id: 'ch-dm-1',
      projectId: null,
      kind: 'dm' as const,
      name: 'dm:p1',
      createdAt: 1,
      lastMessageAt: 0,
    };
    invokeResponses.set('channel:create', { channel });
    const onDmStarted = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <MemberProfilePopover
        open
        onOpenChange={onOpenChange}
        member={makeMember()}
        onEdit={() => {}}
        onDmStarted={onDmStarted}
      />,
    );
    fireEvent.click(screen.getByTestId('profile-popover-start-dm'));
    await waitFor(() => expect(onDmStarted).toHaveBeenCalledWith(channel));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('falls back to channel:list when channel:create throws DuplicateDmError', async () => {
    const dupErr = new Error('dup') as Error & { name: string };
    dupErr.name = 'DuplicateDmError';
    invokeReject = dupErr;
    invokeRejectChannels = ['channel:create'];
    invokeResponses.set('channel:list', {
      channels: [
        {
          id: 'ch-dm-existing',
          projectId: null,
          kind: 'dm',
          name: 'dm:p1',
          createdAt: 1,
          lastMessageAt: 0,
        },
      ],
    });
    const onDmStarted = vi.fn();
    render(
      <MemberProfilePopover
        open
        onOpenChange={() => {}}
        member={makeMember()}
        onEdit={() => {}}
        onDmStarted={onDmStarted}
      />,
    );
    fireEvent.click(screen.getByTestId('profile-popover-start-dm'));
    await waitFor(() => {
      expect(onDmStarted).toHaveBeenCalled();
      expect(onDmStarted.mock.calls[0][0].id).toBe('ch-dm-existing');
    });
  });
});
