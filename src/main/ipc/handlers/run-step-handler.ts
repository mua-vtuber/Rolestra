/**
 * meeting:list-run-steps IPC handler — R12-C2 P2 T12.
 *
 * 회의 turn *진행 일지* (RunStep) read 표면. caller 가 3 scope 중 하나로
 * 호출:
 *   - `meeting`  meetingId 의 모든 RunStep (turn-by-turn replay)
 *   - `channel`  channelId 의 모든 RunStep (채널 진행률 + 시간순)
 *   - `turn`     meetingId + turnIndex 의 step 흐름
 *
 * 디버깅 / replay / 회귀 분석 용 — production 빌드는 router.ts 가 등록 자체를
 * skip 한다. zod schema 는 항상 등록되어 dev 모드 round-trip 이 잘못된
 * payload 를 잡아낸다 (`v3ChannelSchemas['meeting:list-run-steps']`).
 *
 * 본 handler 는 service 호출 + 결과 wrap 만 — 모든 비즈니스 규칙은
 * RunStepService 책임 (실제로는 read-only list 만).
 *
 * spec docs/superpowers/specs/2026-05-01-rolestra-channel-roles-design.md
 *  §11.19  A. RunStep 영속 기록부
 */

import type { IpcRequest, IpcResponse } from '../../../shared/ipc-types';
import type { RunStepService } from '../../meetings/run-step/run-step-service';

let runStepAccessor: (() => RunStepService) | null = null;

export function setRunStepServiceAccessor(fn: () => RunStepService): void {
  runStepAccessor = fn;
}

function getService(): RunStepService {
  if (!runStepAccessor) {
    throw new Error('run-step handler: service not initialized');
  }
  return runStepAccessor();
}

/** meeting:list-run-steps */
export function handleMeetingListRunSteps(
  data: IpcRequest<'meeting:list-run-steps'>,
): IpcResponse<'meeting:list-run-steps'> {
  const service = getService();
  switch (data.scope) {
    case 'meeting':
      return { steps: service.listByMeeting(data.meetingId) };
    case 'channel':
      return { steps: service.listByChannel(data.channelId) };
    case 'turn':
      return { steps: service.listByTurn(data.meetingId, data.turnIndex) };
  }
}
