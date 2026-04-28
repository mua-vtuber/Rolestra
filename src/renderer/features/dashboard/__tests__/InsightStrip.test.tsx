// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import '../../../i18n';
import { i18next } from '../../../i18n';

import { InsightStrip, type InsightCell } from '../InsightStrip';

beforeEach(() => {
  void i18next.changeLanguage('ko');
});

afterEach(() => {
  cleanup();
});

describe('InsightStrip — region semantics', () => {
  // F3 (cleanup-2026-04-27) removed the 4-cell em-dash default. The
  // strip is now a presentation primitive; callers pass real `cells`.
  // These tests exercise region semantics through a minimal cells prop.
  const SAMPLE_CELLS: InsightCell[] = [
    { label: 'a', value: '1' },
    { label: 'b', value: '2' },
    { label: 'c', value: '3' },
    { label: 'd', value: '4' },
  ];

  it('region is labelled via dashboard.insight.ariaLabel', () => {
    render(<InsightStrip cells={SAMPLE_CELLS} />);
    const strip = screen.getByTestId('dashboard-insight-strip');
    expect(strip.getAttribute('role')).toBe('region');
    expect(strip.getAttribute('aria-label')).toBe(
      i18next.t('dashboard.insight.ariaLabel'),
    );
  });

  it('puts N-1 vertical separators between N cells', () => {
    render(<InsightStrip cells={SAMPLE_CELLS} />);
    expect(screen.getAllByTestId('insight-separator')).toHaveLength(3);
  });
});

describe('InsightStrip — custom cells prop', () => {
  const cells: InsightCell[] = [
    { label: 'Δ', value: '+21%', tone: 'up' },
    { label: 'Avg', value: '9m', tone: 'down' },
    { label: 'Approvals', value: '142', tone: 'neutral' },
    { label: 'Review', value: '94%' },
  ];

  it('renders each passed label + value', () => {
    render(<InsightStrip cells={cells} />);
    expect(screen.getByText('Δ')).toBeTruthy();
    expect(screen.getByText('Avg')).toBeTruthy();
    expect(screen.getByText('Approvals')).toBeTruthy();
    expect(screen.getByText('Review')).toBeTruthy();

    const values = screen
      .getAllByTestId('insight-value')
      .map((node) => node.textContent);
    expect(values).toEqual(['+21%', '9m', '142', '94%']);
  });

  it("tone='up' applies text-success to the value", () => {
    render(<InsightStrip cells={[{ label: 'x', value: 'v', tone: 'up' }]} />);
    const value = screen.getByTestId('insight-value');
    expect(value.className).toContain('text-success');
    expect(value.className).not.toContain('text-danger');
    expect(screen.getByTestId('insight-cell').getAttribute('data-tone')).toBe('up');
  });

  it("tone='down' applies text-danger to the value", () => {
    render(<InsightStrip cells={[{ label: 'x', value: 'v', tone: 'down' }]} />);
    const value = screen.getByTestId('insight-value');
    expect(value.className).toContain('text-danger');
    expect(value.className).not.toContain('text-success');
    expect(screen.getByTestId('insight-cell').getAttribute('data-tone')).toBe(
      'down',
    );
  });

  it("tone='neutral' (and tone omitted) falls back to text-fg", () => {
    render(
      <InsightStrip
        cells={[
          { label: 'a', value: '1', tone: 'neutral' },
          { label: 'b', value: '2' },
        ]}
      />,
    );
    const values = screen.getAllByTestId('insight-value');
    values.forEach((node) => {
      expect(node.className).toMatch(/(^|\s)text-fg(\s|$)/);
      expect(node.className).not.toContain('text-success');
      expect(node.className).not.toContain('text-danger');
    });
    const cells2 = screen.getAllByTestId('insight-cell');
    expect(cells2[0].getAttribute('data-tone')).toBe('neutral');
    expect(cells2[1].getAttribute('data-tone')).toBe('neutral');
  });

  it('renders exactly the number of cells passed — does NOT auto-pad to 4', () => {
    render(
      <InsightStrip
        cells={[
          { label: 'one', value: '1' },
          { label: 'two', value: '2' },
        ]}
      />,
    );
    expect(screen.getAllByTestId('insight-cell')).toHaveLength(2);
    // N-1 separators.
    expect(screen.getAllByTestId('insight-separator')).toHaveLength(1);
  });

  it('never renders an empty value — empty string falls back to placeholder', () => {
    render(<InsightStrip cells={[{ label: 'x', value: '' }]} />);
    expect(screen.getByTestId('insight-value').textContent).toBe(
      i18next.t('dashboard.insight.placeholder'),
    );
  });
});

describe('InsightStrip — en locale', () => {
  it('aria-label switches when the i18n language changes', async () => {
    await i18next.changeLanguage('en');
    render(
      <InsightStrip
        cells={[{ label: 'a', value: '1' }]}
      />,
    );
    const strip = screen.getByTestId('dashboard-insight-strip');
    expect(strip.getAttribute('aria-label')).toBe('Dashboard insight strip');
  });
});

describe('InsightStrip — source-level hardcoded color guard', () => {
  it('InsightStrip.tsx contains zero hex color literals', () => {
    const source = readFileSync(
      resolve(__dirname, '..', 'InsightStrip.tsx'),
      'utf-8',
    );
    expect(source.match(/#[0-9a-fA-F]{3,6}\b/g)).toBeNull();
  });
});
