// @vitest-environment jsdom

/**
 * MemberProfileEditModal — 4 field edit + save → member:update-profile
 * (R8-Task4).
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

// jsdom polyfills (Radix Dialog)
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

import { MemberProfileEditModal } from '../MemberProfileEditModal';

beforeEach(() => {
  invokeCalls.length = 0;
  invokeResponses.clear();
  invokeReject = null;
  invokeRejectChannels = null;
  invokeResponses.set('member:get-profile', {
    profile: {
      providerId: 'p1',
      role: 'Senior Engineer',
      personality: 'Direct and pragmatic',
      expertise: 'TypeScript, React',
      avatarKind: 'default',
      avatarData: 'blue-dev',
      statusOverride: null,
      updatedAt: 1_700_000_000_000,
    },
  });
  invokeResponses.set('member:list-avatars', {
    avatars: [
      { key: 'blue-dev', label: '개발' },
      { key: 'green-design', label: '디자인' },
    ],
  });
});

afterEach(() => {
  cleanup();
});

describe('MemberProfileEditModal — open + initial fetch', () => {
  it('fetches member:get-profile when open=true and seeds inputs', async () => {
    render(
      <MemberProfileEditModal
        open
        onOpenChange={() => {}}
        providerId="p1"
        displayName="Claude"
      />,
    );
    await waitFor(() => {
      expect(invokeCalls.some((c) => c.channel === 'member:get-profile')).toBe(
        true,
      );
    });
    const role = (await screen.findByTestId(
      'profile-editor-role',
    )) as HTMLInputElement;
    expect(role.value).toBe('Senior Engineer');
    const expertise = screen.getByTestId(
      'profile-editor-expertise',
    ) as HTMLInputElement;
    expect(expertise.value).toBe('TypeScript, React');
  });

  it('does NOT fetch when open=false', async () => {
    render(
      <MemberProfileEditModal
        open={false}
        onOpenChange={() => {}}
        providerId="p1"
        displayName="Claude"
      />,
    );
    // Allow microtasks to settle.
    await Promise.resolve();
    expect(invokeCalls.some((c) => c.channel === 'member:get-profile')).toBe(
      false,
    );
  });
});

describe('MemberProfileEditModal — save flow', () => {
  it('builds patch only with changed fields and closes on success', async () => {
    invokeResponses.set('member:update-profile', {
      profile: {
        providerId: 'p1',
        role: 'Staff Engineer',
        personality: 'Direct and pragmatic',
        expertise: 'TypeScript, React',
        avatarKind: 'default',
        avatarData: 'blue-dev',
        statusOverride: null,
        updatedAt: 1_700_000_000_001,
      },
    });
    const onOpenChange = vi.fn();

    render(
      <MemberProfileEditModal
        open
        onOpenChange={onOpenChange}
        providerId="p1"
        displayName="Claude"
      />,
    );

    const role = (await screen.findByTestId(
      'profile-editor-role',
    )) as HTMLInputElement;
    fireEvent.change(role, { target: { value: 'Staff Engineer' } });

    fireEvent.click(screen.getByTestId('profile-editor-save'));

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    const updateCall = invokeCalls.find((c) => c.channel === 'member:update-profile');
    expect(updateCall).toBeDefined();
    expect(updateCall!.data).toEqual({
      providerId: 'p1',
      patch: { role: 'Staff Engineer' },
    });
  });

  it('skips IPC when no fields changed (close-only)', async () => {
    const onOpenChange = vi.fn();
    render(
      <MemberProfileEditModal
        open
        onOpenChange={onOpenChange}
        providerId="p1"
        displayName="Claude"
      />,
    );
    // Wait for initial fetch + draft seed
    await screen.findByTestId('profile-editor-role');

    fireEvent.click(screen.getByTestId('profile-editor-save'));
    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
    const updateCalls = invokeCalls.filter(
      (c) => c.channel === 'member:update-profile',
    );
    expect(updateCalls.length).toBe(0);
  });

  it('keeps the modal open and shows error banner when save rejects', async () => {
    invokeReject = new Error('SQLITE_CONSTRAINT_FOREIGNKEY');
    invokeRejectChannels = ['member:update-profile'];
    const onOpenChange = vi.fn();

    render(
      <MemberProfileEditModal
        open
        onOpenChange={onOpenChange}
        providerId="p1"
        displayName="Claude"
      />,
    );
    const role = (await screen.findByTestId(
      'profile-editor-role',
    )) as HTMLInputElement;
    fireEvent.change(role, { target: { value: 'Architect' } });
    fireEvent.click(screen.getByTestId('profile-editor-save'));

    await waitFor(() => {
      expect(screen.getByTestId('profile-editor-save-error')).toBeTruthy();
    });
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});

describe('MemberProfileEditModal — cancel flow', () => {
  it('cancel button does not call member:update-profile', async () => {
    render(
      <MemberProfileEditModal
        open
        onOpenChange={() => {}}
        providerId="p1"
        displayName="Claude"
      />,
    );
    await screen.findByTestId('profile-editor-role');
    fireEvent.click(screen.getByTestId('profile-editor-cancel'));
    expect(
      invokeCalls.some((c) => c.channel === 'member:update-profile'),
    ).toBe(false);
  });
});
