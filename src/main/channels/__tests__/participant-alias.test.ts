import { describe, expect, it } from 'vitest';
import { ParticipantAliasCollisionError, participantAlias, participantAliasMap } from '../participant-alias';

const ROOM = '0f6c7a52-6a1e-4a57-9d33-1d3c6f3e2b10';

describe('participantAlias (spec 2026-09-29 §C)', () => {
  it('is stable for one room and participant, and differs between rooms and participants', () => {
    expect(participantAlias(ROOM, 'claude')).toBe(participantAlias(ROOM, 'claude'));
    expect(participantAlias(ROOM, 'claude')).not.toBe(participantAlias(ROOM, 'codex'));
    expect(participantAlias(ROOM, 'claude')).not.toBe(participantAlias('another-room', 'claude'));
  });

  it('never contains the provider id, kind or any readable name', () => {
    for (const id of ['claude', 'codex', 'gemini', 'provider-1b2c', 'ollama']) {
      const alias = participantAlias(ROOM, id);
      expect(alias).toMatch(/^p-[0-9a-f]{12}$/);
      expect(alias).not.toContain(id);
    }
  });

  it('refuses a blank channel or provider id instead of hashing an empty value', () => {
    expect(() => participantAlias('', 'claude')).toThrow('channel id');
    expect(() => participantAlias(ROOM, ' ')).toThrow('provider id');
  });

  it('maps each alias back to its provider id', () => {
    const map = participantAliasMap(ROOM, ['claude', 'codex']);
    expect(map.get(participantAlias(ROOM, 'claude'))).toBe('claude');
    expect(map.get(participantAlias(ROOM, 'codex'))).toBe('codex');
    expect(map.get('claude')).toBeUndefined();
    expect(map.size).toBe(2);
  });

  it('throws a named collision instead of merging two participants', () => {
    const sameAlias = () => 'p-000000000000';
    expect(() => participantAliasMap(ROOM, ['claude', 'codex'], sameAlias))
      .toThrow(ParticipantAliasCollisionError);
    expect(() => participantAliasMap(ROOM, ['claude', 'codex'], sameAlias)).toThrow(ROOM);
    // The same provider listed twice is one participant, not a collision.
    expect(participantAliasMap(ROOM, ['claude', 'claude'], sameAlias).size).toBe(1);
  });
});
