/**
 * Character profile with editing and reconnect actions. Room snapshots
 * remain read-only. Reconnect updates the local status from its IPC result.
 */

import * as Popover from '@radix-ui/react-popover';
import { clsx } from 'clsx';
import { useCallback, useState, type ReactElement, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Avatar } from '../../components/members/Avatar';
import { WorkStatusDot } from '../../components/members/WorkStatusDot';
import { Button } from '../../components/primitives/button';
import { invoke } from '../../ipc/invoke';
import { usePanelClipStyle } from '../../theme/use-panel-clip-style';
import type {
  MemberView,
  WorkStatus,
} from '../../../shared/member-profile-types';

export interface MemberProfilePopoverProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  member: MemberView;
  /**
   * Optional `Popover.Trigger` element (passed as React node — the
   * component wraps it in `<Popover.Trigger asChild>`). When present, the
   * popover anchors to this element. When omitted (test usage), the
   * popover renders without a visible anchor — tests open it via
   * `open=true` directly.
   */
  trigger?: ReactNode;
  /** Pre-resolved URL when member.avatarKind='custom'. */
  customAvatarSrc?: string;
  /** Called when the user clicks "편집". Parent opens the EditModal. */
  onEdit(): void;
  className?: string;
}

type PendingAction = 'reconnect' | null;

export function MemberProfilePopover({
  open,
  onOpenChange,
  member,
  trigger,
  customAvatarSrc,
  onEdit,
  className,
}: MemberProfilePopoverProps): ReactElement {
  const { t } = useTranslation();
  const panelClip = usePanelClipStyle();

  // Local override that wins over `member.workStatus` after a successful
  // mutation — until the surrounding surfaces refetch on next mount.
  const [localStatus, setLocalStatus] = useState<WorkStatus | null>(null);
  const [pending, setPending] = useState<PendingAction>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const effectiveStatus = localStatus ?? member.workStatus;

  const handleReconnect = useCallback(async (): Promise<void> => {
    setPending('reconnect');
    setActionError(null);
    setLocalStatus('connecting');
    try {
      const { status } = await invoke('member:reconnect', {
        providerId: member.providerId,
      });
      setLocalStatus(status);
    } catch {
      setLocalStatus('offline-connection');
      setActionError(t('profile.popover.errors.reconnectFailed'));
    } finally {
      setPending(null);
    }
  }, [member.providerId, t]);

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      {trigger !== undefined && (
        <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      )}
      <Popover.Portal>
        <Popover.Content
          data-testid="profile-popover"
          data-provider-id={member.providerId}
          data-panel-clip={panelClip.rawClip}
          side="bottom"
          align="start"
          sideOffset={6}
          style={panelClip.style}
          className={clsx(
            'z-50 w-[min(20rem,calc(100vw-2rem))]',
            'bg-panel-bg text-fg border border-panel-border rounded-panel shadow-panel',
            'p-3 flex flex-col gap-3',
            className,
          )}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <header className="flex items-center gap-3">
            <Avatar
              providerId={member.providerId}
              displayName={member.displayName}
              avatarKind={member.avatarKind}
              avatarData={member.avatarData}
              resolvedSrc={customAvatarSrc}
              size={48}
              shape="circle"
            />
            <div className="flex flex-col min-w-0 flex-1">
              <span
                data-testid="profile-popover-name"
                className="truncate text-sm font-semibold"
              >
                {member.displayName}
              </span>
              <WorkStatusDot
                status={effectiveStatus}
                size={8}
                showLabel
                className="mt-0.5"
              />
            </div>
          </header>

          {member.characterSheet.length > 0 && (
            <section
              data-testid="profile-popover-character-sheet"
              className="max-h-40 overflow-y-auto whitespace-pre-wrap text-xs text-fg"
            >
              {member.characterSheet}
            </section>
          )}

          {member.isRoomSnapshot ? <section className="space-y-2 text-xs">
            <p className="text-fg-muted">{t('rooms.snapshotReadOnly')}</p>
            {member.roomPersona !== undefined && (
              <details>
                <summary className="cursor-pointer text-fg-muted">{t('rooms.personaSource')}</summary>
                <p className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap">{member.roomPersona}</p>
              </details>
            )}
          </section> : <footer className="flex flex-wrap gap-2">
            <Button
              type="button"
              tone="primary"
              size="sm"
              data-testid="profile-popover-edit"
              onClick={onEdit}
            >
              {t('profile.popover.actions.edit')}
            </Button>
            <Button
              type="button"
              tone="secondary"
              size="sm"
              data-testid="profile-popover-reconnect"
              disabled={pending !== null}
              onClick={() => void handleReconnect()}
            >
              {pending === 'reconnect'
                ? t('profile.popover.reconnecting')
                : t('profile.popover.actions.reconnect')}
            </Button>
          </footer>}

          {actionError !== null && (
            <div
              role="alert"
              data-testid="profile-popover-error"
              className="text-xs text-danger-text border border-danger rounded-panel px-2 py-1 bg-sunk"
            >
              {actionError}
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
