/**
 * AppToolProvider — provides state-based tools to API/Local providers.
 *
 * Unlike CLI providers which have direct filesystem access,
 * API/Local providers can only interact with files through
 * app-mediated function calling. This class determines which
 * tools to expose based on the current session state.
 *
 * Tool execution is delegated to:
 * - file_read: PermissionService -> fs.readFile
 * - file_write: ExecutionService (dry-run -> approve -> apply)
 * - command_execute: ExecutionService (allowlist + audit)
 * - web_search: Search engine integration
 */

import type { SessionState } from '../../shared/session-state-types';

export interface AppTool {
  name: string;
  description: string;
}

const FILE_READ: AppTool = { name: 'file_read', description: 'Read file contents' };
const FILE_WRITE: AppTool = { name: 'file_write', description: 'Write/modify file contents' };
const COMMAND_EXECUTE: AppTool = { name: 'command_execute', description: 'Execute a shell command' };
const WEB_SEARCH: AppTool = { name: 'web_search', description: 'Search the web' };

const READ_ONLY_TOOLS: AppTool[] = [FILE_READ, WEB_SEARCH];
const WORKER_TOOLS: AppTool[] = [FILE_READ, FILE_WRITE, COMMAND_EXECUTE, WEB_SEARCH];

export class AppToolProvider {
  getAvailableTools(state: SessionState, isWorker: boolean): AppTool[] {
    if (state === 'EXECUTING' && isWorker) {
      return WORKER_TOOLS;
    }
    return READ_ONLY_TOOLS;
  }
}
