// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ThemeProvider } from '../../../../theme/theme-provider';
import { DEFAULT_MODE, DEFAULT_THEME, useThemeStore } from '../../../../theme/theme-store';
import '../../../../i18n';
import { ApvDiffPreviewCard } from '../ApvDiffPreviewCard';
import type { ApprovalDiffPreview } from '../../../../../shared/approval-detail-types';

function renderCard(previews: ApprovalDiffPreview[], maxRows?: number) {
  useThemeStore.getState().setTheme(DEFAULT_THEME);
  useThemeStore.getState().setMode(DEFAULT_MODE);
  return render(
    <ThemeProvider>
      <ApvDiffPreviewCard previews={previews} maxRows={maxRows} />
    </ThemeProvider>,
  );
}

afterEach(() => {
  cleanup();
});

describe('ApvDiffPreviewCard (R11-Task7)', () => {
  it('empty state renders placeholder when previews = []', () => {
    renderCard([]);
    expect(screen.getByTestId('apv-diff-preview-empty')).toBeTruthy();
    expect(screen.queryAllByTestId('apv-diff-preview-row')).toHaveLength(0);
  });

  it('renders one row per preview with the path + body content', () => {
    renderCard([
      { path: '/a', preview: 'edit foo', truncated: false },
      { path: '/b', preview: 'edit bar', truncated: false },
    ]);
    const rows = screen.getAllByTestId('apv-diff-preview-row');
    expect(rows).toHaveLength(2);
    const paths = rows.map((r) => r.getAttribute('data-path'));
    expect(paths).toEqual(['/a', '/b']);
  });

  it('truncated flag surfaces hint text', () => {
    renderCard([{ path: '/big', preview: 'partial', truncated: true }]);
    expect(screen.getByTestId('apv-diff-preview-truncated')).toBeTruthy();
  });

  it('respects maxRows soft cap and surfaces overflow hint', () => {
    renderCard(
      [
        { path: '/a', preview: 'a', truncated: false },
        { path: '/b', preview: 'b', truncated: false },
        { path: '/c', preview: 'c', truncated: false },
        { path: '/d', preview: 'd', truncated: false },
        { path: '/e', preview: 'e', truncated: false },
      ],
      3,
    );
    expect(screen.getAllByTestId('apv-diff-preview-row')).toHaveLength(3);
    const overflow = screen.getByTestId('apv-diff-preview-overflow');
    expect(overflow.textContent).toMatch(/2/); // 2 hidden
  });

  it('preview body is rendered inside <pre> so newlines survive', () => {
    renderCard([{ path: '/x', preview: 'line1\nline2', truncated: false }]);
    const body = screen.getByTestId('apv-diff-preview-body');
    expect(body.tagName).toBe('PRE');
    expect(body.textContent).toContain('line1');
    expect(body.textContent).toContain('line2');
  });
});
