/**
 * SsmContext — the v3 execution-context header every SessionStateMachine
 * instance carries from the moment it is constructed.
 *
 * The context bundles the identifiers and policy flags the SSM needs to
 * route permission side-effects, render audit log entries, and resolve
 * workspace paths. Prior to v3 these values lived on ad-hoc Conversation /
 * ChatHandler fields; R2 Task 12 hoists them into a single immutable
 * record so downstream services (PermissionService, ExecutionService,
 * MemoryService, ApprovalService) receive a consistent view.
 *
 * Required fields (spec §7.5 + Task 12 decision):
 *   - `meetingId`     — the active meeting row (`meetings.id`) driving
 *                       this SSM. Empty string is a R2-bridge sentinel
 *                       used by call sites that pre-date Task 18 IPC
 *                       wiring; cleanup pending (R2-Task21).
 *   - `channelId`     — the channel hosting the meeting. Empty-string
 *                       sentinel during R2 bridge, same as above.
 *   - `projectId`     — parent project for this channel. Required on
 *                       every SSM (DMs do not get SSMs).
 *   - `projectPath`   — absolute filesystem path materialised by
 *                       `resolveProjectPaths`. Used by PermissionService
 *                       for the path-guard anchor.
 *   - `permissionMode`— one of `auto | hybrid | approval`. Baked into
 *                       the context at construction time; policy changes
 *                       mid-meeting require a new SSM.
 *   - `autonomyMode`  — one of `manual | auto_toggle | queue`. Same
 *                       immutability semantics as `permissionMode`.
 *
 * Why flat (no nesting):
 *   All six fields are already either strings or narrow string-literal
 *   enums. Grouping them into `{ project: { id, path }, meeting: {...} }`
 *   would complicate call sites without adding type safety. Flat keeps
 *   destructuring ergonomic and keeps the contract visible at a glance.
 *
 * Immutability:
 *   Callers pass a fresh `SsmContext` to `new SessionStateMachine(...)`.
 *   The SSM exposes it via a readonly getter; mutating the original
 *   object after construction is undefined behaviour. If a field needs
 *   to change (e.g. project re-linked), rebuild the SSM from the latest
 *   snapshot.
 */

import type { PermissionMode, AutonomyMode } from './project-types';

export interface SsmContext {
  /** Active meeting id (meetings.id). Empty string during R2 bridge. */
  meetingId: string;
  /** Channel hosting the meeting. Empty string during R2 bridge. */
  channelId: string;
  /** Parent project id for this channel. */
  projectId: string;
  /** Absolute filesystem path for the project workspace. */
  projectPath: string;
  /** Project permission policy — immutable for the life of the SSM. */
  permissionMode: PermissionMode;
  /** Project autonomy policy — immutable for the life of the SSM. */
  autonomyMode: AutonomyMode;
}

/**
 * Test-friendly factory that returns a minimally-valid SsmContext. The
 * defaults favour "safe-by-default" policy (`approval` mode, `manual`
 * autonomy) so a test that forgets to override them cannot accidentally
 * exercise auto-grant code paths.
 *
 * This factory is intentionally NOT used in production — each production
 * site constructs its own SsmContext with the real ids. The factory
 * exists purely to keep test boilerplate short.
 */
export function createDefaultSsmContext(
  overrides: Partial<SsmContext> = {},
): SsmContext {
  return {
    meetingId: '',
    channelId: '',
    projectId: '',
    projectPath: '',
    permissionMode: 'approval',
    autonomyMode: 'manual',
    ...overrides,
  };
}
