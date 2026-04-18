/**
 * CLI prompt builder — constructs prompts and payloads for CLI input.
 *
 * Handles three input formats:
 * - stdin-json: structured JSON protocol (Claude CLI)
 * - pipe: formatted text with section markers (Gemini, Codex)
 * - args: prompt as CLI argument
 *
 * Extracted from CliProvider to isolate prompt construction logic.
 */

import type { Message, CompletionOptions } from '../../../shared/provider-types';
import type { CliRuntimeConfig } from './cli-provider';

export class CliPromptBuilder {
  /** Build the argument list for a per-turn invocation. */
  buildArgs(
    messages: Message[],
    _persona: string,
    _options: CompletionOptions | undefined,
    config: CliRuntimeConfig,
    sessionId: string | null,
  ): string[] {
    const baseArgs = [...config.args];

    // Add session ID for per-turn resume
    if (sessionId) {
      // Custom resume arg builder (e.g., Codex uses subcommand: exec resume <id>)
      if (config.buildResumeArgs) {
        return config.buildResumeArgs(sessionId, baseArgs);
      }
      // Flag-based resume (e.g., gemini --resume <id>)
      if (config.sessionIdFlag) {
        baseArgs.push(config.sessionIdFlag, sessionId);
      }
    }

    if (config.inputFormat === 'args') {
      // Extract the last user message content as the prompt argument
      const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
      if (lastUserMsg) {
        const content = typeof lastUserMsg.content === 'string'
          ? lastUserMsg.content
          : lastUserMsg.content
              .map(block => (block.type === 'text' ? String(block.data) : ''))
              .join('');
        baseArgs.push(content);
      }
    }

    return baseArgs;
  }

  /** Build stdin payload for stdin-json or pipe input formats. */
  buildStdinPayload(
    messages: Message[],
    persona: string,
    _options: CompletionOptions | undefined,
    config: CliRuntimeConfig,
    sessionId: string | null,
  ): string {
    if (config.inputFormat === 'pipe') {
      // With active session: send only the latest user message (CLI maintains context)
      if (config.sessionIdFlag && sessionId && messages.length > 0) {
        const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
        if (lastUserMsg) {
          return typeof lastUserMsg.content === 'string'
            ? lastUserMsg.content
            : lastUserMsg.content
                .map(b => (b.type === 'text' ? String(b.data) : ''))
                .join('');
        }
      }
      return this.buildPipePrompt(messages, persona);
    }

    return JSON.stringify({
      system: persona,
      messages: messages.map(m => ({
        role: m.role,
        content: m.content,
      })),
    });
  }

  /** Build a text-formatted prompt (System/User/Assistant roles). */
  buildTextPrompt(messages: Message[], persona: string): string {
    const parts: string[] = [];

    if (persona.trim()) {
      parts.push(
        '<<INSTRUCTIONS>>\n' +
        persona.trim() + '\n' +
        '<</INSTRUCTIONS>>',
      );
    }

    const historyLines: string[] = [];
    for (const msg of messages) {
      const role = msg.role[0].toUpperCase() + msg.role.slice(1);
      const label = (msg.role === 'assistant' && msg.name) ? msg.name : role;
      const text = typeof msg.content === 'string'
        ? msg.content
        : msg.content
            .map(block => (block.type === 'text' ? String(block.data) : ''))
            .join('\n');
      historyLines.push(`${label}: ${text}`);
    }

    if (historyLines.length > 0) {
      parts.push(
        '<<CONVERSATION>>\n' +
        historyLines.join('\n\n') + '\n' +
        '<</CONVERSATION>>',
      );
    }

    return parts.join('\n\n');
  }

  /**
   * Build a clean prompt for pipe-format CLIs (first turn, no session).
   *
   * Uses clear section markers so the model distinguishes between
   * instructions, conversation history, and the response boundary.
   * This prevents pipe-based CLIs (e.g., Gemini) from echoing the
   * entire prompt back verbatim.
   */
  buildPipePrompt(messages: Message[], persona: string): string {
    const prompt = this.buildTextPrompt(messages, persona);
    return (
      prompt +
      '\n\nRespond now. Do NOT repeat or echo any text from INSTRUCTIONS or CONVERSATION above.\n\n[[[START_OF_RESPONSE]]]\nAssistant:'
    );
  }

  /**
   * Build a JSON payload for persistent stdin-json protocol.
   *
   * With session: send only the latest user message (CLI maintains context).
   * Without session (first turn): send full history as formatted prompt.
   */
  buildPersistentJsonPayload(
    messages: Message[],
    persona: string,
    sessionId: string | null,
  ): string {
    if (sessionId && messages.length > 0) {
      // ... (기존 로직 동일)
      const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
      if (lastUserMsg) {
        const content = typeof lastUserMsg.content === 'string'
          ? lastUserMsg.content
          : lastUserMsg.content
              .map(b => (b.type === 'text' ? String(b.data) : ''))
              .join('');
        return JSON.stringify({
          type: 'user',
          message: { role: 'user', content },
        });
      }
    }

    // First turn — send full history as formatted prompt
    const prompt = this.buildTextPrompt(messages, persona);
    const finalPrompt =
      prompt +
      '\n\nRespond now. Do NOT repeat or echo any text from the history above.\n\n[[[START_OF_RESPONSE]]]\nAssistant:';

    return JSON.stringify({
      type: 'user',
      message: { role: 'user', content: finalPrompt },
    });
  }
}
