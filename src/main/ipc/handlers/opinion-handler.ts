/**
 * opinion:* IPC handlers — R12-C2 P2-2.
 *
 * Exposed channels (spec §11.18.2~§11.18.5):
 *   - `opinion:gather`         step 1 — 직원 의견 제시 → opinion row 생성
 *   - `opinion:tally`          step 2 — 시스템 취합 + 화면 ID 부여
 *   - `opinion:quickVote`      step 2.5 — 일괄 동의 투표 + 만장일치 즉시 agreed
 *   - `opinion:freeDiscussion` step 3 — 자유 토론 round
 *
 * 모두 typed invoke + zod 검증 (router 안 v3ChannelSchemas). caller (T10
 * orchestrator / 일반 채널 [##] flow / dev tools / 테스트) 가 동일한 IPC
 * surface 를 통해 호출.
 *
 * 본 handler 자체는 service 호출 + 결과 wrap 만 — 모든 비즈니스 규칙
 * (깊이 cap / 만장일치 / 화면 ID) 은 OpinionService 책임.
 */

import type { IpcRequest, IpcResponse } from '../../../shared/ipc-types';
import type { OpinionService } from '../../meetings/opinion-service';

let opinionAccessor: (() => OpinionService) | null = null;

export function setOpinionServiceAccessor(fn: () => OpinionService): void {
  opinionAccessor = fn;
}

function getService(): OpinionService {
  if (!opinionAccessor) {
    throw new Error('opinion handler: service not initialized');
  }
  return opinionAccessor();
}

/** opinion:gather */
export function handleOpinionGather(
  data: IpcRequest<'opinion:gather'>,
): IpcResponse<'opinion:gather'> {
  const result = getService().gather({
    meetingId: data.meetingId,
    channelId: data.channelId,
    round: data.round,
    responses: data.responses,
  });
  return { result };
}

/** opinion:tally */
export function handleOpinionTally(
  data: IpcRequest<'opinion:tally'>,
): IpcResponse<'opinion:tally'> {
  const result = getService().tally(data.meetingId);
  return { result };
}

/** opinion:quickVote */
export function handleOpinionQuickVote(
  data: IpcRequest<'opinion:quickVote'>,
): IpcResponse<'opinion:quickVote'> {
  const result = getService().quickVote({
    meetingId: data.meetingId,
    round: data.round,
    responses: data.responses,
  });
  return { result };
}

/** opinion:freeDiscussion */
export function handleOpinionFreeDiscussion(
  data: IpcRequest<'opinion:freeDiscussion'>,
): IpcResponse<'opinion:freeDiscussion'> {
  const result = getService().freeDiscussionRound({
    meetingId: data.meetingId,
    opinionId: data.opinionId,
    round: data.round,
    responses: data.responses,
  });
  return { result };
}
