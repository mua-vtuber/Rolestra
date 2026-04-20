// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { HeroKpiTile, type HeroKpiVariant } from '../HeroKpiTile';

afterEach(() => {
  cleanup();
});

describe('HeroKpiTile — variants', () => {
  const variants: HeroKpiVariant[] = [
    'projects',
    'meetings',
    'approvals',
    'completed',
  ];

  it.each(variants)(
    'variant=%s renders label + value and exposes data-variant',
    (variant) => {
      render(<HeroKpiTile variant={variant} label={`label-${variant}`} value={7} />);
      const tile = screen.getByTestId('hero-kpi-tile');
      expect(tile.getAttribute('data-variant')).toBe(variant);
      expect(screen.getByText(`label-${variant}`)).toBeTruthy();
      expect(screen.getByTestId('hero-kpi-value').textContent).toBe('7');
    },
  );
});

describe('HeroKpiTile — state rendering', () => {
  it('value=null renders skeleton and sets aria-busy=true', () => {
    render(<HeroKpiTile variant="projects" label="Active" value={null} />);
    const tile = screen.getByTestId('hero-kpi-tile');
    expect(tile.getAttribute('aria-busy')).toBe('true');
    expect(screen.getByTestId('hero-kpi-skeleton')).toBeTruthy();
    expect(screen.queryByTestId('hero-kpi-value')).toBeNull();
    // Skeleton must animate (visual hint it's loading).
    expect(screen.getByTestId('hero-kpi-skeleton').className).toContain(
      'animate-pulse',
    );
  });

  it('value=0 renders the digit 0 with text-fg-muted token class', () => {
    render(<HeroKpiTile variant="approvals" label="Pending" value={0} />);
    const tile = screen.getByTestId('hero-kpi-tile');
    expect(tile.getAttribute('aria-busy')).toBe('false');
    const value = screen.getByTestId('hero-kpi-value');
    expect(value.textContent).toBe('0');
    expect(value.className).toContain('text-fg-muted');
    expect(value.className).not.toMatch(/(^|\s)text-fg(\s|$)/);
  });

  it('value>0 renders with default text-fg class (not muted)', () => {
    render(<HeroKpiTile variant="meetings" label="Active" value={3} />);
    const value = screen.getByTestId('hero-kpi-value');
    expect(value.textContent).toBe('3');
    expect(value.className).toMatch(/(^|\s)text-fg(\s|$)/);
    expect(value.className).not.toContain('text-fg-muted');
  });
});

describe('HeroKpiTile — source-level hardcoded color guard', () => {
  it('HeroKpiTile.tsx contains zero hex color literals', () => {
    const source = readFileSync(
      resolve(__dirname, '..', 'HeroKpiTile.tsx'),
      'utf-8',
    );
    expect(source.match(/#[0-9a-fA-F]{3,6}\b/g)).toBeNull();
  });
});
