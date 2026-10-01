// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CreateRoom } from '../CreateRoom';
import { i18next } from '../../../i18n';

vi.mock('../../../hooks/use-members', () => ({ useMembers: () => ({ members: [
  { providerId: 'ai-a', displayName: 'Alice', characterSheet: 'Role: Detective\nPersonality: Calm' },
  { providerId: 'ai-b', displayName: 'Bob', characterSheet: 'Role: Writer\nPersonality: Curious' },
] }) }));
vi.mock('../../../hooks/channel-invalidation-bus', () => ({ notifyChannelsChanged: vi.fn(async () => {}) }));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('CreateRoom', () => {
  it('creates a project-free room with default and custom personas together', async () => {
    await i18next.changeLanguage('ko');
    const invoke = vi.fn(async () => ({ room: { id: 'room-1' } }));
    vi.stubGlobal('arena', { invoke });
    const created = vi.fn();
    render(<CreateRoom open onOpenChange={() => {}} onCreated={created} />);
    expect(screen.getByTestId('room-create-submit').hasAttribute('disabled')).toBe(true);
    fireEvent.change(screen.getByTestId('room-create-name'), { target: { value: 'Mystery' } });
    fireEvent.click(screen.getByTestId('room-participant-ai-a'));
    fireEvent.click(screen.getByTestId('room-participant-ai-b'));
    fireEvent.change(screen.getByTestId('room-persona-source-ai-b'), { target: { value: 'custom' } });
    fireEvent.change(screen.getByTestId('room-persona-text-ai-b'), { target: { value: 'A cheerful witness' } });
    fireEvent.click(screen.getByTestId('room-create-submit'));
    await waitFor(() => expect(created).toHaveBeenCalledWith('room-1'));
    expect(invoke).toHaveBeenCalledWith('room:create', {
      name: 'Mystery', participants: [
        { providerId: 'ai-a', personaSource: 'default' },
        { providerId: 'ai-b', personaSource: 'custom', customPersona: 'A cheerful witness' },
      ],
    });
  });

  it('keeps the draft after registration failure and blocks empty custom persona', async () => {
    const invoke = vi.fn(async () => { throw new Error('database unavailable'); });
    vi.stubGlobal('arena', { invoke });
    render(<CreateRoom open onOpenChange={() => {}} onCreated={() => {}} />);
    fireEvent.change(screen.getByTestId('room-create-name'), { target: { value: 'Draft' } });
    fireEvent.click(screen.getByTestId('room-participant-ai-a'));
    fireEvent.change(screen.getByTestId('room-persona-source-ai-a'), { target: { value: 'custom' } });
    fireEvent.change(screen.getByTestId('room-persona-text-ai-a'), { target: { value: ' ' } });
    expect(screen.getByTestId('room-create-submit').hasAttribute('disabled')).toBe(true);
    fireEvent.change(screen.getByTestId('room-persona-text-ai-a'), { target: { value: 'Detective' } });
    fireEvent.click(screen.getByTestId('room-create-submit'));
    expect(await screen.findByTestId('room-create-error')).toBeTruthy();
    expect((screen.getByTestId('room-create-name') as HTMLInputElement).value).toBe('Draft');
  });
});
