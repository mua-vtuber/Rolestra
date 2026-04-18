/**
 * Tests for GeneralTab — verifies all settings fields render and update correctly.
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { GeneralTab } from '../settings/GeneralTab';
import type { SettingsConfig } from '../../../shared/config-types';
import { DEFAULT_SETTINGS } from '../../../shared/config-types';

// Mock i18n
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'settings.appName': 'App Name',
        'settings.version': 'Version',
        'settings.connection': 'Connection',
        'settings.connected': 'Connected',
        'settings.disconnected': 'Disconnected',
        'settings.theme': 'Theme',
        'settings.themeLight': 'Light',
        'settings.themeDark': 'Dark',
        'settings.language': 'Language',
        'settings.defaultRounds': 'Default Rounds',
        'settings.softTokenLimit': 'Soft Token Limit',
        'settings.hardTokenLimit': 'Hard Token Limit',
        'settings.maxRetries': 'Max Retries',
        'settings.phaseTimeout': 'Phase Timeout (sec)',
        'settings.designatedAggregator': 'Designated Aggregator',
        'settings.aggregatorAuto': 'Auto (first AI)',
        'settings.unlimited': 'Unlimited',
        'app.save': 'Save',
        'settings.saved': 'Saved.',
      };
      return map[key] ?? key;
    },
  }),
}));

// Mock i18n module
vi.mock('../../i18n', () => ({
  default: { changeLanguage: vi.fn() },
}));

// Mock stores
const mockAppInfo = { name: 'Arena', version: '2.0.0' };
vi.mock('../../stores/app-store', () => ({
  useAppStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({ appInfo: mockAppInfo, connected: true }),
}));

vi.mock('../../stores/provider-store', () => ({
  useProviderStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({ providers: [{ id: 'p1', displayName: 'Claude' }], fetchProviders: vi.fn() }),
}));

vi.mock('../../hooks/useErrorDialog', () => ({
  showError: vi.fn(),
}));

const mockSettings: SettingsConfig = {
  ...DEFAULT_SETTINGS,
  defaultRounds: 3,
  softTokenLimit: 3000,
  hardTokenLimit: 4000,
};

const mockInvoke = vi.fn().mockResolvedValue({ settings: mockSettings });

beforeEach(() => {
  (window as Record<string, unknown>).arena = {
    invoke: mockInvoke,
    platform: 'linux',
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('GeneralTab', () => {
  it('renders default rounds field', async () => {
    render(<GeneralTab />);
    await waitFor(() => {
      expect(screen.getByText('Default Rounds')).toBeTruthy();
    });
    const allInputs = screen.getAllByDisplayValue('3');
    expect(allInputs.length).toBeGreaterThanOrEqual(1);
  });

  it('renders soft token limit field', async () => {
    render(<GeneralTab />);
    await waitFor(() => {
      expect(screen.getByText('Soft Token Limit')).toBeTruthy();
    });
    expect(screen.getByDisplayValue('3000')).toBeTruthy();
  });

  it('renders hard token limit field', async () => {
    render(<GeneralTab />);
    await waitFor(() => {
      expect(screen.getByText('Hard Token Limit')).toBeTruthy();
    });
    expect(screen.getByDisplayValue('4000')).toBeTruthy();
  });

  it('updates defaultRounds on change', async () => {
    render(<GeneralTab />);
    await waitFor(() => screen.getByText('Default Rounds'));
    // defaultRounds label's sibling input — find via label association
    const label = screen.getByText('Default Rounds');
    const row = label.closest('.settings-row')!;
    const input = row.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '5' } });
    expect(input.value).toBe('5');
  });

  it('updates softTokenLimit on change', async () => {
    render(<GeneralTab />);
    await waitFor(() => screen.getByText('Soft Token Limit'));
    const input = screen.getByDisplayValue('3000') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '5000' } });
    expect(input.value).toBe('5000');
  });

  it('does not render WSL distro (setting moved to per-provider config)', async () => {
    render(<GeneralTab />);
    await waitFor(() => screen.getByText('Default Rounds'));
    expect(screen.queryByText('WSL Distribution')).toBeNull();
  });

  it('renders existing fields (theme, language, retries, timeout, aggregator)', async () => {
    render(<GeneralTab />);
    await waitFor(() => screen.getByText('Theme'));
    expect(screen.getByText('Language')).toBeTruthy();
    expect(screen.getByText('Max Retries')).toBeTruthy();
    expect(screen.getByText('Phase Timeout (sec)')).toBeTruthy();
    expect(screen.getByText('Designated Aggregator')).toBeTruthy();
  });

  it('calls config:get-settings on mount', async () => {
    render(<GeneralTab />);
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('config:get-settings', undefined);
    });
  });

  it('calls config:update-settings on save', async () => {
    render(<GeneralTab />);
    await waitFor(() => screen.getByText('Save'));
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('config:update-settings', expect.objectContaining({ patch: expect.any(Object) }));
    });
  });
});
