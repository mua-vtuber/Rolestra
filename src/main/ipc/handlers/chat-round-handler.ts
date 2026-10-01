/**
 * chat:list-active-rounds IPC handler (QA M1). The renderer keeps the round
 * signal (`stream:chat-round`) in memory only; after a reload it reads the
 * responder's current state here so the pass button starts correct.
 */
import type { IpcResponse } from '../../../shared/ipc-types';
import type { DmAutoResponder } from '../../channels/dm-auto-responder';

type RoundState = Pick<DmAutoResponder, 'activeRoundChannelIds'>;

let roundAccessor: (() => RoundState) | null = null;

export function setChatRoundStateAccessor(fn: () => RoundState): void {
  roundAccessor = fn;
}

/** chat:list-active-rounds */
export function handleChatListActiveRounds(): IpcResponse<'chat:list-active-rounds'> {
  if (!roundAccessor) throw new Error('chat round handler: responder not initialized');
  return { channelIds: roundAccessor().activeRoundChannelIds() };
}
