/**
 * MeetingAutoTrigger — D-A Task 4.
 *
 * Spec §3.1, §3.2, §4.1 — turns a user message in a channel into a
 * meeting interaction without the renderer having to call
 * `channel:start-meeting`. Subscribed to `MessageService`'s `'message'`
 * event from `main/index.ts` (T5 wiring).
 *
 * Branching by channel kind:
 *   - `dm`            — delegated to {@link DmAutoResponderInterface}.
 *                        DM is single-turn; no meeting row, no orchestrator.
 *   - `system_approval` / `system_minutes` — read-only. Receiving a user
 *                        message here means a UI bug somewhere; we log
 *                        and drop the trigger (the message itself is
 *                        already persisted).
 *   - `system_general` / `user` — meeting model.
 *                        - active meeting present → `interruptActive` so
 *                          the running orchestrator picks up the user's
 *                          interjection on the next turn.
 *                        - none active → `meetingService.start({kind:'auto'})`
 *                          + `createAndRun`. Topic is the message's first
 *                          80 chars (with ellipsis when truncated).
 *
 * Race against {@link AlreadyActiveMeetingError}: two near-simultaneous
 * user messages on the same channel could both observe `getActive=null`
 * and race on `start()`. The DB partial unique index
 * `idx_meetings_active_per_channel` lets exactly one win; the loser
 * catches the error, re-reads `getActive`, and falls back to
 * `interruptActive` so the message still reaches the meeting.
 *
 * Coordination with the T2.5 dispatcher
 * (`dispatchUserMessageToActiveMeeting`): both subscribe to the same
 * `'message'` event. T2.5 fires only when `message.meetingId` is already
 * non-null (the renderer or another producer tagged the message to a
 * meeting). T4 deliberately skips that case — its job is to react to
 * untagged messages. The two listeners are mutually exclusive in effect.
 */

import type { Channel } from '../../shared/channel-types';
import type { Message } from '../../shared/message-types';
import { tryGetLogger } from '../log/logger-accessor';
import {
  AlreadyActiveMeetingError,
  type MeetingService,
} from './meeting-service';

const TOPIC_MAX = 80;
const TOPIC_ELLIPSIS = '...';

/**
 * Higher-level orchestrator surface used by MeetingAutoTrigger. The wiring
 * layer (T5) adapts the production {@link MeetingOrchestratorFactory}'s
 * signature (which takes `participants` + `ssmCtx`) to this shape so the
 * trigger can stay ignorant of project / participant resolution.
 */
export interface MeetingOrchestratorAutoFactory {
  /** Spawn an orchestrator for the freshly-started meeting. The first
   *  user message is forwarded so the orchestrator can seed its history
   *  before the first AI turn. */
  createAndRun(input: {
    meetingId: string;
    channelId: string;
    topic: string;
    firstMessage: Message;
  }): Promise<void> | void;
  /** Forward a user message to the live orchestrator owning `meetingId`.
   *  Cheap no-op if the orchestrator has already torn down. */
  interruptActive(input: {
    meetingId: string;
    message: Message;
  }): Promise<void> | void;
}

export interface DmAutoResponderInterface {
  handle(message: Message, channel: Channel): Promise<void> | void;
}

export interface MeetingAutoTriggerDeps {
  channelService: { get(id: string): Channel | null };
  meetingService: Pick<MeetingService, 'getActive' | 'start'>;
  orchestratorFactory: MeetingOrchestratorAutoFactory;
  dmResponder: DmAutoResponderInterface;
}

/** Truncate `content` to at most `TOPIC_MAX` chars; appends `...` when
 *  shortened so the renderer label conveys "we cut this". */
function toTopic(content: string): string {
  if (content.length <= TOPIC_MAX) return content;
  return content.slice(0, TOPIC_MAX - TOPIC_ELLIPSIS.length) + TOPIC_ELLIPSIS;
}

export class MeetingAutoTrigger {
  constructor(private readonly deps: MeetingAutoTriggerDeps) {}

  async onMessage(message: Message): Promise<void> {
    if (message.authorKind !== 'user') return;
    // Already-tagged messages belong to the T2.5 dispatcher; do not
    // double-route. The contract: an untagged user message either spawns
    // or joins a meeting; a tagged one is an interjection into a meeting
    // the renderer already showed.
    if (message.meetingId !== null) return;

    const channel = this.deps.channelService.get(message.channelId);
    if (!channel) {
      tryGetLogger()?.warn({
        component: 'meeting-auto-trigger',
        action: 'channel-missing',
        result: 'failure',
        metadata: { channelId: message.channelId, messageId: message.id },
      });
      return;
    }

    if (channel.kind === 'dm') {
      await this.deps.dmResponder.handle(message, channel);
      return;
    }

    if (
      channel.kind === 'system_approval' ||
      channel.kind === 'system_minutes'
    ) {
      tryGetLogger()?.warn({
        component: 'meeting-auto-trigger',
        action: 'readonly-channel-message',
        result: 'failure',
        metadata: { channelId: channel.id, kind: channel.kind },
      });
      return;
    }

    // user / system_general — meeting model.
    await this.handleMeetingChannel(message, channel);
  }

  private async handleMeetingChannel(
    message: Message,
    channel: Channel,
  ): Promise<void> {
    const active = this.deps.meetingService.getActive(channel.id);
    if (active) {
      await this.deps.orchestratorFactory.interruptActive({
        meetingId: active.id,
        message,
      });
      return;
    }

    const topic = toTopic(message.content);
    try {
      const meeting = this.deps.meetingService.start({
        channelId: channel.id,
        topic,
        kind: 'auto',
      });
      await this.deps.orchestratorFactory.createAndRun({
        meetingId: meeting.id,
        channelId: channel.id,
        topic,
        firstMessage: message,
      });
    } catch (err) {
      if (err instanceof AlreadyActiveMeetingError) {
        // Race: a sibling listener (or another producer) won the start.
        // Re-read and join via interrupt so the message still lands.
        const existing = this.deps.meetingService.getActive(channel.id);
        if (existing) {
          await this.deps.orchestratorFactory.interruptActive({
            meetingId: existing.id,
            message,
          });
          return;
        }
        // The race winner already finished and reaped the row before we
        // re-read. Surface as warn — the message is on disk; the user can
        // type again to spawn a fresh meeting.
        tryGetLogger()?.warn({
          component: 'meeting-auto-trigger',
          action: 'race-no-active-after-collision',
          result: 'failure',
          metadata: { channelId: channel.id, messageId: message.id },
        });
        return;
      }
      throw err;
    }
  }
}
