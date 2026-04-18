import { describe, it, expect, beforeEach } from 'vitest';
import { CliSanitizer } from '../cli-sanitizer';
import type { CliRuntimeConfig } from '../cli-provider';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<CliRuntimeConfig> = {}): CliRuntimeConfig {
  return {
    command: 'test-cli',
    args: [],
    inputFormat: 'pipe',
    outputFormat: 'stream-json',
    sessionStrategy: 'per-turn',
    hangTimeout: { first: 5000, subsequent: 3000 },
    ...overrides,
  };
}

/** NORMAL_HOLDBACK constant from the sanitizer (normal-state holdback). */
const NORMAL_HOLDBACK = 100;

// ===========================================================================
// CliSanitizer
// ===========================================================================

describe('CliSanitizer', () => {
  let sanitizer: CliSanitizer;

  beforeEach(() => {
    sanitizer = new CliSanitizer();
  });

  describe('sanitize', () => {
    it('passes through tokens when disabled', () => {
      expect(sanitizer.sanitize('hello')).toBe('hello');
      expect(sanitizer.sanitize(' world')).toBe(' world');
    });

    it('holds back tokens in the buffer when enabled', () => {
      sanitizer.enable(makeConfig({ command: 'gemini', inputFormat: 'pipe' }));

      // Short tokens should be held back entirely (< NORMAL_HOLDBACK)
      const result = sanitizer.sanitize('short');
      expect(result).toBe('');
    });

    it('emits text beyond the holdback threshold when enabled', () => {
      sanitizer.enable(makeConfig({ command: 'gemini', inputFormat: 'pipe' }));

      // Gemini starts in prefix state — must pass the marker to enter normal state
      sanitizer.sanitize('[[[START_OF_RESPONSE]]]\nAssistant:');

      // Send a large chunk that exceeds the holdback
      const longText = 'A'.repeat(300);
      const result = sanitizer.sanitize(longText);

      // Should emit 300 - NORMAL_HOLDBACK = 200 chars
      expect(result.length).toBe(300 - NORMAL_HOLDBACK);
      expect(result).toBe('A'.repeat(300 - NORMAL_HOLDBACK));
    });

    it('accumulates across multiple calls', () => {
      sanitizer.enable(makeConfig({ command: 'gemini', inputFormat: 'pipe' }));

      // Enter normal state first
      sanitizer.sanitize('[[[START_OF_RESPONSE]]]\nAssistant:');

      let total = '';
      // Send 10 chunks of 30 chars each = 300 total
      for (let i = 0; i < 10; i++) {
        total += sanitizer.sanitize('B'.repeat(30));
      }

      // After 300 chars total, should have emitted 300 - NORMAL_HOLDBACK
      expect(total.length).toBe(300 - NORMAL_HOLDBACK);
    });

    it('flushes remaining holdback on finalize', () => {
      sanitizer.enable(makeConfig({ command: 'gemini', inputFormat: 'pipe' }));

      // Enter normal state, then send a short token that stays in holdback
      sanitizer.sanitize('[[[START_OF_RESPONSE]]]\nAssistant:held back');
      // Finalize should flush it
      const flushed = sanitizer.sanitize('', true);

      expect(flushed).toBe('held back');
    });

    it('strips artifacts from held-back content', () => {
      sanitizer.enable(makeConfig({ command: 'gemini', inputFormat: 'pipe' }));

      // Enter normal state first, then encounter artifacts within the response
      sanitizer.sanitize('[[[START_OF_RESPONSE]]]\nAssistant:');
      const artifact = '<<INSTRUCTIONS>>secret<</INSTRUCTIONS>>Real output';
      sanitizer.sanitize(artifact);
      const flushed = sanitizer.sanitize('', true);

      expect(flushed).not.toContain('<<INSTRUCTIONS>>');
      expect(flushed).not.toContain('secret');
      expect(flushed).toContain('Real output');
    });

    it('handles empty input', () => {
      sanitizer.enable(makeConfig({ command: 'gemini', inputFormat: 'pipe' }));
      expect(sanitizer.sanitize('')).toBe('');
    });

    it('handles finalize on empty state', () => {
      sanitizer.enable(makeConfig({ command: 'gemini', inputFormat: 'pipe' }));
      expect(sanitizer.sanitize('', true)).toBe('');
    });
  });

  describe('reset', () => {
    it('clears enabled state so tokens pass through', () => {
      sanitizer.enable(makeConfig({ command: 'gemini', inputFormat: 'pipe' }));
      sanitizer.reset();

      // After reset, sanitize should pass through (disabled)
      expect(sanitizer.sanitize('hello')).toBe('hello');
    });

    it('clears holdback buffer', () => {
      sanitizer.enable(makeConfig({ command: 'gemini', inputFormat: 'pipe' }));
      sanitizer.sanitize('buffered content');

      sanitizer.reset();

      // After reset, enable again — should not see old content
      sanitizer.enable(makeConfig({ command: 'gemini', inputFormat: 'pipe' }));
      const result = sanitizer.sanitize('', true);
      expect(result).toBe('');
    });

    it('allows reuse after reset', () => {
      sanitizer.enable(makeConfig({ command: 'gemini', inputFormat: 'pipe' }));
      sanitizer.sanitize('[[[START_OF_RESPONSE]]]\nAssistant:first session');
      sanitizer.reset();

      sanitizer.enable(makeConfig({ command: 'gemini', inputFormat: 'pipe' }));
      sanitizer.sanitize('[[[START_OF_RESPONSE]]]\nAssistant:second session');
      const result = sanitizer.sanitize('', true);

      expect(result).toBe('second session');
      expect(result).not.toContain('first session');
    });
  });

  describe('shouldEnable', () => {
    it('returns true for gemini with pipe format', () => {
      expect(sanitizer.shouldEnable(makeConfig({ command: 'gemini', inputFormat: 'pipe' }))).toBe(true);
    });

    it('returns true for Gemini (case-insensitive)', () => {
      expect(sanitizer.shouldEnable(makeConfig({ command: 'Gemini', inputFormat: 'pipe' }))).toBe(true);
      expect(sanitizer.shouldEnable(makeConfig({ command: 'GEMINI', inputFormat: 'pipe' }))).toBe(true);
    });

    it('returns true for Gemini with full Windows path', () => {
      const fullPath = 'C:\\Users\\Taniar\\AppData\\Roaming\\npm\\gemini.cmd';
      expect(sanitizer.shouldEnable(makeConfig({ command: fullPath, inputFormat: 'pipe' }))).toBe(true);
    });

    it('returns false for gemini with non-pipe format', () => {
      expect(sanitizer.shouldEnable(makeConfig({ command: 'gemini', inputFormat: 'stdin-json' }))).toBe(false);
      expect(sanitizer.shouldEnable(makeConfig({ command: 'gemini', inputFormat: 'args' }))).toBe(false);
    });

    it('returns false for non-gemini commands', () => {
      expect(sanitizer.shouldEnable(makeConfig({ command: 'claude', inputFormat: 'pipe' }))).toBe(false);
      expect(sanitizer.shouldEnable(makeConfig({ command: 'codex', inputFormat: 'pipe' }))).toBe(false);
    });

    it('returns false for claude with stdin-json', () => {
      expect(sanitizer.shouldEnable(makeConfig({ command: 'claude', inputFormat: 'stdin-json' }))).toBe(false);
    });
  });

  describe('enable', () => {
    it('activates sanitization for gemini pipe config', () => {
      sanitizer.enable(makeConfig({ command: 'gemini', inputFormat: 'pipe' }));

      // When enabled, short tokens are held back
      expect(sanitizer.sanitize('test')).toBe('');
    });

    it('does not activate for non-gemini config', () => {
      sanitizer.enable(makeConfig({ command: 'claude', inputFormat: 'stdin-json' }));

      // When not enabled, tokens pass through
      expect(sanitizer.sanitize('test')).toBe('test');
    });

    it('does not activate for gemini in session mode (sessionIdFlag + sessionId)', () => {
      // In session mode only the last user message is sent — no full prompt, no marker.
      // Gemini does not echo in session mode, so sanitization is unnecessary.
      const cfg = makeConfig({ command: 'gemini', inputFormat: 'pipe', sessionIdFlag: '--resume' });
      sanitizer.enable(cfg, 'session-123');

      // Tokens should pass through unchanged
      expect(sanitizer.sanitize('response in session mode')).toBe('response in session mode');
    });

    it('activates for gemini when sessionIdFlag is set but no active session', () => {
      const cfg = makeConfig({ command: 'gemini', inputFormat: 'pipe', sessionIdFlag: '--resume' });
      sanitizer.enable(cfg, null);

      // No active session → full prompt is sent with marker → sanitization needed
      expect(sanitizer.sanitize('test')).toBe('');
    });
  });

  describe('artifact stripping via sanitize', () => {
    // Collects all emitted output (streaming + finalize), matching real usage.
    // Gemini starts in prefix state, so we first pass the start-of-response marker
    // to enter normal state, then feed the content to strip.
    function strip(input: string): string {
      const s = new CliSanitizer();
      s.enable(makeConfig({ command: 'gemini', inputFormat: 'pipe' }));
      s.sanitize('[[[START_OF_RESPONSE]]]\nAssistant:');
      let result = s.sanitize(input);
      result += s.sanitize('', true);
      return result;
    }

    it('removes INSTRUCTIONS sections', () => {
      const input = 'Before<<INSTRUCTIONS>>secret stuff<</INSTRUCTIONS>>After';
      expect(strip(input)).toBe('BeforeAfter');
    });

    it('removes CONVERSATION sections', () => {
      const input = 'Before<<CONVERSATION>>chat history<</CONVERSATION>>After';
      expect(strip(input)).toBe('BeforeAfter');
    });

    it('suppresses from orphaned opening INSTRUCTIONS marker to end', () => {
      // State machine enters suppressing mode and never finds closing marker
      expect(strip('text<<INSTRUCTIONS>>more')).toBe('text');
    });

    it('suppresses from orphaned opening CONVERSATION marker to end', () => {
      expect(strip('text<<CONVERSATION>>more')).toBe('text');
    });

    it('passes through orphaned closing markers (no matching open)', () => {
      // Closing markers without a preceding opening marker are not
      // recognized as block boundaries and pass through.
      expect(strip('text<</INSTRUCTIONS>>more')).toBe('text<</INSTRUCTIONS>>more');
      expect(strip('text<</CONVERSATION>>more')).toBe('text<</CONVERSATION>>more');
    });

    it('removes anti-echo instruction text', () => {
      const input = 'Respond now. Do NOT repeat or echo any text from INSTRUCTIONS or CONVERSATION above.';
      expect(strip(input).trim()).toBe('');
    });

    it('removes anti-echo instruction text case-insensitively', () => {
      const input = 'respond now. do not repeat or echo any text from instructions or conversation above.';
      expect(strip(input).trim()).toBe('');
    });

    it('collapses excessive blank lines', () => {
      const input = 'Line1\n\n\n\n\nLine2';
      expect(strip(input)).toBe('Line1\n\nLine2');
    });

    it('handles multiple artifact types in one string', () => {
      const input = [
        '<<INSTRUCTIONS>>Be helpful<</INSTRUCTIONS>>',
        '<<CONVERSATION>>User: hi\nAssistant: hello<</CONVERSATION>>',
        'Respond now. Do NOT repeat or echo any text from INSTRUCTIONS or CONVERSATION above.',
        'Actual response here.',
      ].join('\n');

      const result = strip(input);
      expect(result).toContain('Actual response here.');
      expect(result).not.toContain('Be helpful');
      expect(result).not.toContain('User: hi');
    });

    it('returns clean text unchanged', () => {
      const input = 'Just a normal response with no artifacts.';
      expect(strip(input)).toBe(input);
    });

    it('handles empty string', () => {
      expect(strip('')).toBe('');
    });

    it('handles multiline INSTRUCTIONS content', () => {
      const input = '<<INSTRUCTIONS>>\nLine 1\nLine 2\nLine 3\n<</INSTRUCTIONS>>';
      expect(strip(input)).toBe('');
    });

    it('handles large prompt echo that exceeds holdback', () => {
      // Simulate a realistic Gemini echo: large INSTRUCTIONS + CONVERSATION + marker + response
      // Gemini echoes the full stdin payload including the [[[START_OF_RESPONSE]]] marker we inject.
      const instructions = '<<INSTRUCTIONS>>' + 'x'.repeat(500) + '<</INSTRUCTIONS>>';
      const conversation = '<<CONVERSATION>>' + 'y'.repeat(500) + '<</CONVERSATION>>';
      const antiEcho = 'Respond now. Do NOT repeat or echo any text from INSTRUCTIONS or CONVERSATION above.';
      const marker = '[[[START_OF_RESPONSE]]]\nAssistant:';
      const response = 'This is the actual AI response.';
      const input = instructions + '\n' + conversation + '\n' + antiEcho + '\n' + marker + response;

      // Feed in small chunks to simulate streaming
      const s = new CliSanitizer();
      s.enable(makeConfig({ command: 'gemini', inputFormat: 'pipe' }));
      let result = '';
      const chunkSize = 50;
      for (let i = 0; i < input.length; i += chunkSize) {
        result += s.sanitize(input.slice(i, i + chunkSize));
      }
      result += s.sanitize('', true);

      expect(result).toContain('This is the actual AI response.');
      expect(result).not.toContain('<<INSTRUCTIONS>>');
      expect(result).not.toContain('<<CONVERSATION>>');
      expect(result).not.toContain('xxxxx');
      expect(result).not.toContain('yyyyy');
    });
  });
});
