// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../App';
import { i18next } from '../i18n';
import { useActiveChannelStore } from '../stores/active-channel-store';
import { DEFAULT_APP_VIEW, useAppViewStore } from '../stores/app-view-store';
import type { Channel } from '../../shared/channel-types';
import { chatChannelForTest } from '../../test-utils/channel-fixture';
import type { ChannelSummary } from '../../shared/channel-summary-types';

const general = chatChannelForTest({
  id: 'general-1', projectId: null, name: 'general',
  kind: 'system_general', readOnly: false, createdAt: 1,
});
const dm = chatChannelForTest({
  id: 'dm-1', projectId: null, name: 'dm:ai-1',
  kind: 'dm', readOnly: false, createdAt: 2,
});

function summary(channel: Channel, kind: ChannelSummary['kind'], participants: ChannelSummary['participants']): ChannelSummary {
  return {
    channelId: channel.id, kind, name: channel.name, archivedAt: null, participants,
    lastMessage: null, lastActivityAt: channel.createdAt, unreadCount: 0,
  };
}

const SUMMARIES: ChannelSummary[] = [
  summary(general, 'general', []),
  summary(dm, 'dm', [{ providerId: 'ai-1', displayName: 'AI One' }]),
];

function stubBridge(options: { dms?: Channel[] | Promise<Channel[]>; rooms?: Channel[] | Promise<Channel[]> } = {}) {
  const invoke = vi.fn(async (channel: string, data?: unknown) => {
    switch (channel) {
      case 'room:list': return { rooms: await (options.rooms ?? []) };
      case 'onboarding:get-state':
        return { state: { completed: false, currentStep: 1, selections: {}, updatedAt: 1 } };
      case 'config:take-startup-diagnostics': return { settingsCorruption: null };
      case 'channel:get-global-general': return { channel: general };
      case 'channel:list':
        return { channels: (data as { projectId: string | null }).projectId === null
          ? await (options.dms ?? [dm]) : [] };
      case 'dm:list':
        return { items: [{ providerId: 'ai-1', providerName: 'AI One', channel: dm, exists: true }] };
      case 'channel:list-members': return { members: [] };
      case 'member:list': return { members: [] };
      case 'message:list-by-channel': return { messages: [] };
      case 'provider:list': return { providers: [] };
      case 'provider:list-inactive-cli': return { inactive: [] };
      case 'chat:list-active-rounds': return { channelIds: [] };
      case 'channel:list-summaries': return { summaries: SUMMARIES };
      default: throw new Error(`unexpected IPC: ${channel}`);
    }
  });
  vi.stubGlobal('arena', { platform: 'linux', invoke, onStream: () => () => {} });
  return invoke;
}

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  localStorage.removeItem('rolestra.activeProject.v1');
  useAppViewStore.setState({ view: DEFAULT_APP_VIEW });
  useActiveChannelStore.setState({
    channelIdByProject: {}, globalChannelId: null, selectedScope: 'project',
  });
  void i18next.changeLanguage('ko');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.removeItem('rolestra.activeProject.v1');
});

describe('chat-first shell', () => {
  it('keeps an archived room selection while its list is loading and renders it read-only', async () => {
    let finishRooms: (rooms: Channel[]) => void = () => {};
    const pendingRooms = new Promise<Channel[]>((resolve) => { finishRooms = resolve; });
    const archived = { ...general, id: 'archived-room', kind: 'user' as const, name: 'Old story',
      isChatRoom: true, archivedAt: 123, readOnly: true };
    stubBridge({ rooms: pendingRooms });
    useActiveChannelStore.setState({ globalChannelId: archived.id, selectedScope: 'global' });
    render(<App />);
    await act(async () => {});
    expect(useActiveChannelStore.getState().globalChannelId).toBe(archived.id);
    await act(async () => { finishRooms([archived]); });
    expect(await screen.findByTestId('room-archived-notice')).toBeTruthy();
    expect(screen.getByTestId('composer-textarea').hasAttribute('disabled')).toBe(true);
    expect(useActiveChannelStore.getState().globalChannelId).toBe(archived.id);
  });
  it('opens general with no projects and no forced work onboarding', async () => {
    expect(DEFAULT_APP_VIEW).toBe('messenger');
    const invoke = stubBridge();
    render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId('thread').getAttribute('data-channel-id')).toBe(general.id);
    });
    expect(screen.getByTestId('composer')).toBeTruthy();
    expect(screen.queryByTestId('onboarding-page')).toBeNull();
    expect(screen.queryByTestId('sidebar-section-projects')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Dashboard' })).toBeNull();
    expect(invoke.mock.calls.map(([channel]) => channel).filter((channel) =>
      /^(project|queue|meeting|approval|execution|handoff):/.test(channel))).toEqual([]);
  });

  it('restores a saved DM instead of replacing it with general', async () => {
    stubBridge();
    useActiveChannelStore.setState({ globalChannelId: dm.id, selectedScope: 'global' });
    render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId('thread').getAttribute('data-channel-id')).toBe(dm.id);
    });
    expect(useActiveChannelStore.getState().globalChannelId).toBe(dm.id);
  });

  it('falls back from a missing saved DM after authoritative lists load', async () => {
    stubBridge();
    useActiveChannelStore.setState({ globalChannelId: 'missing-dm', selectedScope: 'global' });
    render(<App />);
    await waitFor(() => {
      expect(useActiveChannelStore.getState().globalChannelId).toBe(general.id);
      expect(screen.getByTestId('thread').getAttribute('data-channel-id')).toBe(general.id);
    });
  });

  it('switches a saved global channel out of a legacy project scope', async () => {
    stubBridge();
    useActiveChannelStore.setState({ globalChannelId: dm.id, selectedScope: 'project' });
    render(<App />);
    await waitFor(() => expect(useActiveChannelStore.getState().selectedScope).toBe('global'));
    expect(useActiveChannelStore.getState().globalChannelId).toBe(dm.id);
  });

  it('recovers a valid DM stored only in the old project slot before choosing general', async () => {
    let finishDms: (channels: Channel[]) => void = () => {};
    const delayedDms = new Promise<Channel[]>((resolve) => { finishDms = resolve; });
    stubBridge({ dms: delayedDms });
    localStorage.setItem('rolestra.activeProject.v1', JSON.stringify({
      state: { activeProjectId: 'legacy-project' }, version: 0,
    }));
    useActiveChannelStore.setState({
      channelIdByProject: { 'legacy-project': dm.id },
      globalChannelId: null,
      selectedScope: 'project',
    });
    render(<App />);
    await waitFor(() => {
      expect(document.querySelector('[data-testid="chat-list-row"][data-kind="general"]')).not.toBeNull();
    });
    expect(useActiveChannelStore.getState().globalChannelId).toBeNull();
    await act(async () => { finishDms([dm]); });
    await waitFor(() => {
      expect(useActiveChannelStore.getState().globalChannelId).toBe(dm.id);
      expect(screen.getByTestId('thread').getAttribute('data-channel-id')).toBe(dm.id);
    });
  });

  // spec 2026-10-01-messenger-redesign.md R2-1: rail = logo, chat, AI list,
  // spacer, settings; no top bar, and message search lives in the chat list.
  it('shows the chat list and the rail without a top bar', async () => {
    stubBridge();
    render(<App />);
    expect(await screen.findByTestId('chat-list')).toBeTruthy();
    const navIds = [...document.querySelectorAll('[data-nav-id]')].map((node) => node.getAttribute('data-nav-id'));
    expect(navIds).toEqual(['messenger', 'ai-list', 'settings']);
    expect(screen.queryByTestId('shell-topbar')).toBeNull();
    expect(screen.queryByTestId('shell-topbar-search')).toBeNull();
    await waitFor(() => {
      expect(document.querySelectorAll('[data-testid="chat-list-row"]').length).toBe(2);
    });
  });

  // spec 2026-10-01-messenger-redesign.md R5-7: AI add lives only in
  // settings → AI. The empty chat shows guidance and a link there.
  it('has no AI add button outside settings; the empty chat links to the settings AI tab', async () => {
    stubBridge();
    render(<App />);

    expect(await screen.findByTestId('chat-empty-provider')).toBeTruthy();
    expect(screen.queryByTestId('chat-connect-provider')).toBeNull();
    expect(screen.queryByTestId('provider-connect-dialog')).toBeNull();

    act(() => { screen.getByTestId('chat-empty-connect').click(); });

    expect(await screen.findByTestId('settings-tab-ai')).toBeTruthy();
    expect(useAppViewStore.getState().view).toBe('settings');
    expect(window.location.hash).toBe('#settings/ai');
    expect(screen.getByTestId('settings-ai-add')).toBeTruthy();
    expect(screen.queryByTestId('provider-connect-dialog')).toBeNull();
  });
});
