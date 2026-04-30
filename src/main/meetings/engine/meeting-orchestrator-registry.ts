/**
 * MeetingOrchestratorRegistry — process-wide lookup for live
 * MeetingOrchestrator instances keyed by meetingId.
 *
 * Why a registry and not a global singleton: one Electron session can
 * host multiple meetings in parallel (different channels / projects).
 * Each meeting owns its own Session + TurnExecutor + Orchestrator tuple
 * and is torn down on terminal.
 *
 * IPC handlers reach the orchestrator via this registry without
 * importing `main/index.ts` (which would form a circular edge through
 * `registerIpcHandlers`).
 *
 * Tests construct their own MeetingOrchestrator directly and bypass the
 * registry entirely. The `__resetForTests` helper guarantees a clean
 * slate between suites that DO exercise the wire-up path (R6-Task6
 * smoke test).
 */

import type { MeetingOrchestrator } from './meeting-orchestrator';
import type { ParticipantMessage } from '../../engine/history';
import type { Message as ChannelMessage } from '../../../shared/message-types';
import { tryGetLogger } from '../../log/logger-accessor';

const instances = new Map<string, MeetingOrchestrator>();

/** Register a live orchestrator under `meetingId`. Replaces any prior
 *  entry (should not happen in normal flow — but protects against a
 *  leaked instance after an abort). */
export function registerOrchestrator(
  meetingId: string,
  orchestrator: MeetingOrchestrator,
): void {
  instances.set(meetingId, orchestrator);
}

/** Remove the orchestrator for `meetingId`. No-op when the id is
 *  unknown. Caller should invoke this when the meeting finishes so the
 *  instance can be garbage-collected. */
export function unregisterOrchestrator(meetingId: string): void {
  instances.delete(meetingId);
}

/** Return the orchestrator for `meetingId`, or null when none. */
export function getOrchestrator(
  meetingId: string,
): MeetingOrchestrator | null {
  return instances.get(meetingId) ?? null;
}

/** Test-only: clear every registered instance. */
export function __resetOrchestratorRegistryForTests(): void {
  instances.clear();
}

// ── User-message dispatcher (D-A T2.5, spec §5.5) ───────────────────

const USER_PARTICIPANT_ID = 'user';
const USER_PARTICIPANT_NAME = '사용자';

/**
 * Forward a freshly-appended channel message to the orchestrator that
 * owns the message's `meetingId`, so the meeting's prompt actually sees
 * the user's text on the next AI turn.
 *
 * Wired up at startup (`main/index.ts`) as a `'message'` event listener
 * on `MessageService`. Cheap no-op for messages that aren't user-authored
 * or aren't tied to a live meeting — auto-creating a meeting from a
 * stray channel message belongs to T4/T5 (`MeetingAutoTrigger`), not
 * here. This dispatcher only delivers to *active* meetings the user
 * already sees in the channel rail.
 *
 * Intentionally typed against `ChannelMessage` (the persisted shape from
 * `message-service`) and converts to `ParticipantMessage` internally —
 * the engine layer keeps its richer participant fields without leaking
 * channel-side concerns (`createdAt`, `meta`, etc.) into the prompt.
 */
export function dispatchUserMessageToActiveMeeting(
  message: ChannelMessage,
): void {
  if (message.authorKind !== 'user') return;
  if (message.meetingId === null) return;

  const orchestrator = instances.get(message.meetingId);
  if (orchestrator === null || orchestrator === undefined) {
    // Meeting may have ended between INSERT and listener fire. Drop
    // silently — the channel message itself is preserved on disk.
    tryGetLogger()?.debug?.({
      component: 'meeting',
      action: 'user-interjection-skip',
      result: 'success',
      metadata: {
        reason: 'no-active-orchestrator',
        meetingId: message.meetingId,
        messageId: message.id,
      },
    });
    return;
  }

  const participantMessage: ParticipantMessage = {
    id: message.id,
    role: 'user',
    content: message.content,
    participantId: USER_PARTICIPANT_ID,
    participantName: USER_PARTICIPANT_NAME,
  };

  try {
    orchestrator.handleUserInterjection(participantMessage);
  } catch (err) {
    // Listener errors must not propagate into MessageService.append's
    // contract. Log loudly so a real bug doesn't hide.
    tryGetLogger()?.warn?.({
      component: 'meeting',
      action: 'user-interjection-throw',
      result: 'failure',
      metadata: {
        meetingId: message.meetingId,
        messageId: message.id,
        error: err instanceof Error ? err.message : String(err),
      },
    });
  }
}
