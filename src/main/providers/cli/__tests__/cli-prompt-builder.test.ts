import { describe, it, expect, beforeEach } from 'vitest';
import { CliPromptBuilder } from '../cli-prompt-builder';
import { directMessageTurnHint } from '../../../channels/chat-whisper-output';
import type { Message } from '../../../../shared/provider-types';
import type { CliRuntimeConfig } from '../cli-provider';
import { asAbsolutePath } from '../../../../shared/absolute-path';

const INSTRUCTIONS_DIR = asAbsolutePath('C:/app-data/chat-cli-instructions', 'prompt builder test');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let builder: CliPromptBuilder;

function makeMessages(...specs: Array<{ role: Message['role']; content: string; name?: string }>): Message[] {
  return specs.map(s => ({ role: s.role, content: s.content, name: s.name }));
}

function makeConfig(overrides: Partial<CliRuntimeConfig> = {}): CliRuntimeConfig {
  return {
    command: 'test-cli',
    args: ['--flag', 'value'],
    inputFormat: 'pipe',
    outputFormat: 'stream-json',
    sessionStrategy: 'per-turn',
    hangTimeout: { first: 5000, subsequent: 3000 },
    ...overrides,
  };
}

beforeEach(() => {
  builder = new CliPromptBuilder();
});

// ===========================================================================
// buildTextPrompt
// ===========================================================================

describe('buildTextPrompt', () => {
  it('builds a multi-turn conversation prompt with markers', () => {
    const messages = makeMessages(
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' },
      { role: 'user', content: 'How are you?' },
    );
    const result = builder.buildTextPrompt(messages, 'You are a helpful assistant.');

    expect(result).toContain('<<INSTRUCTIONS>>');
    expect(result).toContain('You are a helpful assistant.');
    expect(result).toContain('<</INSTRUCTIONS>>');
    expect(result).toContain('<<CONVERSATION>>');
    expect(result).toContain('User: Hello');
    expect(result).toContain('Assistant: Hi there!');
    expect(result).toContain('User: How are you?');
    expect(result).toContain('<</CONVERSATION>>');
  });

  it('includes persona inside INSTRUCTIONS markers at the top', () => {
    const messages = makeMessages({ role: 'user', content: 'Test' });
    const result = builder.buildTextPrompt(messages, '  Expert coder  ');

    expect(result).toContain('<<INSTRUCTIONS>>');
    expect(result).toContain('Expert coder');
    expect(result).toContain('<</INSTRUCTIONS>>');
    // INSTRUCTIONS comes before CONVERSATION
    const instrIdx = result.indexOf('<<INSTRUCTIONS>>');
    const convIdx = result.indexOf('<<CONVERSATION>>');
    expect(instrIdx).toBeLessThan(convIdx);
  });

  it('omits INSTRUCTIONS section when persona is empty', () => {
    const messages = makeMessages({ role: 'user', content: 'Test' });
    const result = builder.buildTextPrompt(messages, '  ');

    expect(result).not.toContain('<<INSTRUCTIONS>>');
    expect(result).not.toContain('<</INSTRUCTIONS>>');
    expect(result).toContain('User: Test');
  });

  it('capitalizes role names', () => {
    const messages = makeMessages(
      { role: 'system', content: 'sys msg' },
      { role: 'user', content: 'usr msg' },
      { role: 'assistant', content: 'ast msg' },
    );
    const result = builder.buildTextPrompt(messages, '');

    expect(result).toContain('System: sys msg');
    expect(result).toContain('User: usr msg');
    expect(result).toContain('Assistant: ast msg');
  });

  it('handles ContentBlock array content', () => {
    const messages: Message[] = [
      {
        role: 'user',
        content: [
          { type: 'text', data: 'Part 1' },
          { type: 'image', data: 'base64...' },
          { type: 'text', data: 'Part 2' },
        ],
      },
    ];
    const result = builder.buildTextPrompt(messages, '');

    // image block produces empty string, joined with \n -> 'Part 1\n\nPart 2'
    expect(result).toContain('User: Part 1\n\nPart 2');
  });

  it('ends with CONVERSATION closing marker', () => {
    const messages = makeMessages({ role: 'user', content: 'Hi' });
    const result = builder.buildTextPrompt(messages, '');

    expect(result.trimEnd().endsWith('<</CONVERSATION>>')).toBe(true);
  });

  it('separates INSTRUCTIONS and CONVERSATION with double newlines', () => {
    const messages = makeMessages(
      { role: 'user', content: 'A' },
      { role: 'assistant', content: 'B' },
    );
    const result = builder.buildTextPrompt(messages, 'Persona');

    // INSTRUCTIONS and CONVERSATION sections separated by \n\n
    expect(result).toContain('<</INSTRUCTIONS>>\n\n<<CONVERSATION>>');
  });
});

// ===========================================================================
// buildPipePrompt
// ===========================================================================

describe('buildPipePrompt', () => {
  it('wraps persona in <<INSTRUCTIONS>> markers', () => {
    const messages = makeMessages({ role: 'user', content: 'Hello' });
    const result = builder.buildPipePrompt(messages, 'Be helpful');

    expect(result).toContain('<<INSTRUCTIONS>>');
    expect(result).toContain('Be helpful');
    expect(result).toContain('<</INSTRUCTIONS>>');
  });

  it('wraps conversation in <<CONVERSATION>> markers', () => {
    const messages = makeMessages(
      { role: 'user', content: 'Q1' },
      { role: 'assistant', content: 'A1' },
    );
    const result = builder.buildPipePrompt(messages, '');

    expect(result).toContain('<<CONVERSATION>>');
    expect(result).toContain('Q1');
    expect(result).toContain('A1');
    expect(result).toContain('<</CONVERSATION>>');
  });

  it('includes anti-echo instruction naming only the sections present', () => {
    const messages = makeMessages({ role: 'user', content: 'Test' });

    expect(builder.buildPipePrompt(messages, 'Persona'))
      .toContain('Do NOT repeat or echo any text from INSTRUCTIONS or CONVERSATION above');
    // Scoped chat passes no persona (it is the CLI system prompt), so the
    // input has no INSTRUCTIONS section to refer to (spec 2026-09-29 B2).
    const withoutPersona = builder.buildPipePrompt(messages, '');
    expect(withoutPersona).toContain('Do NOT repeat or echo any text from CONVERSATION above');
    expect(withoutPersona).not.toContain('INSTRUCTIONS');
  });

  it('uses named assistant labels', () => {
    const messages = makeMessages(
      { role: 'user', content: 'Question' },
      { role: 'assistant', content: 'Answer from Claude', name: 'Claude' },
    );
    const result = builder.buildPipePrompt(messages, '');

    expect(result).toContain('Claude: Answer from Claude');
  });

  it('includes system messages in conversation section', () => {
    const messages = makeMessages(
      { role: 'system', content: 'System instruction' },
      { role: 'user', content: 'User question' },
    );
    const result = builder.buildPipePrompt(messages, '');

    expect(result).toContain('<<CONVERSATION>>');
    expect(result).toContain('System: System instruction');
    expect(result).toContain('User: User question');
  });

  it('omits INSTRUCTIONS section when persona is empty', () => {
    const messages = makeMessages({ role: 'user', content: 'Test' });
    const result = builder.buildPipePrompt(messages, '');

    expect(result).not.toContain('<<INSTRUCTIONS>>');
    expect(result).not.toContain('<</INSTRUCTIONS>>');
  });

  it('includes CONVERSATION section even for system-only messages', () => {
    const messages = makeMessages({ role: 'system', content: 'sys' });
    const result = builder.buildPipePrompt(messages, 'Persona');

    expect(result).toContain('<<CONVERSATION>>');
    expect(result).toContain('System: sys');
  });

  it('handles ContentBlock array content', () => {
    const messages: Message[] = [
      {
        role: 'user',
        content: [
          { type: 'text', data: 'Block A' },
          { type: 'text', data: 'Block B' },
        ],
      },
    ];
    const result = builder.buildPipePrompt(messages, '');

    // buildTextPrompt joins content blocks with \n
    expect(result).toContain('Block A\nBlock B');
  });
});

// ===========================================================================
// buildStdinPayload
// ===========================================================================

describe('buildStdinPayload', () => {
  it('builds pipe format using buildPipePrompt (no session)', () => {
    const config = makeConfig({ inputFormat: 'pipe' });
    const messages = makeMessages(
      { role: 'user', content: 'Hello' },
    );
    const result = builder.buildStdinPayload(messages, 'Be helpful', undefined, config, null);

    // Should contain pipe prompt markers
    expect(result).toContain('<<INSTRUCTIONS>>');
    expect(result).toContain('Hello');
  });

  it('sends only last user message for pipe format with active session', () => {
    const config = makeConfig({
      inputFormat: 'pipe',
      sessionIdFlag: '--resume',
    });
    const messages = makeMessages(
      { role: 'user', content: 'First message' },
      { role: 'assistant', content: 'First reply' },
      { role: 'user', content: 'Second message' },
    );
    const result = builder.buildStdinPayload(messages, 'Persona', undefined, config, 'sess-123');

    // Should be just the last user message, not the full pipe prompt
    expect(result).toBe('Second message');
    expect(result).not.toContain('<<INSTRUCTIONS>>');
  });

  it('builds full pipe prompt when session has no sessionIdFlag', () => {
    const config = makeConfig({ inputFormat: 'pipe' });
    const messages = makeMessages(
      { role: 'user', content: 'Message' },
    );
    const result = builder.buildStdinPayload(messages, 'Persona', undefined, config, 'sess-123');

    // No sessionIdFlag means session is not recognized, use full prompt
    expect(result).toContain('<<INSTRUCTIONS>>');
  });

  it('includes every unseen speaker on scoped Codex resume', () => {
    const config = makeConfig({ inputFormat: 'pipe', buildResumeArgs: (sid) => ['exec', 'resume', sid] });
    const messages = makeMessages(
      { role: 'assistant', content: '[Speaker: "Other AI"]\nA new idea' },
      { role: 'user', content: '[Speaker: "User"]\nPlease continue' },
    );
    const result = builder.buildStdinPayload(messages, 'Frozen persona', {
      chatSession: { scopeKey: 'room:alice', resumeSessionId: 'sid', currentStateHint: 'Continue this room.',
        instructionsDir: INSTRUCTIONS_DIR },
    }, config, 'sid');
    expect(result).toContain('Other AI');
    expect(result).toContain('Please continue');
    expect(result).toContain('Continue this room.');
    expect(result).not.toContain('Frozen persona');
  });

  it('includes every unseen speaker on scoped Claude resume', () => {
    const messages = makeMessages(
      { role: 'assistant', content: '[Speaker: "Other AI"]\nI disagree' },
      { role: 'user', content: '[Speaker: "User"]\nWhy?' },
    );
    const payload = builder.buildPersistentJsonPayload(messages, 'Frozen persona', 'sid', {
      scopeKey: 'room:alice', resumeSessionId: 'sid', currentStateHint: 'Continue this room.',
      instructionsDir: INSTRUCTIONS_DIR,
    });
    const parsed = JSON.parse(payload) as { message: { content: string } };
    expect(parsed.message.content).toContain('Other AI');
    expect(parsed.message.content).toContain('Why?');
    expect(parsed.message.content).toContain('Continue this room.');
    expect(parsed.message.content).not.toContain('Frozen persona');
  });

  it('sends only the current state hint when a resumed turn has no unseen activity', () => {
    const chatSession = { scopeKey: 'room:bob', resumeSessionId: 'sid', currentStateHint: 'Choose one room response.',
      instructionsDir: INSTRUCTIONS_DIR };
    const claude = JSON.parse(builder.buildPersistentJsonPayload([], 'Frozen persona', 'sid', chatSession)) as {
      type: string; message: { role: string; content: string };
    };
    const codex = builder.buildStdinPayload([], 'Frozen persona', { chatSession },
      makeConfig({ inputFormat: 'pipe', buildResumeArgs: (sid) => ['exec', 'resume', sid] }), 'sid');
    for (const prompt of [claude.message.content, codex]) {
      expect(prompt.startsWith('Choose one room response.\n\n')).toBe(true);
      // D2: the auto-appended empty-input line must not assert "room"
      // activity of its own — a DM turn shares this same line, and a DM is
      // not a room. (The pre-existing hint above may legitimately say
      // "room" — that part is this specific caller's own wording, not the
      // shared template this test is pinning.)
      const appended = prompt.slice('Choose one room response.\n\n'.length);
      expect(appended).toBe('Nothing new has been said since your last turn. Take your turn now.');
      expect(appended).not.toContain('room');
      expect(prompt).not.toContain('<<CONVERSATION>>');
      expect(prompt).not.toContain('\n\n\n');
      expect(prompt).not.toContain('Frozen persona');
    }
    expect(claude).toMatchObject({ type: 'user', message: { role: 'user' } });
  });

  it('D2: a resumed DM turn with no unseen input uses the DM hint, never the room hint', () => {
    const dmHint = directMessageTurnHint();
    expect(dmHint).not.toContain('new visible activity');
    expect(dmHint).not.toContain('room');
    const chatSession = { scopeKey: 'dm:bob', resumeSessionId: 'sid', currentStateHint: dmHint,
      instructionsDir: INSTRUCTIONS_DIR };
    const prompt = builder.buildStdinPayload([], 'Frozen persona', { chatSession },
      makeConfig({ inputFormat: 'pipe', buildResumeArgs: (sid) => ['exec', 'resume', sid] }), 'sid');
    expect(prompt).not.toContain('new visible activity');
    expect(prompt).not.toContain('room');
    expect(prompt).toContain('Nothing new has been said since your last turn.');
  });

  it('builds stdin-json format with system and messages', () => {
    const config = makeConfig({ inputFormat: 'stdin-json' });
    const messages = makeMessages(
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'World' },
    );
    const result = builder.buildStdinPayload(messages, 'Be helpful', undefined, config, null);

    const parsed = JSON.parse(result);
    expect(parsed.system).toBe('Be helpful');
    expect(parsed.messages).toHaveLength(2);
    expect(parsed.messages[0].role).toBe('user');
    expect(parsed.messages[0].content).toBe('Hello');
    expect(parsed.messages[1].role).toBe('assistant');
    expect(parsed.messages[1].content).toBe('World');
  });

  it('handles empty messages for stdin-json', () => {
    const config = makeConfig({ inputFormat: 'stdin-json' });
    const result = builder.buildStdinPayload([], 'Persona', undefined, config, null);

    const parsed = JSON.parse(result);
    expect(parsed.system).toBe('Persona');
    expect(parsed.messages).toEqual([]);
  });
});

// ===========================================================================
// buildArgs
// ===========================================================================

describe('buildArgs', () => {
  it('returns base args when no session or special input format', () => {
    const config = makeConfig({ args: ['--output', 'json'], inputFormat: 'pipe' });
    const result = builder.buildArgs([], '', undefined, config, null);

    expect(result).toEqual(['--output', 'json']);
  });

  it('does not mutate the original args array', () => {
    const config = makeConfig({ args: ['--flag'] });
    builder.buildArgs([], '', undefined, config, null);
    expect(config.args).toEqual(['--flag']);
  });

  it('adds session ID via sessionIdFlag for flag-based resume', () => {
    const config = makeConfig({
      args: ['--base'],
      sessionIdFlag: '--resume',
      inputFormat: 'pipe',
    });
    const result = builder.buildArgs([], '', undefined, config, 'sess-456');

    expect(result).toEqual(['--base', '--resume', 'sess-456']);
  });

  it('uses custom buildResumeArgs when provided', () => {
    const config = makeConfig({
      args: ['exec', '--json', '-'],
      buildResumeArgs: (sid, _base) => ['exec', 'resume', sid, '--json', '-'],
      inputFormat: 'pipe',
    });
    const result = builder.buildArgs([], '', undefined, config, 'thread-789');

    expect(result).toEqual(['exec', 'resume', 'thread-789', '--json', '-']);
  });

  it('custom buildResumeArgs takes priority over sessionIdFlag', () => {
    const config = makeConfig({
      args: ['--base'],
      sessionIdFlag: '--session-id',
      buildResumeArgs: (sid, _base) => ['custom', sid],
      inputFormat: 'pipe',
    });
    const result = builder.buildArgs([], '', undefined, config, 'sid-1');

    expect(result).toEqual(['custom', 'sid-1']);
  });

  it('appends last user message for args input format', () => {
    const config = makeConfig({ args: ['--model', 'gpt4'], inputFormat: 'args' });
    const messages = makeMessages(
      { role: 'user', content: 'First question' },
      { role: 'assistant', content: 'First answer' },
      { role: 'user', content: 'Second question' },
    );
    const result = builder.buildArgs(messages, '', undefined, config, null);

    expect(result).toEqual(['--model', 'gpt4', 'Second question']);
  });

  it('handles ContentBlock content for args format', () => {
    const config = makeConfig({ args: ['--model', 'test'], inputFormat: 'args' });
    const messages: Message[] = [
      {
        role: 'user',
        content: [
          { type: 'text', data: 'Part1' },
          { type: 'image', data: 'ignored' },
          { type: 'text', data: 'Part2' },
        ],
      },
    ];
    const result = builder.buildArgs(messages, '', undefined, config, null);

    expect(result).toEqual(['--model', 'test', 'Part1Part2']);
  });

  it('combines session resume and args input format', () => {
    const config = makeConfig({
      args: ['--base'],
      sessionIdFlag: '--resume',
      inputFormat: 'args',
    });
    const messages = makeMessages({ role: 'user', content: 'My prompt' });
    const result = builder.buildArgs(messages, '', undefined, config, 'sess-1');

    expect(result).toEqual(['--base', '--resume', 'sess-1', 'My prompt']);
  });

  it('does not append anything for args format when no user messages', () => {
    const config = makeConfig({ args: ['--flag'], inputFormat: 'args' });
    const messages = makeMessages({ role: 'assistant', content: 'AI only' });
    const result = builder.buildArgs(messages, '', undefined, config, null);

    expect(result).toEqual(['--flag']);
  });
});
