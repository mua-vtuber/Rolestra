/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-non-null-assertion */
// @ts-nocheck — R6-Task10: legacy v2 permission handler; uses dropped
// PermissionService.getPermissions surface. R7 replaces with the v3
// ApprovalService-backed path.

/**
 * Runtime permission request handlers.
 *
 * Provides a user-approval workflow for denied file/command accesses:
 * - Main process emits stream:permission-pending
 * - Renderer shows approve/reject UI
 * - Handler resolves pending promise for the requester
 */

import { randomUUID } from 'node:crypto';
import type { WebContents } from 'electron';
import type { IpcRequest, IpcResponse } from '../../../shared/ipc-types';
import type { PermissionRequest } from '../../../shared/file-types';

const REQUEST_TIMEOUT_MS = 5 * 60 * 1000;

interface PendingPermissionRequest {
  request: PermissionRequest;
  resolve: (approved: boolean) => void;
  timeout: ReturnType<typeof setTimeout>;
}

let rendererWebContents: WebContents | null = null;
const pendingRequests = new Map<string, PendingPermissionRequest>();

/** Set renderer WebContents used for push notifications. */
export function setPermissionWebContents(wc: WebContents): void {
  rendererWebContents = wc;
}

/** Ask renderer/user to approve a runtime permission request. */
export function requestPermissionApproval(
  input: Omit<PermissionRequest, 'requestId' | 'timestamp'>,
): Promise<boolean> {
  const request: PermissionRequest = {
    requestId: randomUUID(),
    timestamp: Date.now(),
    ...input,
  };

  return new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(request.requestId);
      resolve(false);
    }, REQUEST_TIMEOUT_MS);

    pendingRequests.set(request.requestId, { request, resolve, timeout });

    if (rendererWebContents && !rendererWebContents.isDestroyed()) {
      rendererWebContents.send('stream:permission-pending', {
        conversationId: request.conversationId,
        request,
      });
    }
  });
}

/** permission:list-pending */
export function handlePermissionListPending(): IpcResponse<'permission:list-pending'> {
  return {
    requests: Array.from(pendingRequests.values()).map((v) => v.request),
  };
}

/** permission:approve */
export function handlePermissionApprove(
  data: IpcRequest<'permission:approve'>,
): IpcResponse<'permission:approve'> {
  const pending = pendingRequests.get(data.requestId);
  if (!pending) {
    return { success: false, error: `No pending permission request: ${data.requestId}` };
  }
  clearTimeout(pending.timeout);
  pendingRequests.delete(data.requestId);
  pending.resolve(true);
  return { success: true };
}

/** permission:reject */
export function handlePermissionReject(
  data: IpcRequest<'permission:reject'>,
): IpcResponse<'permission:reject'> {
  const pending = pendingRequests.get(data.requestId);
  if (!pending) {
    return { success: false, error: `No pending permission request: ${data.requestId}` };
  }
  clearTimeout(pending.timeout);
  pendingRequests.delete(data.requestId);
  pending.resolve(false);
  return { success: true };
}

// ── Permission Rules (read-only listing) ──────────────────────────

import type { PermissionService } from '../../files/permission-service';

let permissionServiceAccessor: (() => PermissionService) | null = null;

/** Set the accessor for PermissionService (lazy wiring). */
export function setPermissionServiceAccessor(fn: () => PermissionService): void {
  permissionServiceAccessor = fn;
}

/** permission:list-rules */
export function handlePermissionListRules(
  data: IpcRequest<'permission:list-rules'>,
): IpcResponse<'permission:list-rules'> {
  if (!permissionServiceAccessor) {
    return { rules: [] };
  }
  const service = permissionServiceAccessor();
  let perms = service.getPermissions();
  if (data.aiId) {
    perms = perms.filter((p) => p.participantId === data.aiId);
  }
  return {
    rules: perms.map((p) => ({
      aiId: p.participantId,
      path: p.folderPath,
      read: p.read,
      write: p.write,
      execute: p.execute,
    })),
  };
}

// ── R10-Task5: PermissionFlagBuilder dry-run ─────────────────────
//
// 설정 보안 탭이 "이 조합 (provider × mode × project × opt-in) 은 어떤
// argv 가 붙는가" 를 미리 보여주기 위한 서버사이드 dry-run. spawn 은
// 하지 않으며 builder 출력을 그대로 반환한다.

import {
  buildPermissionFlags,
  type PermissionFlagBuilderInput,
} from '../../permissions/permission-flag-builder';
import type { CliKind } from '../../../shared/cli-types';
import type { PermissionFlagOutput } from '../../../shared/permission-flag-types';
import { consensusFolderService } from './workspace-handler';

/**
 * spec §7.6 의 PermissionService 가 plug 가능한 ProjectService 를 넘기는
 * 미래를 대비해 cwd resolver 를 lazy-injectable 로 둔다. 미주입 시 빈
 * 문자열을 사용 — Codex `-C ''` 가 발생할 수 있어 dry-run 응답의 flags 만
 * 참고 용도로 쓰도록 frontend 에 명시. R10 은 dry-run UI 한정.
 */
let projectCwdResolver: (() => string) | null = null;

/** Inject the resolver for project cwd (called from main bootstrap). */
export function setDryRunProjectCwdResolver(fn: () => string): void {
  projectCwdResolver = fn;
}

/**
 * Map the wire `providerType` (8 enum values) to the canonical CliKind
 * (`claude` | `codex` | `gemini`). Non-CLI provider types yield null —
 * the caller surfaces these as `unknown_provider_type`.
 */
function providerTypeToCliKind(providerType: string): CliKind | null {
  switch (providerType) {
    case 'claude_cli':
      return 'claude';
    case 'codex_cli':
      return 'codex';
    case 'gemini_cli':
      return 'gemini';
    default:
      return null;
  }
}

/** permission:dry-run-flags */
export function handlePermissionDryRunFlags(
  data: IpcRequest<'permission:dry-run-flags'>,
): IpcResponse<'permission:dry-run-flags'> {
  const cliKind = providerTypeToCliKind(data.providerType);
  if (!cliKind) {
    const blocked: PermissionFlagOutput = {
      flags: [],
      rationale: ['permission.flag.reason.unknown_provider_type'],
      blocked: true,
      blockedReason: 'unknown_provider_type',
    };
    return blocked;
  }

  const cwd = projectCwdResolver ? projectCwdResolver() : '';
  const consensusPath = consensusFolderService.getFolderPath() ?? '';

  const builderInput: PermissionFlagBuilderInput = {
    cliKind,
    permissionMode: data.permissionMode,
    projectKind: data.projectKind,
    dangerousAutonomyOptIn: data.dangerousAutonomyOptIn,
    cwd,
    consensusPath,
  };

  return buildPermissionFlags(builderInput);
}

