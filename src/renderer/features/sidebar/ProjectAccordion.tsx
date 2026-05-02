/**
 * ProjectAccordion — R12-C T8 통합 사이드바의 프로젝트 단위 collapsible.
 *
 * 헤더 (📁 프로젝트명 + chevron 펼침/접힘) 클릭 → 펼침 상태 토글 + active
 * project 전환. 펼침 상태에서 자식으로 ProjectAccordionContent 가 mount —
 * 그 시점 useChannels(projectId) 가 fetch 되어 system + 부서 + 자유 채널
 * 을 보여준다. 접힘 상태에서는 아예 mount 안 함 (lazy fetch).
 *
 * 디폴트 = 펼침 (sidebar-store 의 isProjectExpanded).
 *
 * 자식 채널 row 는 ChannelRow 를 재사용 — 동일한 외관 / active 상태 표시.
 */
import { clsx } from 'clsx';
import { useMemo, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { ChannelMeetingControl } from '../messenger/ChannelMeetingControl';
import { ChannelRow } from '../messenger/ChannelRow';
import { useChannels } from '../../hooks/use-channels';
import {
  isProjectExpanded,
  useSidebarStore,
} from '../../stores/sidebar-store';
import { getSkillTemplate } from '../../../shared/skill-catalog';
import type { Channel } from '../../../shared/channel-types';
import type { ActiveMeetingSummary } from '../../../shared/meeting-types';
import type { RoleId } from '../../../shared/role-types';

const SYSTEM_KIND_ORDER: ReadonlyArray<Channel['kind']> = [
  'system_approval',
  'system_minutes',
];

/** RoleId → 사이드바 prefix 이모지. spec §11.2 시안 따름. */
const ROLE_ICON: Record<RoleId, string> = {
  idea: '💡',
  planning: '📋',
  'design.ui': '🎨',
  'design.ux': '🎨',
  'design.character': '🧝',
  'design.background': '🏞️',
  implement: '🔧',
  review: '✅',
  general: '💬',
};

const DEPARTMENT_ROLE_ORDER: ReadonlyArray<RoleId> = [
  'idea',
  'planning',
  'design.ui',
  'design.ux',
  'design.character',
  'design.background',
  'implement',
  'review',
];

export interface ProjectAccordionProps {
  projectId: string;
  projectName: string;
  isActiveProject: boolean;
  activeChannelId: string | null;
  onActivateProject: (projectId: string) => void;
  onSelectChannel: (channel: Channel) => void;
  /**
   * R12-C round 3 — 자유 user 채널 추가. 자유 채널 섹션 끝 "+ 새 채널"
   * 버튼이 발화. App 레벨이 ChannelCreateModal 을 호스팅한다.
   */
  onCreateChannel?: (projectId: string) => void;
  /** 활성 회의 list — 자유 user 채널 row 의 회의 컨트롤 표시. `null` = loading. */
  meetings?: ActiveMeetingSummary[] | null;
  onStartMeeting?: (channel: Channel) => void;
  onAbortMeeting?: (meetingId: string) => Promise<void> | void;
}

export function ProjectAccordion({
  projectId,
  projectName,
  isActiveProject,
  activeChannelId,
  onActivateProject,
  onSelectChannel,
  onCreateChannel,
  meetings,
  onStartMeeting,
  onAbortMeeting,
}: ProjectAccordionProps): ReactElement {
  const { t } = useTranslation();
  const expanded = useSidebarStore((s) => isProjectExpanded(s, projectId));
  const toggle = useSidebarStore((s) => s.toggleProject);

  const handleHeaderClick = (): void => {
    onActivateProject(projectId);
    toggle(projectId);
  };

  return (
    <section
      data-testid={`sidebar-project-${projectId}`}
      data-active-project={isActiveProject ? 'true' : 'false'}
      data-expanded={expanded ? 'true' : 'false'}
      className="flex flex-col"
    >
      <button
        type="button"
        onClick={handleHeaderClick}
        aria-expanded={expanded}
        data-testid={`sidebar-project-header-${projectId}`}
        className={clsx(
          'flex w-full items-center gap-2 rounded-panel px-2.5 py-1.5 text-left text-sm',
          'hover:bg-sunk focus:outline-none focus:ring-1 focus:ring-brand',
          isActiveProject && 'bg-sunk border border-panel-border',
          !isActiveProject && 'border border-transparent',
        )}
      >
        <span aria-hidden="true" className="text-xs text-fg-muted w-3 inline-block">
          {expanded ? '▼' : '▶'}
        </span>
        <span aria-hidden="true" className="text-base">
          {'📁'}
        </span>
        <span className="flex-1 truncate font-medium">{projectName}</span>
      </button>

      {expanded ? (
        <ProjectAccordionContent
          projectId={projectId}
          activeChannelId={activeChannelId}
          onSelectChannel={onSelectChannel}
          onCreateChannel={onCreateChannel}
          meetings={meetings}
          onStartMeeting={onStartMeeting}
          onAbortMeeting={onAbortMeeting}
          loadingLabel={t('messenger.channelRail.loading')}
          errorLabel={t('messenger.channelRail.error')}
          deptHeaderLabel={t('sidebar.project.deptHeader', {
            defaultValue: '부서',
          })}
          systemHeaderLabel={t('sidebar.project.systemHeader', {
            defaultValue: '시스템',
          })}
          freeChannelsHeaderLabel={t('sidebar.project.freeChannelsHeader', {
            defaultValue: '자유 채널',
          })}
          freeChannelsEmptyLabel={t('messenger.channelRail.userEmpty')}
          createChannelLabel={t('messenger.channelRail.createChannel', {
            defaultValue: '새 채널',
          })}
        />
      ) : null}
    </section>
  );
}

interface ProjectAccordionContentProps {
  projectId: string;
  activeChannelId: string | null;
  onSelectChannel: (channel: Channel) => void;
  onCreateChannel?: (projectId: string) => void;
  meetings?: ActiveMeetingSummary[] | null;
  onStartMeeting?: (channel: Channel) => void;
  onAbortMeeting?: (meetingId: string) => Promise<void> | void;
  loadingLabel: string;
  errorLabel: string;
  deptHeaderLabel: string;
  systemHeaderLabel: string;
  freeChannelsHeaderLabel: string;
  freeChannelsEmptyLabel: string;
  createChannelLabel: string;
}

function ProjectAccordionContent({
  projectId,
  activeChannelId,
  onSelectChannel,
  onCreateChannel,
  meetings,
  onStartMeeting,
  onAbortMeeting,
  loadingLabel,
  errorLabel,
  deptHeaderLabel,
  systemHeaderLabel,
  freeChannelsHeaderLabel,
  freeChannelsEmptyLabel,
  createChannelLabel,
}: ProjectAccordionContentProps): ReactElement {
  const { channels, loading, error } = useChannels(projectId);

  const meetingByChannel = useMemo<Map<string, ActiveMeetingSummary> | null>(() => {
    if (meetings === null || meetings === undefined) return null;
    const map = new Map<string, ActiveMeetingSummary>();
    for (const m of meetings) map.set(m.channelId, m);
    return map;
  }, [meetings]);

  const meetingControlReady =
    meetingByChannel !== null &&
    onStartMeeting !== undefined &&
    onAbortMeeting !== undefined;

  const renderFreeChannel = (channel: Channel): ReactElement => {
    const activeMeeting = meetingByChannel?.get(channel.id) ?? null;
    // R12-C: 자유 user 채널만 회의 시작 컨트롤 (부서 채널은 T11 에서 hide).
    const showControl = meetingControlReady;
    const rightSlot = showControl ? (
      <ChannelMeetingControl
        channel={channel}
        activeMeeting={activeMeeting}
        onStartMeeting={onStartMeeting!}
        onAbortMeeting={onAbortMeeting!}
      />
    ) : undefined;
    return (
      <ChannelRow
        key={channel.id}
        channel={channel}
        active={channel.id === activeChannelId}
        onClick={() => onSelectChannel(channel)}
        rightSlot={rightSlot}
      />
    );
  };

  const systemChannels = useMemo<Channel[]>(() => {
    if (channels === null) return [];
    const filtered = channels.filter((c) =>
      (SYSTEM_KIND_ORDER as ReadonlyArray<string>).includes(c.kind),
    );
    // 사이드바 표시 순서 = SYSTEM_KIND_ORDER 그대로
    return filtered.sort(
      (a, b) =>
        SYSTEM_KIND_ORDER.indexOf(a.kind) - SYSTEM_KIND_ORDER.indexOf(b.kind),
    );
  }, [channels]);

  const departmentChannels = useMemo<Channel[]>(() => {
    if (channels === null) return [];
    const dept = channels.filter(
      (c) => c.kind === 'user' && c.role !== null && c.role !== 'general',
    );
    // DEPARTMENT_ROLE_ORDER 순으로 정렬
    return dept.sort((a, b) => {
      const ai = a.role === null ? 999 : DEPARTMENT_ROLE_ORDER.indexOf(a.role);
      const bi = b.role === null ? 999 : DEPARTMENT_ROLE_ORDER.indexOf(b.role);
      return ai - bi;
    });
  }, [channels]);

  const freeUserChannels = useMemo<Channel[]>(() => {
    if (channels === null) return [];
    return channels.filter(
      (c) => c.kind === 'user' && (c.role === null || c.role === 'general'),
    );
  }, [channels]);

  const initialLoading = loading && channels === null;

  if (initialLoading) {
    return (
      <div
        data-testid={`sidebar-project-content-loading-${projectId}`}
        className="px-3 py-1 text-xs text-fg-subtle"
      >
        {loadingLabel}
      </div>
    );
  }

  if (error !== null && channels === null) {
    return (
      <div
        data-testid={`sidebar-project-content-error-${projectId}`}
        role="alert"
        className="px-3 py-1 text-xs text-danger"
      >
        {errorLabel}
      </div>
    );
  }

  return (
    <div className="ml-1 flex flex-col gap-px py-0.5">
      {systemChannels.length > 0 ? (
        <SidebarSubsection
          testid={`sidebar-project-system-${projectId}`}
          title={systemHeaderLabel}
        >
          {systemChannels.map((channel) => (
            <ChannelRow
              key={channel.id}
              channel={channel}
              active={channel.id === activeChannelId}
              onClick={() => onSelectChannel(channel)}
            />
          ))}
        </SidebarSubsection>
      ) : null}

      {departmentChannels.length > 0 ? (
        <SidebarSubsection
          testid={`sidebar-project-dept-${projectId}`}
          title={deptHeaderLabel}
        >
          {departmentChannels.map((channel) => {
            const role = channel.role as RoleId;
            const labelKo = getSkillTemplate(role).label.ko;
            const icon = ROLE_ICON[role] ?? '•';
            return (
              <SidebarRoleRow
                key={channel.id}
                icon={icon}
                label={labelKo}
                channelName={channel.name}
                active={channel.id === activeChannelId}
                onClick={() => onSelectChannel(channel)}
              />
            );
          })}
        </SidebarSubsection>
      ) : null}

      <SidebarSubsection
        testid={`sidebar-project-free-${projectId}`}
        title={freeChannelsHeaderLabel}
      >
        {freeUserChannels.length === 0 ? (
          <p className="px-3 py-0.5 text-xs text-fg-subtle">
            {freeChannelsEmptyLabel}
          </p>
        ) : (
          freeUserChannels.map(renderFreeChannel)
        )}
        {onCreateChannel ? (
          <button
            type="button"
            data-testid={`sidebar-project-create-channel-${projectId}`}
            onClick={() => onCreateChannel(projectId)}
            className="mx-1.5 mt-1 flex items-center gap-1.5 rounded-panel px-2.5 py-1 text-left text-xs text-fg-muted hover:bg-sunk hover:text-fg"
          >
            <span aria-hidden="true">+</span>
            <span>{createChannelLabel}</span>
          </button>
        ) : null}
      </SidebarSubsection>
    </div>
  );
}

interface SidebarSubsectionProps {
  testid: string;
  title: string;
  children: React.ReactNode;
}

function SidebarSubsection({
  testid,
  title,
  children,
}: SidebarSubsectionProps): ReactElement {
  return (
    <div data-testid={testid} className="flex flex-col gap-px">
      <h4 className="px-3 pt-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-fg-subtle">
        {title}
      </h4>
      {children}
    </div>
  );
}

interface SidebarRoleRowProps {
  icon: string;
  label: string;
  channelName: string;
  active: boolean;
  onClick: () => void;
}

function SidebarRoleRow({
  icon,
  label,
  channelName,
  active,
  onClick,
}: SidebarRoleRowProps): ReactElement {
  // 부서 채널 표시 = 아이콘 + 부서 라벨. 사용자가 채널 명을 임의로 변경한
  // 케이스만 보조 표시 (label !== channelName).
  const showName = channelName.trim() !== label;
  return (
    <button
      type="button"
      onClick={onClick}
      data-active={active ? 'true' : 'false'}
      data-testid={`sidebar-dept-row-${label}`}
      className={clsx(
        'flex w-full items-center gap-2 rounded-panel px-2.5 py-1 text-left text-sm',
        'hover:bg-sunk focus:outline-none focus:ring-1 focus:ring-brand',
        active && 'bg-sunk border border-panel-border',
        !active && 'border border-transparent',
      )}
    >
      <span aria-hidden="true" className="text-base w-5 text-center">
        {icon}
      </span>
      <span className="flex-1 truncate">
        <span className="font-medium">{label}</span>
        {showName ? (
          <span className="ml-1 text-xs text-fg-subtle">({channelName})</span>
        ) : null}
      </span>
    </button>
  );
}
