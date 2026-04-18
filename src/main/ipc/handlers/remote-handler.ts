/**
 * IPC handlers for remote:* channels.
 *
 * Bridges renderer remote-access requests to RemoteManagerImpl.
 * Lazy-initializes with the singleton database.
 */

import { getDatabase } from '../../database/connection';
import { RemoteManagerImpl } from '../../remote/remote-manager';
import type { RemoteAccessPolicy, RemoteAccessGrant, RemotePermissionSet, RemoteSession, TailscaleStatus } from '../../../shared/remote-types';

let remoteManager: RemoteManagerImpl | null = null;

function getRemoteManager(): RemoteManagerImpl {
  if (remoteManager) return remoteManager;
  remoteManager = new RemoteManagerImpl(getDatabase());
  return remoteManager;
}

export function handleRemoteGetPolicy(): { policy: RemoteAccessPolicy } {
  return { policy: getRemoteManager().getPolicy() };
}

export async function handleRemoteSetPolicy(
  data: { policy: RemoteAccessPolicy },
): Promise<{ success: true }> {
  await getRemoteManager().setPolicy(data.policy);
  return { success: true };
}

export function handleRemoteGetSessions(): { sessions: RemoteSession[] } {
  return { sessions: getRemoteManager().getSessions() };
}

export async function handleRemoteTailscaleStatus(): Promise<{ status: TailscaleStatus }> {
  const status = await getRemoteManager().getTailscaleStatus();
  return { status };
}

export async function handleRemoteGenerateToken(
  data: { permissions: RemotePermissionSet; description?: string; expiresAt?: number },
): Promise<{ token: string; grantId: string }> {
  const manager = getRemoteManager();
  const token = await manager.generateAccessToken(data.permissions, data.expiresAt);
  // To return the grantId, we list grants and find the latest one matching
  const grants = manager.listGrants();
  const latest = grants[grants.length - 1];
  return { token, grantId: latest?.grantId ?? '' };
}

export function handleRemoteListGrants(): { grants: RemoteAccessGrant[] } {
  return { grants: getRemoteManager().listGrants() };
}

export async function handleRemoteRevokeToken(
  data: { grantId: string },
): Promise<{ success: true }> {
  getRemoteManager().revokeGrant(data.grantId);
  return { success: true };
}

export async function handleRemoteStartServer(): Promise<{ success: true }> {
  await getRemoteManager().startServer();
  return { success: true };
}

export async function handleRemoteStopServer(): Promise<{ success: true }> {
  await getRemoteManager().stopServer();
  return { success: true };
}

export function handleRemoteServerStatus(): { running: boolean; port: number } {
  const manager = getRemoteManager();
  const policy = manager.getPolicy();
  return {
    running: manager.isRunning(),
    port: policy.directAccessPort,
  };
}
