/**
 * createDefaultMeetingStarter — production wiring for {@link QueueMeetingStarter}.
 *
 * Closes R9 Known Concern #1: the autonomy-queue run loop's
 * {@link QueueService.startNext} only flipped pending→in_progress until
 * R10 because the meeting-spawn wire was deferred. This helper produces
 * the same `QueueMeetingStarter` callback that `channel:start-meeting`
 * already uses (see `src/main/index.ts` `setMeetingOrchestratorFactory`),
 * so a queued prompt lights up the same meeting orchestrator as a
 * manually-started one.
 *
 * The starter resolves the target channel in this order:
 *   1. The queue item's `targetChannelId` if the user pinned one
 *      explicitly when adding the prompt.
 *   2. The project's `system_general` channel (the default landing for
 *      autonomy-queue runs per spec §5.2).
 * If neither is available the starter throws — `QueueService.startNext`
 * catches it, flips the row to `failed` with the message, and emits
 * `'changed'` so the renderer surfaces the failure.
 *
 * Participants are derived from the channel's member list. A meeting
 * needs at least 2 participants (mirrors the `channel:start-meeting`
 * factory guard); a single-member channel raises a clear error rather
 * than silently spawning a one-speaker meeting.
 *
 * The `onFinal` correlation the queue cares about (DONE/FAILED → mark
 * the queue row done/failed) is NOT wired here — `MeetingOrchestrator`
 * already runs `onFinalized` against `QueueService.findByMeetingId` /
 * `complete` in the production factory wiring. This helper only owns the
 * spawn side; the finalise side is shared with manual meetings.
 */

import type { Participant } from '../../shared/engine-types';
import type { SsmContext } from '../../shared/ssm-context-types';
import type { Project } from '../../shared/project-types';
import type { ChannelService } from '../channels/channel-service';
import type { MeetingService } from '../meetings/meeting-service';
import type { ProjectService } from '../projects/project-service';
import type { MeetingOrchestratorFactory } from '../ipc/handlers/channel-handler';
import type { QueueMeetingStarter, QueueService } from './queue-service';

/**
 * Topic snippet length cap for the meeting row. The full prompt is
 * preserved on `queue_items.prompt`; the meeting topic is just the
 * MeetingBanner caption. Keep it short so the banner does not wrap
 * into a multi-line block.
 */
export const QUEUE_MEETING_TOPIC_LIMIT = 60;

/**
 * Narrowed view of the four services the starter needs. Tests can
 * supply lightweight fakes that implement only these methods.
 */
export interface DefaultMeetingStarterDeps {
  channelService: Pick<ChannelService, 'get' | 'listByProject' | 'listMembers'>;
  meetingService: Pick<MeetingService, 'start'>;
  projectService: Pick<ProjectService, 'get'>;
  /**
   * Function-typed access to the queue so the starter can read the
   * `targetChannelId` of the just-claimed row. Passing the lookup
   * function (rather than the whole service) keeps the starter free of
   * the EventEmitter surface and avoids the circular import that a
   * direct `QueueService` reference would create — the starter is
   * itself a constructor argument of `QueueService`.
   */
  queueItemLookup: Pick<QueueService, 'get'>;
  /**
   * The same factory the IPC `channel:start-meeting` handler uses. We
   * share it so a queued meeting follows the identical orchestrator
   * lifecycle (registry registration, side-effect wiring, onFinalized
   * hook) as a manually-started meeting.
   */
  orchestratorFactory: MeetingOrchestratorFactory;
}

/**
 * Custom error class so callers (`QueueService.startNext`) can identify
 * starter-side failures distinctly from a downstream
 * `MeetingService.start` rejection. The message itself is human-
 * friendly and surfaces unchanged on `queue_items.last_error`.
 */
export class QueueMeetingStarterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QueueMeetingStarterError';
  }
}

/**
 * Build the production `QueueMeetingStarter` for the given service
 * graph. The returned function resolves a target channel, opens a
 * meeting row, derives participants from the channel members, and
 * delegates the orchestrator boot to the shared factory.
 */
export function createDefaultMeetingStarter(
  deps: DefaultMeetingStarterDeps,
): QueueMeetingStarter {
  return async ({ projectId, prompt, queueItemId }) => {
    // 1. Resolve the target channel — pinned id wins; otherwise default
    //    to `#일반` (`system_general`).
    const channelId = resolveChannelId(deps, projectId, queueItemId);

    const channel = deps.channelService.get(channelId);
    if (!channel) {
      throw new QueueMeetingStarterError(
        `target channel not found: ${channelId}`,
      );
    }

    // 2. Build the participant list from the channel members.
    const members = deps.channelService.listMembers(channelId);
    if (members.length < 2) {
      throw new QueueMeetingStarterError(
        `channel ${channelId} has ${members.length} member(s); need >= 2`,
      );
    }
    const participants: Participant[] = members.map((m) => ({
      id: m.providerId,
      providerId: m.providerId,
      displayName: m.providerId,
      isActive: true,
    }));

    // 3. Project context for SSM. Pull the project so the SSM context
    //    starts with the persisted permissionMode/autonomyMode rather
    //    than R6-era defaults (the orchestrator's `wireV3SideEffects`
    //    reads these to decide gating + downgrade behaviour).
    const project = deps.projectService.get(projectId);
    if (!project) {
      throw new QueueMeetingStarterError(
        `project not found: ${projectId}`,
      );
    }

    // 4. Open the meeting row. The topic is a slice of the prompt — the
    //    full prompt remains on the queue row + (eventually) on the
    //    meeting's first system message.
    const topic = sliceTopic(prompt);
    const meeting = deps.meetingService.start({ channelId, topic });

    // 5. Boot the orchestrator. Fire-and-forget: the factory owns the
    //    run lifecycle + side-effect disposers. The `meetingId` is
    //    handed back to QueueService so `started_meeting_id` is
    //    stamped before the orchestrator emits its first state event.
    const ssmCtx: SsmContext = buildSsmCtx(meeting.id, channelId, project);
    await Promise.resolve(
      deps.orchestratorFactory.createAndRun({
        meeting,
        projectId,
        participants,
        topic,
        ssmCtx,
      }),
    );

    return { meetingId: meeting.id };
  };
}

/**
 * Pick the queue item's pinned `targetChannelId`, falling back to the
 * project's `#일반` (`system_general`) channel. Throws when no
 * candidate exists — the queue catches and flips to `failed`.
 */
function resolveChannelId(
  deps: DefaultMeetingStarterDeps,
  projectId: string,
  queueItemId: string,
): string {
  const queueItem = deps.queueItemLookup.get(queueItemId);
  if (queueItem && queueItem.targetChannelId) {
    return queueItem.targetChannelId;
  }
  const channels = deps.channelService.listByProject(projectId);
  const general = channels.find((c) => c.kind === 'system_general');
  if (general) return general.id;
  throw new QueueMeetingStarterError(
    `no target channel for project ${projectId}: queue item has no targetChannelId and #일반 is missing`,
  );
}

/** Trim and cap a queue prompt for use as the meeting topic. */
function sliceTopic(prompt: string): string {
  const trimmed = prompt.trim();
  if (trimmed.length <= QUEUE_MEETING_TOPIC_LIMIT) return trimmed;
  return `${trimmed.slice(0, QUEUE_MEETING_TOPIC_LIMIT - 1)}…`;
}

/**
 * Construct the SSM context for a queue-spawned meeting. Mirrors the
 * shape used by `channel:start-meeting` (project_path is a placeholder
 * empty string until R10-Task5 lands the permission-flag matrix wiring
 * — none of the autonomy-queue paths consume it today).
 */
function buildSsmCtx(
  meetingId: string,
  channelId: string,
  project: Project,
): SsmContext {
  return {
    meetingId,
    channelId,
    projectId: project.id,
    projectPath: '',
    permissionMode: project.permissionMode,
    autonomyMode: project.autonomyMode,
  };
}
