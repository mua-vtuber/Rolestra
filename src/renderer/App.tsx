import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import './i18n';
import { NavRail, ProjectRail, Shell, ShellTopBar } from './components/shell';
import type { NavRailItem, ProjectRailProject } from './components/shell';
import { DevThemeSwitcher } from './components/shell/theme-switcher';
import { DashboardPage } from './features/dashboard/DashboardPage';
import { MessengerPage } from './features/messenger/MessengerPage';
import { DmListView } from './features/dms/DmListView';
import { OnboardingPage } from './features/onboarding/OnboardingPage';
import { AutonomyModeToggle } from './features/projects/AutonomyModeToggle';
import { ProjectCreateModal } from './features/projects/ProjectCreateModal';
import { QueuePanel } from './features/projects/QueuePanel';
import { MessageSearchView } from './features/search/MessageSearchView';
import { SettingsView } from './features/settings/SettingsView';
import { useActiveProject } from './hooks/use-active-project';
import { useProjects } from './hooks/use-projects';
import { useAppViewStore, type AppView } from './stores/app-view-store';
import { useActiveChannelStore } from './stores/active-channel-store';
import { invoke } from './ipc/invoke';
import type { Project, ProjectKind } from '../shared/project-types';

/**
 * 현재 마운트할 최상위 뷰. R5에서는 dashboard ↔ messenger 2개만 실제 페이지가
 * 달려 있었고 approval/queue는 아직 dashboard fallback. R9-Task4 에서
 * settings 가 NotificationPrefsView 를 갖춘 실제 뷰로 올라왔다.
 * `AppView` 유니온 정의는 `stores/app-view-store.ts` 로 이동했다(R7-Task10).
 */
const ROUTED_VIEWS: ReadonlyArray<AppView> = [
  'dashboard',
  'messenger',
  'settings',
  'onboarding',
];

const NAV_ITEMS: ReadonlyArray<NavRailItem> = [
  { id: 'dashboard', icon: 'dashboard', label: 'Dashboard' },
  { id: 'messenger', icon: 'chat', label: 'Messenger' },
  { id: 'approval', icon: 'bell', label: 'Approval' },
  { id: 'queue', icon: 'queue', label: 'Queue' },
  { id: 'settings', icon: 'settings', label: 'Settings' },
];

/**
 * Map a full `Project` row to the rail-friendly projection. We keep only
 * what `ProjectRail` consumes so the rail never depends on schema-level
 * fields (status, autonomyMode, etc.) that are irrelevant to navigation.
 * Icon defaults to `folder`; R5+ may add per-kind or per-theme icons.
 */
function toRailProject(project: Project): ProjectRailProject {
  return { id: project.id, name: project.name, icon: 'folder' };
}

export function App() {
  const { t } = useTranslation();
  const { projects, createNew } = useProjects();
  const { activeProjectId, setActive } = useActiveProject();
  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [searchOpen, setSearchOpen] = useState<boolean>(false);
  const view = useAppViewStore((s) => s.view);
  const setView = useAppViewStore((s) => s.setView);

  // R11-Task6: first-boot auto-enter into the onboarding wizard. We
  // probe `onboarding:get-state` once on mount; if the persisted row
  // says `completed=false` we switch view='onboarding'. Subsequent
  // boots (after `onboarding:complete`) skip this branch entirely so a
  // returning user lands on the dashboard. The probe runs after the
  // bridge is available — vitest jsdom env without preload simply
  // resolves nothing and we stay on the default view.
  useEffect(() => {
    const arena = (window as unknown as { arena?: unknown }).arena;
    if (!arena) return;
    void (async () => {
      try {
        const { state } = await invoke('onboarding:get-state', undefined);
        if (!state.completed) {
          setView('onboarding');
        }
      } catch (reason) {
        console.warn(
          '[rolestra] onboarding:get-state failed',
          reason instanceof Error ? reason.message : String(reason),
        );
      }
    })();
    // setView is stable from zustand; deliberately mounted-once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const activeChannelMap = useActiveChannelStore((s) => s.channelIdByProject);
  const setActiveChannelIdStore = useActiveChannelStore(
    (s) => s.setActiveChannelId,
  );
  const activeChannelId: string | null =
    activeProjectId === null ? null : activeChannelMap[activeProjectId] ?? null;

  const handleNavSelect = useCallback(
    (id: string): void => {
      // NavRail 은 라우팅되지 않은 섹션(approval/queue/settings)도 클릭할 수
      // 있지만 R5 는 dashboard/messenger 만 실제 뷰가 존재한다. 나머지는 무시해
      // 현재 view 를 유지.
      if ((ROUTED_VIEWS as readonly string[]).includes(id)) {
        setView(id as AppView);
      }
    },
    [setView],
  );

  const railProjects = useMemo(
    () => projects.map(toRailProject),
    [projects],
  );

  // Resolve the active project (name + autonomyMode) from the already-loaded
  // `projects` array. We never trigger a second IPC to fetch the full
  // object — `useActiveProject` stores only the id on purpose.
  const activeProject: Project | null = useMemo(() => {
    if (!activeProjectId) return null;
    return projects.find((p) => p.id === activeProjectId) ?? null;
  }, [activeProjectId, projects]);
  const activeProjectName: string | null = activeProject?.name ?? null;

  const handleSelectProject = useCallback(
    (id: string): void => {
      // `setActive` calls `project:open` THEN updates the store.
      // A rejection here means the Main side refused the open (folder
      // missing, permission error, …). We keep the current active
      // project untouched and log — R4 does not render a toast; a
      // future iteration can add inline error UX.
      void setActive(id).catch((reason: unknown) => {
        console.warn('[rolestra] project:open failed', reason);
      });
    },
    [setActive],
  );

  const handleCreateProject = useCallback((): void => {
    setModalOpen(true);
  }, []);

  // R10-Task2: Cmd/Ctrl+K 로 검색 모달 열기. activeProjectId 가 없으면
  // (대시보드 비어있는 상태) 단축키는 여전히 모달을 열되, 입력이 disabled
  // 상태로 렌더된다 — 사용자가 "왜 작동 안 하지?"로 혼동하지 않도록
  // scope label 이 "활성 프로젝트 없음" 을 표시.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const handleSearchNavigate = useCallback(
    (channelId: string, _messageId: string): void => {
      // 채널 전환 후 messenger 뷰로. messageId deep-link 는 R11+ (scrollToMessage).
      if (activeProjectId !== null) {
        setActiveChannelIdStore(activeProjectId, channelId);
      }
      setView('messenger');
    },
    [activeProjectId, setActiveChannelIdStore, setView],
  );

  // activeChannel 이름은 messenger 내부에서 가져오므로 여기서는 id 만 넘김.
  const activeChannelName: string | null = null;

  const handleProjectCreated = useCallback(
    (project: Project): void => {
      // Drop the user straight into the freshly-created project so the
      // dashboard + rail reflect it immediately. Same error policy as
      // `handleSelectProject` — log and keep current state on failure.
      void setActive(project.id).catch((reason: unknown) => {
        console.warn('[rolestra] project:open failed after create', reason);
      });
    },
    [setActive],
  );

  // R11-Task6: step-5 finish hook — wires the wizard's first-project
  // input into the live `project:create` flow. We delegate to
  // `useProjects().createNew` so the project list refreshes and the
  // active-project store can pick up the new id. Failure logs and
  // continues — the dashboard still renders, the user can retry via
  // `ProjectCreateModal`.
  const handleOnboardingComplete = useCallback(
    (input: { kind: ProjectKind; slug: string }): void => {
      // Wizard only auto-creates for `kind='new'` because `external` /
      // `imported` need a folder picker that the wizard does not host.
      // For those kinds the user lands on the dashboard with the
      // `ProjectCreateModal` ready — same UX as before R11-Task6.
      if (input.kind !== 'new') return;
      void (async () => {
        try {
          const project = await createNew({
            kind: 'new',
            name: input.slug,
            permissionMode: 'hybrid',
          });
          void setActive(project.id);
        } catch (reason) {
          console.warn(
            '[rolestra] onboarding first-project create failed',
            reason instanceof Error ? reason.message : String(reason),
          );
        }
      })();
    },
    [createNew, setActive],
  );

  // Onboarding 은 NavRail / ProjectRail / ShellTopBar 가 없는 pre-office
  // shell — Shell wrapper 자체를 우회하고 OnboardingPage 만 fullscreen
  // 으로 마운트한다. exit 시 dashboard 로 복귀.
  if (view === 'onboarding') {
    return (
      <OnboardingPage
        onExit={() => setView('dashboard')}
        onCompleteWithProject={handleOnboardingComplete}
      />
    );
  }

  return (
    <Shell
      nav={
        <NavRail
          items={NAV_ITEMS}
          activeId={view}
          onSelect={handleNavSelect}
        />
      }
      rail={
        <div className="flex h-full flex-col shrink-0">
          <div className="flex-1 min-h-0 overflow-y-auto">
            <ProjectRail
              projects={railProjects}
              activeProjectId={activeProjectId ?? undefined}
              onSelectProject={handleSelectProject}
              onCreateProject={handleCreateProject}
              className="h-full border-r-0"
            />
          </div>
          <DmListView
            activeChannelId={activeChannelId}
            onSelectDm={(channelId) => {
              if (activeProjectId !== null) {
                setActiveChannelIdStore(activeProjectId, channelId);
              }
              setView('messenger');
            }}
            className="bg-project-bg border-r border-border"
          />
        </div>
      }
      topBar={
        <ShellTopBar
          title={t('shell.topbar.title', 'Office')}
          activeProjectName={activeProjectName}
          rightSlot={
            <div
              data-testid="shell-topbar-right-slot"
              className="flex items-center gap-3"
            >
              <button
                type="button"
                data-testid="shell-topbar-search"
                onClick={() => setSearchOpen(true)}
                aria-label={t('message.search.open', {
                  defaultValue: '메시지 검색 열기 (Cmd/Ctrl+K)',
                })}
                className="text-xs text-fg-muted hover:text-fg focus:outline-none focus:ring-1 focus:ring-brand px-2 py-1 rounded-panel border border-panel-border"
              >
                {t('message.search.button', { defaultValue: '🔍 검색' })}
              </button>
              {activeProject !== null && (
                <AutonomyModeToggle
                  projectId={activeProject.id}
                  currentMode={activeProject.autonomyMode}
                />
              )}
              {import.meta.env.DEV && <DevThemeSwitcher />}
            </div>
          }
        />
      }
    >
      {activeProject !== null && (
        <QueuePanel
          projectId={activeProject.id}
          className="mx-4 mt-3"
        />
      )}
      {view === 'messenger' ? (
        <MessengerPage />
      ) : view === 'settings' ? (
        <SettingsView />
      ) : (
        <DashboardPage onRequestNewProject={handleCreateProject} />
      )}
      <ProjectCreateModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        onCreated={handleProjectCreated}
      />
      <MessageSearchView
        open={searchOpen}
        onOpenChange={setSearchOpen}
        activeProjectId={activeProjectId}
        activeChannelId={activeChannelId}
        activeProjectName={activeProjectName}
        activeChannelName={activeChannelName}
        onNavigate={handleSearchNavigate}
      />
    </Shell>
  );
}
