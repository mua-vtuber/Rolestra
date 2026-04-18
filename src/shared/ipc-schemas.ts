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
