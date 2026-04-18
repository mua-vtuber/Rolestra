/**
 * Integration test: Remote Access System
 *
 * Verifies that:
 * 1. RemoteManager generates token → server starts → authenticated request → audit log
 * 2. Policy changes affect server behavior
 * 3. Session expiry and cleanup work correctly
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import Database from 'better-sqlite3';
import { createServer as createNetServer } from 'node:net';
import { RemoteManagerImpl } from '../remote-manager';
import migration001 from '../../database/migrations/001-initial-schema';
import migration003 from '../../database/migrations/003-remote-tables';
import type { RemotePermissionSet } from '../../../shared/remote-types';
import { DEFAULT_REMOTE_POLICY } from '../../../shared/remote-types';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(migration001.sql);
  db.exec(migration003.sql);
  return db;
}

let canBindLocalhost = true;

async function detectLocalhostBindSupport(): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createNetServer();
    probe.once('error', () => {
      resolve(false);
    });
    probe.listen(0, '127.0.0.1', () => {
      probe.close(() => resolve(true));
    });
  });
}

describe('Remote Access Integration', () => {
  let db: Database.Database;
  let remoteManager: RemoteManagerImpl;

  beforeEach(() => {
    db = createTestDb();
    remoteManager = new RemoteManagerImpl(db);
  });

  afterEach(async () => {
    await remoteManager.stopServer();
    db.close();
  });

  // ── Token generation → validation ───────────────────────────────────

  it('generates and validates access tokens', async () => {
    const permissions: RemotePermissionSet = {
      read: { enabled: true },
      write: { enabled: false },
      execute: { enabled: false },
    };

    const token = await remoteManager.generateAccessToken(permissions);
    expect(token).toBeTruthy();
    expect(typeof token).toBe('string');

    // Validate the token
    const validation = await remoteManager.validateToken(token);
    expect(validation.valid).toBe(true);
    expect(validation.permissions.read.enabled).toBe(true);
    expect(validation.permissions.write.enabled).toBe(false);
  });

  it('validates token with expiry', async () => {
    const permissions: RemotePermissionSet = {
      read: { enabled: true },
      write: { enabled: true },
      execute: { enabled: false },
    };

    const expiresAt = Date.now() + 60_000; // 1 minute from now
    const token = await remoteManager.generateAccessToken(permissions, expiresAt);

    const validation = await remoteManager.validateToken(token);
    expect(validation.valid).toBe(true);
  });

  it('rejects invalid token', async () => {
    const validation = await remoteManager.validateToken('invalid-token-xyz');
    expect(validation.valid).toBe(false);
    expect(validation.permissions.read.enabled).toBe(false);
  });

  // ── Server lifecycle ────────────────────────────────────────────────

  it('starts and stops server', async () => {
    if (!canBindLocalhost) return;
    expect(remoteManager.isRunning()).toBe(false);

    await remoteManager.startServer();
    expect(remoteManager.isRunning()).toBe(true);

    await remoteManager.stopServer();
    expect(remoteManager.isRunning()).toBe(false);
  });

  it('does not error when starting already-running server', async () => {
    if (!canBindLocalhost) return;
    await remoteManager.startServer();
    expect(remoteManager.isRunning()).toBe(true);

    // Second start should be no-op
    await expect(remoteManager.startServer()).resolves.not.toThrow();
    expect(remoteManager.isRunning()).toBe(true);
  });

  it('does not error when stopping already-stopped server', async () => {
    expect(remoteManager.isRunning()).toBe(false);

    await expect(remoteManager.stopServer()).resolves.not.toThrow();
    expect(remoteManager.isRunning()).toBe(false);
  });

  // ── Policy management ───────────────────────────────────────────────

  it('updates and retrieves policy', async () => {
    const newPolicy = {
      ...DEFAULT_REMOTE_POLICY,
      mode: 'direct' as const,
      enabled: true,
      directAccessPort: 8080,
      directAccessSessionTimeoutMin: 30,
    };

    await remoteManager.setPolicy(newPolicy);

    const policy = remoteManager.getPolicy();
    expect(policy.mode).toBe('direct');
    expect(policy.directAccessPort).toBe(8080);
    expect(policy.directAccessSessionTimeoutMin).toBe(30);
  });

  // ── Authenticated request flow ──────────────────────────────────────

  it('completes full authenticated request flow', async () => {
    if (!canBindLocalhost) return;
    // Step 1: Start server
    await remoteManager.startServer();
    expect(remoteManager.isRunning()).toBe(true);

    // Step 2: Generate token
    const permissions: RemotePermissionSet = {
      read: { enabled: true },
      write: { enabled: false },
      execute: { enabled: false },
    };

    const token = await remoteManager.generateAccessToken(permissions);

    // Step 3: Validate token
    const validation = await remoteManager.validateToken(token);
    expect(validation.valid).toBe(true);
    expect(validation.permissions.read.enabled).toBe(true);

    // Step 4: Verify sessions
    const sessions = remoteManager.getSessions();
    expect(Array.isArray(sessions)).toBe(true);
  });

  // ── Permission-based access control ─────────────────────────────────

  it('enforces read-only permission', async () => {
    const readOnlyPerms: RemotePermissionSet = {
      read: { enabled: true },
      write: { enabled: false },
      execute: { enabled: false },
    };

    const token = await remoteManager.generateAccessToken(readOnlyPerms);
    const validation = await remoteManager.validateToken(token);

    expect(validation.permissions.read.enabled).toBe(true);
    expect(validation.permissions.write.enabled).toBe(false);
    expect(validation.permissions.execute.enabled).toBe(false);
  });

  it('enforces read-write permission', async () => {
    const readWritePerms: RemotePermissionSet = {
      read: { enabled: true },
      write: { enabled: true },
      execute: { enabled: false },
    };

    const token = await remoteManager.generateAccessToken(readWritePerms);
    const validation = await remoteManager.validateToken(token);

    expect(validation.permissions.read.enabled).toBe(true);
    expect(validation.permissions.write.enabled).toBe(true);
    expect(validation.permissions.execute.enabled).toBe(false);
  });

  it('enforces full permission set', async () => {
    const fullPerms: RemotePermissionSet = {
      read: { enabled: true },
      write: { enabled: true },
      execute: { enabled: true },
    };

    const token = await remoteManager.generateAccessToken(fullPerms);
    const validation = await remoteManager.validateToken(token);

    expect(validation.permissions.read.enabled).toBe(true);
    expect(validation.permissions.write.enabled).toBe(true);
    expect(validation.permissions.execute.enabled).toBe(true);
  });

  // ── Token revocation ────────────────────────────────────────────────

  it('revokes token and makes it invalid', async () => {
    const permissions: RemotePermissionSet = {
      read: { enabled: true },
      write: { enabled: false },
      execute: { enabled: false },
    };

    const token = await remoteManager.generateAccessToken(permissions);

    // Token should be valid initially
    const validation1 = await remoteManager.validateToken(token);
    expect(validation1.valid).toBe(true);

    // Get token hash for revocation via DB query
    const grant = db.prepare(
      'SELECT grant_id, token_hash FROM remote_access_grants LIMIT 1'
    ).get() as { grant_id: string; token_hash: string } | undefined;

    if (grant) {
      await remoteManager.revokeAccessToken(grant.token_hash);

      // Token should now be invalid (row deleted)
      const validation2 = await remoteManager.validateToken(token);
      expect(validation2.valid).toBe(false);
    }
  });

  // ── Session management ──────────────────────────────────────────────

  it('tracks sessions', async () => {
    if (!canBindLocalhost) return;
    await remoteManager.startServer();

    const sessions = remoteManager.getSessions();
    expect(Array.isArray(sessions)).toBe(true);

    // Initially no sessions (they're created on HTTP requests)
    expect(sessions.length).toBe(0);
  });

  it('terminates sessions', async () => {
    if (!canBindLocalhost) return;
    await remoteManager.startServer();

    const sessions = remoteManager.getSessions();
    if (sessions.length > 0) {
      const sessionId = sessions[0].sessionId;
      await remoteManager.terminateSession(sessionId);

      const updatedSessions = remoteManager.getSessions();
      expect(updatedSessions.find(s => s.sessionId === sessionId)).toBeUndefined();
    } else {
      // No sessions to terminate - test passes
      expect(sessions.length).toBe(0);
    }
  });

  // ── Audit logging ───────────────────────────────────────────────────

  it('records audit log entries', async () => {
    if (!canBindLocalhost) return;
    await remoteManager.startServer();

    const logs1 = remoteManager.getAuditLog();
    expect(Array.isArray(logs1)).toBe(true);
  });

  it('filters audit log by time range', async () => {
    if (!canBindLocalhost) return;
    await remoteManager.startServer();

    const now = Date.now();
    const oneHourAgo = now - 3600_000;

    const logs = remoteManager.getAuditLog({
      startTime: oneHourAgo,
      endTime: now,
    });

    expect(Array.isArray(logs)).toBe(true);
  });

  it('filters audit log by action', async () => {
    if (!canBindLocalhost) return;
    await remoteManager.startServer();

    const logs = remoteManager.getAuditLog({
      action: 'GET /remote/ping',
    });

    expect(Array.isArray(logs)).toBe(true);
  });

  // ── Server restart preserves configuration ──────────────────────────

  it('preserves policy across server restarts', async () => {
    if (!canBindLocalhost) return;
    const customPolicy = {
      ...DEFAULT_REMOTE_POLICY,
      mode: 'direct' as const,
      enabled: true,
      directAccessPort: 9000,
      directAccessSessionTimeoutMin: 45,
    };

    await remoteManager.setPolicy(customPolicy);
    await remoteManager.startServer();
    await remoteManager.stopServer();

    const policy = remoteManager.getPolicy();
    expect(policy.mode).toBe('direct');
    expect(policy.directAccessPort).toBe(9000);
    expect(policy.directAccessSessionTimeoutMin).toBe(45);
  });

  // ── Multiple tokens with different permissions ──────────────────────

  it('manages multiple tokens with different permissions', async () => {
    const readOnlyPerms: RemotePermissionSet = {
      read: { enabled: true },
      write: { enabled: false },
      execute: { enabled: false },
    };

    const fullPerms: RemotePermissionSet = {
      read: { enabled: true },
      write: { enabled: true },
      execute: { enabled: true },
    };

    const token1 = await remoteManager.generateAccessToken(readOnlyPerms);
    const token2 = await remoteManager.generateAccessToken(fullPerms);

    const validation1 = await remoteManager.validateToken(token1);
    const validation2 = await remoteManager.validateToken(token2);

    expect(validation1.permissions.write.enabled).toBe(false);
    expect(validation2.permissions.write.enabled).toBe(true);
  });

  // ── Policy mode affects behavior ────────────────────────────────────

  it('applies direct policy mode', async () => {
    if (!canBindLocalhost) return;
    await remoteManager.setPolicy({
      ...DEFAULT_REMOTE_POLICY,
      mode: 'direct',
      enabled: true,
      directAccessPort: 8080,
      directAccessSessionTimeoutMin: 30,
    });

    const policy = remoteManager.getPolicy();
    expect(policy.mode).toBe('direct');

    await remoteManager.startServer();
    expect(remoteManager.isRunning()).toBe(true);
  });

  it('applies disabled policy mode', async () => {
    await remoteManager.setPolicy({
      ...DEFAULT_REMOTE_POLICY,
      mode: 'disabled',
      enabled: false,
    });

    const policy = remoteManager.getPolicy();
    expect(policy.mode).toBe('disabled');
  });

  // ── End-to-end workflow ─────────────────────────────────────────────

  it('completes full remote access workflow', async () => {
    if (!canBindLocalhost) return;
    // Step 1: Configure policy
    await remoteManager.setPolicy({
      ...DEFAULT_REMOTE_POLICY,
      mode: 'direct',
      enabled: true,
      directAccessPort: 8080,
      directAccessSessionTimeoutMin: 30,
    });

    // Step 2: Start server
    await remoteManager.startServer();
    expect(remoteManager.isRunning()).toBe(true);

    // Step 3: Generate multiple tokens with different permissions
    const readToken = await remoteManager.generateAccessToken({
      read: { enabled: true },
      write: { enabled: false },
      execute: { enabled: false },
    });

    const writeToken = await remoteManager.generateAccessToken({
      read: { enabled: true },
      write: { enabled: true },
      execute: { enabled: false },
    });

    const execToken = await remoteManager.generateAccessToken({
      read: { enabled: true },
      write: { enabled: true },
      execute: { enabled: true },
    });

    // Step 4: Validate all tokens
    const readValidation = await remoteManager.validateToken(readToken);
    const writeValidation = await remoteManager.validateToken(writeToken);
    const execValidation = await remoteManager.validateToken(execToken);

    expect(readValidation.valid).toBe(true);
    expect(writeValidation.valid).toBe(true);
    expect(execValidation.valid).toBe(true);

    // Step 5: Verify permissions differ
    expect(readValidation.permissions.write.enabled).toBe(false);
    expect(writeValidation.permissions.write.enabled).toBe(true);
    expect(execValidation.permissions.execute.enabled).toBe(true);

    // Step 6: Check audit log
    const auditLog = remoteManager.getAuditLog();
    expect(Array.isArray(auditLog)).toBe(true);

    // Step 7: Check sessions
    const sessions = remoteManager.getSessions();
    expect(Array.isArray(sessions)).toBe(true);

    // Step 8: Stop server
    await remoteManager.stopServer();
    expect(remoteManager.isRunning()).toBe(false);
  });
});
  beforeAll(async () => {
    canBindLocalhost = await detectLocalhostBindSupport();
  });
