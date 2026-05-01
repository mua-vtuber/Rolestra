/**
 * MeetingSummaryService — R10 Task 11 land, R11-Task9 capability 정식화.
 *
 * Best-effort LLM summary that the {@link MeetingOrchestrator} appends to
 * the `#회의록` message right after the deterministic minutes block. The
 * service picks the first ready provider whose capability set includes
 * `'summarize'` — R11-Task5 가 ProviderCapability union 에 literal 을
 * 추가했고, R11-Task9 가 6 provider config (Claude/Codex/Gemini/Anthropic
 * API/OpenAI API/Local Ollama) 에 capability 를 명시하면서 R10 의 임시
 * `'streaming'` fallback 우회를 제거했다.
 *
 * Failure modes are silent — every error path returns `{summary: null,
 * providerId: null}`. The caller's contract is "append paragraph if non-
 * null, otherwise leave the existing minutes intact". A broken provider
 * MUST NOT take the meeting finalisation flow down with it.
 *
 * Output is truncated to {@link MAX_OUTPUT_CHARS} so a runaway provider
 * cannot bloat the database, and capped at {@link DEFAULT_TIMEOUT_MS} via
 * an internal AbortController so a hung provider eventually unsticks.
 */
import type { BaseProvider } from '../providers/provider-interface';
import type {
  Message,
  ProviderCapability,
  ProviderInfo,
} from '../../shared/provider-types';
import {
  resolveSummaryProvider,
  type SummaryModelSettings,
} from './summary-model-resolver';
import { SKILL_CATALOG } from '../../shared/skill-catalog';

/**
 * R11-Task8: minimum-viable surface of {@link LlmCostRepository} that the
 * summary service depends on. Defined as an interface (rather than the
 * concrete class) so tests can pass a vi.fn-backed fake without
 * needing a SQLite handle.
 */
export interface LlmCostAuditSink {
  append(input: {
    meetingId: string | null;
    providerId: string;
    tokenIn: number;
    tokenOut: number;
  }): unknown;
}

/**
 * Minimal registry surface — accepting just the two methods we use lets
 * the tests pass a fake without dragging in BaseProvider's full lifecycle.
 */
export interface ProviderRegistryView {
  get(id: string): BaseProvider | undefined;
  listAll(): ProviderInfo[];
}

/**
 * The capability we gate on. R11-Task9 promoted the literal from the R10
 * temp `'streaming'` workaround to the dedicated `'summarize'` flag — every
 * production provider config (api / cli / local) now advertises it
 * explicitly so the previous "any chat-capable provider can summarise"
 * fallback chain is no longer load-bearing.
 */
const SUMMARIZE_CAPABILITY: ProviderCapability = 'summarize';

/** Hard cap on collected summary characters — avoids runaway output. */
const MAX_OUTPUT_CHARS = 4_000;

/** Default per-call deadline. Tests inject a small value. */
const DEFAULT_TIMEOUT_MS = 30_000;

/** Persona shown to the provider when generating the summary. */
const SUMMARY_PERSONA = '회의록 요약 보조';

/**
 * R12-S Task 10: 회의록 정리 시스템 prompt 는 카탈로그 (`meeting-summary`)
 * 의 systemPromptKo 본문 + user 메시지로 회의 내용 그대로 전달. 카탈로그
 * 본문은 직원 능력과 같은 형식으로 한 곳에서 관리한다.
 */
function buildPrompt(content: string): Message[] {
  const tpl = SKILL_CATALOG['meeting-summary'];
  return [
    { role: 'system', content: tpl.systemPromptKo },
    {
      role: 'user',
      content: `---\n${content}\n---`,
    },
  ];
}

export interface MeetingSummaryResult {
  /** Trimmed summary text, or `null` when no summary could be generated. */
  summary: string | null;
  /** ID of the provider that produced the summary; `null` on no-op. */
  providerId: string | null;
}

export interface MeetingSummaryServiceDeps {
  /** Provider lookup. Defined as an interface so tests pass a fake. */
  providerRegistry: ProviderRegistryView;
  /** Optional override of the default timeout (tests). */
  timeoutMs?: number;
  /**
   * R11-Task8: optional audit log sink. When provided, every successful
   * summarize call appends one row carrying the provider's reported
   * usage. Omitting it is a no-op so tests + smoke probes that don't
   * care about cost tracking keep working unchanged.
   */
  costAuditSink?: LlmCostAuditSink;
  /**
   * R12-S Task 10: 회의록 정리 모델 settings provider.
   * Function 형태 — 매 호출 시 fresh 한 settings 를 받기 위함 (사용자가
   * "자동" → "특정 모델" 토글 시 다음 회의 정리부터 즉시 반영). 미지정
   * 시 자동 선택 (기존 동작 보존: 첫 ready summarize-capable 후보).
   */
  getSummaryModelSettings?: () => SummaryModelSettings;
}

export class MeetingSummaryService {
  private readonly timeoutMs: number;

  constructor(private readonly deps: MeetingSummaryServiceDeps) {
    this.timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /**
   * Generate a paragraph summary of `content`. When `preferredProviderId`
   * is set, that provider is tried first; otherwise the registry is
   * scanned for the first ready provider with the summarize capability.
   *
   * Returns `{summary: null, providerId: null}` whenever the chain fails
   * — never throws.
   */
  async summarize(
    content: string,
    opts: {
      preferredProviderId?: string | null;
      signal?: AbortSignal;
      /**
       * R11-Task8: meeting context for the audit row. The orchestrator
       * passes its own `meeting.id` so the audit log keeps a back-link;
       * non-meeting callers (smoke / classifier) leave this null.
       */
      meetingId?: string | null;
    } = {},
  ): Promise<MeetingSummaryResult> {
    if (!content || content.trim().length === 0) {
      return { summary: null, providerId: null };
    }

    const provider = this.pickProvider(opts.preferredProviderId ?? null);
    if (provider === undefined) {
      console.warn(
        '[meeting-summary] no provider with summarize capability available',
      );
      return { summary: null, providerId: null };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();
    const onParentAbort = (): void => controller.abort();
    if (opts.signal) {
      if (opts.signal.aborted) controller.abort();
      else opts.signal.addEventListener('abort', onParentAbort, { once: true });
    }

    try {
      const messages = buildPrompt(content);
      let collected = '';
      const stream = provider.streamCompletion(
        messages,
        SUMMARY_PERSONA,
        undefined,
        controller.signal,
      );
      for await (const chunk of stream) {
        collected += chunk;
        if (collected.length >= MAX_OUTPUT_CHARS) break;
      }
      const summary = collected.trim();
      if (summary.length === 0) {
        return { summary: null, providerId: null };
      }
      this.recordUsage(provider, opts.meetingId ?? null);
      return { summary, providerId: provider.id };
    } catch (err) {
      console.warn('[meeting-summary] provider call failed', {
        providerId: provider.id,
        name: err instanceof Error ? err.name : undefined,
        message: err instanceof Error ? err.message : String(err),
      });
      return { summary: null, providerId: null };
    } finally {
      clearTimeout(timer);
      if (opts.signal) opts.signal.removeEventListener('abort', onParentAbort);
    }
  }

  /**
   * R11-Task8: append one audit row for the call we just made. The
   * provider's BaseProvider already records usage on the underlying
   * SSE stream (`api-provider.ts`) — we consume it (so the next call
   * starts clean) and only persist non-zero counts. A provider that
   * doesn't report usage (CLI providers, local stubs, malformed SSE)
   * leaves the audit log untouched rather than poisoning aggregates
   * with false zeros.
   *
   * The whole call is best-effort: a sink throw must not bubble up
   * through the summary path. Worst case we lose one row of usage —
   * the audit log is not load-bearing for the meeting flow.
   */
  private recordUsage(
    provider: BaseProvider,
    meetingId: string | null,
  ): void {
    const sink = this.deps.costAuditSink;
    if (sink === undefined) return;
    let usage: { inputTokens: number; outputTokens: number } | null = null;
    try {
      usage = provider.consumeLastTokenUsage();
    } catch (err) {
      console.warn('[meeting-summary] consumeLastTokenUsage threw', {
        providerId: provider.id,
        message: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    if (usage === null) return;
    const tokenIn = Math.max(0, usage.inputTokens | 0);
    const tokenOut = Math.max(0, usage.outputTokens | 0);
    if (tokenIn === 0 && tokenOut === 0) return;
    try {
      sink.append({
        meetingId,
        providerId: provider.id,
        tokenIn,
        tokenOut,
      });
    } catch (err) {
      console.warn('[meeting-summary] cost audit append failed', {
        providerId: provider.id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Pick the provider that should summarize this meeting.
   *
   * Priority (R12-S Task 10):
   *   1. `opts.preferredProviderId` — caller-side override (e.g. test hook
   *      or one-off summarize call). Must be ready + summarize-capable.
   *   2. `getSummaryModelSettings().summaryModelProviderId` — user-facing
   *      settings. `null` = auto, otherwise must be ready + summarize-capable
   *      (else throw — silent fallback 금지).
   *   3. Auto: `resolveSummaryProvider` 4-step chain (Haiku → Flash → other
   *      api/cli → Ollama).
   *
   * Throws when the user explicitly named a provider but it is missing,
   * not ready, or lacks summarize capability — surfacing the misconfig
   * instead of silently using a different model.
   */
  private pickProvider(preferredId: string | null): BaseProvider | undefined {
    if (preferredId !== null) {
      const preferred = this.deps.providerRegistry.get(preferredId);
      if (
        preferred !== undefined &&
        preferred.isReady() &&
        preferred.capabilities.has(SUMMARIZE_CAPABILITY)
      ) {
        return preferred;
      }
    }

    const settings = this.deps.getSummaryModelSettings?.() ?? {
      summaryModelProviderId: null,
    };
    const all = this.deps.providerRegistry.listAll();
    const target = resolveSummaryProvider(settings, all);

    if (settings.summaryModelProviderId !== null) {
      // User explicitly named a provider — fail loud on misconfig.
      if (target === null) {
        throw new Error(
          `[MeetingSummaryService] user-specified summary provider ` +
            `'${settings.summaryModelProviderId}' is not registered. ` +
            `Pick a different model in settings or revert to auto.`,
        );
      }
      if (
        target.status !== 'ready' ||
        !target.capabilities.includes(SUMMARIZE_CAPABILITY)
      ) {
        throw new Error(
          `[MeetingSummaryService] user-specified summary provider ` +
            `'${target.id}' is ${target.status} or lacks 'summarize' ` +
            `capability. Pick a different model in settings.`,
        );
      }
    }

    if (target === null) return undefined;
    return this.deps.providerRegistry.get(target.id);
  }
}
