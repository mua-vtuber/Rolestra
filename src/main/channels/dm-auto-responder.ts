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

    // R12-C2 P1.5 follow-up — 일반 채널 (전역 system_general) 은 N 턴 응답
    // (모든 등록 직원 순차 1 턴씩). 사용자 vision = 여러 직원 자유 응답
    // (spec §11.3 + 메모리 r12-meeting-system-redesign §3). 본격 모델
    // (가벼운 동의/반대 카운터 + `[##본문]` 카드 + 직원이 응답 *생략* 결정
    // 가능 + 동시 응답) 은 P4 land 시점에 등장. 현재는 *모든 멤버 1턴씩
    // 순차*가 minimal — 각 응답마다 messageService.append → backend
    // stream:channel-message emit → renderer 자동 표시 (1명씩 차례로
    // 등장하는 게 자연스러운 진행 표시 역할).
    //
    // DM 은 1 턴 응답 (1:1 정체성 — partial unique index
    // `idx_dm_unique_per_provider` 가 channel_members.length === 1 보장).
    if (channel.kind === 'system_general') {
      for (const member of members) {
        await this.respondAs(channel, member);
      }
      return;
    }

    await this.respondAs(channel, members[0]!);
  }

  /**
   * 단일 직원의 1 턴 응답 — provider lookup → persistent context reset →
   * stream completion → message append. 실패 시 system error 메시지로
   * surface (silent fallback 금지). 멤버별로 독립 — 한 명 실패가 다음 멤버
   * 응답 흐름을 막지 않는다.
   */
  private async respondAs(
    channel: Channel,
    member: ChannelMember,
  ): Promise<void> {
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

    // D-A T6 dogfooding (#7) — clear any persistent CLI session so the
    // DM/일반 채널 응답이 meeting-mode format instructions (e.g.
    // `mode_judgment` JSON wrapper) 을 이전 `--resume`-able exchange 에서
    // 상속받지 않게 한다. Stateless API providers 는 no-op.
    provider.resetConversationContext();

    // 단일 턴 chat — no SSM, no consensus format, no permission rules.
    // 빈 persona — 회의 mode 의 identity / permission text 가 대화 응답에
    // 흘러들어가지 않게. 사용자별 per-channel persona 는 추후 feature.
    const dmPersona = '';

    let fullContent = '';
    try {
      for await (const token of provider.streamCompletion(
        providerMessages,
        dmPersona,
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
      // A provider returning no tokens at all is an empty success — log it
      // but do not append a blank message (would just confuse the user).
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
