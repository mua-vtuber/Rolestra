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
});

export const openAiChunkSchema = z.object({
  choices: z.array(openAiChoiceSchema).optional(),
  usage: openAiUsageSchema.optional(),
});

export type OpenAiChunk = z.infer<typeof openAiChunkSchema>;

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

const googleUsageSchema = z.object({
  promptTokenCount: z.number(),
  candidatesTokenCount: z.number(),
  totalTokenCount: z.number(),
});

const googlePartSchema = z.object({
  text: z.string().optional(),
});

const googleContentSchema = z.object({
  parts: z.array(googlePartSchema).optional(),
});

const googleCandidateSchema = z.object({
  content: googleContentSchema.optional(),
});

export const googleChunkSchema = z.object({
  candidates: z.array(googleCandidateSchema).optional(),
  usageMetadata: googleUsageSchema.optional(),
});

export type GoogleChunk = z.infer<typeof googleChunkSchema>;
