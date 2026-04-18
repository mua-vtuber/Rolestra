/**
 * Remote access interface type definitions.
 *
 * Phase 4: Interface/type definitions ONLY.
 * Phase 5: Actual implementation (Tailscale / direct connection).
 */

// ── Remote Access Mode ─────────────────────────────────────────────

export type RemoteAccessMode = 'disabled' | 'tailscale' | 'direct';

// ── Remote Access Policy ───────────────────────────────────────────

/** Policy governing remote access behavior and restrictions. */
export interface RemoteAccessPolicy {
  mode: RemoteAccessMode;
  enabled: boolean;

  // ── Direct connection settings ─────────────────────────────────
  directAccessPort: number;
  directAccessReadOnly: boolean;
  directAccessSessionTimeoutMin: number;
  directAccessAllowedIPs: string[];
  /** Bind address for direct mode. Default: '127.0.0.1'. */
  bindAddress?: string;

  // ── Permission flags ───────────────────────────────────────────
  allowFileModification: boolean;
  allowCommandExecution: boolean;
  /** Endpoint whitelist for remote callers. */
  allowedEndpoints: string[];
}

/** Default remote access policy (everything disabled). */
export const DEFAULT_REMOTE_POLICY: RemoteAccessPolicy = {
  mode: 'disabled',
  enabled: false,
  directAccessPort: 8443,
  directAccessReadOnly: true,
  directAccessSessionTimeoutMin: 30,
  directAccessAllowedIPs: [],
  allowFileModification: false,
  allowCommandExecution: false,
  allowedEndpoints: [
    'remote:ping',
    'remote:conversations:list',
    'remote:conversation:get',
    'remote:memory:search',
  ],
};

// ── Remote Permission Model ────────────────────────────────────────

/** Granular permission set for a remote session/token. */
export interface RemotePermissionSet {
  read: {
    enabled: boolean;
    scopes?: string[];
  };
  write: {
    enabled: boolean;
    scopes?: string[];
  };
  execute: {
    enabled: boolean;
    allowedCommands?: string[];
  };
}

/** Default remote permissions (read-only). */
export const DEFAULT_REMOTE_PERMISSIONS: RemotePermissionSet = {
  read: { enabled: true },
  write: { enabled: false },
  execute: { enabled: false },
};

// ── Remote Access Grant ────────────────────────────────────────────

/** A token-based access grant for remote connections. */
export interface RemoteAccessGrant {
  grantId: string;
  /** SHA-256 hash of the token (plaintext never stored). */
  tokenHash: string;
  createdAt: number;
  expiresAt?: number;
  permissions: RemotePermissionSet;
  description?: string;
  lastUsedAt?: number;
}

// ── Remote Session ─────────────────────────────────────────────────

/** An active remote connection session. */
export interface RemoteSession {
  sessionId: string;
  tokenHash?: string;
  mode: RemoteAccessMode;
  connectedAt: number;
  lastActivityAt: number;
  remoteIp?: string;
  permissions: RemotePermissionSet;
}

// ── Remote Channel Protocol ────────────────────────────────────────

/**
 * Remote channel map (analogous to IpcChannelMap).
 * Defines the contract for remote API endpoints.
 * Implementation deferred to Phase 5.
 */
export type RemoteChannelMap = {
  'remote:ping': {
    request: undefined;
    response: { version: string; mode: RemoteAccessMode };
  };
  'remote:auth:verify': {
    request: { token: string };
    response: { valid: boolean; permissions: RemotePermissionSet };
  };
  'remote:conversations:list': {
    request: undefined;
    response: { conversations: Array<{ id: string; title: string; mode: string }> };
  };
  'remote:conversation:get': {
    request: { conversationId: string };
    response: { id: string; title: string; mode: string; messages: unknown[] };
  };
  'remote:memory:search': {
    request: { query: string; limit?: number };
    response: { results: Array<{ id: string; content: string; score: number }> };
  };
};

/** Metadata attached to every remote request. */
export interface RemoteRequestMeta {
  requestId: string;
  timestamp: number;
  sessionId: string;
  token?: string;
}

// ── Remote Audit ───────────────────────────────────────────────────

/** Audit log entry for remote access events. */
export interface RemoteAuditEntry {
  auditId: string;
  timestamp: number;
  sessionId: string;
  remoteIp: string;
  action: string;
  resource?: string;
  result: 'success' | 'denied' | 'error';
  denialReason?: string;
}

// ── Tailscale Status ──────────────────────────────────────────────

/** Connection state of the Tailscale daemon. */
export type TailscaleBackendState =
  | 'Running'
  | 'NeedsLogin'
  | 'NeedsMachineAuth'
  | 'Stopped'
  | 'Starting'
  | 'NoState';

/** Peer information from `tailscale status --json`. */
export interface TailscalePeer {
  hostName: string;
  dnsName: string;
  tailscaleIPs: string[];
  online: boolean;
  os: string;
}

/** Aggregated Tailscale status returned to the renderer. */
export interface TailscaleStatus {
  /** Whether the `tailscale` CLI binary was found on PATH. */
  installed: boolean;
  /** Tailscale version string (e.g. "1.62.0"). */
  version?: string;
  /** Backend daemon state. */
  backendState?: TailscaleBackendState;
  /** This machine's Tailscale IPv4 address. */
  selfIp?: string;
  /** This machine's MagicDNS name (e.g. "my-pc.tailnet-name.ts.net"). */
  selfDnsName?: string;
  /** This machine's hostname. */
  selfHostName?: string;
  /** Number of online peers. */
  onlinePeers?: number;
  /** Error message if detection/status check failed. */
  error?: string;
}

// ── Remote Interface Manager (abstract) ────────────────────────────

/**
 * Abstract manager interface for remote access.
 * Phase 5 will provide the concrete implementation.
 */
export interface RemoteInterfaceManager {
  // Policy
  setPolicy(policy: RemoteAccessPolicy): Promise<void>;
  getPolicy(): RemoteAccessPolicy;

  // Token management
  generateAccessToken(
    permissions: RemotePermissionSet,
    expiresAt?: number,
  ): Promise<string>;
  revokeAccessToken(tokenHash: string): Promise<void>;
  validateToken(token: string): Promise<{
    valid: boolean;
    permissions: RemotePermissionSet;
  }>;

  // Session management
  getSessions(): RemoteSession[];
  terminateSession(sessionId: string): Promise<void>;

  // Audit
  getAuditLog(filters?: {
    startTime?: number;
    endTime?: number;
    action?: string;
  }): RemoteAuditEntry[];

  // Server lifecycle (Phase 5)
  startServer(): Promise<void>;
  stopServer(): Promise<void>;
  isRunning(): boolean;
}
