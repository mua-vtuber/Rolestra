/**
 * Unit tests for TurnManager — controls speaking order and round progression.
 *
 * Covers:
 * - Round-robin speaker order with multiple participants
 * - Round advancement after all speakers complete
 * - Round limit enforcement
 * - Pause/resume mid-round
 * - getNextSpeaker returns null when all rounds complete
 * - Reset state
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TurnManager } from '../turn-manager';
import type { Participant } from '../../../shared/engine-types';

// ── Helpers ──────────────────────────────────────────────────────────

function makeParticipants(count = 3): Participant[] {
  const participants: Participant[] = [
    { id: 'user', displayName: 'User', isActive: true },
  ];
  for (let i = 1; i <= count; i++) {
    participants.push({
      id: `ai-${i}`,
      providerId: `provider-${i}`,
      displayName: `AI-${i}`,
      isActive: true,
    });
  }
  return participants;
}

function createManager(
  roundSetting: number | 'unlimited' = 3,
  participantCount = 2,
): TurnManager {
  return new TurnManager({
    roundSetting,
    participants: makeParticipants(participantCount),
  });
}

// ── Tests ────────────────────────────────────────────────────────────

describe('TurnManager', () => {
  let manager: TurnManager;

  beforeEach(() => {
    manager = createManager(3, 2);
  });

  // ── Initial state ───────────────────────────────────────────────

  describe('initial state', () => {
    it('starts in idle state', () => {
      expect(manager.state).toBe('idle');
    });

    it('has correct initial round', () => {
      expect(manager.currentRound).toBe(1);
    });

    it('stores participants correctly', () => {
      expect(manager.participants).toHaveLength(3); // user + 2 AIs
    });

    it('stores round setting', () => {
      expect(manager.roundSetting).toBe(3);
    });
  });

  // ── Round-robin speaker order ───────────────────────────────────

  describe('round-robin speaker order', () => {
    it('cycles through active AI participants in order', () => {
      manager.start();

      const speaker1 = manager.getNextSpeaker();
      expect(speaker1?.id).toBe('ai-1');

      const speaker2 = manager.getNextSpeaker();
      expect(speaker2?.id).toBe('ai-2');
    });

    it('skips user participant in turn order', () => {
      manager.start();

      // Collect all speakers for one round
      const speakers: string[] = [];
      for (let i = 0; i < 2; i++) {
        const speaker = manager.getNextSpeaker();
        if (speaker) speakers.push(speaker.id);
      }

      expect(speakers).toEqual(['ai-1', 'ai-2']);
      expect(speakers).not.toContain('user');
    });

    it('wraps around to first AI in the next round', () => {
      manager.start();

      // Complete round 1
      expect(manager.getNextSpeaker()?.id).toBe('ai-1');
      expect(manager.getNextSpeaker()?.id).toBe('ai-2');

      // Round 2 should restart the cycle
      expect(manager.getNextSpeaker()?.id).toBe('ai-1');
    });

    it('works with 3 AI participants', () => {
      const bigManager = createManager(2, 3);
      bigManager.start();

      // Round 1
      expect(bigManager.getNextSpeaker()?.id).toBe('ai-1');
      expect(bigManager.getNextSpeaker()?.id).toBe('ai-2');
      expect(bigManager.getNextSpeaker()?.id).toBe('ai-3');

      // Round 2
      expect(bigManager.getNextSpeaker()?.id).toBe('ai-1');
      expect(bigManager.getNextSpeaker()?.id).toBe('ai-2');
      expect(bigManager.getNextSpeaker()?.id).toBe('ai-3');

      // All rounds complete
      expect(bigManager.getNextSpeaker()).toBeNull();
    });

    it('skips inactive AI participants', () => {
      manager.start();
      manager.setParticipantActive('ai-1', false);

      const speaker = manager.getNextSpeaker();
      expect(speaker?.id).toBe('ai-2');
    });
  });

  // ── Round advancement ───────────────────────────────────────────

  describe('round advancement', () => {
    it('advances round after all active AI speakers complete', () => {
      manager.start();
      expect(manager.currentRound).toBe(1);

      manager.getNextSpeaker(); // ai-1
      manager.getNextSpeaker(); // ai-2
      expect(manager.isRoundComplete()).toBe(true);

      // Next call should advance the round
      manager.getNextSpeaker(); // ai-1 (round 2)
      expect(manager.currentRound).toBe(2);
    });

    it('reports isRoundComplete correctly', () => {
      manager.start();

      expect(manager.isRoundComplete()).toBe(false);
      manager.getNextSpeaker(); // ai-1
      expect(manager.isRoundComplete()).toBe(false);
      manager.getNextSpeaker(); // ai-2
      expect(manager.isRoundComplete()).toBe(true);
    });
  });

  // ── Round limit enforcement ─────────────────────────────────────

  describe('round limit enforcement', () => {
    it('returns null when all rounds complete', () => {
      const limited = createManager(2, 2);
      limited.start();

      // Round 1: 2 speakers
      limited.getNextSpeaker();
      limited.getNextSpeaker();

      // Round 2: 2 speakers
      limited.getNextSpeaker();
      limited.getNextSpeaker();

      // No more rounds
      expect(limited.getNextSpeaker()).toBeNull();
    });

    it('reports isAllRoundsComplete correctly', () => {
      const limited = createManager(1, 2);
      limited.start();

      expect(limited.isAllRoundsComplete()).toBe(false);

      limited.getNextSpeaker(); // ai-1
      expect(limited.isAllRoundsComplete()).toBe(false);

      limited.getNextSpeaker(); // ai-2
      expect(limited.isAllRoundsComplete()).toBe(true);
    });

    it('never completes with unlimited setting', () => {
      const unlimited = createManager('unlimited', 2);
      unlimited.start();

      // Run through many rounds
      for (let i = 0; i < 100; i++) {
        const speaker = unlimited.getNextSpeaker();
        expect(speaker).not.toBeNull();
      }

      expect(unlimited.isAllRoundsComplete()).toBe(false);
    });
  });

  // ── Pause / Resume ──────────────────────────────────────────────

  describe('pause and resume', () => {
    it('pauses and resumes correctly', () => {
      manager.start();

      manager.getNextSpeaker(); // ai-1 speaks

      manager.pause();
      expect(manager.state).toBe('paused');

      // Cannot get next speaker while paused
      expect(manager.getNextSpeaker()).toBeNull();

      manager.resume();
      expect(manager.state).toBe('running');

      // Should continue from where it left off
      const nextSpeaker = manager.getNextSpeaker();
      expect(nextSpeaker?.id).toBe('ai-2');
    });

    it('throws when pausing from non-running state', () => {
      expect(() => manager.pause()).toThrow('Cannot pause');
    });

    it('throws when resuming from non-paused state', () => {
      manager.start();
      expect(() => manager.resume()).toThrow('Cannot resume');
    });
  });

  // ── getNextSpeaker null cases ───────────────────────────────────

  describe('getNextSpeaker returns null', () => {
    it('returns null when not running', () => {
      expect(manager.getNextSpeaker()).toBeNull();
    });

    it('returns null when stopped', () => {
      manager.start();
      manager.stop();
      expect(manager.getNextSpeaker()).toBeNull();
    });

    it('returns null when no active AI participants', () => {
      manager.start();
      manager.setParticipantActive('ai-1', false);
      manager.setParticipantActive('ai-2', false);

      expect(manager.getNextSpeaker()).toBeNull();
    });
  });

  // ── Reset ───────────────────────────────────────────────────────

  describe('reset', () => {
    it('resets to idle state', () => {
      manager.start();
      manager.getNextSpeaker();
      manager.getNextSpeaker();

      manager.reset();

      expect(manager.state).toBe('idle');
      expect(manager.currentRound).toBe(1);
    });

    it('allows start again after reset', () => {
      manager.start();
      manager.stop();
      manager.reset();

      // Should be able to start again
      manager.start();
      expect(manager.state).toBe('running');
      expect(manager.getNextSpeaker()?.id).toBe('ai-1');
    });
  });

  // ── Lifecycle ───────────────────────────────────────────────────

  describe('lifecycle', () => {
    it('start throws when not idle', () => {
      manager.start();
      expect(() => manager.start()).toThrow('Cannot start');
    });

    it('stop is idempotent', () => {
      // Stop when idle — should not throw
      manager.stop();
      expect(manager.state).toBe('idle');

      // Stop when already stopped
      manager.start();
      manager.stop();
      manager.stop();
      expect(manager.state).toBe('stopped');
    });
  });

  // ── Participant management ──────────────────────────────────────

  describe('participant management', () => {
    it('adds a participant', () => {
      const initial = manager.participants.length;
      manager.addParticipant({
        id: 'ai-new',
        displayName: 'New AI',
        isActive: true,
        providerId: 'new-provider',
      });
      expect(manager.participants).toHaveLength(initial + 1);
    });

    it('throws when adding duplicate participant', () => {
      expect(() =>
        manager.addParticipant({
          id: 'ai-1',
          displayName: 'Dup',
          isActive: true,
        }),
      ).toThrow('Participant already exists');
    });

    it('removes a participant', () => {
      const initial = manager.participants.length;
      manager.removeParticipant('ai-1');
      expect(manager.participants).toHaveLength(initial - 1);
      expect(manager.participants.find(p => p.id === 'ai-1')).toBeUndefined();
    });

    it('throws when setting active on nonexistent participant', () => {
      expect(() =>
        manager.setParticipantActive('nonexistent', true),
      ).toThrow('Participant not found');
    });

    it('updates round setting', () => {
      manager.setRoundSetting(10);
      expect(manager.roundSetting).toBe(10);

      manager.setRoundSetting('unlimited');
      expect(manager.roundSetting).toBe('unlimited');
    });
  });

  // ── User interruption ──────────────────────────────────────────

  describe('user interruption', () => {
    it('does not alter turn state on interruption', () => {
      manager.start();
      manager.getNextSpeaker(); // ai-1

      const roundBefore = manager.currentRound;
      manager.interruptWithUserMessage();

      expect(manager.currentRound).toBe(roundBefore);
      expect(manager.state).toBe('running');

      // First call after interruption returns null (yields control to orchestrator)
      const yielded = manager.getNextSpeaker();
      expect(yielded).toBeNull();

      // Subsequent call resumes from where it left off
      const next = manager.getNextSpeaker();
      expect(next?.id).toBe('ai-2');
    });
  });
});
