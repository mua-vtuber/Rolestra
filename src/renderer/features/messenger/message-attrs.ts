/**
 * The `data-*` attributes every rendered message carries in both layouts,
 * so tests and E2E address a message the same way whatever the theme:
 * id, author kind, public / whisper, the whisper's sender and recipient
 * ids and its thread position (spec 2026-10-01 F2-8: root 1, replies 2…).
 */
import type { Message as ChannelMessage } from '../../../shared/message-types';
import type { ThemeKey } from '../../theme/theme-tokens';

export function messageDataAttrs(message: ChannelMessage, themeKey: ThemeKey, compact: boolean) {
  const whisper = message.visibility === 'whisper' ? message.whisper : undefined;
  return {
    'data-testid': 'message',
    'data-theme-variant': themeKey,
    'data-message-id': message.id,
    'data-compact': compact ? 'true' : 'false',
    'data-author-kind': message.authorKind,
    'data-visibility': whisper ? 'whisper' : 'public',
    'data-sender-id': whisper ? message.authorId : undefined,
    'data-recipient-id': whisper?.recipientId,
    'data-thread-seq': whisper ? String(whisper.threadSeq) : undefined,
  } as const;
}
