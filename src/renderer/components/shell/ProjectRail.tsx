import { clsx } from 'clsx';
import { useTranslation } from 'react-i18next';

import { LineIcon, type IconName } from './LineIcon';
import { ProfileAvatar, type MemberLike } from './ProfileAvatar';

export interface ProjectRailProject {
  id: string;
  name: string;
  icon?: IconName;
  unread?: number;
}

export interface ProjectRailDm {
  id: string;
  member: MemberLike;
  unread?: number;
}

export interface ProjectRailProps {
  projects: ReadonlyArray<ProjectRailProject>;
  dms?: ReadonlyArray<ProjectRailDm>;
  activeProjectId?: string;
  onSelectProject?: (id: string) => void;
  onSelectDm?: (id: string) => void;
  /**
   * When provided, renders a "+ 새 프로젝트" entry at the top of the
   * PROJECTS section. Clicking it invokes this callback. The visual
   * treatment is intentionally distinct from project rows — a dashed
   * border + ghost tone — so the "add" affordance reads as an action
   * rather than a selectable project. Position: immediately under the
   * PROJECTS header, before the first project row (R4-Task10).
   */
  onCreateProject?: () => void;
  className?: string;
}

export function ProjectRail({
  projects,
  dms = [],
  activeProjectId,
  onSelectProject,
  onSelectDm,
  onCreateProject,
  className,
}: ProjectRailProps) {
  const { t } = useTranslation();
  return (
    <aside
      aria-label={t('shell.rail.ariaLabel', 'project rail')}
      data-testid="project-rail"
      className={clsx(
        'flex flex-col gap-1 w-60 shrink-0 px-3 py-4 bg-project-bg border-r border-border',
        className
      )}
    >
      <div className="px-2.5 pb-1.5 pt-0 text-[10px] font-bold tracking-wider uppercase text-fg-subtle font-mono">
        {t('shell.rail.projects', 'Projects')}
      </div>
      {onCreateProject && (
        <button
          type="button"
          onClick={onCreateProject}
          data-role="create-project"
          data-testid="project-rail-create"
          className={clsx(
            'flex items-center gap-2 px-2.5 py-2 text-left text-xs rounded-panel',
            'border border-dashed border-border text-fg-muted',
            'transition-colors hover:bg-project-item-active-bg/40 hover:text-fg'
          )}
        >
          <span className="text-icon-fg">
            <LineIcon name="plus" stroke={1.5} />
          </span>
          <span className="flex-1 truncate font-medium">
            {t('shell.rail.newProject', '+ 새 프로젝트')}
          </span>
        </button>
      )}
      {projects.map((project) => {
        const isActive = project.id === activeProjectId;
        return (
          <button
            key={project.id}
            type="button"
            onClick={onSelectProject ? () => onSelectProject(project.id) : undefined}
            aria-current={isActive ? 'page' : undefined}
            data-active={isActive || undefined}
            className={clsx(
              'flex items-center gap-2 px-2.5 py-2 text-left text-xs rounded-panel',
              'border border-transparent transition-colors',
              isActive
                ? 'bg-project-item-active-bg text-project-item-active-fg border-border-soft'
                : 'text-fg hover:bg-project-item-active-bg/40'
            )}
          >
            <span className="text-icon-fg">
              <LineIcon name={project.icon ?? 'folder'} stroke={1.5} />
            </span>
            <span className="flex-1 truncate font-medium">{project.name}</span>
            {project.unread && project.unread > 0 ? (
              <span className="min-w-[18px] h-[18px] px-1.5 text-[10px] font-bold font-mono flex items-center justify-center rounded-full bg-unread-bg text-unread-fg">
                {project.unread}
              </span>
            ) : null}
          </button>
        );
      })}

      {dms.length > 0 && (
        <>
          <div className="px-2.5 pb-1.5 pt-3 text-[10px] font-bold tracking-wider uppercase text-fg-subtle font-mono">
            {t('shell.rail.direct', 'Direct')}
          </div>
          {dms.map((dm) => (
            <button
              key={dm.id}
              type="button"
              onClick={onSelectDm ? () => onSelectDm(dm.id) : undefined}
              className="flex items-center gap-2 px-2.5 py-1.5 text-left text-xs text-fg-muted rounded-panel hover:bg-project-item-active-bg/30"
            >
              <ProfileAvatar member={dm.member} size={22} />
              <span className="flex-1 truncate">{dm.member.name}</span>
              {dm.unread && dm.unread > 0 ? (
                <span className="min-w-[18px] h-[18px] px-1.5 text-[10px] font-bold font-mono flex items-center justify-center rounded-full bg-unread-bg text-unread-fg">
                  {dm.unread}
                </span>
              ) : null}
            </button>
          ))}
        </>
      )}
    </aside>
  );
}
