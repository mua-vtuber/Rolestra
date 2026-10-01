/**
 * The picture of a chat list row in the bubble layout (spec
 * 2026-10-01-messenger-redesign.md R2-2): a DM shows its AI's avatar; a
 * room or the general channel shows up to three participant initials,
 * each on its seat's name color (`name-palette.ts` conversation rule).
 */
import type { ReactElement } from 'react';

import { Avatar } from '../../components/members/Avatar';
import { AVATAR_SIZE } from '../../components/members/avatar-sizes';
import { seatNameFillClass } from '../../theme/name-palette';
import { useTheme } from '../../theme/use-theme';
import type { ChannelSummary } from '../../../shared/channel-summary-types';
import type { MemberView } from '../../../shared/member-profile-types';

/** Most initials a room cluster shows. */
const CLUSTER_MAX_INITIALS = 3;
// Matches the Tailwind h-11 / w-11 (44px) boxes below.

function initialOf(name: string): string {
  return Array.from(name.trim())[0] ?? '';
}

export function ConversationAvatar({ summary, memberById }: {
  summary: ChannelSummary;
  memberById: ReadonlyMap<string, MemberView>;
}): ReactElement {
  const { token } = useTheme();
  if (summary.kind === 'dm') {
    const participant = summary.participants[0];
    if (participant === undefined) {
      return <span data-testid="chat-list-avatar" data-avatar="missing" aria-hidden="true"
        className="h-11 w-11 shrink-0 bg-sunk [clip-path:var(--clip-avatar)]" />;
    }
    const member = memberById.get(participant.providerId);
    return (
      <span data-testid="chat-list-avatar" data-avatar="dm" aria-hidden="true" className="shrink-0">
        <Avatar providerId={participant.providerId} displayName={participant.displayName}
          avatarKind={member?.avatarKind ?? 'default'} avatarData={member?.avatarData ?? null}
          size={AVATAR_SIZE.listRow} shape={token.avatarShape} />
      </span>
    );
  }
  return (
    <span data-testid="chat-list-avatar" data-avatar="cluster" aria-hidden="true"
      className="flex h-11 w-11 shrink-0 flex-wrap content-center justify-center gap-0.5 border border-border-soft bg-sunk [clip-path:var(--clip-control)]">
      {summary.participants.slice(0, CLUSTER_MAX_INITIALS).map((participant, seat) => (
        <span key={participant.providerId}
          className={`flex h-5 w-5 items-center justify-center text-micro font-bold text-name-palette-fg [clip-path:var(--clip-avatar)] ${seatNameFillClass(seat)}`}>
          {initialOf(participant.displayName)}
        </span>
      ))}
    </span>
  );
}
