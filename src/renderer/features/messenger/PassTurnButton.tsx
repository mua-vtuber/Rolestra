/**
 * PassTurnButton — "넘기기" next to the composer input (spec 2026-10-01 F1).
 *
 * Starts one round without user text through the typed `chat:pass-turn`
 * IPC. Shown only in rooms and the general channel (the caller decides) and
 * disabled while that channel's round runs or waits — between turns too
 * (QA M1, `stream:chat-round`) — or a call is queued or writing (F5), or the
 * request is in flight. A refusal from main shows its
 * translated reason; nothing fails silently.
 */
import type { TFunction } from 'i18next';
import { useCallback, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { invoke } from '../../ipc/invoke';
import { channelBusy, useChatActivityStore } from '../../stores/chat-activity-store';
import { useTheme } from '../../theme/use-theme';
import { chatPassRejectionOf, type ChatPassRejectionCode } from '../../../shared/chat-pass-types';

export interface PassTurnButtonProps {
  channelId: string;
  disabled?: boolean;
}

function rejectionText(t: TFunction, code: ChatPassRejectionCode): string {
  switch (code) {
    case 'dm_channel': return t('messenger.pass.errors.dmChannel');
    case 'room_archived': return t('messenger.pass.errors.roomArchived');
    case 'round_running': return t('messenger.pass.errors.roundRunning');
    case 'no_participants': return t('messenger.pass.errors.noParticipants');
  }
}

export function PassTurnButton({ channelId, disabled = false }: PassTurnButtonProps): ReactElement {
  const { t } = useTranslation();
  const { token } = useTheme();
  const logLayout = token.messageLayout === 'log';
  const active = useChatActivityStore((state) => channelBusy(state, channelId));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePass = useCallback(async (): Promise<void> => {
    setPending(true);
    setError(null);
    try {
      await invoke('chat:pass-turn', { channelId });
    } catch (reason) {
      const code = chatPassRejectionOf(reason);
      setError(code !== null
        ? rejectionText(t, code)
        : t('messenger.pass.errors.failed', { reason: reason instanceof Error ? reason.message : String(reason) }));
    } finally {
      setPending(false);
    }
  }, [channelId, t]);

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <button type="button" data-testid="chat-pass-turn" title={t('messenger.pass.buttonTitle')}
        disabled={disabled || active || pending} onClick={() => { void handlePass(); }}
        className={logLayout
          ? 'h-11 px-1.5 text-fg-muted hover:text-fg disabled:cursor-not-allowed disabled:opacity-40'
          : 'h-11 border border-border px-4 text-sm text-fg hover:bg-sunk disabled:cursor-not-allowed disabled:opacity-40 [clip-path:var(--clip-control)]'}>
        {logLayout ? t('messenger.pass.buttonLog') : t('messenger.pass.button')}
      </button>
      {error !== null ? (
        <p role="alert" data-testid="chat-pass-turn-error" className="text-xs text-danger-text">{error}</p>
      ) : null}
    </div>
  );
}
