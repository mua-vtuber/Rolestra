/**
 * MeetingMemoryCoordinator — unit tests.
 *
 * Covers the three surfaces: buildMemoryContext (retrieval → prompt
 * block), extractMemories (extraction → store), and
 * runPostMeetingMaintenance (embed / evolve / reflect).
 */

import { describe, it, expect, vi } from 'vitest';
import { MeetingMemoryCoordinator } from '../meeting-memory-coordinator';
import { MeetingSession } from '../meeting-session';
import type { MemoryFacade } from '../../../memory/facade';
import type { Participant } from '../../../../shared/engine-types';
import type { SsmContext } from '../../../../shared/ssm-context-types';

function session(): MeetingSession {
  const participants: Participant[] = [
    { id: 'ai-1', providerId: 'ai-1', displayName: 'A1', isActive: true },
    { id: 'ai-2', providerId: 'ai-2', displayName: 'A2', isActive: true },
  ];
  const ctx: SsmContext = {
    meetingId: 'mt-1',
    channelId: 'ch-1',
    projectId: 'pr-1',
    projectPath: '/tmp/p',
    permissionMode: 'hybrid',
    autonomyMode: 'manual',
  };
  return new MeetingSession({
    meetingId: 'mt-1',
    channelId: 'ch-1',
    projectId: 'pr-1',
    topic: 'test topic',
    participants,
    ssmCtx: ctx,
  });
}

function withUserMessage(s: MeetingSession, content: string): void {
  s.createMessage({
    participantId: 'user',
    participantName: '나',
    role: 'user',
    content,
  });
}

describe('MeetingMemoryCoordinator — buildMemoryContext', () => {
  it('returns null when memoryFacade is absent', async () => {
    const coord = new MeetingMemoryCoordinator(session(), null);
    expect(await coord.buildMemoryContext()).toBeNull();
  });

  it('returns null when no user message has been sent', async () => {
    const facade = { search: vi.fn() } as unknown as MemoryFacade;
    const coord = new MeetingMemoryCoordinator(session(), facade);
    expect(await coord.buildMemoryContext()).toBeNull();
    expect(facade.search).not.toHaveBeenCalled();
  });

  it('returns null when the search result is empty', async () => {
    const s = session();
    withUserMessage(s, 'How do I ship?');
    const facade = {
      search: vi.fn().mockResolvedValue([]),
    } as unknown as MemoryFacade;
    const coord = new MeetingMemoryCoordinator(s, facade);
    expect(await coord.buildMemoryContext()).toBeNull();
  });

  it('formats results as a [관련 기억] prompt block with importance marker', async () => {
    const s = session();
    withUserMessage(s, 'release plan?');
    const facade = {
      search: vi.fn().mockResolvedValue([
        { node: { content: 'release branch freeze Friday', importance: 0.9 } },
        { node: { content: 'QA smoke on staging', importance: 0.5 } },
      ]),
    } as unknown as MemoryFacade;
    const coord = new MeetingMemoryCoordinator(s, facade);
    const block = await coord.buildMemoryContext();
    expect(block).toContain('[관련 기억]');
    expect(block).toContain('- release branch freeze Friday [중요]');
    expect(block).toContain('- QA smoke on staging');
    expect(block).not.toContain('QA smoke on staging [중요]');
  });

  it('swallows search errors and returns null', async () => {
    const s = session();
    withUserMessage(s, 'release plan?');
    const facade = {
      search: vi.fn().mockRejectedValue(new Error('boom')),
    } as unknown as MemoryFacade;
    const coord = new MeetingMemoryCoordinator(s, facade);
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await coord.buildMemoryContext()).toBeNull();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('MeetingMemoryCoordinator — extractMemories', () => {
  it('returns 0 when memoryFacade is absent', () => {
    const coord = new MeetingMemoryCoordinator(session(), null);
    expect(coord.extractMemories('ai output', 'ai-1')).toBe(0);
  });

  it('passes the last user message + AI content to extractAndStore', () => {
    const s = session();
    withUserMessage(s, 'question about X');
    const facade = {
      extractAndStore: vi.fn().mockReturnValue(3),
    } as unknown as MemoryFacade;
    const coord = new MeetingMemoryCoordinator(s, facade);
    const created = coord.extractMemories('answer body', 'ai-1');
    expect(created).toBe(3);
    expect(facade.extractAndStore).toHaveBeenCalledWith(
      [
        { content: 'question about X', participantId: 'user' },
        { content: 'answer body', participantId: 'ai-1' },
      ],
      'mt-1',
    );
  });

  it('omits the user entry when there is no user message', () => {
    const facade = {
      extractAndStore: vi.fn().mockReturnValue(1),
    } as unknown as MemoryFacade;
    const coord = new MeetingMemoryCoordinator(session(), facade);
    coord.extractMemories('standalone ai turn', 'ai-1');
    expect(facade.extractAndStore).toHaveBeenCalledWith(
      [{ content: 'standalone ai turn', participantId: 'ai-1' }],
      'mt-1',
    );
  });
});

describe('MeetingMemoryCoordinator — runPostMeetingMaintenance', () => {
  it('is a no-op when facade is absent', async () => {
    const coord = new MeetingMemoryCoordinator(session(), null);
    await expect(coord.runPostMeetingMaintenance()).resolves.toBeUndefined();
  });

  it('runs embed → evolve → reflect when the threshold is met', async () => {
    const facade = {
      embedUnembeddedNodes: vi.fn().mockResolvedValue(2),
      evolve: vi.fn().mockReturnValue({ merged: 0, pruned: 0 }),
      shouldReflect: vi.fn().mockReturnValue(true),
      reflect: vi.fn().mockResolvedValue({ insightsCreated: 1, nodesProcessed: 5 }),
    } as unknown as MemoryFacade;
    const coord = new MeetingMemoryCoordinator(session(), facade);
    await coord.runPostMeetingMaintenance();
    expect(facade.embedUnembeddedNodes).toHaveBeenCalledTimes(2);
    expect(facade.evolve).toHaveBeenCalled();
    expect(facade.reflect).toHaveBeenCalled();
  });

  it('skips reflect when shouldReflect is false', async () => {
    const facade = {
      embedUnembeddedNodes: vi.fn().mockResolvedValue(0),
      evolve: vi.fn().mockReturnValue({ merged: 0, pruned: 0 }),
      shouldReflect: vi.fn().mockReturnValue(false),
      reflect: vi.fn(),
    } as unknown as MemoryFacade;
    const coord = new MeetingMemoryCoordinator(session(), facade);
    await coord.runPostMeetingMaintenance();
    expect(facade.reflect).not.toHaveBeenCalled();
  });
});
