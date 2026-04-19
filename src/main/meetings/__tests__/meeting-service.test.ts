/**
 * Unit tests for MeetingService (R2 Task 12).
 *
 * Coverage:
 *   - start: inserts with UUID id, startedAt=now, state=CONVERSATION,
 *            null snapshot, null outcome, null endedAt
 *   - start twice on same channel → AlreadyActiveMeetingError (DB partial
 *     unique index is the source of truth)
 *   - start on a DIFFERENT channel coexists fine
 *   - finish: sets endedAt + outcome; leaves prior stateSnapshotJson intact
 *     when omitted, replaces when provided
 *   - finish twice → MeetingNotFoundError (already finished)
 *   - finish on unknown id → MeetingNotFoundError
 *   - getActive: returns the single active meeting or null
 *   - getActive: returns null when the meeting is finished
 *   - updateState: mutates state + state_snapshot_json
 *   - updateState on finished meeting → MeetingNotFoundError
 *   - updateState on unknown id → MeetingNotFoundError
 *   - start-after-finish on same channel works (index is partial on NULL)
 *
 * Each test provisions its own temp ArenaRoot + fresh on-disk SQLite so
 * failures leave no cross-test state behind. Matches Task 10/11 pattern.
 */

import Database from 'better-sqlite3';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ArenaRootService,
  type ArenaRootConfigAccessor,
} from '../../arena/arena-root-service';
import { runMigrations } from '../../database/migrator';
import { migrations } from '../../database/migrations/index';
import { ProjectRepository } from '../../projects/project-repository';
import { ProjectService } from '../../projects/project-service';
import { ChannelRepository } from '../../channels/channel-repository';
import { ChannelService } from '../../channels/channel-service';
import { MeetingRepository } from '../meeting-repository';
import {
  AlreadyActiveMeetingError,
  INITIAL_MEETING_STATE,
  MeetingNotFoundError,
  MeetingService,
} from '../meeting-service';

function makeTmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanupDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

function createConfigStub(arenaRoot: string): ArenaRootConfigAccessor {
  const state = { arenaRoot };
  return {
    getSettings: () => state,
    updateSettings: (patch: { arenaRoot?: string }) => {
      if (patch.arenaRoot !== undefined) state.arenaRoot = patch.arenaRoot;
    },
  };
}

describe('MeetingService', () => {
  let arenaRoot: string;
  let arenaRootService: ArenaRootService;
  let db: Database.Database;
  let projectService: ProjectService;
  let channelService: ChannelService;
  let meetingRepo: MeetingRepository;
  let meetingService: MeetingService;

  beforeEach(async () => {
    arenaRoot = makeTmpDir('rolestra-task12-');
    arenaRootService = new ArenaRootService(createConfigStub(arenaRoot));
    await arenaRootService.ensure();

    const dbPath = arenaRootService.dbPath();
    db = new Database(dbPath);
    db.pragma('foreign_keys = ON');
    runMigrations(db, migrations);

    const projectRepo = new ProjectRepository(db);
    projectService = new ProjectService(projectRepo, arenaRootService);
    const channelRepo = new ChannelRepository(db);
    channelService = new ChannelService(channelRepo, projectRepo);
    meetingRepo = new MeetingRepository(db);
    meetingService = new MeetingService(meetingRepo);
  });

  afterEach(() => {
    db.close();
    cleanupDir(arenaRoot);
  });

  /**
   * Convenience helper — creates a project + a user channel and returns
   * the channel id. Every test needs a real channel row so the
   * `meetings.channel_id` FK has something to reference.
   */
  async function seedChannel(): Promise<string> {
    const project = await projectService.create({
      name: `Proj-${Math.random().toString(36).slice(2, 8)}`,
      kind: 'new',
      permissionMode: 'hybrid',
    });
    const channel = channelService.create({
      projectId: project.id,
      name: '회의',
    });
    return channel.id;
  }

  // ── start ──────────────────────────────────────────────────────────

  describe('start', () => {
    it('inserts a new meeting with defaults (UUID id, now timestamp, CONVERSATION state, null snapshot)', async () => {
      const channelId = await seedChannel();
      const before = Date.now();
      const meeting = meetingService.start({
        channelId,
        topic: '스프린트 리뷰',
      });
      const after = Date.now();

      expect(meeting.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(meeting.channelId).toBe(channelId);
      expect(meeting.topic).toBe('스프린트 리뷰');
      expect(meeting.state).toBe(INITIAL_MEETING_STATE);
      expect(meeting.stateSnapshotJson).toBeNull();
      expect(meeting.endedAt).toBeNull();
      expect(meeting.outcome).toBeNull();
      expect(meeting.startedAt).toBeGreaterThanOrEqual(before);
      expect(meeting.startedAt).toBeLessThanOrEqual(after);

      // Persisted row round-trips identically.
      expect(meetingRepo.get(meeting.id)).toEqual(meeting);
    });

    it('defaults topic to empty string when omitted', async () => {
      const channelId = await seedChannel();
      const meeting = meetingService.start({ channelId });
      expect(meeting.topic).toBe('');
    });

    it('throws AlreadyActiveMeetingError when a second active meeting is started on the same channel', async () => {
      const channelId = await seedChannel();
      meetingService.start({ channelId, topic: '첫 회의' });
      expect(() =>
        meetingService.start({ channelId, topic: '두 번째 회의' }),
      ).toThrow(AlreadyActiveMeetingError);
    });

    it('allows concurrent active meetings on DIFFERENT channels', async () => {
      const channelA = await seedChannel();
      const channelB = await seedChannel();
      const a = meetingService.start({ channelId: channelA });
      const b = meetingService.start({ channelId: channelB });
      expect(a.id).not.toBe(b.id);
      expect(meetingService.getActive(channelA)?.id).toBe(a.id);
      expect(meetingService.getActive(channelB)?.id).toBe(b.id);
    });
  });

  // ── finish ─────────────────────────────────────────────────────────

  describe('finish', () => {
    it('sets ended_at, outcome, and keeps prior state_snapshot_json when omitted', async () => {
      const channelId = await seedChannel();
      const meeting = meetingService.start({ channelId });
      // Write a snapshot via updateState, then finish without passing one.
      meetingService.updateState(meeting.id, 'WORK_DISCUSSING', '{"round":1}');

      const before = Date.now();
      const finished = meetingService.finish(meeting.id, 'accepted');
      const after = Date.now();

      expect(finished.outcome).toBe('accepted');
      expect(finished.endedAt).toBeGreaterThanOrEqual(before);
      expect(finished.endedAt).toBeLessThanOrEqual(after);
      // Previous snapshot preserved.
      expect(finished.stateSnapshotJson).toBe('{"round":1}');
    });

    it('replaces state_snapshot_json when provided', async () => {
      const channelId = await seedChannel();
      const meeting = meetingService.start({ channelId });
      meetingService.updateState(meeting.id, 'VOTING', '{"round":1}');

      const finished = meetingService.finish(
        meeting.id,
        'rejected',
        '{"final":true}',
      );
      expect(finished.stateSnapshotJson).toBe('{"final":true}');
      expect(finished.outcome).toBe('rejected');
    });

    it('throws MeetingNotFoundError when the id is unknown', () => {
      expect(() => meetingService.finish('no-such-id', 'aborted')).toThrow(
        MeetingNotFoundError,
      );
    });

    it('throws MeetingNotFoundError when called twice (already finished)', async () => {
      const channelId = await seedChannel();
      const meeting = meetingService.start({ channelId });
      meetingService.finish(meeting.id, 'accepted');
      expect(() => meetingService.finish(meeting.id, 'aborted')).toThrow(
        MeetingNotFoundError,
      );
    });

    it('lets a new meeting start on the same channel after the previous one is finished', async () => {
      const channelId = await seedChannel();
      const first = meetingService.start({ channelId });
      meetingService.finish(first.id, 'accepted');

      const second = meetingService.start({ channelId });
      expect(second.id).not.toBe(first.id);
      expect(meetingService.getActive(channelId)?.id).toBe(second.id);
    });
  });

  // ── getActive ──────────────────────────────────────────────────────

  describe('getActive', () => {
    it('returns null when no meeting exists on the channel', async () => {
      const channelId = await seedChannel();
      expect(meetingService.getActive(channelId)).toBeNull();
    });

    it('returns the single active meeting for the channel', async () => {
      const channelId = await seedChannel();
      const meeting = meetingService.start({ channelId });
      expect(meetingService.getActive(channelId)?.id).toBe(meeting.id);
    });

    it('returns null after the meeting is finished', async () => {
      const channelId = await seedChannel();
      const meeting = meetingService.start({ channelId });
      meetingService.finish(meeting.id, 'accepted');
      expect(meetingService.getActive(channelId)).toBeNull();
    });
  });

  // ── updateState ────────────────────────────────────────────────────

  describe('updateState', () => {
    it('updates state + state_snapshot_json on an active meeting', async () => {
      const channelId = await seedChannel();
      const meeting = meetingService.start({ channelId });
      const updated = meetingService.updateState(
        meeting.id,
        'WORK_DISCUSSING',
        '{"round":1,"votes":[]}',
      );
      expect(updated.state).toBe('WORK_DISCUSSING');
      expect(updated.stateSnapshotJson).toBe('{"round":1,"votes":[]}');
      // endedAt still null — updateState does not finish.
      expect(updated.endedAt).toBeNull();
    });

    it('accepts null snapshot (resetting to initial)', async () => {
      const channelId = await seedChannel();
      const meeting = meetingService.start({ channelId });
      meetingService.updateState(meeting.id, 'WORK_DISCUSSING', '{"round":1}');
      const updated = meetingService.updateState(meeting.id, 'PAUSED', null);
      expect(updated.state).toBe('PAUSED');
      expect(updated.stateSnapshotJson).toBeNull();
    });

    it('throws MeetingNotFoundError when the id is unknown', () => {
      expect(() =>
        meetingService.updateState('no-such-id', 'VOTING', null),
      ).toThrow(MeetingNotFoundError);
    });

    it('throws MeetingNotFoundError when the meeting is already finished', async () => {
      const channelId = await seedChannel();
      const meeting = meetingService.start({ channelId });
      meetingService.finish(meeting.id, 'accepted');
      expect(() =>
        meetingService.updateState(meeting.id, 'VOTING', null),
      ).toThrow(MeetingNotFoundError);
    });
  });
});
