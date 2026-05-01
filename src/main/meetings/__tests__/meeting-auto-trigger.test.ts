import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Channel } from '../../../shared/channel-types';
import type { Message } from '../../../shared/message-types';
import { AlreadyActiveMeetingError } from '../meeting-service';
import {
  MeetingAutoTrigger,
  type MeetingAutoTriggerDeps,
} from '../meeting-auto-trigger';

const R12C_DEFAULTS = { role: null, purpose: null, handoffMode: 'check' as const };

const userChannel: Channel = {
  id: 'c-user',
  projectId: 'p-1',
  name: 'gen',
  kind: 'user',
  readOnly: false,
  createdAt: 0,
  ...R12C_DEFAULTS,
};
const dmChannel: Channel = {
  id: 'c-dm',
  projectId: null,
  name: 'dm:p-1',
  kind: 'dm',
  readOnly: false,
  createdAt: 0,
  ...R12C_DEFAULTS,
};
const sysGeneralChannel: Channel = {
  id: 'c-sys-gen',
  projectId: 'p-1',
  name: '#일반',
  kind: 'system_general',
  readOnly: false,
  createdAt: 0,
  ...R12C_DEFAULTS,
};
const sysApprovalChannel: Channel = {
  id: 'c-sys-app',
  projectId: 'p-1',
  name: '#승인-대기',
  kind: 'system_approval',
  readOnly: true,
  createdAt: 0,
  ...R12C_DEFAULTS,
};
const sysMinutesChannel: Channel = {
  id: 'c-sys-min',
  projectId: 'p-1',
  name: '#회의록',
  kind: 'system_minutes',
  readOnly: true,
  createdAt: 0,
  ...R12C_DEFAULTS,
};

function mkUserMessage(channelId: string, content: string): Message {
  return {
    id: 'msg-' + Math.random().toString(36).slice(2, 8),
    channelId,
    meetingId: null,
    authorId: 'user',
    authorKind: 'user',
    role: 'user',
    content,
    meta: null,
    createdAt: Date.now(),
  };
}

function mkAssistantMessage(channelId: string): Message {
  return {
    id: 'msg-asst',
    channelId,
    meetingId: null,
    authorId: 'p-claude',
    authorKind: 'member',
    role: 'assistant',
    content: 'hi',
    meta: null,
    createdAt: Date.now(),
  };
}

describe('MeetingAutoTrigger', () => {
  let channelService: { get: ReturnType<typeof vi.fn> };
  let meetingService: {
    getActive: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>;
  };
  let orchestratorFactory: {
    createAndRun: ReturnType<typeof vi.fn>;
    interruptActive: ReturnType<typeof vi.fn>;
  };
  let dmResponder: { handle: ReturnType<typeof vi.fn> };
  let trigger: MeetingAutoTrigger;

  beforeEach(() => {
    channelService = { get: vi.fn() };
    meetingService = {
      getActive: vi.fn().mockReturnValue(null),
      start: vi.fn(),
    };
    orchestratorFactory = {
      createAndRun: vi.fn().mockResolvedValue(undefined),
      interruptActive: vi.fn().mockResolvedValue(undefined),
    };
    dmResponder = { handle: vi.fn().mockResolvedValue(undefined) };
    trigger = new MeetingAutoTrigger({
      channelService,
      meetingService,
      orchestratorFactory,
      dmResponder,
    } as MeetingAutoTriggerDeps);
  });

  it('skips assistant-authored messages (only user triggers)', async () => {
    channelService.get.mockReturnValue(userChannel);
    await trigger.onMessage(mkAssistantMessage('c-user'));
    expect(meetingService.start).not.toHaveBeenCalled();
    expect(orchestratorFactory.createAndRun).not.toHaveBeenCalled();
    expect(orchestratorFactory.interruptActive).not.toHaveBeenCalled();
    expect(dmResponder.handle).not.toHaveBeenCalled();
  });

  it('skips messages already tagged with a meetingId (T2.5 territory)', async () => {
    channelService.get.mockReturnValue(userChannel);
    const tagged: Message = { ...mkUserMessage('c-user', 'hi'), meetingId: 'm-1' };
    await trigger.onMessage(tagged);
    expect(meetingService.start).not.toHaveBeenCalled();
    expect(orchestratorFactory.interruptActive).not.toHaveBeenCalled();
  });

  it('warns and drops when channel cannot be resolved', async () => {
    channelService.get.mockReturnValue(null);
    await trigger.onMessage(mkUserMessage('c-missing', 'hi'));
    expect(meetingService.start).not.toHaveBeenCalled();
    expect(dmResponder.handle).not.toHaveBeenCalled();
  });

  it('delegates DM messages to DmAutoResponder', async () => {
    channelService.get.mockReturnValue(dmChannel);
    const msg = mkUserMessage('c-dm', 'hi');
    await trigger.onMessage(msg);
    expect(dmResponder.handle).toHaveBeenCalledWith(msg, dmChannel);
    expect(meetingService.start).not.toHaveBeenCalled();
    expect(orchestratorFactory.createAndRun).not.toHaveBeenCalled();
  });

  it('ignores system_approval read-only channel', async () => {
    channelService.get.mockReturnValue(sysApprovalChannel);
    await trigger.onMessage(mkUserMessage('c-sys-app', 'stray'));
    expect(meetingService.start).not.toHaveBeenCalled();
    expect(orchestratorFactory.createAndRun).not.toHaveBeenCalled();
  });

  it('ignores system_minutes read-only channel', async () => {
    channelService.get.mockReturnValue(sysMinutesChannel);
    await trigger.onMessage(mkUserMessage('c-sys-min', 'stray'));
    expect(meetingService.start).not.toHaveBeenCalled();
  });

  it('starts a new meeting on user channel when none active', async () => {
    channelService.get.mockReturnValue(userChannel);
    meetingService.getActive.mockReturnValue(null);
    meetingService.start.mockReturnValue({
      id: 'm-new',
      channelId: 'c-user',
      topic: '오늘 일정 정리해줘',
      startedAt: 0,
    });
    const msg = mkUserMessage('c-user', '오늘 일정 정리해줘');
    await trigger.onMessage(msg);

    expect(meetingService.start).toHaveBeenCalledWith({
      channelId: 'c-user',
      topic: '오늘 일정 정리해줘',
      kind: 'auto',
    });
    expect(orchestratorFactory.createAndRun).toHaveBeenCalledWith({
      meetingId: 'm-new',
      channelId: 'c-user',
      topic: '오늘 일정 정리해줘',
      firstMessage: msg,
    });
    expect(orchestratorFactory.interruptActive).not.toHaveBeenCalled();
  });

  it('treats system_general channel like a user channel (auto-trigger)', async () => {
    channelService.get.mockReturnValue(sysGeneralChannel);
    meetingService.getActive.mockReturnValue(null);
    meetingService.start.mockReturnValue({
      id: 'm-sg',
      channelId: 'c-sys-gen',
      topic: 'x',
      startedAt: 0,
    });
    await trigger.onMessage(mkUserMessage('c-sys-gen', 'x'));
    expect(meetingService.start).toHaveBeenCalled();
    expect(orchestratorFactory.createAndRun).toHaveBeenCalled();
  });

  it('truncates topic to 80 chars with ellipsis', async () => {
    channelService.get.mockReturnValue(userChannel);
    meetingService.getActive.mockReturnValue(null);
    meetingService.start.mockReturnValue({
      id: 'm',
      channelId: 'c-user',
      topic: '',
      startedAt: 0,
    });
    const long = 'a'.repeat(200);
    await trigger.onMessage(mkUserMessage('c-user', long));
    const startArg = meetingService.start.mock.calls[0]![0] as {
      topic: string;
    };
    expect(startArg.topic.length).toBe(80);
    expect(startArg.topic.endsWith('...')).toBe(true);
    expect(startArg.topic.startsWith('a'.repeat(77))).toBe(true);
  });

  it('joins existing active meeting via interruptActive', async () => {
    channelService.get.mockReturnValue(userChannel);
    meetingService.getActive.mockReturnValue({
      id: 'm-existing',
      channelId: 'c-user',
      startedAt: 0,
    });
    const msg = mkUserMessage('c-user', 'hi');
    await trigger.onMessage(msg);

    expect(meetingService.start).not.toHaveBeenCalled();
    expect(orchestratorFactory.createAndRun).not.toHaveBeenCalled();
    expect(orchestratorFactory.interruptActive).toHaveBeenCalledWith({
      meetingId: 'm-existing',
      message: msg,
    });
  });

  it('falls back to interruptActive when start races with concurrent trigger', async () => {
    channelService.get.mockReturnValue(userChannel);
    meetingService.getActive
      .mockReturnValueOnce(null) // initial check
      .mockReturnValueOnce({
        id: 'm-other',
        channelId: 'c-user',
        startedAt: 0,
      }); // re-check after race
    meetingService.start.mockImplementation(() => {
      throw new AlreadyActiveMeetingError('c-user');
    });
    const msg = mkUserMessage('c-user', 'hi');
    await trigger.onMessage(msg);

    expect(orchestratorFactory.createAndRun).not.toHaveBeenCalled();
    expect(orchestratorFactory.interruptActive).toHaveBeenCalledWith({
      meetingId: 'm-other',
      message: msg,
    });
  });

  it('warns and gives up when race collides but the winning meeting already ended', async () => {
    channelService.get.mockReturnValue(userChannel);
    meetingService.getActive
      .mockReturnValueOnce(null) // initial check
      .mockReturnValueOnce(null); // race winner finished before re-read
    meetingService.start.mockImplementation(() => {
      throw new AlreadyActiveMeetingError('c-user');
    });
    await trigger.onMessage(mkUserMessage('c-user', 'hi'));
    expect(orchestratorFactory.interruptActive).not.toHaveBeenCalled();
    expect(orchestratorFactory.createAndRun).not.toHaveBeenCalled();
  });

  it('rethrows non-race errors from start()', async () => {
    channelService.get.mockReturnValue(userChannel);
    meetingService.getActive.mockReturnValue(null);
    meetingService.start.mockImplementation(() => {
      throw new Error('disk full');
    });
    await expect(
      trigger.onMessage(mkUserMessage('c-user', 'hi')),
    ).rejects.toThrow('disk full');
  });
});
