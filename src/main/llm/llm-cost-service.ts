/**
 * LlmCostService — R11-Task8 (Decision D5).
 *
 * Thin policy layer on top of {@link LlmCostRepository} that fills in the
 * `estimatedUsd` column on the {@link LlmCostSummary} response. The
 * repository owns the SQL aggregation; this service owns the user-
 * supplied unit-price multiplication so the IPC handler stays a one-
 * liner that does not reach into config layers itself.
 *
 * Decision D5 (R11 plan §Decision Log) — USD estimation is always
 * user-input (no auto-fetch from provider price tables). The unit price
 * lives in `SettingsConfig.llmCostUsdPerMillionTokens` keyed by
 * provider id; entries default to 0 (the empty record) so a provider
 * that the user has never priced surfaces `estimatedUsd: null`. We use
 * "USD per 1,000,000 tokens" as the unit because that matches the
 * pricing tables every major provider publishes (e.g. Anthropic
 * `$3 / MTok`, OpenAI `$2.50 / 1M tokens`) so users can copy a number
 * directly from the provider docs.
 */

import type { LlmCostSummary } from '../../shared/llm-cost-types';
import type {
  LlmCostRepository,
  LlmCostSummarizeOptions,
} from './llm-cost-repository';

/** Map of providerId → USD per million tokens. */
export type LlmPriceMap = Readonly<Record<string, number>>;

export interface LlmCostServiceDeps {
  repository: LlmCostRepository;
  /**
   * Resolves the current per-provider unit price map. Read on every
   * `summary()` call so a Settings update is reflected without service
   * restart. Returning an empty record is fine — every estimatedUsd
   * will be null.
   */
  getPriceMap: () => LlmPriceMap;
}

const TOKENS_PER_MILLION = 1_000_000;

export class LlmCostService {
  constructor(private readonly deps: LlmCostServiceDeps) {}

  /**
   * Returns the rolling-window summary with `estimatedUsd` populated for
   * every provider whose unit price is a positive finite number. A
   * provider with no entry, a 0 entry, or a non-finite entry leaves
   * `estimatedUsd` as null so the renderer can render "단가 미설정".
   */
  summary(opts: LlmCostSummarizeOptions = {}): LlmCostSummary {
    const raw = this.deps.repository.summarize(opts);
    const priceMap = this.deps.getPriceMap();
    const byProvider = raw.byProvider.map((row) => ({
      ...row,
      estimatedUsd: estimateUsd(
        row.tokenIn + row.tokenOut,
        priceMap[row.providerId],
      ),
    }));
    return { ...raw, byProvider };
  }
}

/**
 * Multiply tokens by unit price. Returns null when the price is missing,
 * zero, negative, or non-finite — those all map to "no estimate" in the
 * UI rather than `0` so the user can distinguish "no spend" from
 * "haven't priced this provider".
 */
function estimateUsd(
  totalTokens: number,
  pricePerMillion: number | undefined,
): number | null {
  if (
    typeof pricePerMillion !== 'number' ||
    !Number.isFinite(pricePerMillion) ||
    pricePerMillion <= 0
  ) {
    return null;
  }
  return (totalTokens / TOKENS_PER_MILLION) * pricePerMillion;
}
