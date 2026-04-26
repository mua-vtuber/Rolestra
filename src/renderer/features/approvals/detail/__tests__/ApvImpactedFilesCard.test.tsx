// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ThemeProvider } from '../../../../theme/theme-provider';
import { DEFAULT_MODE, DEFAULT_THEME, useThemeStore } from '../../../../theme/theme-store';
import '../../../../i18n';
import { ApvImpactedFilesCard } from '../ApvImpactedFilesCard';
import type { ApprovalImpactedFile } from '../../../../../shared/approval-detail-types';

function renderCard(files: ApprovalImpactedFile[]) {
  useThemeStore.getState().setTheme(DEFAULT_THEME);
  useThemeStore.getState().setMode(DEFAULT_MODE);
  return render(
    <ThemeProvider>
      <ApvImpactedFilesCard files={files} />
    </ThemeProvider>,
  );
}

afterEach(() => {
  cleanup();
});

describe('ApvImpactedFilesCard (R11-Task7)', () => {
  it('empty state renders the placeholder when files = []', () => {
    renderCard([]);
    expect(screen.getByTestId('apv-impacted-files-empty')).toBeTruthy();
    expect(screen.queryByTestId('apv-impacted-files-list')).toBeNull();
  });

  it('renders one row per file with the correct path', () => {
    renderCard([
      { path: '/a.txt', addedLines: 0, removedLines: 0, changeKind: 'added' },
      { path: '/b.txt', addedLines: 0, removedLines: 0, changeKind: 'modified' },
    ]);
    const rows = screen.getAllByTestId('apv-impacted-files-row');
    expect(rows).toHaveLength(2);
    expect(rows[0].getAttribute('data-path')).toBe('/a.txt');
    expect(rows[1].getAttribute('data-path')).toBe('/b.txt');
  });

  it('chip class differs by change kind', () => {
    renderCard([
      { path: '/x', addedLines: 0, removedLines: 0, changeKind: 'added' },
      { path: '/y', addedLines: 0, removedLines: 0, changeKind: 'deleted' },
      { path: '/z', addedLines: 0, removedLines: 0, changeKind: 'modified' },
    ]);
    const chips = screen.getAllByTestId('apv-impacted-files-kind');
    expect(chips[0].className).toContain('text-success');
    expect(chips[1].className).toContain('text-danger');
    expect(chips[2].className).toContain('text-warning');
  });

  it('row count attribute reflects file count', () => {
    renderCard([
      { path: '/a', addedLines: 0, removedLines: 0, changeKind: 'modified' },
    ]);
    const card = screen.getByTestId('apv-impacted-files-card');
    expect(card.getAttribute('data-row-count')).toBe('1');
  });

  it('renders no hex literal colour anywhere', () => {
    renderCard([
      { path: '/a', addedLines: 0, removedLines: 0, changeKind: 'added' },
    ]);
    const card = screen.getByTestId('apv-impacted-files-card');
    expect(card.outerHTML.match(/#[0-9a-fA-F]{3,6}\b/g)).toBeNull();
  });
});
