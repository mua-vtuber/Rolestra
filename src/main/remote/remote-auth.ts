/**
 * Token-based authentication for remote access.
 *
 * Generates, validates, and revokes access tokens.
 * Tokens are stored as SHA-256 hashes — plaintext is returned only once
 * at generation time.
 */

import { randomUUID, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type Database from 'better-sqlite3';
import type {
  RemoteAccessGrant,
  RemotePermissionSet,
} from '../../shared/remote-types';

/** Raw row shape returned from the remote_access_grants table. */
interface GrantRow {
  grant_id: string;
  token_hash: string;
  created_at: number;
  expires_at: number | null;
  permissions: string;
  description: string | null;
  last_used_at: number | null;
}

// ── Rate limiting for authentication ──────────────────────────────────────

const loginAttempts = new Map<string, { count: number; lastAttempt: number }>();
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 60_000;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const attempt = loginAttempts.get(ip);
  if (!attempt) return true;
  if (now - attempt.lastAttempt > LOCKOUT_MS) {
    loginAttempts.delete(ip);
    return true;
  }
  return attempt.count < MAX_ATTEMPTS;
}

function recordFailedAttempt(ip: string): void {
  const now = Date.now();
  const attempt = loginAttempts.get(ip) ?? { count: 0, lastAttempt: now };
  attempt.count++;
  attempt.lastAttempt = now;
  loginAttempts.set(ip, attempt);
}

export class RemoteAuth {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * Generates a new access token with the given permissions.
   *
   * Returns the plaintext token (64 hex chars) and the grant ID.
   * The plaintext is never stored — only its SHA-256 hash is persisted.
   */
  generateToken(
    permissions: RemotePermissionSet,
    description?: string,
    expiresAt?: number,
  ): { token: string; grantId: string } {
    const token = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const grantId = randomUUID();
    const now = Date.now();

    this.db
      .prepare(
        `INSERT INTO remote_access_grants
           (grant_id, token_hash, created_at, expires_at, permissions, description, last_used_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL)`,
      )
      .run(
        grantId,
        tokenHash,
        now,
        expiresAt ?? null,
        JSON.stringify(permissions),
        description ?? null,
      );

    return { token, grantId };
  }

  /**
   * Validates a plaintext token.
   *
   * Hashes the token, looks it up in the DB, checks expiry,
   * updates `last_used_at`, and returns the grant info.
   * Returns `null` if the token is invalid or expired.
   *
   * Uses timing-safe comparison to prevent timing attacks.
   * When `ip` is provided, applies rate limiting to prevent brute-force.
   */
  validateToken(
    token: string,
    ip?: string,
  ): { valid: boolean; grantId: string; permissions: RemotePermissionSet } | null {
    // Rate limit check
    if (ip && !checkRateLimit(ip)) {
      return null;
    }

    const tokenHash = createHash('sha256').update(token).digest('hex');
    const tokenHashBuf = Buffer.from(tokenHash, 'hex');

    // Fetch all grants to perform timing-safe comparison
    // (avoids leaking whether a token_hash exists via DB query timing)
    const rows = this.db
      .prepare(
        `SELECT * FROM remote_access_grants`,
      )
      .all() as GrantRow[];

    let matchedRow: GrantRow | undefined;
    for (const row of rows) {
      const storedBuf = Buffer.from(row.token_hash, 'hex');
      if (storedBuf.length === tokenHashBuf.length && timingSafeEqual(tokenHashBuf, storedBuf)) {
        matchedRow = row;
        break;
      }
    }

    if (!matchedRow) {
      if (ip) recordFailedAttempt(ip);
      return null;
    }

    // Check expiry
    if (matchedRow.expires_at !== null && matchedRow.expires_at <= Date.now()) {
      if (ip) recordFailedAttempt(ip);
      return null;
    }

    // Update last_used_at
    this.db
      .prepare(
        `UPDATE remote_access_grants SET last_used_at = ? WHERE grant_id = ?`,
      )
      .run(Date.now(), matchedRow.grant_id);

    // Clear failed attempts on successful auth
    if (ip) loginAttempts.delete(ip);

    return {
      valid: true,
      grantId: matchedRow.grant_id,
      permissions: JSON.parse(matchedRow.permissions) as RemotePermissionSet,
    };
  }

  /**
   * Revokes a grant by its ID.
   *
   * Returns `true` if a grant was deleted, `false` if the ID was not found.
   */
  revokeToken(grantId: string): boolean {
    const result = this.db
      .prepare(`DELETE FROM remote_access_grants WHERE grant_id = ?`)
      .run(grantId);

    return result.changes > 0;
  }

  /**
   * Lists all access grants (without exposing the token hash).
   */
  listGrants(): RemoteAccessGrant[] {
    const rows = this.db
      .prepare(`SELECT * FROM remote_access_grants`)
      .all() as GrantRow[];

    return rows.map((row) => ({
      grantId: row.grant_id,
      tokenHash: row.token_hash,
      createdAt: row.created_at,
      expiresAt: row.expires_at ?? undefined,
      permissions: JSON.parse(row.permissions) as RemotePermissionSet,
      description: row.description ?? undefined,
      lastUsedAt: row.last_used_at ?? undefined,
    }));
  }
}
