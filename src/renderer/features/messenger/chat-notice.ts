/**
 * Chat notice translation — shared by `SystemMessage` (the messenger thread)
 * and `SearchResultRow` (D4). Observer-only chat notices store codes, not
 * sentences: failure notices (`meta.chatError`, `chat-whisper-output.ts`) and
 * silence notices (`meta.chatSilence`: one AI's silence from `chat-room-turns.ts`,
 * the all-silent round from `dm-auto-responder.ts`), and the user's pass row
 * (`meta.chatPass`, spec 2026-10-01 F1). Every surface
 * that renders such a row must show the same translated text instead of the
 * raw code, so the logic lives in one place.
 */
import type { TFunction } from 'i18next';

import {
  isChatErrorCode, isChatPassMessage, isChatSilenceNotice, type Message as ChannelMessage,
} from '../../../shared/message-types';

type NoticeFields = Pick<ChannelMessage, 'authorKind' | 'role' | 'meta'>;

/** Silence and a pass are not errors: callers render them quietly. */
export function isQuietChatNotice(message: NoticeFields): boolean {
  return isChatSilenceNotice(message.meta?.chatSilence) || isChatPassMessage(message);
}

/**
 * Returns the translated text for a chat failure or silence notice, or `null`
 * when the message is neither (the caller then renders its own content).
 * Only a DM failure notice carries a short masked cause
 * (`meta.chatErrorDetail`); room notices never do — see `dm-auto-responder.ts`.
 */
export function chatNoticeText(
  t: TFunction,
  message: NoticeFields,
): string | null {
  if (isChatPassMessage(message)) return t('messenger.pass.row');
  const silence = message.meta?.chatSilence;
  if (isChatSilenceNotice(silence)) {
    switch (silence.code) {
      case 'turn_passed': return t('messenger.silence.turnPassed', { name: silence.speakerName });
      case 'reply_passed': return t('messenger.silence.replyPassed', { name: silence.speakerName });
      case 'round_all_silent': return t('messenger.silence.roundAllSilent');
    }
  }
  const chatError = message.meta?.chatError;
  if (!isChatErrorCode(chatError)) return null;
  const failure = t(`messenger.whisper.errors.${chatError}`);
  const detail = message.meta?.chatErrorDetail;
  return typeof detail === 'string' && detail.trim()
    ? t('messenger.whisper.errorWithDetail', { message: failure, detail })
    : failure;
}
