/**
 * R9-Task1: discriminated union shape tests for the 3 new broadcast
 * stream events (`stream:queue-updated`, `stream:notification-prefs-changed`,
 * `stream:autonomy-mode-changed`). These are type-level checks via `satisfies`
 * that catch accidental schema drift at compile time. Runtime `expect` is a
 * thin sanity layer.
 */
import { describe, it, expect } from 'vitest';
import type {
  StreamEvent,
  StreamV3PayloadOf,
} from '../stream-events';
import type { QueueItem } from '../queue-types';
import type { NotificationPrefs } from '../notification-types';
import type { AutonomyMode } from '../project-types';

describe('R9 stream events — discriminated union', () => {
  it('stream:queue-updated payload matches QueueItem[] + projectId + paused', () => {
    const items: QueueItem[] = [
      {
        id: 'q1',
        projectId: 'p1',
        targetChannelId: null,
        orderIndex: 0,
        prompt: 'do X',
        status: 'pending',
        startedMeetingId: null,
        startedAt: null,
        finishedAt: null,
        lastError: null,
        createdAt: 1,
      },
    ];
    const payload: StreamV3PayloadOf<'stream:queue-updated'> = {
      projectId: 'p1',
      items,
      paused: false,
    };
    const evt: StreamEvent = { type: 'stream:queue-updated', payload };
    expect(evt.type).toBe('stream:queue-updated');
    expect(payload.items[0]?.id).toBe('q1');
    expect(payload.paused).toBe(false);
  });

  it('stream:notification-prefs-changed carries full NotificationPrefs', () => {
    const prefs: NotificationPrefs = {
      new_message: { enabled: true, soundEnabled: true },
      approval_pending: { enabled: true, soundEnabled: true },
      work_done: { enabled: true, soundEnabled: false },
      error: { enabled: true, soundEnabled: true },
      queue_progress: { enabled: false, soundEnabled: false },
      meeting_state: { enabled: true, soundEnabled: false },
    };
    const payload: StreamV3PayloadOf<'stream:notification-prefs-changed'> = {
      prefs,
    };
    const evt: StreamEvent = {
      type: 'stream:notification-prefs-changed',
      payload,
    };
    expect(evt.type).toBe('stream:notification-prefs-changed');
    expect(payload.prefs.work_done.soundEnabled).toBe(false);
  });

  it('stream:autonomy-mode-changed accepts all 3 modes + optional reason', () => {
    const modes: AutonomyMode[] = ['manual', 'auto_toggle', 'queue'];
    for (const mode of modes) {
      const payload: StreamV3PayloadOf<'stream:autonomy-mode-changed'> = {
        projectId: 'p1',
        mode,
      };
      expect(payload.mode).toBe(mode);
    }
    const withReason: StreamV3PayloadOf<'stream:autonomy-mode-changed'> = {
      projectId: 'p1',
      mode: 'manual',
      reason: 'circuit_breaker',
    };
    expect(withReason.reason).toBe('circuit_breaker');
  });
});
