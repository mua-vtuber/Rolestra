// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { HeroQuickActions } from '../HeroQuickActions';
import { DEFAULT_MODE, DEFAULT_THEME, useThemeStore } from '../../../theme/theme-store';
import { ThemeProvider } from '../../../theme/theme-provider';
import '../../../i18n';
import { i18next } from '../../../i18n';

function renderWithTheme(ui: React.ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

afterEach(() => {
  cleanup();
  useThemeStore.setState({ themeKey: DEFAULT_THEME, mode: DEFAULT_MODE });
  void i18next.changeLanguage('ko');
});

describe('HeroQuickActions — labels + enabled paths', () => {
  it('renders both buttons with the i18n labels (ko)', () => {
    void i18next.changeLanguage('ko');
    renderWithTheme(
      <HeroQuickActions
        onNewProject={() => {}}
        onStartMeeting={() => {}}
        hasActiveProject
      />,
    );
    expect(screen.getByTestId('hero-quick-action-new-project').textContent).toBe(
      '+ 새 프로젝트',
    );
    expect(screen.getByTestId('hero-quick-action-meeting').textContent).toBe(
      '회의 소집 →',
    );
  });

  it('+ 새 프로젝트 is always clickable (no active project)', () => {
    const onNewProject = vi.fn();
    renderWithTheme(
      <HeroQuickActions
        onNewProject={onNewProject}
        onStartMeeting={() => {}}
        hasActiveProject={false}
      />,
    );
    fireEvent.click(screen.getByTestId('hero-quick-action-new-project'));
    expect(onNewProject).toHaveBeenCalledTimes(1);
  });

  it('hasActiveProject=true → meeting button is enabled and calls onStartMeeting', () => {
    const onStartMeeting = vi.fn();
    renderWithTheme(
      <HeroQuickActions
        onNewProject={() => {}}
        onStartMeeting={onStartMeeting}
        hasActiveProject
      />,
    );
    const meeting = screen.getByTestId('hero-quick-action-meeting');
    expect(meeting.getAttribute('aria-disabled')).toBe('false');
    fireEvent.click(meeting);
    expect(onStartMeeting).toHaveBeenCalledTimes(1);
  });
});

describe('HeroQuickActions — disabled (no active project)', () => {
  it('meeting button exposes aria-disabled=true when no active project', () => {
    renderWithTheme(
      <HeroQuickActions
        onNewProject={() => {}}
        onStartMeeting={() => {}}
        hasActiveProject={false}
      />,
    );
    expect(
      screen.getByTestId('hero-quick-action-meeting').getAttribute('aria-disabled'),
    ).toBe('true');
  });

  it('clicking the meeting button while disabled does NOT invoke onStartMeeting', () => {
    const onStartMeeting = vi.fn();
    renderWithTheme(
      <HeroQuickActions
        onNewProject={() => {}}
        onStartMeeting={onStartMeeting}
        hasActiveProject={false}
      />,
    );
    fireEvent.click(screen.getByTestId('hero-quick-action-meeting'));
    expect(onStartMeeting).not.toHaveBeenCalled();
  });
});

describe('HeroQuickActions — source-level hardcoded color guard', () => {
  it('HeroQuickActions.tsx contains zero hex color literals', () => {
    const source = readFileSync(
      resolve(__dirname, '..', 'HeroQuickActions.tsx'),
      'utf-8',
    );
    expect(source.match(/#[0-9a-fA-F]{3,6}\b/g)).toBeNull();
  });
});
