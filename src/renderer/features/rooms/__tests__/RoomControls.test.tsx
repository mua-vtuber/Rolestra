// @vitest-environment jsdom
/* eslint-disable i18next/no-literal-string */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RoomControls } from '../RoomControls';
import { useActiveChannelStore } from '../../../stores/active-channel-store';
import '../../../i18n';

vi.mock('../../../hooks/channel-invalidation-bus', () => ({ notifyChannelsChanged: vi.fn(async () => {}) }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

/** The ⋯ menu item stands in as the opener here. */
function Harness({ readOnly }: { readOnly: boolean }) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" data-testid="opener" onClick={() => setOpen(true)}>open</button>
    <RoomControls channelId="room-1" readOnly={readOnly} open={open} onOpenChange={setOpen} />
  </>;
}

describe('RoomControls', () => {
  it('only archives after the user confirms and leaves the room selected for reading', async () => {
    const invoke = vi.fn(async () => ({ room: {} }));
    vi.stubGlobal('arena', { invoke });
    useActiveChannelStore.getState().setGlobalChannelId('room-1');
    render(<Harness readOnly={false} />);
    fireEvent.click(screen.getByTestId('opener'));
    expect(invoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('room-action-confirm'));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('room:archive', { channelId: 'room-1' }));
    expect(useActiveChannelStore.getState().globalChannelId).toBe('room-1');
  });

  it('deletes only the requested archive and does not clear a more recent selection', async () => {
    let finish: () => void = () => {};
    const invoke = vi.fn(() => new Promise((resolve) => { finish = () => resolve({ success: true }); }));
    vi.stubGlobal('arena', { invoke });
    useActiveChannelStore.getState().setGlobalChannelId('room-1');
    render(<Harness readOnly />);
    fireEvent.click(screen.getByTestId('opener'));
    fireEvent.click(screen.getByTestId('room-action-confirm'));
    useActiveChannelStore.getState().setGlobalChannelId('room-2');
    finish();
    await waitFor(() => expect(screen.queryByTestId('room-action-dialog')).toBeNull());
    expect(invoke).toHaveBeenCalledWith('room:delete', { channelId: 'room-1' });
    expect(useActiveChannelStore.getState().globalChannelId).toBe('room-2');
  });
});
