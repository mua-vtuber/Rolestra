/**
 * Handler for 'cli-permission:*' IPC channels.
 *
 * Manages pending CLI native permission request resolvers.
 *
 * Flow:
 * 1. TurnExecutor receives a permission_request event from a CLI provider.
 * 2. TurnExecutor emits stream:cli-permission-request to the renderer.
 * 3. TurnExecutor calls registerPendingCliPermission() with a resolver Promise.
 * 4. The renderer shows an approval card and the user clicks Approve or Reject.
 * 5. The renderer sends cli-permission:respond via IPC.
 * 6. handleCliPermissionRespond() looks up the resolver and calls it.
 * 7. The Promise in TurnExecutor resolves, unblocking the CLI stream.
 */

import type { IpcRequest, IpcResponse } from '../../../shared/ipc-types';

/** Map key: `${participantId}:${cliRequestId}` */
const pendingRequests = new Map<string, (approved: boolean) => void>();

/**
 * Register a resolver for a pending CLI permission request.
 *
 * Called by TurnExecutor when a permission_request event is intercepted.
 * The resolver is called when the user approves or rejects via the renderer.
 */
export function registerPendingCliPermission(
  participantId: string,
  cliRequestId: string,
  resolver: (approved: boolean) => void,
): void {
  const key = `${participantId}:${cliRequestId}`;
  if (pendingRequests.has(key)) {
    console.warn(`[cli-permission] Duplicate pending request for key ${key}; overwriting`);
  }
  pendingRequests.set(key, resolver);
}

/**
 * cli-permission:respond — user approved or rejected a CLI native permission request.
 */
export function handleCliPermissionRespond(
  data: IpcRequest<'cli-permission:respond'>,
): IpcResponse<'cli-permission:respond'> {
  const key = `${data.participantId}:${data.cliRequestId}`;
  const resolver = pendingRequests.get(key);
  if (resolver) {
    resolver(data.approved);
    pendingRequests.delete(key);
  } else {
    console.warn(`[cli-permission] No pending request found for key ${key}`);
  }
  return undefined;
}

/**
 * Clear all pending permission request resolvers.
 *
 * Called when the active session is cleared (e.g. new conversation, session reset).
 * Any waiting resolvers are auto-rejected to unblock the CLI stream.
 */
export function clearPendingCliPermissions(): void {
  if (pendingRequests.size > 0) {
    console.info(`[cli-permission] Clearing ${pendingRequests.size} pending permission request(s)`);
    for (const resolver of pendingRequests.values()) {
      // Auto-reject on session clear so the CLI stream is not left hanging
      resolver(false);
    }
    pendingRequests.clear();
  }
}
