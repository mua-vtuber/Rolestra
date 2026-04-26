/**
 * LlmCostRepository — R11-Task8 (D4).
 *
 * Coverage:
 * - append() stores all fields, returns the auto-incremented id.
 * - append() accepts a null meeting_id.
 * - summarize() aggregates by provider with token sums.
 * - summarize() honours the rolling window (rows outside dropped).
 * - summarize() default period = 30 days.
 * - summarize() returns empty byProvider/totalTokens=0 on empty table.
 * - summarize() byProvider sorted by total tokens desc, then id asc.
 * - recent() returns rows newest-first, bounded by limit.
 * - estimatedUsd is always null at the repository layer (service fills).
 */

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../database/migrator';
import { migrations } from '../../database/migrations/index';
import {
  DEFAULT_PERIOD_DAYS,
  LlmCostRepository,
} from '../llm-cost-repository';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

describe('LlmCostRepository (R11-Task8)', () => {
  let db: Database.Database;
  let repo: LlmCostRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db, migrations);
    repo = new LlmCostRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('append', () => {
    it('stores all fields and returns the inserted entry', () => {
      const entry = repo.append({
        meetingId: 'm-1',
        providerId: 'claude',
        tokenIn: 1234,
        tokenOut: 567,
      });
      expect(entry.id).toBeGreaterThan(0);
      expect(entry.meetingId).toBe('m-1');
      expect(entry.providerId).toBe('claude');
      expect(entry.tokenIn).toBe(1234);
      expect(entry.tokenOut).toBe(567);
      expect(entry.createdAt).toBeGreaterThan(0);
    });

    it('accepts a null meeting_id', () => {
      const entry = repo.append({
        meetingId: null,
        providerId: 'gpt-5',
        tokenIn: 10,
        tokenOut: 5,
      });
      expect(entry.meetingId).toBeNull();
    });

    it('id is auto-increment monotonic across calls', () => {
      const a = repo.append({
        meetingId: null,
        providerId: 'p',
        tokenIn: 1,
        tokenOut: 1,
      });
      const b = repo.append({
        meetingId: null,
        providerId: 'p',
        tokenIn: 1,
        tokenOut: 1,
      });
      expect(b.id).toBeGreaterThan(a.id);
    });
  });

  describe('summarize', () => {
    it('returns empty byProvider/totalTokens=0 on empty table', () => {
      const summary = repo.summarize();
      expect(summary.byProvider).toEqual([]);
      expect(summary.totalTokens).toBe(0);
      expect(summary.periodEndAt).toBeGreaterThan(summary.periodStartAt);
    });

    it('aggregates rows per provider over the rolling window', () => {
      repo.append({
        meetingId: 'm-1',
        providerId: 'claude',
        tokenIn: 100,
        tokenOut: 50,
      });
      repo.append({
        meetingId: 'm-1',
        providerId: 'claude',
        tokenIn: 200,
        tokenOut: 30,
      });
      repo.append({
        meetingId: 'm-2',
        providerId: 'gpt-5',
        tokenIn: 50,
        tokenOut: 50,
      });
      const summary = repo.summarize();
      const claude = summary.byProvider.find((p) => p.providerId === 'claude');
      const gpt = summary.byProvider.find((p) => p.providerId === 'gpt-5');
      expect(claude).toEqual({
        providerId: 'claude',
        tokenIn: 300,
        tokenOut: 80,
        estimatedUsd: null,
      });
      expect(gpt).toEqual({
        providerId: 'gpt-5',
        tokenIn: 50,
        tokenOut: 50,
        estimatedUsd: null,
      });
      expect(summary.totalTokens).toBe(380 + 100);
    });

    it('drops rows outside the rolling window', () => {
      const now = 2_000_000_000_000;
      const oldCreatedAt = now - 40 * MS_PER_DAY;
      // direct insert to bypass append()'s Date.now() to forge a dated row
      db.prepare(
        `INSERT INTO llm_cost_audit_log
          (meeting_id, provider_id, token_in, token_out, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(null, 'claude-old', 1000, 500, oldCreatedAt);
      db.prepare(
        `INSERT INTO llm_cost_audit_log
          (meeting_id, provider_id, token_in, token_out, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(null, 'claude-fresh', 100, 50, now - 1 * MS_PER_DAY);
      const summary = repo.summarize({ periodDays: 30, now: () => now });
      expect(summary.byProvider.map((p) => p.providerId)).toEqual([
        'claude-fresh',
      ]);
    });

    it('default period equals DEFAULT_PERIOD_DAYS (30 days)', () => {
      expect(DEFAULT_PERIOD_DAYS).toBe(30);
      const now = 2_000_000_000_000;
      const summary = repo.summarize({ now: () => now });
      expect(summary.periodEndAt - summary.periodStartAt).toBe(
        DEFAULT_PERIOD_DAYS * MS_PER_DAY,
      );
    });

    it('byProvider is sorted by total tokens desc, providerId asc as tiebreak', () => {
      repo.append({
        meetingId: null,
        providerId: 'beta',
        tokenIn: 50,
        tokenOut: 50,
      });
      repo.append({
        meetingId: null,
        providerId: 'alpha',
        tokenIn: 50,
        tokenOut: 50,
      });
      repo.append({
        meetingId: null,
        providerId: 'big',
        tokenIn: 1000,
        tokenOut: 0,
      });
      const summary = repo.summarize();
      expect(summary.byProvider.map((p) => p.providerId)).toEqual([
        'big',
        'alpha',
        'beta',
      ]);
    });

    it('estimatedUsd is null at the repository layer for every provider', () => {
      repo.append({
        meetingId: null,
        providerId: 'claude',
        tokenIn: 1_000_000,
        tokenOut: 0,
      });
      const summary = repo.summarize();
      expect(summary.byProvider.every((p) => p.estimatedUsd === null)).toBe(
        true,
      );
    });
  });

  describe('recent', () => {
    it('returns rows newest first, bounded by limit', () => {
      for (let i = 0; i < 5; i++) {
        repo.append({
          meetingId: null,
          providerId: `p-${i}`,
          tokenIn: i,
          tokenOut: i,
        });
      }
      const list = repo.recent(3);
      expect(list).toHaveLength(3);
      expect(list[0].providerId).toBe('p-4');
      expect(list[2].providerId).toBe('p-2');
    });
  });
});
