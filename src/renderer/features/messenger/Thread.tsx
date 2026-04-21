/**
 * Thread — 중앙 메시지 pane shell (R5-Task5).
 *
 * 이 컴포넌트는 레이아웃 + 헤더만 담당한다. 실제 메시지 버블(Task 6),
 * MeetingBanner(Task 7), Composer(Task 8) 는 후속 태스크에서 해당 섹션에
 * 치환된다.
 *
 * 데이터 소스:
 * - `useChannels(projectId)` — active channel 메타(name, kind, readOnly) 조회용.
 *   ChannelRail 과 별개로 hook 인스턴스를 만들지만 strict-mode single-fetch guard
 *   가 있어 각 인스턴스가 각자 1회만 IPC 호출한다. R10 에서 shared cache 로 통합.
 * - `useActiveChannel(projectId, channels)` — 현재 activeChannelId.
 * - `useChannelMembers(channelId, channels)` — 참여자 수 집계.
 * - `useActiveMeetings()` — 이 채널의 진행 중 회의 수를 필터로 구해 헤더 버튼
 *   disabled 여부 결정. 전역 리스트지만 cheap IPC 이므로 R5 범위에서는 허용.
 *
 * activeChannelId null / 해당 채널이 리스트에 없으면 empty state 1줄로 대체.
 * hex literal 금지.
 */
import { clsx } from 'clsx';
import { useMemo, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { ChannelHeader } from './ChannelHeader';
import { useActiveChannel } from '../../hooks/use-active-channel';
import { useActiveMeetings } from '../../hooks/use-active-meetings';
import { useChannelMembers } from '../../hooks/use-channel-members';
import { useChannelMessages } from '../../hooks/use-channel-messages';
import { useChannels } from '../../hooks/use-channels';

export interface ThreadProps {
  projectId: string;
  /** Task 7: StartMeetingModal 오픈 핸들러. 없으면 버튼 disabled. */
  onStartMeeting?: (channelId: string) => void;
  /** Task 10: Rename modal 오픈 핸들러. */
  onRenameChannel?: (channelId: string) => void;
  /** Task 10: Delete confirm 오픈 핸들러. */
  onDeleteChannel?: (channelId: string) => void;
  className?: string;
}

export function Thread({
  projectId,
  onStartMeeting,
  onRenameChannel,
  onDeleteChannel,
  className,
}: ThreadProps): ReactElement {
  const { t } = useTranslation();
  const { channels } = useChannels(projectId);
  const { activeChannelId } = useActiveChannel(projectId, channels);
  const { members } = useChannelMembers(activeChannelId, channels);
  const { meetings } = useActiveMeetings();
  // activeChannelId 가 있을 때만 messages 를 구독. null 이면 idle.
  const { messages } = useChannelMessages(activeChannelId);

  const activeChannel = useMemo(() => {
    if (activeChannelId === null) return null;
    if (channels === null) return null;
    return channels.find((c) => c.id === activeChannelId) ?? null;
  }, [activeChannelId, channels]);

  const activeMeetingCount = useMemo(() => {
    if (activeChannelId === null) return 0;
    if (meetings === null) return 0;
    return meetings.filter((m) => m.channelId === activeChannelId).length;
  }, [activeChannelId, meetings]);

  const memberCount = members === null ? null : members.length;

  if (activeChannel === null) {
    return (
      <div
        data-testid="thread"
        data-empty="true"
        className={clsx('flex h-full items-center justify-center p-6', className)}
      >
        <p
          data-testid="thread-empty-state"
          className="text-sm text-fg-muted"
        >
          {t('messenger.emptyState.noActiveChannel')}
        </p>
      </div>
    );
  }

  const handleStartMeeting =
    onStartMeeting === undefined
      ? undefined
      : (): void => onStartMeeting(activeChannel.id);
  const handleRename =
    onRenameChannel === undefined
      ? undefined
      : (): void => onRenameChannel(activeChannel.id);
  const handleDelete =
    onDeleteChannel === undefined
      ? undefined
      : (): void => onDeleteChannel(activeChannel.id);

  return (
    <div
      data-testid="thread"
      data-empty="false"
      data-channel-id={activeChannel.id}
      className={clsx('flex h-full min-h-0 flex-col', className)}
    >
      <ChannelHeader
        channel={activeChannel}
        memberCount={memberCount}
        activeMeetingCount={activeMeetingCount}
        onStartMeeting={handleStartMeeting}
        onRename={handleRename}
        onDelete={handleDelete}
      />

      {/* Task 7: <MeetingBanner meeting={...} /> — activeMeetingCount > 0 시 상단 고정 */}

      <div
        data-testid="thread-message-list"
        data-message-count={messages === null ? 'null' : String(messages.length)}
        className="flex-1 min-h-0 overflow-y-auto px-4 py-3 text-xs text-fg-subtle"
      >
        {/* Task 6: messages 를 Message/SystemMessage/ApprovalBlock 으로 분기 렌더. */}
        {t('messenger.thread.messageListPlaceholder')}
      </div>

      <div
        data-testid="thread-composer-slot"
        className="border-t border-topbar-border bg-elev px-4 py-3 text-xs text-fg-subtle"
      >
        {/* Task 8: <Composer channelId={activeChannel.id} readOnly={activeChannel.readOnly} /> */}
        {t('messenger.thread.composerPlaceholder')}
      </div>
    </div>
  );
}
