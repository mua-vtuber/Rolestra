/**
 * DmAutoResponder — D-A Task 6.
 *
 * Spec §3.1 — DM channels are single-turn: one user message in, one
 * assistant message out. No meeting row, no orchestrator, no consensus
 * SSM. The renderer's DM thread already shows messages straight from
 * `messageService.listByChannel`; this responder just makes sure each
 * user message gets a reply.
 *
 * Wired up at startup (T5) as the `dmResponder` dependency of
 * {@link MeetingAutoTrigger}. The trigger receives every channel
 * message via `MessageService.on('message')` and forwards DMs here.
 *
 * Failure mode: when the provider throws, we append a `system`
 * (authorKind='member') message containing the error so the user can see
 * what failed — the DM thread is the only surface they have. We do not
 * surface the raw stack; one line of error message is enough to act on.
 */

import type { Channel, ChannelMember } from '../../shared/channel-types';
import type { Message as ChannelMessage } from '../../shared/message-types';
import type { Message as ProviderMessage } from '../../shared/provider-types';
import { tryGetLogger } from '../log/logger-accessor';
import type { BaseProvider } from '../providers/provider-interface';
import type { ChannelService } from './channel-service';
import type { MessageService } from './message-service';

export interface DmAutoResponderDeps {
  channelService: Pick<ChannelService, 'listMembers'>;
  messageService: Pick<MessageService, 'listByChannel' | 'append'>;
  providerLookup: { get(id: string): BaseProvider | undefined };
}

/** Recent-history depth fed back to the provider as context. Same order
 *  of magnitude as the meeting executor; DMs are usually shorter. */
const HISTORY_LIMIT = 50;

export class DmAutoResponder {
  constructor(private readonly deps: DmAutoResponderDeps) {}

  async handle(_message: ChannelMessage, channel: Channel): Promise<void> {
    const members = this.deps.channelService.listMembers(channel.id);
    if (members.length === 0) {
      tryGetLogger()?.warn({
        component: 'dm-auto-responder',
        action: 'no-member',
        result: 'failure',
        metadata: { channelId: channel.id },
      });
      return;
    }
    // DMs hold exactly one member by construction (createDm + the partial
    // unique index `idx_dm_unique_per_provider`).
    const member: ChannelMember = members[0]!;

    const provider = this.deps.providerLookup.get(member.providerId);
    if (!provider) {
      this.appendSystemError(
        channel.id,
        member.providerId,
        `provider "${member.providerId}" not registered`,
      );
      return;
    }

    const providerMessages = this.buildProviderMessages(channel.id);

    let fullContent = '';
    try {
      for await (const token of provider.streamCompletion(
        providerMessages,
        provider.persona ?? '',
      )) {
        fullContent += token;
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      tryGetLogger()?.error({
        component: 'dm-auto-responder',
        action: 'generate-failed',
        result: 'failure',
        metadata: { channelId: channel.id, providerId: member.providerId, error: errMsg },
      });
      this.appendSystemError(channel.id, member.providerId, errMsg);
      return;
    }

    if (fullContent.length === 0) {
      // A provider returning no tokens at all is an empty success — we
      // log it but do not append a blank message (would just confuse the
      // user). Effectively a no-op response.
      tryGetLogger()?.warn({
        component: 'dm-auto-responder',
        action: 'empty-response',
        result: 'failure',
        metadata: { channelId: channel.id, providerId: member.providerId },
      });
      return;
    }

    this.deps.messageService.append({
      channelId: channel.id,
      meetingId: null,
      authorId: member.providerId,
      authorKind: 'member',
      role: 'assistant',
      content: fullContent,
    });
  }

  /**
   * Reverse-chronological history → chronological provider input. Filters
   * out `tool` rows since the provider message shape only carries
   * user/assistant/system. System rows (e.g. previous error breadcrumbs)
   * are preserved so the model can see the conversation continuity.
   */
  private buildProviderMessages(channelId: string): ProviderMessage[] {
    const recent = this.deps.messageService.listByChannel(channelId, {
      limit: HISTORY_LIMIT,
    });
    return recent
      .slice()
      .reverse()
      .filter((m) => m.role !== 'tool')
      .map((m) => ({
        role: m.role as 'user' | 'assistant' | 'system',
        content: m.content,
      }));
  }

  private appendSystemError(
    channelId: string,
    providerId: string,
    errMsg: string,
  ): void {
    this.deps.messageService.append({
      channelId,
      meetingId: null,
      authorId: providerId,
      authorKind: 'member',
      role: 'system',
      content: `응답 실패: ${errMsg}`,
    });
  }
}
