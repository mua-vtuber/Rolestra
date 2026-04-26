/**
 * LlmCostRepository — R11-Task8 (Decision D4 + D5).
 *
 * Append-only access layer over the `llm_cost_audit_log` table created
 * by migration 014. The repository's only writer is `append`; all
 * reads are aggregations that the Settings "LLM 사용량" card and the
 * `llm:cost-summary` IPC use to render usage without re-walking
 * provider logs.
 *
 * Design (matches the migration header comment):
 * - The repository never updates or deletes — append + aggregate only.
 *   Older rows roll out of the Settings 30-day window naturally; an
 *   eventual GC task can prune by `created_at` without coordination
 *   with this layer.
 * - `summarize({periodDays?})` returns a fully-formed
 *   {@link LlmCostSummary} with `byProvider` aggregates ordered by
 *   total tokens descending so the renderer can list "noisy" providers
 *   first. `estimatedUsd` is always null at this layer — the upstream
 *   {@link LlmCostService} multiplies in the per-provider unit price
 *   from settings (D5: USD estimation is user-supplied, never auto-
 *   fetched).
 * - All times are millisecond Date.now(). The optional `now` injection
 *   exists so unit tests can pin the period boundary without monkey-
 *   patching `Date`.
 *
 * SQL note: the aggregate uses `SUM(token_in)` / `SUM(token_out)` and
 * groups on `provider_id`. better-sqlite3 returns `null` for SUM over
 * an empty group, but the WHERE-clause predicate filters by period so
 * an empty group is never selected — the COALESCE guard is defence-in-
 * depth so a row with `token_in=0 AND token_out=0` (which we already
 * skip in {@link MeetingSummaryService}) never surfaces a NaN.
 */

import type Database from 'better-sqlite3';
import type {
  LlmCostAuditEntry,
  LlmCostSummary,
} from '../../shared/llm-cost-types';

/** Default rolling window for the Settings card. R11-Task8 decision. */
export const DEFAULT_PERIOD_DAYS = 30;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface LlmCostAppendInput {
  meetingId: string | null;
  providerId: string;
  tokenIn: number;
  tokenOut: number;
}

export interface LlmCostSummarizeOptions {
  /** Rolling window length in days. Defaults to {@link DEFAULT_PERIOD_DAYS}. */
  periodDays?: number;
  /** Optional clock injection for tests. */
  now?: () => number;
}

interface ProviderAggregateRow {
  provider_id: string;
  token_in: number;
  token_out: number;
}

interface AuditRow {
  id: number;
  meeting_id: string | null;
  provider_id: string;
  token_in: number;
  token_out: number;
  created_at: number;
}

export class LlmCostRepository {
  constructor(private readonly db: Database.Database) {}

  /**
   * Insert a single audit row. Returns the auto-incremented id so the
   * caller can correlate (e.g. the meeting orchestrator could log the
   * id alongside the minutes — not used in R11 but cheap to expose).
   *
   * Rows where both token counts are zero are still accepted so the
   * caller decides the policy. {@link MeetingSummaryService} skips the
   * append when usage is unavailable so the audit log stays meaningful.
   */
  append(input: LlmCostAppendInput): LlmCostAuditEntry {
    const createdAt = Date.now();
    const result = this.db
      .prepare(
        `INSERT INTO llm_cost_audit_log
          (meeting_id, provider_id, token_in, token_out, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        input.meetingId,
        input.providerId,
        input.tokenIn,
        input.tokenOut,
        createdAt,
      );
    return {
      id: Number(result.lastInsertRowid),
      meetingId: input.meetingId,
      providerId: input.providerId,
      tokenIn: input.tokenIn,
      tokenOut: input.tokenOut,
      createdAt,
    };
  }

  /**
   * Aggregate rows over a rolling window. Returns provider-level sums
   * sorted by total tokens descending plus the overall total. The
   * `estimatedUsd` field is always null here; {@link LlmCostService}
   * fills it in based on the user-supplied per-provider unit price.
   */
  summarize(opts: LlmCostSummarizeOptions = {}): LlmCostSummary {
    const periodDays = opts.periodDays ?? DEFAULT_PERIOD_DAYS;
    const now = (opts.now ?? Date.now)();
    const periodEndAt = now;
    const periodStartAt = now - periodDays * MS_PER_DAY;

    const rows = this.db
      .prepare(
        `SELECT
            provider_id,
            COALESCE(SUM(token_in), 0)  AS token_in,
            COALESCE(SUM(token_out), 0) AS token_out
          FROM llm_cost_audit_log
          WHERE created_at >= ? AND created_at <= ?
          GROUP BY provider_id`,
      )
      .all(periodStartAt, periodEndAt) as ProviderAggregateRow[];

    const byProvider = rows
      .map((row) => ({
        providerId: row.provider_id,
        tokenIn: row.token_in,
        tokenOut: row.token_out,
        estimatedUsd: null as number | null,
      }))
      .sort(
        (a, b) =>
          b.tokenIn + b.tokenOut - (a.tokenIn + a.tokenOut) ||
          a.providerId.localeCompare(b.providerId),
      );

    const totalTokens = byProvider.reduce(
      (acc, p) => acc + p.tokenIn + p.tokenOut,
      0,
    );

    return {
      byProvider,
      totalTokens,
      periodStartAt,
      periodEndAt,
    };
  }

  /**
   * Read the most recent N rows, newest first. Used by tests + a
   * potential future "최근 호출" drilldown. Bounded by `limit` so a
   * pathological table size cannot stall the renderer.
   */
  recent(limit = 50): LlmCostAuditEntry[] {
    const rows = this.db
      .prepare(
        `SELECT id, meeting_id, provider_id, token_in, token_out, created_at
           FROM llm_cost_audit_log
          ORDER BY id DESC
          LIMIT ?`,
      )
      .all(Math.max(1, Math.min(500, limit))) as AuditRow[];
    return rows.map((row) => ({
      id: row.id,
      meetingId: row.meeting_id,
      providerId: row.provider_id,
      tokenIn: row.token_in,
      tokenOut: row.token_out,
      createdAt: row.created_at,
    }));
  }
}
