/**
 * Feeds `stream:chat-activity` (spec 2026-10-01 F5) and `stream:chat-round`
 * (QA M1) into the chat activity store. Mounted once at the app root so
 * every channel's state stays current while another view is open; the
 * indicator and the pass button only read the store.
 *
 * Round state also exists before this window opened (a reload while a round
 * runs), so the hook reads `chat:list-active-rounds` once. Round events that
 * arrive while that answer is on its way are held and applied after it, so
 * the newer event wins. A failed read is reported, and live events apply
 * from then on.
 */
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { notifyError } from '../components/ErrorBoundary';
import { invoke } from '../ipc/invoke';
import { useChatActivityStore } from '../stores/chat-activity-store';
import type { StreamChatRoundPayload } from '../../shared/stream-events';

export function useChatActivityStream(): void {
  const { t } = useTranslation();
  const apply = useChatActivityStore((state) => state.apply);
  const applyRound = useChatActivityStore((state) => state.applyRound);
  const setActiveRounds = useChatActivityStore((state) => state.setActiveRounds);
  useEffect(() => {
    const onStream = typeof window !== 'undefined' ? window.arena?.onStream : undefined;
    if (!onStream) return undefined;
    let cancelled = false;
    let held: StreamChatRoundPayload[] | null = [];
    const release = (): void => {
      const events = held ?? [];
      held = null;
      for (const event of events) applyRound(event);
    };
    const offActivity = onStream('stream:chat-activity', apply);
    const offRound = onStream('stream:chat-round', (payload) => {
      if (held !== null) held.push(payload);
      else applyRound(payload);
    });
    invoke('chat:list-active-rounds', undefined).then(({ channelIds }) => {
      if (cancelled) return;
      setActiveRounds(channelIds);
      release();
    }, (reason: unknown) => {
      if (cancelled) return;
      notifyError(t('messenger.activity.roundStateError', {
        reason: reason instanceof Error ? reason.message : String(reason),
      }));
      release();
    });
    return () => {
      cancelled = true;
      offActivity();
      offRound();
    };
  }, [apply, applyRound, setActiveRounds, t]);
}
