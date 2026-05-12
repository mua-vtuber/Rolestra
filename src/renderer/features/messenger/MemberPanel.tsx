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
import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { Card, CardHeader, CardBody } from '../../components/primitives';
import { Button } from '../../components/primitives/button';
import { ChannelMemberPicker } from './ChannelMemberPicker';
import { MemberRow } from './MemberRow';
import { SsmBox } from './SsmBox/index';
import { notifyChannelsChanged } from '../../hooks/channel-invalidation-bus';
import { useActiveChannel } from '../../hooks/use-active-channel';
import { useChannelMembers } from '../../hooks/use-channel-members';
import { useChannels } from '../../hooks/use-channels';
import { useDms } from '../../hooks/use-dms';
import { useGlobalGeneralChannel } from '../../hooks/use-global-general-channel';
import { invoke } from '../../ipc/invoke';
import { notifyError } from '../../components/ErrorBoundary';

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

  // 현재 active 채널 객체 — kind 분기 (DM / 일반 / system / user) 에 사용.
  const activeChannel = useMemo(() => {
    if (activeChannelId === null || allChannels === null) return null;
    return allChannels.find((c) => c.id === activeChannelId) ?? null;
  }, [activeChannelId, allChannels]);

  // 멤버 추가/제거 가능 채널: DM 도 아니고 전역 일반 채널 도 아닐 때.
  // DM = 1:1 고정, 일반 = ProviderRegistry 자동 합성 — 둘 다 수동 변경 의미 X.
  const editable =
    activeChannel !== null &&
    activeChannel.kind !== 'dm' &&
    !isGeneralChannel;

  const [pickerOpen, setPickerOpen] = useState(false);

  const handleRemoveMember = useCallback(
    (providerId: string): void => {
      if (activeChannelId === null) return;
      void (async (): Promise<void> => {
        try {
          await invoke('channel:remove-members', {
            id: activeChannelId,
            providerIds: [providerId],
          });
          await notifyChannelsChanged();
        } catch (reason) {
          const message =
            reason instanceof Error ? reason.message : String(reason);
          notifyError(message);
        }
      })();
    },
    [activeChannelId],
  );

  // R12-C2 T18 — SsmBox 가 자체적으로 `useActiveMeetings` 를 호출해 meeting
  // resolve 를 한다. MemberPanel 은 channelId 만 넘기므로 본 컴포넌트 안에서
  // activeMeeting 을 계산할 필요가 없어졌다. 일반 채널 (#일반) 분기는
  // 아래 `!isGeneralChannel` gate 가 카드 자체를 hide 하므로 이전 R12-C2
  // P1.5 의 "잔존 active meeting row 무시" 가드는 SsmBox 호출 진입 자체가
  // 안 되어 자연스럽게 만족된다.

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
          <MemberRow
            key={member.providerId}
            member={member}
            onRemove={editable ? handleRemoveMember : undefined}
          />
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
          action={
            editable ? (
              <Button
                type="button"
                tone="ghost"
                size="sm"
                data-testid="member-panel-add-member"
                aria-label={t('messenger.memberPanel.addMember', {
                  defaultValue: '직원 추가',
                })}
                onClick={() => setPickerOpen(true)}
              >
                {t('messenger.memberPanel.addMember', {
                  defaultValue: '+ 추가',
                })}
              </Button>
            ) : undefined
          }
        />
        <CardBody>{participantsBody}</CardBody>
      </Card>

      {/* R12-C2 P1.5 follow-up — 일반 채널 (전역 system_general) 은 합의
          상태 카드 hide. *가벼운 동의/반대 카운터* + `[##본문]` 카드는 P4
          본격 흐름 land 시점에 등장하며, 그 사이에는 surface 정의가
          없으므로 카드 자체를 렌더하지 않는다 (R12-C round 4 시점에는
          panel 통째 안내 문구로 대체됐지만, 사용자 dogfooding 결과 멤버
          목록 노출 요청으로 *참여자 카드는 유지 + 합의 카드만 hide* 로
          전환). */}
      {!isGeneralChannel && (
        <Card data-testid="member-panel-consensus" className="flex flex-col">
          <CardHeader heading={t('messenger.memberPanel.consensusTitle')} />
          <CardBody>
            <SsmBox channelId={activeChannelId} />
          </CardBody>
        </Card>
      )}

      {editable && activeChannelId !== null && (
        <ChannelMemberPicker
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          channelId={activeChannelId}
          currentProviderIds={(members ?? []).map((m) => m.providerId)}
        />
      )}
    </div>
  );
}
