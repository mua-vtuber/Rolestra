/**
 * MessengerPage — R12-C T8 통합 사이드바 land 후 2 pane 메신저.
 *
 * R5~R11 까지는 3 pane (ChannelRail / Thread / MemberPanel) 이었으나
 * R12-C T8 에서 좌측 사이드바 (general / projects accordion / DM) 가
 * Shell rail 자리로 승격되어 ChannelRail 의 채널 list 역할을 흡수했다.
 * 따라서 이 페이지는 Thread + MemberPanel 두 컬럼만 호스팅한다.
 *
 * 모달 소유권은 그대로 MessengerPage 에 둔다:
 * - ChannelHeader 의 rename / delete 버튼 → 해당 모달을 `targetChannel`
 *   과 함께 오픈 (channelId 만 받아 MessengerPage 가 자체 `useChannels` 인스턴스로
 *   resolve).
 * - StartMeetingModal — 사이드바의 "회의 시작" 컨트롤이 R12-C T9~T11 에서
 *   채널 종류별 disabled 분기와 함께 정리되기 전까지는 ChannelHeader 도
 *   여전히 회의 컨트롤을 들고 있을 수 있다.
 * - CRUD 성공 시 `notifyChannelsChanged()` — Sidebar / Thread / MemberPanel
 *   전원이 refetch.
 *
 * Empty state: active project 가 없으면 안내만 보여준다.
 *
 * 디자인 규약:
 * - hex literal 0.
 * - 2 pane column grid: 가운데 1fr / 우 18rem fixed.
 * - `data-testid`: `messenger-page`, `messenger-empty-state`,
 *   `messenger-thread`, `messenger-member-panel`.
 */
import { clsx } from 'clsx';
import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { MemberPanel } from './MemberPanel';
import { Thread } from './Thread';
import { ChannelDeleteConfirm } from '../channels/ChannelDeleteConfirm';
import { ChannelRenameDialog } from '../channels/ChannelRenameDialog';
import { notifyChannelsChanged } from '../../hooks/channel-invalidation-bus';
import { useActiveProject } from '../../hooks/use-active-project';
import { useChannels } from '../../hooks/use-channels';
import { useDms } from '../../hooks/use-dms';
import { useActiveChannelStore } from '../../stores/active-channel-store';
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
  const { dms } = useDms();
  const setActiveChannelId = useActiveChannelStore((s) => s.setActiveChannelId);

  // Merge project channels + DMs so rename / delete modals can resolve
  // DM targets too. DMs have `projectId === null` and never appear in
  // `useChannels`; without this merge the delete confirm sees
  // `deleteTarget === null` and the submit button stays disabled
  // (dogfooding 2026-05-01 #2 — "DM 삭제 모달의 삭제 버튼 활성화 안 됨").
  const allChannels = useMemo<Channel[] | null>(() => {
    if (channels === null && dms === null) return null;
    return [...(channels ?? []), ...(dms ?? [])];
  }, [channels, dms]);

  // Modal state ────────────────────────────────────────────────
  // R12-C T8: 회의 시작/중단 컨트롤은 App 레벨 Sidebar host 로 승격되어
  // MessengerPage 는 채널 CRUD 모달만 든다.
  // R12-C round 3: ChannelCreateModal 도 App.tsx 로 hoist (사이드바
  // "+ 새 채널" 버튼이 직접 트리거). MessengerPage 는 rename / delete
  // 모달만 유지.
  const [renameTargetId, setRenameTargetId] = useState<string | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);

  const renameTarget = useMemo<Channel | null>(
    () =>
      renameTargetId === null || allChannels === null
        ? null
        : allChannels.find((c) => c.id === renameTargetId) ?? null,
    [renameTargetId, allChannels],
  );
  const deleteTarget = useMemo<Channel | null>(
    () =>
      deleteTargetId === null || allChannels === null
        ? null
        : allChannels.find((c) => c.id === deleteTargetId) ?? null,
    [deleteTargetId, allChannels],
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
  const handleOpenRename = useCallback((channelId: string): void => {
    setRenameTargetId(channelId);
  }, []);
  const handleOpenDelete = useCallback((channelId: string): void => {
    setDeleteTargetId(channelId);
  }, []);
  // R12-C: ChannelCreateModal 트리거가 사이드바 "+ 새 채널" 로 이전되면
  // setCreateOpen 트리거가 사라진다. T8 단계에서는 사이드바 "+ 새 프로젝트"
  // 만 land — 채널 create 는 자유 user 채널 흐름이라 T9~T11 까지는 hide.
  // 모달은 살려두되 create 트리거만 미배치.

  return (
    <div
      data-testid="messenger-page"
      data-empty="false"
      className={clsx('grid h-full min-h-0', className)}
      style={{
        gridTemplateColumns: '1fr 18rem',
      }}
    >
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

      {/*
        R12-C round 3 (#2): ChannelCreateModal 은 App.tsx 로 hoist —
        Sidebar 의 "+ 새 채널" 트리거가 직접 연다. MessengerPage 는
        rename / delete 모달만 들고 있다.
      */}
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
    </div>
  );
}
