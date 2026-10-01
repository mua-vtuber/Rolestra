/**
 * Zod schemas for SSE response parsing across API providers.
 *
 * Replaces unsafe `as Record<string, unknown>` casts with
 * validated, type-safe parsing for each API format.
 */

import { z } from 'zod';

// ── OpenAI Chat Completions ─────────────────────────────────

const openAiUsageSchema = z.object({
  prompt_tokens: z.number(),
  completion_tokens: z.number(),
  total_tokens: z.number(),
});

const openAiDeltaSchema = z.object({
  content: z.string().optional(),
});

const openAiChoiceSchema = z.object({
  delta: openAiDeltaSchema.optional(),
  /** Non-null on the terminal chunk for that choice — e.g. 'stop', 'length'. */
  finish_reason: z.string().nullish(),
});

export const openAiChunkSchema = z.object({
  choices: z.array(openAiChoiceSchema).optional(),
  usage: openAiUsageSchema.optional(),
});

export type OpenAiChunk = z.infer<typeof openAiChunkSchema>;

// ── OpenAI Responses API ────────────────────────────────────

const responseUsageSchema = z.object({
  input_tokens: z.number(),
  output_tokens: z.number(),
  total_tokens: z.number(),
});

export const openAiResponseEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('response.output_text.delta'), delta: z.string() }),
  z.object({ type: z.literal('response.completed'), response: z.object({
    usage: responseUsageSchema.nullish(),
  }) }),
  z.object({ type: z.literal('response.failed'), response: z.object({
    error: z.object({ message: z.string() }).nullish(),
  }) }),
  z.object({ type: z.literal('response.incomplete'), response: z.object({
    incomplete_details: z.object({ reason: z.string() }).nullish(),
  }) }),
  z.object({ type: z.literal('error'), message: z.string() }),
]);

// ── Anthropic Messages API ──────────────────────────────────

const anthropicMessageUsageSchema = z.object({
  input_tokens: z.number(),
  output_tokens: z.number().optional(),
});

const anthropicDeltaUsageSchema = z.object({
  output_tokens: z.number(),
});

const anthropicContentDeltaSchema = z.object({
  text: z.string().optional(),
});

const anthropicMessageStartSchema = z.object({
  type: z.literal('message_start'),
  message: z.object({
    usage: anthropicMessageUsageSchema.optional(),
  }).optional(),
});

const anthropicMessageDeltaSchema = z.object({
  type: z.literal('message_delta'),
  usage: anthropicDeltaUsageSchema.optional(),
});

const anthropicContentBlockDeltaSchema = z.object({
  type: z.literal('content_block_delta'),
  delta: anthropicContentDeltaSchema.optional(),
});

export const anthropicEventSchema = z.discriminatedUnion('type', [
  anthropicMessageStartSchema,
  anthropicMessageDeltaSchema,
  anthropicContentBlockDeltaSchema,
  // Catch-all for other event types we don't process
  z.object({ type: z.literal('message_stop') }),
  z.object({ type: z.literal('content_block_start') }),
  z.object({ type: z.literal('content_block_stop') }),
  z.object({ type: z.literal('ping') }),
]);

export type AnthropicEvent = z.infer<typeof anthropicEventSchema>;

// ── Google AI (Gemini) ──────────────────────────────────────

/**
 * Google's JSON encoding is proto3 JSON, which OMITS a field entirely when
 * its value equals the field type's zero value (`0` for an integer count).
 * A chunk that has produced zero candidate tokens so far therefore has no
 * `candidatesTokenCount` key at all — every count here is optional so that
 * chunk still validates instead of being dropped whole by `safeParse`.
 */
const googleUsageSchema = z.object({
  promptTokenCount: z.number().optional(),
  candidatesTokenCount: z.number().optional(),
  totalTokenCount: z.number().optional(),
  thoughtsTokenCount: z.number().optional(),
});

const googlePartSchema = z.object({
  text: z.string().optional(),
  /** True for a "thinking" part — never part of the model's visible output. */
  thought: z.boolean().optional(),
});

const googleContentSchema = z.object({
  parts: z.array(googlePartSchema).optional(),
});

const googleCandidateSchema = z.object({
  content: googleContentSchema.optional(),
  /** Present on the terminal candidate — e.g. 'STOP', 'MAX_TOKENS'. */
  finishReason: z.string().optional(),
});

/** Present instead of `candidates` when the PROMPT itself was blocked. */
const googlePromptFeedbackSchema = z.object({
  blockReason: z.string().optional(),
});

export const googleChunkSchema = z.object({
  candidates: z.array(googleCandidateSchema).optional(),
  usageMetadata: googleUsageSchema.optional(),
  promptFeedback: googlePromptFeedbackSchema.optional(),
});

export type GoogleChunk = z.infer<typeof googleChunkSchema>;
