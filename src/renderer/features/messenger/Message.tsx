/**
 * Message — one chat bubble (bubble layout, spec
 * 2026-10-01-messenger-redesign.md R3-2/R3-4).
 *
 * - The user's message: right side, "my bubble" colors, time on its left.
 * - An AI message: left side with avatar; name (in the speaker's seat
 *   color) and avatar only on the first message of a run (`groupStart`),
 *   time on the bubble's right.
 * - A whisper: dashed bubble with the whisper colors, a lock and
 *   "A → B · 귓속말" above it; always shows its avatar.
 * Every color and corner shape comes from the theme tokens.
 */
import { clsx } from 'clsx';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { Avatar } from '../../components/members/Avatar';
import { LineIcon } from '../../components/shell/LineIcon';
import { seatNameTextClass } from '../../theme/name-palette';
import { useTheme } from '../../theme/use-theme';
import { MemberProfileTrigger } from '../members/MemberProfileTrigger';
import type { MemberView } from '../../../shared/member-profile-types';
import type { Message as ChannelMessage } from '../../../shared/message-types';
import { messageDataAttrs } from './message-attrs';
import { clockTime } from './time-format';
import { WhisperLabel } from './WhisperLabel';

/** Who spoke, from the channel's member list (room snapshot names). */
export interface MessageSpeaker {
  name: string;
  /** Index in the channel's member order — picks the name color. */
  seat: number;
  profile: MemberView;
}

export interface MessageProps {
  message: ChannelMessage;
  /** null when the author is not (or no longer) in the member list. */
  speaker: MessageSpeaker | null;
  /** First message of a run by this speaker: shows name and avatar. */
  groupStart: boolean;
  className?: string;
}

// Matches the h-9 / w-9 (36px) avatar slot below.
const AVATAR_SIZE = 36;

function SpeakerAvatar({ speaker, visible }: { speaker: MessageSpeaker | null; visible: boolean }): ReactElement {
  const { t } = useTranslation();
  const { token } = useTheme();
  if (!visible) return <span aria-hidden="true" className="h-9 w-9 shrink-0" />;
  if (speaker === null) {
    return <span data-testid="message-avatar-placeholder" aria-hidden="true"
      className="h-9 w-9 shrink-0 bg-sunk [clip-path:var(--clip-avatar)]" />;
  }
  return (
    <MemberProfileTrigger member={speaker.profile}>
      <button type="button" data-testid="message-avatar-trigger"
        aria-label={t('member.profileTrigger.ariaLabel', { name: speaker.name })}
        className="h-9 w-9 shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
        <Avatar providerId={speaker.profile.providerId} displayName={speaker.name}
          avatarKind={speaker.profile.avatarKind} avatarData={speaker.profile.avatarData}
          size={AVATAR_SIZE} shape={token.avatarShape} />
      </button>
    </MemberProfileTrigger>
  );
}

export function Message({ message, speaker, groupStart, className }: MessageProps): ReactElement {
  const { t, i18n } = useTranslation();
  const { themeKey } = useTheme();
  const attrs = messageDataAttrs(message, themeKey, !groupStart);
  const time = (
    <span data-testid="message-time" className="shrink-0 font-mono text-micro text-fg-muted">
      {clockTime(message.createdAt, i18n.language)}
    </span>
  );
  const content = (
    <span data-testid="message-content" className="whitespace-pre-wrap break-words text-body">{message.content}</span>
  );

  if (message.authorKind === 'user') {
    return (
      <div {...attrs} className={clsx('mt-2 flex items-end justify-end gap-2', className)}>
        {time}
        <div className="max-w-md border border-bubble-mine-border bg-bubble-mine-bg px-3.5 py-2.5 text-bubble-mine-fg [clip-path:var(--clip-bubble-mine)]">
          {content}
        </div>
      </div>
    );
  }

  const whisper = message.visibility === 'whisper' ? message.whisper : undefined;
  if (whisper) {
    return (
      <div {...attrs} className={clsx('mt-2 flex items-start gap-2.5', className)}>
        <SpeakerAvatar speaker={speaker} visible />
        <div className="flex min-w-0 flex-col gap-1">
          <span className="inline-flex items-center gap-1.5 text-meta text-whisper-fg">
            <LineIcon name="lock" size={12} stroke={2} />
            <WhisperLabel message={message} whisper={whisper} />
          </span>
          <div className="flex items-end gap-2">
            <div className="max-w-md border border-dashed border-whisper-border bg-whisper-bg px-3.5 py-2.5 italic text-fg">
              {content}
            </div>
            {time}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div {...attrs} className={clsx('flex items-start gap-2.5', groupStart ? 'mt-2' : 'mt-0.5', className)}>
      <SpeakerAvatar speaker={speaker} visible={groupStart} />
      <div className="flex min-w-0 flex-col gap-1">
        {groupStart ? (
          <span data-testid="message-name"
            className={clsx('text-meta font-semibold', speaker === null ? 'text-fg-muted' : seatNameTextClass(speaker.seat))}>
            {speaker?.name ?? t('messenger.activity.unknownName')}
          </span>
        ) : null}
        <div className="flex items-end gap-2">
          <div className="max-w-md border border-bubble-other-border bg-bubble-other-bg px-3.5 py-2.5 text-fg [clip-path:var(--clip-bubble-other)]">
            {content}
          </div>
          {time}
        </div>
      </div>
    </div>
  );
}
