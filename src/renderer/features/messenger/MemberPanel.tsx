/**
 * MemberPanel — 메신저 우측 pane (R5-Task9).
 *
 * 외곽은 2 `Card`(참여자 / 합의 상태) 로 구성된다. 내부에서 직접
 * `useChannels` / `useActiveChannel` / `useChannelMembers` /
 * `useActiveMeetings` 를 호출한다(Thread 와 별도 instance — D10 결정,
 * shared cache 는 R10+).
 *
 * activeChannelId 가 null 이거나 channel meta 를 찾지 못하면 참여자
 * 섹션은 "참여자를 표시할 채널을 선택" 문구, 합의 상태는 SsmBox 의
 * empty state 로 대체한다.
 *
 * hex literal 금지.
 */
import { clsx } from 'clsx';
import { useMemo, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { Card, CardHeader, CardBody } from '../../components/primitives';
import { MemberRow } from './MemberRow';
import { SsmBox } from './SsmBox';
import { useActiveChannel } from '../../hooks/use-active-channel';
import { useActiveMeetings } from '../../hooks/use-active-meetings';
import { useChannelMembers } from '../../hooks/use-channel-members';
import { useChannels } from '../../hooks/use-channels';
import { useDms } from '../../hooks/use-dms';
import { useGlobalGeneralChannel } from '../../hooks/use-global-general-channel';

export interface MemberPanelProps {
  projectId: string;
  className?: string;
}

export function MemberPanel({
  projectId,
  className,
}: MemberPanelProps): ReactElement {
  const { t } = useTranslation();
  const { channels } = useChannels(projectId);
  const { dms } = useDms();
  // R12-C round 4: 전역 일반 채널까지 검증 list 에 포함 (Thread.tsx 와
  // 동일한 race 차단 — globalGeneralChannel loading 중에는 allChannels
  // null 유지해 useActiveChannel validation 이 active id 를 wipe 하지
  // 못하게).
  const {
    channel: globalGeneralChannel,
    loading: globalGeneralChannelLoading,
  } = useGlobalGeneralChannel();
  const allChannels = useMemo(() => {
    if (channels === null || dms === null || globalGeneralChannelLoading) {
      return null;
    }
    const merged = [...channels, ...dms];
    if (globalGeneralChannel !== null) merged.push(globalGeneralChannel);
    return merged;
  }, [channels, dms, globalGeneralChannel, globalGeneralChannelLoading]);
  const { activeChannelId } = useActiveChannel(projectId, allChannels);

  // R12-C round 4 (#1-a): 일반 채널 (전역 system_general) 은 회의 X +
  // 모든 직원 참여 — 우측 panel (참여자 + 합의 상태) 의 의미가 없다.
  // 전체 panel 을 안내 문구로 대체.
  const isGeneralChannel =
    activeChannelId !== null &&
    globalGeneralChannel !== null &&
    activeChannelId === globalGeneralChannel.id;
  const { members, loading, error } = useChannelMembers(
    activeChannelId,
    allChannels,
  );
  const { meetings } = useActiveMeetings();

  const activeMeeting = useMemo(() => {
    if (activeChannelId === null) return null;
    // R12-C2 P1.5 — 일반 채널 (#일반) 은 회의 X (spec §11.3). 잔존 active
    // meeting row 가 있어도 SsmBox empty 가 정직. 신규 생성은 backend
    // 가드로 차단되지만 옛 row 즉시 회복은 frontend 분기.
    if (isGeneralChannel) return null;
    if (meetings === null) return null;
    return meetings.find((m) => m.channelId === activeChannelId) ?? null;
  }, [activeChannelId, isGeneralChannel, meetings]);

  const participantCount =
    members === null ? null : members.length;

  const participantsBody = (() => {
    if (activeChannelId === null) {
      return (
        <p
          data-testid="member-panel-no-channel"
          className="text-sm text-fg-muted"
        >
          {t('messenger.memberPanel.noActiveChannel')}
        </p>
      );
    }
    if (error !== null) {
      return (
        <p
          role="alert"
          data-testid="member-panel-error"
          className="text-sm text-danger"
        >
          {t('messenger.memberPanel.error')}
        </p>
      );
    }
    if (members === null && loading) {
      return (
        <p
          data-testid="member-panel-loading"
          className="text-sm text-fg-muted"
        >
          {t('messenger.memberPanel.loading')}
        </p>
      );
    }
    const list = members ?? [];
    if (list.length === 0) {
      return (
        <p
          data-testid="member-panel-empty"
          className="text-sm text-fg-muted"
        >
          {t('messenger.memberPanel.empty')}
        </p>
      );
    }
    return (
      <ul
        data-testid="member-panel-list"
        className="flex flex-col gap-2"
      >
        {list.map((member) => (
          <MemberRow key={member.providerId} member={member} />
        ))}
      </ul>
    );
  })();

  return (
    <div
      data-testid="member-panel"
      data-general-channel={isGeneralChannel ? 'true' : 'false'}
      data-project-id={projectId}
      data-channel-id={activeChannelId ?? ''}
      className={clsx('flex h-full min-h-0 flex-col gap-3 p-3', className)}
    >
      <Card data-testid="member-panel-participants" className="flex flex-col">
        <CardHeader
          heading={
            participantCount === null
              ? t('messenger.memberPanel.participantsTitle')
              : t('messenger.memberPanel.participantsTitleCount', {
                  count: participantCount,
                })
          }
        />
        <CardBody>{participantsBody}</CardBody>
      </Card>

      {/* R12-C2 P1.5 follow-up — 일반 채널 (전역 system_general) 은 합의
          상태 카드 hide. *장난식 동의/반대 카운터* + `[##본문]` 카드는 P4
          본격 흐름 land 시점에 등장하며, 그 사이에는 surface 정의가
          없으므로 카드 자체를 렌더하지 않는다 (R12-C round 4 시점에는
          panel 통째 안내 문구로 대체됐지만, 사용자 dogfooding 결과 멤버
          목록 노출 요청으로 *참여자 카드는 유지 + 합의 카드만 hide* 로
          전환). */}
      {!isGeneralChannel && (
        <Card data-testid="member-panel-consensus" className="flex flex-col">
          <CardHeader heading={t('messenger.memberPanel.consensusTitle')} />
          <CardBody>
            <SsmBox meeting={activeMeeting} />
          </CardBody>
        </Card>
      )}
    </div>
  );
}
