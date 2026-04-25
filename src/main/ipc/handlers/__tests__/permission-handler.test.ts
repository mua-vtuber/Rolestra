import { describe, expect, it, vi, beforeEach } from 'vitest';

import {
  handlePermissionListRules,
  handlePermissionDryRunFlags,
  setPermissionServiceAccessor,
  setDryRunProjectCwdResolver,
} from '../permission-handler';

describe('handlePermissionListRules', () => {
  beforeEach(() => {
    setPermissionServiceAccessor(null as any);
  });

  it('returns empty rules when accessor is not set', () => {
    const result = handlePermissionListRules({});
    expect(result.rules).toEqual([]);
  });

  it('returns all rules', () => {
    const mockService = {
      getPermissions: vi.fn().mockReturnValue([
        { participantId: 'ai-1', folderPath: '/project', read: true, write: false, execute: false },
        { participantId: 'ai-2', folderPath: '/project', read: true, write: true, execute: true },
      ]),
    };
    setPermissionServiceAccessor(() => mockService as any);

    const result = handlePermissionListRules({});
    expect(result.rules).toHaveLength(2);
    expect(result.rules[0]).toEqual({
      aiId: 'ai-1',
      path: '/project',
      read: true,
      write: false,
      execute: false,
    });
  });

  it('filters by aiId', () => {
    const mockService = {
      getPermissions: vi.fn().mockReturnValue([
        { participantId: 'ai-1', folderPath: '/project', read: true, write: false, execute: false },
        { participantId: 'ai-2', folderPath: '/project', read: true, write: true, execute: true },
      ]),
    };
    setPermissionServiceAccessor(() => mockService as any);

    const result = handlePermissionListRules({ aiId: 'ai-2' });
    expect(result.rules).toHaveLength(1);
    expect(result.rules[0].aiId).toBe('ai-2');
  });

  it('returns empty when no matching aiId', () => {
    const mockService = {
      getPermissions: vi.fn().mockReturnValue([
        { participantId: 'ai-1', folderPath: '/project', read: true, write: false, execute: false },
      ]),
    };
    setPermissionServiceAccessor(() => mockService as any);

    const result = handlePermissionListRules({ aiId: 'nonexistent' });
    expect(result.rules).toHaveLength(0);
  });

  it('maps FilePermission fields to response shape', () => {
    const mockService = {
      getPermissions: vi.fn().mockReturnValue([
        { participantId: 'test-ai', folderPath: '/some/path', read: false, write: true, execute: false },
      ]),
    };
    setPermissionServiceAccessor(() => mockService as any);

    const result = handlePermissionListRules({});
    expect(result.rules[0]).toEqual({
      aiId: 'test-ai',
      path: '/some/path',
      read: false,
      write: true,
      execute: false,
    });
  });
});

describe('permission-handler', () => {
  it('resolves request promise when approved', async () => {
    vi.resetModules();
    const mod = await import('../permission-handler');

    const pending = mod.requestPermissionApproval({
      conversationId: 'conv-1',
      participantId: 'ai-1',
      action: 'read',
      targetPath: 'C:/repo/file.txt',
      reason: 'Read permission denied',
    });

    const listed = mod.handlePermissionListPending();
    expect(listed.requests).toHaveLength(1);

    const requestId = listed.requests[0].requestId;
    const approveResult = mod.handlePermissionApprove({ requestId });
    expect(approveResult.success).toBe(true);

    await expect(pending).resolves.toBe(true);
  });

  it('resolves request promise with false when rejected', async () => {
    vi.resetModules();
    const mod = await import('../permission-handler');

    const pending = mod.requestPermissionApproval({
      conversationId: 'conv-1',
      participantId: 'ai-1',
      action: 'write',
      targetPath: '/etc/passwd',
      reason: 'Write permission denied',
    });

    const listed = mod.handlePermissionListPending();
    expect(listed.requests).toHaveLength(1);

    const requestId = listed.requests[0].requestId;
    const rejectResult = mod.handlePermissionReject({ requestId });
    expect(rejectResult.success).toBe(true);

    await expect(pending).resolves.toBe(false);
  });

  it('approve non-existent request — returns success: false with error', async () => {
    vi.resetModules();
    const mod = await import('../permission-handler');

    const result = mod.handlePermissionApprove({ requestId: 'nonexistent-id' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('No pending permission request');
  });

  it('reject non-existent request — returns success: false with error', async () => {
    vi.resetModules();
    const mod = await import('../permission-handler');

    const result = mod.handlePermissionReject({ requestId: 'nonexistent-id' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('No pending permission request');
  });

  it('double approve — second attempt returns failure', async () => {
    vi.resetModules();
    const mod = await import('../permission-handler');

    mod.requestPermissionApproval({
      conversationId: 'conv-1',
      participantId: 'ai-1',
      action: 'read',
      targetPath: '/tmp/file.txt',
      reason: 'Access denied',
    });

    const listed = mod.handlePermissionListPending();
    const requestId = listed.requests[0].requestId;

    // First approve succeeds
    const first = mod.handlePermissionApprove({ requestId });
    expect(first.success).toBe(true);

    // Second approve fails — already consumed
    const second = mod.handlePermissionApprove({ requestId });
    expect(second.success).toBe(false);
    expect(second.error).toContain('No pending permission request');
  });

  it('list-pending returns empty when no requests', async () => {
    vi.resetModules();
    const mod = await import('../permission-handler');

    const listed = mod.handlePermissionListPending();
    expect(listed.requests).toHaveLength(0);
  });
});

// ── R10-Task5: permission:dry-run-flags ─────────────────────────

describe('handlePermissionDryRunFlags', () => {
  beforeEach(() => {
    setDryRunProjectCwdResolver(() => '/tmp/proj');
  });

  it('claude_cli + auto + new + opt-in=false → matrix flags', () => {
    const out = handlePermissionDryRunFlags({
      providerType: 'claude_cli',
      permissionMode: 'auto',
      projectKind: 'new',
      dangerousAutonomyOptIn: false,
    });
    expect(out.blocked).toBe(false);
    expect(out.flags).toContain('--allowedTools');
    expect(out.flags).toContain('Read,Glob,Grep,Edit,Write,Bash,WebSearch,WebFetch');
    expect(out.flags).not.toContain('--dangerously-skip-permissions');
  });

  it('claude_cli + auto + new + opt-in=true → adds --dangerously-skip-permissions', () => {
    const out = handlePermissionDryRunFlags({
      providerType: 'claude_cli',
      permissionMode: 'auto',
      projectKind: 'new',
      dangerousAutonomyOptIn: true,
    });
    expect(out.flags).toContain('--dangerously-skip-permissions');
  });

  it('codex_cli + hybrid + imported → --full-auto', () => {
    const out = handlePermissionDryRunFlags({
      providerType: 'codex_cli',
      permissionMode: 'hybrid',
      projectKind: 'imported',
      dangerousAutonomyOptIn: false,
    });
    expect(out.blocked).toBe(false);
    expect(out.flags).toContain('--full-auto');
    expect(out.flags).toContain('-C');
    expect(out.flags).toContain('/tmp/proj');
  });

  it('gemini_cli + approval + external → --approval-mode default', () => {
    const out = handlePermissionDryRunFlags({
      providerType: 'gemini_cli',
      permissionMode: 'approval',
      projectKind: 'external',
      dangerousAutonomyOptIn: false,
    });
    expect(out.blocked).toBe(false);
    expect(out.flags).toEqual(['--approval-mode', 'default']);
  });

  it('claude_api + auto + new → blocked=true (unknown_provider_type)', () => {
    const out = handlePermissionDryRunFlags({
      providerType: 'claude_api',
      permissionMode: 'auto',
      projectKind: 'new',
      dangerousAutonomyOptIn: false,
    });
    expect(out.blocked).toBe(true);
    expect(out.blockedReason).toBe('unknown_provider_type');
    expect(out.flags).toEqual([]);
  });

  it('mock provider → blocked=true (unknown_provider_type)', () => {
    const out = handlePermissionDryRunFlags({
      providerType: 'mock',
      permissionMode: 'hybrid',
      projectKind: 'new',
      dangerousAutonomyOptIn: false,
    });
    expect(out.blocked).toBe(true);
    expect(out.blockedReason).toBe('unknown_provider_type');
  });

  it('claude_cli + auto + external → blocked=true (external_auto_forbidden, even though zod normally rejects this)', () => {
    // Builder safety net — defends Main-side direct calls that bypass zod.
    const out = handlePermissionDryRunFlags({
      providerType: 'claude_cli',
      permissionMode: 'auto',
      projectKind: 'external',
      dangerousAutonomyOptIn: false,
    });
    expect(out.blocked).toBe(true);
    expect(out.blockedReason).toBe('external_auto_forbidden');
  });
});

