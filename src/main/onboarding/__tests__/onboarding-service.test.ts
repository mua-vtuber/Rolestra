/**
 * Unit tests for {@link OnboardingService} + {@link OnboardingStateRepository}
 * + the migration 013 schema (R11-Task6).
 *
 * Coverage:
 *   1. First-call seeds the canonical default + persists it.
 *   2. Repeat calls return the persisted row unchanged.
 *   3. applyPartial merges selections field-by-field.
 *   4. applyPartial ignores `completed=true` (only complete() flips it).
 *   5. complete() flips completed=true + bumps updatedAt.
 *   6. reset() returns a fresh default and overwrites the row.
 *   7. CHECK constraint refuses a row with id != 1 at the SQL layer.
 *   8. CHECK constraint refuses current_step outside 1..5.
 *   9. Repository surfaces a corrupt selections_json blob loudly.
 *  10. mergeOnboardingPartial pure-function behaviour (defensive
 *      narrowing on currentStep, full-merge of selections).
 */

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../database/migrator';
import { migrations } from '../../database/migrations/index';
import {
  OnboardingService,
  mergeOnboardingPartial,
} from '../onboarding-service';
import {
  OnboardingStateCorruptError,
  OnboardingStateRepository,
} from '../onboarding-state-repository';

function rowCount(db: Database.Database): number {
  return (
    db
      .prepare('SELECT COUNT(*) AS c FROM onboarding_state')
      .get() as { c: number }
  ).c;
}

describe('OnboardingService — R11-Task6', () => {
  let db: Database.Database;
  let repo: OnboardingStateRepository;
  let nowCounter = 0;
  const nowFn = (): number => {
    nowCounter += 1;
    return 1_700_000_000_000 + nowCounter;
  };

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db, migrations);
    repo = new OnboardingStateRepository(db);
    nowCounter = 0;
  });

  afterEach(() => {
    db.close();
  });

  describe('getState — first-boot defaults', () => {
    it('seeds canonical default + persists row when table is empty', () => {
      const svc = new OnboardingService(repo, nowFn);
      expect(rowCount(db)).toBe(0);

      const state = svc.getState();

      expect(state.completed).toBe(false);
      expect(state.currentStep).toBe(1);
      expect(state.selections).toEqual({});
      expect(state.updatedAt).toBe(1_700_000_000_001);
      expect(rowCount(db)).toBe(1);
    });

    it('returns persisted row unchanged on second call (no clock advance)', () => {
      const svc = new OnboardingService(repo, nowFn);
      const first = svc.getState();
      const second = svc.getState();
      expect(second).toEqual(first);
      expect(rowCount(db)).toBe(1);
    });
  });

  describe('applyPartial — patch semantics', () => {
    it('merges selections field-by-field without dropping prior values', () => {
      const svc = new OnboardingService(repo, nowFn);
      svc.applyPartial({
        currentStep: 2,
        selections: { staff: ['claude', 'gemini'] },
      });

      const next = svc.applyPartial({
        currentStep: 4,
        selections: { permissions: 'hybrid' },
      });

      expect(next.currentStep).toBe(4);
      expect(next.selections.staff).toEqual(['claude', 'gemini']);
      expect(next.selections.permissions).toBe('hybrid');
    });

    it('ignores partial.completed=true (only complete() flips it)', () => {
      const svc = new OnboardingService(repo, nowFn);
      const next = svc.applyPartial({ completed: true, currentStep: 3 });
      expect(next.completed).toBe(false);
      expect(next.currentStep).toBe(3);
    });

    it('clamps an out-of-range currentStep to the previous value', () => {
      const svc = new OnboardingService(repo, nowFn);
      svc.applyPartial({ currentStep: 3 });
      const next = svc.applyPartial({
        currentStep: 99 as unknown as 1 | 2 | 3 | 4 | 5,
      });
      expect(next.currentStep).toBe(3);
    });
  });

  describe('complete — one-way flip', () => {
    it('marks completed=true and bumps updatedAt', () => {
      const svc = new OnboardingService(repo, nowFn);
      const before = svc.getState();
      svc.complete();
      const after = svc.getState();
      expect(after.completed).toBe(true);
      expect(after.updatedAt).toBeGreaterThan(before.updatedAt);
    });

    it('is idempotent — second complete() leaves selections / step intact', () => {
      const svc = new OnboardingService(repo, nowFn);
      svc.applyPartial({
        currentStep: 5,
        selections: { staff: ['codex'] },
      });
      svc.complete();
      svc.complete();
      const state = svc.getState();
      expect(state.completed).toBe(true);
      expect(state.currentStep).toBe(5);
      expect(state.selections.staff).toEqual(['codex']);
    });
  });

  describe('reset — restart wizard', () => {
    it('overwrites the row with the canonical default', () => {
      const svc = new OnboardingService(repo, nowFn);
      svc.applyPartial({
        currentStep: 4,
        selections: { staff: ['claude'], permissions: 'hybrid' },
      });
      svc.complete();

      const fresh = svc.reset();

      expect(fresh.completed).toBe(false);
      expect(fresh.currentStep).toBe(1);
      expect(fresh.selections).toEqual({});
      expect(rowCount(db)).toBe(1);
    });
  });

  describe('migration 013 — schema constraints', () => {
    it('rejects a row with id != 1 at the SQL layer', () => {
      expect(() =>
        db
          .prepare(
            `INSERT INTO onboarding_state
               (id, completed, current_step, selections_json, updated_at)
               VALUES (2, 0, 1, '{}', 0)`,
          )
          .run(),
      ).toThrow(/CHECK constraint failed/);
    });

    it('rejects current_step outside 1..5', () => {
      expect(() =>
        db
          .prepare(
            `INSERT INTO onboarding_state
               (id, completed, current_step, selections_json, updated_at)
               VALUES (1, 0, 7, '{}', 0)`,
          )
          .run(),
      ).toThrow(/CHECK constraint failed/);
    });

    it('rejects completed outside 0..1', () => {
      expect(() =>
        db
          .prepare(
            `INSERT INTO onboarding_state
               (id, completed, current_step, selections_json, updated_at)
               VALUES (1, 5, 1, '{}', 0)`,
          )
          .run(),
      ).toThrow(/CHECK constraint failed/);
    });

    it('migration 013 is idempotent on a re-run', () => {
      // The migrator already ran the chain in beforeEach. Running it
      // again must be a no-op (already-applied skip + IF NOT EXISTS
      // defence-in-depth on the CREATE).
      expect(() => runMigrations(db, migrations)).not.toThrow();
      expect(rowCount(db)).toBe(0);
    });
  });

  describe('repository — corrupt blob handling', () => {
    it('throws OnboardingStateCorruptError on malformed JSON', () => {
      const now = Date.now();
      db
        .prepare(
          `INSERT INTO onboarding_state
             (id, completed, current_step, selections_json, updated_at)
             VALUES (1, 0, 1, '{not valid json', ?)`,
        )
        .run(now);
      expect(() => repo.read()).toThrow(OnboardingStateCorruptError);
    });

    it('throws OnboardingStateCorruptError when blob is a JSON array', () => {
      const now = Date.now();
      db
        .prepare(
          `INSERT INTO onboarding_state
             (id, completed, current_step, selections_json, updated_at)
             VALUES (1, 0, 1, '[]', ?)`,
        )
        .run(now);
      expect(() => repo.read()).toThrow(OnboardingStateCorruptError);
    });
  });
});

describe('mergeOnboardingPartial — pure function', () => {
  const base = {
    completed: false as const,
    currentStep: 2 as const,
    selections: {
      staff: ['claude'],
      permissions: 'approval' as const,
    },
    updatedAt: 100,
  };

  it('preserves prior selection keys not present in the patch', () => {
    const merged = mergeOnboardingPartial(
      base,
      { currentStep: 3, selections: { roles: { claude: '시니어' } } },
      200,
    );
    expect(merged.selections.staff).toEqual(['claude']);
    expect(merged.selections.permissions).toBe('approval');
    expect(merged.selections.roles).toEqual({ claude: '시니어' });
    expect(merged.updatedAt).toBe(200);
  });

  it('keeps completed unchanged regardless of patch.completed', () => {
    const merged = mergeOnboardingPartial(
      base,
      { completed: true },
      200,
    );
    expect(merged.completed).toBe(false);
  });
});
