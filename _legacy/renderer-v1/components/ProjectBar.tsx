/**
 * Project folder selection bar displayed at the top of the app.
 *
 * Shows the current project folder path (truncated) with change/clear actions,
 * or a prompt to select a project when none is set.
 */

import { useTranslation } from 'react-i18next';
import { useAppStore } from '../stores/app-store';

/** Show only the last 2-3 path segments, with ellipsis for longer paths. */
function shortenPath(fullPath: string): string {
  const sep = fullPath.includes('\\') ? '\\' : '/';
  const parts = fullPath.split(sep).filter(Boolean);
  if (parts.length <= 3) return parts.join('/');
  return '…/' + parts.slice(-2).join('/');
}

export function ProjectBar(): React.JSX.Element {
  const { t } = useTranslation();
  const projectFolder = useAppStore((s) => s.projectFolder);
  const pickProjectFolder = useAppStore((s) => s.pickProjectFolder);
  const clearProjectFolder = useAppStore((s) => s.clearProjectFolder);

  return (
    <div className="project-bar">
      <span className="project-bar-icon">📁</span>
      {projectFolder ? (
        <>
          <span className="project-bar-path" title={projectFolder}>
            {shortenPath(projectFolder)}
          </span>
          <button
            className="project-bar-btn"
            onClick={() => void pickProjectFolder()}
          >
            {t('workspace.change')}
          </button>
          <button
            className="project-bar-btn project-bar-btn-clear"
            onClick={clearProjectFolder}
          >
            ✕
          </button>
        </>
      ) : (
        <>
          <span className="project-bar-label">
            {t('workspace.selectProject')}
          </span>
          <button
            className="project-bar-btn"
            onClick={() => void pickProjectFolder()}
          >
            {t('workspace.change')}
          </button>
        </>
      )}
    </div>
  );
}
