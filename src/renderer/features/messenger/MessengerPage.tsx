/**
 * MessengerPage — the 채팅 view (spec 2026-10-01-messenger-redesign.md R2/R3):
 * the chat list column next to the open conversation. DM deletion (from
 * the room's ⋯ menu) confirms here.
 */
import { useCallback, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { ChannelDeleteConfirm } from '../channels/ChannelDeleteConfirm';
import { ChatListColumn } from '../chat-list/ChatListColumn';
import { notifyChannelsChanged } from '../../hooks/channel-invalidation-bus';
import { useGlobalChannelLists } from '../../hooks/use-global-channel-lists';
import { useActiveChannelStore } from '../../stores/active-channel-store';
import { Thread } from './Thread';

export interface MessengerPageProps {
  /** Opens the message search across every conversation with this query. */
  onSearchMessages: (query: string) => void;
  className?: string;
}

export function MessengerPage({ onSearchMessages, className }: MessengerPageProps): ReactElement {
  const { t } = useTranslation();
  const { available } = useGlobalChannelLists();
  const activeChannelId = useActiveChannelStore((state) => state.globalChannelId);
  const setGlobalChannelId = useActiveChannelStore((state) => state.setGlobalChannelId);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const deleteTarget = available.find((channel) => channel.id === deleteTargetId) ?? null;

  const handleDeleted = useCallback((channelId: string): void => {
    setDeleteTargetId(null);
    if (useActiveChannelStore.getState().globalChannelId === channelId) {
      setGlobalChannelId(null);
    }
    void notifyChannelsChanged();
  }, [setGlobalChannelId]);

  return (
    <div data-testid="messenger-page" data-empty="false"
      className={`flex h-full min-h-0 min-w-0 flex-1 ${className ?? ''}`}>
      <ChatListColumn channels={available} activeChannelId={activeChannelId} onSelectChannel={setGlobalChannelId}
        onSearchMessages={onSearchMessages} />
      <section data-testid="messenger-thread" aria-label={t('messenger.pane.thread')}
        className="flex min-h-0 min-w-0 flex-1">
        <Thread onDeleteDm={setDeleteTargetId} />
      </section>
      <ChannelDeleteConfirm open={deleteTargetId !== null}
        onOpenChange={(open) => { if (!open) setDeleteTargetId(null); }}
        channel={deleteTarget} onDeleted={handleDeleted} />
    </div>
  );
}
