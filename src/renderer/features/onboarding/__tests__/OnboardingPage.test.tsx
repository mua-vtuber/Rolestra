// @vitest-environment jsdom

/**
 * OnboardingPage — Set 4 design polish (시안 06).
 *
 * Coverage:
 *   - 3 테마 × pre-office shell (NavRail/ProjectRail 미렌더)
 *   - 6 candidate 렌더 + selected/detected/alt 분기
 *   - card click 으로 selected toggle (parent state)
 *   - footer constraint count 갱신
 *   - "다음" 버튼 selected >= MIN_STAFF 일 때만 active
 *   - 스킵/이전 → onExit 호출
 *   - source-level hex literal guard (모든 onboarding 파일)
 */

import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ThemeProvider } from '../../../theme/theme-provider';
import {
  DEFAULT_MODE,
  DEFAULT_THEME,
  useThemeStore,
} from '../../../theme/theme-store';
import '../../../i18n';
import { i18next } from '../../../i18n';
import { OnboardingPage } from '../OnboardingPage';
import type { ThemeKey } from '../../../theme/theme-tokens';

function renderPage(
  themeKey: ThemeKey = DEFAULT_THEME,
  onExit = vi.fn(),
): { onExit: ReturnType<typeof vi.fn> } & ReturnType<typeof render> {
  useThemeStore.setState({ themeKey, mode: 'light' });
  const result = render(
    <ThemeProvider>
      <OnboardingPage onExit={onExit} />
    </ThemeProvider>,
  );
  return { onExit, ...result };
}

/**
 * R11-Task6: the wizard now starts at step 1 (welcome) — the historical
 * R10 polish-set-4 tests assumed step 2 because the static fixture used
 * to mark step 2 as `current`. With persistence (migration 013) the
 * source of truth is `OnboardingState.currentStep`; in vitest's jsdom
 * env the hook falls back to the canonical default (`currentStep=1`).
 * This helper clicks "Next" once so we land on the staff-selection step
 * exactly as the original tests expected.
 */
function advanceToStep2(): void {
  fireEvent.click(screen.getByTestId('onboarding-action-next'));
}

beforeEach(() => {
  useThemeStore.setState({ themeKey: DEFAULT_THEME, mode: DEFAULT_MODE });
  void i18next.changeLanguage('ko');
});

afterEach(() => cleanup());

describe('OnboardingPage — pre-office shell', () => {
  it.each<[ThemeKey]>([['warm'], ['tactical'], ['retro']])(
    '%s renders 6 candidate cards + stepper + summary',
    (themeKey) => {
      renderPage(themeKey);
      advanceToStep2();
      expect(screen.getByTestId('onboarding-page')).toBeTruthy();
      expect(screen.getByTestId('onboarding-stepper')).toBeTruthy();
      expect(screen.getByTestId('onboarding-summary-strip')).toBeTruthy();
      expect(screen.getAllByTestId('onboarding-staff-card')).toHaveLength(6);
    },
  );

  it('stepper renders 5 steps with current=staff after advancing once', () => {
    renderPage('warm');
    advanceToStep2();
    const steps = screen.getAllByTestId('onboarding-stepper-step');
    expect(steps).toHaveLength(5);
    const current = steps.find((s) => s.getAttribute('data-status') === 'current');
    expect(current?.getAttribute('data-step-id')).toBe('2');
  });

  it('first-boot defaults to step 1 (welcome body, no staff grid yet)', () => {
    renderPage('warm');
    expect(
      screen.getByTestId('onboarding-page').getAttribute('data-current-step'),
    ).toBe('1');
    expect(screen.queryByTestId('onboarding-staff-grid')).toBeNull();
    expect(screen.getByTestId('onboarding-step-1')).toBeTruthy();
  });
});

describe('OnboardingPage — candidate selection state', () => {
  it('initial selected count matches data fixtures (4)', () => {
    renderPage('warm');
    advanceToStep2();
    const selectedCells = screen
      .getAllByTestId('onboarding-summary-cell')
      .find((c) => c.getAttribute('data-stat') === 'selected');
    const value = selectedCells?.querySelector(
      '[data-testid="onboarding-summary-cell-value"]',
    );
    expect(value?.textContent).toBe('4');
  });

  it('clicking a selected card toggles it off and updates summary', () => {
    renderPage('warm');
    advanceToStep2();
    const claudeCard = screen
      .getAllByTestId('onboarding-staff-card')
      .find((c) => c.getAttribute('data-candidate-id') === 'claude')!;
    expect(claudeCard.getAttribute('data-selected')).toBe('true');
    fireEvent.click(claudeCard);
    expect(claudeCard.getAttribute('data-selected')).toBe('false');

    const selectedCell = screen
      .getAllByTestId('onboarding-summary-cell')
      .find((c) => c.getAttribute('data-stat') === 'selected');
    const value = selectedCell?.querySelector(
      '[data-testid="onboarding-summary-cell-value"]',
    );
    expect(value?.textContent).toBe('3');
  });

  it('clicking an alt card moves it to selected', () => {
    renderPage('warm');
    advanceToStep2();
    const grokCard = screen
      .getAllByTestId('onboarding-staff-card')
      .find((c) => c.getAttribute('data-candidate-id') === 'grok')!;
    expect(grokCard.getAttribute('data-selected')).toBe('false');
    expect(grokCard.getAttribute('data-detection')).toBe('alt');
    fireEvent.click(grokCard);
    expect(grokCard.getAttribute('data-selected')).toBe('true');
    expect(grokCard.getAttribute('data-detection')).toBe('selected');
  });
});

describe('OnboardingPage — footer actions', () => {
  it('next button is enabled at step 1 (welcome has no gate)', () => {
    renderPage('warm');
    const next = screen.getByTestId('onboarding-action-next');
    expect(next.getAttribute('aria-disabled')).toBe('false');
  });

  it('next button is enabled at step 2 when at least 1 selected (default 4)', () => {
    renderPage('warm');
    advanceToStep2();
    const next = screen.getByTestId('onboarding-action-next');
    expect(next.getAttribute('aria-disabled')).toBe('false');
  });

  it('deselecting all 4 disables next at step 2', () => {
    renderPage('warm');
    advanceToStep2();
    ['claude', 'gemini', 'codex', 'local'].forEach((id) => {
      const card = screen
        .getAllByTestId('onboarding-staff-card')
        .find((c) => c.getAttribute('data-candidate-id') === id)!;
      fireEvent.click(card);
    });
    const next = screen.getByTestId('onboarding-action-next');
    expect(next.getAttribute('aria-disabled')).toBe('true');
  });

  it('skip button calls onExit', () => {
    const { onExit } = renderPage('warm');
    fireEvent.click(screen.getByTestId('onboarding-topbar-skip'));
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('prev at step 1 calls onExit (no previous step)', () => {
    const { onExit } = renderPage('warm');
    fireEvent.click(screen.getByTestId('onboarding-action-prev'));
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('prev at step 2 walks back to step 1 instead of exiting', () => {
    const { onExit } = renderPage('warm');
    advanceToStep2();
    fireEvent.click(screen.getByTestId('onboarding-action-prev'));
    expect(onExit).not.toHaveBeenCalled();
    expect(
      screen.getByTestId('onboarding-page').getAttribute('data-current-step'),
    ).toBe('1');
  });
});

describe('OnboardingPage — DetectionBadge per detection state', () => {
  it.each<[string, 'selected' | 'detected' | 'alt']>([
    ['claude', 'selected'],
    ['copilot', 'alt'],
    ['grok', 'alt'],
  ])('candidate %s → detection=%s', (candidateId, expected) => {
    renderPage('warm');
    advanceToStep2();
    const card = screen
      .getAllByTestId('onboarding-staff-card')
      .find((c) => c.getAttribute('data-candidate-id') === candidateId)!;
    expect(card.getAttribute('data-detection')).toBe(expected);
  });
});

describe('OnboardingPage — retro theme branch', () => {
  it('stepper shows ASCII bracket markers under retro at step 2', () => {
    renderPage('retro');
    advanceToStep2();
    const markers = screen.getAllByTestId('onboarding-stepper-marker');
    expect(markers).toHaveLength(5);
    const texts = markers.map((m) => m.textContent);
    expect(texts).toContain('[✓]');
    expect(texts).toContain('[▶]');
  });

  it('summary strip shows mono prompt under retro at step 2', () => {
    renderPage('retro');
    advanceToStep2();
    const strip = screen.getByTestId('onboarding-summary-strip');
    expect(strip.getAttribute('data-theme')).toBe('retro');
    expect(strip.textContent).toContain('$ onboarding --staff');
  });
});

describe('OnboardingPage — R11-Task6 step 3/4/5 surfaces', () => {
  function advanceToStep(target: 3 | 4 | 5): void {
    advanceToStep2();
    if (target >= 3) {
      fireEvent.click(screen.getByTestId('onboarding-action-next'));
    }
    if (target >= 4) {
      // Step 3 needs a non-empty role for every selected provider.
      const inputs = screen.getAllByTestId('onboarding-step-3-input');
      inputs.forEach((input) => {
        fireEvent.change(input, { target: { value: '시니어' } });
      });
      fireEvent.click(screen.getByTestId('onboarding-action-next'));
    }
    if (target >= 5) {
      fireEvent.click(screen.getByTestId('onboarding-action-next'));
    }
  }

  it('step 3 renders one input row per selected provider', () => {
    renderPage('warm');
    advanceToStep(3);
    const rows = screen.getAllByTestId('onboarding-step-3-row');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBe(4); // fixture seeds claude/gemini/codex/local
  });

  it('step 3 next is disabled until every selected provider has a role', () => {
    renderPage('warm');
    advanceToStep(3);
    const next = screen.getByTestId('onboarding-action-next');
    expect(next.getAttribute('aria-disabled')).toBe('true');
    const inputs = screen.getAllByTestId('onboarding-step-3-input');
    inputs.forEach((input) => {
      fireEvent.change(input, { target: { value: '시니어' } });
    });
    expect(
      screen
        .getByTestId('onboarding-action-next')
        .getAttribute('aria-disabled'),
    ).toBe('false');
  });

  it('step 4 defaults to hybrid permission mode', () => {
    renderPage('warm');
    advanceToStep(4);
    const hybrid = screen
      .getAllByTestId('onboarding-step-4-option')
      .find((el) => el.getAttribute('data-mode') === 'hybrid')!;
    expect(hybrid.getAttribute('data-selected')).toBe('true');
  });

  it('step 5 next is disabled until slug is non-empty', () => {
    renderPage('warm');
    advanceToStep(5);
    const next = screen.getByTestId('onboarding-action-next');
    expect(next.getAttribute('aria-disabled')).toBe('true');
    fireEvent.change(screen.getByTestId('onboarding-step-5-slug'), {
      target: { value: 'arena-test' },
    });
    expect(
      screen
        .getByTestId('onboarding-action-next')
        .getAttribute('aria-disabled'),
    ).toBe('false');
  });

  it('step 5 finish button labels as 완료 / Finish', () => {
    renderPage('warm');
    advanceToStep(5);
    const next = screen.getByTestId('onboarding-action-next');
    expect(next.textContent).toBe('완료');
  });
});

describe('Onboarding source — hex literal guard', () => {
  it('every onboarding source file has zero hex color literals', () => {
    const dir = resolve(__dirname, '..');
    const files = readdirSync(dir).filter((f) => f.endsWith('.tsx') || f.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(0);
    files.forEach((file) => {
      const source = readFileSync(resolve(dir, file), 'utf-8');
      const matches = source.match(/#[0-9a-fA-F]{3,6}\b/g);
      expect(
        matches,
        `${file} contains hex literal(s): ${matches?.join(', ')}`,
      ).toBeNull();
    });
  });
});
