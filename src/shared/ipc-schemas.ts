/**
 * Zod validation schemas for critical IPC channels.
 *
 * These schemas are applied in BOTH development and production modes
 * to ensure type safety for security-sensitive operations.
 *
 * The active chat router also validates its non-critical channel schemas
 * in production before dispatch.
 *
 * D1 (2026-09-28): this file used to also carry zod schemas for every
 * pivot-era work-automation channel (project/handoff/meeting-review/
 * design-checkpoint/meeting(SSM)/approval/queue/dashboard/onboarding/
 * execution/opinion-gather-tally-quickVote-freeDiscussion/run-steps —
 * 75 exports total). None of those channels are registered in
 * `LIVE_IPC_CHANNELS` (src/shared/ipc-types.ts) or wired in
 * src/main/ipc/router.ts, and grepping the whole repo found zero
 * importers of any of those schema exports outside this file (a few
 * were only *mentioned in comments* elsewhere, which is not a real
 * consumer). They were removed along with their shared helper schemas
 * (step1/step25/step3 opinion payload schemas, the opinion response
 * envelope builder, the onboarding step/selection/state schemas, etc.).
 * Only schemas actually referenced by `v3ChannelSchemas` below (the
 * router/handler wiring surface) or by `criticalChannelSchemas` survive.
 */

import { z } from 'zod';
import type { IpcChannel } from './ipc-types';
import { dmChannelSchemas } from './ipc/domains/dm-schemas';
import { PROVIDER_DISPLAY_NAME_MAX_LENGTH } from './provider-types';
import { MEMBER_CHARACTER_SHEET_MAX_LENGTH } from './member-profile-types';

export {
  dmChannelSchemas,
  dmCreateSchema,
  dmListSchema,
} from './ipc/domains/dm-schemas';

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
  // CLI or API only: a local AI is added through provider:add-local, where
  // main finds the Ollama address and sets the Ollama confirmation itself.
  'provider:add': z.object({
    displayName: z.string().trim().min(1).max(PROVIDER_DISPLAY_NAME_MAX_LENGTH),
    config: z.discriminatedUnion('type', [
      z.object({
        type: z.literal('api'),
        endpoint: z.url().max(2048),
        apiKeyRef: z.string().regex(safeKeyPattern),
        model: z.string().min(1).max(256),
      }),
      z.object({
        type: z.literal('cli'),
        command: z.string().min(1).max(2048),
        args: z.array(z.string().max(4096)).max(64),
        inputFormat: z.enum(['stdin-json', 'args', 'pipe']),
        outputFormat: z.enum(['stream-json', 'jsonl', 'raw-stdout']),
        sessionStrategy: z.enum(['persistent', 'per-turn']),
        hangTimeout: z.object({
          first: z.number().int().positive(),
          subsequent: z.number().int().positive(),
        }),
        model: z.string().min(1).max(256),
        wslDistro: z.string().min(1).max(128).optional(),
      }),
    ]),
  }),
  // 2026-10-01 R6-3: the renderer sends a name and an installed model only;
  // main resolves the Ollama address itself, so an address field is refused.
  'provider:add-local': z.strictObject({
    displayName: z.string().trim().min(1).max(PROVIDER_DISPLAY_NAME_MAX_LENGTH),
    model: z.string().min(1).max(256),
  }),
  'provider:remove': z.object({
    id: z.string().min(1).max(128),
  }),
  // R5-5: only the ref of a key already stored via config:set-secret.
  'provider:replace-api-key': z.object({
    id: z.string().min(1).max(128),
    apiKeyRef: z.string().regex(safeKeyPattern, 'Invalid secret key format'),
  }),
  // R5-3: main opens the folder it resolved itself — no payload accepted.
  'arena-root:open-folder': z.undefined(),
} as const;

// ──────────────────────────────────────────────────────────────────
// v3 (Rolestra) chat-app domain schemas — per-channel schemas actually
// referenced by v3ChannelSchemas below. External consumers (router/
// handlers/tests) may import these directly or via v3ChannelSchemas
// for channel-keyed lookup.
// ──────────────────────────────────────────────────────────────────

export const channelArchiveConversationSchema = z.object({
  channelId: z.string().min(1).max(128),
});

export const messageAppendSchema = z.strictObject({
  channelId: z.string().min(1).max(128),
  content: z.string().min(1).max(100_000),
  mentions: z.array(z.string().min(1).max(128)).max(64).optional(),
});

export const messageSearchSchema = z.object({
  query: z.string().min(1).max(1000),
  scope: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('channel'), channelId: z.string().min(1).max(128) }),
    z.strictObject({ kind: z.literal('chats') }),
  ]),
  limit: z.number().int().positive().max(500).optional(),
});

export const memberUploadAvatarSchema = z.object({
  providerId: z.string().min(1).max(128),
  sourcePath: z.string().min(1).max(4096),
});

const notificationPrefValueSchema = z
  .object({
    enabled: z.boolean().optional(),
    soundEnabled: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'pref patch must not be empty' });

export const notificationUpdatePrefsSchema = z.object({
  patch: z
    .strictObject({
      new_message: notificationPrefValueSchema.optional(),
      error: notificationPrefValueSchema.optional(),
    })
    .refine((p) => Object.keys(p).length > 0, {
      message: 'patch must update at least one notification kind',
    }),
});

export const notificationTestSchema = z.object({
  kind: z.enum(['new_message', 'error']),
});

export const notificationGetPrefsSchema = z.undefined();

/** R10-Task12: `notification:set-locale` payload validation. */
export const notificationSetLocaleSchema = z.object({
  locale: z.enum(['ko', 'en']),
});

export const opinionPostFromGeneralSchema = z.object({
  channelId: z.string().min(1).max(128),
  authorProviderId: z.string().min(1).max(128).nullable(),
  parts: z
    .array(
      z.object({
        title: z.string().min(1).max(400).nullable(),
        content: z.string().min(1).max(100_000),
      }),
    )
    .min(1)
    .max(32),
});

/**
 * opinion:listGeneralCards 입력 schema (R12-C2 P4 T21).
 *
 * 일반 채널의 카드 list + light vote 카운터 read. channelId 만 받고
 * service 가 해당 채널의 self-raised / user-raised opinion 통째 조회.
 */
export const opinionListGeneralCardsSchema = z.object({
  channelId: z.string().min(1).max(128),
});

/**
 * opinion:toggleLightVote 입력 schema (R12-C2 P4 T21).
 *
 * 사용자 1 인 voter (voter_provider_id NULL) 의 light vote 토글. UI 미노출
 * 인 'abstain' 은 schema 측에서 차단 — 'agree' / 'oppose' 만 허용. 같은
 * vote 재요청 시 service 가 DELETE (취소), 반대 vote 시 REPLACE 처리.
 */
export const opinionToggleLightVoteSchema = z.object({
  opinionId: z.string().min(1).max(128),
  vote: z.enum(['agree', 'oppose']),
});

/** Channel-keyed map of v3 schemas for router/handler wiring. */
export const v3ChannelSchemas = {
  'app:ping': z.undefined(),
  'app:get-info': z.undefined(),
  'arena-root:get': z.undefined(),
  'arena-root:open-folder': criticalChannelSchemas['arena-root:open-folder'],
  'provider:list': z.undefined(),
  'provider:add': criticalChannelSchemas['provider:add'],
  'provider:remove': criticalChannelSchemas['provider:remove'],
  'provider:replace-api-key': criticalChannelSchemas['provider:replace-api-key'],
  'provider:validate': z.object({ id: z.string().min(1).max(128) }),
  'provider:detect-cli': z.undefined(),
  'provider:detect-local': z.undefined(),
  'provider:add-local': criticalChannelSchemas['provider:add-local'],
  'provider:list-inactive-cli': z.undefined(),
  'provider:list-models': z.object({
    type: z.enum(['api', 'cli']),
    key: z.string().min(1).max(256),
    apiKeyRef: z.string().regex(safeKeyPattern).optional(),
  }),
  'config:update-settings': z.object({
    // Language only: the Ollama address is not renderer-writable (QA Minor 1).
    patch: z.strictObject({
      language: z.enum(['ko', 'en']).optional(),
    }).refine((patch) => Object.keys(patch).length > 0),
  }),
  'config:set-secret': criticalChannelSchemas['config:set-secret'],
  'config:delete-secret': criticalChannelSchemas['config:delete-secret'],
  'config:take-startup-diagnostics': z.undefined(),
  'channel:list': z.object({ projectId: z.null() }),
  'channel:get-global-general': z.undefined(),
  'channel:delete': z.object({ id: z.string().min(1).max(128) }),
  'channel:archive-conversation': channelArchiveConversationSchema,
  'channel:list-members': z.object({ channelId: z.string().min(1).max(128) }),
  'channel:list-summaries': z.undefined(),
  'channel:mark-read': z.object({
    channelId: z.string().min(1).max(128),
    messageId: z.string().min(1).max(128),
  }),
  'room:create': z.object({
    name: z.string().trim().min(1).max(200),
    participants: z.array(z.object({
      providerId: z.string().min(1).max(128),
      personaSource: z.enum(['default', 'custom']),
      customPersona: z.string().trim().min(1).max(10000).optional(),
    })).min(1).max(64).refine(
      (items) => new Set(items.map((item) => item.providerId)).size === items.length,
      { message: 'room participants must be unique' },
    ),
  }),
  'room:list': z.undefined(),
  'room:archive': z.object({ channelId: z.string().min(1).max(128) }),
  'room:delete': z.object({ channelId: z.string().min(1).max(128) }),
  'room:get-members': z.object({ channelId: z.string().min(1).max(128) }),
  ...dmChannelSchemas,
  'message:append': messageAppendSchema,
  'message:list-by-channel': z.object({
    channelId: z.string().min(1).max(128),
    limit: z.number().int().positive().max(200).optional(),
    beforeCreatedAt: z.number().nonnegative().optional(),
    beforeMessageId: z.string().min(1).max(128).optional(),
  }).refine((data) => data.beforeCreatedAt === undefined || data.beforeMessageId === undefined,
    { message: 'Choose one message cursor' }),
  'message:search': messageSearchSchema,
  'chat:pass-turn': z.object({ channelId: z.string().min(1).max(128) }),
  'chat:list-active-rounds': z.undefined(),
  'opinion:postFromGeneral': opinionPostFromGeneralSchema,
  'opinion:listGeneralCards': opinionListGeneralCardsSchema,
  'opinion:toggleLightVote': opinionToggleLightVoteSchema,
  'opinion:startVote': z.object({ opinionId: z.string().min(1).max(128) }),
  'opinion:getVote': z.object({ opinionId: z.string().min(1).max(128) }),
  'opinion:sendVoteResult': z.strictObject({ opinionId: z.string().min(1).max(128) }),
  'member:list': z.undefined(),
  'member:get-profile': z.object({ providerId: z.string().min(1).max(128) }),
  'member:update-profile': z.object({
    providerId: z.string().min(1).max(128),
    patch: z.strictObject({
      characterSheet: z.string().max(MEMBER_CHARACTER_SHEET_MAX_LENGTH).optional(),
      avatarKind: z.enum(['default', 'custom']).optional(),
      avatarData: z.string().max(2_000_000).nullable().optional(),
    }).refine((patch) => Object.keys(patch).length > 0),
  }),
  'member:rename': z.object({
    providerId: z.string().min(1).max(128),
    displayName: z.string().trim().min(1).max(PROVIDER_DISPLAY_NAME_MAX_LENGTH),
  }),
  'member:reconnect': z.object({ providerId: z.string().min(1).max(128) }),
  'member:list-avatars': z.undefined(),
  'member:pick-avatar-file': z.undefined(),
  'member:upload-avatar': memberUploadAvatarSchema,
  'notification:get-prefs': notificationGetPrefsSchema,
  'notification:update-prefs': notificationUpdatePrefsSchema,
  'notification:test': notificationTestSchema,
  'notification:set-locale': notificationSetLocaleSchema,
} as const satisfies Record<IpcChannel, z.ZodType>;

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
