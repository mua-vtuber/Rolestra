/**
 * MessengerPage — R5 메신저 뷰 shell.
 *
 * 3 pane 레이아웃(ChannelRail / Thread / MemberPanel) + Task 10 채널 CRUD
 * 모달 3종(ChannelCreateModal / ChannelRenameDialog / ChannelDeleteConfirm)
 * 호스팅.
 *
 * 모달 소유권은 MessengerPage 에 둔다:
 * - ChannelRail `+ 새 채널` 버튼 → create modal 오픈
 * - Thread 의 ChannelHeader rename / delete 버튼 → 해당 모달을 `targetChannel`
 *   과 함께 오픈 (channelId 만 받아 MessengerPage 가 자체 `useChannels` 인스턴스로
 *   resolve)
 * - CRUD 성공 시 `notifyChannelsChanged()` 를 발화해 ChannelRail/Thread/내부
 *   인스턴스 전원이 refetch 한다(R10 shared cache 이전 단계).
 * - Create 성공 시 새 채널을 active 로 전환, Delete 성공 시 active 였으면 clear.
 *
 * Empty state: active project 가 없으면 3 pane 을 내리고 안내만 보여준다.
 *
 * 디자인 규약:
 * - hex literal 0 — 색/폰트는 전부 token CSS variable 경유.
 * - 3 pane column grid: 좌 16rem fixed / 가운데 1fr / 우 18rem fixed.
 * - `data-testid`: `messenger-page`, `messenger-empty-state`, `messenger-channel-rail`,
 *   `messenger-thread`, `messenger-member-panel`.
 */
import { clsx } from 'clsx';
import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { ChannelRail } from './ChannelRail';
import { MemberPanel } from './MemberPanel';
import { Thread } from './Thread';
import { ChannelCreateModal } from '../channels/ChannelCreateModal';
import { ChannelDeleteConfirm } from '../channels/ChannelDeleteConfirm';
import { ChannelRenameDialog } from '../channels/ChannelRenameDialog';
import { StartMeetingModal } from '../meetings/StartMeetingModal';
import { notifyChannelsChanged } from '../../hooks/channel-invalidation-bus';
import { useActiveMeetings } from '../../hooks/use-active-meetings';
import { useActiveProject } from '../../hooks/use-active-project';
import { useChannels } from '../../hooks/use-channels';
import { useActiveChannelStore } from '../../stores/active-channel-store';
import { invoke } from '../../ipc/invoke';
import type { Channel } from '../../../shared/channel-types';

export interface MessengerPageProps {
  className?: string;
}

export function MessengerPage({ className }: MessengerPageProps): ReactElement {
  const { t } = useTranslation();
  const { activeProjectId } = useActiveProject();

  if (activeProjectId === null) {
    return (
      <div
        data-testid="messenger-page"
        data-empty="true"
        className={clsx('flex items-center justify-center p-6 text-fg-muted', className)}
      >
        <p data-testid="messenger-empty-state" className="text-sm">
          {t('messenger.emptyState.noActiveProject')}
        </p>
      </div>
    );
  }

  return (
    <MessengerPageActive
      key={activeProjectId}
      projectId={activeProjectId}
      className={className}
    />
  );
}

/**
 * projectId 가 확실히 non-null 인 시점부터 동작하는 inner shell. 모달 state
 * 와 `useChannels` host 인스턴스를 소유한다. activeProjectId 가 바뀌면 부모가
 * `key` 로 remount 시켜 modal state 를 함께 리셋한다.
 */
function MessengerPageActive({
  projectId,
  className,
}: {
  projectId: string;
  className?: string;
}): ReactElement {
  const { t } = useTranslation();
  const { channels } = useChannels(projectId);
  const setActiveChannelId = useActiveChannelStore((s) => s.setActiveChannelId);

  // Modal state ────────────────────────────────────────────────
  const [createOpen, setCreateOpen] = useState(false);
  const [renameTargetId, setRenameTargetId] = useState<string | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  // R12: meeting start/abort were promoted from the channel header to
  // the sidebar (per-row controls). The host owns one
  // `useActiveMeetings` instance + the start-meeting modal so abort and
  // start success both refresh the same data source the sidebar reads.
  const [startMeetingChannel, setStartMeetingChannel] = useState<Channel | null>(null);
  const { meetings: activeMeetings, refresh: refreshActiveMeetings } = useActiveMeetings();

  const renameTarget = useMemo<Channel | null>(
    () =>
      renameTargetId === null || channels === null
        ? null
        : channels.find((c) => c.id === renameTargetId) ?? null,
    [renameTargetId, channels],
  );
  const deleteTarget = useMemo<Channel | null>(
    () =>
      deleteTargetId === null || channels === null
        ? null
        : channels.find((c) => c.id === deleteTargetId) ?? null,
    [deleteTargetId, channels],
  );

  // Success callbacks ──────────────────────────────────────────
  // Order matters: refetch FIRST, then flip active. `useActiveChannel`'s
  // validation effect clears the active id when the stored channel is
  // not in the channels list — if we set active before the refetch
  // returns, the stale list still lacks the new channel and the effect
  // wipes our just-applied selection.
  const handleCreated = useCallback(
    (channel: Channel): void => {
      void notifyChannelsChanged().then(() => {
        setActiveChannelId(projectId, channel.id);
      });
    },
    [projectId, setActiveChannelId],
  );
  const handleRenamed = useCallback((): void => {
    setRenameTargetId(null);
    void notifyChannelsChanged();
  }, []);
  const handleDeleted = useCallback(
    (deletedId: string): void => {
      setDeleteTargetId(null);
      // active 였다면 clear — 다음 렌더의 useActiveChannel validation 이
      // 이미 처리하지만, 즉시 반영해서 flash 를 줄인다.
      const state = useActiveChannelStore.getState();
      if (state.channelIdByProject[projectId] === deletedId) {
        setActiveChannelId(projectId, null);
      }
      void notifyChannelsChanged();
    },
    [projectId, setActiveChannelId],
  );

  // Child callbacks ────────────────────────────────────────────
  const handleOpenCreate = useCallback((): void => {
    setCreateOpen(true);
  }, []);
  const handleOpenRename = useCallback((channelId: string): void => {
    setRenameTargetId(channelId);
  }, []);
  const handleOpenDelete = useCallback((channelId: string): void => {
    setDeleteTargetId(channelId);
  }, []);

  // R12 sidebar meeting controls ────────────────────────────────
  const handleRequestStartMeeting = useCallback((channel: Channel): void => {
    setStartMeetingChannel(channel);
  }, []);
  const handleStartMeetingOpenChange = useCallback((open: boolean): void => {
    if (!open) setStartMeetingChannel(null);
  }, []);
  const handleStarted = useCallback((): void => {
    setStartMeetingChannel(null);
    void refreshActiveMeetings();
  }, [refreshActiveMeetings]);
  const handleAbortMeeting = useCallback(
    async (meetingId: string): Promise<void> => {
      try {
        await invoke('meeting:abort', { meetingId });
      } catch (err) {
        console.warn(
          '[MessengerPage] meeting:abort failed',
          err instanceof Error ? err.message : String(err),
        );
      } finally {
        void refreshActiveMeetings();
      }
    },
    [refreshActiveMeetings],
  );

  return (
    <div
      data-testid="messenger-page"
      data-empty="false"
      className={clsx('grid h-full min-h-0', className)}
      style={{
        gridTemplateColumns: '16rem 1fr 18rem',
      }}
    >
      <aside
        data-testid="messenger-channel-rail"
        aria-label={t('messenger.pane.channelRail')}
        className="border-r border-border bg-project-bg min-h-0 overflow-hidden"
      >
        <ChannelRail
          projectId={projectId}
          meetings={activeMeetings}
          onStartMeeting={handleRequestStartMeeting}
          onAbortMeeting={handleAbortMeeting}
          onCreateChannel={handleOpenCreate}
        />
      </aside>

      <main
        data-testid="messenger-thread"
        aria-label={t('messenger.pane.thread')}
        className="flex flex-col min-h-0 bg-canvas"
      >
        <Thread
          projectId={projectId}
          onRenameChannel={handleOpenRename}
          onDeleteChannel={handleOpenDelete}
        />
      </main>

      <aside
        data-testid="messenger-member-panel"
        aria-label={t('messenger.pane.memberPanel')}
        className="border-l border-border bg-panel-bg min-h-0 overflow-y-auto"
      >
        <MemberPanel projectId={projectId} />
      </aside>

      <ChannelCreateModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        projectId={projectId}
        onCreated={handleCreated}
      />
      <ChannelRenameDialog
        open={renameTargetId !== null}
        onOpenChange={(next) => {
          if (!next) setRenameTargetId(null);
        }}
        channel={renameTarget}
        onRenamed={handleRenamed}
      />
      <ChannelDeleteConfirm
        open={deleteTargetId !== null}
        onOpenChange={(next) => {
          if (!next) setDeleteTargetId(null);
        }}
        channel={deleteTarget}
        onDeleted={handleDeleted}
      />
      <StartMeetingModal
        open={startMeetingChannel !== null}
        onOpenChange={handleStartMeetingOpenChange}
        channelId={startMeetingChannel?.id ?? null}
        channelName={startMeetingChannel?.name ?? null}
        onStarted={handleStarted}
      />
    </div>
  );
}
