/**
 * RoomHeader — the top of an open conversation (spec
 * 2026-10-01-messenger-redesign.md R3-1).
 *
 * - Bubbles: overlapping participant avatars, the name, and "이름들 · AI N명"
 *   (a DM says "1:1 대화").
 * - Log: `> 이름` and "참가자: …", no avatars.
 * - The ⋯ menu sits beside the title. The right side holds the observer
 *   marker, in-room search, and the room-info drawer toggle at the edge.
 *
 * Mounted with `key={channel.id}`, so an open opinion draft, confirm
 * dialog or search closes when the user switches conversations.
 */
import type { ReactElement } from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Avatar } from '../../components/members/Avatar';
import { LineIcon } from '../../components/shell/LineIcon';
import { notifyOpinionCardsChanged } from '../../hooks/opinion-card-invalidation-bus';
import { useTheme } from '../../theme/use-theme';
import { RoomControls } from '../rooms/RoomControls';
import { MessageSearchView } from '../search/MessageSearchView';
import type { Channel } from '../../../shared/channel-types';
import type { MemberView } from '../../../shared/member-profile-types';
import { PostOpinionModal } from './PostOpinionModal';
import { RoomMenu } from './RoomMenu';

/** Most avatars the bubble header stacks. */
const HEADER_AVATAR_MAX = 3;
// Matches the h-8 / w-8 (32px) boxes of the stack.
const HEADER_AVATAR_SIZE = 32;

export interface RoomHeaderProps {
  channel: Channel;
  title: string;
  /** The channel's members (room snapshot order); null while loading. */
  members: MemberView[] | null;
  drawerOpen: boolean;
  onToggleDrawer: () => void;
  onDeleteDm?: (channelId: string) => void;
  /** Jump to a message found by the in-room search. */
  onNavigate: (channelId: string) => void;
}

export function RoomHeader({
  channel, title, members, drawerOpen, onToggleDrawer, onDeleteDm, onNavigate,
}: RoomHeaderProps): ReactElement {
  const { t } = useTranslation();
  const { token } = useTheme();
  const [opinionOpen, setOpinionOpen] = useState(false);
  const [roomAction, setRoomAction] = useState<'archive' | 'delete' | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const logLayout = token.messageLayout === 'log';
  const group = channel.kind === 'system_general' || channel.isChatRoom === true;
  const names = (members ?? []).map((member) => member.displayName).join(', ');
  const subtitle = members === null ? '' : logLayout
    ? t('room.header.participants', { names })
    : channel.kind === 'dm' ? t('room.header.dm') : t('room.header.members', { names, count: members.length });
  const canPostOpinion = group && !channel.readOnly;

  return (
    <header data-testid="room-header"
      className="flex h-16 shrink-0 items-center gap-3.5 border-b border-border-soft px-5 [background:var(--color-topbar-bg)]">
      {logLayout ? null : (
        <span data-testid="room-header-avatars" className="flex shrink-0">
          {(members ?? []).slice(0, HEADER_AVATAR_MAX).map((member, index) => (
            <span key={member.providerId} className={index === 0 ? '' : '-ml-2'}>
              <Avatar providerId={member.providerId} displayName={member.displayName}
                avatarKind={member.avatarKind} avatarData={member.avatarData}
                size={HEADER_AVATAR_SIZE} shape={token.avatarShape} />
            </span>
          ))}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1">
          <h2 data-testid="room-title" className="truncate font-display text-room-title font-bold text-fg">
            {token.titlePrefix}{title}
          </h2>
          <RoomMenu channel={channel} actions={{
            onPostOpinion: canPostOpinion ? () => setOpinionOpen(true) : undefined,
            onArchiveRoom: channel.isChatRoom ? () => setRoomAction('archive') : undefined,
            onDeleteRoom: channel.isChatRoom ? () => setRoomAction('delete') : undefined,
            onDeleteDm: channel.kind === 'dm' && onDeleteDm ? () => onDeleteDm(channel.id) : undefined,
          }} />
        </div>
        <div data-testid="room-subtitle" className="truncate text-meta text-fg-muted">{subtitle}</div>
      </div>
      {group ? (
        logLayout ? (
          <span data-testid="thread-whisper-observer-notice" title={t('messenger.whisper.observerNotice')}
            className="shrink-0 text-meta text-whisper-fg">
            {t('room.header.observingLog')}
          </span>
        ) : (
          <span data-testid="thread-whisper-observer-notice" title={t('messenger.whisper.observerNotice')}
            className="inline-flex h-7 shrink-0 items-center gap-1.5 border border-whisper-border px-2.5 text-meta text-whisper-fg [clip-path:var(--clip-control)]">
            <LineIcon name="eye" size={14} stroke={2} />
            {t('room.header.observing')}
          </span>
        )
      ) : null}
      <button type="button" data-testid="room-search-open" aria-label={t('room.header.search')}
        onClick={() => setSearchOpen(true)}
        className="flex h-10 w-10 shrink-0 items-center justify-center text-fg-muted hover:text-fg">
        <LineIcon name="search" size={18} stroke={2} />
      </button>
      <button type="button" data-testid="room-info-toggle" aria-label={t('room.header.info')}
        aria-expanded={drawerOpen} onClick={onToggleDrawer}
        className={`flex h-10 w-10 shrink-0 items-center justify-center hover:text-fg ${drawerOpen ? 'text-brand-text' : 'text-fg-muted'}`}>
        <LineIcon name="panel" size={18} stroke={2} />
      </button>
      {canPostOpinion ? (
        <PostOpinionModal open={opinionOpen} onOpenChange={setOpinionOpen} channelId={channel.id}
          onPosted={(opinion) => notifyOpinionCardsChanged(opinion.channelId)} />
      ) : null}
      {channel.isChatRoom ? (
        <RoomControls channelId={channel.id} readOnly={channel.readOnly}
          open={roomAction === (channel.readOnly ? 'delete' : 'archive')}
          onOpenChange={(open) => { if (!open) setRoomAction(null); }} />
      ) : null}
      <MessageSearchView open={searchOpen} onOpenChange={setSearchOpen}
        scope={{ kind: 'channel', channelId: channel.id, channelName: title }}
        onNavigate={(channelId) => onNavigate(channelId)} />
    </header>
  );
}
