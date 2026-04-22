/**
 * ApprovalCliAdapter — v3 replacement for the v2 `registerPendingCliPermission`
 * in-memory Map (R7-Task3).
 *
 * CLI providers pause their stream and await a `Promise<boolean>` whenever a
 * permission prompt is parsed. R6 still routed that Promise through a
 * module-level `Map` in `cli-permission-handler.ts`; R7 moves it onto
 * {@link ApprovalService} so every permission decision:
 *   - lands in the `approval_items` table (audit + crash recovery),
 *   - reaches the renderer as `stream:approval-created`/`stream:approval-decided`
 *     (dashboard + `#승인-대기` channel update live),
 *   - participates in the same reject / conditional comment pipeline as
 *     every other approval kind (Task 6 system-message injector).
 *
 * Contract (spec §7.7 + R7 plan D2):
 *   - Resolves `true` on `decision ∈ {'approve', 'conditional'}` — CLI keeps
 *     running. Conditional comment is delivered to the AI via the
 *     SystemMessageInjector on the next turn; the CLI itself only sees the
 *     allow signal.
 *   - Resolves `false` on `decision === 'reject'` — CLI reports denial.
 *   - Resolves `false` on timeout (default 5 minutes / 300_000 ms) and
 *     transitions the pending row to `status='expired'` so the renderer
 *     stops showing it. A slow user response is equivalent to a deny —
 *     prevents a meeting from stalling indefinitely.
 *   - Listener cleanup is guaranteed in every path (decided, timeout,
 *     synchronous throw) so `ApprovalService` does not accumulate handlers
 *     across long meetings. Tested via listener-count assertion.
 *
 * Integration:
 *   MeetingTurnExecutor.wireCliPermissionCallback passes the parsed
 *   CLI request here; the adapter creates the approval, waits for the
 *   user, and returns the boolean the CLI stream expects. All v2 coupling
 *   (`registerPendingCliPermission`, `stream:cli-permission-request`) is
 *   gone from the turn executor in the same commit.
 */

import type { ApprovalItem } from '../../shared/approval-types';
import type { CliPermissionApprovalPayload } from '../../shared/approval-types';
import type { ParsedCliPermissionRequest } from '../providers/cli/cli-permission-parser';
import {
  APPROVAL_DECIDED_EVENT,
  type ApprovalDecidedPayload,
  type ApprovalService,
} from './approval-service';

/** Spec §7.7 default — 5 minutes is long enough for an attentive user to
 *  glance at the ApprovalCard and short enough that an absent user does
 *  not block the whole meeting. Overridable per call (tests use a smaller
 *  value; an R9 autonomy policy can raise it). */
export const DEFAULT_CLI_PERMISSION_TIMEOUT_MS = 5 * 60 * 1000;

export interface CreateCliPermissionApprovalCtx {
  meetingId: string;
  channelId: string;
  projectId: string | null;
  participantId: string;
  participantName: string;
  request: ParsedCliPermissionRequest;
  /** Optional override. Undefined means {@link DEFAULT_CLI_PERMISSION_TIMEOUT_MS}. */
  timeoutMs?: number;
}

/**
 * Thin adapter — owns neither CLI nor Meeting state, only the Promise
 * bridge between `ApprovalService.decide` and the CLI stream. Stateless
 * per call; safe to share one instance across every MeetingTurnExecutor.
 */
export class ApprovalCliAdapter {
  constructor(private readonly approvalService: ApprovalService) {}

  /**
   * Open an approval for a single CLI permission prompt and resolve when
   * the user decides (or the timeout fires). See class docstring for the
   * decision → boolean mapping.
   *
   * The returned Promise is listener-leak-free: the 'decided' subscriber
   * is attached inside the executor and removed on every exit path.
   */
  createCliPermissionApproval(
    ctx: CreateCliPermissionApprovalCtx,
  ): Promise<boolean> {
    const timeoutMs = ctx.timeoutMs ?? DEFAULT_CLI_PERMISSION_TIMEOUT_MS;

    const payload: CliPermissionApprovalPayload = {
      kind: 'cli_permission',
      cliRequestId: ctx.request.cliRequestId,
      toolName: ctx.request.toolName,
      target: ctx.request.target,
      // Parser returns `string | undefined`; normalise to null so the
      // payload shape (zod + DB) stays non-undefined.
      description: ctx.request.description ?? null,
      participantId: ctx.participantId,
      participantName: ctx.participantName,
    };

    const item: ApprovalItem = this.approvalService.create({
      kind: 'cli_permission',
      projectId: ctx.projectId,
      channelId: ctx.channelId,
      meetingId: ctx.meetingId,
      requesterId: ctx.participantId,
      payload,
    });
    const approvalId = item.id;

    return new Promise<boolean>((resolve) => {
      let settled = false;

      const settleOnce = (value: boolean): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.approvalService.off(APPROVAL_DECIDED_EVENT, onDecided);
        resolve(value);
      };

      const onDecided = (decided: ApprovalDecidedPayload): void => {
        if (decided.item.id !== approvalId) return;
        // 'conditional' keeps the CLI running — the condition carried by
        // the comment is injected into the AI context on the next turn
        // via ApprovalSystemMessageInjector (R7-Task6). The CLI itself
        // only sees the allow signal; from its perspective conditional
        // and approve are indistinguishable, matching spec §7.7.
        settleOnce(decided.decision !== 'reject');
      };

      const timer = setTimeout(() => {
        // Best-effort expire. If the user raced the timer by ~a ms the
        // row may already be in a terminal state; we don't care — the
        // error is only logged for post-mortem.
        try {
          this.approvalService.expire(approvalId);
        } catch (err) {
          console.warn(
            '[rolestra.approvals] cli-adapter timeout expire failed:',
            {
              approvalId,
              name: err instanceof Error ? err.name : undefined,
              message: err instanceof Error ? err.message : String(err),
            },
          );
        }
        settleOnce(false);
      }, timeoutMs);

      this.approvalService.on(APPROVAL_DECIDED_EVENT, onDecided);
    });
  }
}
