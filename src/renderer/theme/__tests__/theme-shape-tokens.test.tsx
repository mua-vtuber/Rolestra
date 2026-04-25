// @vitest-environment jsdom

/**
 * theme-shape-tokens — R10 Task 7 form-level branching invariants.
 *
 * 6 themes × 5 surfaces = 30 cases verifying that DOM `data-*` attributes
 * (and inline styles, where applicable) match the theme token map. The
 * test does not snapshot a pixel rendering — it asserts the contract
 * between {@link THEMES} and the surface components, so a regression in
 * either side fails the suite.
 *
 * Surfaces covered:
 *   1. Card primitive       → `data-panel-clip`
 *   2. CardHeader primitive → `data-title-style` (cardTitleStyle)
 *   3. Button primitive     → `data-shape` (miniBtnStyle, shape='auto')
 *   4. ProgressGauge        → `data-gauge-variant` (themeKey)
 *   5. Avatar primitive     → `data-shape` (avatarShape)
 *
 * Each combo iterates the 6 (themeKey, mode) pairs from THEME_MATRIX, so
 * dark/light parity is guaranteed.
 */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Avatar } from '../../components/members/Avatar';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
} from '../../components/primitives';
import { ProgressGauge } from '../../features/dashboard/ProgressGauge';
import { ThemeProvider } from '../theme-provider';
import { DEFAULT_MODE, DEFAULT_THEME, useThemeStore } from '../theme-store';
import {
  THEME_MATRIX,
  THEMES,
  comboKey,
  type ThemeComboKey,
} from '../theme-tokens';

function renderWithTheme(ui: React.ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

afterEach(() => {
  cleanup();
  useThemeStore.setState({ themeKey: DEFAULT_THEME, mode: DEFAULT_MODE });
});

const COMBOS = THEME_MATRIX.map((entry) => ({
  combo: comboKey(entry.themeKey, entry.mode),
  themeKey: entry.themeKey,
  mode: entry.mode,
  label: entry.label,
}));

function expectedClip(combo: ThemeComboKey): string {
  return THEMES[combo].panelClip;
}

describe('R10 form-level branching — Card panelClip', () => {
  it.each(COMBOS)(
    '$label — Card data-panel-clip matches token',
    ({ combo, themeKey, mode }) => {
      useThemeStore.setState({ themeKey, mode });
      renderWithTheme(<Card data-testid="card-shape">body</Card>);
      const card = screen.getByTestId('card-shape');
      const clip = expectedClip(combo);
      const expected = clip === 'none' ? 'none' : clip;
      expect(card.getAttribute('data-panel-clip')).toBe(expected);
      // tactical themes apply inline clipPath, others must not.
      if (clip === 'none') {
        expect(card.style.clipPath).toBe('');
      } else {
        expect(card.style.clipPath.length).toBeGreaterThan(0);
      }
    },
  );
});

describe('R10 form-level branching — CardHeader cardTitleStyle', () => {
  it.each(COMBOS)(
    '$label — CardHeader data-title-style matches token',
    ({ combo, themeKey, mode }) => {
      useThemeStore.setState({ themeKey, mode });
      renderWithTheme(
        <Card>
          <CardHeader heading="heading">extra</CardHeader>
          <CardBody>body</CardBody>
        </Card>,
      );
      const header = screen
        .getByText('heading')
        .closest('[data-title-style]') as HTMLElement;
      expect(header.getAttribute('data-title-style')).toBe(
        THEMES[combo].cardTitleStyle,
      );
    },
  );
});

describe('R10 form-level branching — Button miniBtnStyle', () => {
  it.each(COMBOS)(
    '$label — Button shape="auto" picks miniBtnStyle',
    ({ combo, themeKey, mode }) => {
      useThemeStore.setState({ themeKey, mode });
      renderWithTheme(<Button shape="auto">click</Button>);
      const btn = screen.getByRole('button', { name: 'click' });
      expect(btn.getAttribute('data-shape')).toBe(THEMES[combo].miniBtnStyle);
    },
  );
});

describe('R10 form-level branching — ProgressGauge variant', () => {
  it.each(COMBOS)(
    '$label — ProgressGauge data-theme-variant matches themeKey',
    ({ themeKey, mode }) => {
      useThemeStore.setState({ themeKey, mode });
      renderWithTheme(<ProgressGauge value={5} total={10} />);
      const gauge = screen.getByTestId('progress-gauge');
      expect(gauge.getAttribute('data-theme-variant')).toBe(themeKey);
    },
  );
});

describe('R10 form-level branching — Avatar shape token', () => {
  // Avatar renders all three shapes including 'status' (rounded-sm), so
  // here we feed token.avatarShape directly to verify the SHAPE_CLASS map
  // covers every possibility — caller surfaces (Message, MemberRow) may
  // collapse 'status' to 'circle' but the primitive itself MUST render
  // every shape.
  it.each(COMBOS)(
    '$label — Avatar data-shape matches token avatarShape',
    ({ combo, themeKey, mode }) => {
      useThemeStore.setState({ themeKey, mode });
      const shape = THEMES[combo].avatarShape;
      renderWithTheme(
        <Avatar
          providerId="test-provider"
          displayName="T"
          avatarKind="default"
          avatarData="blue-dev"
          shape={shape}
        />,
      );
      const avatar = screen.getByTestId('avatar');
      expect(avatar.getAttribute('data-shape')).toBe(shape);
      expect(avatar.getAttribute('data-provider-id')).toBe('test-provider');
      // assert the shape is in SHAPE_CLASS — invalid shape would render bare.
      expect(['circle', 'diamond', 'status']).toContain(shape);
      // Light/dark mode does not change avatarShape, but mode is needed
      // for ThemeProvider hydration coverage.
      expect(['light', 'dark']).toContain(mode);
      expect(typeof themeKey).toBe('string');
    },
  );
});
