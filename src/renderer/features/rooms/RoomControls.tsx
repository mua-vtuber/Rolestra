/**
 * RoomControls — the confirm dialog for a room's 보관 (archive) or 삭제
 * (delete, archived rooms only). Opened from the room's ⋯ menu
 * (`RoomMenu.tsx`, spec 2026-10-01-messenger-redesign.md R3-1); the menu
 * item carries the `room-archive-open` / `room-delete-open` test ids.
 *
 * Deleting the open room clears the selection only if the user is still
 * looking at it when the delete finishes.
 */
import * as Dialog from '@radix-ui/react-dialog';
import { useRef, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '../../ipc/invoke';
import { notifyChannelsChanged } from '../../hooks/channel-invalidation-bus';
import { useActiveChannelStore } from '../../stores/active-channel-store';

export interface RoomControlsProps {
  channelId: string;
  /** true: the room is archived, so the action is delete. */
  readOnly: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RoomControls({ channelId, readOnly, open, onOpenChange }: RoomControlsProps): ReactElement {
  const { t } = useTranslation();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const submitting = useRef(false);
  const submit = async (): Promise<void> => {
    if (submitting.current) return;
    submitting.current = true;
    setPending(true);
    setError(false);
    try {
      if (readOnly) {
        await invoke('room:delete', { channelId });
        if (useActiveChannelStore.getState().globalChannelId === channelId) {
          useActiveChannelStore.getState().setGlobalChannelId(null);
        }
      } else {
        await invoke('room:archive', { channelId });
      }
      await notifyChannelsChanged();
      onOpenChange(false);
    } catch { setError(true); }
    finally { submitting.current = false; setPending(false); }
  };
  return (
    <Dialog.Root open={open} onOpenChange={(next) => {
      if (pending) return;
      if (next) setError(false);
      onOpenChange(next);
    }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
        <Dialog.Content data-testid="room-action-dialog" className="fixed left-1/2 top-1/2 z-50 w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 border border-border bg-canvas p-5 text-fg shadow-panel [clip-path:var(--clip-control)]">
          <Dialog.Title className="font-display font-semibold">{readOnly ? t('rooms.delete') : t('rooms.archive')}</Dialog.Title>
          <Dialog.Description className="mt-3 text-sm text-fg-muted">{readOnly ? t('rooms.deleteHint') : t('rooms.archiveHint')}</Dialog.Description>
          {error ? <p role="alert" className="mt-3 text-sm text-danger-text">{t('rooms.actionFailed')}</p> : null}
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" disabled={pending} onClick={() => onOpenChange(false)} className="px-3 py-2 text-sm">{t('rooms.cancel')}</button>
            <button type="button" data-testid="room-action-confirm" disabled={pending} onClick={() => { void submit(); }}
              className="bg-brand px-3 py-2 text-sm text-brand-fg disabled:opacity-40 [clip-path:var(--clip-control)]">{readOnly ? t('rooms.delete') : t('rooms.archive')}</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
