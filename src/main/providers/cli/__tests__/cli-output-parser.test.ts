import { describe, it, expect, beforeEach } from 'vitest';
import { CliOutputParser } from '../cli-output-parser';
import type { CliRuntimeConfig } from '../cli-provider';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let parser: CliOutputParser;

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

beforeEach(() => {
  parser = new CliOutputParser();
});

// ===========================================================================
// parseOutputChunk — stream-json format (exercises private parseStreamJson)
// ===========================================================================

describe('parseOutputChunk (stream-json)', () => {
  it('extracts text from valid Claude JSON events', () => {
    const raw = [
      '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Hello"}]}}',
      '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":" world"}]}}',
    ].join('\n');

    const config = makeConfig({ outputFormat: 'stream-json' });
    expect(parser.parseOutputChunk(raw, config)).toBe('Hello world');
  });

  it('extracts text from valid Gemini JSON events', () => {
    const raw = '{"type":"text","text":"Gemini response"}';
    const config = makeConfig({ outputFormat: 'stream-json' });
    expect(parser.parseOutputChunk(raw, config)).toBe('Gemini response');
  });

  it('extracts text from content-field events', () => {
    const raw = '{"content":"Simple content"}';
    const config = makeConfig({ outputFormat: 'stream-json' });
    expect(parser.parseOutputChunk(raw, config)).toBe('Simple content');
  });

  it('skips malformed JSON lines', () => {
    const raw = [
      '{"text":"valid"}',
      'not-json-at-all',
      '{broken',
      '{"text":"also valid"}',
    ].join('\n');

    const config = makeConfig({ outputFormat: 'stream-json' });
    expect(parser.parseOutputChunk(raw, config)).toBe('validalso valid');
  });

  it('skips empty lines', () => {
    const raw = '\n\n{"text":"hello"}\n\n\n{"text":" there"}\n';
    const config = makeConfig({ outputFormat: 'stream-json' });
    expect(parser.parseOutputChunk(raw, config)).toBe('hello there');
  });

  it('returns empty string for entirely empty input', () => {
    const config = makeConfig({ outputFormat: 'stream-json' });
    expect(parser.parseOutputChunk('', config)).toBe('');
    expect(parser.parseOutputChunk('\n\n\n', config)).toBe('');
  });

  it('returns empty string for non-object JSON values', () => {
    const raw = '"just a string"\n42\ntrue';
    const config = makeConfig({ outputFormat: 'stream-json' });
    expect(parser.parseOutputChunk(raw, config)).toBe('');
  });
});

// ===========================================================================
// parseOutputChunk — jsonl format (exercises private parseJsonl)
// ===========================================================================

describe('parseOutputChunk (jsonl)', () => {
  it('extracts text from valid Codex JSONL', () => {
    const raw = [
      '{"type":"thread.started","thread_id":"t-123"}',
      '{"type":"turn.started"}',
      '{"type":"item.completed","item":{"type":"agent_message","text":"Codex says hi"}}',
      '{"type":"turn.completed"}',
    ].join('\n');

    const config = makeConfig({ outputFormat: 'jsonl' });
    expect(parser.parseOutputChunk(raw, config)).toBe('Codex says hi');
  });

  it('handles mixed valid and invalid lines', () => {
    const raw = [
      '{"text":"line1"}',
      'garbage',
      '{"text":"line2"}',
      '}{invalid',
    ].join('\n');

    const config = makeConfig({ outputFormat: 'jsonl' });
    expect(parser.parseOutputChunk(raw, config)).toBe('line1line2');
  });

  it('returns empty string for completely invalid input', () => {
    const config = makeConfig({ outputFormat: 'jsonl' });
    expect(parser.parseOutputChunk('not json\nalso not json', config)).toBe('');
  });
});

// ===========================================================================
// parseOutputChunk — event object extraction (via stream-json)
// ===========================================================================

describe('parseOutputChunk event object extraction', () => {
  const config = makeConfig({ outputFormat: 'stream-json' });

  it('extracts text from Claude content blocks', () => {
    const obj = {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Hello' },
          { type: 'text', text: ' Claude' },
        ],
      },
    };
    expect(parser.parseOutputChunk(JSON.stringify(obj), config)).toBe('Hello Claude');
  });

  it('filters tool_use blocks from Claude content', () => {
    const obj = {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Result: ' },
          { type: 'tool_use', id: 'tool-1', name: 'search', input: {} },
          { type: 'text', text: '42' },
        ],
      },
    };
    expect(parser.parseOutputChunk(JSON.stringify(obj), config)).toBe('Result: 42');
  });

  it('extracts text from Codex item.completed events', () => {
    const obj = {
      type: 'item.completed',
      item: {
        type: 'agent_message',
        text: 'Codex response',
      },
    };
    expect(parser.parseOutputChunk(JSON.stringify(obj), config)).toBe('Codex response');
  });

  it('extracts content from Codex item.completed when text is absent', () => {
    const obj = {
      type: 'item.completed',
      item: {
        type: 'agent_message',
        content: 'Fallback content',
      },
    };
    expect(parser.parseOutputChunk(JSON.stringify(obj), config)).toBe('Fallback content');
  });

  it('returns empty string for item.completed with non-agent_message type', () => {
    const obj = {
      type: 'item.completed',
      item: {
        type: 'tool_result',
        text: 'Should not extract',
      },
    };
    expect(parser.parseOutputChunk(JSON.stringify(obj), config)).toBe('');
  });

  it('skips tool_use events', () => {
    expect(parser.parseOutputChunk(JSON.stringify({ type: 'tool_use', text: 'nope' }), config)).toBe('');
  });

  it('skips tool_result events', () => {
    expect(parser.parseOutputChunk(JSON.stringify({ type: 'tool_result', text: 'nope' }), config)).toBe('');
  });

  it('skips events with tool role', () => {
    expect(parser.parseOutputChunk(JSON.stringify({ role: 'tool', content: 'nope' }), config)).toBe('');
  });

  it('skips events with tool subtype', () => {
    expect(parser.parseOutputChunk(JSON.stringify({ subtype: 'tool_call', text: 'nope' }), config)).toBe('');
  });

  it('skips thread.started events', () => {
    expect(parser.parseOutputChunk(JSON.stringify({ type: 'thread.started', thread_id: 't-1' }), config)).toBe('');
  });

  it('skips turn.started events', () => {
    expect(parser.parseOutputChunk(JSON.stringify({ type: 'turn.started' }), config)).toBe('');
  });

  it('skips error events', () => {
    expect(parser.parseOutputChunk(JSON.stringify({ type: 'error', message: 'Something failed' }), config)).toBe('');
  });

  it('skips system events', () => {
    expect(parser.parseOutputChunk(JSON.stringify({ type: 'system', text: 'init' }), config)).toBe('');
  });

  it('skips nested message with tool role', () => {
    expect(parser.parseOutputChunk(JSON.stringify({
      type: 'content',
      message: { role: 'tool', content: 'tool output' },
    }), config)).toBe('');
  });

  it('falls back to generic field extraction', () => {
    expect(parser.parseOutputChunk(JSON.stringify({ content: 'via content' }), config)).toBe('via content');
    expect(parser.parseOutputChunk(JSON.stringify({ text: 'via text' }), config)).toBe('via text');
    expect(parser.parseOutputChunk(JSON.stringify({ output: 'via output' }), config)).toBe('via output');
    expect(parser.parseOutputChunk(JSON.stringify({ delta: 'via delta' }), config)).toBe('via delta');
    expect(parser.parseOutputChunk(JSON.stringify({ data: 'via data' }), config)).toBe('via data');
  });

  it('returns empty string for empty object', () => {
    expect(parser.parseOutputChunk(JSON.stringify({}), config)).toBe('');
  });
});

// ===========================================================================
// parseOutputChunk — format dispatch
// ===========================================================================

describe('parseOutputChunk', () => {
  it('dispatches to stream-json parser', () => {
    const config = makeConfig({ outputFormat: 'stream-json' });
    const raw = '{"text":"streamed"}';
    expect(parser.parseOutputChunk(raw, config)).toBe('streamed');
  });

  it('dispatches to jsonl parser', () => {
    const config = makeConfig({ outputFormat: 'jsonl' });
    const raw = '{"text":"jsonl line"}';
    expect(parser.parseOutputChunk(raw, config)).toBe('jsonl line');
  });

  it('returns raw for raw-stdout format', () => {
    const config = makeConfig({ outputFormat: 'raw-stdout' });
    const raw = 'plain text output';
    expect(parser.parseOutputChunk(raw, config)).toBe('plain text output');
  });

  it('uses custom outputParser when provided', () => {
    const config = makeConfig({
      outputParser: (raw: string) => raw.toUpperCase(),
    });
    expect(parser.parseOutputChunk('hello', config)).toBe('HELLO');
  });

  it('custom outputParser takes priority over outputFormat', () => {
    const config = makeConfig({
      outputFormat: 'stream-json',
      outputParser: () => 'custom',
    });
    expect(parser.parseOutputChunk('{"text":"ignored"}', config)).toBe('custom');
  });

  it('falls back to raw for unknown format', () => {
    const config = makeConfig({ outputFormat: 'raw-stdout' });
    const raw = 'unknown format data';
    expect(parser.parseOutputChunk(raw, config)).toBe('unknown format data');
  });
});

// ===========================================================================
// extractStructuredError
// ===========================================================================

describe('extractStructuredError', () => {
  it('extracts error message from JSON error line', () => {
    const raw = '{"type":"error","message":"Rate limit exceeded"}';
    expect(parser.extractStructuredError(raw)).toBe('Rate limit exceeded');
  });

  it('returns null when no error line found', () => {
    const raw = '{"type":"text","text":"normal"}';
    expect(parser.extractStructuredError(raw)).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(parser.extractStructuredError('')).toBeNull();
  });

  it('skips non-JSON lines while finding error', () => {
    const raw = 'garbage\n{"type":"error","message":"Found it"}\nmore garbage';
    expect(parser.extractStructuredError(raw)).toBe('Found it');
  });
});

// ===========================================================================
// buildOutputSample
// ===========================================================================

describe('buildOutputSample', () => {
  it('returns truncated compact output', () => {
    const raw = 'A'.repeat(500);
    const result = parser.buildOutputSample(raw);
    expect(result).toHaveLength(300);
  });

  it('returns null for empty input', () => {
    expect(parser.buildOutputSample('')).toBeNull();
  });

  it('returns null for whitespace-only input', () => {
    expect(parser.buildOutputSample('   \n\n  ')).toBeNull();
  });

  it('compacts whitespace', () => {
    const raw = 'hello   \n\n  world';
    expect(parser.buildOutputSample(raw)).toBe('hello world');
  });
});
