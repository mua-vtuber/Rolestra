/**
 * `channel:list-summaries` and `channel:mark-read` (spec
 * 2026-10-01-messenger-redesign.md R4) — thin adapters over
 * {@link ChannelSummaryRepository}. The general channel's participants are
 * every registered AI, read from the live registry the same way
 * `ChannelService.listMembers` does for that channel.
 */
import type { IpcRequest, IpcResponse } from '../../../shared/ipc-types';
import type { ChannelSummaryRepository } from '../../channels/channel-summary-repository';
import { providerRegistry } from '../../providers/registry';

let summaryAccessor: (() => ChannelSummaryRepository) | null = null;

export function setChannelSummaryRepositoryAccessor(fn: () => ChannelSummaryRepository): void {
  summaryAccessor = fn;
}

function getRepository(): ChannelSummaryRepository {
  if (!summaryAccessor) throw new Error('channel summary handler: repository not initialized');
  return summaryAccessor();
}

export function handleChannelListSummaries(): IpcResponse<'channel:list-summaries'> {
  const generalParticipants = providerRegistry.listAll().map((provider) => ({
    providerId: provider.id, displayName: provider.displayName,
  }));
  return { summaries: getRepository().listSummaries(generalParticipants) };
}

export function handleChannelMarkRead(
  data: IpcRequest<'channel:mark-read'>,
): IpcResponse<'channel:mark-read'> {
  getRepository().markRead(data.channelId, data.messageId);
  return { success: true };
}
