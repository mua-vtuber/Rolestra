/**
 * Tests for ConversationTaskTab — verifies conversationTask settings render and update.
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { ConversationTaskTab } from '../settings/ConversationTaskTab';
import type { SettingsConfig } from '../../../shared/config-types';
import { DEFAULT_SETTINGS } from '../../../shared/config-types';

// Mock i18n
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'settings.conversationTaskSettings.description': 'Manage conversation/task policy settings.',
        'settings.conversationTaskSettings.deepDebateTurnBudget': 'Deep Debate Turn Budget',
        'settings.conversationTaskSettings.aiDecisionParseRetryLimit': 'AI Decision Parse Retries',
        'settings.conversationTaskSettings.twoParticipantUnanimousRequired': 'Require Unanimity for 2 Participants',
        'settings.conversationTaskSettings.majorityAllowedFromParticipants': 'Majority Allowed Min Participants',
        'settings.conversationTaskSettings.hardBlockReasons': 'Hard Block Reasons',
        'settings.conversationTaskSettings.softBlockReasons': 'Soft Block Reasons',
        'app.save': 'Save',
        'settings.saved': 'Saved.',
      };
      return map[key] ?? key;
    },
  }),
}));

vi.mock('../../hooks/useErrorDialog', () => ({
  showError: vi.fn(),
}));

const mockSettings: SettingsConfig = { ...DEFAULT_SETTINGS };
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

describe('ConversationTaskTab', () => {
  it('renders description text', async () => {
    render(<ConversationTaskTab />);
    await waitFor(() => {
      expect(screen.getByText('Manage conversation/task policy settings.')).toBeTruthy();
    });
  });

  it('renders deep debate turn budget', async () => {
    render(<ConversationTaskTab />);
    await waitFor(() => {
      expect(screen.getByText('Deep Debate Turn Budget')).toBeTruthy();
    });
    expect(screen.getByDisplayValue('30')).toBeTruthy();
  });

  it('renders AI decision parse retry limit', async () => {
    render(<ConversationTaskTab />);
    await waitFor(() => {
      expect(screen.getByText('AI Decision Parse Retries')).toBeTruthy();
    });
    expect(screen.getByDisplayValue('2')).toBeTruthy();
  });

  it('renders two-participant unanimity checkbox (checked)', async () => {
    render(<ConversationTaskTab />);
    await waitFor(() => {
      expect(screen.getByText('Require Unanimity for 2 Participants')).toBeTruthy();
    });
    const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
  });

  it('renders majority allowed min participants', async () => {
    render(<ConversationTaskTab />);
    await waitFor(() => {
      expect(screen.getByText('Majority Allowed Min Participants')).toBeTruthy();
    });
    expect(screen.getByDisplayValue('3')).toBeTruthy();
  });

  it('renders hard block reason chips', async () => {
    render(<ConversationTaskTab />);
    await waitFor(() => {
      expect(screen.getByText('Hard Block Reasons')).toBeTruthy();
    });
    expect(screen.getByText('security')).toBeTruthy();
    expect(screen.getByText('data_loss')).toBeTruthy();
  });

  it('renders soft block reason chips', async () => {
    render(<ConversationTaskTab />);
    await waitFor(() => {
      expect(screen.getByText('Soft Block Reasons')).toBeTruthy();
    });
    expect(screen.getByText('spec_conflict')).toBeTruthy();
    expect(screen.getByText('unknown')).toBeTruthy();
  });

  it('updates deepDebateTurnBudget on change', async () => {
    render(<ConversationTaskTab />);
    await waitFor(() => screen.getByDisplayValue('30'));
    const input = screen.getByDisplayValue('30') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '50' } });
    expect(input.value).toBe('50');
  });

  it('toggles unanimity checkbox', async () => {
    render(<ConversationTaskTab />);
    await waitFor(() => screen.getByRole('checkbox'));
    const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(false);
  });

  it('calls config:update-settings on save', async () => {
    render(<ConversationTaskTab />);
    await waitFor(() => screen.getByText('Save'));
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('config:update-settings', expect.objectContaining({ patch: expect.any(Object) }));
    });
  });

  it('shows saved message after save', async () => {
    render(<ConversationTaskTab />);
    await waitFor(() => screen.getByText('Save'));
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => {
      expect(screen.getByText('Saved.')).toBeTruthy();
    });
  });
});
