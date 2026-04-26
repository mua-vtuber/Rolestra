/**
 * LlmCostService — R11-Task8 (D5).
 *
 * Coverage:
 * - estimatedUsd null when price map is empty.
 * - estimatedUsd null when price <= 0.
 * - estimatedUsd null when price is non-finite (NaN / Infinity).
 * - estimatedUsd computed when price > 0 (USD per 1M × tokens).
 * - getPriceMap is read on every call (Settings update reflected).
 */

import { describe, expect, it, vi } from 'vitest';
import type { LlmCostSummary } from '../../../shared/llm-cost-types';
import type { LlmCostRepository } from '../llm-cost-repository';
import { LlmCostService, type LlmPriceMap } from '../llm-cost-service';

function fakeRepo(summary: LlmCostSummary): LlmCostRepository {
  return {
    summarize: vi.fn().mockReturnValue(summary),
  } as unknown as LlmCostRepository;
}

const baseSummary: LlmCostSummary = {
  byProvider: [
    {
      providerId: 'claude',
      tokenIn: 700_000,
      tokenOut: 300_000,
      estimatedUsd: null,
    },
    {
      providerId: 'gpt-5',
      tokenIn: 0,
      tokenOut: 0,
      estimatedUsd: null,
    },
  ],
  totalTokens: 1_000_000,
  periodStartAt: 0,
  periodEndAt: 1_000,
};

describe('LlmCostService (R11-Task8)', () => {
  it('leaves estimatedUsd null when the price map is empty', () => {
    const svc = new LlmCostService({
      repository: fakeRepo(baseSummary),
      getPriceMap: () => ({}),
    });
    const result = svc.summary();
    expect(result.byProvider.every((p) => p.estimatedUsd === null)).toBe(true);
  });

  it('leaves estimatedUsd null when the unit price is 0', () => {
    const priceMap: LlmPriceMap = { claude: 0 };
    const svc = new LlmCostService({
      repository: fakeRepo(baseSummary),
      getPriceMap: () => priceMap,
    });
    const result = svc.summary();
    const claude = result.byProvider.find((p) => p.providerId === 'claude');
    expect(claude?.estimatedUsd).toBeNull();
  });

  it('leaves estimatedUsd null when the unit price is non-finite', () => {
    const priceMap: LlmPriceMap = {
      claude: Number.NaN,
      'gpt-5': Number.POSITIVE_INFINITY,
    };
    const svc = new LlmCostService({
      repository: fakeRepo(baseSummary),
      getPriceMap: () => priceMap,
    });
    const result = svc.summary();
    expect(result.byProvider.every((p) => p.estimatedUsd === null)).toBe(true);
  });

  it('computes estimatedUsd as (totalTokens / 1M) × price for positive prices', () => {
    const priceMap: LlmPriceMap = { claude: 3, 'gpt-5': 2.5 };
    const svc = new LlmCostService({
      repository: fakeRepo(baseSummary),
      getPriceMap: () => priceMap,
    });
    const result = svc.summary();
    const claude = result.byProvider.find((p) => p.providerId === 'claude');
    const gpt = result.byProvider.find((p) => p.providerId === 'gpt-5');
    // claude has 1M tokens × $3 / M = $3.00
    expect(claude?.estimatedUsd).toBe(3);
    // gpt-5 has 0 tokens × $2.5 / M = $0.00
    expect(gpt?.estimatedUsd).toBe(0);
  });

  it('reads getPriceMap on every call so Settings updates are reflected', () => {
    let priceMap: LlmPriceMap = {};
    const repo = fakeRepo(baseSummary);
    const svc = new LlmCostService({
      repository: repo,
      getPriceMap: () => priceMap,
    });
    expect(svc.summary().byProvider[0].estimatedUsd).toBeNull();
    priceMap = { claude: 5 };
    const next = svc.summary();
    const claude = next.byProvider.find((p) => p.providerId === 'claude');
    expect(claude?.estimatedUsd).toBe(5);
  });

  it('forwards periodDays through to the repository', () => {
    const repo = fakeRepo(baseSummary);
    const summarizeSpy = repo.summarize as unknown as ReturnType<typeof vi.fn>;
    const svc = new LlmCostService({
      repository: repo,
      getPriceMap: () => ({}),
    });
    svc.summary({ periodDays: 7 });
    expect(summarizeSpy).toHaveBeenCalledWith({ periodDays: 7 });
  });
});
