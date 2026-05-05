/**
 * meetings:composeMinutes IPC handler — R12-C2 P2-3.
 *
 * 단일 channel — caller (T10 orchestrator / dev tools / 테스트) 가 step 5
 * 진입 시점에 호출. 회의록 markdown + 저장 경로 + 출처 (moderator /
 * moderator-retry / fallback) 를 반환.
 *
 * 본 handler 자체는 service 호출 + 결과 wrap 만 — prompt 양식 / truncate
 * 검출 / fallback 은 모두 MeetingMinutesService 책임.
 */

import type { IpcRequest, IpcResponse } from '../../../shared/ipc-types';
import type { MeetingMinutesService } from '../../meetings/meeting-minutes-service';

let minutesAccessor: (() => MeetingMinutesService) | null = null;

export function setMeetingMinutesServiceAccessor(
  fn: () => MeetingMinutesService,
): void {
  minutesAccessor = fn;
}

function getService(): MeetingMinutesService {
  if (!minutesAccessor) {
    throw new Error('meetings-minutes handler: service not initialized');
  }
  return minutesAccessor();
}

/** meetings:composeMinutes */
export async function handleMeetingsComposeMinutes(
  data: IpcRequest<'meetings:composeMinutes'>,
): Promise<IpcResponse<'meetings:composeMinutes'>> {
  const result = await getService().compose({ meetingId: data.meetingId });
  return { result };
}
