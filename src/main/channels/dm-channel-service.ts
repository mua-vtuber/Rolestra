import { EventEmitter } from 'node:events';
import { tryGetLogger } from '../log/logger-accessor';
import type { ChannelService } from './channel-service';

export interface DmClosedEvent { channelId: string }

/**
 * DM deletion shares the chat room close path: after the row is gone, the
 * 'closed' listeners abort the in-flight reply, reject its late write and
 * drop the DM's CLI clone (see bootstrap/chat-event-bridges.ts). It lives
 * beside ChannelService so that already oversized file does not grow.
 */
export class DmChannelService extends EventEmitter {
  constructor(private readonly channels: Pick<ChannelService, 'get' | 'delete'>) { super(); }

  delete(channelId: string): void {
    const channel = this.channels.get(channelId);
    if (!channel || channel.kind !== 'dm') throw new Error(`DM channel not found: ${channelId}`);
    this.channels.delete(channelId);
    try {
      this.emit('closed', { channelId } satisfies DmClosedEvent);
    } catch (error) {
      // The delete already committed; a listener cannot undo it (same rule
      // as chat rooms). console.warn does not persist in the packaged app —
      // route through the project logger so the failure stays observable.
      tryGetLogger()?.error({
        component: 'dm-channel', action: 'close-listener', result: 'failure',
        metadata: { channelId, error: error instanceof Error ? error.message : String(error) },
      });
    }
  }
}
