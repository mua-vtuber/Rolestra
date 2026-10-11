import { notifyChannelsChanged } from '../../hooks/channel-invalidation-bus';
import { useActiveChannelStore } from '../../stores/active-channel-store';

/**
 * After a DM or the general channel is deleted (spec 2026-10-08 F1): clears
 * the selection when the deleted channel was open, then makes the channel
 * lists and the chat list read again. The app's landing rule then picks the
 * next conversation, or shows "대화방이 없어요".
 */
export async function finishChannelDelete(channelId: string): Promise<void> {
  const store = useActiveChannelStore.getState();
  if (store.globalChannelId === channelId) store.setGlobalChannelId(null);
  await notifyChannelsChanged();
}
