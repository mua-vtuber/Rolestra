// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import '../../../i18n';
import { NavRail, type NavRailItem } from '..';
import { ThemeProvider } from '../../../theme/theme-provider';

const ITEMS: ReadonlyArray<NavRailItem> = [
  { id: 'dashboard', icon: 'dashboard', label: 'Dashboard' },
  { id: 'messenger', icon: 'chat', label: 'Messenger' },
  { id: 'approval', icon: 'bell', label: 'Approval', badge: 3 },
  { id: 'queue', icon: 'queue', label: 'Queue' },
  { id: 'settings', icon: 'settings', label: 'Settings' },
];

function renderNav(activeId: string, onSelect?: (id: string) => void) {
  return render(
    <ThemeProvider>
      <NavRail items={ITEMS} activeId={activeId} onSelect={onSelect} />
    </ThemeProvider>
  );
}

afterEach(() => {
  cleanup();
});

describe('NavRail — a11y + interactions', () => {
  it('marks the active item with aria-current="page"', () => {
    renderNav('messenger');
    const active = screen.getByRole('button', { name: 'Messenger' });
    expect(active.getAttribute('aria-current')).toBe('page');
    const inactive = screen.getByRole('button', { name: 'Dashboard' });
    expect(inactive.getAttribute('aria-current')).toBeNull();
  });

  it('invokes onSelect when a nav button is clicked', () => {
    const onSelect = vi.fn();
    renderNav('dashboard', onSelect);
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(onSelect).toHaveBeenCalledWith('settings');
  });

  it('renders badge when item has a positive badge count', () => {
    renderNav('dashboard');
    const approval = screen.getByRole('button', { name: 'Approval' });
    expect(approval.textContent).toContain('3');
  });
});
