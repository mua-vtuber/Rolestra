/**
 * workspace-handler — v2 IPC handlers were retired in R11-Task2.
 *
 * The v3 file/permission system lives elsewhere now:
 *   - {@link ArenaRootService}  — arena-root path lifecycle (`arena-root:*` IPC).
 *   - v3 {@link PermissionService} (`src/main/files/permission-service.ts`)
 *     — path-guard with realpath re-validation, owned by the v3
 *     project lifecycle.
 *   - {@link ApprovalService} — runtime approval prompts (R7+).
 *
 * What survives here are the two stateless helper services that v3
 * production code still depends on at boot:
 *
 *   - {@link workspaceService}        — exposes `.arena/workspace/` info
 *     for diagnostic surfaces (kept for forward use; no IPC).
 *   - {@link consensusFolderService}  — owns the OS Documents-based
 *     consensus folder (used by `permission:dry-run-flags` preview and
 *     by CLI providers to scope spawn cwd).
 *
 * The whole legacy `workspace:*` / `consensus-folder:*` IPC surface
 * (`pick-folder`, `init`, `status` × 2) plus the v2 PermissionService
 * singleton + `ensureAccessWithApproval` bridge were removed: their
 * only callers were the v2 conversation engine, which R11-Task2 also
 * deleted.
 */

import { app } from 'electron';
import { WorkspaceService } from '../../files/workspace-service';
import { ConsensusFolderService } from '../../files/consensus-folder-service';

/** Resolve OS Documents path safely (returns undefined in test environments). */
function getDocumentsPath(): string | undefined {
  try {
    return app.getPath('documents');
  } catch {
    return undefined;
  }
}

/** Shared workspace service instance. */
const workspaceService = new WorkspaceService();

/** Shared consensus folder service instance (uses OS Documents folder). */
const consensusFolderService = new ConsensusFolderService(getDocumentsPath());

export { workspaceService, consensusFolderService };
