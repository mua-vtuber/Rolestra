// @vitest-environment jsdom

/**
 * AiListView (spec 2026-10-01-messenger-redesign.md R2-3/R2-4): each AI
 * with avatar (not in the log layout), name and the first line of its
 * character sheet; picking one opens its existing DM or creates one; no
 * add button, and with no AI a link to the settings AI tab.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AiListView, characterPreview } from '../AiListView';
import { i18next } from '../../../i18n';
import { ThemeProvider } from '../../../theme/theme-provider';
import { DEFAULT_MODE, DEFAULT_THEME, useThemeStore } from '../../../theme/theme-store';
import type { ThemeKey } from '../../../theme/theme-tokens';
import { chatChannelForTest } from '../../../../test-utils/channel-fixture';
import type { MemberView, WorkStatus } from '../../../../shared/member-profile-types';

function member(providerId: string, displayName: string, characterSheet: string): MemberView {
  return {
    providerId, displayName, characterSheet, avatarKind: 'default', avatarData: null,
    statusOverride: null, updatedAt: 1, workStatus: 'online' as WorkStatus,
  };
}

const LUNA = member('ai-luna', '루나', '\n  밤하늘을 좋아하는 몽상가\n둘째 줄');
const SORA = member('ai-sora', '소라', '');
const LUNA_DM = chatChannelForTest({
  id: 'dm-luna', projectId: null, name: 'dm:ai-luna', kind: 'dm', readOnly: false, createdAt: 1,
});
const SORA_DM = chatChannelForTest({
  id: 'dm-sora-new', projectId: null, name: 'dm:ai-sora', kind: 'dm', readOnly: false, createdAt: 2,
});

function stubBridge(options: { members?: MemberView[]; createFails?: boolean } = {}) {
  const invoke = vi.fn(async (channel: string) => {
    switch (channel) {
      case 'member:list': return { members: options.members ?? [LUNA, SORA] };
      case 'dm:list': return { items: [
        { providerId: 'ai-luna', providerName: '루나', channel: LUNA_DM, exists: true },
        { providerId: 'ai-sora', providerName: '소라', channel: null, exists: false },
      ] };
      case 'dm:create':
        if (options.createFails) throw new Error('provider removed');
        return { channel: SORA_DM };
      case 'channel:list': return { channels: [] };
      case 'room:list': return { rooms: [] };
      case 'channel:get-global-general': return { channel: null };
      default: throw new Error(`unexpected IPC: ${channel}`);
    }
  });
  vi.stubGlobal('arena', { platform: 'linux', invoke, onStream: () => () => {} });
  return invoke;
}

function renderView(themeKey: ThemeKey = 'tactical') {
  useThemeStore.setState({ themeKey, mode: 'dark' });
  const onOpenChannel = vi.fn();
  const onOpenAiSettings = vi.fn();
  render(<ThemeProvider><AiListView onOpenChannel={onOpenChannel} onOpenAiSettings={onOpenAiSettings} /></ThemeProvider>);
  return { onOpenChannel, onOpenAiSettings };
}

async function enabledRow(providerId: string): Promise<HTMLButtonElement> {
  const row = await waitFor(() => {
    const found = document.querySelector(`[data-testid="ai-list-row"][data-provider-id="${providerId}"]`) as HTMLButtonElement | null;
    if (found === null || found.disabled) throw new Error('row not ready');
    return found;
  });
  return row;
}

beforeEach(() => { void i18next.changeLanguage('ko'); });
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  useThemeStore.setState({ themeKey: DEFAULT_THEME, mode: DEFAULT_MODE });
});

describe('AiListView', () => {
  it('lists each AI with avatar, name and the first character-sheet line', async () => {
    stubBridge();
    renderView();
    await enabledRow('ai-luna');
    const rows = screen.getAllByTestId('ai-list-row');
    expect(rows.map((row) => row.getAttribute('data-provider-id'))).toEqual(['ai-luna', 'ai-sora']);
    expect(screen.getAllByTestId('ai-list-character').map((line) => line.textContent))
      .toEqual(['밤하늘을 좋아하는 몽상가', '캐릭터 설정이 비어 있습니다']);
    expect(screen.getAllByTestId('avatar')).toHaveLength(2);
    expect(screen.queryByTestId('settings-ai-add')).toBeNull();
  });

  it('opens the existing DM without creating another', async () => {
    const invoke = stubBridge();
    const { onOpenChannel } = renderView();
    fireEvent.click(await enabledRow('ai-luna'));
    await waitFor(() => expect(onOpenChannel).toHaveBeenCalledWith('dm-luna'));
    expect(invoke.mock.calls.some(([channel]) => channel === 'dm:create')).toBe(false);
  });

  it('creates a DM through dm:create when there is none yet', async () => {
    const invoke = stubBridge();
    const { onOpenChannel } = renderView();
    fireEvent.click(await enabledRow('ai-sora'));
    await waitFor(() => expect(onOpenChannel).toHaveBeenCalledWith('dm-sora-new'));
    expect(invoke).toHaveBeenCalledWith('dm:create', { providerId: 'ai-sora' });
  });

  it('shows why a DM could not be opened', async () => {
    stubBridge({ createFails: true });
    const { onOpenChannel } = renderView();
    fireEvent.click(await enabledRow('ai-sora'));
    expect((await screen.findByTestId('ai-list-open-error')).textContent).toContain('provider removed');
    expect(onOpenChannel).not.toHaveBeenCalled();
  });

  it('with no AI, says to add one in settings and links to the AI tab', async () => {
    stubBridge({ members: [] });
    const { onOpenAiSettings } = renderView();
    expect((await screen.findByTestId('ai-list-empty')).textContent).toContain('설정에서 AI를 추가하세요');
    fireEvent.click(screen.getByTestId('ai-list-open-settings'));
    expect(onOpenAiSettings).toHaveBeenCalledTimes(1);
  });

  it('has no avatars in the log layout', async () => {
    stubBridge();
    renderView('retro');
    await enabledRow('ai-luna');
    expect(screen.queryByTestId('avatar')).toBeNull();
  });
});

describe('characterPreview', () => {
  it('takes the first non-empty line, trimmed; null when the sheet is blank', () => {
    expect(characterPreview('\n  첫 줄  \n둘째')).toBe('첫 줄');
    expect(characterPreview('  \n ')).toBeNull();
  });
});
