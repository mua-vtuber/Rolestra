import { describe, expect, it } from 'vitest';
import type { JsonSchema } from '../../../shared/structured-output-types';
import {
  parsePrivateReplyOutput, parseRoomTurnOutput, privateReplyOutputSpec, PRIVATE_REPLY_KEYS,
  ROOM_TURN_KEYS, ROOM_WHISPER_KEYS, roomTurnHint, roomTurnOutputSpec,
} from '../chat-whisper-output';

const RECIPIENTS = [{ id: 'p-bob', name: 'Bob' }, { id: 'p-carol', name: 'Carol' }];
const BY_ALIAS = new Map([['p-bob', 'bob'], ['p-carol', 'carol']]);

/** A tiny validator for this app's JSON Schema subset — enough to check the examples. */
function matches(schema: JsonSchema, value: unknown): boolean {
  if (schema.anyOf) return schema.anyOf.some((option) => matches(option, value));
  if (schema.enum && !(typeof value === 'string' && schema.enum.includes(value))) return false;
  switch (schema.type) {
    case 'null': return value === null;
    case 'string': return typeof value === 'string' && value.length >= (schema.minLength ?? 0);
    case 'array':
      return Array.isArray(value) && value.length <= (schema.maxItems ?? Infinity) &&
        value.every((item) => schema.items !== undefined && matches(schema.items, item));
    case 'object': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
      const object = value as Record<string, unknown>;
      const properties = schema.properties ?? {};
      if (schema.additionalProperties === false &&
        Object.keys(object).some((key) => !(key in properties))) return false;
      if ((schema.required ?? []).some((key) => !(key in object))) return false;
      return Object.entries(object).every(([key, item]) => {
        const property = properties[key];
        return property !== undefined && matches(property, item);
      });
    }
    default: return true;
  }
}

describe('room turn output schema (spec 2026-10-08 F2)', () => {
  const spec = roomTurnOutputSpec(RECIPIENTS.map((item) => item.id));

  it('is built from the parser key constants', () => {
    expect(spec.name).toBe('room_turn');
    expect(Object.keys(spec.schema.properties ?? {})).toEqual([...ROOM_TURN_KEYS]);
    expect(spec.schema.required).toEqual(ROOM_TURN_KEYS);
    const item = spec.schema.properties?.whispers?.items;
    expect(Object.keys(item?.properties ?? {})).toEqual([...ROOM_WHISPER_KEYS]);
    expect(item?.required).toEqual(ROOM_WHISPER_KEYS);
    expect(spec.schema.additionalProperties).toBe(false);
    expect(item?.additionalProperties).toBe(false);
  });

  it('lists the recipients in the same order as the hint', () => {
    const hint = roomTurnHint(RECIPIENTS);
    const list = hint.slice(hint.indexOf('at most once each: ') + 'at most once each: '.length);
    const listed = JSON.parse(list.slice(0, list.indexOf(']') + 1)) as Array<{ id: string }>;
    expect(spec.schema.properties?.whispers?.items?.properties?.recipientId?.enum)
      .toEqual(listed.map((item) => item.id));
    expect(spec.schema.properties?.whispers?.maxItems).toBe(2);
  });

  it('accepts what the parser accepts: public text or null, zero, one or several whispers', () => {
    const examples = [
      { public: 'Hello', whispers: [] },
      { public: null, whispers: [] },
      { public: null, whispers: [{ recipientId: 'p-bob', content: 'psst' }] },
      { public: 'Hi', whispers: [{ recipientId: 'p-bob', content: 'a' }, { recipientId: 'p-carol', content: 'b' }] },
    ];
    for (const example of examples) {
      expect(matches(spec.schema, example)).toBe(true);
      expect(() => parseRoomTurnOutput(JSON.stringify(example), BY_ALIAS, 'alice')).not.toThrow();
    }
  });

  it('rejects an unlisted recipient, an extra key and an empty text', () => {
    expect(matches(spec.schema, { public: null, whispers: [{ recipientId: 'Bob', content: 'x' }] })).toBe(false);
    expect(matches(spec.schema, { public: 'x', whispers: [], mood: 'happy' })).toBe(false);
    expect(matches(spec.schema, { public: '', whispers: [] })).toBe(false);
  });

  it('allows no whisper at all when nobody else is in the room, without an empty enum', () => {
    const alone = roomTurnOutputSpec([]);
    expect(alone.schema.properties?.whispers).toEqual({ type: 'array', maxItems: 0 });
    expect(matches(alone.schema, { public: 'Alone', whispers: [] })).toBe(true);
    expect(matches(alone.schema, { public: null, whispers: [{ recipientId: 'x', content: 'y' }] })).toBe(false);
  });
});

describe('private reply output schema (spec 2026-10-08 F2)', () => {
  const spec = privateReplyOutputSpec();

  it('is built from the parser key constant and matches what the parser accepts', () => {
    expect(spec.name).toBe('private_reply');
    expect(Object.keys(spec.schema.properties ?? {})).toEqual([...PRIVATE_REPLY_KEYS]);
    expect(spec.schema.required).toEqual(PRIVATE_REPLY_KEYS);
    for (const example of [{ reply: 'ok' }, { reply: null }]) {
      expect(matches(spec.schema, example)).toBe(true);
      expect(() => parsePrivateReplyOutput(JSON.stringify(example))).not.toThrow();
    }
    expect(matches(spec.schema, { reply: 'x', whispers: [] })).toBe(false);
  });
});
