/**
 * ChatActivityIndicator — one line under the message list saying who is
 * writing, whispering or waiting in this channel (spec 2026-10-01 F5).
 *
 * Reads the in-memory activity store only. Names come from the channel's
 * member list (room snapshot names); a participant missing from it shows a
 * translated "unknown participant" label, never its provider id. The status
 * region always exists so screen readers announce each change politely.
 *
 * Look (spec 2026-10-01-messenger-redesign.md R3-6): bubbles show a
 * three-dot bubble before the text; the log layout writes `* … ▌` lines.
 */
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatActivityStore, type ChatActivityEntry } from '../../stores/chat-activity-store';
import { useTheme } from '../../theme/use-theme';

export interface ChatActivityIndicatorProps {
  channelId: string;
  /** providerId → display name for this channel. */
  names: ReadonlyMap<string, string>;
}

const NO_ACTIVITY: Record<string, ChatActivityEntry> = {};

/** Log layout prefix of an activity line (`* 소라 입력 중… ▌`). */
const LOG_ACTIVITY_MARK = '*';

export function ChatActivityIndicator({ channelId, names }: ChatActivityIndicatorProps): ReactElement {
  const { t } = useTranslation();
  const { token } = useTheme();
  const entries = useChatActivityStore((state) => state.byChannel[channelId] ?? NO_ACTIVITY);
  const nameOf = (providerId: string): string => names.get(providerId) ?? t('messenger.activity.unknownName');
  const lines = Object.values(entries).map((entry) => {
    const name = nameOf(entry.providerId);
    if (entry.phase === 'queued') return t('messenger.activity.queued', { name });
    return entry.target.kind === 'whisper'
      ? t('messenger.activity.whisperWriting', { name, peer: nameOf(entry.target.peerProviderId) })
      : t('messenger.activity.writing', { name });
  });
  const active = lines.length > 0;

  if (token.messageLayout === 'log') {
    return (
      <p data-testid="chat-activity-indicator" role="status" aria-live="polite"
        className="min-h-5 px-7 py-0.5 text-preview text-fg-muted">
        {active ? <>
          {lines.map((line, index) => (
            <span key={line} className="mr-3">
              {`${LOG_ACTIVITY_MARK} ${line}`}
              {index === 0 ? <span aria-hidden="true" className="ml-1 inline-block h-3.5 w-2 bg-brand align-middle" /> : null}
            </span>
          ))}
        </> : null}
      </p>
    );
  }

  return (
    <div data-testid="chat-activity-indicator" role="status" aria-live="polite"
      className="flex min-h-5 items-center gap-2.5 px-7 py-0.5 text-meta text-fg-muted">
      {active ? (
        <span aria-hidden="true"
          className="inline-flex items-center gap-1 border border-bubble-other-border bg-bubble-other-bg px-3 py-2 [clip-path:var(--clip-bubble-other)]">
          <span className="h-1.5 w-1.5 bg-fg-muted" />
          <span className="h-1.5 w-1.5 bg-fg-muted opacity-70" />
          <span className="h-1.5 w-1.5 bg-fg-muted opacity-40" />
        </span>
      ) : null}
      {lines.join(' · ')}
    </div>
  );
}
