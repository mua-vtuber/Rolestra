/**
 * Execution safety layer type definitions shared between main and renderer.
 *
 * All AI-initiated file modifications and command executions must pass
 * through the ExecutionService, which enforces:
 *   1. dry-run diff generation
 *   2. user approval
 *   3. atomic apply (all-or-nothing)
 *   4. rollback on failure
 *   5. audit logging
 */

/** A structured command request — no shell strings allowed. */
export interface CommandRequest {
  /** Executable path or command name. */
  command: string;
  /** Argument array (never joined into a shell string). */
  args: string[];
  /** Working directory for execution. */
  cwd: string;
}

/** Result of a command execution. */
export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

/** Policy that governs which commands are allowed. */
export interface CommandPolicy {
  /** Allowlist of permitted commands. */
  allowedCommands: string[];
  /** Regex patterns that block dangerous argument combinations. */
  blockedPatterns: string[];
  /** Maximum execution time before kill (ms). */
  maxExecutionTimeMs: number;
  /** Maximum stdout+stderr size (bytes). */
  maxOutputBytes: number;
}

/** A single file operation in a patch set. */
export interface PatchEntry {
  /** Target file path (absolute). */
  targetPath: string;
  /** Operation type. */
  operation: 'create' | 'modify' | 'delete';
  /** New content (for create/modify). */
  newContent?: string;
  /** Original content snapshot (for rollback on modify/delete). */
  originalContent?: string;
}

/** A complete patch set to be applied atomically. */
export interface PatchSet {
  /** Unique operation ID for audit trail. */
  operationId: string;
  /** The AI that proposed this patch. */
  aiId: string;
  /** Conversation context. */
  conversationId: string;
  /** Individual file operations. */
  entries: PatchEntry[];
  /** Whether this is a dry-run (preview only). */
  dryRun: boolean;
}

/** Result of applying a patch set. */
export interface ApplyResult {
  success: boolean;
  /** Entries that were successfully applied. */
  appliedEntries: PatchEntry[];
  /** Error message if success is false. */
  error?: string;
  /** Whether rollback was performed. */
  rolledBack: boolean;
}

/** A diff entry for UI display. */
export interface DiffEntry {
  path: string;
  operation: 'create' | 'modify' | 'delete';
  before: string | null;
  after: string | null;
}

/** Audit log entry for every execution attempt. */
export interface AuditEntry {
  /** Unique operation ID. */
  operationId: string;
  /** The AI that initiated the action. */
  aiId: string;
  /** Type of action attempted. */
  action: 'read' | 'write' | 'execute' | 'apply-patch';
  /** Target file path or command. */
  targetPath: string;
  /** When the action occurred. */
  timestamp: number;
  /** Outcome. */
  result: 'success' | 'denied' | 'failed';
  /** Whether this action can be rolled back. */
  rollbackable: boolean;
  /** Additional context (command args, error message, etc.). */
  details?: string;
}

/** Default command policy with conservative defaults. */
export const DEFAULT_COMMAND_POLICY: CommandPolicy = {
  allowedCommands: [
    // node, npm, npx removed — allow arbitrary code execution
    'git', 'ls', 'cat', 'head', 'tail',
    'find', 'grep', 'wc', 'diff', 'mkdir', 'cp', 'mv',
  ],
  blockedPatterns: [
    'rm\\s+-[^\\s]*r[^\\s]*f',  // rm with -rf in any flag order
    'rm\\s+-[^\\s]*f[^\\s]*r',  // rm with -fr variant
    'chmod\\s+[67]77',           // world-writable or setuid+world-writable
    'curl.*\\|.*sh',             // pipe to shell
    'wget.*\\|.*sh',             // pipe to shell (wget)
    '>(\\s*)/dev/sd',            // write to block devices
    'mkfs',                      // format filesystem
    'dd\\s+if=',                 // disk operations
    ':\\(\\)\\{',                // fork bomb
  ],
  maxExecutionTimeMs: 30_000,
  maxOutputBytes: 10 * 1024 * 1024, // 10 MB
};
