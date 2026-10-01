// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MemberPanel } from '../MemberPanel';
import { i18next } from '../../../i18n';
import { useActiveChannelStore } from '../../../stores/active-channel-store';

beforeEach(() => {
  useActiveChannelStore.setState({
    channelIdByProject: {}, globalChannelId: 'general-1', selectedScope: 'global',
  });
  void i18next.changeLanguage('ko');
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('chat member panel', () => {
  it('shows general opinion voting surface without meeting IPC', async () => {
    const invoke = vi.fn(async (channel: string) => {
      switch (channel) {
        case 'room:list': return { rooms: [] };
        case 'channel:get-global-general': return { channel: {
          id: 'general-1', projectId: null, name: 'General',
          kind: 'system_general', readOnly: false, createdAt: 1,
        } };
        case 'channel:list': return { channels: [] };
        case 'channel:list-members': return { members: [] };
        case 'opinion:listGeneralCards': return { result: { cards: [] } };
        default: throw new Error(`unexpected IPC: ${channel}`);
      }
    });
    vi.stubGlobal('arena', { platform: 'linux', invoke, onStream: () => () => {} });
    render(<MemberPanel />);
    await waitFor(() => expect(screen.getByTestId('ssm-box-general-cards')).toBeTruthy());
    expect(screen.queryByTestId('member-panel-consensus')).toBeNull();
    expect(invoke.mock.calls.map(([channel]) => channel).filter((channel) => channel.startsWith('meeting:'))).toEqual([]);
  });

  it('shows opinion cards in a chat room with no department role', async () => {
    useActiveChannelStore.setState({ globalChannelId: 'room-1', selectedScope: 'global' });
    const invoke = vi.fn(async (channel: string) => {
      switch (channel) {
        case 'room:list': return { rooms: [{
          id: 'room-1', projectId: null, name: 'Room', kind: 'user', role: null,
          isChatRoom: true, archivedAt: null, readOnly: false, createdAt: 1,
        }] };
        case 'channel:get-global-general': return { channel: {
          id: 'general-1', projectId: null, name: 'General',
          kind: 'system_general', readOnly: false, createdAt: 1,
        } };
        case 'channel:list': return { channels: [] };
        case 'channel:list-members': return { members: [] };
        case 'opinion:listGeneralCards': return { result: { cards: [] } };
        default: throw new Error(`unexpected IPC: ${channel}`);
      }
    });
    vi.stubGlobal('arena', { platform: 'linux', invoke, onStream: () => () => {} });
    render(<MemberPanel />);
    await screen.findByTestId('ssm-box-general-cards');
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('opinion:listGeneralCards', { channelId: 'room-1' }));
  });
});
