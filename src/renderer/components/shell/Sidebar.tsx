/**
 * Sidebar — R12-C T8 통합 사이드바.
 *
 * spec §11.2 시안:
 * ```
 * 💬 일반 채널 (전역)         ← 단일, 회의 X
 * ─────
 * 📁 프로젝트 A  [▼ 펼침]
 *   ├ 시스템 (#승인-대기 / #회의록)
 *   ├ 부서: 💡아이디어 / 📋기획 / 🎨디자인 / 🔧구현 / ✅검토
 *   └ 자유 채널
 * 📁 프로젝트 B  [▶ 접힘]
 * ─────
 * 💬 DM (전역)
 * ```
 *
 * 이 컴포넌트는 ProjectRail (이전 좁은 좌측 strip) + DmListView (그 아래 DM)
 * + MessengerPage 안의 ChannelRail (해당 프로젝트 채널 list) 의 3 가지를
 * 단일 사이드바로 통합한다 (사용자 요청 — collapsible 사이드바).
 *
 * 채널 클릭 시 콜백:
 * 1. active project 갱신 (project A 의 부서 채널 클릭 시 active = A)
 * 2. active channel 갱신 (해당 channel id)
 * 3. messenger view 로 전환 (App.tsx)
 *
 * 일반 채널 / DM 은 projectId === null (전역). 클릭 시 active project 는
 * 그대로 두고 active channel 만 전환한다.
 */
import { clsx } from 'clsx';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { ProjectAccordion } from '../../features/sidebar/ProjectAccordion';
import { GeneralChannelEntry } from '../../features/sidebar/GeneralChannelEntry';
import { DmListView } from '../../features/dms/DmListView';
import type { Channel } from '../../../shared/channel-types';
import type { ActiveMeetingSummary } from '../../../shared/meeting-types';
import type { Project } from '../../../shared/project-types';

export interface SidebarProps {
  projects: ReadonlyArray<Project>;
  activeProjectId: string | null;
  activeChannelId: string | null;
  onActivateProject: (projectId: string) => void;
  onSelectChannel: (channel: Channel) => void;
  /** 일반 채널 row 클릭 — projectId 는 null. */
  onSelectGeneralChannel: (channel: {
    id: string;
    name: string;
    projectId: string | null;
  }) => void;
  /** DM 채널 클릭 — DmListView 가 channelId 만 들고 있어 별도 핸들러. */
  onSelectDm: (channelId: string) => void;
  onCreateProject?: () => void;
  /**
   * R12-C round 3 — 자유 user 채널 추가. 사용자가 ProjectAccordion 의
   * 자유 채널 섹션 끝 "+ 새 채널" 버튼을 클릭하면 그 프로젝트 ID 를
   * 인자로 전달. App.tsx 가 ChannelCreateModal 을 그 projectId 로 연다.
   */
  onCreateChannel?: (projectId: string) => void;
  /**
   * 활성 회의 list. ProjectAccordion 의 자유 user 채널 row 가 회의
   * 시작/중단 컨트롤을 표시할 때 참조. `null` 은 loading.
   */
  meetings?: ActiveMeetingSummary[] | null;
  onStartMeeting?: (channel: Channel) => void;
  onAbortMeeting?: (meetingId: string) => Promise<void> | void;
  className?: string;
}

export function Sidebar({
  projects,
  activeProjectId,
  activeChannelId,
  onActivateProject,
  onSelectChannel,
  onSelectGeneralChannel,
  onSelectDm,
  onCreateProject,
  onCreateChannel,
  meetings,
  onStartMeeting,
  onAbortMeeting,
  className,
}: SidebarProps): ReactElement {
  const { t } = useTranslation();

  return (
    <aside
      data-testid="sidebar"
      aria-label={t('sidebar.aria', { defaultValue: '사이드바' })}
      className={clsx(
        'flex h-full w-60 shrink-0 flex-col bg-project-bg border-r border-border',
        className,
      )}
    >
      {/* 일반 채널 (전역) */}
      <section
        data-testid="sidebar-section-general"
        className="flex flex-col gap-px px-2 pt-3 pb-1"
      >
        <h3 className="px-2.5 pb-1 text-[10px] font-bold uppercase tracking-[0.1em] text-fg-subtle">
          {t('sidebar.general.header', { defaultValue: '일반' })}
        </h3>
        <GeneralChannelEntry
          activeChannelId={activeChannelId}
          onSelectChannel={onSelectGeneralChannel}
        />
      </section>

      <div className="border-t border-border-soft mx-2" />

      {/* 프로젝트 accordion */}
      <section
        data-testid="sidebar-section-projects"
        className="flex-1 min-h-0 overflow-y-auto px-2 py-2"
      >
        <div className="flex items-center justify-between px-2 pb-1">
          <h3 className="text-[10px] font-bold uppercase tracking-[0.1em] text-fg-subtle">
            {t('sidebar.projects.header', { defaultValue: '프로젝트' })}
          </h3>
          {onCreateProject ? (
            <button
              type="button"
              onClick={onCreateProject}
              data-testid="sidebar-create-project"
              aria-label={t('sidebar.projects.create', {
                defaultValue: '새 프로젝트',
              })}
              className="text-xs text-fg-muted hover:text-fg focus:outline-none focus:ring-1 focus:ring-brand rounded-panel px-1"
            >
              {'+'}
            </button>
          ) : null}
        </div>

        {projects.length === 0 ? (
          <p
            data-testid="sidebar-projects-empty"
            className="px-3 py-2 text-xs text-fg-subtle"
          >
            {t('sidebar.projects.empty', {
              defaultValue: '프로젝트가 없습니다',
            })}
          </p>
        ) : (
          <div className="flex flex-col gap-0.5">
            {projects.map((project) => (
              <ProjectAccordion
                key={project.id}
                projectId={project.id}
                projectName={project.name}
                isActiveProject={project.id === activeProjectId}
                activeChannelId={activeChannelId}
                onActivateProject={onActivateProject}
                onSelectChannel={onSelectChannel}
                onCreateChannel={onCreateChannel}
                meetings={meetings}
                onStartMeeting={onStartMeeting}
                onAbortMeeting={onAbortMeeting}
              />
            ))}
          </div>
        )}
      </section>

      <div className="border-t border-border-soft mx-2" />

      {/* DM (전역, 제일 아래) */}
      <DmListView
        activeChannelId={activeChannelId}
        onSelectDm={onSelectDm}
        className="bg-project-bg"
      />
    </aside>
  );
}
