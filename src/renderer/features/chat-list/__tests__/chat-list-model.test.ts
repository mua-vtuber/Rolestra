import { beforeEach, describe, expect, it } from 'vitest';

import { i18next } from '../../../i18n';
import type { ChannelSummary, ChannelSummaryLastMessage } from '../../../../shared/channel-summary-types';
import { patchSummary } from '../summary-patch';
import {
  conversationLabel,
  listTimeLabel,
  matchesFilter,
  previewText,
  unreadLabel,
  visibleRows,
} from '../chat-list-model';

const t = i18next.t.bind(i18next);

function summary(fields: Partial<ChannelSummary> & Pick<ChannelSummary, 'channelId' | 'kind'>): ChannelSummary {
  return {
    name: fields.channelId, archivedAt: null, participants: [], lastMessage: null,
    lastActivityAt: 0, unreadCount: 0, ...fields,
  };
}

function last(fields: Partial<ChannelSummaryLastMessage>): ChannelSummaryLastMessage {
  return {
    id: 'm', authorId: 'ai-luna', authorKind: 'member', role: 'assistant', createdAt: 1,
    visibility: 'public', content: '내일 밤에 별 보러 갈래?', notice: null, whisper: null, ...fields,
  };
}

const LUNA = { providerId: 'ai-luna', displayName: '루나' };
const HAERANG = { providerId: 'ai-haerang', displayName: '해랑' };

beforeEach(async () => { await i18next.changeLanguage('ko'); });

describe('chat list filters and order', () => {
  const general = summary({ channelId: 'general', kind: 'general', lastActivityAt: 20 });
  const room = summary({ channelId: 'room', kind: 'room', name: '새벽 감성 토크', lastActivityAt: 30 });
  const archived = summary({ channelId: 'old', kind: 'room', name: '마피아 연습방', archivedAt: 5, lastActivityAt: 40 });
  const dm = summary({ channelId: 'dm', kind: 'dm', participants: [LUNA], lastActivityAt: 10 });
  const all = [general, room, archived, dm];

  it('hides legacy DMs from every filter and keeps the archive separate', () => {
    expect(all.filter((s) => matchesFilter(s, 'all')).map((s) => s.channelId)).toEqual(['general', 'room']);
    expect(all.filter((s) => matchesFilter(s, 'rooms')).map((s) => s.channelId)).toEqual(['general', 'room']);
    expect(all.filter((s) => matchesFilter(s, 'archive')).map((s) => s.channelId)).toEqual(['old']);
  });

  it('orders by last activity, newest first, with a stable tie-break', () => {
    const tie = summary({ channelId: 'a-tie', kind: 'room', lastActivityAt: 30 });
    expect(visibleRows(t, [...all, tie], 'all', '').map((s) => s.channelId)).toEqual(['a-tie', 'room', 'general']);
  });

  it('matches the query against the name and the preview', () => {
    const withMessage = { ...room, lastMessage: last({}) };
    expect(visibleRows(t, [general, withMessage], 'all', '감성').map((s) => s.channelId)).toEqual(['room']);
    expect(visibleRows(t, [general, withMessage], 'all', '별 보러').map((s) => s.channelId)).toEqual(['room']);
    expect(visibleRows(t, [{ ...dm, lastMessage: last({}) }], 'all', '별 보러')).toEqual([]);
  });
});

describe('chat list labels', () => {
  it('names general, a DM by its AI, and a room by its name', () => {
    expect(conversationLabel(t, summary({ channelId: 'g', kind: 'general' }))).toBe('일반 채널');
    expect(conversationLabel(t, summary({ channelId: 'd', kind: 'dm', participants: [LUNA] }))).toBe('루나');
    expect(conversationLabel(t, summary({ channelId: 'd', kind: 'dm' }))).toBe('삭제된 AI');
    expect(conversationLabel(t, summary({ channelId: 'r', kind: 'room', name: '새벽 감성 토크' }))).toBe('새벽 감성 토크');
  });

  it('previews "이름: 내용" in rooms, plain text in a DM, "나: …" for the user', () => {
    const room = summary({ channelId: 'r', kind: 'room', participants: [LUNA, HAERANG] });
    expect(previewText(t, { ...room, lastMessage: last({ authorId: 'ai-haerang', content: '오늘 바다 바람 좋았어' }) }))
      .toBe('해랑: 오늘 바다 바람 좋았어');
    expect(previewText(t, { ...room, lastMessage: last({ authorId: 'user', authorKind: 'user', role: 'user', content: '안녕' }) }))
      .toBe('나: 안녕');
    const dm = summary({ channelId: 'd', kind: 'dm', participants: [LUNA] });
    expect(previewText(t, { ...dm, lastMessage: last({}) })).toBe('내일 밤에 별 보러 갈래?');
    expect(previewText(t, room)).toBe('아직 메시지가 없습니다');
  });

  it('previews a whisper by its route only, never its content', () => {
    const room = summary({ channelId: 'r', kind: 'room', participants: [LUNA, HAERANG] });
    const text = previewText(t, { ...room, lastMessage: last({
      visibility: 'whisper', content: null,
      whisper: { senderName: '해랑', recipientName: '루나', threadSeq: 1, isReply: false },
    }) });
    expect(text).toBe('해랑 → 루나 귓속말');
  });

  it('translates stored notice codes instead of showing the raw code', () => {
    const room = summary({ channelId: 'r', kind: 'room' });
    expect(previewText(t, { ...room, lastMessage: last({
      authorId: 'system', authorKind: 'system', role: 'system', content: 'round_all_silent',
      notice: { chatSilence: { code: 'round_all_silent' } },
    }) })).toBe('모두 조용해졌습니다');
    expect(previewText(t, { ...room, lastMessage: last({
      role: 'system', content: 'timeout', notice: { chatError: 'timeout' },
    }) })).toBe('AI 응답 시간이 초과되었습니다.');
  });

  it('keeps the exhausted AI name when a streamed notice updates the preview', () => {
    const room = summary({ channelId: 'r', kind: 'room', unreadCount: 2 });
    const updated = patchSummary(room, {
      id: 'quota-notice', channelId: 'r', meetingId: null, authorId: 'ai-luna', authorKind: 'member',
      role: 'system', content: 'usage_limit', createdAt: 2,
      meta: { chatError: 'usage_limit', chatErrorSpeakerName: '루나' },
    }, false);
    expect(previewText(t, updated)).toBe('루나: 지쳐서 응답할 수 없습니다. 사용량 한도에 도달했습니다.');
    expect(updated.unreadCount).toBe(2);
  });

  it('shows today as hh:mm, yesterday as 어제, then the date', () => {
    const now = new Date(2026, 9, 1, 22, 0).getTime();
    expect(listTimeLabel(t, new Date(2026, 9, 1, 9, 5).getTime(), now, 'ko')).toBe('09:05');
    expect(listTimeLabel(t, new Date(2026, 8, 30, 23, 59).getTime(), now, 'ko')).toBe('어제');
    expect(listTimeLabel(t, new Date(2026, 8, 29, 12, 0).getTime(), now, 'ko')).toBe('9월 29일');
    expect(listTimeLabel(t, new Date(2025, 11, 31, 12, 0).getTime(), now, 'ko')).toContain('2025');
  });

  it('caps the unread badge at 99+ and hides zero', () => {
    expect(unreadLabel(0)).toBeNull();
    expect(unreadLabel(3)).toBe('3');
    expect(unreadLabel(99)).toBe('99');
    expect(unreadLabel(100)).toBe('99+');
  });
});
