/**
 * One conversation in the chat list (spec 2026-10-01-messenger-redesign.md
 * R2-2). Bubble layout: avatar, name, time, preview, unread badge. Log
 * layout: no avatar, a `[방]` / `[1:1]` tag, the selected row inverted,
 * unread as `(2)`.
 */
import { clsx } from 'clsx';
import type { KeyboardEvent, MouseEvent, ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { useTheme } from '../../theme/use-theme';
import type { ChannelSummary } from '../../../shared/channel-summary-types';
import type { MemberView } from '../../../shared/member-profile-types';
import { ConversationAvatar } from './ConversationAvatar';

export interface ChatListRowProps {
  summary: ChannelSummary;
  label: string;
  preview: string;
  time: string;
  /** Badge text ("3", "99+"), or null when nothing is unread. */
  unread: string | null;
  active: boolean;
  memberById: ReadonlyMap<string, MemberView>;
  onSelect: (channelId: string) => void;
  onOpenMenu?: (channelId: string, position: { x: number; y: number }, trigger: HTMLButtonElement) => void;
}

export function ChatListRow({
  summary, label, preview, time, unread, active, memberById, onSelect, onOpenMenu,
}: ChatListRowProps): ReactElement {
  const { t } = useTranslation();
  const { token } = useTheme();
  const rowAttrs = {
    type: 'button' as const,
    'data-testid': 'chat-list-row',
    'data-channel-id': summary.channelId,
    'data-kind': summary.kind,
    'data-provider-id': summary.kind === 'dm' ? summary.participants[0]?.providerId : undefined,
    'data-active': active ? 'true' : 'false',
    'data-unread': String(summary.unreadCount),
    'aria-current': active ? ('true' as const) : undefined,
    'aria-haspopup': onOpenMenu ? ('menu' as const) : undefined,
    onClick: () => onSelect(summary.channelId),
    onContextMenu: (event: MouseEvent<HTMLButtonElement>) => {
      if (!onOpenMenu) return;
      event.preventDefault();
      onOpenMenu(summary.channelId, { x: event.clientX, y: event.clientY }, event.currentTarget);
    },
    onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
      if (!onOpenMenu || !(event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))) return;
      event.preventDefault();
      const bounds = event.currentTarget.getBoundingClientRect();
      onOpenMenu(summary.channelId, { x: bounds.left, y: bounds.bottom }, event.currentTarget);
    },
  };

  if (token.messageLayout === 'log') {
    return (
      <button {...rowAttrs}
        className={clsx('flex w-full flex-col gap-0.5 px-5 py-2 text-left',
          active ? 'bg-brand text-brand-fg' : 'text-fg hover:bg-sunk')}>
        <span className="flex justify-between gap-2">
          <span className="truncate text-body font-semibold">
            {summary.kind === 'dm' ? t('chatList.tag.dm') : t('chatList.tag.room')} {label}
          </span>
          <span className="shrink-0 font-mono text-micro">{time}</span>
        </span>
        <span className="flex justify-between gap-2 text-preview">
          <span data-testid="chat-list-preview"
            className={clsx('truncate', summary.kind === 'dm' ? 'pl-log-indent-dm' : 'pl-log-indent-room', !active && 'text-fg-muted')}>
            {preview}
          </span>
          {unread !== null ? (
            <span data-testid="chat-list-unread" className="shrink-0 font-bold">
              {t('chatList.unreadLog', { unread })}
            </span>
          ) : null}
        </span>
      </button>
    );
  }

  return (
    <button {...rowAttrs}
      className={clsx('flex w-full items-center gap-3 border-l-accent py-2.5 pl-5 pr-4 text-left',
        active ? 'border-brand bg-project-item-active-bg' : 'border-transparent hover:bg-sunk')}>
      <ConversationAvatar summary={summary} memberById={memberById} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate text-body font-semibold text-fg">{label}</span>
          <span className="shrink-0 font-mono text-micro text-fg-muted">{time}</span>
        </span>
        <span className="flex items-center justify-between gap-2">
          <span data-testid="chat-list-preview" className="truncate text-preview text-fg-muted">{preview}</span>
          {unread !== null ? (
            <span data-testid="chat-list-unread"
              className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center bg-unread-bg px-1.5 text-micro font-bold text-unread-fg [clip-path:var(--clip-control)]">
              {unread}
            </span>
          ) : null}
        </span>
      </span>
    </button>
  );
}
