/**
 * MemberProfileTrigger — single-source-of-truth wrapper that turns any
 * member-bearing UI element into a profile-popover trigger (R8-Task7,
 * spec §7.1, R8-D5).
 *
 * Renders {@link MemberProfilePopover} with the caller's `children` as the
 * Popover.Trigger anchor + manages popover ↔ edit-modal handoff state.
 *
 * Lifecycle:
 *   1. User clicks the wrapped element → popover opens.
 *   2. User clicks "편집" → popover closes + modal opens.
 *   3. Modal save/cancel → modal closes (popover stays closed).
 *
 * The trigger element MUST forward `ref` (Radix asChild requirement).
 * Plain `<div>` / `<button>` / forwardRef components qualify; class
 * components or callback-ref-only elements do not.
 */

import { useCallback, useState, type ReactElement, type ReactNode } from 'react';

import { MemberProfilePopover } from './MemberProfilePopover';
import { MemberProfileEditModal } from './MemberProfileEditModal';
import type { Channel } from '../../../shared/channel-types';
import type { MemberView } from '../../../shared/member-profile-types';

export interface MemberProfileTriggerProps {
  member: MemberView;
  /**
   * The clickable anchor element. Forwarded to Popover.Trigger asChild —
   * MUST accept ref. Typically `<Avatar>` or a `<button>` wrapping one.
   */
  children: ReactNode;
  /** Pre-resolved URL for member.avatarKind='custom'. */
  customAvatarSrc?: string;
  /** Forwarded to the popover so the parent can route after DM creation. */
  onDmStarted?(channel: Channel): void;
  className?: string;
}

export function MemberProfileTrigger({
  member,
  children,
  customAvatarSrc,
  onDmStarted,
  className,
}: MemberProfileTriggerProps): ReactElement {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  const handleEdit = useCallback(() => {
    setPopoverOpen(false);
    setModalOpen(true);
  }, []);

  return (
    <>
      <MemberProfilePopover
        open={popoverOpen}
        onOpenChange={setPopoverOpen}
        member={member}
        trigger={children}
        customAvatarSrc={customAvatarSrc}
        onEdit={handleEdit}
        onDmStarted={onDmStarted}
        className={className}
      />
      <MemberProfileEditModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        providerId={member.providerId}
        displayName={member.displayName}
        customAvatarSrc={customAvatarSrc}
      />
    </>
  );
}
