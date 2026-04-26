/**
 * Unit tests for the llm-handler module (R11-Task8).
 *
 * Coverage:
 *   1. handleLlmCostSummary delegates to LlmCostService.summary().
 *   2. forwards periodDays input through.
 *   3. uses service default (undefined periodDays) when input omitted.
 *   4. throws "service not initialized" when the accessor is null.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  handleLlmCostSummary,
  setLlmCostServiceAccessor,
} from '../llm-handler';
import type { LlmCostService } from '../../../llm/llm-cost-service';
import type { LlmCostSummary } from '../../../../shared/llm-cost-types';

const baseSummary: LlmCostSummary = {
  byProvider: [
    {
      providerId: 'claude',
      tokenIn: 100,
      tokenOut: 50,
      estimatedUsd: null,
    },
  ],
  totalTokens: 150,
  periodStartAt: 1_000_000,
  periodEndAt: 2_000_000,
};

function buildService(): {
  summary: ReturnType<typeof vi.fn>;
} {
  return {
    summary: vi.fn(() => baseSummary),
  };
}

afterEach(() => {
  setLlmCostServiceAccessor(null);
});

describe('handleLlmCostSummary (R11-Task8)', () => {
  it('returns the service summary verbatim when input is undefined', () => {
    const svc = buildService();
    setLlmCostServiceAccessor(() => svc as unknown as LlmCostService);
    const out = handleLlmCostSummary(undefined);
    expect(out).toEqual({ summary: baseSummary });
    expect(svc.summary).toHaveBeenCalledWith({ periodDays: undefined });
  });

  it('forwards explicit periodDays to the service', () => {
    const svc = buildService();
    setLlmCostServiceAccessor(() => svc as unknown as LlmCostService);
    handleLlmCostSummary({ periodDays: 7 });
    expect(svc.summary).toHaveBeenCalledWith({ periodDays: 7 });
  });

  it('omits periodDays when the field is missing on the input object', () => {
    const svc = buildService();
    setLlmCostServiceAccessor(() => svc as unknown as LlmCostService);
    handleLlmCostSummary({});
    expect(svc.summary).toHaveBeenCalledWith({ periodDays: undefined });
  });

  it('throws when the service accessor was not initialized', () => {
    setLlmCostServiceAccessor(null);
    expect(() => handleLlmCostSummary(undefined)).toThrow(
      /cost service not initialized/,
    );
  });
});
