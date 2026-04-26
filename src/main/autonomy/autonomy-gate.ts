/**
 * AutonomyGate — R9-Task5 spec §8 autonomy policy engine.
 *
 * Subscribes to `ApprovalService.on('created')` and decides whether the
 * new row should be left for the user (autonomyMode='manual'), auto-
 * accepted (auto_toggle/queue + an "accepted" kind), or used as the
 * trigger for a forced downgrade back to manual (auto_toggle/queue + a
 * rework/fail/cli_permission kind).
 *
 * Branching per spec §8 ("autonomyMode 별 동작" table):
 *   - `manual`:        no-op — leave the approval for the user.
 *   - `auto_toggle` /
 *     `queue`:         evaluate the item:
 *                        - mode_transition(targetMode=auto|hybrid)
 *                          → ApprovalService.decide(id, 'approve')
 *                            + `#회의록` audit trace
 *                            + NotificationService.show('work_done')
 *                        - consensus_decision (SSM DONE = AI consensus
 *                          reached; payload has no explicit outcome but
 *                          we defensively treat an `outcome in
 *                          {rejected, rework, fail, aborted}` field as
 *                          a downgrade signal)
 *                          → same auto-accept path
 *                        - review_outcome(outcome=accepted)
 *                          → same auto-accept path
 *                        - everything else (cli_permission,
 *                          review_outcome with rework/fail,
 *                          failure_report, malformed payload)
 *                          → ProjectService.setAutonomy('manual',
 *                              {reason:'autonomy_gate_fail'})
 *                            + `#회의록` downgrade trace
 *                            + NotificationService.show('error')
 *
 * Event isolation: every outbound side-effect is wrapped in a try/catch
 * so a downstream failure (missing `#회의록` channel, NotificationService
 * adapter error, …) cannot rewrite the ApprovalService `'created'`
 * contract or crash the listener chain. Pattern mirrors
 * ApprovalNotificationBridge (R7-Task11).
 *
 * i18n note (spec §R9 D8): the `#회의록` trace lines here are written in
 * Korean fixed strings. Task 11 will replace them with main-process
 * i18n dictionary lookups; until then the strings are stable so the
 * audit trail stays legible.
 */

import type { ApprovalItem } from '../../shared/approval-types';
import type { AutonomyMode } from '../../shared/project-types';
import { APPROVAL_CREATED_EVENT } from '../approvals/approval-service';
import { resolveNotificationLabel } from '../notifications/notification-labels';

/**
 * Narrow structural view the gate needs from each service. Tests pass
 * plain vi.fn() mocks with these shapes (no repository stack needed).
 */
export interface AutonomyGateApprovalSource {
  on(
    event: typeof APPROVAL_CREATED_EVENT,
    listener: (item: ApprovalItem) => void,
  ): this;
  off(
    event: typeof APPROVAL_CREATED_EVENT,
    listener: (item: ApprovalItem) => void,
  ): this;
  decide(id: string, decision: 'approve' | 'reject' | 'conditional', comment?: string): unknown;
}

export interface AutonomyGateProjectSource {
  get(id: string): { id: string; autonomyMode: AutonomyMode } | null;
  setAutonomy(
    id: string,
    mode: AutonomyMode,
    opts?: { reason?: 'user' | 'circuit_breaker' | 'autonomy_gate_fail' },
  ): unknown;
}

export interface AutonomyGateNotificationSink {
  show(input: {
    kind: 'work_done' | 'error';
    title: string;
    body: string;
    channelId?: string | null;
  }): unknown;
}

export interface AutonomyGateMessageSink {
  append(input: {
    channelId: string;
    meetingId?: string | null;
    authorId: string;
    authorKind: 'system';
    role: 'system';
    content: string;
    meta?: null;
  }): unknown;
}

export interface AutonomyGateChannelSource {
  listByProject(projectId: string): Array<{ id: string; kind: string }>;
}

export interface AutonomyGateDeps {
  approvalService: AutonomyGateApprovalSource;
  projectService: AutonomyGateProjectSource;
  notificationService: AutonomyGateNotificationSink;
  messageService: AutonomyGateMessageSink;
  channelService: AutonomyGateChannelSource;
}

/** Comment passed to ApprovalService.decide on the auto-accept path. */
export const AUTONOMY_GATE_AUTO_COMMENT = '[autonomy:auto]' as const;

/**
 * Outcome fields that would signal "NOT accepted" on kinds whose payload
 * may carry an outcome. `rejected` / `aborted` appear on the `meetings`
 * table enum (spec §5.2); `rework` / `fail` appear on review_outcome
 * payloads (§R8+). We duck-type against all four so a future payload
 * change does not silently flip the gate decision.
 */
const NOT_ACCEPTED_OUTCOMES: ReadonlySet<string> = new Set([
  'rejected',
  'rework',
  'fail',
  'aborted',
]);

/**
 * Approval-kind labels routed through the dictionary.
 *
 * `evaluateDecision` returns one of these (plus `unknown` for forward
 * compatibility). The runtime then resolves the locale-aware copy via
 * `notification-labels` so a user toggling Settings → 언어 reaches every
 * trace + OS notification body.
 */
type GateLabelKind =
  | 'mode_transition'
  | 'consensus_decision'
  | 'review_outcome'
  | 'cli_permission'
  | 'failure_report'
  | 'unknown';

/** Result of the policy evaluation — either accept with a label or downgrade. */
type GateDecision =
  | { kind: 'accept'; label: GateLabelKind; rawKind: string }
  | { kind: 'downgrade'; label: GateLabelKind; rawKind: string };

function resolveLabel(label: GateLabelKind, rawKind: string): string {
  if (label === 'unknown') return rawKind;
  return resolveNotificationLabel(`autonomyGate.label.${label}`);
}

export class AutonomyGate {
  private readonly listener: (item: ApprovalItem) => void;
  private wired = false;

  constructor(private readonly deps: AutonomyGateDeps) {
    this.listener = (item) => this.handleCreated(item);
  }

  /**
   * Subscribe to `approvalService.on('created')`. Returns a disposer so
   * the caller (boot code, tests) can unwire symmetrically. Idempotent:
   * calling `wire()` twice attaches only once.
   */
  wire(): () => void {
    if (!this.wired) {
      this.deps.approvalService.on(APPROVAL_CREATED_EVENT, this.listener);
      this.wired = true;
    }
    return () => {
      if (this.wired) {
        this.deps.approvalService.off(APPROVAL_CREATED_EVENT, this.listener);
        this.wired = false;
      }
    };
  }

  private handleCreated(item: ApprovalItem): void {
    const projectId = item.projectId;
    if (!projectId) return; // approval without project scope — nothing to gate.

    const project = this.safeGetProject(projectId);
    if (!project) return;
    if (project.autonomyMode === 'manual') return; // manual = leave as-is.

    const decision = evaluateDecision(item);
    const label = resolveLabel(decision.label, decision.rawKind);
    if (decision.kind === 'accept') {
      this.runAcceptPath(item, label, projectId);
    } else {
      this.runDowngradePath(item, label, projectId);
    }
  }

  private runAcceptPath(
    item: ApprovalItem,
    label: string,
    projectId: string,
  ): void {
    try {
      this.deps.approvalService.decide(
        item.id,
        'approve',
        AUTONOMY_GATE_AUTO_COMMENT,
      );
    } catch (err) {
      this.warn('decide(approve) failed', { approvalId: item.id, err });
      // If the decide itself blows up there is nothing left to do — the
      // approval is still pending and the user can decide manually.
      return;
    }

    this.postMinutesTrace(
      projectId,
      item.meetingId ?? null,
      resolveNotificationLabel('autonomyGate.trace.autoAccepted', { label }),
    );

    try {
      this.deps.notificationService.show({
        kind: 'work_done',
        title: resolveNotificationLabel('autonomyGate.notify.autoAcceptTitle'),
        body: resolveNotificationLabel('autonomyGate.notify.autoAcceptBody', {
          label,
        }),
        channelId: item.channelId,
      });
    } catch (err) {
      this.warn('notifications.show(work_done) failed', { err });
    }
  }

  private runDowngradePath(
    item: ApprovalItem,
    label: string,
    projectId: string,
  ): void {
    try {
      this.deps.projectService.setAutonomy(projectId, 'manual', {
        reason: 'autonomy_gate_fail',
      });
    } catch (err) {
      this.warn('projectService.setAutonomy(manual) failed', {
        projectId,
        err,
      });
      // Continue — the approval row is untouched, the user can still
      // act on it; the missing downgrade is the worst outcome but the
      // gate must not rethrow into the ApprovalService listener chain.
    }

    this.postMinutesTrace(
      projectId,
      item.meetingId ?? null,
      resolveNotificationLabel('autonomyGate.trace.downgraded', { label }),
    );

    try {
      this.deps.notificationService.show({
        kind: 'error',
        title: resolveNotificationLabel('autonomyGate.notify.errorTitle'),
        body: resolveNotificationLabel('autonomyGate.notify.errorBody', {
          label,
        }),
        channelId: item.channelId,
      });
    } catch (err) {
      this.warn('notifications.show(error) failed', { err });
    }
  }

  /**
   * Append a system message to the project's `#회의록` channel. Silent
   * best-effort — if the channel is missing or the message layer throws,
   * the gate still completes its primary action (decide / downgrade).
   */
  private postMinutesTrace(
    projectId: string,
    meetingId: string | null,
    content: string,
  ): void {
    let minutesChannelId: string | null;
    try {
      const rows = this.deps.channelService.listByProject(projectId);
      const minutes = rows.find((c) => c.kind === 'system_minutes');
      minutesChannelId = minutes?.id ?? null;
    } catch (err) {
      this.warn('channels.listByProject failed', { projectId, err });
      return;
    }
    if (!minutesChannelId) return;

    try {
      this.deps.messageService.append({
        channelId: minutesChannelId,
        meetingId,
        authorId: 'system',
        authorKind: 'system',
        role: 'system',
        content,
        meta: null,
      });
    } catch (err) {
      this.warn('messages.append (#회의록) failed', {
        projectId,
        minutesChannelId,
        err,
      });
    }
  }

  private safeGetProject(
    projectId: string,
  ): { id: string; autonomyMode: AutonomyMode } | null {
    try {
      return this.deps.projectService.get(projectId);
    } catch (err) {
      this.warn('projectService.get failed', { projectId, err });
      return null;
    }
  }

  private warn(stage: string, detail: Record<string, unknown>): void {
    const err = detail.err;
    // TODO R2-log: swap console.warn for structured logger.
    console.warn('[rolestra.autonomy-gate]', stage, {
      ...detail,
      name: err instanceof Error ? err.name : undefined,
      message:
        err instanceof Error ? err.message : err === undefined ? undefined : String(err),
    });
  }
}

/**
 * Pure policy evaluator — exported for unit tests that want to assert
 * the table without building a full gate. See file header for the spec
 * source of truth.
 */
export function evaluateDecision(item: ApprovalItem): GateDecision {
  switch (item.kind) {
    case 'mode_transition': {
      const payload = item.payload as
        | { targetMode?: string; currentMode?: string }
        | null;
      const target = typeof payload?.targetMode === 'string' ? payload.targetMode : '';
      if (target === 'auto' || target === 'hybrid') {
        return {
          kind: 'accept',
          label: 'mode_transition',
          rawKind: item.kind,
        };
      }
      // target='approval' — defensively downgrade. The user is moving
      // INTO stricter approval mode, so silently flipping autonomy back
      // to manual at the same time matches the "safer side" rule.
      return {
        kind: 'downgrade',
        label: 'mode_transition',
        rawKind: item.kind,
      };
    }
    case 'consensus_decision': {
      const payload = item.payload as { outcome?: string } | null;
      if (
        typeof payload?.outcome === 'string' &&
        NOT_ACCEPTED_OUTCOMES.has(payload.outcome)
      ) {
        return {
          kind: 'downgrade',
          label: 'consensus_decision',
          rawKind: item.kind,
        };
      }
      return {
        kind: 'accept',
        label: 'consensus_decision',
        rawKind: item.kind,
      };
    }
    case 'review_outcome': {
      const payload = item.payload as { outcome?: string } | null;
      if (payload?.outcome === 'accepted') {
        return {
          kind: 'accept',
          label: 'review_outcome',
          rawKind: item.kind,
        };
      }
      return {
        kind: 'downgrade',
        label: 'review_outcome',
        rawKind: item.kind,
      };
    }
    case 'cli_permission':
      return {
        kind: 'downgrade',
        label: 'cli_permission',
        rawKind: item.kind,
      };
    case 'failure_report':
      return {
        kind: 'downgrade',
        label: 'failure_report',
        rawKind: item.kind,
      };
    default:
      // Future kinds default to the safe side — downgrade and make the
      // user look at it. If a new kind should auto-accept, add it here
      // explicitly rather than widening this fallthrough.
      return {
        kind: 'downgrade',
        label: 'unknown',
        rawKind: String(item.kind),
      };
  }
}
