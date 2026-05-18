/**
 * DesignCheckpointRepository — R12-C2 P6 D3.
 *
 * Invariants under test:
 * 1. design_checkpoint CRUD — insert + findById + listByMeeting + updateDecision.
 * 2. design_checkpoint_preference CRUD — (project_id PK) UNIQUE, upsert path.
 * 3. CHECK constraint — kind accepts 'wireframe', rejects other values (e.g. 'mockup').
 * 4. CHECK constraint — status accepts the 4 enum members
 *    ('pending' | 'continued' | 'revision_requested' | 'auto_skipped').
 * 5. CHECK constraint — preference.wireframe_auto_skip accepts 0/1 only.
 * 6. FK CASCADE — deleting the parent project / meeting / channel removes
 *    related design_checkpoint rows; deleting the parent project also
 *    removes design_checkpoint_preference rows.
 * 7. Nullable columns — user_note, payload_json, decided_at allow NULL.
 */

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runMigrations } from '../../database/migrator';
import { migrations } from '../../database/migrations/index';
import type { DesignCheckpoint } from '../../../shared/design-checkpoint-types';
import { DesignCheckpointRepository } from '../design-checkpoint-repository';

const NOW = 1_700_000_000_000;

let db: Database.Database;
let repo: DesignCheckpointRepository;

function seedProject(id = 'project-1', slug = 'project-1'): void {
  db.prepare(
    `INSERT INTO projects (
       id, slug, name, description, kind, external_link,
       permission_mode, autonomy_mode, status, created_at, archived_at
     ) VALUES (?, ?, ?, '', 'new', NULL, 'approval', 'manual', 'active', ?, NULL)`,
  ).run(id, slug, slug, NOW);
}

function seedChannel(
  id = 'channel-design',
  projectId: string | null = 'project-1',
): void {
  db.prepare(
    `INSERT INTO channels (
       id, project_id, name, kind, read_only, created_at
     ) VALUES (?, ?, ?, 'user', 0, ?)`,
  ).run(id, projectId, id, NOW);
}

function seedMeeting(
  id = 'meeting-1',
  channelId = 'channel-design',
): void {
  db.prepare(
    `INSERT INTO meetings (
       id, channel_id, topic, state, state_snapshot_json, started_at, ended_at, outcome
     ) VALUES (?, ?, '', 'gather', NULL, ?, NULL, NULL)`,
  ).run(id, channelId, NOW);
}

function makeCheckpoint(
  overrides: Partial<DesignCheckpoint> = {},
): DesignCheckpoint {
  return {
    id: 'checkpoint-1',
    projectId: 'project-1',
    meetingId: 'meeting-1',
    channelId: 'channel-design',
    kind: 'wireframe',
    status: 'pending',
    title: '와이어프레임 확인',
    documentPath: '/project/consensus/meetings/meeting-1/minutes-1.md',
    documentBodySnapshot: '# wireframe minutes',
    userNote: null,
    payloadJson: null,
    createdAt: NOW,
    decidedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db, migrations);
  repo = new DesignCheckpointRepository(db);
  seedProject('project-1');
  seedChannel('channel-design', 'project-1');
  seedMeeting('meeting-1', 'channel-design');
});

afterEach(() => {
  db.close();
});

describe('DesignCheckpointRepository (R12-C2 P6 D3)', () => {
  describe('insert + findById', () => {
    it('writes all columns and reads them back via findById', () => {
      const checkpoint = makeCheckpoint({
        userNote: '메모',
        payloadJson: '{"source":"design_wireframe_minutes"}',
        decidedAt: NOW + 10,
        status: 'continued',
      });
      repo.insert(checkpoint);

      const loaded = repo.findById('checkpoint-1');
      expect(loaded).toEqual(checkpoint);
    });

    it('returns null when the id is not present', () => {
      expect(repo.findById('missing')).toBeNull();
    });

    it('allows user_note / payload_json / decided_at to be NULL', () => {
      repo.insert(makeCheckpoint());
      const loaded = repo.findById('checkpoint-1');
      expect(loaded?.userNote).toBeNull();
      expect(loaded?.payloadJson).toBeNull();
      expect(loaded?.decidedAt).toBeNull();
    });
  });

  describe('listByMeeting', () => {
    it('returns checkpoints scoped to (project_id, meeting_id) ordered by created_at asc', () => {
      repo.insert(makeCheckpoint({ id: 'cp-a', createdAt: NOW + 20 }));
      repo.insert(makeCheckpoint({ id: 'cp-b', createdAt: NOW + 10 }));
      repo.insert(makeCheckpoint({ id: 'cp-c', createdAt: NOW + 30 }));

      const rows = repo.listByMeeting({
        projectId: 'project-1',
        meetingId: 'meeting-1',
      });
      expect(rows.map((row) => row.id)).toEqual(['cp-b', 'cp-a', 'cp-c']);
    });

    it('filters by kind when supplied', () => {
      repo.insert(makeCheckpoint({ id: 'cp-a' }));
      const rows = repo.listByMeeting({
        projectId: 'project-1',
        meetingId: 'meeting-1',
        kind: 'wireframe',
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.id).toBe('cp-a');
    });

    it('excludes rows belonging to other meetings/projects', () => {
      // Close the seeded meeting first — the partial unique index
      // idx_meetings_active_per_channel allows only one active meeting per channel.
      db.prepare(`UPDATE meetings SET ended_at = ? WHERE id = ?`).run(
        NOW + 1,
        'meeting-1',
      );
      seedMeeting('meeting-2', 'channel-design');
      repo.insert(makeCheckpoint({ id: 'cp-mine' }));
      repo.insert(
        makeCheckpoint({ id: 'cp-other', meetingId: 'meeting-2' }),
      );

      const rows = repo.listByMeeting({
        projectId: 'project-1',
        meetingId: 'meeting-1',
      });
      expect(rows.map((row) => row.id)).toEqual(['cp-mine']);
    });
  });

  describe('updateDecision', () => {
    it('promotes a pending checkpoint to the supplied terminal status', () => {
      repo.insert(makeCheckpoint());
      const updated = repo.updateDecision({
        id: 'checkpoint-1',
        status: 'revision_requested',
        userNote: 'CTA 위치 조정',
        decidedAt: NOW + 50,
      });
      expect(updated?.status).toBe('revision_requested');
      expect(updated?.userNote).toBe('CTA 위치 조정');
      expect(updated?.decidedAt).toBe(NOW + 50);
    });

    it('returns null and does not mutate when the row is already decided', () => {
      repo.insert(makeCheckpoint({ status: 'continued', decidedAt: NOW + 1 }));
      const updated = repo.updateDecision({
        id: 'checkpoint-1',
        status: 'auto_skipped',
        userNote: null,
        decidedAt: NOW + 99,
      });
      expect(updated).toBeNull();

      const loaded = repo.findById('checkpoint-1');
      expect(loaded?.status).toBe('continued');
      expect(loaded?.decidedAt).toBe(NOW + 1);
    });

    it('returns null when the id is missing', () => {
      expect(
        repo.updateDecision({
          id: 'missing',
          status: 'continued',
          userNote: null,
          decidedAt: NOW,
        }),
      ).toBeNull();
    });
  });

  describe('CHECK constraints', () => {
    it('rejects unknown kind values (e.g. mockup)', () => {
      expect(() =>
        // @ts-expect-error -- intentionally bypass typing to verify CHECK
        repo.insert(makeCheckpoint({ kind: 'mockup' })),
      ).toThrow(/CHECK constraint failed/i);
    });

    it('accepts every status enum member through updateDecision', () => {
      const statuses = [
        'continued',
        'revision_requested',
        'auto_skipped',
      ] as const;
      for (const status of statuses) {
        const id = `cp-${status}`;
        repo.insert(makeCheckpoint({ id }));
        const updated = repo.updateDecision({
          id,
          status,
          userNote: null,
          decidedAt: NOW + 1,
        });
        expect(updated?.status).toBe(status);
      }
    });

    it('rejects unknown status values', () => {
      expect(() =>
        // @ts-expect-error -- intentionally bypass typing to verify CHECK
        repo.insert(makeCheckpoint({ status: 'rejected' })),
      ).toThrow(/CHECK constraint failed/i);
    });

    it('rejects wireframe_auto_skip values outside {0,1}', () => {
      expect(() =>
        db
          .prepare(
            `INSERT INTO design_checkpoint_preference (
               project_id, wireframe_auto_skip, updated_at
             ) VALUES (?, ?, ?)`,
          )
          .run('project-1', 2, NOW),
      ).toThrow(/CHECK constraint failed/i);
    });
  });

  describe('design_checkpoint_preference CRUD', () => {
    it('isWireframeAutoSkipEnabled returns false when no row exists', () => {
      expect(repo.isWireframeAutoSkipEnabled('project-1')).toBe(false);
    });

    it('setWireframeAutoSkip inserts then upserts on conflict (project_id PK)', () => {
      repo.setWireframeAutoSkip({
        projectId: 'project-1',
        enabled: true,
        updatedAt: NOW + 1,
      });
      expect(repo.isWireframeAutoSkipEnabled('project-1')).toBe(true);

      repo.setWireframeAutoSkip({
        projectId: 'project-1',
        enabled: false,
        updatedAt: NOW + 2,
      });
      expect(repo.isWireframeAutoSkipEnabled('project-1')).toBe(false);

      const rowCount = db
        .prepare(
          `SELECT COUNT(*) AS n FROM design_checkpoint_preference WHERE project_id = ?`,
        )
        .get('project-1') as { n: number };
      expect(rowCount.n).toBe(1);
    });

    it('scopes preferences per project_id', () => {
      seedProject('project-2', 'project-2');
      repo.setWireframeAutoSkip({
        projectId: 'project-1',
        enabled: true,
        updatedAt: NOW,
      });
      expect(repo.isWireframeAutoSkipEnabled('project-1')).toBe(true);
      expect(repo.isWireframeAutoSkipEnabled('project-2')).toBe(false);
    });
  });

  describe('FK CASCADE', () => {
    it('removes checkpoints when the parent project is deleted', () => {
      repo.insert(makeCheckpoint());
      repo.setWireframeAutoSkip({
        projectId: 'project-1',
        enabled: true,
        updatedAt: NOW,
      });

      db.prepare(`DELETE FROM projects WHERE id = ?`).run('project-1');

      expect(repo.findById('checkpoint-1')).toBeNull();
      expect(repo.isWireframeAutoSkipEnabled('project-1')).toBe(false);
    });

    it('removes checkpoints when the parent meeting is deleted', () => {
      repo.insert(makeCheckpoint());
      db.prepare(`DELETE FROM meetings WHERE id = ?`).run('meeting-1');
      expect(repo.findById('checkpoint-1')).toBeNull();
    });

    it('removes checkpoints when the parent channel is deleted', () => {
      repo.insert(makeCheckpoint());
      // deleting the channel also cascades the meeting (channel FK on meetings)
      db.prepare(`DELETE FROM channels WHERE id = ?`).run('channel-design');
      expect(repo.findById('checkpoint-1')).toBeNull();
    });
  });

  describe('withTransaction', () => {
    it('runs the callback inside a transaction and returns its value', () => {
      const result = repo.withTransaction(() => {
        repo.insert(makeCheckpoint({ id: 'cp-tx-1' }));
        repo.insert(makeCheckpoint({ id: 'cp-tx-2' }));
        return 'ok';
      });
      expect(result).toBe('ok');
      expect(repo.findById('cp-tx-1')).not.toBeNull();
      expect(repo.findById('cp-tx-2')).not.toBeNull();
    });

    it('rolls back on throw — no rows are persisted', () => {
      expect(() =>
        repo.withTransaction(() => {
          repo.insert(makeCheckpoint({ id: 'cp-tx-rollback' }));
          throw new Error('boom');
        }),
      ).toThrow('boom');
      expect(repo.findById('cp-tx-rollback')).toBeNull();
    });
  });
});
