import type { IpcRequest, IpcResponse } from '../../../shared/ipc-types';
import type { OpinionService } from '../../meetings/opinion-service';
import type { ChatVoteService } from '../../meetings/chat-vote-service';

let opinionAccessor: (() => OpinionService) | null = null;
let chatVoteAccessor: (() => ChatVoteService) | null = null;

export function setChatVoteServiceAccessor(fn: () => ChatVoteService): void {
  chatVoteAccessor = fn;
}

function getChatVoteService(): ChatVoteService {
  if (!chatVoteAccessor) throw new Error('chat vote handler: service not initialized');
  return chatVoteAccessor();
}

export function setOpinionServiceAccessor(fn: () => OpinionService): void {
  opinionAccessor = fn;
}

function getService(): OpinionService {
  if (!opinionAccessor) {
    throw new Error('opinion handler: service not initialized');
  }
  return opinionAccessor();
}

/** opinion:postFromGeneral (R12-C2 P4 T20) */
export function handleOpinionPostFromGeneral(
  data: IpcRequest<'opinion:postFromGeneral'>,
): IpcResponse<'opinion:postFromGeneral'> {
  const result = getService().postFromGeneralChannel({
    channelId: data.channelId,
    authorProviderId: data.authorProviderId,
    parts: data.parts,
  });
  return { result };
}

/** opinion:listGeneralCards (R12-C2 P4 T21) */
export function handleOpinionListGeneralCards(
  data: IpcRequest<'opinion:listGeneralCards'>,
): IpcResponse<'opinion:listGeneralCards'> {
  const result = getService().listGeneralCards(data.channelId);
  return { result };
}

/** opinion:toggleLightVote (R12-C2 P4 T21) */
export function handleOpinionToggleLightVote(
  data: IpcRequest<'opinion:toggleLightVote'>,
): IpcResponse<'opinion:toggleLightVote'> {
  const result = getService().toggleLightVote({
    opinionId: data.opinionId,
    vote: data.vote,
  });
  return { result };
}

export function handleOpinionStartVote(
  data: IpcRequest<'opinion:startVote'>,
): IpcResponse<'opinion:startVote'> {
  return { result: getChatVoteService().startVote(data.opinionId) };
}

export function handleOpinionGetVote(
  data: IpcRequest<'opinion:getVote'>,
): IpcResponse<'opinion:getVote'> {
  return { result: getChatVoteService().getVote(data.opinionId) };
}
