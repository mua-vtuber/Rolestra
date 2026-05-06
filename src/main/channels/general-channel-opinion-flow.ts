/**
 * GeneralChannelOpinionFlow — R12-C2 P4 T20.
 *
 * 일반 채널 (`channel.kind === 'system_general'` 또는
 * `channel.kind === 'user' && channel.role === 'general'`) 메시지에 들어
 * 있는 `[##본문]` segment 를 자동 파싱해 의견 카드 (opinion row,
 * `meetingId=null`) 로 등록한다.
 *
 * spec docs/specs/2026-05-01-rolestra-channel-roles-design.md
 *  - §4 일반 부서 새 정의 — `[##본문]` 강제, 한 메시지 안 여러 개 가능
 *  - §11.13 SsmBox general row — `kind='self-raised'` (직원) /
 *    `'user-raised'` (사용자) 카드 list
 *
 * 책임 분리:
 *   - {@link MeetingAutoTrigger} — 부서 채널 회의 모델 진입 / DM 단일 턴
 *     dispatch. 일반 채널은 `system_general` (전역) 만 dm-auto-responder
 *     에 위임 (P1.5 회귀 차단). 본 flow 와 *동시에* 같은 'message' 이벤트
 *     를 받지만 책임이 다름 — 본 flow 는 *카드 등록*, MeetingAutoTrigger
 *     는 *직원 응답 라우팅*.
 *   - {@link DmAutoResponder} — 일반 채널 직원 N 턴 응답. 직원이 응답하면
 *     그 응답 메시지가 다시 'message' 이벤트로 들어와 본 flow 가 자동으로
 *     `kind='self-raised'` 카드를 등록한다 (응답 안에 [##본문] 이 있으면).
 *
 * 동작 룰:
 *   1. `message.authorKind` 가 'user' 또는 'member' 일 때만 처리.
 *      'system' 메시지 (인계 / 회의 시작 알림 등) 는 skip — 자동 카드 등록
 *      대상 X.
 *   2. 채널 lookup 실패 → 로그 + skip (silent fallback X — 채널 부재는 race
 *      또는 데이터 불일치를 의미).
 *   3. 일반 채널 아니면 skip.
 *   4. parser 결과 0 건 → silent skip (잡담만 있는 메시지 = 정상 흐름).
 *   5. parser 결과 1+ 건 → 한 batch 로 OpinionService 호출. 실패 시 로그 +
 *      throw 하지 않음 (listener context 라 'message' 이벤트 catch 흐름이
 *      message 영속을 깨면 안 됨).
 *
 * authorProviderId 매핑:
 *   - `authorKind='user'` → `null` (kind='user-raised')
 *   - `authorKind='member'` → `message.authorId` (provider id 그대로,
 *     kind='self-raised')
 */

import type { Channel } from '../../shared/channel-types';
import type { Message } from '../../shared/message-types';
import { parseDoubleHash } from '../../shared/parsers/double-hash-parser';
import { tryGetLogger } from '../log/logger-accessor';
import type { OpinionService } from '../meetings/opinion-service';
import type { ChannelService } from './channel-service';

export interface GeneralChannelOpinionFlowDeps {
  channelService: Pick<ChannelService, 'get'>;
  opinionService: Pick<OpinionService, 'postFromGeneralChannel'>;
}

/**
 * 채널이 *일반 채널* 정체성에 해당하는지 검사 — system_general (전역
 * #일반) 또는 user role='general' (per-project 잡담). 두 surface 모두
 * SsmBox GeneralVariant 와 본 flow 가 공유 책임지는 채널 종류.
 */
export function isGeneralChannel(channel: Channel): boolean {
  if (channel.kind === 'system_general') return true;
  if (channel.kind === 'user' && channel.role === 'general') return true;
  return false;
}

export class GeneralChannelOpinionFlow {
  constructor(private readonly deps: GeneralChannelOpinionFlowDeps) {}

  /**
   * MessageService 'message' 이벤트 핸들러. listener context — throw 금지
   * (caller (index.ts) 가 별도 catch 하긴 하지만, message 영속 흐름을
   * 어차피 막지 않도록 본 method 안에서 swallow + 로그).
   */
  onMessage(message: Message): void {
    // 'system' authorKind 는 카드 등록 대상 X — 인계 / 회의 시작 알림 등
    // 자동 메시지가 [##] 본문을 우연히 포함해도 잡지 않는다.
    if (message.authorKind !== 'user' && message.authorKind !== 'member') {
      return;
    }

    const channel = this.deps.channelService.get(message.channelId);
    if (!channel) {
      tryGetLogger()?.warn({
        component: 'general-channel-opinion-flow',
        action: 'channel-missing',
        result: 'failure',
        metadata: { channelId: message.channelId, messageId: message.id },
      });
      return;
    }
    if (!isGeneralChannel(channel)) return;

    const matches = parseDoubleHash(message.content);
    if (matches.length === 0) return;

    const authorProviderId =
      message.authorKind === 'user' ? null : message.authorId;
    const parts = matches.map((m) => ({
      title: null as string | null,
      content: m.body,
    }));

    try {
      const result = this.deps.opinionService.postFromGeneralChannel({
        channelId: channel.id,
        authorProviderId,
        parts,
      });
      tryGetLogger()?.info({
        component: 'general-channel-opinion-flow',
        action: 'post-from-general',
        result: 'success',
        metadata: {
          channelId: channel.id,
          messageId: message.id,
          inserted: result.inserted.length,
          authorKind: message.authorKind,
        },
      });
    } catch (err) {
      // Listener swallow — message 자체는 이미 persist 됐으므로 카드 등록
      // 실패가 사용자 입력을 막아선 안 된다. 로그 loudly.
      tryGetLogger()?.warn({
        component: 'general-channel-opinion-flow',
        action: 'post-failed',
        result: 'failure',
        metadata: {
          channelId: channel.id,
          messageId: message.id,
          error: err instanceof Error ? err.message : String(err),
        },
      });
    }
  }
}
