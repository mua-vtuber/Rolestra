/**
 * App shell layout with sidebar navigation and main content area.
 */

import { useEffect } from 'react';
import { Sidebar } from './Sidebar';
import { ChatView } from './ChatView';
import { SettingsView } from './SettingsView';
import { ProjectBar } from './ProjectBar';
import { useAppStore } from '../stores/app-store';

export function Layout(): React.JSX.Element {
  const currentView = useAppStore((s) => s.currentView);
  const fetchAppInfo = useAppStore((s) => s.fetchAppInfo);
  const fetchWorkspaceStatus = useAppStore((s) => s.fetchWorkspaceStatus);

  useEffect(() => {
    void fetchAppInfo();
    void fetchWorkspaceStatus();
  }, [fetchAppInfo, fetchWorkspaceStatus]);

  return (
    <div className="app-layout">
      <Sidebar />
      <main className="app-main">
        <ProjectBar />
        {currentView === 'chat' && <ChatView />}
        {currentView === 'settings' && <SettingsView />}
      </main>
    </div>
  );
}
