/**
 * SSE (Server-Sent Events) mock utilities for provider integration tests.
 *
 * Provides helpers to create mock ReadableStream<Uint8Array> from SSE lines,
 * mock Response objects, and format-specific SSE data line generators
 * for OpenAI, Anthropic, and Google streaming formats.
 */

/** Encode SSE lines into a ReadableStream<Uint8Array>. */
export function sseStream(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const chunks = lines.map(line => encoder.encode(line + '\n'));
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(chunks[index++]);
      } else {
        controller.close();
      }
    },
  });
}

/** Build a mock Response with SSE body. */
export function mockSSEResponse(lines: string[], status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'text/event-stream' }),
    body: sseStream(lines),
    text: async () => lines.join('\n'),
  } as unknown as Response;
}

/** Collect all yielded tokens from an async generator into an array. */
export async function collectTokens(gen: AsyncGenerator<string>): Promise<string[]> {
  const tokens: string[] = [];
  for await (const token of gen) {
    tokens.push(token);
  }
  return tokens;
}

// ── OpenAI format ─────────────────────────────────────────────────────

/** Generate OpenAI-format SSE data lines for streaming tokens. */
export function openAiTokenLines(
  content: string[],
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number },
): string[] {
  const lines: string[] = [];

  // Role chunk
  lines.push('data: {"choices":[{"delta":{"role":"assistant"}}]}');

  // Content chunks
  for (const token of content) {
    lines.push(`data: {"choices":[{"delta":{"content":${JSON.stringify(token)}}}]}`);
  }

  // Usage chunk (if provided)
  if (usage) {
    lines.push(`data: {"choices":[],"usage":${JSON.stringify(usage)}}`);
  }

  lines.push('data: [DONE]');
  return lines;
}

// ── Anthropic format ──────────────────────────────────────────────────

/** Generate Anthropic-format SSE event lines for streaming tokens. */
export function anthropicTokenLines(
  content: string[],
  usage?: { input_tokens: number; output_tokens: number },
): string[] {
  const lines: string[] = [];
  const inputTokens = usage?.input_tokens ?? 0;
  const outputTokens = usage?.output_tokens ?? 0;

  lines.push(
    `data: {"type":"message_start","message":{"usage":{"input_tokens":${inputTokens},"output_tokens":0}}}`,
  );
  lines.push('data: {"type":"content_block_start","content_block":{"type":"text"}}');

  for (const token of content) {
    lines.push(`data: {"type":"content_block_delta","delta":{"text":${JSON.stringify(token)}}}`);
  }

  lines.push(`data: {"type":"message_delta","usage":{"output_tokens":${outputTokens}}}`);
  lines.push('data: {"type":"message_stop"}');
  return lines;
}

// ── Google format ─────────────────────────────────────────────────────

/** Generate Google-format SSE data lines for streaming tokens. */
export function googleTokenLines(
  content: string[],
  usage?: { promptTokenCount: number; candidatesTokenCount: number; totalTokenCount: number },
): string[] {
  const lines: string[] = [];

  for (let i = 0; i < content.length; i++) {
    const isLast = i === content.length - 1;
    let data: Record<string, unknown> = {
      candidates: [{ content: { parts: [{ text: content[i] }] } }],
    };

    // Attach usage metadata to the last chunk
    if (isLast && usage) {
      data = { ...data, usageMetadata: usage };
    }

    lines.push(`data: ${JSON.stringify(data)}`);
  }

  return lines;
}
