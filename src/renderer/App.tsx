import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import './i18n';
import { NavRail, Shell } from './components/shell';
import type { NavRailItem } from './components/shell';
import { AiListView } from './features/ai-list/AiListView';
import { conversationLabel } from './features/chat-list/chat-list-model';
import { MessengerPage } from './features/messenger/MessengerPage';
import { MessageSearchView } from './features/search/MessageSearchView';
import { SettingsView } from './features/settings/SettingsView';
import { requestSettingsTab } from './features/settings/settings-tab-route';
import { useChannelSummariesSync } from './hooks/use-channel-summaries-sync';
import { useChatActivityStream } from './hooks/use-chat-activity-stream';
import { useGlobalChannelLists } from './hooks/use-global-channel-lists';
import { useMembers } from './hooks/use-members';
import { invoke } from './ipc/invoke';
import { useActiveChannelStore } from './stores/active-channel-store';
import { useAppViewStore, type AppView } from './stores/app-view-store';
import { useChannelSummaryStore } from './stores/channel-summary-store';
import { notifyError } from './components/ErrorBoundary';

function readLegacyActiveProjectId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem('rolestra.activeProject.v1');
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as { state?: { activeProjectId?: unknown } };
    return typeof parsed.state?.activeProjectId === 'string'
      ? parsed.state.activeProjectId : null;
  } catch {
    return null;
  }
}

export function App() {
  const { t } = useTranslation();
  const view = useAppViewStore((state) => state.view);
  const setView = useAppViewStore((state) => state.setView);
  const globalChannelId = useActiveChannelStore((state) => state.globalChannelId);
  const channelIdByProject = useActiveChannelStore((state) => state.channelIdByProject);
  const selectedScope = useActiveChannelStore((state) => state.selectedScope);
  const setGlobalChannelId = useActiveChannelStore((state) => state.setGlobalChannelId);
  const { authoritative, generalChannel } = useGlobalChannelLists();
  const { members } = useMembers();
  // Writing indicator state for every channel (spec 2026-10-01 F5).
  useChatActivityStream();
  // Chat list rows: one read, then per-message patches (spec 2026-10-01 R4).
  useChannelSummariesSync();
  const summaries = useChannelSummaryStore((state) => state.summaries);
  const [search, setSearch] = useState<{ open: boolean; query: string }>({ open: false, query: '' });
  const legacyProjectId = useMemo(() => readLegacyActiveProjectId(), []);
  const legacyChannelId = legacyProjectId === null
    ? null : channelIdByProject[legacyProjectId] ?? null;

  useEffect(() => {
    if (globalChannelId !== null && selectedScope !== 'global') {
      setGlobalChannelId(globalChannelId);
    }
  }, [globalChannelId, selectedScope, setGlobalChannelId]);

  // Preserve a valid saved DM. Only replace a missing saved ID after both
  // global lists have loaded successfully; no project is needed for chat.
  useEffect(() => {
    if (generalChannel === null) return;
    const selected = useActiveChannelStore.getState().globalChannelId;
    if (selected === null) {
      if (legacyChannelId !== null) {
        if (authoritative === null) return;
        const legacyGlobal = authoritative.find((channel) => channel.id === legacyChannelId);
        if (legacyGlobal) {
          setGlobalChannelId(legacyGlobal.id);
          return;
        }
      }
      setGlobalChannelId(generalChannel.id);
    } else if (authoritative !== null &&
      !authoritative.some((channel) => channel.id === selected)) {
      setGlobalChannelId(generalChannel.id);
    }
  }, [generalChannel, authoritative, legacyChannelId, setGlobalChannelId]);

  useEffect(() => {
    const arena = (window as unknown as { arena?: unknown }).arena;
    if (!arena) return;
    void invoke('config:take-startup-diagnostics', undefined).then(
      ({ settingsCorruption }) => {
        if (settingsCorruption === null) return;
        const reasonKey = settingsCorruption.reason === 'invalid-json'
          ? 'app.startupDiagnostics.settingsCorruption.invalidJson'
          : settingsCorruption.reason === 'non-object'
            ? 'app.startupDiagnostics.settingsCorruption.nonObject'
            : 'app.startupDiagnostics.settingsCorruption.readError';
        const backupPath = settingsCorruption.backupPath
          ?? t('app.startupDiagnostics.settingsCorruption.noBackup');
        notifyError(t(reasonKey, { backupPath }));
      },
      (reason: unknown) => {
        console.warn('[rolestra] startup diagnostics failed', reason);
      },
    );
    // Startup diagnostic is deliberately read once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearch((current) => ({ open: !current.open, query: '' }));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const navItems = useMemo<NavRailItem[]>(() => [
    { id: 'messenger', icon: 'chat', label: t('chat.nav') },
    { id: 'ai-list', icon: 'people', label: t('aiList.nav') },
  ], [t]);
  const navBottomItems = useMemo<NavRailItem[]>(() => [
    { id: 'settings', icon: 'settings', label: t('settings.title') },
  ], [t]);
  const railActive: AppView = view === 'settings' || view === 'ai-list' ? view : 'messenger';

  const openChannel = useCallback((channelId: string): void => {
    setGlobalChannelId(channelId);
    setView('messenger');
  }, [setGlobalChannelId, setView]);

  // AI add lives only in settings → AI (spec 2026-10-01 R5-7); the empty
  // chat guidance links there instead of opening the dialog itself.
  const openAiSettings = useCallback((): void => {
    requestSettingsTab('ai');
    setView('settings');
  }, [setView]);

  const channelLabel = useCallback((channelId: string): string | null => {
    const summary = summaries?.find((item) => item.channelId === channelId);
    return summary ? conversationLabel(t, summary) : null;
  }, [summaries, t]);

  return (
    <Shell nav={<NavRail items={navItems} bottomItems={navBottomItems} activeId={railActive}
      onSelect={(id) => setView(id === 'settings' || id === 'ai-list' ? id : 'messenger')} />}>
      {view === 'settings' ? <SettingsView /> : view === 'ai-list' ? (
        <AiListView onOpenChannel={openChannel} onOpenAiSettings={openAiSettings} />
      ) : (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {members !== null && members.length === 0 ? (
            <div data-testid="chat-empty-provider" className="mx-4 mt-3 flex shrink-0 items-center justify-between gap-3 border border-border-soft px-4 py-3 [background:var(--color-panel-bg)] [clip-path:var(--clip-control)]">
              <span className="text-sm text-fg-muted">{t('chat.emptyProviders')}</span>
              <button type="button" data-testid="chat-empty-connect" onClick={openAiSettings}
                className="shrink-0 text-sm font-semibold text-brand-text underline-offset-2 hover:underline">
                {t('chat.openAiSettings')}
              </button>
            </div>
          ) : null}
          <MessengerPage className="min-h-0 flex-1"
            onSearchMessages={(query) => setSearch({ open: true, query })} />
        </div>
      )}
      <MessageSearchView open={search.open}
        onOpenChange={(open) => setSearch((current) => ({ ...current, open }))}
        scope={{ kind: 'chats' }} initialQuery={search.query} channelLabel={channelLabel}
        onNavigate={(channelId) => openChannel(channelId)} />
    </Shell>
  );
}
