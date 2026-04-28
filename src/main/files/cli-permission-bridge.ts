/**
 * Bridges SSM permission actions to CLI provider permission mode changes.
 *
 * Respawns CLI providers with updated permission flags (--allowedTools,
 * --add-dir, etc.) when the SessionStateMachine grants or revokes worker
 * status. The file-level concern is owned by `PermissionService`'s
 * path-guard model (per-call boundary check, no per-worker state to
 * mutate), so this bridge is the only SSM permission-action listener.
 */

import type { PermissionAction } from '../../shared/session-state-types';
import type { SessionStateMachine } from '../engine/session-state-machine';
import type { BaseProvider } from '../providers/provider-interface';
import { CliProvider } from '../providers/cli/cli-provider';

/** Provider lookup function — avoids direct dependency on ProviderRegistry singleton. */
export type ProviderLookup = (id: string) => BaseProvider | undefined;

/** List all registered provider IDs. */
export type ProviderIdLister = () => string[];

/**
 * Attach a CLI permission bridge to a SessionStateMachine.
 *
 * @param ssm - The session state machine emitting permission events.
 * @param getProvider - Lookup function for providers by ID.
 * @param listProviderIds - Function returning all registered provider IDs.
 * @returns An unsubscribe function to detach the bridge.
 */
export function attachCliPermissionBridge(
  ssm: SessionStateMachine,
  getProvider: ProviderLookup,
  listProviderIds: ProviderIdLister,
): () => void {
  return ssm.onPermissionAction((action: PermissionAction) => {
    const projectPath = ssm.projectPath;
    if (!projectPath) return;

    switch (action.type) {
      case 'grant_worker':
        void grantCliWorker(getProvider, action.workerId, projectPath);
        break;
      case 'revoke_worker':
        void revokeCliWorker(getProvider, action.workerId);
        break;
      case 'revoke_all':
        void revokeAllCliProviders(getProvider, listProviderIds);
        break;
    }
  });
}

async function grantCliWorker(
  getProvider: ProviderLookup,
  workerId: string,
  projectPath: string,
): Promise<void> {
  const provider = getProvider(workerId);
  if (!(provider instanceof CliProvider)) return;

  try {
    provider.setProjectPath(projectPath);
    await provider.respawnWithPermissions('worker');
  } catch (err) {
    console.error(`[cli-permission-bridge] Failed to grant worker permissions to ${workerId}:`, err);
  }
}

async function revokeCliWorker(
  getProvider: ProviderLookup,
  workerId: string,
): Promise<void> {
  const provider = getProvider(workerId);
  if (!(provider instanceof CliProvider)) return;

  try {
    await provider.respawnWithPermissions('read-only');
  } catch (err) {
    console.error(`[cli-permission-bridge] Failed to revoke worker permissions from ${workerId}:`, err);
  }
}

async function revokeAllCliProviders(
  getProvider: ProviderLookup,
  listProviderIds: ProviderIdLister,
): Promise<void> {
  const ids = listProviderIds();
  const results = ids.map(async (id) => {
    const provider = getProvider(id);
    if (!(provider instanceof CliProvider)) return;
    if (provider.permissionMode === 'read-only') return; // already read-only

    try {
      await provider.respawnWithPermissions('read-only');
    } catch (err) {
      console.error(`[cli-permission-bridge] Failed to revoke permissions from ${id}:`, err);
    }
  });

  await Promise.allSettled(results);
}
