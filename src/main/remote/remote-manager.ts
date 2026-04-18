/**
 * Top-level coordinator for remote access functionality.
 *
 * Implements the `RemoteInterfaceManager` interface from remote-types.ts.
 * Internally creates and wires together: RemoteAuth, RemoteSessionTracker,
 * RemoteAuditLogger, RemoteHandlers, and RemoteServer.
 */

import type Database from 'better-sqlite3';
import type {
  RemoteAccessGrant,
  RemoteAccessPolicy,
  RemoteAuditEntry,
  RemoteInterfaceManager,
  RemotePermissionSet,
  RemoteSession,
} from '../../shared/remote-types';
import { DEFAULT_REMOTE_POLICY } from '../../shared/remote-types';
import { RemoteAuth } from './remote-auth';
import { RemoteSessionTracker } from './remote-session';
import { RemoteAuditLogger } from './remote-audit';
import { RemoteHandlers } from './remote-handlers';
import { RemoteServer, type AuditLogger } from './remote-server';
import { getTailscaleStatus, getTailscaleIp } from './tailscale-client';
import { needsTls, getOrCreateCert } from './tls-util';
import type { TailscaleStatus } from '../../shared/remote-types';
import { app } from 'electron';
import path from 'node:path';

/** Session cleanup interval in milliseconds (60 seconds). */
const CLEANUP_INTERVAL_MS = 60_000;

export class RemoteManagerImpl implements RemoteInterfaceManager {
  private readonly db: Database.Database;
  private readonly auth: RemoteAuth;
  private readonly sessions: RemoteSessionTracker;
  private readonly audit: RemoteAuditLogger;
  private readonly handlers: RemoteHandlers;
  private server: RemoteServer | null = null;
  private policy: RemoteAccessPolicy;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(db: Database.Database) {
    this.db = db;
    this.policy = { ...DEFAULT_REMOTE_POLICY };
    this.auth = new RemoteAuth(db);
    this.sessions = new RemoteSessionTracker();
    this.audit = new RemoteAuditLogger(db);
    this.handlers = new RemoteHandlers(db, this.policy.mode);
  }

  // ── Policy ──────────────────────────────────────────────────────────

  async setPolicy(policy: RemoteAccessPolicy): Promise<void> {
    this.policy = { ...policy };
    this.handlers.setMode(policy.mode);
  }

  getPolicy(): RemoteAccessPolicy {
    return { ...this.policy };
  }

  // ── Token management ────────────────────────────────────────────────

  async generateAccessToken(
    permissions: RemotePermissionSet,
    expiresAt?: number,
  ): Promise<string> {
    const { token } = this.auth.generateToken(permissions, undefined, expiresAt);
    return token;
  }

  async revokeAccessToken(tokenHash: string): Promise<void> {
    // Look up the grant by token hash to find the grant ID
    const grants = this.auth.listGrants();
    const grant = grants.find((g) => g.tokenHash === tokenHash);
    if (grant) {
      this.auth.revokeToken(grant.grantId);
    }
  }

  /**
   * Lists all access grants (without exposing plaintext tokens).
   */
  listGrants(): RemoteAccessGrant[] {
    return this.auth.listGrants();
  }

  /**
   * Revokes a grant directly by its ID.
   */
  revokeGrant(grantId: string): boolean {
    return this.auth.revokeToken(grantId);
  }

  async validateToken(
    token: string,
  ): Promise<{ valid: boolean; permissions: RemotePermissionSet }> {
    const result = this.auth.validateToken(token);
    if (!result) {
      return {
        valid: false,
        permissions: { read: { enabled: false }, write: { enabled: false }, execute: { enabled: false } },
      };
    }
    return { valid: result.valid, permissions: result.permissions };
  }

  // ── Session management ──────────────────────────────────────────────

  getSessions(): RemoteSession[] {
    return this.sessions.getSessions();
  }

  async terminateSession(sessionId: string): Promise<void> {
    this.sessions.terminateSession(sessionId);
  }

  // ── Audit ───────────────────────────────────────────────────────────

  getAuditLog(filters?: {
    startTime?: number;
    endTime?: number;
    action?: string;
  }): RemoteAuditEntry[] {
    return this.audit.getLog(filters);
  }

  // ── Tailscale ─────────────────────────────────────────────────────────

  /**
   * Returns the current Tailscale status by querying the local CLI.
   */
  async getTailscaleStatus(): Promise<TailscaleStatus> {
    return getTailscaleStatus();
  }

  // ── Server lifecycle ────────────────────────────────────────────────

  async startServer(): Promise<void> {
    if (this.server?.isRunning()) {
      return;
    }

    this.handlers.setMode(this.policy.mode);

    // Create an audit logger adapter that satisfies the AuditLogger interface
    const auditAdapter: AuditLogger = {
      log: (entry) => this.audit.log(entry),
    };

    // Determine host/port based on mode
    let host: string;
    let port: number;

    if (this.policy.mode === 'tailscale') {
      const tailscaleIp = await getTailscaleIp();
      if (!tailscaleIp) {
        throw new Error(
          'Tailscale is not running or no IP assigned. ' +
          'Please ensure Tailscale is installed and connected.',
        );
      }
      host = tailscaleIp;
      port = this.policy.directAccessPort;
    } else {
      host = this.policy.bindAddress ?? '127.0.0.1';
      port = this.policy.directAccessPort;
    }

    // Conditionally enable TLS for non-loopback, non-Tailscale addresses
    let tls: { cert: string; key: string } | undefined;
    if (needsTls(host)) {
      const certsDir = path.join(app.getPath('userData'), '.arena', 'certs');
      tls = await getOrCreateCert(certsDir);
    }

    this.server = new RemoteServer({
      port,
      host,
      auth: this.auth,
      sessions: this.sessions,
      audit: auditAdapter,
      handlers: this.handlers,
      tls,
    });

    await this.server.start();

    // Start periodic session cleanup
    this.startCleanupTimer();
  }

  async stopServer(): Promise<void> {
    this.stopCleanupTimer();

    if (this.server) {
      await this.server.stop();
      this.server = null;
    }
  }

  isRunning(): boolean {
    return this.server?.isRunning() ?? false;
  }

  // ── Cleanup ────────────────────────────────────────────────────────

  private startCleanupTimer(): void {
    this.stopCleanupTimer();
    this.cleanupTimer = setInterval(() => {
      this.sessions.cleanupExpired(this.policy.directAccessSessionTimeoutMin);
    }, CLEANUP_INTERVAL_MS);

    // Allow the timer to not prevent process exit
    if (this.cleanupTimer && typeof this.cleanupTimer === 'object' && 'unref' in this.cleanupTimer) {
      this.cleanupTimer.unref();
    }
  }

  private stopCleanupTimer(): void {
    if (this.cleanupTimer !== null) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }
}
