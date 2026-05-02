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
import { ALL_ROLE_IDS } from './role-types';

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

  // R11-Task2 retired the v2 `permission:approve` / `:reject` /
  // `consensus:respond` / `:set-facilitator` / `workspace:init` schemas
  // along with the IPC channels they validated.

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

  // ── R12-S 능력 부여 (페르소나/스킬 분리) ─────────────────────────
  'skill:getTemplate': z.object({
    id: z.union([
      z.enum(ALL_ROLE_IDS as unknown as [string, ...string[]]),
      z.literal('meeting-summary'),
    ]),
  }),

  'provider:updateRoles': z.object({
    providerId: z.string().min(1).max(128),
    roles: z.array(
      z.enum(ALL_ROLE_IDS as unknown as [string, ...string[]]),
    ),
    skill_overrides: z
      .record(
        z.enum(ALL_ROLE_IDS as unknown as [string, ...string[]]),
        z.string().max(8192),
      )
      .nullable(),
  }),

  'settings:setSummaryModel': z.object({
    providerId: z.string().min(1).max(128).nullable(),
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

/** R12-C — project:syncSkills request schema. */
export const projectSyncSkillsSchema = z.object({
  id: z.string().min(1).max(128),
  force: z.boolean().optional(),
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
  // R12-C round 3 — name 빈 문자열 허용. service 는 부서 채널 (role !==
  // null) 의 빈 입력을 부서 카탈로그 라벨로 자동 복원해 UNIQUE
  // (project_id, name) 충돌을 막는다 (#1-4 dogfooding).
  name: z.string().max(200),
});

export const channelMembersPatchSchema = z.object({
  id: z.string().min(1).max(128),
  providerIds: z.array(z.string().min(1).max(128)).min(1).max(64),
});

export const channelStartMeetingSchema = z.object({
  channelId: z.string().min(1).max(128),
  topic: z.string().min(1).max(500),
});

/** R12-C T9 — 일반 채널 "새 대화 시작" archive + clear. */
export const channelArchiveConversationSchema = z.object({
  channelId: z.string().min(1).max(128),
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
 * D-A T2: 4 신규 회의 lifecycle IPC 채널의 입력 스키마.
 *
 * - `meeting:request-stop` / `meeting:pause` / `meeting:resume` —
 *   meetingId 만 받음. 1..128 char 동일 컨벤션.
 * - `meeting:edit-topic` — meetingId + topic. topic 은 1..200 char
 *   (spec §9 ChannelHeader inline 편집 maxLength 와 일치).
 */
export const meetingRequestStopSchema = z.object({
  meetingId: z.string().min(1).max(128),
});

export const meetingEditTopicSchema = z.object({
  meetingId: z.string().min(1).max(128),
  topic: z.string().min(1).max(200),
});

export const meetingPauseSchema = z.object({
  meetingId: z.string().min(1).max(128),
});

export const meetingResumeSchema = z.object({
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

/**
 * `member:upload-avatar` input schema (R8-Task1, spec §7.1).
 *
 * `sourcePath` is the absolute path of a file the user picked through
 * `dialog.showOpenDialog`. We bound it at 4096 chars (POSIX `PATH_MAX`
 * baseline; Windows long-paths up to 32 K live behind opt-in flags we
 * don't enable). The schema deliberately does NOT validate the file's
 * existence, extension, or size — those checks live in the AvatarStore
 * (R8-Task5) where they can produce typed `AvatarValidationError`s with
 * actionable messages. Doing them here would (i) split error reporting
 * across two layers and (ii) force the schema to do filesystem I/O.
 *
 * `providerId` reuses the same 1..128 char convention as every other
 * member:* channel for consistency with `member:set-status`.
 */
export const memberUploadAvatarSchema = z.object({
  providerId: z.string().min(1).max(128),
  sourcePath: z.string().min(1).max(4096),
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

/**
 * F6-T1: `approval:count` request. The handler accepts an optional
 * project scope for the inbox tab badges; omit for cross-project counts.
 * The undefined-payload form (no scope) is accepted via `.optional()`.
 */
export const approvalCountSchema = z
  .object({
    projectId: z.string().min(1).max(128).optional(),
  })
  .optional();

export const queueAddSchema = z.object({
  projectId: z.string().min(1).max(128),
  prompt: z.string().min(1).max(20_000),
  targetChannelId: z.string().min(1).max(128).nullable().optional(),
});

export const queueReorderSchema = z.object({
  projectId: z.string().min(1).max(128),
  orderedIds: z.array(z.string().min(1).max(128)).min(1).max(500),
});

export const queueListSchema = z.object({
  projectId: z.string().min(1).max(128),
});

export const queueItemIdSchema = z.object({
  id: z.string().min(1).max(128),
});

export const queuePauseResumeSchema = z.object({
  projectId: z.string().min(1).max(128),
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

export const notificationGetPrefsSchema = z.undefined();

/** R10-Task12: `notification:set-locale` payload validation. */
export const notificationSetLocaleSchema = z.object({
  locale: z.enum(['ko', 'en']),
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

// ── R10 신규 zod schemas ──────────────────────────────────────────

/**
 * R10-Task3: `dm:create` — providerId 를 받아 1:1 DM 채널을 연다.
 * UNIQUE 위반(이미 DM 이 있는 provider) 은 service 계층에서 throw.
 */
export const dmCreateSchema = z.object({
  providerId: z.string().min(1).max(128),
});

/** R10-Task3: `dm:list` 는 입력이 없다. */
export const dmListSchema = z.undefined();

/** R10-Task5: `permission:dry-run-flags` 빌더 dry-run 호출 스키마. */
export const providerTypeSchema = z.enum([
  'claude_api',
  'claude_cli',
  'codex_api',
  'codex_cli',
  'gemini_api',
  'gemini_cli',
  'openai_api',
  'mock',
]);

export const permissionDryRunFlagsSchema = z
  .object({
    providerType: providerTypeSchema,
    permissionMode: permissionModeSchema,
    projectKind: projectKindSchema,
    dangerousAutonomyOptIn: z.boolean(),
  })
  .refine(
    (v) => !(v.projectKind === 'external' && v.permissionMode === 'auto'),
    {
      message: 'external + auto is forbidden per spec §7.3',
      path: ['permissionMode'],
    },
  );

/**
 * R10-Task11: `meeting:llm-summarize` — providerId 를 생략하면
 * service 가 summarize capability true 인 첫 provider 로 fallback chain
 * (Decision D7).
 */
export const meetingLlmSummarizeSchema = z.object({
  meetingId: z.string().min(1).max(128),
  providerId: z.string().min(1).max(128).optional(),
});

// ── R11-Task5 신규 zod schemas ─────────────────────────────────────

/**
 * R11-Task5/6: `onboarding:get-state` / `onboarding:complete` 둘 다
 * 입력이 없는 unit 채널.
 */
export const onboardingGetStateSchema = z.undefined();
export const onboardingCompleteSchema = z.undefined();

const onboardingStepSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
]);

const onboardingSelectionsSchema = z.object({
  staff: z.array(z.string().min(1).max(128)).max(64).optional(),
  // Step3RoleAssignment 는 사용자가 입력 도중 글자를 모두 지운 상태를 빈 문자열
  // entry 로 표현한다 (Step3 gate 가 trim().length>0 으로 별도 차단). zod 가
  // 빈 문자열을 거부하면 IPC 가 reject 되고 controlled input 이 직전 값으로
  // 되돌아가 backspace 가 먹히지 않는 것처럼 보이므로 value min 은 두지 않는다.
  roles: z.record(z.string().min(1).max(128), z.string().max(200)).optional(),
  // R12-C round 2 — 직원 능력 배정 매트릭스. providerId → RoleId[].
  // wizard step 3 의 9 능력 multi-checkbox 가 부분 patch 마다 흐른다.
  skillAssignments: z
    .record(
      z.string().min(1).max(128),
      z.array(z.enum(ALL_ROLE_IDS as unknown as [string, ...string[]])).max(9),
    )
    .optional(),
  permissions: permissionModeSchema.optional(),
  firstProject: z
    .object({
      // Step5 입력 도중 사용자가 slug 를 모두 지운 상태도 정상 patch 로 흘러야
      // 한다. min(1) 을 두면 IPC 가 reject 되어 controlled input 의 value 가
      // 직전 값으로 강제 복원되며 한글 IME composition 이 깨진다. canProceed
      // gate (Step 5) 가 slug.trim().length>0 으로 별도 차단한다.
      slug: z.string().max(200),
      kind: projectKindSchema,
    })
    .optional(),
});

const onboardingStatePartialSchema = z
  .object({
    completed: z.boolean().optional(),
    currentStep: onboardingStepSchema.optional(),
    selections: onboardingSelectionsSchema.optional(),
    updatedAt: z.number().int().nonnegative().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'partial must contain at least one field',
  });

/**
 * R11-Task5/6: `onboarding:set-state` — 부분 patch. service 가 partial 을
 * 받아 row 의 누락 필드를 보존하며 갱신한다. completed 필드는 받아도 무시
 * (별도 onboarding:complete 채널만 완료 처리).
 */
export const onboardingSetStateSchema = z.object({
  partial: onboardingStatePartialSchema,
});

/** R11-Task5/6: `provider:detect` — input 없음. */
export const providerDetectSchema = z.undefined();

/**
 * F1 (mock/fallback cleanup): `onboarding:apply-staff-selection` — wizard
 * 가 collected staff provider id 를 main 으로 넘겨 자동 register 시도. id 길이
 * / 배열 크기 제한은 `provider:add` 와 동일 (id 128, 배열 64).
 */
export const onboardingApplyStaffSelectionSchema = z.object({
  providerIds: z.array(z.string().min(1).max(128)).max(64),
});

/**
 * R11-Task5/8: `llm:cost-summary` — periodDays 미지정 시 service default
 * (R11 default = 30일). 365일 초과는 거부 (Settings UI 에 1년 이상 표시 X).
 */
export const llmCostSummarySchema = z
  .object({
    periodDays: z.number().int().positive().max(365).optional(),
  })
  .optional();

/**
 * R11-Task5/7: `execution:dry-run-preview` — approvalId 1건 조회. 실제
 * apply 는 하지 않으므로 zod 가 검증하는 부분은 단일 ID 형식뿐.
 */
export const executionDryRunPreviewSchema = z.object({
  approvalId: z.string().min(1).max(128),
});

/**
 * R11-Task5/7: `approval:detail-fetch` — approvalId 1건 조회. 응답이 큰
 * 합집합 타입이라 입력은 단일 ID 만.
 */
export const approvalDetailFetchSchema = z.object({
  approvalId: z.string().min(1).max(128),
});

/**
 * R11-Task5/7: `meeting:voting-history` — meetingId 1건 조회.
 */
export const meetingVotingHistorySchema = z.object({
  meetingId: z.string().min(1).max(128),
});

/**
 * R11-Task4: `dev:trip-circuit-breaker` — discriminated by `tripwire`.
 * Dev-only channel (gated by ROLESTRA_E2E=1 in router.ts), but the
 * schema is still validated in dev mode so a malformed E2E payload fails
 * loudly instead of silently no-op'ing inside the handler.
 */
export const devTripCircuitBreakerSchema = z.discriminatedUnion('tripwire', [
  z.object({
    tripwire: z.literal('files_per_turn'),
    count: z.number().int().min(0).max(10_000),
    projectId: z.string().min(1).max(128).optional(),
  }),
  z.object({
    tripwire: z.literal('cumulative_cli_ms'),
    ms: z.number().int().min(0).max(24 * 60 * 60 * 1000),
    projectId: z.string().min(1).max(128).optional(),
  }),
  z.object({
    tripwire: z.literal('queue_streak'),
    count: z.number().int().min(1).max(1000),
    projectId: z.string().min(1).max(128).optional(),
  }),
  z.object({
    tripwire: z.literal('same_error'),
    category: z.string().min(1).max(256),
    count: z.number().int().min(1).max(1000),
    projectId: z.string().min(1).max(128).optional(),
  }),
]);

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
  'project:syncSkills': projectSyncSkillsSchema,
  'channel:create': channelCreateSchema,
  'channel:rename': channelRenameSchema,
  'channel:add-members': channelMembersPatchSchema,
  'channel:remove-members': channelMembersPatchSchema,
  'channel:start-meeting': channelStartMeetingSchema,
  'channel:archive-conversation': channelArchiveConversationSchema,
  'message:append': messageAppendSchema,
  'message:search': messageSearchSchema,
  'message:list-recent': messageListRecentSchema,
  'meeting:abort': meetingAbortSchema,
  'meeting:request-stop': meetingRequestStopSchema,
  'meeting:edit-topic': meetingEditTopicSchema,
  'meeting:pause': meetingPauseSchema,
  'meeting:resume': meetingResumeSchema,
  'meeting:list-active': meetingListActiveSchema,
  'member:set-status': memberSetStatusSchema,
  'member:upload-avatar': memberUploadAvatarSchema,
  'approval:decide': approvalDecideSchema,
  'approval:count': approvalCountSchema,
  'queue:add': queueAddSchema,
  'queue:reorder': queueReorderSchema,
  'queue:list': queueListSchema,
  'queue:remove': queueItemIdSchema,
  'queue:cancel': queueItemIdSchema,
  'queue:pause': queuePauseResumeSchema,
  'queue:resume': queuePauseResumeSchema,
  'notification:get-prefs': notificationGetPrefsSchema,
  'notification:update-prefs': notificationUpdatePrefsSchema,
  'notification:test': notificationTestSchema,
  'notification:set-locale': notificationSetLocaleSchema,
  // ── R10 신규 채널 ──────────────────────────────────────────────
  'dm:list': dmListSchema,
  'dm:create': dmCreateSchema,
  'permission:dry-run-flags': permissionDryRunFlagsSchema,
  'meeting:llm-summarize': meetingLlmSummarizeSchema,
  // R11-Task4: dev hook (ROLESTRA_E2E=1 only — registration in router.ts
  // is gated, but the schema entry is unconditional so the dev-mode zod
  // round-trip catches malformed payloads when the handler IS registered).
  'dev:trip-circuit-breaker': devTripCircuitBreakerSchema,
  // ── R11-Task5 신규 채널 ──────────────────────────────────────────
  'onboarding:get-state': onboardingGetStateSchema,
  'onboarding:set-state': onboardingSetStateSchema,
  'onboarding:complete': onboardingCompleteSchema,
  'onboarding:apply-staff-selection': onboardingApplyStaffSelectionSchema,
  'provider:detect': providerDetectSchema,
  'llm:cost-summary': llmCostSummarySchema,
  'execution:dry-run-preview': executionDryRunPreviewSchema,
  'approval:detail-fetch': approvalDetailFetchSchema,
  'meeting:voting-history': meetingVotingHistorySchema,
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
