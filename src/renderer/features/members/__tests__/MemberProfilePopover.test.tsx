// @vitest-environment jsdom

/**
 * MemberProfilePopover — profile editing and reconnect actions.
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

import { MemberProfilePopover } from '../MemberProfilePopover';
import type { MemberView } from '../../../../shared/member-profile-types';

function makeMember(over: Partial<MemberView> = {}): MemberView {
  return {
    providerId: 'p1',
    characterSheet: 'Role: Senior Engineer\nPersonality: Direct\nExpertise: TS, React',
    avatarKind: 'default',
    avatarData: 'blue-dev',
    statusOverride: null,
    updatedAt: 0,
    displayName: 'Claude',
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

describe('MemberProfilePopover — room snapshot persona (STEP 3b)', () => {
  it('shows the room persona details when roomPersona is defined', async () => {
    render(
      <MemberProfilePopover
        open
        onOpenChange={() => {}}
        member={makeMember({ isRoomSnapshot: true, roomPersona: 'Frozen room persona text.' })}
        onEdit={() => {}}
      />,
    );
    await waitFor(() => screen.getByText('Frozen room persona text.'));
  });

  // The legacy `persona` fallback (`roomPersona ?? member.persona`) is
  // removed — an isRoomSnapshot member with NO roomPersona must render
  // the read-only notice without a details block at all, never fall
  // back to a legacy persona string.
  it('renders no persona-detail block when roomPersona is undefined — never falls back to a legacy value', async () => {
    render(
      <MemberProfilePopover
        open
        onOpenChange={() => {}}
        member={makeMember({ isRoomSnapshot: true, roomPersona: undefined })}
        onEdit={() => {}}
      />,
    );
    await waitFor(() => screen.getByText('이 방을 만들 때 저장한 캐릭터 설정입니다.'));
    expect(screen.queryByText('페르소나')).toBeNull();
  });
});

describe('MemberProfilePopover — room-focused navigation', () => {
  it('offers editing and reconnect without an entry to a private DM', () => {
    render(
      <MemberProfilePopover
        open
        onOpenChange={() => {}}
        member={makeMember()}
        onEdit={() => {}}
      />,
    );
    expect(screen.getByTestId('profile-popover-edit')).toBeTruthy();
    expect(screen.getByTestId('profile-popover-reconnect')).toBeTruthy();
    expect(screen.queryByTestId('profile-popover-start-dm')).toBeNull();
    expect(invokeCalls).toEqual([]);
  });
});
