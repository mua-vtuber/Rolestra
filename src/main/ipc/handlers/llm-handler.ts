/**
 * llm-handler — R11-Task8.
 *
 * Wires the `llm:cost-summary` IPC channel declared in
 * `src/shared/ipc-types.ts` (R11-Task5 land) to the
 * {@link LlmCostService} singleton. The handler is intentionally a
 * one-liner around the service; the service owns the pricing math
 * (D5: USD = user-supplied unit price × tokens) so the IPC layer can
 * stay shape-only.
 *
 * Service injection follows the lazy-accessor pattern used everywhere
 * else in the IPC layer (see `onboarding-handler.ts` /
 * `notification-handler.ts`): `setLlmCostServiceAccessor` is called
 * once during boot in `main/index.ts`, the handler then resolves via
 * `getService()` so unit tests can swap a stub without re-wiring the
 * router.
 */

import type { LlmCostSummary } from '../../../shared/llm-cost-types';
import type { LlmCostService } from '../../llm/llm-cost-service';

let llmCostServiceAccessor: (() => LlmCostService) | null = null;

export function setLlmCostServiceAccessor(
  accessor: (() => LlmCostService) | null,
): void {
  llmCostServiceAccessor = accessor;
}

function getService(): LlmCostService {
  if (!llmCostServiceAccessor) {
    throw new Error('llm handler: cost service not initialized');
  }
  return llmCostServiceAccessor();
}

/**
 * R11-Task8: rolling-window aggregate of recent LLM usage. The zod
 * schema (`llmCostSummarySchema`) caps `periodDays` at 365 so the
 * Settings UI can't ask for a sub-pathological window; missing means
 * "use the service default" (R11 default = 30 days, see
 * `llm-cost-repository.DEFAULT_PERIOD_DAYS`).
 */
export function handleLlmCostSummary(
  input: { periodDays?: number } | undefined,
): { summary: LlmCostSummary } {
  const periodDays = input?.periodDays;
  return { summary: getService().summary({ periodDays }) };
}
