/**
 * AIConfigModal component tests.
 *
 * Tests display name, persona, model fields, validate button behavior.
 */

// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { installArenaMock, makeProviderInfo } from './setup';
import type { InvokeMock } from './setup';

import { AIConfigModal } from '../settings/AIConfigModal';

describe('AIConfigModal', () => {
  let invoke: InvokeMock;

  beforeEach(() => {
    ({ invoke } = installArenaMock());
    invoke.mockResolvedValue({ models: [] });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders display name, persona, and model fields', () => {
    const provider = makeProviderInfo({ displayName: 'My AI', persona: 'friendly', model: 'gpt-4o' });
    render(<AIConfigModal provider={provider as any} onSave={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByDisplayValue('My AI')).toBeInTheDocument();
    expect(screen.getByDisplayValue('friendly')).toBeInTheDocument();
    expect(screen.getByDisplayValue('gpt-4o')).toBeInTheDocument();
  });

  it('calls onSave with trimmed values', () => {
    const onSave = vi.fn();
    const provider = makeProviderInfo({ displayName: '  Test  ', persona: ' hello ', model: 'gpt-4o' });
    render(<AIConfigModal provider={provider as any} onSave={onSave} onClose={vi.fn()} />);

    fireEvent.click(screen.getByText('app.save'));
    expect(onSave).toHaveBeenCalledWith('Test', 'hello', 'gpt-4o');
  });

  it('disables save when displayName is empty', () => {
    const provider = makeProviderInfo({ displayName: '' });
    render(<AIConfigModal provider={provider as any} onSave={vi.fn()} onClose={vi.fn()} />);

    const saveBtn = screen.getByText('app.save');
    expect(saveBtn).toBeDisabled();
  });

  it('calls onClose when cancel clicked', () => {
    const onClose = vi.fn();
    const provider = makeProviderInfo();
    render(<AIConfigModal provider={provider as any} onSave={vi.fn()} onClose={onClose} />);

    fireEvent.click(screen.getByText('app.cancel'));
    expect(onClose).toHaveBeenCalled();
  });

  it('shows validate button', () => {
    const provider = makeProviderInfo();
    render(<AIConfigModal provider={provider as any} onSave={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByText('provider.validate')).toBeInTheDocument();
  });

  it('shows success message on valid connection', async () => {
    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'provider:validate') return { valid: true };
      return { models: [] };
    });

    const provider = makeProviderInfo();
    render(<AIConfigModal provider={provider as any} onSave={vi.fn()} onClose={vi.fn()} />);

    fireEvent.click(screen.getByText('provider.validate'));

    await waitFor(() => {
      expect(screen.getByText('provider.validateSuccess')).toBeInTheDocument();
    });
  });

  it('shows failure message on invalid connection', async () => {
    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'provider:validate') return { valid: false, message: 'timeout' };
      return { models: [] };
    });

    const provider = makeProviderInfo();
    render(<AIConfigModal provider={provider as any} onSave={vi.fn()} onClose={vi.fn()} />);

    fireEvent.click(screen.getByText('provider.validate'));

    await waitFor(() => {
      expect(screen.getByText('provider.validateFailed')).toBeInTheDocument();
    });
  });

  it('shows failure message on exception', async () => {
    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'provider:validate') throw new Error('Network error');
      return { models: [] };
    });

    const provider = makeProviderInfo();
    render(<AIConfigModal provider={provider as any} onSave={vi.fn()} onClose={vi.fn()} />);

    fireEvent.click(screen.getByText('provider.validate'));

    await waitFor(() => {
      expect(screen.getByText('provider.validateFailed')).toBeInTheDocument();
    });
  });
});
