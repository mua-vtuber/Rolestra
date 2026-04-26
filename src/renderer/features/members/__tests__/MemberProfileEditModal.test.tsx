// @vitest-environment jsdom

/**
 * MemberProfileEditModal — 4 field edit + save → member:update-profile
 * (R8-Task4).
 */

import { useState } from 'react';
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

// R11-Task15: spy throwToBoundary so we can assert the boundary toast bus
// receives the underlying error on save failure (matches the R10 D8
// pattern used by use-channel-messages.send / use-autonomy-mode.confirm).
const throwToBoundaryCalls: unknown[] = [];
vi.mock('../../../components/ErrorBoundary', () => ({
  useThrowToBoundary: () => (err: unknown) => {
    throwToBoundaryCalls.push(err);
  },
}));

import { MemberProfileEditModal } from '../MemberProfileEditModal';

beforeEach(() => {
  invokeCalls.length = 0;
  invokeResponses.clear();
  invokeReject = null;
  invokeRejectChannels = null;
  throwToBoundaryCalls.length = 0;
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

  it('R11-Task15: save failure closes optimistically then reopens with banner', async () => {
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

    // Optimistic close fires synchronously off the click — onOpenChange
    // sees `false` before the await on mutate even resumes.
    expect(onOpenChange.mock.calls[0]).toEqual([false]);

    await waitFor(() => {
      expect(onOpenChange.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
    // Reopen on failure restores the dialog so the user can fix the
    // input and retry.
    expect(onOpenChange.mock.calls[1]).toEqual([true]);

    await waitFor(() => {
      expect(screen.getByTestId('profile-editor-save-error')).toBeTruthy();
    });
  });
});

describe('MemberProfileEditModal — R11-Task15 optimistic save extension', () => {
  it('success path: dialog closes immediately and tears down draft cache', async () => {
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

    // First call is the optimistic close.
    expect(onOpenChange.mock.calls[0]).toEqual([false]);

    await waitFor(() => {
      expect(
        invokeCalls.some((c) => c.channel === 'member:update-profile'),
      ).toBe(true);
    });

    // Settle the success path; no reopen call should follow.
    await Promise.resolve();
    await Promise.resolve();
    const reopenCalls = onOpenChange.mock.calls.filter(
      ([open]) => open === true,
    );
    expect(reopenCalls.length).toBe(0);
  });

  it('failure path: shows the optimisticRollback hint inside the saveError banner', async () => {
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

    const hint = screen.getByTestId('profile-editor-rollback-hint');
    expect(hint.textContent).toBe(
      '저장에 실패해 편집기를 다시 열었습니다. 입력값은 그대로 유지됩니다.',
    );
  });

  it('failure path: forwards the underlying Error to throwToBoundary (toast bus)', async () => {
    const err = new Error('PROVIDER_OFFLINE');
    invokeReject = err;
    invokeRejectChannels = ['member:update-profile'];

    render(
      <MemberProfileEditModal
        open
        onOpenChange={() => {}}
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
      expect(throwToBoundaryCalls).toContain(err);
    });
  });

  it('failure path: draft survives reopen so the user can edit and retry', async () => {
    invokeReject = new Error('FAIL_ONCE');
    invokeRejectChannels = ['member:update-profile'];

    // A real parent owns `open` as state and feeds it back through
    // `onOpenChange`. This mirrors the production wiring (PeopleWidget
    // / MemberRow) — without it the controlled-prop replay races the
    // seed-cleanup effect and the draft gets reseeded.
    function HarnessHost(): React.ReactElement {
      const [open, setOpen] = useState(true);
      return (
        <MemberProfileEditModal
          open={open}
          onOpenChange={setOpen}
          providerId="p1"
          displayName="Claude"
        />
      );
    }
    render(<HarnessHost />);
    const role = (await screen.findByTestId(
      'profile-editor-role',
    )) as HTMLInputElement;
    fireEvent.change(role, { target: { value: 'Architect' } });

    fireEvent.click(screen.getByTestId('profile-editor-save'));

    // Wait for the failure round-trip: dialog must reopen with the
    // saveError banner mounted again.
    await waitFor(() => {
      expect(screen.getByTestId('profile-editor-save-error')).toBeTruthy();
    });

    // Draft preserved across the close/reopen — value is still the user's
    // edit, NOT the seeded "Senior Engineer".
    const reopenedRole = (await screen.findByTestId(
      'profile-editor-role',
    )) as HTMLInputElement;
    expect(reopenedRole.value).toBe('Architect');

    // Banner still mounted with both lines (saveError + rollback hint).
    expect(screen.getByTestId('profile-editor-rollback-hint')).toBeTruthy();
  });

  it('no-op save (no field changed): close fires once and no reopen / no IPC', async () => {
    const onOpenChange = vi.fn();
    render(
      <MemberProfileEditModal
        open
        onOpenChange={onOpenChange}
        providerId="p1"
        displayName="Claude"
      />,
    );
    await screen.findByTestId('profile-editor-role');

    fireEvent.click(screen.getByTestId('profile-editor-save'));

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledTimes(1);
    });
    expect(onOpenChange.mock.calls[0]).toEqual([false]);

    expect(
      invokeCalls.some((c) => c.channel === 'member:update-profile'),
    ).toBe(false);
    expect(throwToBoundaryCalls.length).toBe(0);
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
