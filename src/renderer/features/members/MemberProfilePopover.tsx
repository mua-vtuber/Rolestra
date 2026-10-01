/**
 * MemberProfilePopover — light-weight profile card with 4 actions
 * (R8-Task6, spec §7.1 + §7.2).
 *
 * Opened from any member-bearing surface (message bubble avatar, MemberRow,
 * PeopleWidget). Renders the persisted profile fields + work-status + 4
 * action buttons:
 *
 *   1. 편집           → calls `onEdit()` (parent opens MemberProfileEditModal)
 *   2. 외근 ↔ 출근    → `member:set-status` (target inferred from current status)
 *   3. 연락해보기     → `member:reconnect` + updates the local status indicator
 *   4. DM 시작        → reuses StartDmButton's IPC chain (channel:create kind=dm)
 *
 * Why a popover (not a modal):
 *   The member profile is something users want to glance at, not commit to
 *   editing. The popover dismisses on outside click / ESC and never
 *   blocks the underlying view. Editing — which IS commit-worthy — gets
 *   the heavier modal (Task 4) only when the user explicitly clicks
 *   "편집" (D6 in plan).
 *
 * Mutation surfaces:
 *   The popover owns short-lived `pendingAction` + `actionError` state for
 *   the 3 IPC actions (set-status, reconnect, DM). They're independent —
 *   user can fire reconnect while a previous DM call is in flight (the
 *   underlying IPCs are independent on the Main side).
 *
 * Status indicator update strategy (R8-D8):
 *   We do NOT subscribe to a stream. The popover is the only surface that
 *   needs to see the new status immediately (other surfaces refresh on
 *   their next mount). Reconnect's IPC response carries the new status —
 *   we set it locally. Set-status returns `success: true`, so we
 *   optimistically apply the target status without a refetch (the
 *   underlying DB write is synchronous; the next `member:list` mount
 *   pickup will confirm).
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
import type { Channel } from '../../../shared/channel-types';
import type {
  MemberView,
  WorkStatus,
} from '../../../shared/member-profile-types';
import { notifyChannelsChanged } from '../../hooks/channel-invalidation-bus';

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
  /** Called when DM is created so the parent can route to messenger view. */
  onDmStarted?(channel: Channel): void;
  className?: string;
}

type PendingAction = 'reconnect' | 'start-dm' | null;

function isDuplicateDm(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  return (err as { name?: unknown }).name === 'DuplicateDmError';
}

export function MemberProfilePopover({
  open,
  onOpenChange,
  member,
  trigger,
  customAvatarSrc,
  onEdit,
  onDmStarted,
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

  const handleStartDm = useCallback(async (): Promise<void> => {
    setPending('start-dm');
    setActionError(null);
    let resolved: Channel | null = null;
    try {
      const { channel } = await invoke('dm:create', {
        providerId: member.providerId,
      });
      resolved = channel;
    } catch (e) {
      if (isDuplicateDm(e)) {
        try {
          const { channels } = await invoke('channel:list', {
            projectId: null,
          });
          const existing = channels.find(
            (c) => c.kind === 'dm' && c.name === `dm:${member.providerId}`,
          );
          if (existing) resolved = existing;
        } catch {
          // fall through to error
        }
      }
      if (!resolved) {
        setActionError(t('profile.popover.errors.dmFailed'));
      }
    } finally {
      setPending(null);
    }
    if (resolved) {
      notifyChannelsChanged();
      onDmStarted?.(resolved);
      onOpenChange(false);
    }
  }, [member.providerId, onDmStarted, onOpenChange, t]);

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
            <Button
              type="button"
              tone="ghost"
              size="sm"
              data-testid="profile-popover-start-dm"
              disabled={pending !== null}
              onClick={() => void handleStartDm()}
            >
              {t('profile.popover.actions.startDm')}
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
