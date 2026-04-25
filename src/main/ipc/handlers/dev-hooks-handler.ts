/**
 * dev:trip-circuit-breaker IPC handler — R11-Task4 dev hook (E2E only).
 *
 * Purpose
 *   Replaces the autonomy-queue-flow Step C placeholder (R10 Known Concern
 *   #2). The four "trip*" entry points let an E2E spec simulate every
 *   tripwire (`files_per_turn` / `cumulative_cli_ms` / `queue_streak` /
 *   `same_error`) without standing up a real meeting/SSM. The handler
 *   replays the same side-effect chain that {@link wireV3SideEffects}
 *   bolts onto a live SessionStateMachine:
 *
 *     1. Resolve a target project. The renderer hook may pass a `projectId`
 *        explicitly; when omitted we pick the first project that is
 *        currently in `auto_toggle` or `queue` mode (the only states a
 *        real breaker could downgrade from). If no such project exists the
 *        handler throws — matches the production semantic "breaker fires
 *        only inside an autonomous run".
 *     2. Push the counter through the in-memory CircuitBreaker so its
 *        latch state mirrors the simulated trip. Persistence flushes via
 *        the breaker's existing store wiring (R10-Task9), so a follow-up
 *        ApprovalDecisionRouter resume gesture sees a consistent counter.
 *     3. Replicate the production downgrade path:
 *          - capture `previousMode`,
 *          - `projectService.setAutonomy(projectId, 'manual', { reason: 'circuit_breaker' })`,
 *          - `approvalService.create({ kind: 'circuit_breaker', payload: { source, tripwire, detail, previousMode } })`,
 *          - `notificationService.show({ kind: 'error', ... })`.
 *
 * Safety
 *   The handler is registered ONLY when `process.env.ROLESTRA_E2E === '1'`
 *   (see `router.ts`). Production boots never expose the channel and the
 *   preload script gates `__rolestraDevHooks` on the same env var, so a
 *   user-installed build cannot accidentally drive the trip path from
 *   DevTools or a renderer bug.
 *
 * Why not call the breaker's `recordFileChanges(21)` directly?
 *   The breaker emits `'fired'` correctly, but the listener that runs the
 *   downgrade lives inside {@link wireV3SideEffects} — wired per active
 *   SSM. Without an active session the emit is observed by nobody and the
 *   E2E surface (autonomy toggle `data-mode` attribute) never flips. The
 *   handler therefore drives the side-effect chain itself; the breaker
 *   counter mutation is preserved for fidelity (so the post-trip flush
 *   row matches a real run) but is no longer the only signal.
 */

import type { ApprovalKind } from '../../../shared/approval-types';
import type { AutonomyMode, Project } from '../../../shared/project-types';
import type { CircuitBreakerTripwire } from '../../../shared/circuit-breaker-types';
import type { ApprovalService } from '../../approvals/approval-service';
import type { NotificationService } from '../../notifications/notification-service';
import type { ProjectService } from '../../projects/project-service';
import type { CircuitBreaker } from '../../queue/circuit-breaker';
import { resolveBreakerCopy } from '../../notifications/notification-labels';

/**
 * Discriminated input to {@link handleDevTripCircuitBreaker}. The wire
 * shape is split per tripwire so the renderer's preload helpers can keep
 * a 1:1 signature with the four `trip*(…)` methods documented in the R11
 * plan and stay forward-compatible with future tripwire additions.
 */
export type DevTripCircuitBreakerInput =
  | {
      tripwire: 'files_per_turn';
      /** File count delta to push through `recordFileChanges`. ≥ 21 trips
       *  the default 20-file limit. */
      count: number;
      projectId?: string;
    }
  | {
      tripwire: 'cumulative_cli_ms';
      /** CLI elapsed delta in ms. ≥ 30·60·1000 trips the default 30-minute
       *  budget. */
      ms: number;
      projectId?: string;
    }
  | {
      tripwire: 'queue_streak';
      /** Number of consecutive `recordQueueStart()` calls to replay. ≥ 5
       *  trips the default streak limit. */
      count: number;
      projectId?: string;
    }
  | {
      tripwire: 'same_error';
      /** Error category label used by `recordError(category)`. The handler
       *  invokes the breaker N times with the same category so the streak
       *  builds. */
      category: string;
      /** Repeat count. ≥ 3 trips the default same-error limit. */
      count: number;
      projectId?: string;
    };

/** Standard envelope so the renderer can tell a no-op trip apart from a fire. */
export interface DevTripCircuitBreakerResponse {
  /** True when the side-effect chain ran end-to-end. */
  ok: boolean;
  /** Resolved project id the trip applied to. `null` when `ok=false`. */
  projectId: string | null;
  /** The tripwire dispatched (echoed for the renderer's logs). */
  tripwire: CircuitBreakerTripwire;
}

/** Internal accessor wiring — shape mirrors the other ipc/handlers/* modules. */
let projectAccessor: (() => ProjectService) | null = null;
let approvalAccessor: (() => ApprovalService) | null = null;
let notificationAccessor: (() => NotificationService) | null = null;
let breakerAccessor: (() => CircuitBreaker) | null = null;

export function setDevHooksAccessors(deps: {
  projectService: () => ProjectService;
  approvalService: () => ApprovalService;
  notificationService: () => NotificationService;
  circuitBreaker: () => CircuitBreaker;
}): void {
  projectAccessor = deps.projectService;
  approvalAccessor = deps.approvalService;
  notificationAccessor = deps.notificationService;
  breakerAccessor = deps.circuitBreaker;
}

/** Test seam — clears every accessor. Mirrors the other handlers' pattern. */
export function clearDevHooksAccessors(): void {
  projectAccessor = null;
  approvalAccessor = null;
  notificationAccessor = null;
  breakerAccessor = null;
}

function services(): {
  projectService: ProjectService;
  approvalService: ApprovalService;
  notificationService: NotificationService;
  circuitBreaker: CircuitBreaker;
} {
  if (
    !projectAccessor ||
    !approvalAccessor ||
    !notificationAccessor ||
    !breakerAccessor
  ) {
    throw new Error('dev hooks: services not initialized');
  }
  return {
    projectService: projectAccessor(),
    approvalService: approvalAccessor(),
    notificationService: notificationAccessor(),
    circuitBreaker: breakerAccessor(),
  };
}

/**
 * Resolve the target project. Prefer the explicit `projectId`; fall back
 * to the first non-archived project in `auto_toggle` or `queue` mode.
 * Throws when no candidate exists — matches production semantic that the
 * breaker fires only inside an autonomous run.
 */
function resolveTargetProject(
  service: ProjectService,
  explicit: string | undefined,
): Project {
  if (explicit) {
    const project = service.get(explicit);
    if (!project) {
      throw new Error(`dev hooks: project not found: ${explicit}`);
    }
    return project;
  }
  const first = service
    .list()
    .find((p) => p.autonomyMode !== 'manual');
  if (!first) {
    throw new Error(
      'dev hooks: no project in auto_toggle/queue mode — set autonomy first',
    );
  }
  return first;
}

/**
 * Apply the post-trip side-effects (autonomy downgrade + audit approval +
 * OS notification). Mirrors `handleBreakerFired` in v3-side-effects.ts so
 * the E2E observable is identical to a real circuit breaker fire.
 */
function applyDowngradeSideEffects(
  tripwire: CircuitBreakerTripwire,
  detail: unknown,
  project: Project,
  deps: {
    projectService: ProjectService;
    approvalService: ApprovalService;
    notificationService: NotificationService;
  },
): void {
  const previousMode: AutonomyMode = project.autonomyMode;

  // (a) Downgrade — primary safety action; also fires
  //     `stream:autonomy-mode-changed` with reason='circuit_breaker' which
  //     flips the renderer toggle's `data-mode` attribute (the E2E
  //     observable).
  deps.projectService.setAutonomy(project.id, 'manual', {
    reason: 'circuit_breaker',
  });

  // (b) Approval row (audit receipt). Kind = 'circuit_breaker'; the
  //     payload mirrors the v3-side-effects helper so
  //     ApprovalDecisionRouter's resume path can restore previousMode.
  const approvalKind: ApprovalKind = 'circuit_breaker';
  deps.approvalService.create({
    kind: approvalKind,
    projectId: project.id,
    channelId: null,
    meetingId: null,
    requesterId: null,
    payload: {
      source: 'circuit_breaker',
      tripwire,
      detail,
      previousMode,
    },
  });

  // (c) OS notification. Force=true bypasses the focus gate so the E2E
  //     window (which has focus during the test) still produces a log row
  //     visible to the spec via the notification accessor.
  const detailObj =
    detail !== null && typeof detail === 'object'
      ? (detail as Record<string, unknown>)
      : null;
  const { title, body } = resolveBreakerCopy(tripwire, detailObj);
  deps.notificationService.show({
    kind: 'error',
    title,
    body,
    force: true,
  });
}

/** Push the simulated counter into the breaker so its latch + persisted
 *  state stay coherent with a real fire. Each branch is one direct call
 *  on the public breaker surface; no side-channel writes. */
function recordOnBreaker(
  breaker: CircuitBreaker,
  input: DevTripCircuitBreakerInput,
): unknown {
  switch (input.tripwire) {
    case 'files_per_turn':
      breaker.recordFileChanges(input.count);
      return { count: input.count };
    case 'cumulative_cli_ms':
      breaker.recordCliElapsed(input.ms);
      return { ms: input.ms };
    case 'queue_streak': {
      // Replay N consecutive starts so the streak counter advances to
      // exactly the requested value.
      const count = Math.max(1, Math.floor(input.count));
      for (let i = 0; i < count; i += 1) {
        breaker.recordQueueStart();
      }
      return { count };
    }
    case 'same_error': {
      const count = Math.max(1, Math.floor(input.count));
      for (let i = 0; i < count; i += 1) {
        breaker.recordError(input.category);
      }
      return { category: input.category, count };
    }
  }
}

/**
 * IPC handler entry for `dev:trip-circuit-breaker`. Registered only when
 * `ROLESTRA_E2E === '1'`. Returns a structured response so the renderer
 * (or an E2E spec calling through the preload bridge) can verify the
 * trip applied without parsing logs.
 */
export function handleDevTripCircuitBreaker(
  input: DevTripCircuitBreakerInput,
): DevTripCircuitBreakerResponse {
  const deps = services();
  const project = resolveTargetProject(deps.projectService, input.projectId);
  const detail = recordOnBreaker(deps.circuitBreaker, input);
  applyDowngradeSideEffects(input.tripwire, detail, project, deps);
  return { ok: true, projectId: project.id, tripwire: input.tripwire };
}
