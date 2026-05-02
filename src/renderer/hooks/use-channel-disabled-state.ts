/**
 * `useChannelDisabledState` — R12-C T11 Composer 분기 산출.
 *
 * 부서 채널 (role !== null && role !== 'general') 은 워크플로우 진입 전에
 * 입력란이 disabled 다. 사용자가 임의 메시지로 부서 채널을 오염시키지 못하게
 * 하려는 spec §11.4 의 규약. 워크플로우 진입 = 그 채널에 활성 회의가 있는
 * 시점 (T13~T17 워크플로우 service 가 직접 회의를 띄운다).
 *
 * 일반 채널 (system_general) / DM (kind='dm') / 자유 user 채널 (role IN
 * (null, 'general')) / system_approval / system_minutes 는 영향 없음 —
 * 이전과 동일.
 *
 * 디자인 / 구현 / 검토 부서는 인계 trigger 만 받지만 Composer 분기 자체는
 * 동일 (활성 회의 = enabled). 인계 모달 자체는 T19 land.
 */
import { useMemo } from 'react';

import type { Channel } from '../../shared/channel-types';
import type { ActiveMeetingSummary } from '../../shared/meeting-types';

export interface ChannelDisabledState {
  /** Composer 입력 비활성. true 면 textarea + send 버튼 모두 비활성. */
  workflowDisabled: boolean;
  /**
   * disabled 인 동안 보여줄 placeholder 키 (i18n). null 이면 기본
   * `messenger.composer.placeholder` 사용.
   */
  disabledPlaceholderKey: string | null;
}

const DEPT_DISABLED_PLACEHOLDER_KEY =
  'channel.deptDisabledPlaceholder' as const;

export function useChannelDisabledState(
  channel: Channel | null,
  activeMeetings: ActiveMeetingSummary[] | null,
): ChannelDisabledState {
  return useMemo(() => {
    if (channel === null) {
      return { workflowDisabled: false, disabledPlaceholderKey: null };
    }
    // 부서 채널만 분기 — system / dm / free user 는 그대로.
    const isDepartmentChannel =
      channel.kind === 'user' &&
      channel.role !== null &&
      channel.role !== 'general';
    if (!isDepartmentChannel) {
      return { workflowDisabled: false, disabledPlaceholderKey: null };
    }
    // 활성 회의가 있으면 워크플로우 진행 중 → enabled.
    const hasActiveMeeting =
      activeMeetings !== null &&
      activeMeetings.some((m) => m.channelId === channel.id);
    if (hasActiveMeeting) {
      return { workflowDisabled: false, disabledPlaceholderKey: null };
    }
    return {
      workflowDisabled: true,
      disabledPlaceholderKey: DEPT_DISABLED_PLACEHOLDER_KEY,
    };
  }, [channel, activeMeetings]);
}
