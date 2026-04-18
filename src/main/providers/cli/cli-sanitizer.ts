/**
 * CLI output sanitizer — strips prompt-echo artifacts from streaming output.
 *
 * Some CLI tools (notably Gemini in pipe mode) echo back the prompt
 * including <<INSTRUCTIONS>> and <<CONVERSATION>> markers. This class
 * uses a state machine to detect opening markers and suppress all output
 * until the corresponding closing marker is found, regardless of buffer size.
 */

import type { CliRuntimeConfig } from './cli-provider';

/** Length of the longest opening marker ('<<INSTRUCTIONS>>' = 16). */
const MARKER_MAX_LEN = 16;
/**
 * Normal-state holdback size. Must be >= length of the anti-echo
 * instruction line (~85 chars) so it stays in the buffer for
 * cleanup on finalize.
 */
const NORMAL_HOLDBACK = 100;

export class CliSanitizer {
  private enabled = false;
  private state: 'prefix' | 'normal' | 'suppressing' = 'prefix';
  private buffer = '';

  /** Check whether sanitization should be active for the given config. */
  shouldEnable(config: CliRuntimeConfig): boolean {
    // Normalize the command to handle full paths (e.g., C:\...\gemini.cmd → gemini)
    const base = config.command.replace(/\\/g, '/').split('/').pop() ?? config.command;
    const normalized = base.toLowerCase().replace(/\.(cmd|exe|bat)$/i, '');
    return normalized === 'gemini' && config.inputFormat === 'pipe';
  }

  /**
   * Activate sanitization for a new response.
   *
   * @param sessionId - Current session ID. When set alongside sessionIdFlag,
   *   we are in session mode: only the last user message is sent (no full prompt,
   *   no [[[START_OF_RESPONSE]]] marker). In that case sanitization is skipped
   *   because Gemini does not echo in session mode.
   */
  enable(config: CliRuntimeConfig, sessionId?: string | null): void {
    const isSessionMode = !!(config.sessionIdFlag && sessionId);
    this.enabled = !isSessionMode && this.shouldEnable(config);
    this.state = 'prefix';
    this.buffer = '';
  }

  /** Reset sanitization state between turns. */
  reset(): void {
    this.enabled = false;
    this.state = 'prefix';
    this.buffer = '';
  }

  /**
   * Process a token through the sanitizer.
   *
   * @param token - The raw token to sanitize.
   * @param finalize - If true, flush the holdback buffer (end of response).
   * @returns Sanitized text to emit (may be empty if held back).
   */
  sanitize(token: string, finalize = false): string {
    if (!this.enabled) return token;

    this.buffer += token;
    let output = '';

    // Process buffer through state machine
    while (this.buffer.length > 0) {
      if (this.state === 'prefix') {
        // Look for our specific marker that signals the end of the prompt echo
        const marker = '[[[START_OF_RESPONSE]]]';
        const markerIdx = this.buffer.indexOf(marker);

        if (markerIdx >= 0) {
          // Found marker — discard everything including the marker and the Assistant: line
          const searchAfter = this.buffer.slice(markerIdx + marker.length);
          const assistantIdx = searchAfter.indexOf('Assistant:');
          
          if (assistantIdx >= 0) {
            this.buffer = searchAfter.slice(assistantIdx + 'Assistant:'.length);
            this.state = 'normal';
            continue;
          } else if (searchAfter.length > 20) {
            // If Assistant: is missing but we've got enough text, start from first JSON or content
            const contentIdx = this.findContentStart(searchAfter);
            if (contentIdx >= 0) {
              this.buffer = searchAfter.slice(contentIdx);
              this.state = 'normal';
              continue;
            }
          }
        }

        if (finalize) {
          this.buffer = '';
        }
        // Discard prefix until marker found
        break;
      } else if (this.state === 'normal') {
        const openIdx = this.findOpenMarker(this.buffer);
        if (openIdx >= 0) {
          // Emit text before marker, enter suppressing
          output += this.buffer.slice(0, openIdx);
          this.buffer = this.buffer.slice(openIdx);
          this.state = 'suppressing';
        } else if (finalize) {
          output += this.buffer;
          this.buffer = '';
        } else {
          // Hold back enough to detect partial opening marker + anti-echo text
          const safe = this.buffer.length - NORMAL_HOLDBACK;
          if (safe > 0) {
            output += this.buffer.slice(0, safe);
            this.buffer = this.buffer.slice(safe);
          }
          break;
        }
      } else {
        // suppressing — discard until closing marker
        const closeResult = this.findCloseMarker(this.buffer);
        if (closeResult !== null) {
          this.buffer = this.buffer.slice(closeResult.end);
          this.state = 'normal';
        } else if (finalize) {
          this.buffer = '';
        } else {
          // Keep tail for partial close detection
          const keep = Math.min(this.buffer.length, MARKER_MAX_LEN + 2);
          this.buffer = this.buffer.slice(-keep);
          break;
        }
      }
    }

    if (finalize) {
      // Final regex cleanup for any persistent echoes
      output = (output + this.buffer)
        .replace(/Respond now\.\s*Do NOT repeat or echo any text from (?:INSTRUCTIONS or CONVERSATION|the history) above\.?/gi, '')
        .replace(/Assistant:\s*/gi, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      this.buffer = '';
      this.state = 'prefix';
    }

    return output;
  }

  private findContentStart(text: string): number {
    const jsonIdx = text.indexOf('{');
    const fenceIdx = text.indexOf('```');
    if (jsonIdx < 0) return fenceIdx;
    if (fenceIdx < 0) return jsonIdx;
    return Math.min(jsonIdx, fenceIdx);
  }

  private findOpenMarker(text: string): number {
    const a = text.indexOf('<<INSTRUCTIONS>>');
    const b = text.indexOf('<<CONVERSATION>>');
    if (a < 0) return b;
    if (b < 0) return a;
    return Math.min(a, b);
  }

  private findCloseMarker(text: string): { end: number } | null {
    const markers = ['<</INSTRUCTIONS>>', '<</CONVERSATION>>'];
    let bestPos = -1;
    let bestLen = 0;
    for (const marker of markers) {
      const pos = text.indexOf(marker);
      if (pos >= 0 && (bestPos < 0 || pos < bestPos)) {
        bestPos = pos;
        bestLen = marker.length;
      }
    }
    return bestPos >= 0 ? { end: bestPos + bestLen } : null;
  }
}
