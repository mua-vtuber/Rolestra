// @vitest-environment jsdom
/* eslint-disable i18next/no-literal-string */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MemberProfileEditModal } from '../MemberProfileEditModal';
import { MemberProfileTrigger } from '../MemberProfileTrigger';
import { i18next } from '../../../i18n';
import type { MemberView } from '../../../../shared/member-profile-types';

if (typeof globalThis.ResizeObserver === 'undefined') {
  (globalThis as { ResizeObserver: unknown }).ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
}
if (typeof Element !== 'undefined') {
  const proto = Element.prototype as unknown as {
    hasPointerCapture?: (id: number) => boolean;
    releasePointerCapture?: (id: number) => void;
    setPointerCapture?: (id: number) => void;
  };
  proto.hasPointerCapture ??= () => false;
  proto.releasePointerCapture ??= () => {};
  proto.setPointerCapture ??= () => {};
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('chat character profile', () => {
  it('opens character editing without loading work role assignments', async () => {
    const member: MemberView = {
      providerId: 'ai-1', displayName: 'AI One',
      characterSheet: 'Role: Friend\nPersonality: Calm',
      avatarKind: 'default', avatarData: null,
      statusOverride: null, updatedAt: 1, workStatus: 'online',
    };
    const invoke = vi.fn(async (channel: string) => {
      switch (channel) {
        case 'member:get-profile': return { profile: member };
        case 'member:list-avatars': return { avatars: [] };
        case 'provider:list': return { providers: [] };
        default: throw new Error(`unexpected IPC: ${channel}`);
      }
    });
    vi.stubGlobal('arena', { platform: 'linux', invoke });
    render(<MemberProfileTrigger member={member}><button type="button">Open profile</button></MemberProfileTrigger>);
    fireEvent.click(screen.getByText('Open profile'));
    fireEvent.click(await screen.findByTestId('profile-popover-edit'));
    expect(await screen.findByTestId('profile-editor-dialog')).toBeTruthy();
    // The dialog reads provider:list for its connection controls (API key,
    // delete — spec 2026-10-01 R5-5), but never loads work role assignments.
    expect(screen.queryByTestId('profile-editor-tab-roles-skills')).toBeNull();
    expect(invoke.mock.calls.map(([channel]) => channel)
      .filter((channel) => /roles|department/i.test(channel))).toEqual([]);
  });

  it('edits the character sheet without invoking work role assignment or member:rename when the name is unchanged', async () => {
    void i18next.changeLanguage('ko');
    const invoke = vi.fn(async (channel: string, data?: unknown) => {
      switch (channel) {
        case 'member:get-profile': return { profile: {
          providerId: 'ai-1', characterSheet: 'Role: Friend\nPersonality: Calm',
          avatarKind: 'default', avatarData: null, statusOverride: null, updatedAt: 1,
        } };
        case 'member:list-avatars': return { avatars: [] };
        case 'provider:list': return { providers: [] };
        case 'member:update-profile': return { profile: { providerId: 'ai-1', ...(data as object) } };
        default: throw new Error(`unexpected IPC: ${channel}`);
      }
    });
    vi.stubGlobal('arena', { platform: 'linux', invoke });
    render(<MemberProfileEditModal open onOpenChange={() => {}}
      providerId="ai-1" displayName="AI One" />);
    const characterSheet = await screen.findByTestId('profile-editor-character-sheet');
    fireEvent.change(characterSheet, { target: { value: 'Role: Friend\nPersonality: Playful' } });
    fireEvent.click(screen.getByTestId('profile-editor-save'));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('member:update-profile', {
      providerId: 'ai-1', patch: { characterSheet: 'Role: Friend\nPersonality: Playful' },
    }));
    // Name field was left untouched ("AI One") — no rename call fired.
    expect(invoke.mock.calls.map(([channel]) => channel)).not.toContain('member:rename');
    expect(screen.queryByTestId('profile-editor-tab-roles-skills')).toBeNull();
    expect(invoke.mock.calls.map(([channel]) => channel).filter((channel) => channel === 'provider:updateRoles')).toEqual([]);
  });

  it('renames via member:rename when the name field changes, then saves the character sheet', async () => {
    const invoke = vi.fn(async (channel: string, data?: unknown) => {
      switch (channel) {
        case 'member:get-profile': return { profile: {
          providerId: 'ai-1', characterSheet: 'Role: Friend',
          avatarKind: 'default', avatarData: null, statusOverride: null, updatedAt: 1,
        } };
        case 'member:list-avatars': return { avatars: [] };
        case 'provider:list': return { providers: [] };
        case 'member:rename': return { provider: { id: 'ai-1', displayName: (data as { displayName: string }).displayName, type: 'api', model: 'm', capabilities: [], status: 'ready', config: {}, roles: [], skill_overrides: null, isDepartmentHead: {} } };
        default: throw new Error(`unexpected IPC: ${channel}`);
      }
    });
    vi.stubGlobal('arena', { platform: 'linux', invoke });
    render(<MemberProfileEditModal open onOpenChange={() => {}}
      providerId="ai-1" displayName="AI One" />);
    const nameInput = await screen.findByTestId('profile-editor-name');
    fireEvent.change(nameInput, { target: { value: 'AI Renamed' } });
    fireEvent.click(screen.getByTestId('profile-editor-save'));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('member:rename', {
      providerId: 'ai-1', displayName: 'AI Renamed',
    }));
    // Character sheet was unchanged — no member:update-profile call fired.
    expect(invoke.mock.calls.map(([channel]) => channel)).not.toContain('member:update-profile');
  });

  it('shows a dedicated duplicate-name message and keeps the modal open on member:rename collision', async () => {
    const duplicateErr = new Error('Display name already in use: Taken') as Error & { name: string };
    duplicateErr.name = 'DuplicateDisplayNameError';
    const invoke = vi.fn(async (channel: string) => {
      switch (channel) {
        case 'member:get-profile': return { profile: {
          providerId: 'ai-1', characterSheet: '',
          avatarKind: 'default', avatarData: null, statusOverride: null, updatedAt: 1,
        } };
        case 'member:list-avatars': return { avatars: [] };
        case 'provider:list': return { providers: [] };
        case 'member:rename': throw duplicateErr;
        default: throw new Error(`unexpected IPC: ${channel}`);
      }
    });
    vi.stubGlobal('arena', { platform: 'linux', invoke });
    render(<MemberProfileEditModal open onOpenChange={() => {}}
      providerId="ai-1" displayName="AI One" />);
    const nameInput = await screen.findByTestId('profile-editor-name');
    fireEvent.change(nameInput, { target: { value: 'Taken' } });
    fireEvent.click(screen.getByTestId('profile-editor-save'));
    expect(await screen.findByTestId('profile-editor-name-duplicate-error')).toBeTruthy();
    // The dialog is still mounted (onOpenChange was never called with false
    // in a way that would unmount it in this test harness).
    expect(screen.getByTestId('profile-editor-dialog')).toBeTruthy();
  });

  // QA High-1: in the real app Electron passes only the message, so the
  // collision is recognised from main's cause tag, not the error's name.
  it("recognises a duplicate name from main's cause tag after the error crossed IPC", async () => {
    const transported = new Error(
      "Error invoking remote method 'member:rename': IpcError: [INTERNAL_ERROR] {cause:duplicate-display-name} Display name already in use: Taken",
    );
    const invoke = vi.fn(async (channel: string) => {
      switch (channel) {
        case 'member:get-profile': return { profile: {
          providerId: 'ai-1', characterSheet: '',
          avatarKind: 'default', avatarData: null, statusOverride: null, updatedAt: 1,
        } };
        case 'member:list-avatars': return { avatars: [] };
        case 'provider:list': return { providers: [] };
        case 'member:rename': throw transported;
        default: throw new Error(`unexpected IPC: ${channel}`);
      }
    });
    vi.stubGlobal('arena', { platform: 'linux', invoke });
    render(<MemberProfileEditModal open onOpenChange={() => {}}
      providerId="ai-1" displayName="AI One" />);
    fireEvent.change(await screen.findByTestId('profile-editor-name'), { target: { value: 'Taken' } });
    fireEvent.click(screen.getByTestId('profile-editor-save'));
    expect(await screen.findByTestId('profile-editor-name-duplicate-error')).toBeTruthy();
  });
});
