/**
 * SsmBox — 메신저 우측 합의 상태 viewport (R5-Task9 → R12-C2 T18 5 variant).
 *
 * Public API (spec §11.13):
 * - props 는 `channelId` 1 개만. 내부에서 `channel.role` 보고 5 variant
 *   분기. test 우회를 위한 옵션 prop 도 제공 (`channelOverride`,
 *   `meetingOverride`) — production callsite 는 `channelId` 만 넘긴다.
 *
 * Variant 라우팅 (spec §11.13):
 * | role                                 | variant         |
 * |--------------------------------------|-----------------|
 * | `'idea'`                             | IdeaVariant     |
 * | `'planning'` / `'review'` / `'audit'`| PlanningVariant |
 * | `'design.ui'` / `'design.ux'`        | DesignVariant   |
 * | `'implement'`                        | ImplementVariant|
 * | `'general'`                          | GeneralVariant  |
 * | `null` / `'design.character'` / `'design.background'` | LegacyVariant |
 *
 * channel resolve: `useActiveProject` + `useChannels` + `useDms` +
 * `useGlobalGeneralChannel` 를 모두 동원 — DM / system_general / 부서
 * 채널 어떤 source 에서 와도 안전. activeMeeting 은 `useActiveMeetings`
 * 로 channel id match.
 *
 * MemberPanel 이 system_general (#일반) 의 합의 카드를 hide 하므로 본
 * 컴포넌트가 system_general 로 호출되는 일은 없지만, channelId 가
 * resolve 안 되거나 role=null 인 경우 LegacyVariant 가 안전 fallback.
 *
 * hex literal 금지.
 */
import { useMemo, type ReactElement } from 'react';

import { useActiveMeetings } from '../../../hooks/use-active-meetings';
import { useActiveProject } from '../../../hooks/use-active-project';
import { useChannels } from '../../../hooks/use-channels';
import { useDms } from '../../../hooks/use-dms';
import { useGlobalGeneralChannel } from '../../../hooks/use-global-general-channel';
import type { Channel } from '../../../../shared/channel-types';
import type { ActiveMeetingSummary } from '../../../../shared/meeting-types';
import { HandoffPackageCard } from '../../handoff/HandoffPackageCard';
import { useHandoffPackage } from '../../handoff/use-handoff-package';

import { DesignVariant } from './DesignVariant';
import { GeneralVariant } from './GeneralVariant';
import { IdeaVariant } from './IdeaVariant';
import { ImplementVariant } from './ImplementVariant';
import { LegacyVariant } from './LegacyVariant';
import { PlanningVariant } from './PlanningVariant';

export interface SsmBoxProps {
  /** Active channel id. `null` → empty (LegacyVariant 의 빈 상태). */
  channelId: string | null;
  className?: string;
  /**
   * 테스트 전용 — `useChannels` / `useDms` 등 IPC 의존을 우회한다.
   * Production callsite 는 사용 X.
   */
  channelOverride?: Channel | null;
  /**
   * 테스트 전용 — `useActiveMeetings` IPC 의존을 우회한다.
   */
  meetingOverride?: ActiveMeetingSummary | null;
}

export function SsmBox({
  channelId,
  className,
  channelOverride,
  meetingOverride,
}: SsmBoxProps): ReactElement {
  const { activeProjectId } = useActiveProject();
  const { channels } = useChannels(activeProjectId);
  const { dms } = useDms();
  const { channel: globalGeneralChannel } = useGlobalGeneralChannel();
  const { meetings } = useActiveMeetings();

  const resolvedChannel = useMemo<Channel | null>(() => {
    if (channelOverride !== undefined) return channelOverride;
    if (channelId === null) return null;
    if (channels !== null) {
      const fromProject = channels.find((c) => c.id === channelId);
      if (fromProject !== undefined) return fromProject;
    }
    if (dms !== null) {
      const fromDm = dms.find((c) => c.id === channelId);
      if (fromDm !== undefined) return fromDm;
    }
    if (globalGeneralChannel !== null && globalGeneralChannel.id === channelId) {
      return globalGeneralChannel;
    }
    return null;
  }, [channelOverride, channelId, channels, dms, globalGeneralChannel]);

  const resolvedMeeting = useMemo<ActiveMeetingSummary | null>(() => {
    if (meetingOverride !== undefined) return meetingOverride;
    if (channelId === null) return null;
    if (meetings === null) return null;
    return meetings.find((m) => m.channelId === channelId) ?? null;
  }, [meetingOverride, channelId, meetings]);

  const role = resolvedChannel?.role ?? null;

  // R12-C2 T29 — 받는 부서 unopened 의뢰서 lookup. 부서 채널 (role !== null +
  // !== 'general') 에서만 surface — system_general / DM / legacy 는 제외.
  const handoffEnabled =
    role !== null && role !== 'general' && resolvedChannel !== null;
  const { pending: handoffPending, dismiss: dismissHandoff } = useHandoffPackage(
    handoffEnabled ? resolvedChannel?.id ?? null : null,
  );

  if (handoffPending !== null && resolvedChannel !== null) {
    return (
      <HandoffPackageCard
        item={handoffPending.item}
        minutesBody={handoffPending.minutesBody}
        nextActions={handoffPending.nextActions}
        receiverChannelId={resolvedChannel.id}
        onClose={dismissHandoff}
        className={className}
      />
    );
  }

  if (role === 'idea') {
    return <IdeaVariant meeting={resolvedMeeting} className={className} />;
  }
  if (role === 'planning' || role === 'review' || role === 'audit') {
    return (
      <PlanningVariant
        role={role}
        meeting={resolvedMeeting}
        className={className}
      />
    );
  }
  if (role === 'design.ui' || role === 'design.ux') {
    return (
      <DesignVariant
        role={role}
        meeting={resolvedMeeting}
        className={className}
      />
    );
  }
  if (role === 'implement') {
    return (
      <ImplementVariant meeting={resolvedMeeting} className={className} />
    );
  }
  if (role === 'general') {
    return (
      <GeneralVariant
        channelId={resolvedChannel?.id ?? null}
        meeting={resolvedMeeting}
        className={className}
      />
    );
  }

  return (
    <LegacyVariant
      role={role}
      meeting={resolvedMeeting}
      className={className}
    />
  );
}
