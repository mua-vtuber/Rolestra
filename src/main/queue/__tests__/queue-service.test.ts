/**
 * Unit tests for QueueService (R2 Task 15).
 *
 * Coverage:
 *   - add: 3 appends → order_index 1000/2000/3000. UUID id. Emits 'changed'.
 *   - add: unknown project → ProjectNotFoundError.
 *   - reorder: respaces to 1000/2000/3000 in the given order.
 *   - claimNext: smallest order_index first, transitions to in_progress
 *     with started_at = now. Returns null when no pending items.
 *   - complete success → 'done' with finished_at + started_meeting_id.
 *   - complete failure → 'failed' with last_error set.
 *   - cancel pending → 'cancelled' with finished_at.
 *   - cancel in_progress → emits 'abort-requested' with {id, meetingId}.
 *   - cancel terminal → silent no-op.
 *   - pause → pending → paused batch; resume → paused → pending batch.
 *   - recoverInProgress → reverts in_progress rows to pending.
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
import { ChannelRepository } from '../../channels/channel-repository';
import { ChannelService } from '../../channels/channel-service';
import { MeetingRepository } from '../../meetings/meeting-repository';
import { MeetingService } from '../../meetings/meeting-service';
import { ProjectRepository } from '../../projects/project-repository';
import { ProjectService } from '../../projects/project-service';
import { QueueRepository } from '../queue-repository';
import {
  ProjectNotFoundError,
  QUEUE_ABORT_REQUESTED_EVENT,
  QUEUE_CHANGED_EVENT,
  QueueItemNotFoundError,
  QueueService,
  type QueueAbortRequestedEvent,
  type QueueChangedEvent,
} from '../queue-service';
import type { QueueItem } from '../../../shared/queue-types';

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

describe('QueueService', () => {
  let arenaRoot: string;
  let arenaRootService: ArenaRootService;
  let db: Database.Database;
  let projectService: ProjectService;
  let channelService: ChannelService;
  let meetingService: MeetingService;
  let queueRepo: QueueRepository;
  let queueService: QueueService;

  beforeEach(async () => {
    arenaRoot = makeTmpDir('rolestra-task15-');
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
    const meetingRepo = new MeetingRepository(db);
    meetingService = new MeetingService(meetingRepo);
    queueRepo = new QueueRepository(db);
    queueService = new QueueService(queueRepo);
  });

  afterEach(() => {
    db.close();
    cleanupDir(arenaRoot);
  });

  async function seedProject(suffix = ''): Promise<string> {
    const project = await projectService.create({
      name: `QProj${suffix}-${Math.random().toString(36).slice(2, 8)}`,
      kind: 'new',
      permissionMode: 'hybrid',
    });
    return project.id;
  }

  /**
   * Create a real channel + meeting so tests that reference
   * `started_meeting_id` don't hit the FK on `meetings(id)`.
   */
  async function seedMeeting(
    projectId: string,
    topic = 'queue-test',
  ): Promise<string> {
    const channel = channelService.create({
      projectId,
      name: `ch-${Math.random().toString(36).slice(2, 8)}`,
    });
    const meeting = meetingService.start({ channelId: channel.id, topic });
    return meeting.id;
  }

  // ── add ────────────────────────────────────────────────────────────

  describe('add', () => {
    it('assigns sparse order indices 1000, 2000, 3000 on successive inserts', async () => {
      const projectId = await seedProject();
      const a = queueService.add({ projectId, prompt: 'first' });
      const b = queueService.add({ projectId, prompt: 'second' });
      const c = queueService.add({ projectId, prompt: 'third' });

      expect(a.orderIndex).toBe(1000);
      expect(b.orderIndex).toBe(2000);
      expect(c.orderIndex).toBe(3000);
    });

    it('returns a fully-populated QueueItem with UUID id, status=pending, created_at now', async () => {
      const projectId = await seedProject();
      const before = Date.now();
      const item = queueService.add({
        projectId,
        prompt: 'hello queue',
        targetChannelId: null,
      });
      const after = Date.now();

      expect(item.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(item.projectId).toBe(projectId);
      expect(item.status).toBe('pending');
      expect(item.prompt).toBe('hello queue');
      expect(item.targetChannelId).toBeNull();
      expect(item.startedMeetingId).toBeNull();
      expect(item.startedAt).toBeNull();
      expect(item.finishedAt).toBeNull();
      expect(item.lastError).toBeNull();
      expect(item.createdAt).toBeGreaterThanOrEqual(before);
      expect(item.createdAt).toBeLessThanOrEqual(after);
      expect(queueRepo.get(item.id)).toEqual(item);
    });

    it('emits "changed" with {projectId} after successful add', async () => {
      const projectId = await seedProject();
      const events: QueueChangedEvent[] = [];
      queueService.on(QUEUE_CHANGED_EVENT, (e) => events.push(e));

      queueService.add({ projectId, prompt: 'p' });

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({ projectId });
    });

    it('throws ProjectNotFoundError when the project does not exist', () => {
      expect(() =>
        queueService.add({
          projectId: 'ghost-project-id',
          prompt: 'nope',
        }),
      ).toThrow(ProjectNotFoundError);
    });

    it('does NOT emit when the insert throws', () => {
      const events: QueueChangedEvent[] = [];
      queueService.on(QUEUE_CHANGED_EVENT, (e) => events.push(e));
      try {
        queueService.add({ projectId: 'ghost', prompt: 'p' });
      } catch {
        /* expected */
      }
      expect(events).toHaveLength(0);
    });
  });

  // ── reorder ────────────────────────────────────────────────────────

  describe('reorder', () => {
    it('respaces listed ids to 1000, 2000, 3000 in caller-supplied order', async () => {
      const projectId = await seedProject();
      const a = queueService.add({ projectId, prompt: 'a' });
      const b = queueService.add({ projectId, prompt: 'b' });
      const c = queueService.add({ projectId, prompt: 'c' });

      queueService.reorder(projectId, [c.id, a.id, b.id]);

      const reloaded = queueService.listByProject(projectId);
      // Sort by id so we can assert without caring about list order.
      const byId = new Map<string, QueueItem>(
        reloaded.map((i) => [i.id, i] as const),
      );
      expect(byId.get(c.id)!.orderIndex).toBe(1000);
      expect(byId.get(a.id)!.orderIndex).toBe(2000);
      expect(byId.get(b.id)!.orderIndex).toBe(3000);
    });

    it('emits "changed" with {projectId} after reorder', async () => {
      const projectId = await seedProject();
      const a = queueService.add({ projectId, prompt: 'a' });
      const b = queueService.add({ projectId, prompt: 'b' });

      const events: QueueChangedEvent[] = [];
      queueService.on(QUEUE_CHANGED_EVENT, (e) => events.push(e));

      queueService.reorder(projectId, [b.id, a.id]);

      // Strip the add-phase events (we subscribed AFTER add).
      expect(events).toEqual([{ projectId }]);
    });
  });

  // ── claimNext ──────────────────────────────────────────────────────

  describe('claimNext', () => {
    it('returns the smallest-order pending item and flips it to in_progress', async () => {
      const projectId = await seedProject();
      const a = queueService.add({ projectId, prompt: 'a' });
      queueService.add({ projectId, prompt: 'b' });
      queueService.add({ projectId, prompt: 'c' });

      const before = Date.now();
      const claimed = queueService.claimNext(projectId);
      const after = Date.now();

      expect(claimed).not.toBeNull();
      expect(claimed!.id).toBe(a.id);
      expect(claimed!.status).toBe('in_progress');
      expect(claimed!.startedAt).toBeGreaterThanOrEqual(before);
      expect(claimed!.startedAt).toBeLessThanOrEqual(after);

      // DB reflects the flip.
      const persisted = queueRepo.get(a.id);
      expect(persisted!.status).toBe('in_progress');
      expect(persisted!.startedAt).toBe(claimed!.startedAt);
    });

    it('returns the NEXT pending item on a second call (not the same one)', async () => {
      const projectId = await seedProject();
      const a = queueService.add({ projectId, prompt: 'a' });
      const b = queueService.add({ projectId, prompt: 'b' });

      const first = queueService.claimNext(projectId);
      const second = queueService.claimNext(projectId);

      expect(first!.id).toBe(a.id);
      expect(second!.id).toBe(b.id);
    });

    it('returns null when no pending items remain', async () => {
      const projectId = await seedProject();
      queueService.add({ projectId, prompt: 'a' });
      queueService.claimNext(projectId); // consume the one pending
      const second = queueService.claimNext(projectId);
      expect(second).toBeNull();
    });
  });

  // ── complete ───────────────────────────────────────────────────────

  describe('complete', () => {
    it('sets status=done + started_meeting_id + finished_at on success', async () => {
      const projectId = await seedProject();
      const meetingId = await seedMeeting(projectId);
      const item = queueService.add({ projectId, prompt: 'run me' });
      queueService.claimNext(projectId);

      const before = Date.now();
      queueService.complete(item.id, meetingId, true);
      const after = Date.now();

      const final = queueRepo.get(item.id)!;
      expect(final.status).toBe('done');
      expect(final.startedMeetingId).toBe(meetingId);
      expect(final.lastError).toBeNull();
      expect(final.finishedAt).not.toBeNull();
      expect(final.finishedAt!).toBeGreaterThanOrEqual(before);
      expect(final.finishedAt!).toBeLessThanOrEqual(after);
    });

    it('sets status=failed + last_error on failure', async () => {
      const projectId = await seedProject();
      const meetingId = await seedMeeting(projectId);
      const item = queueService.add({ projectId, prompt: 'will fail' });
      queueService.claimNext(projectId);

      queueService.complete(item.id, meetingId, false, 'boom: provider down');

      const final = queueRepo.get(item.id)!;
      expect(final.status).toBe('failed');
      expect(final.lastError).toBe('boom: provider down');
    });

    it('throws QueueItemNotFoundError when id is unknown', () => {
      expect(() =>
        queueService.complete('ghost-id', null, true),
      ).toThrow(QueueItemNotFoundError);
    });

    it('emits "changed" with {id} after complete', async () => {
      const projectId = await seedProject();
      const item = queueService.add({ projectId, prompt: 'p' });
      queueService.claimNext(projectId);

      const events: QueueChangedEvent[] = [];
      queueService.on(QUEUE_CHANGED_EVENT, (e) => events.push(e));

      queueService.complete(item.id, null, true);

      expect(events).toEqual([{ id: item.id }]);
    });
  });

  // ── cancel ─────────────────────────────────────────────────────────

  describe('cancel', () => {
    it('sets status=cancelled + finished_at on a pending item', async () => {
      const projectId = await seedProject();
      const item = queueService.add({ projectId, prompt: 'cancel me' });

      queueService.cancel(item.id);

      const final = queueRepo.get(item.id)!;
      expect(final.status).toBe('cancelled');
      expect(final.finishedAt).not.toBeNull();
    });

    it('sets status=cancelled on a paused item (treated like pending)', async () => {
      const projectId = await seedProject();
      const item = queueService.add({ projectId, prompt: 'pause then cancel' });
      queueService.pause(projectId);
      expect(queueRepo.get(item.id)!.status).toBe('paused');

      queueService.cancel(item.id);
      expect(queueRepo.get(item.id)!.status).toBe('cancelled');
    });

    it('does NOT mutate status for in_progress but emits "abort-requested" with {id, meetingId}', async () => {
      const projectId = await seedProject();
      const meetingId = await seedMeeting(projectId);
      const item = queueService.add({ projectId, prompt: 'running' });
      queueService.claimNext(projectId);
      // Bind the meeting to the claimed queue item so the abort event
      // payload carries a real meeting id (matches engine wiring in Task 20).
      db.prepare(
        `UPDATE queue_items SET started_meeting_id = ? WHERE id = ?`,
      ).run(meetingId, item.id);

      const aborts: QueueAbortRequestedEvent[] = [];
      queueService.on(QUEUE_ABORT_REQUESTED_EVENT, (e) => aborts.push(e));

      queueService.cancel(item.id);

      // Status untouched — the engine will finalise after it stops.
      expect(queueRepo.get(item.id)!.status).toBe('in_progress');
      expect(aborts).toEqual([{ id: item.id, meetingId }]);
    });

    it('is a no-op for terminal rows (done / failed / cancelled)', async () => {
      const projectId = await seedProject();
      const item = queueService.add({ projectId, prompt: 'p' });
      queueService.claimNext(projectId);
      queueService.complete(item.id, null, true);
      const beforeSnap = queueRepo.get(item.id)!;

      expect(() => queueService.cancel(item.id)).not.toThrow();
      const afterSnap = queueRepo.get(item.id)!;
      expect(afterSnap).toEqual(beforeSnap);
    });

    it('throws QueueItemNotFoundError on unknown id', () => {
      expect(() => queueService.cancel('ghost')).toThrow(
        QueueItemNotFoundError,
      );
    });
  });

  // ── pause / resume ─────────────────────────────────────────────────

  describe('pause / resume', () => {
    it('pause moves all pending items to paused; resume moves them back', async () => {
      const projectId = await seedProject();
      queueService.add({ projectId, prompt: 'a' });
      queueService.add({ projectId, prompt: 'b' });
      queueService.add({ projectId, prompt: 'c' });

      const pausedCount = queueService.pause(projectId);
      expect(pausedCount).toBe(3);
      const afterPause = queueService.listByProject(projectId);
      expect(afterPause.every((i) => i.status === 'paused')).toBe(true);

      const resumedCount = queueService.resume(projectId);
      expect(resumedCount).toBe(3);
      const afterResume = queueService.listByProject(projectId);
      expect(afterResume.every((i) => i.status === 'pending')).toBe(true);
    });

    it('pause leaves in_progress rows untouched', async () => {
      const projectId = await seedProject();
      queueService.add({ projectId, prompt: 'claim me' });
      queueService.add({ projectId, prompt: 'pause me' });
      const claimed = queueService.claimNext(projectId)!;

      const count = queueService.pause(projectId);
      expect(count).toBe(1); // only the remaining pending one
      expect(queueRepo.get(claimed.id)!.status).toBe('in_progress');
    });
  });

  // ── recoverInProgress ──────────────────────────────────────────────

  describe('recoverInProgress', () => {
    it('reverts any in_progress rows to pending and returns the count', async () => {
      const projectId = await seedProject();
      // Insert two rows directly in 'in_progress' to simulate a crash
      // mid-run — we cannot use claimNext alone because the test's
      // recoverInProgress call must see stragglers it did NOT set up.
      const item1 = queueService.add({ projectId, prompt: 'a' });
      const item2 = queueService.add({ projectId, prompt: 'b' });
      db.prepare(
        `UPDATE queue_items SET status = 'in_progress', started_at = ? WHERE id = ?`,
      ).run(Date.now(), item1.id);
      db.prepare(
        `UPDATE queue_items SET status = 'in_progress', started_at = ? WHERE id = ?`,
      ).run(Date.now(), item2.id);

      const reverted = queueService.recoverInProgress();
      expect(reverted).toBe(2);

      const a = queueRepo.get(item1.id)!;
      const b = queueRepo.get(item2.id)!;
      expect(a.status).toBe('pending');
      expect(b.status).toBe('pending');
      expect(a.startedAt).toBeNull();
      expect(b.startedAt).toBeNull();
    });

    it('returns 0 when no in_progress rows exist', () => {
      expect(queueService.recoverInProgress()).toBe(0);
    });
  });
});
