import { describe, it, expect } from 'vitest';
import { MessageFormatter } from '../message-formatter';

describe('MessageFormatter', () => {
  const formatter = new MessageFormatter();

  // ── Conversation mode input formatting ───────────────────────

  describe('formatConversationInput', () => {
    it('formats other AI messages as JSON for conversation mode', () => {
      const otherMessages = [
        { name: 'Alpha', content: 'Hello world', modeJudgment: 'conversation' as const },
        { name: 'Beta', content: 'I agree', modeJudgment: 'work' as const },
      ];
      const result = formatter.formatConversationInput(otherMessages);
      const parsed = JSON.parse(result);
      expect(parsed).toHaveLength(2);
      expect(parsed[0].name).toBe('Alpha');
      expect(parsed[0].mode_judgment).toBe('conversation');
      expect(parsed[1].mode_judgment).toBe('work');
    });
  });

  // ── Conversation mode output parsing ─────────────────────────

  describe('parseConversationOutput', () => {
    it('parses valid JSON response', () => {
      const raw = JSON.stringify({
        name: 'Alpha',
        content: 'This needs implementation',
        mode_judgment: 'work',
        judgment_reason: 'code_change',
      });
      const result = formatter.parseConversationOutput(raw, 'Alpha');
      expect(result.type).toBe('conversation');
      if (result.type === 'conversation') {
        expect(result.data.content).toBe('This needs implementation');
        expect(result.data.mode_judgment).toBe('work');
      }
    });

    it('falls back to raw on invalid JSON', () => {
      const result = formatter.parseConversationOutput('Just plain text', 'Alpha');
      expect(result.type).toBe('conversation');
      if (result.type === 'conversation') {
        expect(result.data.content).toBe('Just plain text');
        expect(result.data.mode_judgment).toBe('conversation');
        expect(result.data.name).toBe('Alpha');
      }
    });

    it('falls back when required fields missing', () => {
      const raw = JSON.stringify({ name: 'Alpha' }); // missing content
      const result = formatter.parseConversationOutput(raw, 'Alpha');
      expect(result.type).toBe('conversation');
      if (result.type === 'conversation') {
        expect(result.data.mode_judgment).toBe('conversation');
      }
    });
  });

  // ── Work discussion mode ─────────────────────────────────────

  describe('parseWorkDiscussionOutput', () => {
    it('parses valid work discussion JSON', () => {
      const raw = JSON.stringify({
        name: 'Alpha',
        opinion: 'Use Redis',
        reasoning: 'Fast lookups',
        agreements: { Beta: true, Gamma: false },
      });
      const result = formatter.parseWorkDiscussionOutput(raw, 'Alpha');
      expect(result.type).toBe('work_discussion');
      if (result.type === 'work_discussion') {
        expect(result.data.opinion).toBe('Use Redis');
        expect(result.data.agreements['Beta']).toBe(true);
      }
    });

    it('falls back to raw on invalid JSON', () => {
      const result = formatter.parseWorkDiscussionOutput('plain opinion', 'Alpha');
      expect(result.type).toBe('raw');
    });
  });

  // ── Review mode ──────────────────────────────────────────────

  describe('parseReviewOutput', () => {
    it('parses valid review JSON', () => {
      const raw = JSON.stringify({
        name: 'Beta',
        review_result: 'request_changes',
        issues: ['Missing error handling'],
        comments: 'Needs work',
      });
      const result = formatter.parseReviewOutput(raw, 'Beta');
      expect(result.type).toBe('review');
      if (result.type === 'review') {
        expect(result.data.review_result).toBe('request_changes');
        expect(result.data.issues).toHaveLength(1);
      }
    });
  });

  // ── System prompt generation ─────────────────────────────────

  describe('buildFormatInstruction', () => {
    it('generates conversation mode JSON instruction', () => {
      const instruction = formatter.buildConversationFormatInstruction('Alpha');
      expect(instruction).toContain('JSON');
      expect(instruction).toContain('mode_judgment');
      expect(instruction).toContain('Alpha');
    });

    it('generates work discussion mode JSON instruction', () => {
      const instruction = formatter.buildWorkDiscussionFormatInstruction('Alpha', ['Beta', 'Gamma']);
      expect(instruction).toContain('JSON');
      expect(instruction).toContain('opinion');
      expect(instruction).toContain('agreements');
    });

    it('generates review mode JSON instruction', () => {
      const instruction = formatter.buildReviewFormatInstruction('Beta');
      expect(instruction).toContain('JSON');
      expect(instruction).toContain('review_result');
    });
  });

  // ── Trailing-JSON extraction (Gemini echo workaround) ─────────
  // dogfooding 2026-05-01 #4: Gemini occasionally echoes the prompt
  // before emitting its real reply. The parser must isolate the
  // trailing valid JSON object instead of falling through to "raw
  // text becomes content" — otherwise the persisted message contains
  // the entire echoed transcript and the SSM mode-judgment tally
  // never sees the model's actual vote.

  describe('parseConversationOutput trailing-JSON extraction', () => {
    it('extracts the trailing JSON object when Gemini echoes the prompt before its reply', () => {
      const raw = `[사용자]: 끝말잇기 하자. 의자\n\n[Claude Code]: {"name":"Claude Code","content":"자전거","mode_judgment":"conversation","judgment_reason":"no_action"}\n\n[Codex CLI]: {"name":"Codex CLI","content":"거울","mode_judgment":"conversation","judgment_reason":"no_action"}{\n  "name": "Gemini CLI",\n  "content": "울타리",\n  "mode_judgment": "conversation",\n  "judgment_reason": "no_action"\n}`;
      const result = formatter.parseConversationOutput(raw, 'Gemini CLI');
      expect(result.type).toBe('conversation');
      if (result.type === 'conversation') {
        expect(result.data.content).toBe('울타리');
        expect(result.data.name).toBe('Gemini CLI');
        expect(result.data.mode_judgment).toBe('conversation');
        expect(result.data.judgment_reason).toBe('no_action');
      }
    });

    it('handles braces inside string literals correctly', () => {
      const raw = `prefix text { not a real obj\n{"name":"Beta","content":"hello {world}","mode_judgment":"conversation"}`;
      const result = formatter.parseConversationOutput(raw, 'Beta');
      expect(result.type).toBe('conversation');
      if (result.type === 'conversation') {
        expect(result.data.content).toBe('hello {world}');
      }
    });

    it('still falls back to raw text when no JSON object is present', () => {
      const result = formatter.parseConversationOutput('plain message no braces', 'Alpha');
      expect(result.type).toBe('conversation');
      if (result.type === 'conversation') {
        expect(result.data.content).toBe('plain message no braces');
      }
    });

    it('uses the entire input when it parses cleanly (no echo prefix)', () => {
      const raw = JSON.stringify({
        name: 'Alpha',
        content: 'clean reply',
        mode_judgment: 'conversation',
      });
      const result = formatter.parseConversationOutput(raw, 'Alpha');
      expect(result.type).toBe('conversation');
      if (result.type === 'conversation') {
        expect(result.data.content).toBe('clean reply');
      }
    });
  });

  describe('parseWorkDiscussionOutput trailing-JSON extraction', () => {
    it('extracts the trailing work-discussion JSON when prompt is echoed', () => {
      const raw = `<<INSTRUCTIONS>> ... <</INSTRUCTIONS>>\n[Alpha]: previous turn\n{"name":"Beta","opinion":"agree","reasoning":"because reasons","agreements":{"Alpha":true}}`;
      const result = formatter.parseWorkDiscussionOutput(raw, 'Beta');
      expect(result.type).toBe('work_discussion');
      if (result.type === 'work_discussion') {
        expect(result.data.opinion).toBe('agree');
        expect(result.data.agreements.Alpha).toBe(true);
      }
    });
  });
});
