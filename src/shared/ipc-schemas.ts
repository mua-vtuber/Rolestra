/**
 * Zod validation schemas for critical IPC channels.
 *
 * These schemas are applied in BOTH development and production modes
 * to ensure type safety for security-sensitive operations.
 *
 * Non-critical channels still rely on TypeScript compile-time checks,
 * with runtime zod validation available in development mode only.
 */

import { z } from 'zod';

/** Safe key pattern — alphanumeric, hyphens, underscores, dots. */
const safeKeyPattern = /^[a-zA-Z0-9_.-]{1,128}$/;

/** Schemas for channels that handle secrets, execution, or system-level ops. */
export const criticalChannelSchemas = {
  'config:set-secret': z.object({
    key: z.string().regex(safeKeyPattern, 'Invalid secret key format'),
    value: z.string().min(1, 'Secret value must not be empty').max(8192),
  }),

  'config:delete-secret': z.object({
    key: z.string().regex(safeKeyPattern, 'Invalid secret key format'),
  }),

  'execution:approve': z.object({
    operationId: z.string().uuid('Invalid operation ID'),
  }),

  'execution:reject': z.object({
    operationId: z.string().uuid('Invalid operation ID'),
  }),

  'permission:approve': z.object({
    requestId: z.string().uuid('Invalid request ID'),
  }),

  'permission:reject': z.object({
    requestId: z.string().uuid('Invalid request ID'),
  }),

  'consensus:respond': z.object({
    decision: z.enum(['AGREE', 'DISAGREE', 'BLOCK', 'ABORT']),
    comment: z.string().max(4000).optional(),
    blockReasonType: z.enum(['security', 'data_loss', 'spec_conflict', 'unknown']).optional(),
    failureResolution: z.enum(['retry', 'stop', 'reassign']).optional(),
    reassignFacilitatorId: z.string().min(1).max(128).optional(),
  }).superRefine((data, ctx) => {
    if (data.decision === 'BLOCK' && !data.blockReasonType) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['blockReasonType'],
        message: 'blockReasonType is required when decision=BLOCK',
      });
    }
    if (data.decision !== 'BLOCK' && data.blockReasonType) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['blockReasonType'],
        message: 'blockReasonType is only allowed when decision=BLOCK',
      });
    }
    if (data.failureResolution === 'reassign' && !data.reassignFacilitatorId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reassignFacilitatorId'],
        message: 'reassignFacilitatorId is required when failureResolution=reassign',
      });
    }
  }),

  'consensus:set-facilitator': z.object({
    facilitatorId: z.string().min(1).max(128),
  }),

  'workspace:init': z.object({
    projectFolder: z.string()
      .min(1, 'Project folder must not be empty')
      .max(1024, 'Project folder path too long'),
  }),

  'remote:set-policy': z.object({
    policy: z.object({
      enabled: z.boolean(),
    }).passthrough(),
  }),

  'remote:generate-token': z.object({
    permissions: z.object({
      read: z.object({ enabled: z.boolean() }),
      write: z.object({ enabled: z.boolean() }),
      execute: z.object({ enabled: z.boolean() }),
    }),
    description: z.string().max(256).optional(),
    expiresAt: z.number().positive().optional(),
  }),

  'remote:revoke-token': z.object({
    grantId: z.string().uuid('Invalid grant ID'),
  }),

  'provider:add': z.object({
    displayName: z.string().min(1).max(128),
    persona: z.string().max(10000).optional(),
    config: z.object({
      type: z.string(),
    }).passthrough(),
  }),

  'provider:remove': z.object({
    id: z.string().min(1).max(128),
  }),
} as const;

// ──────────────────────────────────────────────────────────────────
// v3 (Rolestra) domain schemas — shared enums + per-channel schemas.
// External consumers (router/handlers/tests) may import these directly
// or via v3ChannelSchemas below for channel-keyed lookup.
// ──────────────────────────────────────────────────────────────────

export const projectKindSchema = z.enum(['new', 'external', 'imported']);
export const permissionModeSchema = z.enum(['auto', 'hybrid', 'approval']);
export const autonomyModeSchema = z.enum(['manual', 'auto_toggle', 'queue']);
export const channelKindSchema = z.enum([
  'system_general',
  'system_approval',
  'system_minutes',
  'user',
  'dm',
]);
export const approvalStatusSchema = z.enum([
  'pending',
  'approved',
  'rejected',
  'expired',
  'superseded',
]);
export const approvalDecisionSchema = z.enum([
  'approve',
  'reject',
  'conditional',
]);
export const notificationKindSchema = z.enum([
  'new_message',
  'approval_pending',
  'work_done',
  'error',
  'queue_progress',
  'meeting_state',
]);
export const workStatusSchema = z.enum([
  'online',
  'connecting',
  'offline-connection',
  'offline-manual',
]);

/** project:create — enforces external + auto forbidden (spec §7.3 / CA-1). */
export const projectCreateSchema = z
  .object({
    name: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
    kind: projectKindSchema,
    externalPath: z.string().min(1).max(4096).optional(),
    sourcePath: z.string().min(1).max(4096).optional(),
    permissionMode: permissionModeSchema,
    autonomyMode: autonomyModeSchema.optional(),
    initialMemberProviderIds: z.array(z.string().min(1).max(128)).max(64).optional(),
  })
  .refine((v) => !(v.kind === 'external' && v.permissionMode === 'auto'), {
    message: 'external + auto is forbidden per spec §7.3',
    path: ['permissionMode'],
  })
  .refine((v) => !(v.kind === 'external') || !!v.externalPath, {
    message: 'externalPath is required when kind=external',
    path: ['externalPath'],
  })
  .refine((v) => !(v.kind === 'imported') || !!v.sourcePath, {
    message: 'sourcePath is required when kind=imported',
    path: ['sourcePath'],
  });

export const projectLinkExternalSchema = z.object({
  name: z.string().min(1).max(200),
  externalPath: z.string().min(1).max(4096),
  description: z.string().max(2000).optional(),
  permissionMode: z.enum(['hybrid', 'approval']),
  autonomyMode: autonomyModeSchema.optional(),
  initialMemberProviderIds: z.array(z.string().min(1).max(128)).max(64).optional(),
});

export const projectImportSchema = z.object({
  name: z.string().min(1).max(200),
  sourcePath: z.string().min(1).max(4096),
  description: z.string().max(2000).optional(),
  permissionMode: permissionModeSchema,
  autonomyMode: autonomyModeSchema.optional(),
  initialMemberProviderIds: z.array(z.string().min(1).max(128)).max(64).optional(),
});

export const projectUpdateSchema = z.object({
  id: z.string().min(1).max(128),
  patch: z
    .object({
      name: z.string().min(1).max(200).optional(),
      description: z.string().max(2000).optional(),
      permissionMode: permissionModeSchema.optional(),
      autonomyMode: autonomyModeSchema.optional(),
    })
    .refine((p) => Object.keys(p).length > 0, {
      message: 'patch must contain at least one field',
    }),
});

export const projectSetAutonomySchema = z.object({
  id: z.string().min(1).max(128),
  mode: autonomyModeSchema,
});

/**
 * R7-Task8: spec §7.3 CB-3 mode-transition flow. Opens an approval row;
 * the actual DB write lives in `ProjectService.applyPermissionModeChange`
 * and happens later when the user decides. The zod refine blocks the
 * obviously-wrong `external + auto` combo up front — the service layer
 * re-asserts this as a last-line defence because the `kind` field is not
 * included in the request.
 */
export const projectRequestPermissionModeChangeSchema = z.object({
  id: z.string().min(1).max(128),
  targetMode: permissionModeSchema,
  reason: z.string().max(2000).optional(),
});

export const channelCreateSchema = z.object({
  projectId: z.string().min(1).max(128).nullable(),
  name: z.string().min(1).max(200),
  kind: channelKindSchema,
  memberProviderIds: z.array(z.string().min(1).max(128)).max(64),
});

export const channelRenameSchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().min(1).max(200),
});

export const channelMembersPatchSchema = z.object({
  id: z.string().min(1).max(128),
  providerIds: z.array(z.string().min(1).max(128)).min(1).max(64),
});

export const channelStartMeetingSchema = z.object({
  channelId: z.string().min(1).max(128),
  topic: z.string().min(1).max(500),
});

export const messageAppendSchema = z.object({
  channelId: z.string().min(1).max(128),
  meetingId: z.string().min(1).max(128).nullable().optional(),
  content: z.string().min(1).max(100_000),
  mentions: z.array(z.string().min(1).max(128)).max(64).optional(),
});

export const messageSearchSchema = z.object({
  query: z.string().min(1).max(1000),
  scope: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('channel'), channelId: z.string().min(1).max(128) }),
    z.object({ kind: z.literal('project'), projectId: z.string().min(1).max(128) }),
  ]),
  limit: z.number().int().positive().max(500).optional(),
});

export const meetingAbortSchema = z.object({
  meetingId: z.string().min(1).max(128),
});

/**
 * `meeting:list-active` input schema (R4 dashboard TasksWidget).
 *
 * `limit` is optional; the handler clamps to the repository's internal
 * [1, ACTIVE_MEETING_MAX_LIMIT] range. Omitting `limit` falls back to
 * the default (10 rows).
 */
export const meetingListActiveSchema = z
  .object({
    limit: z.number().int().positive().max(50).optional(),
  })
  .optional();

/**
 * `message:list-recent` input schema (R4 dashboard RecentWidget).
 *
 * Same shape as `meeting:list-active` — single optional numeric `limit`.
 */
export const messageListRecentSchema = z
  .object({
    limit: z.number().int().positive().max(50).optional(),
  })
  .optional();

export const memberSetStatusSchema = z.object({
  providerId: z.string().min(1).max(128),
  status: z.enum(['online', 'offline-manual']),
});

export const approvalDecideSchema = z
  .object({
    id: z.string().min(1).max(128),
    decision: approvalDecisionSchema,
    comment: z.string().max(4000).optional(),
  })
  .refine(
    (v) => !(v.decision === 'conditional') || !!(v.comment && v.comment.length > 0),
    { message: 'comment is required when decision=conditional', path: ['comment'] },
  );

export const queueAddSchema = z.object({
  projectId: z.string().min(1).max(128),
  prompt: z.string().min(1).max(20_000),
  targetChannelId: z.string().min(1).max(128).nullable().optional(),
});

export const queueReorderSchema = z.object({
  projectId: z.string().min(1).max(128),
  orderedIds: z.array(z.string().min(1).max(128)).min(1).max(500),
});

const notificationPrefValueSchema = z
  .object({
    enabled: z.boolean().optional(),
    soundEnabled: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'pref patch must not be empty' });

export const notificationUpdatePrefsSchema = z.object({
  patch: z
    .object({
      new_message: notificationPrefValueSchema.optional(),
      approval_pending: notificationPrefValueSchema.optional(),
      work_done: notificationPrefValueSchema.optional(),
      error: notificationPrefValueSchema.optional(),
      queue_progress: notificationPrefValueSchema.optional(),
      meeting_state: notificationPrefValueSchema.optional(),
    })
    .refine((p) => Object.keys(p).length > 0, {
      message: 'patch must update at least one notification kind',
    }),
});

export const notificationTestSchema = z.object({
  kind: notificationKindSchema,
});

export const arenaRootSetSchema = z.object({
  path: z.string().min(1).max(4096),
});

/**
 * `dashboard:get-kpis` input schema.
 *
 * `projectId` is optional + nullable to keep the wire contract stable across
 * phases — R4 always returns global aggregates, R6+ may use this field for
 * project-scoped snapshots.
 */
export const dashboardGetKpisSchema = z.object({
  projectId: z.string().min(1).max(128).nullable().optional(),
});

/** Channel-keyed map of v3 schemas for router/handler wiring. */
export const v3ChannelSchemas = {
  'arena-root:set': arenaRootSetSchema,
  'dashboard:get-kpis': dashboardGetKpisSchema,
  'project:create': projectCreateSchema,
  'project:link-external': projectLinkExternalSchema,
  'project:import': projectImportSchema,
  'project:update': projectUpdateSchema,
  'project:set-autonomy': projectSetAutonomySchema,
  'project:request-permission-mode-change':
    projectRequestPermissionModeChangeSchema,
  'channel:create': channelCreateSchema,
  'channel:rename': channelRenameSchema,
  'channel:add-members': channelMembersPatchSchema,
  'channel:remove-members': channelMembersPatchSchema,
  'channel:start-meeting': channelStartMeetingSchema,
  'message:append': messageAppendSchema,
  'message:search': messageSearchSchema,
  'message:list-recent': messageListRecentSchema,
  'meeting:abort': meetingAbortSchema,
  'meeting:list-active': meetingListActiveSchema,
  'member:set-status': memberSetStatusSchema,
  'approval:decide': approvalDecideSchema,
  'queue:add': queueAddSchema,
  'queue:reorder': queueReorderSchema,
  'notification:update-prefs': notificationUpdatePrefsSchema,
  'notification:test': notificationTestSchema,
} as const;

export type V3ChannelWithSchema = keyof typeof v3ChannelSchemas;

export type CriticalChannel = keyof typeof criticalChannelSchemas;

/** Set of critical channel names for fast lookup. */
export const CRITICAL_CHANNELS = new Set<string>(
  Object.keys(criticalChannelSchemas),
);

/**
 * Validate a payload against the critical channel schema.
 *
 * @throws {ZodError} If the payload does not match the schema.
 */
export function validateCriticalPayload(channel: string, data: unknown): void {
  if (!CRITICAL_CHANNELS.has(channel)) return;

  const schema = criticalChannelSchemas[channel as CriticalChannel];
  schema.parse(data);
}
