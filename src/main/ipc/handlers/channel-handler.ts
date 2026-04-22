/**
 * channel:* IPC handlers.
 *
 * Wire the 7 channel IPC calls to {@link ChannelService} (+ {@link
 * MeetingService} for `channel:start-meeting`).
 *
 * `channel:create` branches on `kind`: `'user'` → ChannelService.create,
 * `'dm'` → ChannelService.createDm (single providerId from
 * memberProviderIds[0]), `'system_*'` is rejected — system channels are
 * only ever auto-created by ProjectService's post-create hook.
 *
 * `channel:list` returns the project's channels when `projectId` is
 * non-null, and the DM list when `projectId === null`. This matches the
 * renderer sidebar which asks for "this project" vs. "my DMs".
 */

import type { IpcRequest, IpcResponse } from '../../../shared/ipc-types';
import type { ChannelService } from '../../channels/channel-service';
import type { MeetingService } from '../../meetings/meeting-service';
import type { Meeting } from '../../../shared/meeting-types';
import type { Participant } from '../../../shared/engine-types';
import type { SsmContext } from '../../../shared/ssm-context-types';

/**
 * Factory surface used by `channel:start-meeting` to kick off a
 * MeetingOrchestrator after MeetingService has created the DB row.
 * Wired in `main/index.ts`; R7+ may replace the sync factory with an
 * ApprovalService-gated variant.
 */
export interface MeetingOrchestratorFactory {
  createAndRun(input: {
    meeting: Meeting;
    projectId: string;
    participants: Participant[];
    topic: string;
    ssmCtx: SsmContext;
  }): Promise<void> | void;
}

let channelAccessor: (() => ChannelService) | null = null;
let meetingAccessor: (() => MeetingService) | null = null;
let orchestratorFactory: MeetingOrchestratorFactory | null = null;

export function setChannelServiceAccessor(fn: () => ChannelService): void {
  channelAccessor = fn;
}

export function setMeetingServiceAccessor(fn: () => MeetingService): void {
  meetingAccessor = fn;
}

export function setMeetingOrchestratorFactory(
  factory: MeetingOrchestratorFactory,
): void {
  orchestratorFactory = factory;
}

function getChannel(): ChannelService {
  if (!channelAccessor) {
    throw new Error('channel handler: service not initialized');
  }
  return channelAccessor();
}

function getMeeting(): MeetingService {
  if (!meetingAccessor) {
    throw new Error('channel handler: meeting service not initialized');
  }
  return meetingAccessor();
}

/** channel:list */
export function handleChannelList(
  data: IpcRequest<'channel:list'>,
): IpcResponse<'channel:list'> {
  const svc = getChannel();
  const channels =
    data.projectId === null ? svc.listDms() : svc.listByProject(data.projectId);
  return { channels };
}

/** channel:create */
export function handleChannelCreate(
  data: IpcRequest<'channel:create'>,
): IpcResponse<'channel:create'> {
  const svc = getChannel();
  if (data.kind === 'dm') {
    if (data.memberProviderIds.length !== 1) {
      throw new Error(
        'channel:create dm: exactly one providerId required',
      );
    }
    const channel = svc.createDm(data.memberProviderIds[0]);
    return { channel };
  }
  if (data.kind === 'user') {
    if (data.projectId === null) {
      throw new Error('channel:create user: projectId required');
    }
    const channel = svc.create({
      projectId: data.projectId,
      name: data.name,
      memberProviderIds: data.memberProviderIds,
    });
    return { channel };
  }
  throw new Error(
    `channel:create: kind "${data.kind}" is auto-created by the project lifecycle`,
  );
}

/** channel:rename */
export function handleChannelRename(
  data: IpcRequest<'channel:rename'>,
): IpcResponse<'channel:rename'> {
  const channel = getChannel().rename(data.id, data.name);
  return { channel };
}

/** channel:delete */
export function handleChannelDelete(
  data: IpcRequest<'channel:delete'>,
): IpcResponse<'channel:delete'> {
  getChannel().delete(data.id);
  return { success: true };
}

/** channel:add-members */
export function handleChannelAddMembers(
  data: IpcRequest<'channel:add-members'>,
): IpcResponse<'channel:add-members'> {
  const svc = getChannel();
  for (const providerId of data.providerIds) {
    svc.addMember(data.id, providerId);
  }
  return { success: true };
}

/** channel:remove-members */
export function handleChannelRemoveMembers(
  data: IpcRequest<'channel:remove-members'>,
): IpcResponse<'channel:remove-members'> {
  const svc = getChannel();
  for (const providerId of data.providerIds) {
    svc.removeMember(data.id, providerId);
  }
  return { success: true };
}

/** channel:start-meeting */
export function handleChannelStartMeeting(
  data: IpcRequest<'channel:start-meeting'>,
): IpcResponse<'channel:start-meeting'> {
  const meeting = getMeeting().start({
    channelId: data.channelId,
    topic: data.topic,
  });

  // R6-Task4: fire-and-forget orchestrator boot. We do NOT await —
  // the IPC response goes back to the renderer immediately so the
  // MeetingBanner can render; the orchestrator drives turn + stream
  // events on its own schedule.
  const factory = orchestratorFactory;
  if (factory) {
    const channel = getChannel().get(data.channelId);
    if (channel && channel.projectId) {
      const members = getChannel().listMembers(data.channelId);
      const participants: Participant[] = members.map((m) => ({
        id: m.providerId,
        providerId: m.providerId,
        displayName: m.providerId,
        isActive: true,
      }));
      if (participants.length >= 2) {
        const ssmCtx: SsmContext = {
          meetingId: meeting.id,
          channelId: meeting.channelId,
          projectId: channel.projectId,
          projectPath: '',
          permissionMode: 'hybrid',
          autonomyMode: 'manual',
        };
        void factory.createAndRun({
          meeting,
          projectId: channel.projectId,
          participants,
          topic: data.topic,
          ssmCtx,
        });
      }
    }
  }

  return { meeting };
}
