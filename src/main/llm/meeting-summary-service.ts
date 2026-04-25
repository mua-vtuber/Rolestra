/**
 * MeetingSummaryService — R10 Task 11.
 *
 * Best-effort LLM summary that the {@link MeetingOrchestrator} appends to
 * the `#회의록` message right after the deterministic minutes block. The
 * service picks the first ready provider whose capability set includes
 * `streaming` (the union of providers that can answer a free-form prompt
 * — the v3 capability shape does not yet have a dedicated `summarize`
 * flag, and gating on `streaming` matches the deferred D7 decision in the
 * R10 plan: "any provider that can chat can summarize").
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

/**
 * Minimal registry surface — accepting just the two methods we use lets
 * the tests pass a fake without dragging in BaseProvider's full lifecycle.
 */
export interface ProviderRegistryView {
  get(id: string): BaseProvider | undefined;
  listAll(): ProviderInfo[];
}

/**
 * The capability we gate on. v3 lacks a dedicated `summarize` flag — any
 * provider that supports streaming can answer the summarise prompt below.
 * If a future capability literal is added, swap the check here.
 */
const SUMMARIZE_CAPABILITY: ProviderCapability = 'streaming';

/** Hard cap on collected summary characters — avoids runaway output. */
const MAX_OUTPUT_CHARS = 4_000;

/** Default per-call deadline. Tests inject a small value. */
const DEFAULT_TIMEOUT_MS = 30_000;

/** Persona shown to the provider when generating the summary. */
const SUMMARY_PERSONA = '회의록 요약 보조';

/** Korean prompt — matches the R10 messenger language default. */
function buildPrompt(content: string): Message[] {
  return [
    {
      role: 'user',
      content:
        '다음 회의 내용을 한국어로 한 단락(2~4 문장) 으로 간결하게 요약해라. ' +
        '메타 코멘트나 머리말 없이 요약 본문만 출력해라.\n\n' +
        '---\n' +
        content +
        '\n---',
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
    opts: { preferredProviderId?: string | null; signal?: AbortSignal } = {},
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
   * Pick the first provider that can summarize. Preferred id wins when
   * supplied AND ready AND has the capability; otherwise the registry is
   * iterated in registration order.
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
    for (const info of this.deps.providerRegistry.listAll()) {
      if (info.status !== 'ready') continue;
      if (!info.capabilities.includes(SUMMARIZE_CAPABILITY)) continue;
      const p = this.deps.providerRegistry.get(info.id);
      if (p !== undefined) return p;
    }
    return undefined;
  }
}
