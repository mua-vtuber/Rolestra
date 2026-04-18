/**
 * In-memory session tracker for remote connections.
 *
 * Sessions are ephemeral — they exist only in memory and are
 * not persisted to the database. They represent active remote
 * connections and are cleaned up on inactivity timeout.
 */

import { randomUUID } from 'node:crypto';
import type {
  RemoteAccessMode,
  RemotePermissionSet,
  RemoteSession,
} from '../../shared/remote-types';

export class RemoteSessionTracker {
  private readonly sessions = new Map<string, RemoteSession>();

  /**
   * Creates a new remote session.
   */
  createSession(
    mode: RemoteAccessMode,
    remoteIp: string,
    permissions: RemotePermissionSet,
  ): RemoteSession {
    const now = Date.now();
    const session: RemoteSession = {
      sessionId: randomUUID(),
      mode,
      connectedAt: now,
      lastActivityAt: now,
      remoteIp,
      permissions,
    };

    this.sessions.set(session.sessionId, session);
    return session;
  }

  /**
   * Finds an existing active session for the given token hash,
   * or creates a new one if none exists.
   *
   * This prevents session proliferation when the same token
   * authenticates multiple requests.
   */
  findOrCreateSession(
    tokenHash: string,
    mode: RemoteAccessMode,
    remoteIp: string,
    permissions: RemotePermissionSet,
  ): RemoteSession {
    // Search for existing session with matching token hash
    for (const session of this.sessions.values()) {
      if (session.tokenHash === tokenHash) {
        session.lastActivityAt = Date.now();
        return session;
      }
    }

    // No existing session — create a new one
    const now = Date.now();
    const session: RemoteSession = {
      sessionId: randomUUID(),
      tokenHash,
      mode,
      connectedAt: now,
      lastActivityAt: now,
      remoteIp,
      permissions,
    };

    this.sessions.set(session.sessionId, session);
    return session;
  }

  /**
   * Returns a session by its ID, or `null` if not found.
   */
  getSession(sessionId: string): RemoteSession | null {
    return this.sessions.get(sessionId) ?? null;
  }

  /**
   * Updates the last activity timestamp for a session.
   */
  touchSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastActivityAt = Date.now();
    }
  }

  /**
   * Terminates (removes) a session.
   *
   * Returns `true` if the session existed and was removed,
   * `false` if it was not found.
   */
  terminateSession(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  /**
   * Returns all active sessions.
   */
  getSessions(): RemoteSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Removes sessions that have been inactive for longer than the timeout.
   *
   * Returns the IDs of the removed sessions.
   */
  cleanupExpired(timeoutMinutes: number): string[] {
    const cutoff = Date.now() - timeoutMinutes * 60 * 1000;
    const removed: string[] = [];

    for (const [id, session] of this.sessions) {
      if (session.lastActivityAt < cutoff) {
        this.sessions.delete(id);
        removed.push(id);
      }
    }

    return removed;
  }
}
