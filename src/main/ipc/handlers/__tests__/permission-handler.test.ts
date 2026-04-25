import { describe, expect, it, beforeEach } from 'vitest';

import {
  handlePermissionDryRunFlags,
  setDryRunProjectCwdResolver,
} from '../permission-handler';

// R11-Task2: the v2 `permission:list-pending|approve|reject|list-rules`
// surface (and the runtime promise resolver / `requestPermissionApproval`
// helpers behind it) was retired together with the v2 conversation
// engine. Their tests used to live above; ApprovalService now owns the
// v3 flow (covered by `approval-service.test.ts`).

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

