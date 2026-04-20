/**
 * meeting:* IPC handlers.
 *
 * The only channel exposed on this domain is `meeting:abort` — start
 * flows through `channel:start-meeting`, finish happens inside the SSM
 * engine. Abort is surfaced as a user gesture so the user can tear down
 * a stuck meeting without waiting for the SSM to reach a terminal state.
 */

import type { IpcRequest, IpcResponse } from '../../../shared/ipc-types';
import type { MeetingService } from '../../meetings/meeting-service';

let meetingAccessor: (() => MeetingService) | null = null;

export function setMeetingAbortServiceAccessor(
  fn: () => MeetingService,
): void {
  meetingAccessor = fn;
}

function getService(): MeetingService {
  if (!meetingAccessor) {
    throw new Error('meeting handler: service not initialized');
  }
  return meetingAccessor();
}

/** meeting:abort */
export function handleMeetingAbort(
  data: IpcRequest<'meeting:abort'>,
): IpcResponse<'meeting:abort'> {
  getService().finish(data.meetingId, 'aborted', null);
  return { success: true };
}
