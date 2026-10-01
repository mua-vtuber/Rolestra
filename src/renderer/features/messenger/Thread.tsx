/**
 * Thread — the open conversation (spec 2026-10-01-messenger-redesign.md R3):
 * header, the message list in the theme's layout (bubbles or log), the
 * writing indicator, the composer, and the room-info drawer (members and
 * opinion cards) — closed by default; open/closed is kept only in screen
 * state.
 *
 * Read marker (R4-3): while the window is visible, every time the newest
 * stored message of the open conversation changes it is sent to
 * `channel:mark-read`, and the chat list row drops to 0 unread.
 */
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { notifyError } from '../../components/ErrorBoundary';
import { useActiveChannel } from '../../hooks/use-active-channel';
import { useChannelMembers } from '../../hooks/use-channel-members';
import { isPendingMessageId, useChannelMessages } from '../../hooks/use-channel-messages';
import { markChannelRead } from '../../hooks/use-channel-summaries-sync';
import { useDocumentVisible } from '../../hooks/use-document-visible';
import { useGlobalChannelLists } from '../../hooks/use-global-channel-lists';
import { useActiveChannelStore } from '../../stores/active-channel-store';
import { useChannelSummaryStore } from '../../stores/channel-summary-store';
import { useTheme } from '../../theme/use-theme';
import { conversationLabel } from '../chat-list/chat-list-model';
import type { Channel } from '../../../shared/channel-types';
import { ChatActivityIndicator } from './ChatActivityIndicator';
import { Composer } from './Composer';
import { MemberPanel } from './MemberPanel';
import type { MessageSpeaker } from './Message';
import { renderMessageList } from './MessageList';
import { PassTurnButton } from './PassTurnButton';
import { RoomHeader } from './RoomHeader';

export interface ThreadProps {
  onDeleteDm?: (channelId: string) => void;
  className?: string;
}

function isGroup(channel: Channel): boolean {
  return channel.kind === 'system_general' || channel.isChatRoom === true;
}

export function Thread({ onDeleteDm, className }: ThreadProps): ReactElement {
  const { t, i18n } = useTranslation();
  const { token } = useTheme();
  const { available, authoritative } = useGlobalChannelLists();
  const { activeChannelId } = useActiveChannel(null, authoritative);
  const setGlobalChannelId = useActiveChannelStore((state) => state.setGlobalChannelId);
  const activeChannel = available.find((channel) => channel.id === activeChannelId) ?? null;
  const memberChannels = activeChannel === null && authoritative === null ? null : available;
  const { members } = useChannelMembers(activeChannelId, memberChannels);
  const { messages, loading, error, refresh, loadOlder, hasOlder, loadingOlder } = useChannelMessages(activeChannelId);
  const summary = useChannelSummaryStore((state) =>
    state.summaries?.find((item) => item.channelId === activeChannelId) ?? null);
  const visible = useDocumentVisible();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const speakers = useMemo(() => new Map<string, MessageSpeaker>((members ?? []).map(
    (member, seat) => [member.providerId, { name: member.displayName, seat, profile: member }])), [members]);
  const nameByProvider = useMemo(() => new Map([...speakers].map(
    ([providerId, speaker]) => [providerId, speaker.name] as const)), [speakers]);

  const newestStoredId = useMemo(() => {
    const stored = (messages ?? []).filter((message) =>
      message.channelId === activeChannelId && !isPendingMessageId(message.id));
    return stored[stored.length - 1]?.id ?? null;
  }, [messages, activeChannelId]);

  useEffect(() => {
    if (activeChannelId === null || newestStoredId === null || !visible) return;
    markChannelRead(activeChannelId, newestStoredId).catch((reason: unknown) => {
      notifyError(t('chatList.markReadFailed', { message: reason instanceof Error ? reason.message : String(reason) }));
    });
  }, [activeChannelId, newestStoredId, visible, t]);

  if (activeChannel === null) {
    return (
      <div data-testid="thread" data-empty="true"
        className={`flex h-full flex-1 items-center justify-center p-6 ${className ?? ''}`}>
        <p data-testid="thread-empty-state" className="text-sm text-fg-muted">
          {t('messenger.emptyState.noActiveChannel')}
        </p>
      </div>
    );
  }

  const title = summary !== null ? conversationLabel(t, summary)
    : activeChannel.kind === 'system_general' ? t('chatList.generalName')
      : activeChannel.kind === 'dm' ? members?.[0]?.displayName ?? t('chatList.deletedAi')
        : activeChannel.name;
  const messageRows = renderMessageList((messages ?? []).filter((m) => m.channelId === activeChannel.id),
    speakers, token.messageLayout, i18n.language);

  return (
    <div data-testid="thread" data-empty="false" data-channel-id={activeChannel.id}
      className={`flex h-full min-h-0 min-w-0 flex-1 ${className ?? ''}`}>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-canvas">
        <RoomHeader key={activeChannel.id} channel={activeChannel} title={title} members={members}
          drawerOpen={drawerOpen} onToggleDrawer={() => setDrawerOpen((open) => !open)}
          onDeleteDm={onDeleteDm} onNavigate={(channelId) => setGlobalChannelId(channelId)} />
        {activeChannel.isChatRoom && activeChannel.readOnly ? (
          <p data-testid="room-archived-notice" className="border-b border-border-soft px-5 py-2 text-xs text-fg-muted">
            {t('rooms.readOnly')}
          </p>
        ) : null}
        <div data-testid="thread-message-list" data-layout={token.messageLayout}
          className={`flex min-h-0 flex-1 flex-col overflow-y-auto px-7 pb-2 pt-4 ${token.messageLayout === 'log' ? 'gap-3.5' : 'gap-0'}`}>
          {hasOlder ? <button type="button" data-testid="chat-load-older" disabled={loadingOlder}
            onClick={() => { void loadOlder(); }}
            className="mb-3 self-center border border-border-soft px-3 py-1 text-xs text-fg-muted disabled:opacity-40 [clip-path:var(--clip-control)]">
            {loadingOlder ? t('rooms.loadingHistory') : t('rooms.olderMessages')}
          </button> : null}
          {error ? <p role="alert" className="text-xs text-danger-text">{t('messenger.thread.error')}</p> : null}
          {loading && messages === null ? (
            <p data-testid="thread-loading" className="text-xs text-fg-muted">{t('messenger.thread.loading')}</p>
          ) : messageRows.length === 0 ? (
            <p data-testid="thread-empty-messages" className="text-xs text-fg-muted">{t('messenger.thread.empty')}</p>
          ) : messageRows}
        </div>
        <ChatActivityIndicator key={`activity-${activeChannel.id}`} channelId={activeChannel.id} names={nameByProvider} />
        <Composer channelId={activeChannel.id} readOnly={activeChannel.readOnly}
          onSendSuccess={() => void refresh()}
          actions={isGroup(activeChannel) && !activeChannel.readOnly
            ? <PassTurnButton key={`pass-${activeChannel.id}`} channelId={activeChannel.id} />
            : null} />
      </div>
      {drawerOpen ? (
        <aside data-testid="messenger-member-panel" aria-label={t('messenger.pane.memberPanel')}
          className="w-72 shrink-0 overflow-y-auto border-l border-border-soft [background:var(--color-panel-bg)]">
          <MemberPanel />
        </aside>
      ) : null}
    </div>
  );
}
