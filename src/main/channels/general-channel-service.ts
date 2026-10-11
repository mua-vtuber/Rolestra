import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { Channel } from '../../shared/channel-types';
import { catalogDefaultForNullRole } from '../../shared/permission-set-types';
import { tryGetLogger } from '../log/logger-accessor';
import { ChannelError } from './channel-errors';
import type { ChannelService } from './channel-service';
import {
  GENERAL_CHANNEL_PROVISIONED_MARKER,
  type GeneralChannelRepository,
} from './general-channel-repository';

export interface GeneralClosedEvent { channelId: string }

/**
 * The global general channel's lifecycle (spec 2026-10-08 F1): it is created
 * once on first run and, once the user deletes it, never again. Deleting it
 * shares the chat room / DM close path — after the row is gone the 'closed'
 * listeners abort the in-flight turn, reject its late write, drop its CLI
 * clones (bootstrap/chat-event-bridges.ts) and interrupt its votes
 * (bootstrap/chat-services.ts).
 */
export class GeneralChannelService extends EventEmitter {
  constructor(
    private readonly repo: GeneralChannelRepository,
    private readonly channels: Pick<ChannelService, 'get' | 'getGlobalGeneralChannel' | 'isConversationArchiving'>,
    private readonly insertChannel: (channel: Channel) => void,
  ) { super(); }

  /**
   * Boot, once. With the marker present this returns the current row (or
   * `null` after a delete) and creates nothing. Without the marker it
   * records the marker for an existing row, or creates the channel and the
   * marker together.
   */
  provisionOnFirstRun(): Channel | null {
    return this.repo.transaction(() => {
      if (this.repo.hasMarker(GENERAL_CHANNEL_PROVISIONED_MARKER)) {
        return this.channels.getGlobalGeneralChannel();
      }
      const existing = this.channels.getGlobalGeneralChannel();
      if (existing) {
        // Migration 039 marks existing installs; this covers a row it missed.
        this.repo.recordMarker(GENERAL_CHANNEL_PROVISIONED_MARKER, existing.createdAt);
        return existing;
      }
      const channel: Channel = {
        id: randomUUID(),
        projectId: null,
        name: '일반',
        kind: 'system_general',
        readOnly: false,
        createdAt: Date.now(),
        role: null,
        purpose: null,
        handoffMode: 'check',
        // The general channel is small talk, not a meeting: no round limit.
        maxRounds: null,
        // System channels carry no meeting context: the safe D2 default.
        permissions: catalogDefaultForNullRole(),
      };
      this.insertChannel(channel);
      this.repo.recordMarker(GENERAL_CHANNEL_PROVISIONED_MARKER, channel.createdAt);
      return channel;
    });
  }

  /**
   * Deletes the global general channel and its whole history. The marker
   * stays, so the next boot does not create it again.
   */
  delete(channelId: string): void {
    const channel = this.channels.get(channelId);
    if (!channel || channel.kind !== 'system_general' || channel.projectId !== null) {
      throw new Error(`Global general channel not found: ${channelId}`);
    }
    if (this.channels.isConversationArchiving(channelId)) {
      throw new ChannelError(`Conversation archive in progress: ${channelId}`);
    }
    this.repo.deleteGeneral(channelId);
    try {
      this.emit('closed', { channelId } satisfies GeneralClosedEvent);
    } catch (error) {
      // The delete already committed; a listener cannot undo it (same rule
      // as chat rooms and DMs).
      tryGetLogger()?.error({
        component: 'general-channel', action: 'close-listener', result: 'failure',
        metadata: { channelId, error: error instanceof Error ? error.message : String(error) },
      });
    }
  }
}
