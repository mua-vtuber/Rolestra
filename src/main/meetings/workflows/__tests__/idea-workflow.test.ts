/**
 * idea-workflow 단위 테스트 — IdeaUserPickPending suspend / commit / cancel.
 * R12-C2 T15 land. spec §5.1.
 *
 * 검증 (single-use Promise holder 계약):
 *   - wait() 호출 직후 isWaiting=true / isSettled=false
 *   - commit(input) → wait() promise resolve + isSettled=true
 *   - cancel(reason) → wait() promise reject + isSettled=true
 *   - settled 후 wait() 재호출 → throw (single-use)
 *   - settled 후 commit() 재호출 → throw (중복 commit)
 *   - wait() 호출 전 commit() → throw (race)
 *   - 호출 안 한 instance 의 cancel() → no-op (settled 상태 X)
 *   - 호출 안 한 instance 의 isWaiting → false
 */

import { describe, expect, it } from 'vitest';
import { IdeaUserPickPending } from '../idea-workflow';
import type { IdeaFinalizeSelectionInput } from '../../../../shared/opinion-types';

const sample: IdeaFinalizeSelectionInput = {
  meetingId: 'meeting-1',
  selectedScreenIds: ['ITEM_001'],
  userComment: 'sample',
};

describe('IdeaUserPickPending', () => {
  describe('lifecycle', () => {
    it('starts in pristine state — neither waiting nor settled', () => {
      const p = new IdeaUserPickPending();
      expect(p.isSettled).toBe(false);
      expect(p.isWaiting).toBe(false);
    });

    it('wait() flips isWaiting=true / isSettled=false', () => {
      const p = new IdeaUserPickPending();
      void p.wait();
      expect(p.isWaiting).toBe(true);
      expect(p.isSettled).toBe(false);
    });

    it('commit(input) resolves wait() as approve decision + flips settled', async () => {
      const p = new IdeaUserPickPending();
      const promise = p.wait();
      p.commit(sample);
      await expect(promise).resolves.toEqual({
        kind: 'approve',
        input: sample,
      });
      expect(p.isSettled).toBe(true);
      expect(p.isWaiting).toBe(false);
    });

    it('requestMore(input) resolves wait() as request_more decision', async () => {
      const p = new IdeaUserPickPending();
      const promise = p.wait();
      p.requestMore(sample);
      await expect(promise).resolves.toEqual({
        kind: 'request_more',
        input: sample,
      });
      expect(p.isSettled).toBe(true);
      expect(p.isWaiting).toBe(false);
    });

    it('cancel({ kind: "aborted" }) rejects wait() + flips settled', async () => {
      const p = new IdeaUserPickPending();
      const promise = p.wait();
      p.cancel({ kind: 'aborted' });
      await expect(promise).rejects.toEqual({ kind: 'aborted' });
      expect(p.isSettled).toBe(true);
      expect(p.isWaiting).toBe(false);
    });

    it('cancel({ kind: "replaced", message }) rejects with the carried payload', async () => {
      const p = new IdeaUserPickPending();
      const promise = p.wait();
      const reason = { kind: 'replaced' as const, message: 'user reset' };
      p.cancel(reason);
      await expect(promise).rejects.toEqual(reason);
    });
  });

  describe('single-use invariants', () => {
    it('wait() on a settled instance throws', () => {
      const p = new IdeaUserPickPending();
      void p.wait();
      p.commit(sample);
      expect(() => p.wait()).toThrow(/single-use/);
    });

    it('commit() on a settled instance throws (duplicate commit)', () => {
      const p = new IdeaUserPickPending();
      void p.wait();
      p.commit(sample);
      expect(() => p.commit(sample)).toThrow(/duplicate commit|settled/);
    });

    it('requestMore() on a settled instance throws (duplicate commit)', () => {
      const p = new IdeaUserPickPending();
      void p.wait();
      p.requestMore(sample);
      expect(() => p.requestMore(sample)).toThrow(/duplicate commit|settled/);
    });

    it('commit() before wait() throws (race / wrong order)', () => {
      const p = new IdeaUserPickPending();
      expect(() => p.commit(sample)).toThrow(/before wait/);
    });

    it('requestMore() before wait() throws (race / wrong order)', () => {
      const p = new IdeaUserPickPending();
      expect(() => p.requestMore(sample)).toThrow(/before wait/);
    });

    it('cancel() on a settled instance is a no-op (idempotent abort)', () => {
      const p = new IdeaUserPickPending();
      void p.wait();
      p.commit(sample);
      // settled 상태에서 cancel 다시 부르면 throw 하지 않고 그냥 no-op.
      expect(() => p.cancel({ kind: 'aborted' })).not.toThrow();
      expect(p.isSettled).toBe(true);
    });

    it('cancel() on a pristine instance (no wait yet) is a no-op', () => {
      const p = new IdeaUserPickPending();
      expect(() => p.cancel({ kind: 'aborted' })).not.toThrow();
      expect(p.isSettled).toBe(false);
    });
  });
});
