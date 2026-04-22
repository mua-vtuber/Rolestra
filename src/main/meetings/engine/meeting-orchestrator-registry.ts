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
