/**
 * ChatListColumn — the chat navigation column (spec
 * 2026-10-01-messenger-redesign.md R2-2), replacing the old sidebar (general
 * entry, room list, archive toggle, DM list).
 *
 * Title with the "새 채팅방" button (existing room create flow), a search
 * field that filters the list by name / preview and offers a message
 * search across every conversation, the 전체 / 채팅방 / 보관함
 * filters, and one list ordered by last activity. Rows come from
 * `channel-summary-store.ts`; a failed read is shown, never an empty list.
 */
import { clsx } from 'clsx';
import { useMemo, useState, type KeyboardEvent, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import { LineIcon } from '../../components/shell/LineIcon';
import { reloadChannelSummaries } from '../../hooks/use-channel-summaries-sync';
import { useMembers } from '../../hooks/use-members';
import { useMinuteClock } from '../../hooks/use-minute-clock';
import { useChannelSummaryStore } from '../../stores/channel-summary-store';
import { useTheme } from '../../theme/use-theme';
import { CreateRoom } from '../rooms/CreateRoom';
import type { Channel } from '../../../shared/channel-types';
import type { MemberView } from '../../../shared/member-profile-types';
import {
  CHAT_LIST_FILTERS,
  conversationLabel,
  listTimeLabel,
  previewText,
  unreadLabel,
  visibleRows,
  type ChatListFilter,
} from './chat-list-model';
import { ChatListRow } from './ChatListRow';
import { ChatListContextMenu } from './ChatListContextMenu';

function filterLabel(t: TFunction, filter: ChatListFilter): string {
  switch (filter) {
    case 'all': return t('chatList.filter.all');
    case 'rooms': return t('chatList.filter.rooms');
    case 'archive': return t('chatList.filter.archive');
  }
}

export interface ChatListColumnProps {
  /** Full metadata from the same global channel list used by the open conversation. */
  channels?: Channel[];
  activeChannelId: string | null;
  onSelectChannel: (channelId: string) => void;
  /** Opens the message search across every conversation with this query. */
  onSearchMessages: (query: string) => void;
}

export function ChatListColumn({ channels = [], activeChannelId, onSelectChannel, onSearchMessages }: ChatListColumnProps): ReactElement {
  const { t, i18n } = useTranslation();
  const { token } = useTheme();
  const summaries = useChannelSummaryStore((state) => state.summaries);
  const error = useChannelSummaryStore((state) => state.error);
  const { members } = useMembers();
  const [filter, setFilter] = useState<ChatListFilter>('all');
  const [query, setQuery] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [contextTarget, setContextTarget] = useState<{
    channelId: string; x: number; y: number; trigger: HTMLButtonElement; open: boolean;
  } | null>(null);
  const logLayout = token.messageLayout === 'log';
  const channelById = useMemo(() => new Map(channels.map((channel) => [channel.id, channel])), [channels]);
  const contextChannel = contextTarget ? channelById.get(contextTarget.channelId) : undefined;

  const memberById = useMemo(() => new Map<string, MemberView>(
    (members ?? []).map((member) => [member.providerId, member])), [members]);
  const rows = useMemo(() => (summaries === null ? [] : visibleRows(t, summaries, filter, query)),
    [summaries, filter, query, t]);
  const now = useMinuteClock();
  const trimmedQuery = query.trim();

  const onSearchKey = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing || trimmedQuery.length === 0) return;
    event.preventDefault();
    onSearchMessages(trimmedQuery);
  };

  return (
    <section data-testid="chat-list" aria-label={t('chatList.aria')}
      className="flex w-80 shrink-0 flex-col border-r border-border-soft [background:var(--color-panel-bg)]">
      <div className="flex items-center justify-between pb-3 pl-5 pr-4 pt-5">
        <h1 className="font-display text-list-title font-bold">{token.titlePrefix}{t('chatList.title')}</h1>
        <button type="button" data-testid="room-create-open" aria-label={t('rooms.create')}
          onClick={() => setCreateOpen(true)}
          className="flex h-10 w-10 items-center justify-center border border-border text-brand-text hover:bg-sunk [clip-path:var(--clip-control)]">
          <LineIcon name="plus" size={18} stroke={2} />
        </button>
      </div>
      <div className="px-4 pb-2.5">
        <label className="flex h-10 items-center gap-2 border border-border-soft bg-sunk px-3 text-fg-muted [clip-path:var(--clip-control)]">
          <LineIcon name="search" size={16} stroke={2} />
          <span className="sr-only">{t('chatList.search.label')}</span>
          <input type="search" data-testid="chat-list-search" value={query}
            placeholder={t('chatList.search.placeholder')}
            onChange={(event) => setQuery(event.target.value)} onKeyDown={onSearchKey}
            className="min-w-0 flex-1 bg-transparent text-preview text-fg outline-none placeholder:text-fg-subtle" />
        </label>
      </div>
      <div role="tablist" aria-label={t('chatList.filter.label')} className="flex gap-1.5 px-4 pb-3">
        {CHAT_LIST_FILTERS.map((item) => (
          <button key={item} type="button" role="tab" aria-selected={filter === item}
            data-testid="chat-list-filter" data-filter={item} onClick={() => setFilter(item)}
            className={clsx('h-8 px-3 text-meta',
              logLayout
                ? (filter === item ? 'bg-brand text-brand-fg' : 'text-fg-muted hover:text-fg')
                : clsx('border [clip-path:var(--clip-control)]', filter === item
                  ? 'border-brand bg-project-item-active-bg text-brand-text'
                  : 'border-border-soft text-fg-muted hover:text-fg'))}>
            {filterLabel(t, item)}
          </button>
        ))}
      </div>
      <div data-testid="chat-list-items" className="min-h-0 flex-1 overflow-y-auto">
        {trimmedQuery.length > 0 ? (
          <button type="button" data-testid="chat-list-search-messages"
            onClick={() => onSearchMessages(trimmedQuery)}
            className="flex w-full items-center gap-2 px-5 py-2.5 text-left text-sm text-brand-text hover:bg-sunk">
            <LineIcon name="search" size={14} stroke={2} />
            {t('chatList.search.messages', { query: trimmedQuery })}
          </button>
        ) : null}
        {error !== null ? (
          <div data-testid="chat-list-error" role="alert" className="flex flex-col items-start gap-1.5 px-5 py-2 text-xs text-danger-text">
            <span>{t('chatList.loadFailed', { message: error.message })}</span>
            <button type="button" data-testid="chat-list-retry" onClick={reloadChannelSummaries}
              className="font-semibold underline-offset-2 hover:underline">
              {t('chatList.retry')}
            </button>
          </div>
        ) : null}
        {summaries === null ? (
          error === null ? <p data-testid="chat-list-loading" className="px-5 py-2 text-xs text-fg-muted">{t('chatList.loading')}</p> : null
        ) : rows.length === 0 ? (
          <p data-testid="chat-list-empty" className="px-5 py-2 text-xs text-fg-muted">
            {trimmedQuery.length > 0 ? t('chatList.noMatch') : t('chatList.empty')}
          </p>
        ) : (
          <ul aria-label={t('chatList.aria')}>
            {rows.map((summary) => (
              <li key={summary.channelId}>
                <ChatListRow summary={summary} label={conversationLabel(t, summary)}
                  preview={previewText(t, summary)}
                  time={listTimeLabel(t, summary.lastActivityAt, now, i18n.language)}
                  unread={unreadLabel(summary.unreadCount)} active={summary.channelId === activeChannelId}
                  memberById={memberById} onSelect={onSelectChannel}
                  onOpenMenu={channelById.has(summary.channelId) ? (channelId, position, trigger) => {
                    setContextTarget({ channelId, ...position, trigger, open: true });
                  } : undefined} />
              </li>
            ))}
          </ul>
        )}
      </div>
      {createOpen ? <CreateRoom open onOpenChange={setCreateOpen} onCreated={onSelectChannel} /> : null}
      {contextTarget && contextChannel ? (
        <ChatListContextMenu key={`${contextChannel.id}:${contextChannel.readOnly}`} channel={contextChannel} target={contextTarget}
          onOpenChange={(open) => setContextTarget((target) => target ? { ...target, open } : null)} />
      ) : null}
    </section>
  );
}
