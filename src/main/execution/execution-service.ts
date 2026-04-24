/**
 * Execution safety layer for AI-initiated file and command operations.
 *
 * All AI file modifications and command executions must pass through
 * this service, which enforces:
 *   1. Audit logging of every operation
 *   2. Dry-run diff generation for patch sets
 *   3. Atomic apply with rollback on failure
 *   4. Command policy enforcement (allowlist + blocked patterns)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  CommandRequest,
  CommandResult,
  CommandPolicy,
  PatchSet,
  ApplyResult,
  AuditEntry,
  DiffEntry,
} from '../../shared/execution-types';
import { DEFAULT_COMMAND_POLICY } from '../../shared/execution-types';
import { AuditLog } from './audit-log';
import { PatchApplier } from './patch-applier';
import { CommandRunner } from './command-runner';
import type { CircuitBreaker } from '../queue/circuit-breaker';

/** Options for creating an ExecutionService instance. */
export interface ExecutionServiceOptions {
  /** Absolute path to the workspace root. All file operations are confined within. */
  workspaceRoot: string;
  /** Command policy to enforce. Defaults to DEFAULT_COMMAND_POLICY. */
  commandPolicy?: CommandPolicy;
  /** Optional runtime access gate (e.g., permission check + user approval). */
  ensureAccess?: (
    aiId: string,
    action: 'read' | 'write' | 'execute',
    targetPath: string,
    conversationId?: string,
  ) => Promise<boolean>;
  /**
   * R9-Task6 (spec §8 CB-5 `files_per_turn`): CircuitBreaker that
   * receives the count of files modified by each successful non-dryRun
   * applyPatch. Optional — tests and legacy callers without an
   * autonomy loop leave it undefined. `recordFileChanges` is a no-op
   * when the total stays at or under the configured limit, so wiring
   * the breaker is safe even outside auto_toggle/queue projects.
   */
  circuitBreaker?: CircuitBreaker;
}

/**
 * Central service for safe execution of AI-proposed operations.
 *
 * Combines audit logging, patch application, and command execution
 * into a unified interface with consistent security enforcement.
 */
export class ExecutionService {
  private readonly auditLog: AuditLog;
  private readonly patchApplier: PatchApplier;
  private readonly commandRunner: CommandRunner;
  private readonly ensureAccess?: ExecutionServiceOptions['ensureAccess'];
  private readonly circuitBreaker?: CircuitBreaker;

  constructor(options: ExecutionServiceOptions) {
    this.auditLog = new AuditLog();
    this.patchApplier = new PatchApplier(options.workspaceRoot);
    this.commandRunner = new CommandRunner(
      options.commandPolicy ?? DEFAULT_COMMAND_POLICY,
    );
    this.ensureAccess = options.ensureAccess;
    this.circuitBreaker = options.circuitBreaker;
  }

  /**
   * Read a file's content with audit logging.
   *
   * @param filePath - Absolute path to the file.
   * @param aiId - The AI that requested the read.
   * @returns The file content as a string.
   */
  async readFile(filePath: string, aiId: string): Promise<string> {
    const operationId = randomUUID();
    const normalizedPath = path.resolve(filePath);

    try {
      if (this.ensureAccess) {
        const allowed = await this.ensureAccess(aiId, 'read', normalizedPath);
        if (!allowed) throw new Error(`Read permission denied: ${normalizedPath}`);
      }
      const content = fs.readFileSync(normalizedPath, 'utf-8');
      this.auditLog.record({
        operationId,
        aiId,
        action: 'read',
        targetPath: normalizedPath,
        timestamp: Date.now(),
        result: 'success',
        rollbackable: false,
      });
      return content;
    } catch (err) {
      this.auditLog.record({
        operationId,
        aiId,
        action: 'read',
        targetPath: normalizedPath,
        timestamp: Date.now(),
        result: 'failed',
        rollbackable: false,
        details: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  /**
   * Write content to a file with audit logging.
   *
   * @param filePath - Absolute path to the file.
   * @param content - The content to write.
   * @param aiId - The AI that requested the write.
   */
  async writeFile(
    filePath: string,
    content: string,
    aiId: string,
  ): Promise<void> {
    const operationId = randomUUID();
    const normalizedPath = path.resolve(filePath);

    try {
      if (this.ensureAccess) {
        const allowed = await this.ensureAccess(aiId, 'write', normalizedPath);
        if (!allowed) throw new Error(`Write permission denied: ${normalizedPath}`);
      }
      const dir = path.dirname(normalizedPath);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(normalizedPath, content, 'utf-8');
      this.auditLog.record({
        operationId,
        aiId,
        action: 'write',
        targetPath: normalizedPath,
        timestamp: Date.now(),
        result: 'success',
        rollbackable: true,
      });
    } catch (err) {
      this.auditLog.record({
        operationId,
        aiId,
        action: 'write',
        targetPath: normalizedPath,
        timestamp: Date.now(),
        result: 'failed',
        rollbackable: false,
        details: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  /**
   * List directory contents with audit logging.
   *
   * @param dirPath - Absolute path to the directory.
   * @param aiId - The AI that requested the listing.
   * @returns Array of file/directory names.
   */
  async listDir(dirPath: string, aiId: string): Promise<string[]> {
    const operationId = randomUUID();
    const normalizedPath = path.resolve(dirPath);

    try {
      if (this.ensureAccess) {
        const allowed = await this.ensureAccess(aiId, 'read', normalizedPath);
        if (!allowed) throw new Error(`Read permission denied: ${normalizedPath}`);
      }
      const entries = fs.readdirSync(normalizedPath);
      this.auditLog.record({
        operationId,
        aiId,
        action: 'read',
        targetPath: normalizedPath,
        timestamp: Date.now(),
        result: 'success',
        rollbackable: false,
      });
      return entries;
    } catch (err) {
      this.auditLog.record({
        operationId,
        aiId,
        action: 'read',
        targetPath: normalizedPath,
        timestamp: Date.now(),
        result: 'failed',
        rollbackable: false,
        details: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  /**
   * Apply a patch set with audit logging.
   *
   * When dryRun is true, generates a diff preview without modifications.
   * When dryRun is false, applies atomically with rollback on failure.
   *
   * @param patchSet - The patch set to apply.
   * @returns The apply result with success/failure status.
   */
  async applyPatch(patchSet: PatchSet): Promise<ApplyResult> {
    const auditEntry: AuditEntry = {
      operationId: patchSet.operationId,
      aiId: patchSet.aiId,
      action: 'apply-patch',
      targetPath: patchSet.entries.map((e) => e.targetPath).join(', '),
      timestamp: Date.now(),
      result: 'success',
      rollbackable: !patchSet.dryRun,
      details: patchSet.dryRun ? 'dry-run' : undefined,
    };

    try {
      if (this.ensureAccess) {
        for (const entry of patchSet.entries) {
          const allowed = await this.ensureAccess(
            patchSet.aiId,
            'write',
            entry.targetPath,
            patchSet.conversationId,
          );
          if (!allowed) {
            return {
              success: false,
              appliedEntries: [],
              error: `Write permission denied: ${entry.targetPath}`,
              rolledBack: false,
            };
          }
        }
      }
      const result = this.patchApplier.apply(patchSet);
      auditEntry.result = result.success ? 'success' : 'failed';
      if (!result.success) {
        auditEntry.details = result.error;
        auditEntry.rollbackable = false;
      }
      this.auditLog.record(auditEntry);
      // R9-Task6: feed `files_per_turn` on a real (non-dry-run) apply
      // that succeeded. Dry-run previews never write to disk, so they
      // must not count toward the per-turn tripwire. We use
      // `appliedEntries.length` rather than `patchSet.entries.length`
      // so partial rollback on failure doesn't get over-counted.
      if (!patchSet.dryRun && result.success && this.circuitBreaker) {
        this.circuitBreaker.recordFileChanges(result.appliedEntries.length);
      }
      return result;
    } catch (err) {
      auditEntry.result = 'failed';
      auditEntry.details = err instanceof Error ? err.message : String(err);
      auditEntry.rollbackable = false;
      this.auditLog.record(auditEntry);
      throw err;
    }
  }

  /**
   * Generate a diff preview for a patch set without applying it.
   *
   * @param patchSet - The patch set to preview.
   * @returns Array of diff entries.
   */
  generateDiff(patchSet: PatchSet): DiffEntry[] {
    return this.patchApplier.generateDiff(patchSet);
  }

  /**
   * Run a command with policy enforcement and audit logging.
   *
   * @param request - The structured command request.
   * @param aiId - The AI that requested the execution.
   * @returns The command result.
   */
  async runCommand(
    request: CommandRequest,
    aiId: string,
  ): Promise<CommandResult> {
    const operationId = randomUUID();
    const fullCommand = [request.command, ...request.args].join(' ');

    if (this.ensureAccess) {
      const allowed = await this.ensureAccess(aiId, 'execute', request.cwd);
      if (!allowed) {
        this.auditLog.record({
          operationId,
          aiId,
          action: 'execute',
          targetPath: request.cwd,
          timestamp: Date.now(),
          result: 'denied',
          rollbackable: false,
          details: `Permission denied: ${fullCommand}`,
        });
        throw new Error(`Execute permission denied: ${request.cwd}`);
      }
    }

    // Validate command against policy first
    try {
      this.commandRunner.validate(request);
    } catch (err) {
      this.auditLog.record({
        operationId,
        aiId,
        action: 'execute',
        targetPath: request.cwd,
        timestamp: Date.now(),
        result: 'denied',
        rollbackable: false,
        details: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }

    // Execute the command
    try {
      const result = await this.commandRunner.run(request);
      this.auditLog.record({
        operationId,
        aiId,
        action: 'execute',
        targetPath: request.cwd,
        timestamp: Date.now(),
        result: 'success',
        rollbackable: false,
        details: fullCommand,
      });
      return result;
    } catch (err) {
      this.auditLog.record({
        operationId,
        aiId,
        action: 'execute',
        targetPath: request.cwd,
        timestamp: Date.now(),
        result: 'failed',
        rollbackable: false,
        details: `${fullCommand}: ${err instanceof Error ? err.message : String(err)}`,
      });
      throw err;
    }
  }

  /**
   * Get the audit log instance for querying entries.
   */
  getAuditLog(): AuditLog {
    return this.auditLog;
  }
}
