import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { RemoteAuth } from '../remote-auth';
import { RemoteSessionTracker } from '../remote-session';
import { RemoteAuditLogger } from '../remote-audit';
import migration001 from '../../database/migrations/001-initial-schema';
import migration003 from '../../database/migrations/003-remote-tables';
import type { RemotePermissionSet } from '../../../shared/remote-types';

// ── Helpers ──────────────────────────────────────────────────────────

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(migration001.sql);
  db.exec(migration003.sql);
  return db;
}

const readOnlyPermissions: RemotePermissionSet = {
  read: { enabled: true },
  write: { enabled: false },
  execute: { enabled: false },
};

const fullPermissions: RemotePermissionSet = {
  read: { enabled: true, scopes: ['conversations', 'memory'] },
  write: { enabled: true, scopes: ['conversations'] },
  execute: { enabled: true, allowedCommands: ['ls', 'cat'] },
};

// ── RemoteAuth ───────────────────────────────────────────────────────

describe('RemoteAuth', () => {
  let db: Database.Database;
  let auth: RemoteAuth;

  beforeEach(() => {
    db = createTestDb();
    auth = new RemoteAuth(db);
  });

  it('should return token and grantId on generateToken', () => {
    const result = auth.generateToken(readOnlyPermissions, 'test token');

    expect(result.token).toBeDefined();
    expect(result.grantId).toBeDefined();
    expect(typeof result.token).toBe('string');
    expect(typeof result.grantId).toBe('string');
  });

  it('should generate a token that is 64 hex characters', () => {
    const { token } = auth.generateToken(readOnlyPermissions);

    expect(token).toHaveLength(64);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('should validate a valid token successfully', () => {
    const { token } = auth.generateToken(readOnlyPermissions, 'my token');

    const result = auth.validateToken(token);

    expect(result).not.toBeNull();
    expect(result?.valid).toBe(true);
    expect(result?.permissions.read.enabled).toBe(true);
    expect(result?.permissions.write.enabled).toBe(false);
  });

  it('should return null for an invalid token', () => {
    auth.generateToken(readOnlyPermissions);

    const result = auth.validateToken('not-a-real-token');

    expect(result).toBeNull();
  });

  it('should update last_used_at on validateToken', () => {
    const { token, grantId } = auth.generateToken(readOnlyPermissions);

    // Verify last_used_at is null initially
    const rowBefore = db
      .prepare('SELECT last_used_at FROM remote_access_grants WHERE grant_id = ?')
      .get(grantId) as { last_used_at: number | null };
    expect(rowBefore.last_used_at).toBeNull();

    auth.validateToken(token);

    const rowAfter = db
      .prepare('SELECT last_used_at FROM remote_access_grants WHERE grant_id = ?')
      .get(grantId) as { last_used_at: number | null };
    expect(rowAfter.last_used_at).not.toBeNull();
    expect(typeof rowAfter.last_used_at).toBe('number');
  });

  it('should return null for an expired token', () => {
    const pastTimestamp = Date.now() - 60_000; // 1 minute ago
    const { token } = auth.generateToken(readOnlyPermissions, 'expired', pastTimestamp);

    const result = auth.validateToken(token);

    expect(result).toBeNull();
  });

  it('should revoke a token successfully', () => {
    const { token, grantId } = auth.generateToken(readOnlyPermissions);

    const revoked = auth.revokeToken(grantId);
    expect(revoked).toBe(true);

    // Token should no longer validate
    const result = auth.validateToken(token);
    expect(result).toBeNull();
  });

  it('should return false when revoking a non-existent grant', () => {
    const revoked = auth.revokeToken('non-existent-grant-id');

    expect(revoked).toBe(false);
  });

  it('should list all grants', () => {
    auth.generateToken(readOnlyPermissions, 'token 1');
    auth.generateToken(fullPermissions, 'token 2');

    const grants = auth.listGrants();

    expect(grants).toHaveLength(2);
    expect(grants[0].description).toBe('token 1');
    expect(grants[1].description).toBe('token 2');
  });

  it('should handle multiple tokens independently', () => {
    const { token: token1 } = auth.generateToken(readOnlyPermissions, 'first');
    const { token: token2, grantId: grantId2 } = auth.generateToken(fullPermissions, 'second');

    // Revoke only the second token
    auth.revokeToken(grantId2);

    // First token should still be valid
    const result1 = auth.validateToken(token1);
    expect(result1).not.toBeNull();
    expect(result1?.valid).toBe(true);

    // Second token should be invalid
    const result2 = auth.validateToken(token2);
    expect(result2).toBeNull();
  });

  it('should round-trip permissions correctly via JSON', () => {
    const { token } = auth.generateToken(fullPermissions, 'full');

    const result = auth.validateToken(token);

    expect(result).not.toBeNull();
    expect(result?.permissions).toEqual(fullPermissions);
    expect(result?.permissions.read.scopes).toEqual(['conversations', 'memory']);
    expect(result?.permissions.write.scopes).toEqual(['conversations']);
    expect(result?.permissions.execute.allowedCommands).toEqual(['ls', 'cat']);
  });

  it('should store the token hash, not plaintext', () => {
    const { token, grantId } = auth.generateToken(readOnlyPermissions);

    const row = db
      .prepare('SELECT token_hash FROM remote_access_grants WHERE grant_id = ?')
      .get(grantId) as { token_hash: string };

    // The stored hash should NOT be the plaintext token
    expect(row.token_hash).not.toBe(token);

    // It should be the SHA-256 of the token
    const expectedHash = createHash('sha256').update(token).digest('hex');
    expect(row.token_hash).toBe(expectedHash);
  });
});

// ── RemoteSessionTracker ─────────────────────────────────────────────

describe('RemoteSessionTracker', () => {
  let tracker: RemoteSessionTracker;

  beforeEach(() => {
    tracker = new RemoteSessionTracker();
  });

  it('should create a session with correct fields', () => {
    const session = tracker.createSession('tailscale', '10.0.0.1', readOnlyPermissions);

    expect(session.sessionId).toBeDefined();
    expect(session.mode).toBe('tailscale');
    expect(session.remoteIp).toBe('10.0.0.1');
    expect(session.permissions).toEqual(readOnlyPermissions);
    expect(session.connectedAt).toBeLessThanOrEqual(Date.now());
    expect(session.lastActivityAt).toBe(session.connectedAt);
  });

  it('should return a session by ID', () => {
    const created = tracker.createSession('direct', '192.168.1.1', readOnlyPermissions);

    const retrieved = tracker.getSession(created.sessionId);

    expect(retrieved).not.toBeNull();
    expect(retrieved?.sessionId).toBe(created.sessionId);
    expect(retrieved?.mode).toBe('direct');
  });

  it('should return null for an unknown session ID', () => {
    const result = tracker.getSession('non-existent-session');

    expect(result).toBeNull();
  });

  it('should update lastActivityAt on touchSession', () => {
    const session = tracker.createSession('tailscale', '10.0.0.1', readOnlyPermissions);
    const originalActivity = session.lastActivityAt;

    // Small delay to ensure timestamp differs
    vi.useFakeTimers();
    vi.advanceTimersByTime(1000);

    tracker.touchSession(session.sessionId);

    const updated = tracker.getSession(session.sessionId);
    expect(updated?.lastActivityAt).toBeGreaterThan(originalActivity);

    vi.useRealTimers();
  });

  it('should terminate (remove) a session', () => {
    const session = tracker.createSession('direct', '192.168.1.1', readOnlyPermissions);

    const removed = tracker.terminateSession(session.sessionId);
    expect(removed).toBe(true);

    const result = tracker.getSession(session.sessionId);
    expect(result).toBeNull();
  });

  it('should return false when terminating an unknown session', () => {
    const removed = tracker.terminateSession('does-not-exist');

    expect(removed).toBe(false);
  });

  it('should return all active sessions', () => {
    tracker.createSession('tailscale', '10.0.0.1', readOnlyPermissions);
    tracker.createSession('direct', '192.168.1.2', fullPermissions);
    tracker.createSession('tailscale', '10.0.0.3', readOnlyPermissions);

    const sessions = tracker.getSessions();

    expect(sessions).toHaveLength(3);
  });

  it('should remove expired sessions on cleanup', () => {
    vi.useFakeTimers();

    // Create two sessions
    const old = tracker.createSession('tailscale', '10.0.0.1', readOnlyPermissions);
    const fresh = tracker.createSession('direct', '192.168.1.1', readOnlyPermissions);

    // Advance time by 31 minutes
    vi.advanceTimersByTime(31 * 60 * 1000);

    // Touch only the "fresh" session to keep it alive
    tracker.touchSession(fresh.sessionId);

    // Cleanup with 30-minute timeout
    const removed = tracker.cleanupExpired(30);

    expect(removed).toHaveLength(1);
    expect(removed[0]).toBe(old.sessionId);

    // Old session should be gone
    expect(tracker.getSession(old.sessionId)).toBeNull();
    // Fresh session should still exist
    expect(tracker.getSession(fresh.sessionId)).not.toBeNull();

    vi.useRealTimers();
  });

  it('should keep all sessions when none are expired', () => {
    tracker.createSession('tailscale', '10.0.0.1', readOnlyPermissions);
    tracker.createSession('direct', '192.168.1.1', readOnlyPermissions);

    const removed = tracker.cleanupExpired(30);

    expect(removed).toHaveLength(0);
    expect(tracker.getSessions()).toHaveLength(2);
  });

  it('should maintain sessions independently', () => {
    const s1 = tracker.createSession('tailscale', '10.0.0.1', readOnlyPermissions);
    const s2 = tracker.createSession('direct', '192.168.1.1', fullPermissions);

    // Terminate only s1
    tracker.terminateSession(s1.sessionId);

    expect(tracker.getSession(s1.sessionId)).toBeNull();
    expect(tracker.getSession(s2.sessionId)).not.toBeNull();
    expect(tracker.getSessions()).toHaveLength(1);
  });

  // ── Token-based session reuse ─────────────────────────────────────
  describe('findOrCreateSession', () => {
    it('creates a new session when no matching token exists', () => {
      const session = tracker.findOrCreateSession('hash-1', 'direct', '10.0.0.1', readOnlyPermissions);
      expect(session.sessionId).toBeDefined();
      expect(session.tokenHash).toBe('hash-1');
      expect(tracker.getSessions()).toHaveLength(1);
    });

    it('returns existing session for same token hash', () => {
      const first = tracker.findOrCreateSession('hash-1', 'direct', '10.0.0.1', readOnlyPermissions);
      const second = tracker.findOrCreateSession('hash-1', 'direct', '10.0.0.1', readOnlyPermissions);

      expect(second.sessionId).toBe(first.sessionId);
      expect(tracker.getSessions()).toHaveLength(1);
    });

    it('updates lastActivityAt on reuse', () => {
      vi.useFakeTimers();
      const first = tracker.findOrCreateSession('hash-1', 'direct', '10.0.0.1', readOnlyPermissions);
      const originalActivity = first.lastActivityAt;

      vi.advanceTimersByTime(5000);
      const second = tracker.findOrCreateSession('hash-1', 'direct', '10.0.0.1', readOnlyPermissions);

      expect(second.lastActivityAt).toBeGreaterThan(originalActivity);
      vi.useRealTimers();
    });

    it('creates separate sessions for different token hashes', () => {
      tracker.findOrCreateSession('hash-1', 'direct', '10.0.0.1', readOnlyPermissions);
      tracker.findOrCreateSession('hash-2', 'direct', '10.0.0.2', fullPermissions);

      expect(tracker.getSessions()).toHaveLength(2);
    });
  });
});

// ── RemoteAuditLogger ────────────────────────────────────────────────

describe('RemoteAuditLogger', () => {
  let db: Database.Database;
  let audit: RemoteAuditLogger;

  beforeEach(() => {
    db = createTestDb();
    audit = new RemoteAuditLogger(db);
  });

  it('should create an entry in the DB', () => {
    audit.log({
      sessionId: 'sess-1',
      remoteIp: '10.0.0.1',
      action: 'remote:ping',
      result: 'success',
    });

    const rows = db.prepare('SELECT * FROM remote_audit_log').all();
    expect(rows).toHaveLength(1);
  });

  it('should auto-generate auditId and timestamp', () => {
    audit.log({
      sessionId: 'sess-1',
      remoteIp: '10.0.0.1',
      action: 'remote:ping',
      result: 'success',
    });

    const entries = audit.getLog();
    expect(entries).toHaveLength(1);
    expect(entries[0].auditId).toBeDefined();
    expect(typeof entries[0].auditId).toBe('string');
    expect(entries[0].timestamp).toBeDefined();
    expect(typeof entries[0].timestamp).toBe('number');
  });

  it('should return all entries with getLog', () => {
    audit.log({
      sessionId: 'sess-1',
      remoteIp: '10.0.0.1',
      action: 'remote:ping',
      result: 'success',
    });
    audit.log({
      sessionId: 'sess-2',
      remoteIp: '10.0.0.2',
      action: 'remote:conversations:list',
      result: 'denied',
      denialReason: 'insufficient permissions',
    });

    const entries = audit.getLog();
    expect(entries).toHaveLength(2);
  });

  it('should filter by action', () => {
    audit.log({
      sessionId: 'sess-1',
      remoteIp: '10.0.0.1',
      action: 'remote:ping',
      result: 'success',
    });
    audit.log({
      sessionId: 'sess-1',
      remoteIp: '10.0.0.1',
      action: 'remote:conversations:list',
      result: 'success',
    });
    audit.log({
      sessionId: 'sess-2',
      remoteIp: '10.0.0.2',
      action: 'remote:ping',
      result: 'denied',
    });

    const pingEntries = audit.getLog({ action: 'remote:ping' });
    expect(pingEntries).toHaveLength(2);
    expect(pingEntries.every((e) => e.action === 'remote:ping')).toBe(true);
  });

  it('should filter by time range', () => {
    const baseTime = Date.now();

    // Insert entries with specific timestamps directly
    db.prepare(
      `INSERT INTO remote_audit_log
         (audit_id, timestamp, session_id, remote_ip, action, resource, result, denial_reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('a1', baseTime - 2000, 'sess-1', '10.0.0.1', 'action-old', null, 'success', null);

    db.prepare(
      `INSERT INTO remote_audit_log
         (audit_id, timestamp, session_id, remote_ip, action, resource, result, denial_reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('a2', baseTime, 'sess-1', '10.0.0.1', 'action-mid', null, 'success', null);

    db.prepare(
      `INSERT INTO remote_audit_log
         (audit_id, timestamp, session_id, remote_ip, action, resource, result, denial_reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('a3', baseTime + 2000, 'sess-1', '10.0.0.1', 'action-new', null, 'success', null);

    const entries = audit.getLog({
      startTime: baseTime - 500,
      endTime: baseTime + 500,
    });

    expect(entries).toHaveLength(1);
    expect(entries[0].action).toBe('action-mid');
  });

  it('should filter by sessionId', () => {
    audit.log({
      sessionId: 'sess-1',
      remoteIp: '10.0.0.1',
      action: 'remote:ping',
      result: 'success',
    });
    audit.log({
      sessionId: 'sess-2',
      remoteIp: '10.0.0.2',
      action: 'remote:ping',
      result: 'success',
    });
    audit.log({
      sessionId: 'sess-1',
      remoteIp: '10.0.0.1',
      action: 'remote:conversations:list',
      result: 'success',
    });

    const entries = audit.getLog({ sessionId: 'sess-1' });
    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.sessionId === 'sess-1')).toBe(true);
  });

  it('should return correct count with getLogCount', () => {
    audit.log({
      sessionId: 'sess-1',
      remoteIp: '10.0.0.1',
      action: 'remote:ping',
      result: 'success',
    });
    audit.log({
      sessionId: 'sess-2',
      remoteIp: '10.0.0.2',
      action: 'remote:conversations:list',
      result: 'denied',
    });
    audit.log({
      sessionId: 'sess-1',
      remoteIp: '10.0.0.1',
      action: 'remote:memory:search',
      result: 'success',
    });

    expect(audit.getLogCount()).toBe(3);
  });

  it('should return empty array when no entries exist', () => {
    const entries = audit.getLog();
    expect(entries).toEqual([]);
    expect(audit.getLogCount()).toBe(0);
  });
});
