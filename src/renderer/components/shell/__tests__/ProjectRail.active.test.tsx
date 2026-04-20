// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import '../../../i18n';
import { ProjectRail, type ProjectRailProject } from '..';
import { ThemeProvider } from '../../../theme/theme-provider';

const PROJECTS: ReadonlyArray<ProjectRailProject> = [
  { id: 'p-alpha', name: 'Alpha', icon: 'folder' },
  { id: 'p-beta', name: 'Beta', icon: 'folder' },
  { id: 'p-gamma', name: 'Gamma', icon: 'folder' },
];

function renderRail(
  props: Partial<React.ComponentProps<typeof ProjectRail>> = {},
) {
  return render(
    <ThemeProvider>
      <ProjectRail projects={PROJECTS} {...props} />
    </ThemeProvider>,
  );
}

afterEach(() => {
  cleanup();
});

describe('ProjectRail — active project + create entry (R4-Task10)', () => {
  it('marks the active project with aria-current="page"', () => {
    renderRail({ activeProjectId: 'p-beta' });
    const active = screen.getByRole('button', { name: /Beta/ });
    expect(active.getAttribute('aria-current')).toBe('page');
    expect(active.getAttribute('data-active')).toBe('true');

    const inactive = screen.getByRole('button', { name: /Alpha/ });
    expect(inactive.getAttribute('aria-current')).toBeNull();
    expect(inactive.getAttribute('data-active')).toBeNull();
  });

  it('invokes onSelectProject when a project row is clicked', () => {
    const onSelectProject = vi.fn();
    renderRail({ onSelectProject, activeProjectId: 'p-alpha' });
    fireEvent.click(screen.getByRole('button', { name: /Gamma/ }));
    expect(onSelectProject).toHaveBeenCalledWith('p-gamma');
  });

  it('does NOT render the "+ 새 프로젝트" row when onCreateProject is omitted', () => {
    renderRail();
    expect(screen.queryByTestId('project-rail-create')).toBeNull();
    expect(screen.queryByText(/새 프로젝트/)).toBeNull();
  });

  it('renders the "+ 새 프로젝트" row when onCreateProject is provided', () => {
    const onCreateProject = vi.fn();
    renderRail({ onCreateProject });
    const row = screen.getByTestId('project-rail-create');
    expect(row).toBeTruthy();
    expect(row.getAttribute('data-role')).toBe('create-project');
    expect(row.textContent).toContain('새 프로젝트');
  });

  it('positions "+ 새 프로젝트" BEFORE the first project row', () => {
    const onCreateProject = vi.fn();
    renderRail({ onCreateProject });
    const rail = screen.getByTestId('project-rail');
    const buttons = rail.querySelectorAll('button');
    // header div, then create-project, then project rows in order
    expect(buttons[0]?.getAttribute('data-role')).toBe('create-project');
    expect(buttons[1]?.textContent).toContain('Alpha');
  });

  it('clicking "+ 새 프로젝트" invokes onCreateProject', () => {
    const onCreateProject = vi.fn();
    renderRail({ onCreateProject });
    fireEvent.click(screen.getByTestId('project-rail-create'));
    expect(onCreateProject).toHaveBeenCalledTimes(1);
  });

  it('renders with an empty project list + only the create row', () => {
    const onCreateProject = vi.fn();
    render(
      <ThemeProvider>
        <ProjectRail projects={[]} onCreateProject={onCreateProject} />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('project-rail-create')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Alpha/ })).toBeNull();
  });
});

describe('ProjectRail — source-level hardcoded color guard', () => {
  it('ProjectRail.tsx contains zero hex color literals', () => {
    const source = readFileSync(
      resolve(__dirname, '..', 'ProjectRail.tsx'),
      'utf-8',
    );
    expect(source.match(/#[0-9a-fA-F]{3,6}\b/g)).toBeNull();
  });
});
