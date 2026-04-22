// @vitest-environment jsdom

/**
 * AvatarPicker — 8 default catalogue grid + custom upload mutation
 * (R8-Task3).
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import '../../../i18n';

// Tracks all IPC calls so each test can assert what fired.
interface InvokeCall {
  channel: string;
  data: unknown;
}
const invokeCalls: InvokeCall[] = [];
const invokeResponses = new Map<string, unknown>();
let invokeReject: Error | null = null;

vi.mock('../../../ipc/invoke', () => ({
  invoke: async (channel: string, data: unknown) => {
    invokeCalls.push({ channel, data });
    if (invokeReject) throw invokeReject;
    return invokeResponses.get(channel);
  },
}));

import { AvatarPicker } from '../AvatarPicker';
import { DEFAULT_AVATARS } from '../../../../shared/default-avatars';

beforeEach(() => {
  invokeCalls.length = 0;
  invokeResponses.clear();
  invokeReject = null;
  invokeResponses.set('member:list-avatars', {
    avatars: DEFAULT_AVATARS.map((a) => ({ key: a.key, label: a.key })),
  });
});

afterEach(() => {
  cleanup();
});

describe('AvatarPicker — catalogue grid', () => {
  it('renders all 8 default cells once member:list-avatars resolves', async () => {
    render(
      <AvatarPicker
        providerId="p1"
        currentKind="default"
        currentData="blue-dev"
        onChange={() => {}}
      />,
    );
    await waitFor(() => {
      expect(screen.getAllByRole('radio').length).toBe(8);
    });
    for (const a of DEFAULT_AVATARS) {
      expect(
        screen.getByTestId(`avatar-picker-cell-${a.key}`),
      ).toBeTruthy();
    }
  });

  it('marks the currently-selected default with data-selected=true + aria-checked', async () => {
    render(
      <AvatarPicker
        providerId="p1"
        currentKind="default"
        currentData="green-design"
        onChange={() => {}}
      />,
    );
    await waitFor(() => {
      const cell = screen.getByTestId('avatar-picker-cell-green-design');
      expect(cell.getAttribute('data-selected')).toBe('true');
      expect(cell.getAttribute('aria-checked')).toBe('true');
    });
  });

  it('calls onChange({avatarKind:"default", avatarData:key}) when a cell is clicked', async () => {
    const onChange = vi.fn();
    render(
      <AvatarPicker
        providerId="p1"
        currentKind="default"
        currentData="blue-dev"
        onChange={onChange}
      />,
    );
    await waitFor(() => screen.getByTestId('avatar-picker-cell-purple-science'));
    fireEvent.click(screen.getByTestId('avatar-picker-cell-purple-science'));
    expect(onChange).toHaveBeenCalledWith({
      avatarKind: 'default',
      avatarData: 'purple-science',
    });
  });

  it('falls back to the static catalogue when member:list-avatars fails', async () => {
    invokeResponses.set('member:list-avatars', undefined);
    invokeReject = new Error('ipc unreachable');
    render(
      <AvatarPicker
        providerId="p1"
        currentKind="default"
        currentData="blue-dev"
        onChange={() => {}}
      />,
    );
    await waitFor(() => {
      // Even with the IPC failing, all 8 default cells render from the
      // shared catalogue — defence-in-depth so the user can always pick.
      expect(screen.getAllByRole('radio').length).toBe(8);
      expect(screen.getByTestId('avatar-picker-error')).toBeTruthy();
    });
  });
});

describe('AvatarPicker — custom upload mutation', () => {
  it('opens picker → uploads → emits onChange({custom, relativePath})', async () => {
    invokeResponses.set('member:pick-avatar-file', {
      sourcePath: '/home/user/Pictures/me.png',
    });
    invokeResponses.set('member:upload-avatar', {
      relativePath: 'avatars/p1.png',
      absolutePath: '/tmp/arena/avatars/p1.png',
    });
    const onChange = vi.fn();

    render(
      <AvatarPicker
        providerId="p1"
        currentKind="default"
        currentData="blue-dev"
        onChange={onChange}
      />,
    );
    await waitFor(() => screen.getByTestId('avatar-picker-upload'));

    fireEvent.click(screen.getByTestId('avatar-picker-upload'));

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith({
        avatarKind: 'custom',
        avatarData: 'avatars/p1.png',
      });
    });
    const channels = invokeCalls.map((c) => c.channel);
    expect(channels).toContain('member:pick-avatar-file');
    expect(channels).toContain('member:upload-avatar');
  });

  it('does NOT emit onChange when the user cancels the picker', async () => {
    invokeResponses.set('member:pick-avatar-file', { sourcePath: null });
    const onChange = vi.fn();

    render(
      <AvatarPicker
        providerId="p1"
        currentKind="default"
        currentData="blue-dev"
        onChange={onChange}
      />,
    );
    await waitFor(() => screen.getByTestId('avatar-picker-upload'));
    fireEvent.click(screen.getByTestId('avatar-picker-upload'));

    // Wait a microtask cycle for the async cancel path to settle.
    await Promise.resolve();
    expect(onChange).not.toHaveBeenCalled();
    const channels = invokeCalls.map((c) => c.channel);
    expect(channels).toContain('member:pick-avatar-file');
    expect(channels).not.toContain('member:upload-avatar');
  });
});

describe('AvatarPicker — revert button', () => {
  it('reverts to the first default catalogue entry', async () => {
    const onChange = vi.fn();
    render(
      <AvatarPicker
        providerId="p1"
        currentKind="custom"
        currentData="avatars/p1.png"
        currentCustomSrc="file:///tmp/p1.png"
        onChange={onChange}
      />,
    );
    await waitFor(() => screen.getByTestId('avatar-picker-revert'));
    fireEvent.click(screen.getByTestId('avatar-picker-revert'));
    expect(onChange).toHaveBeenCalledWith({
      avatarKind: 'default',
      avatarData: DEFAULT_AVATARS[0].key,
    });
  });

  it('shows the current-custom preview row when in custom kind', async () => {
    render(
      <AvatarPicker
        providerId="p1"
        currentKind="custom"
        currentData="avatars/p1.png"
        currentCustomSrc="file:///tmp/p1.png"
        onChange={() => {}}
      />,
    );
    expect(screen.getByTestId('avatar-custom-img')).toBeTruthy();
  });
});
