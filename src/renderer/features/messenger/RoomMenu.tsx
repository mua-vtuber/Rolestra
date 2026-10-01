/**
 * RoomMenu — the ⋯ menu of the room header (spec
 * 2026-10-01-messenger-redesign.md R3-1). It holds the actions that used to
 * sit in the header row: 의견 게시 (general channel and writable rooms),
 * 대화 종료·보관 (an active room), 삭제 (an archived room) and DM 삭제.
 * Each item keeps its earlier test id. With no applicable action the menu
 * button is not drawn.
 */
import * as Popover from '@radix-ui/react-popover';
import { useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import { LineIcon } from '../../components/shell/LineIcon';
import type { Channel } from '../../../shared/channel-types';

export interface RoomMenuActions {
  onPostOpinion?: () => void;
  onArchiveRoom?: () => void;
  onDeleteRoom?: () => void;
  onDeleteDm?: () => void;
}

interface MenuItem { testId: string; label: string; run: () => void; danger?: boolean }

export function roomMenuItems(
  t: TFunction,
  channel: Channel,
  actions: RoomMenuActions,
): MenuItem[] {
  const items: MenuItem[] = [];
  const writable = !channel.readOnly;
  if ((channel.kind === 'system_general' || channel.isChatRoom) && writable && actions.onPostOpinion) {
    items.push({ testId: 'chat-post-opinion', label: t('messenger.channelHeader.postOpinion'), run: actions.onPostOpinion });
  }
  if (channel.isChatRoom && writable && actions.onArchiveRoom) {
    items.push({ testId: 'room-archive-open', label: t('rooms.archive'), run: actions.onArchiveRoom });
  }
  if (channel.isChatRoom && !writable && actions.onDeleteRoom) {
    items.push({ testId: 'room-delete-open', label: t('rooms.delete'), run: actions.onDeleteRoom, danger: true });
  }
  if (channel.kind === 'dm' && actions.onDeleteDm) {
    items.push({ testId: 'chat-delete-dm', label: t('messenger.channelHeader.delete'), run: actions.onDeleteDm, danger: true });
  }
  return items;
}

export function RoomMenu({ channel, actions }: { channel: Channel; actions: RoomMenuActions }): ReactElement | null {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const items = roomMenuItems(t, channel, actions);
  if (items.length === 0) return null;
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button type="button" data-testid="room-menu-open" aria-label={t('room.header.more')}
          className="flex h-10 w-10 items-center justify-center text-fg-muted hover:text-fg">
          <LineIcon name="more" size={18} stroke={2.4} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content data-testid="room-menu" align="end" sideOffset={4} role="menu"
          className="z-50 flex min-w-40 flex-col border border-border bg-canvas py-1 text-sm text-fg shadow-panel [clip-path:var(--clip-control)]">
          {items.map((item) => (
            <button key={item.testId} type="button" role="menuitem" data-testid={item.testId}
              onClick={() => { setOpen(false); item.run(); }}
              className={`px-3 py-2 text-left hover:bg-sunk ${item.danger ? 'text-danger-text' : ''}`}>
              {item.label}
            </button>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
