/**
 * D-A T2: zod 라운드트립 테스트 — 4 신규 meeting IPC 채널.
 *
 * - `meeting:request-stop` — 진행 중 회의 종료 요청
 * - `meeting:edit-topic` — 회의 주제 inline 수정
 * - `meeting:pause` — 일시정지
 * - `meeting:resume` — 재개
 *
 * R10 / R11 schema 테스트의 safeParse 패턴 그대로. 각 채널마다 valid /
 * invalid payload 쌍 + v3ChannelSchemas 레지스트리 등록 확인.
 */
import { describe, it, expect } from 'vitest';
import {
  meetingRequestStopSchema,
  meetingEditTopicSchema,
  meetingPauseSchema,
  meetingResumeSchema,
  v3ChannelSchemas,
} from '../ipc-schemas';
import type { Meeting, ActiveMeetingSummary } from '../meeting-types';

describe('D-A IPC — meeting:request-stop schema', () => {
  it('accepts a plain meetingId', () => {
    const r = meetingRequestStopSchema.safeParse({ meetingId: 'm-uuid' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toEqual({ meetingId: 'm-uuid' });
  });

  it('rejects empty meetingId', () => {
    expect(meetingRequestStopSchema.safeParse({ meetingId: '' }).success).toBe(false);
  });

  it('rejects missing meetingId', () => {
    expect(meetingRequestStopSchema.safeParse({}).success).toBe(false);
  });
});

describe('D-A IPC — meeting:edit-topic schema', () => {
  it('accepts a topic up to 200 chars', () => {
    const r = meetingEditTopicSchema.safeParse({
      meetingId: 'm-1',
      topic: 'a'.repeat(200),
    });
    expect(r.success).toBe(true);
  });

  it('rejects empty topic', () => {
    expect(
      meetingEditTopicSchema.safeParse({ meetingId: 'm-1', topic: '' }).success,
    ).toBe(false);
  });

  it('rejects topic over 200 chars', () => {
    expect(
      meetingEditTopicSchema.safeParse({
        meetingId: 'm-1',
        topic: 'a'.repeat(201),
      }).success,
    ).toBe(false);
  });

  it('rejects empty meetingId', () => {
    expect(
      meetingEditTopicSchema.safeParse({ meetingId: '', topic: 'ok' }).success,
    ).toBe(false);
  });
});

describe('D-A IPC — meeting:pause / meeting:resume schemas', () => {
  it('pause accepts plain meetingId', () => {
    expect(meetingPauseSchema.safeParse({ meetingId: 'm-1' }).success).toBe(true);
  });

  it('resume accepts plain meetingId', () => {
    expect(meetingResumeSchema.safeParse({ meetingId: 'm-1' }).success).toBe(true);
  });

  it('pause rejects empty meetingId', () => {
    expect(meetingPauseSchema.safeParse({ meetingId: '' }).success).toBe(false);
  });

  it('resume rejects empty meetingId', () => {
    expect(meetingResumeSchema.safeParse({ meetingId: '' }).success).toBe(false);
  });
});

describe('D-A IPC — v3ChannelSchemas registry parity (4 신규 채널)', () => {
  it('registers all 4 D-A channels', () => {
    expect(v3ChannelSchemas['meeting:request-stop']).toBeDefined();
    expect(v3ChannelSchemas['meeting:edit-topic']).toBeDefined();
    expect(v3ChannelSchemas['meeting:pause']).toBeDefined();
    expect(v3ChannelSchemas['meeting:resume']).toBeDefined();
  });
});

describe('D-A shared — Meeting / ActiveMeetingSummary type shape', () => {
  it('Meeting compiles with pausedAt + kind', () => {
    const m: Meeting = {
      id: 'm-1',
      channelId: 'c-1',
      topic: 't',
      state: 'CONVERSATION',
      stateSnapshotJson: null,
      startedAt: 0,
      endedAt: null,
      outcome: null,
      pausedAt: null,
      kind: 'manual',
    };
    expect(m.pausedAt).toBeNull();
    expect(m.kind).toBe('manual');
  });

  it('Meeting accepts kind = auto', () => {
    const m: Meeting = {
      id: 'm-2',
      channelId: 'c-2',
      topic: 't',
      state: 'CONVERSATION',
      stateSnapshotJson: null,
      startedAt: 0,
      endedAt: null,
      outcome: null,
      pausedAt: 1_700_000_000_000,
      kind: 'auto',
    };
    expect(m.kind).toBe('auto');
    expect(m.pausedAt).toBe(1_700_000_000_000);
  });

  it('ActiveMeetingSummary compiles with pausedAt', () => {
    const s: ActiveMeetingSummary = {
      id: 'm-1',
      projectId: null,
      projectName: null,
      channelId: 'c-1',
      channelName: '#일반',
      topic: 't',
      stateIndex: 0,
      stateName: 'CONVERSATION',
      startedAt: 0,
      elapsedMs: 0,
      pausedAt: null,
    };
    expect(s.pausedAt).toBeNull();
  });
});
