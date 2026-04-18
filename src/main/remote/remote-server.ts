/**
 * Lightweight HTTP server for remote access using native Node.js `http` module.
 *
 * Handles routing, authentication, permission checks, CORS,
 * and audit logging for remote API endpoints.
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createHttpsServer, type Server as HttpsServer } from 'node:https';
import { createHash } from 'node:crypto';
import type { RemoteAuth } from './remote-auth';
import type { RemoteSessionTracker } from './remote-session';
import type { RemoteHandlers } from './remote-handlers';
import type { RemotePermissionSet } from '../../shared/remote-types';
import { getRemoteWebClientHtml } from './remote-web-client';

/** Minimal interface for audit logging — matches RemoteAuditLogger. */
export interface AuditLogger {
  log(entry: {
    sessionId: string;
    remoteIp: string;
    action: string;
    resource?: string;
    result: 'success' | 'denied' | 'error';
    denialReason?: string;
  }): void;
}

/** Route definition for endpoint matching. */
interface Route {
  method: string;
  path: string;
  /** Permission level required: 'none' skips auth entirely. */
  permission: 'none' | 'read' | 'write' | 'execute';
  handler: (body: Record<string, unknown>) => unknown;
}

/** Configuration for the remote server. */
export interface RemoteServerConfig {
  port: number;
  host?: string;
  auth: RemoteAuth;
  sessions: RemoteSessionTracker;
  audit: AuditLogger;
  handlers: RemoteHandlers;
  /** When provided, the server uses HTTPS instead of HTTP. */
  tls?: { cert: string; key: string };
}

export class RemoteServer {
  private server: Server | HttpsServer | null = null;
  private running = false;
  private readonly port: number;
  private readonly host: string;
  private readonly auth: RemoteAuth;
  private readonly sessions: RemoteSessionTracker;
  private readonly audit: AuditLogger;
  private readonly handlers: RemoteHandlers;
  private readonly routes: Route[];
  private readonly tls?: { cert: string; key: string };

  constructor(config: RemoteServerConfig) {
    this.port = config.port;
    this.host = config.host ?? '127.0.0.1';
    this.auth = config.auth;
    this.sessions = config.sessions;
    this.audit = config.audit;
    this.handlers = config.handlers;
    this.tls = config.tls;

    this.routes = this.buildRoutes();
  }

  /**
   * Starts the HTTP server.
   */
  async start(): Promise<void> {
    if (this.running) {
      return;
    }

    return new Promise<void>((resolve, reject) => {
      const handler = (req: IncomingMessage, res: ServerResponse): void => {
        this.handleRequest(req, res).catch((_err: unknown) => {
          sendError(res, 500, 'Internal server error');
        });
      };

      const server = this.tls
        ? createHttpsServer({ cert: this.tls.cert, key: this.tls.key }, handler)
        : createServer(handler);

      server.on('error', (err: Error) => {
        if (!this.running) {
          reject(err);
        }
      });

      server.listen(this.port, this.host, () => {
        this.server = server;
        this.running = true;
        resolve();
      });
    });
  }

  /**
   * Stops the HTTP server gracefully.
   */
  async stop(): Promise<void> {
    if (!this.running || !this.server) {
      return;
    }

    return new Promise<void>((resolve, reject) => {
      const server = this.server;
      if (!server) {
        resolve();
        return;
      }

      server.close((err) => {
        this.server = null;
        this.running = false;
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Returns whether the server is currently running.
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Returns the configured port.
   */
  getPort(): number {
    return this.port;
  }

  // ── Private: Request handling ──────────────────────────────────────

  private async handleRequest(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    // CORS headers on every response
    setCorsHeaders(res, this.port);

    // Handle preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const proto = this.tls ? 'https' : 'http';
    const url = new URL(req.url ?? '/', `${proto}://${req.headers.host ?? 'localhost'}`);
    const pathname = url.pathname;
    const method = (req.method ?? 'GET').toUpperCase();

    // Serve inline web client at root
    if (method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
      sendHtml(res, 200, getRemoteWebClientHtml());
      return;
    }

    // Parse body for POST/PUT
    let body: Record<string, unknown> = {};
    if (method === 'POST' || method === 'PUT') {
      body = await parseJsonBody(req);
    }

    // Match route
    const route = this.routes.find(
      (r) => r.method === method && r.path === pathname,
    );

    const remoteIp = extractIp(req);

    if (!route) {
      this.audit.log({
        sessionId: '',
        remoteIp,
        action: `${method} ${pathname}`,
        result: 'error',
        denialReason: 'Route not found',
      });
      sendError(res, 404, 'Not found');
      return;
    }

    // Auth check (skip for 'none' permission level)
    let sessionId = '';
    let permissions: RemotePermissionSet | null = null;

    if (route.permission !== 'none') {
      const authHeader = req.headers.authorization ?? '';
      const token = authHeader.startsWith('Bearer ')
        ? authHeader.slice(7)
        : '';

      if (!token) {
        this.audit.log({
          sessionId: '',
          remoteIp,
          action: `${method} ${pathname}`,
          result: 'denied',
          denialReason: 'Missing authorization token',
        });
        sendError(res, 401, 'Authorization required');
        return;
      }

      const validation = this.auth.validateToken(token, remoteIp);
      if (!validation) {
        this.audit.log({
          sessionId: '',
          remoteIp,
          action: `${method} ${pathname}`,
          result: 'denied',
          denialReason: 'Invalid or expired token',
        });
        sendError(res, 401, 'Invalid or expired token');
        return;
      }

      permissions = validation.permissions;

      // Permission check
      if (!hasPermission(permissions, route.permission)) {
        this.audit.log({
          sessionId: '',
          remoteIp,
          action: `${method} ${pathname}`,
          result: 'denied',
          denialReason: `Insufficient permissions: requires ${route.permission}`,
        });
        sendError(res, 403, `Insufficient permissions: requires ${route.permission}`);
        return;
      }

      // Reuse existing session for same token, or create new
      const tokenHash = createHash('sha256').update(token).digest('hex');
      const session = this.sessions.findOrCreateSession(
        tokenHash,
        'direct',
        remoteIp,
        permissions,
      );
      sessionId = session.sessionId;
    }

    // Execute handler
    try {
      const result = route.handler(body);
      // Handle both sync and async handlers
      const resolved = result instanceof Promise ? await result : result;

      this.audit.log({
        sessionId,
        remoteIp,
        action: `${method} ${pathname}`,
        resource: pathname,
        result: 'success',
      });

      sendJson(res, 200, resolved);
    } catch (err: unknown) {
      const internalMessage = err instanceof Error ? err.message : String(err);

      this.audit.log({
        sessionId,
        remoteIp,
        action: `${method} ${pathname}`,
        resource: pathname,
        result: 'error',
        denialReason: internalMessage,
      });

      // Do not expose internal error details to remote clients
      sendError(res, 500, 'Internal server error');
    }
  }

  // ── Private: Route definitions ─────────────────────────────────────

  private buildRoutes(): Route[] {
    return [
      {
        method: 'GET',
        path: '/remote/ping',
        permission: 'none',
        handler: () => this.handlers.handlePing(),
      },
      {
        method: 'GET',
        path: '/remote/conversations',
        permission: 'read',
        handler: () => ({
          conversations: this.handlers.handleConversationsList(),
        }),
      },
      {
        method: 'POST',
        path: '/remote/conversation',
        permission: 'read',
        handler: (body) => {
          const conversationId = body.conversationId;
          if (typeof conversationId !== 'string' || !conversationId) {
            throw new Error('conversationId must be a non-empty string');
          }
          const result = this.handlers.handleConversationGet(conversationId);
          if (!result) {
            throw new Error(`Conversation not found: ${conversationId}`);
          }
          return result;
        },
      },
      {
        method: 'POST',
        path: '/remote/memory/search',
        permission: 'read',
        handler: (body) => {
          const query = body.query;
          if (typeof query !== 'string' || !query) {
            throw new Error('query must be a non-empty string');
          }
          const limit = typeof body.limit === 'number' ? body.limit : undefined;
          const results = this.handlers.handleMemorySearch(query, limit);
          return { results };
        },
      },
    ];
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Sends a JSON response.
 */
export function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

/**
 * Sends an HTML response.
 */
export function sendHtml(
  res: ServerResponse,
  status: number,
  html: string,
): void {
  const payload = Buffer.from(html, 'utf-8');
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': payload.length,
    'Content-Security-Policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'",
  });
  res.end(payload);
}

/**
 * Sends a JSON error response.
 */
export function sendError(
  res: ServerResponse,
  status: number,
  error: string,
): void {
  sendJson(res, status, { error });
}

/**
 * Sets CORS headers on a response.
 *
 * Restricts origin to the server's own HTTPS endpoint to prevent
 * cross-origin attacks. Only allows methods that have actual route definitions.
 * Authentication is handled via Bearer tokens, not cookies.
 */
function setCorsHeaders(res: ServerResponse, port: number): void {
  res.setHeader('Access-Control-Allow-Origin', `https://127.0.0.1:${port}`);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

/**
 * Parses the request body as JSON.
 * Returns an empty object if the body is empty or invalid.
 */
/** Maximum request body size (1 MB). */
const MAX_BODY_SIZE = 1_048_576;

function parseJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let totalSize = 0;

    req.on('data', (chunk: Buffer) => {
      totalSize += chunk.length;
      if (totalSize > MAX_BODY_SIZE) {
        req.destroy();
        resolve({});
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }

      try {
        const raw = Buffer.concat(chunks).toString('utf-8');
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          resolve(parsed as Record<string, unknown>);
        } else {
          resolve({});
        }
      } catch {
        resolve({});
      }
    });

    req.on('error', () => {
      resolve({});
    });
  });
}

/**
 * Extracts the client IP address from the request.
 */
function extractIp(req: IncomingMessage): string {
  // Do not trust X-Forwarded-For in direct mode (no reverse proxy).
  // Use the actual socket address to prevent IP spoofing.
  return req.socket.remoteAddress ?? 'unknown';
}

/**
 * Checks whether a permission set grants the required permission level.
 */
function hasPermission(
  permissions: RemotePermissionSet,
  required: 'read' | 'write' | 'execute',
): boolean {
  switch (required) {
    case 'read':
      return permissions.read.enabled;
    case 'write':
      return permissions.write.enabled;
    case 'execute':
      return permissions.execute.enabled;
    default:
      return false;
  }
}
