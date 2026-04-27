import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import Database from 'better-sqlite3';
import { request as httpRequest } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { RemoteHandlers } from '../remote-handlers';
import { RemoteServer, type AuditLogger } from '../remote-server';
import { RemoteAuth } from '../remote-auth';
import { RemoteSessionTracker } from '../remote-session';
import { RemoteManagerImpl } from '../remote-manager';
import type { RemotePermissionSet } from '../../../shared/remote-types';
import { DEFAULT_REMOTE_POLICY } from '../../../shared/remote-types';
import { APP_VERSION } from '../../../shared/constants';

// ── SQL for in-memory DB setup ────────────────────────────────────────

const MIGRATION_001_SQL = `
  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    title TEXT,
    mode TEXT NOT NULL,
    participants TEXT NOT NULL,
    folder_path TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT REFERENCES conversations(id),
    participant_id TEXT,
    content TEXT NOT NULL,
    role TEXT NOT NULL,
    pinned INTEGER DEFAULT 0,
    pin_topic TEXT,
    response_time_ms INTEGER,
    token_count INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    parent_message_id TEXT,
    branch_id TEXT,
    branch_root_message_id TEXT
  );

  CREATE TABLE IF NOT EXISTS knowledge_nodes (
    id TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    embedding BLOB,
    node_type TEXT NOT NULL,
    topic TEXT NOT NULL,
    importance REAL DEFAULT 0.5,
    source TEXT,
    pinned INTEGER DEFAULT 0,
    conversation_id TEXT,
    message_id TEXT,
    last_accessed DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    embedding_version TEXT,
    extractor_version TEXT,
    source_hash TEXT,
    dedupe_key TEXT,
    deleted_at DATETIME
  );

  CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
    content,
    content=knowledge_nodes,
    content_rowid=rowid,
    tokenize='unicode61'
  );

  CREATE TABLE IF NOT EXISTS knowledge_edges (
    id TEXT PRIMARY KEY,
    source_node_id TEXT REFERENCES knowledge_nodes(id),
    target_node_id TEXT REFERENCES knowledge_nodes(id),
    relation_type TEXT NOT NULL,
    weight REAL DEFAULT 1.0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS providers (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    model TEXT NOT NULL,
    persona TEXT,
    config TEXT NOT NULL,
    permissions TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_messages_conversation_id
    ON messages(conversation_id);
`;

const MIGRATION_003_SQL = `
  CREATE TABLE IF NOT EXISTS remote_access_grants (
    grant_id TEXT PRIMARY KEY,
    token_hash TEXT UNIQUE NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER,
    permissions TEXT NOT NULL,
    description TEXT,
    last_used_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS remote_audit_log (
    audit_id TEXT PRIMARY KEY,
    timestamp INTEGER NOT NULL,
    session_id TEXT,
    remote_ip TEXT,
    action TEXT NOT NULL,
    resource TEXT,
    result TEXT NOT NULL,
    denial_reason TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_remote_audit_log_session_id
    ON remote_audit_log(session_id);

  CREATE INDEX IF NOT EXISTS idx_remote_audit_log_timestamp
    ON remote_audit_log(timestamp);

  CREATE INDEX IF NOT EXISTS idx_remote_grants_token_hash
    ON remote_access_grants(token_hash);
`;

// ── Helpers ───────────────────────────────────────────────────────────

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(MIGRATION_001_SQL);
  db.exec(MIGRATION_003_SQL);
  return db;
}

function seedConversation(
  db: Database.Database,
  id: string,
  title: string,
  mode: string,
): void {
  db.prepare(
    'INSERT INTO conversations (id, title, mode, participants) VALUES (?, ?, ?, ?)',
  ).run(id, title, mode, '["ai-1","user"]');
}

function seedMessage(
  db: Database.Database,
  id: string,
  conversationId: string,
  content: string,
  role: string,
): void {
  db.prepare(
    'INSERT INTO messages (id, conversation_id, content, role) VALUES (?, ?, ?, ?)',
  ).run(id, conversationId, content, role);
}

function seedKnowledgeNode(
  db: Database.Database,
  id: string,
  content: string,
  topic: string,
): void {
  db.prepare(
    `INSERT INTO knowledge_nodes (id, content, node_type, topic, source)
     VALUES (?, ?, 'fact', ?, 'manual')`,
  ).run(id, content, topic);

  // Also insert into FTS index
  const row = db
    .prepare('SELECT rowid FROM knowledge_nodes WHERE id = ?')
    .get(id) as { rowid: number };
  db.prepare(
    'INSERT INTO knowledge_fts (rowid, content) VALUES (?, ?)',
  ).run(row.rowid, content);
}

const READ_PERMISSIONS: RemotePermissionSet = {
  read: { enabled: true },
  write: { enabled: false },
  execute: { enabled: false },
};

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

/**
 * Simple HTTP request helper using native http module.
 * Returns status, headers, and parsed JSON body.
 */
function fetchJson(options: {
  port: number;
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: unknown;
}): Promise<{ status: number; headers: Record<string, string>; body: unknown }> {
  return new Promise((resolve, reject) => {
    const reqHeaders: Record<string, string> = {
      ...options.headers,
    };

    let bodyStr: string | undefined;
    if (options.body !== undefined) {
      bodyStr = JSON.stringify(options.body);
      reqHeaders['Content-Type'] = 'application/json';
      reqHeaders['Content-Length'] = String(Buffer.byteLength(bodyStr));
    }

    const req = httpRequest(
      {
        hostname: '127.0.0.1',
        port: options.port,
        method: options.method,
        path: options.path,
        headers: reqHeaders,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf-8');
          let parsed: unknown;
          try {
            parsed = JSON.parse(raw);
          } catch {
            parsed = raw;
          }

          const responseHeaders: Record<string, string> = {};
          for (const [key, value] of Object.entries(res.headers)) {
            if (typeof value === 'string') {
              responseHeaders[key] = value;
            }
          }

          resolve({
            status: res.statusCode ?? 0,
            headers: responseHeaders,
            body: parsed,
          });
        });
      },
    );

    req.on('error', reject);

    if (bodyStr) {
      req.write(bodyStr);
    }
    req.end();
  });
}

// ── RemoteHandlers Tests ──────────────────────────────────────────────

describe('RemoteHandlers', () => {
  let db: Database.Database;
  let handlers: RemoteHandlers;

  beforeEach(() => {
    db = createTestDb();
    handlers = new RemoteHandlers(db, 'direct');
  });

  afterEach(() => {
    db.close();
  });

  it('handlePing returns version and mode', () => {
    const result = handlers.handlePing();
    expect(result.version).toBe(APP_VERSION);
    expect(result.mode).toBe('direct');
  });

  it('handlePing reflects mode change', () => {
    handlers.setMode('tailscale');
    const result = handlers.handlePing();
    expect(result.mode).toBe('tailscale');
  });

  it('handleConversationsList returns empty when no conversations', () => {
    const result = handlers.handleConversationsList();
    expect(result).toEqual([]);
  });

  it('handleConversationsList returns conversations from DB', () => {
    seedConversation(db, 'conv-1', 'Test Chat', 'multi');
    seedConversation(db, 'conv-2', 'Another Chat', 'single');

    const result = handlers.handleConversationsList();
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(
      expect.objectContaining({ id: expect.any(String), title: expect.any(String), mode: expect.any(String) }),
    );
  });

  it('handleConversationGet returns null for non-existent', () => {
    const result = handlers.handleConversationGet('non-existent');
    expect(result).toBeNull();
  });

  it('handleConversationGet returns conversation with messages', () => {
    seedConversation(db, 'conv-1', 'Test Chat', 'multi');
    seedMessage(db, 'msg-1', 'conv-1', 'Hello', 'user');
    seedMessage(db, 'msg-2', 'conv-1', 'Hi there', 'assistant');

    const result = handlers.handleConversationGet('conv-1');
    expect(result).not.toBeNull();
    expect(result?.id).toBe('conv-1');
    expect(result?.title).toBe('Test Chat');
    expect(result?.mode).toBe('multi');
    expect(result?.messages).toHaveLength(2);
  });

  it('handleMemorySearch returns ok:true with empty rows when no matches', () => {
    const result = handlers.handleMemorySearch('nonexistent query');
    expect(result).toEqual({ ok: true, rows: [] });
  });

  it('handleMemorySearch finds matching nodes via FTS5', () => {
    seedKnowledgeNode(db, 'kn-1', 'TypeScript is a typed superset of JavaScript', 'programming');
    seedKnowledgeNode(db, 'kn-2', 'React is a UI library built by Meta', 'programming');

    const result = handlers.handleMemorySearch('TypeScript');
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok=true');
    expect(result.rows.length).toBeGreaterThanOrEqual(1);
    expect(result.rows[0].id).toBe('kn-1');
    expect(result.rows[0].content).toContain('TypeScript');
    expect(typeof result.rows[0].score).toBe('number');
  });

  it('handleMemorySearch returns EMPTY_QUERY for empty query', () => {
    seedKnowledgeNode(db, 'kn-1', 'Some content', 'topic');
    const result = handlers.handleMemorySearch('');
    expect(result).toEqual({
      ok: false,
      code: 'EMPTY_QUERY',
      message: expect.any(String),
    });
  });

  it('handleMemorySearch returns EMPTY_QUERY for whitespace-only query', () => {
    const result = handlers.handleMemorySearch('   \t\n  ');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected ok=false');
    expect(result.code).toBe('EMPTY_QUERY');
  });

  it('handleMemorySearch returns FTS_DB_ERROR when the FTS table is missing', () => {
    // Drop the FTS index so the prepare/exec path raises an SQL error.
    db.exec('DROP TABLE knowledge_fts');
    const result = handlers.handleMemorySearch('anything');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected ok=false');
    expect(result.code).toBe('FTS_DB_ERROR');
    expect(result.message.length).toBeGreaterThan(0);
  });
});

// ── RemoteServer Tests ────────────────────────────────────────────────

describe('RemoteServer', () => {
  let db: Database.Database;
  let server: RemoteServer;
  let auth: RemoteAuth;
  let sessions: RemoteSessionTracker;
  let auditEntries: Array<{ action: string; result: string }>;
  let actualPort: number;

  // We'll use a fixed port in a high range to avoid conflicts
  function getTestPort(): number {
    return 18000 + Math.floor(Math.random() * 2000);
  }

  beforeEach(async () => {
    db = createTestDb();
    auth = new RemoteAuth(db);
    sessions = new RemoteSessionTracker();
    auditEntries = [];

    const mockAudit: AuditLogger = {
      log: (entry) => {
        auditEntries.push({ action: entry.action, result: entry.result });
      },
    };

    const handlers = new RemoteHandlers(db, 'direct');

    actualPort = getTestPort();
    server = new RemoteServer({
      port: actualPort,
      host: '127.0.0.1',
      auth,
      sessions,
      audit: mockAudit,
      handlers,
    });
  });

  afterEach(async () => {
    if (server.isRunning()) {
      await server.stop();
    }
    db.close();
  });

  it('starts and stops correctly', async () => {
    if (!canBindLocalhost) return;
    await server.start();
    expect(server.isRunning()).toBe(true);

    await server.stop();
    expect(server.isRunning()).toBe(false);
  });

  it('isRunning returns correct state', () => {
    expect(server.isRunning()).toBe(false);
  });

  it('responds to ping without auth', async () => {
    if (!canBindLocalhost) return;
    await server.start();

    const res = await fetchJson({
      port: actualPort,
      method: 'GET',
      path: '/remote/ping',
    });

    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.version).toBe(APP_VERSION);
    expect(body.mode).toBe('direct');
  });

  it('rejects requests without auth token (401)', async () => {
    if (!canBindLocalhost) return;
    await server.start();

    const res = await fetchJson({
      port: actualPort,
      method: 'GET',
      path: '/remote/conversations',
    });

    expect(res.status).toBe(401);
    const body = res.body as Record<string, unknown>;
    expect(body.error).toBeDefined();
  });

  it('accepts requests with valid auth token', async () => {
    if (!canBindLocalhost) return;
    await server.start();

    const { token } = auth.generateToken(READ_PERMISSIONS);

    const res = await fetchJson({
      port: actualPort,
      method: 'GET',
      path: '/remote/conversations',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.conversations).toEqual([]);
  });

  it('returns 404 for unknown routes', async () => {
    if (!canBindLocalhost) return;
    await server.start();

    const res = await fetchJson({
      port: actualPort,
      method: 'GET',
      path: '/unknown/route',
    });

    expect(res.status).toBe(404);
  });

  it('sends CORS headers', async () => {
    if (!canBindLocalhost) return;
    await server.start();

    const res = await fetchJson({
      port: actualPort,
      method: 'GET',
      path: '/remote/ping',
    });

    expect(res.headers['access-control-allow-origin']).toBe(`https://127.0.0.1:${actualPort}`);
  });

  it('audit logs requests', async () => {
    if (!canBindLocalhost) return;
    await server.start();

    await fetchJson({
      port: actualPort,
      method: 'GET',
      path: '/remote/ping',
    });

    expect(auditEntries.length).toBeGreaterThanOrEqual(1);
    expect(auditEntries[0].action).toBe('GET /remote/ping');
    expect(auditEntries[0].result).toBe('success');
  });

  it('rejects requests with insufficient permissions (403)', async () => {
    if (!canBindLocalhost) return;
    await server.start();

    // Create a token with only execute permissions (no read)
    const noReadPermissions: RemotePermissionSet = {
      read: { enabled: false },
      write: { enabled: false },
      execute: { enabled: true },
    };
    const { token } = auth.generateToken(noReadPermissions);

    const res = await fetchJson({
      port: actualPort,
      method: 'GET',
      path: '/remote/conversations',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    expect(res.status).toBe(403);
  });
});

// ── RemoteManagerImpl Tests ───────────────────────────────────────────

describe('RemoteManagerImpl', () => {
  let db: Database.Database;
  let manager: RemoteManagerImpl;

  beforeEach(() => {
    db = createTestDb();
    manager = new RemoteManagerImpl(db);
  });

  afterEach(async () => {
    if (manager.isRunning()) {
      await manager.stopServer();
    }
    db.close();
  });

  it('creates without error', () => {
    expect(manager).toBeDefined();
    expect(manager.isRunning()).toBe(false);
  });

  it('getPolicy returns default policy', () => {
    const policy = manager.getPolicy();
    expect(policy.mode).toBe(DEFAULT_REMOTE_POLICY.mode);
    expect(policy.enabled).toBe(DEFAULT_REMOTE_POLICY.enabled);
    expect(policy.directAccessPort).toBe(DEFAULT_REMOTE_POLICY.directAccessPort);
  });

  it('setPolicy updates policy', async () => {
    const newPolicy = {
      ...DEFAULT_REMOTE_POLICY,
      mode: 'direct' as const,
      enabled: true,
      directAccessPort: 9999,
    };

    await manager.setPolicy(newPolicy);
    const policy = manager.getPolicy();
    expect(policy.mode).toBe('direct');
    expect(policy.enabled).toBe(true);
    expect(policy.directAccessPort).toBe(9999);
  });

  it('generateAccessToken returns token', async () => {
    const token = await manager.generateAccessToken(READ_PERMISSIONS);
    expect(typeof token).toBe('string');
    expect(token.length).toBe(64); // 32 bytes hex = 64 chars

    const validation = await manager.validateToken(token);
    expect(validation.valid).toBe(true);
    expect(validation.permissions.read.enabled).toBe(true);
  });

  it('startServer/stopServer lifecycle', async () => {
    if (!canBindLocalhost) return;
    // Set a random high port to avoid conflicts
    const testPort = 18000 + Math.floor(Math.random() * 2000);
    await manager.setPolicy({
      ...DEFAULT_REMOTE_POLICY,
      directAccessPort: testPort,
    });

    expect(manager.isRunning()).toBe(false);
    await manager.startServer();
    expect(manager.isRunning()).toBe(true);
    await manager.stopServer();
    expect(manager.isRunning()).toBe(false);
  });

  it('isRunning reflects server state', async () => {
    if (!canBindLocalhost) return;
    const testPort = 18000 + Math.floor(Math.random() * 2000);
    await manager.setPolicy({
      ...DEFAULT_REMOTE_POLICY,
      directAccessPort: testPort,
    });

    expect(manager.isRunning()).toBe(false);

    await manager.startServer();
    expect(manager.isRunning()).toBe(true);

    await manager.stopServer();
    expect(manager.isRunning()).toBe(false);
  });

  it('validateToken returns invalid for bad token', async () => {
    const result = await manager.validateToken('invalid-token-string');
    expect(result.valid).toBe(false);
  });

  it('listGrants returns generated tokens', async () => {
    expect(manager.listGrants()).toHaveLength(0);

    await manager.generateAccessToken(READ_PERMISSIONS);
    await manager.generateAccessToken(READ_PERMISSIONS);

    const grants = manager.listGrants();
    expect(grants).toHaveLength(2);
    expect(grants[0].grantId).toBeDefined();
    expect(grants[0].tokenHash).toBeDefined();
    expect(grants[0].permissions.read.enabled).toBe(true);
  });

  it('revokeGrant removes a grant', async () => {
    await manager.generateAccessToken(READ_PERMISSIONS);
    const grants = manager.listGrants();
    expect(grants).toHaveLength(1);

    const revoked = manager.revokeGrant(grants[0].grantId);
    expect(revoked).toBe(true);
    expect(manager.listGrants()).toHaveLength(0);
  });

  it('revokeGrant returns false for unknown grant', () => {
    const revoked = manager.revokeGrant('unknown-grant-id');
    expect(revoked).toBe(false);
  });
});

// ── Web Client Tests ──────────────────────────────────────────────────

describe('RemoteServer web client', () => {
  let db: Database.Database;
  let server: RemoteServer;
  let actualPort: number;

  beforeEach(async () => {
    db = createTestDb();
    const auth = new RemoteAuth(db);
    const sessions = new RemoteSessionTracker();
    const mockAudit: AuditLogger = { log: () => {} };
    const handlers = new RemoteHandlers(db, 'direct');

    actualPort = 18000 + Math.floor(Math.random() * 2000);
    server = new RemoteServer({
      port: actualPort,
      host: '127.0.0.1',
      auth,
      sessions,
      audit: mockAudit,
      handlers,
    });
  });

  afterEach(async () => {
    if (server.isRunning()) await server.stop();
    db.close();
  });

  it('serves HTML at GET /', async () => {
    if (!canBindLocalhost) return;
    await server.start();

    const res = await fetchJson({
      port: actualPort,
      method: 'GET',
      path: '/',
    });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
  });

  it('serves HTML at GET /index.html', async () => {
    if (!canBindLocalhost) return;
    await server.start();

    const res = await fetchJson({
      port: actualPort,
      method: 'GET',
      path: '/index.html',
    });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
  });
});

beforeAll(async () => {
  canBindLocalhost = await detectLocalhostBindSupport();
});

beforeAll(async () => {
  canBindLocalhost = await detectLocalhostBindSupport();
});
