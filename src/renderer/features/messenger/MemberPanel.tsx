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
  const { activeChannelId } = useActiveChannel(projectId, channels);
  const { members, loading, error } = useChannelMembers(
    activeChannelId,
    channels,
  );
  const { meetings } = useActiveMeetings();

  const activeMeeting = useMemo(() => {
    if (activeChannelId === null) return null;
    if (meetings === null) return null;
    return meetings.find((m) => m.channelId === activeChannelId) ?? null;
  }, [activeChannelId, meetings]);

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

      <Card data-testid="member-panel-consensus" className="flex flex-col">
        <CardHeader heading={t('messenger.memberPanel.consensusTitle')} />
        <CardBody>
          <SsmBox meeting={activeMeeting} />
        </CardBody>
      </Card>
    </div>
  );
}
