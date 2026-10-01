import { describe, expect, it } from 'vitest';
import {
  chatErrorCodeFor, InvalidChatOutputError, isEmptyChatOutput, parsePrivateReplyOutput, parseRoomTurnOutput,
  directMessageTurnHint, privateReplyHint, roomOutputPersona, roomTurnHint, unwrapSingleJsonFence,
  whisperThreadReplyHint,
} from '../chat-whisper-output';
import { ChatCliInstructionsInsideWorkspaceError } from '../../files/chat-cli-instructions';
import { ParticipantAliasCollisionError } from '../participant-alias';

/** Eligible recipients by the opaque alias a model sees (spec 2026-09-29 §C). */
const ELIGIBLE = new Map([['p-bob', 'bob'], ['p-carol', 'carol']]);

describe('parseRoomTurnOutput (2026-09-28 contract)', () => {
  it('accepts public speech, any number of whispers to distinct eligible recipients, or silence', () => {
    expect(parseRoomTurnOutput('{"public":" Hello ","whispers":[]}', ELIGIBLE, 'alice'))
      .toEqual({ public: 'Hello', whispers: [] });
    expect(parseRoomTurnOutput(JSON.stringify({ public: null, whispers: [
      { recipientId: 'p-bob', content: ' to bob ' }, { content: 'to carol', recipientId: 'p-carol' },
    ] }), ELIGIBLE, 'alice')).toEqual({ public: null, whispers: [
      { recipientId: 'bob', content: 'to bob' }, { recipientId: 'carol', content: 'to carol' },
    ] });
    expect(parseRoomTurnOutput('{"whispers":[],"public":null}', ELIGIBLE, 'alice'))
      .toEqual({ public: null, whispers: [] });
  });

  it('accepts one code-fence wrapper (```json, bare ``` or a leading BOM) around otherwise-valid JSON (W9)', () => {
    const inner = '{"public":"x","whispers":[]}';
    for (const raw of [
      '```json\n' + inner + '\n```', '```\n' + inner + '\n```',
      '﻿' + inner, '﻿```json\n' + inner + '\n```',
      '  \n```json\n' + inner + '\n```\n  ',
    ]) {
      expect(parseRoomTurnOutput(raw, ELIGIBLE, 'alice')).toEqual({ public: 'x', whispers: [] });
    }
  });

  it.each([
    'plain text', '', '   ', '[]', 'null',
    '{"public":"x"}', '{"whispers":[]}', '{"public":"x","whispers":[],"extra":1}',
    '{"public":"","whispers":[]}', '{"public":" ","whispers":[]}', '{"public":7,"whispers":[]}',
    '{"public":null,"whispers":{}}', '{"public":null,"whispers":[null]}',
    '{"public":null,"whispers":[{"recipientId":"p-bob"}]}',
    '{"public":null,"whispers":[{"recipientId":"p-bob","content":"  "}]}',
    '{"public":null,"whispers":[{"recipientId":"p-bob","content":"x","senderId":"p-carol"}]}',
    '{"public":null,"whispers":[{"recipientId":"p-mallory","content":"x"}]}',
    '{"public":null,"whispers":[{"recipientId":"p-alice","content":"x"}]}',
    '{"public":null,"whispers":[{"recipientId":"p-bob","content":"a"},{"recipientId":"p-bob","content":"b"}]}',
    // A raw provider id is not an alias, even for an eligible participant.
    '{"public":null,"whispers":[{"recipientId":"bob","content":"x"}]}',
    '{"public":null,"whispers":[{"recipientId":7,"content":"x"}]}',
    '{"kind":"public","content":"x"}', '{"kind":"whisper","recipientId":"p-bob","content":"x"}',
    '{"public":"x","whispers":[]}{"public":"y","whispers":[]}',
    // W9: still invalid_response — prose around the block, two blocks, text
    // after the closing fence, or a fence around broken JSON.
    'Sure, here it is:\n```json\n{"public":"x","whispers":[]}\n```',
    '```json\n{"public":"x","whispers":[]}\n```\nHope that helps!',
    '```json\n{"public":"x","whispers":[]}\n```\n```json\n{"public":"y","whispers":[]}\n```',
    '```json\n{"public":"x","whispers":[]}\n``` trailing text',
    '```json\n{"public":"x",\n```',
  ])('rejects %j as invalid_response', (raw) => {
    // The sender's own alias maps to the sender here, so the self check is exercised too.
    expect(() => parseRoomTurnOutput(raw, new Map([...ELIGIBLE, ['p-alice', 'alice']]), 'alice'))
      .toThrow(InvalidChatOutputError);
  });
});

describe('unwrapSingleJsonFence (W9)', () => {
  it('strips exactly one leading BOM and surrounding whitespace regardless of fencing', () => {
    expect(unwrapSingleJsonFence('﻿{"a":1}')).toBe('{"a":1}');
    expect(unwrapSingleJsonFence('  \n{"a":1}\n  ')).toBe('{"a":1}');
  });

  it('unwraps only when the fence spans the whole trimmed string', () => {
    expect(unwrapSingleJsonFence('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(unwrapSingleJsonFence('```\n{"a":1}\n```')).toBe('{"a":1}');
    expect(unwrapSingleJsonFence('prose\n```json\n{"a":1}\n```')).toBe('prose\n```json\n{"a":1}\n```');
    expect(unwrapSingleJsonFence('```json\n{"a":1}\n```\nprose')).toBe('```json\n{"a":1}\n```\nprose');
  });
});

describe('parsePrivateReplyOutput', () => {
  it('accepts a private reply or an explicit decision not to reply', () => {
    expect(parsePrivateReplyOutput('{"reply":" Yes "}')).toEqual({ reply: 'Yes' });
    expect(parsePrivateReplyOutput('{"reply":null}')).toEqual({ reply: null });
  });

  it('accepts one code-fence wrapper (```json, bare ``` or a leading BOM) around otherwise-valid JSON (W9)', () => {
    const inner = '{"reply":"Yes"}';
    for (const raw of [
      '```json\n' + inner + '\n```', '```\n' + inner + '\n```',
      '﻿' + inner, '﻿```json\n' + inner + '\n```',
    ]) {
      expect(parsePrivateReplyOutput(raw)).toEqual({ reply: 'Yes' });
    }
  });

  it.each([
    '', 'Yes', '{}', '{"reply":""}', '{"reply":"  "}', '{"reply":1}', '{"reply":"x","recipientId":"carol"}',
    '{"public":"x","whispers":[]}', '{"public":null,"whispers":[{"recipientId":"carol","content":"chain"}]}',
    '{"kind":"public","content":"x"}',
    // W9: still invalid_response — prose around the block, two blocks, text
    // after the closing fence, or a fence around broken JSON.
    'Sure:\n```json\n{"reply":"Yes"}\n```',
    '```json\n{"reply":"Yes"}\n```\nDone.',
    '```json\n{"reply":"Yes"}\n```\n```json\n{"reply":"No"}\n```',
    '```json\n{"reply":"Yes"}\n``` extra',
    '```json\n{"reply":\n```',
  ])('rejects %j, so a reply can never start a whisper', (raw) => {
    expect(() => parsePrivateReplyOutput(raw)).toThrow(InvalidChatOutputError);
  });
});

describe('room prompts', () => {
  it('lists every eligible recipient in the turn hint and keeps both output shapes in one persona', () => {
    const hint = roomTurnHint([{ id: 'bob', name: 'Bob' }, { id: 'carol', name: 'Carol' }]);
    expect(hint).toContain('[{"id":"bob","name":"Bob"},{"id":"carol","name":"Carol"}]');
    expect(hint).toContain('{"public":null,"whispers":[]}');
    expect(privateReplyHint('Alice')).toContain('Private reply to "Alice"');
    expect(privateReplyHint('Alice')).toContain('{"reply":null}');
    const persona = roomOutputPersona('Base persona');
    expect(persona.startsWith('Base persona\n\n')).toBe(true);
    expect(persona).toContain('"whispers"');
    expect(persona).toContain('"reply"');
    expect(persona).not.toContain('"kind"');
  });

  it('tells every hint to output only the raw JSON object (W8)', () => {
    const noFenceLine = 'Output only the raw JSON object: no code fence and no text before or after it.';
    expect(roomTurnHint([{ id: 'bob', name: 'Bob' }])).toContain(noFenceLine);
    expect(privateReplyHint('Alice')).toContain(noFenceLine);
    expect(whisperThreadReplyHint('Alice')).toContain(noFenceLine);
  });
});

describe('silence guidance (spec 2026-10-01 F4)', () => {
  it('makes silence the normal choice in the room output rules, with concrete conditions', () => {
    const persona = roomOutputPersona('Base persona');
    for (const sentence of [
      'Silence is normal and often the best choice.',
      'Do not speak just because it is your turn.',
      'Stay silent when the topic has reached a conclusion, after goodbyes have been exchanged, ' +
        'when you would only agree, thank or repeat what was said, or when no one needs your answer.',
      'Speak only when you add something new.',
    ]) expect(persona).toContain(sentence);
  });

  it('reminds every room turn that silence is fine unless there is something new to add', () => {
    expect(roomTurnHint([{ id: 'bob', name: 'Bob' }]))
      .toContain('Stay silent unless you have something new to add.');
  });

  it('asks for a private reply only when the whisper needs an answer', () => {
    const hint = privateReplyHint('Alice');
    expect(hint).toContain('Private reply to "Alice": they whispered to you.');
    expect(hint).toContain('Reply only if the whisper needs an answer; otherwise return {"reply":null}.');
    expect(hint).toContain('Do not start a new whisper.');
  });

  it('tells a later reply in the thread that the other side answered, and to reply only if needed', () => {
    const hint = whisperThreadReplyHint('Bob');
    expect(hint).toContain('Private reply to "Bob": they answered you.');
    expect(hint).toContain('Reply again only if it still needs an answer; otherwise return {"reply":null}.');
    expect(hint).toContain('Do not start a new whisper.');
    expect(hint).not.toContain('whispered to you');
  });

  it('leaves the DM hint unchanged: a DM always answers', () => {
    expect(directMessageTurnHint()).toBe('Reply to the user in this direct conversation.');
  });
});

describe('isEmptyChatOutput (D1)', () => {
  it.each(['', '   ', '\n\t  \n', '\r\n'])('treats %j as empty', (raw) => {
    expect(isEmptyChatOutput(raw)).toBe(true);
  });

  it.each(['hi', '  hi  ', '{"public":"x","whispers":[]}'])('treats %j as non-empty', (raw) => {
    expect(isEmptyChatOutput(raw)).toBe(false);
  });
});

describe('chatErrorCodeFor (spec 2026-09-29 QA)', () => {
  it('names the room or the folder setting instead of blaming the AI provider', () => {
    expect(chatErrorCodeFor(new ParticipantAliasCollisionError('room', 'p-000000000000'), false))
      .toBe('participant_alias_collision');
    expect(chatErrorCodeFor(new ChatCliInstructionsInsideWorkspaceError('C:/data/x', 'C:/data'), false))
      .toBe('consensus_folder_contains_app_data');
    expect(chatErrorCodeFor(new Error('boom'), false)).toBe('provider_error');
    expect(chatErrorCodeFor(new ParticipantAliasCollisionError('room', 'p-0'), true)).toBe('timeout');
  });
});
