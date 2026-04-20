// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ProgressGauge } from '../ProgressGauge';
import { DEFAULT_MODE, DEFAULT_THEME, useThemeStore } from '../../../theme/theme-store';
import { ThemeProvider } from '../../../theme/theme-provider';
import type { ThemeKey } from '../../../theme/theme-tokens';

function renderWithTheme(themeKey: ThemeKey, ui: React.ReactElement) {
  useThemeStore.setState({ themeKey, mode: 'light' });
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

afterEach(() => {
  cleanup();
  useThemeStore.setState({ themeKey: DEFAULT_THEME, mode: DEFAULT_MODE });
});

describe('ProgressGauge — theme × value matrix', () => {
  const cases: Array<{ themeKey: ThemeKey; value: number }> = [
    { themeKey: 'warm', value: 0 },
    { themeKey: 'warm', value: 6 },
    { themeKey: 'warm', value: 12 },
    { themeKey: 'tactical', value: 0 },
    { themeKey: 'tactical', value: 6 },
    { themeKey: 'tactical', value: 12 },
    { themeKey: 'retro', value: 0 },
    { themeKey: 'retro', value: 6 },
    { themeKey: 'retro', value: 12 },
  ];

  it.each(cases)(
    'themeKey=$themeKey value=$value renders the matching variant',
    ({ themeKey, value }) => {
      renderWithTheme(themeKey, <ProgressGauge value={value} total={12} />);
      const root = screen.getByTestId('progress-gauge');
      expect(root.getAttribute('data-theme-variant')).toBe(themeKey);

      if (themeKey === 'warm') {
        const fill = root.querySelector('[data-gauge-fill="warm"]');
        expect(fill).not.toBeNull();
        expect(root.querySelector('[data-segment]')).toBeNull();
      } else if (themeKey === 'tactical') {
        const segments = root.querySelectorAll('[data-segment]');
        expect(segments.length).toBe(12);
        expect(root.querySelector('[data-gauge-fill="warm"]')).toBeNull();
      } else {
        const retro = root.querySelector('[data-gauge-variant="retro"]');
        expect(retro).not.toBeNull();
        expect(root.querySelector('[data-segment]')).toBeNull();
        expect(root.querySelector('[data-gauge-fill="warm"]')).toBeNull();
      }
    }
  );
});

describe('ProgressGauge — variant-specific rendering', () => {
  it('retro: value=4 total=12 label="4/12" renders [████░░░░░░░░] exactly', () => {
    renderWithTheme(
      'retro',
      <ProgressGauge value={4} total={12} label="4/12" />
    );
    const retro = screen
      .getByTestId('progress-gauge')
      .querySelector('[data-gauge-variant="retro"]');
    expect(retro).not.toBeNull();
    expect(retro?.textContent).toBe('[\u2588\u2588\u2588\u2588\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591]');
  });

  it('tactical: value=4 total=12 → exactly 12 segments, 4 active / 8 inactive', () => {
    renderWithTheme('tactical', <ProgressGauge value={4} total={12} />);
    const segments = screen
      .getByTestId('progress-gauge')
      .querySelectorAll('[data-segment]');
    expect(segments.length).toBe(12);
    const active = Array.from(segments).filter(
      (el) => el.getAttribute('data-active') === 'true'
    );
    const inactive = Array.from(segments).filter(
      (el) => el.getAttribute('data-active') === 'false'
    );
    expect(active.length).toBe(4);
    expect(inactive.length).toBe(8);
  });

  it('warm: value=3 total=12 → fill width contains 25% + data-fill-ratio 0.25', () => {
    renderWithTheme('warm', <ProgressGauge value={3} total={12} />);
    const fill = screen
      .getByTestId('progress-gauge')
      .querySelector<HTMLElement>('[data-gauge-fill="warm"]');
    expect(fill).not.toBeNull();
    // jsdom normalizes "25.00%" → "25%"; match by numeric prefix.
    expect(fill?.style.width).toMatch(/^25(\.0+)?%$/);
    // Ratio data-attribute is numeric 0.25.
    expect(Number(fill?.getAttribute('data-fill-ratio'))).toBeCloseTo(0.25, 5);
  });

  it('warm: value=0 clamps ratio to 0 (width 0%)', () => {
    renderWithTheme('warm', <ProgressGauge value={0} total={12} />);
    const fill = screen
      .getByTestId('progress-gauge')
      .querySelector<HTMLElement>('[data-gauge-fill="warm"]');
    expect(fill?.style.width).toMatch(/^0(\.0+)?%$/);
  });

  it('warm: value > total clamps ratio to 1 (width 100%)', () => {
    renderWithTheme('warm', <ProgressGauge value={50} total={12} />);
    const fill = screen
      .getByTestId('progress-gauge')
      .querySelector<HTMLElement>('[data-gauge-fill="warm"]');
    expect(fill?.style.width).toMatch(/^100(\.0+)?%$/);
  });
});

describe('ProgressGauge — label', () => {
  it('renders the label in font-mono when provided', () => {
    renderWithTheme('warm', <ProgressGauge value={3} total={12} label="3/12" />);
    const label = screen
      .getByTestId('progress-gauge')
      .querySelector<HTMLElement>('[data-gauge-label]');
    expect(label).not.toBeNull();
    expect(label?.textContent).toBe('3/12');
    expect(label?.className).toContain('font-mono');
  });

  it('renders no label element when the label prop is omitted', () => {
    renderWithTheme('warm', <ProgressGauge value={3} total={12} />);
    const label = screen
      .getByTestId('progress-gauge')
      .querySelector('[data-gauge-label]');
    expect(label).toBeNull();
  });
});

describe('ProgressGauge — source-level hardcoded color guard', () => {
  it('ProgressGauge.tsx contains zero hex color literals', () => {
    const sourcePath = resolve(
      __dirname,
      '..',
      'ProgressGauge.tsx'
    );
    const source = readFileSync(sourcePath, 'utf-8');
    const matches = source.match(/#[0-9a-fA-F]{3,6}\b/g);
    expect(matches).toBeNull();
  });
});
