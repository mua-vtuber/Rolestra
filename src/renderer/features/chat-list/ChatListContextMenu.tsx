import * as Popover from '@radix-ui/react-popover';
import { useMemo, useRef, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { notifyOpinionCardsChanged } from '../../hooks/opinion-card-invalidation-bus';
import { PostOpinionModal } from '../messenger/PostOpinionModal';
import { RoomMenuContent, roomMenuItems } from '../messenger/RoomMenu';
import { RoomControls } from '../rooms/RoomControls';
import type { Channel } from '../../../shared/channel-types';

interface ChatListContextMenuProps {
  channel: Channel;
  target: { x: number; y: number; trigger: HTMLButtonElement; open: boolean };
  onOpenChange: (open: boolean) => void;
}

/** Actions keep the clicked channel separate from the currently selected conversation. */
export function ChatListContextMenu({ channel, target, onOpenChange }: ChatListContextMenuProps): ReactElement {
  const { t } = useTranslation();
  const [action, setAction] = useState<'opinion' | 'archive' | 'delete' | null>(null);
  const restoreFocusOnClose = useRef(false);
  const { x, y, trigger, open } = target;
  const anchor = useMemo(() => ({ current: {
    getBoundingClientRect: () => new DOMRect(x, y, 0, 0),
  } }), [x, y]);
  const closeAction = (next: boolean): void => {
    if (!next) {
      setAction(null);
      // Wait for the dialog's focus trap to unmount before returning to the row.
      requestAnimationFrame(() => {
        if (document.activeElement === document.body) trigger.focus();
      });
    }
  };
  const items = roomMenuItems(t, channel, {
    onPostOpinion: () => setAction('opinion'),
    onArchiveRoom: () => setAction('archive'),
    onDeleteRoom: () => setAction('delete'),
  });
  const canPostOpinion = (channel.kind === 'system_general' || channel.isChatRoom) && !channel.readOnly;
  const canConfirmRoomAction = channel.isChatRoom && (
    (action === 'archive' && !channel.readOnly) || (action === 'delete' && channel.readOnly)
  );

  return (
    <>
      <Popover.Root open={open && items.length > 0} onOpenChange={onOpenChange}>
        <Popover.Anchor virtualRef={anchor} />
        <RoomMenuContent items={items} align="start"
          onSelect={(item) => { onOpenChange(false); item.run(); }}
          onEscapeKeyDown={() => { restoreFocusOnClose.current = true; }}
          onInteractOutside={() => { restoreFocusOnClose.current = false; }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (restoreFocusOnClose.current && action === null) trigger.focus();
            restoreFocusOnClose.current = false;
          }} />
      </Popover.Root>
      {action === 'opinion' && canPostOpinion ? (
        <PostOpinionModal open channelId={channel.id} onOpenChange={closeAction}
          onPosted={(opinion) => notifyOpinionCardsChanged(opinion.channelId)} />
      ) : null}
      {canConfirmRoomAction ? (
        <RoomControls open channelId={channel.id} readOnly={action === 'delete'} onOpenChange={closeAction} />
      ) : null}
    </>
  );
}
