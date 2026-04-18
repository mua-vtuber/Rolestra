/**
 * Tests for DecisionCollector — vote collection, parsing, retry, and error handling.
 */

import { describe, it, expect } from 'vitest';
import { DecisionCollector } from '../decision-collector';

describe('DecisionCollector', () => {
  describe('parseVoteDecisionSchema', () => {
    const collector = new DecisionCollector({ parseRetryLimit: 0 });

    it('parses AGREE vote', () => {
      const response = '{"decision_schema_version":"v1","decision":"AGREE","reason":"Looks good"}';
      const result = collector.parseVoteDecisionSchema(response);
      expect(result.vote).toBe('agree');
      expect(result.comment).toBe('Looks good');
      expect(result.blockReasonType).toBeUndefined();
    });

    it('parses DISAGREE vote', () => {
      const response = '{"decision_schema_version":"v1","decision":"DISAGREE","reason":"Needs changes"}';
      const result = collector.parseVoteDecisionSchema(response);
      expect(result.vote).toBe('disagree');
      expect(result.comment).toBe('Needs changes');
    });

    it('parses BLOCK vote with reason type', () => {
      const response = '{"decision_schema_version":"v1","decision":"BLOCK","block_reason_type":"security","reason":"SQL injection risk"}';
      const result = collector.parseVoteDecisionSchema(response);
      expect(result.vote).toBe('block');
      expect(result.blockReasonType).toBe('security');
      expect(result.comment).toBe('SQL injection risk');
    });

    it('parses BLOCK with data_loss reason', () => {
      const response = '{"decision_schema_version":"v1","decision":"BLOCK","block_reason_type":"data_loss","reason":"Drops table"}';
      const result = collector.parseVoteDecisionSchema(response);
      expect(result.vote).toBe('block');
      expect(result.blockReasonType).toBe('data_loss');
    });

    it('parses BLOCK with spec_conflict reason', () => {
      const response = '{"decision_schema_version":"v1","decision":"BLOCK","block_reason_type":"spec_conflict","reason":"Violates API contract"}';
      const result = collector.parseVoteDecisionSchema(response);
      expect(result.blockReasonType).toBe('spec_conflict');
    });

    it('parses BLOCK with unknown reason', () => {
      const response = '{"decision_schema_version":"v1","decision":"BLOCK","block_reason_type":"unknown","reason":"Not sure"}';
      const result = collector.parseVoteDecisionSchema(response);
      expect(result.blockReasonType).toBe('unknown');
    });

    it('extracts JSON from surrounding text', () => {
      const response = 'Here is my vote:\n{"decision_schema_version":"v1","decision":"AGREE","reason":"LGTM"}\nThank you.';
      const result = collector.parseVoteDecisionSchema(response);
      expect(result.vote).toBe('agree');
    });

    it('throws on invalid schema version', () => {
      const response = '{"decision_schema_version":"v2","decision":"AGREE","reason":"ok"}';
      expect(() => collector.parseVoteDecisionSchema(response)).toThrow('invalid decision_schema_version');
    });

    it('throws on missing reason', () => {
      const response = '{"decision_schema_version":"v1","decision":"AGREE"}';
      expect(() => collector.parseVoteDecisionSchema(response)).toThrow('reason is required');
    });

    it('throws on missing decision', () => {
      const response = '{"decision_schema_version":"v1","reason":"ok"}';
      expect(() => collector.parseVoteDecisionSchema(response)).toThrow('decision is required');
    });

    it('throws on unsupported decision', () => {
      const response = '{"decision_schema_version":"v1","decision":"MAYBE","reason":"ok"}';
      expect(() => collector.parseVoteDecisionSchema(response)).toThrow('unsupported decision');
    });

    it('throws on invalid block_reason_type', () => {
      const response = '{"decision_schema_version":"v1","decision":"BLOCK","block_reason_type":"bad_type","reason":"ok"}';
      expect(() => collector.parseVoteDecisionSchema(response)).toThrow('invalid block_reason_type');
    });

    it('throws on no JSON object', () => {
      expect(() => collector.parseVoteDecisionSchema('plain text')).toThrow('no JSON object found');
    });
  });

  describe('classifyError', () => {
    const collector = new DecisionCollector({ parseRetryLimit: 0 });

    it('classifies timeout errors', () => {
      expect(collector.classifyError(new Error('Request timed out'))).toBe('timeout');
      expect(collector.classifyError(new Error('ETIMEDOUT'))).toBe('timeout');
      expect(collector.classifyError(new Error('ECONNABORTED'))).toBe('timeout');
    });

    it('classifies network errors', () => {
      expect(collector.classifyError(new Error('ECONNREFUSED'))).toBe('network_error');
      expect(collector.classifyError(new Error('ENOTFOUND'))).toBe('network_error');
      expect(collector.classifyError(new Error('ECONNRESET'))).toBe('network_error');
      expect(collector.classifyError(new Error('fetch failed'))).toBe('network_error');
    });

    it('classifies unknown errors', () => {
      expect(collector.classifyError(new Error('Something broke'))).toBe('unknown_error');
      expect(collector.classifyError('string error')).toBe('unknown_error');
      expect(collector.classifyError(null)).toBe('unknown_error');
    });
  });
});
