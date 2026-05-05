/**
 * Unit tests for ApprovalService (R2 Task 13).
 *
 * Coverage:
 *   - create happy path: UUID id, status=pending, createdAt stamped,
 *     payload round-trip (object + null + undefined), `'created'` emit
 *   - decide approve/reject → terminal status + decidedAt + 'decided'
 *   - decide conditional → status collapses to 'approved' but the
 *     'decided' event still carries decision='conditional'
 *   - decide on already-decided row → AlreadyDecidedError
 *   - decide/expire/supersede on unknown id → ApprovalNotFoundError
 *   - supersede + expire leave the row in place (CB-7, no hard delete)
 *   - list(status?, projectId?) filters work independently and combined
 *   - listener throws do not break create/decide; warning is logged
 *
 * Each test provisions its own temp ArenaRoot + fresh on-disk SQLite,
 * matching the pattern used by Task 8/10/11 tests.
 */

import Database from 'better-sqlite3';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ArenaRootService,
  type ArenaRootConfigAccessor,
} from '../../arena/arena-root-service';
import { runMigrations } from '../../database/migrator';
import { migrations } from '../../database/migrations/index';
import { ProjectRepository } from '../../projects/project-repository';
import { ProjectService } from '../../projects/project-service';
import { ApprovalRepository } from '../approval-repository';
import {
  AlreadyDecidedError,
  APPROVAL_CREATED_EVENT,
  APPROVAL_DECIDED_EVENT,
  ApprovalNotFoundError,
  ApprovalService,
  type ApprovalDecidedPayload,
} from '../approval-service';
import type { ApprovalItem } from '../../../shared/approval-types';

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

describe('ApprovalService', () => {
  let arenaRoot: string;
  let arenaRootService: ArenaRootService;
  let db: Database.Database;
  let projectRepo: ProjectRepository;
  let projectService: ProjectService;
  let approvalRepo: ApprovalRepository;
  let approvalService: ApprovalService;

  beforeEach(async () => {
    arenaRoot = makeTmpDir('rolestra-task13-');
    arenaRootService = new ArenaRootService(createConfigStub(arenaRoot));
    await arenaRootService.ensure();

    const dbPath = arenaRootService.dbPath();
    db = new Database(dbPath);
    db.pragma('foreign_keys = ON');
    runMigrations(db, migrations);

    projectRepo = new ProjectRepository(db);
    projectService = new ProjectService(projectRepo, arenaRootService);
    approvalRepo = new ApprovalRepository(db);
    approvalService = new ApprovalService(approvalRepo);
  });

  afterEach(() => {
    db.close();
    cleanupDir(arenaRoot);
  });

  async function makeProject(name = 'ApprProj'): Promise<string> {
    const project = await projectService.create({
      name,
      kind: 'new',
      permissionMode: 'hybrid',
    });
    return project.id;
  }

  // ── create ─────────────────────────────────────────────────────────

  describe('create', () => {
    it('inserts a pending row with UUID id, createdAt, and null decided fields', () => {
      const item = approvalService.create({
        kind: 'cli_permission',
        payload: { tool: 'bash', command: 'ls' },
      });

      expect(item.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(item.kind).toBe('cli_permission');
      expect(item.status).toBe('pending');
      expect(typeof item.createdAt).toBe('number');
      expect(item.createdAt).toBeGreaterThan(0);
      expect(item.decidedAt).toBeNull();
      expect(item.decisionComment).toBeNull();
      expect(item.projectId).toBeNull();
      expect(item.channelId).toBeNull();
      expect(item.meetingId).toBeNull();
      expect(item.requesterId).toBeNull();
      expect(item.payload).toEqual({ tool: 'bash', command: 'ls' });
      expect(approvalRepo.get(item.id)).toEqual(item);
    });

    it('persists all four ApprovalKind values', async () => {
      const projectId = await makeProject();
      const kinds = [
        'cli_permission',
        'mode_transition',
        'review_outcome',
        'failure_report',
      ] as const;
      for (const kind of kinds) {
        const item = approvalService.create({ kind, projectId });
        expect(item.kind).toBe(kind);
        expect(approvalRepo.get(item.id)?.kind).toBe(kind);
      }
    });

    it('round-trips payload=null through JSON storage', () => {
      const item = approvalService.create({
        kind: 'mode_transition',
        payload: null,
      });
      const loaded = approvalRepo.get(item.id);
      expect(loaded?.payload).toBeNull();
      // Column is NOT NULL so the literal string "null" is stored.
      const raw = db
        .prepare('SELECT payload_json FROM approval_items WHERE id = ?')
        .get(item.id) as { payload_json: string };
      expect(raw.payload_json).toBe('null');
    });

    it('normalises missing payload to null (column is NOT NULL)', () => {
      const item = approvalService.create({ kind: 'failure_report' });
      expect(item.payload).toBeNull();
      const raw = db
        .prepare('SELECT payload_json FROM approval_items WHERE id = ?')
        .get(item.id) as { payload_json: string };
      expect(raw.payload_json).toBe('null');
    });

    it('round-trips a complex object payload', () => {
      const payload = {
        command: ['git', 'status'],
        cwd: '/tmp/x',
        nested: { level: 2, list: [1, 2, 3] },
      };
      const item = approvalService.create({
        kind: 'cli_permission',
        payload,
      });
      expect(approvalRepo.get(item.id)?.payload).toEqual(payload);
    });

    it('emits "created" event with the saved item', () => {
      const received: ApprovalItem[] = [];
      approvalService.on(APPROVAL_CREATED_EVENT, (item) => received.push(item));
      const item = approvalService.create({ kind: 'review_outcome' });
      expect(received).toHaveLength(1);
      expect(received[0]).toEqual(item);
    });
  });

  // ── decide ─────────────────────────────────────────────────────────

  describe('decide', () => {
    it('approve → status=approved, decidedAt stamped, comment stored', () => {
      const item = approvalService.create({ kind: 'cli_permission' });
      const before = Date.now();
      const updated = approvalService.decide(item.id, 'approve', 'looks good');
      expect(updated.status).toBe('approved');
      expect(updated.decisionComment).toBe('looks good');
      expect(typeof updated.decidedAt).toBe('number');
      expect(updated.decidedAt!).toBeGreaterThanOrEqual(before);
    });

    it('reject → status=rejected, comment stored', () => {
      const item = approvalService.create({ kind: 'cli_permission' });
      const updated = approvalService.decide(item.id, 'reject', 'too risky');
      expect(updated.status).toBe('rejected');
      expect(updated.decisionComment).toBe('too risky');
      expect(updated.decidedAt).not.toBeNull();
    });

    it('conditional collapses to status=approved but event carries raw decision', () => {
      const item = approvalService.create({ kind: 'cli_permission' });
      const decidedPayloads: ApprovalDecidedPayload[] = [];
      approvalService.on(APPROVAL_DECIDED_EVENT, (p) => decidedPayloads.push(p));

      const updated = approvalService.decide(
        item.id,
        'conditional',
        'only in /tmp',
      );

      // (a) Persisted status collapses to approved (spec §7.7).
      expect(updated.status).toBe('approved');
      expect(updated.decisionComment).toBe('only in /tmp');
      // (b) But the event carries decision='conditional' so a downstream
      //     listener can inject the condition as a system message.
      expect(decidedPayloads).toHaveLength(1);
      expect(decidedPayloads[0]!.decision).toBe('conditional');
      expect(decidedPayloads[0]!.comment).toBe('only in /tmp');
      expect(decidedPayloads[0]!.item.status).toBe('approved');
    });

    it('omitted comment stored as null', () => {
      const item = approvalService.create({ kind: 'mode_transition' });
      const updated = approvalService.decide(item.id, 'approve');
      expect(updated.decisionComment).toBeNull();
    });

    it('throws AlreadyDecidedError when target is not pending', () => {
      const item = approvalService.create({ kind: 'cli_permission' });
      approvalService.decide(item.id, 'approve');
      expect(() => approvalService.decide(item.id, 'reject')).toThrow(
        AlreadyDecidedError,
      );
      // Status must remain approved — second decision did not rewrite.
      expect(approvalRepo.get(item.id)?.status).toBe('approved');
    });

    it('throws AlreadyDecidedError for rejected items too', () => {
      const item = approvalService.create({ kind: 'cli_permission' });
      approvalService.decide(item.id, 'reject');
      expect(() => approvalService.decide(item.id, 'approve')).toThrow(
        AlreadyDecidedError,
      );
    });

    it('throws ApprovalNotFoundError on unknown id', () => {
      expect(() =>
        approvalService.decide('no-such-id', 'approve'),
      ).toThrow(ApprovalNotFoundError);
    });

    it('emits "decided" once with {item, decision, comment}', () => {
      const item = approvalService.create({ kind: 'mode_transition' });
      const received: ApprovalDecidedPayload[] = [];
      approvalService.on(APPROVAL_DECIDED_EVENT, (p) => received.push(p));

      approvalService.decide(item.id, 'approve', 'ok');
      expect(received).toHaveLength(1);
      expect(received[0]!.decision).toBe('approve');
      expect(received[0]!.comment).toBe('ok');
      expect(received[0]!.item.id).toBe(item.id);
      expect(received[0]!.item.status).toBe('approved');
    });
  });

  // ── expire / supersede ─────────────────────────────────────────────

  describe('expire / supersede', () => {
    it('expire sets status=expired with decidedAt stamped (audit preserved)', () => {
      const item = approvalService.create({ kind: 'cli_permission' });
      const before = Date.now();
      approvalService.expire(item.id);
      const after = approvalRepo.get(item.id);
      expect(after?.status).toBe('expired');
      expect(after?.decidedAt).not.toBeNull();
      expect(after!.decidedAt!).toBeGreaterThanOrEqual(before);
      // Audit row STILL exists — no hard delete.
      expect(after?.id).toBe(item.id);
      expect(after?.createdAt).toBe(item.createdAt);
    });

    it('supersede sets status=superseded with row preserved', () => {
      const item = approvalService.create({ kind: 'cli_permission' });
      approvalService.supersede(item.id);
      const after = approvalRepo.get(item.id);
      expect(after?.status).toBe('superseded');
      // Row is still in the table (CB-7 audit preservation).
      const count = (
        db
          .prepare('SELECT COUNT(*) AS c FROM approval_items WHERE id = ?')
          .get(item.id) as { c: number }
      ).c;
      expect(count).toBe(1);
    });

    it('expire throws ApprovalNotFoundError on unknown id', () => {
      expect(() => approvalService.expire('no-such-id')).toThrow(
        ApprovalNotFoundError,
      );
    });

    it('supersede throws ApprovalNotFoundError on unknown id', () => {
      expect(() => approvalService.supersede('no-such-id')).toThrow(
        ApprovalNotFoundError,
      );
    });

    it('expire/supersede do NOT emit "decided" (lifecycle, not decision)', () => {
      const a = approvalService.create({ kind: 'cli_permission' });
      const b = approvalService.create({ kind: 'cli_permission' });
      const received: ApprovalDecidedPayload[] = [];
      approvalService.on(APPROVAL_DECIDED_EVENT, (p) => received.push(p));
      approvalService.expire(a.id);
      approvalService.supersede(b.id);
      expect(received).toHaveLength(0);
    });
  });

  // ── list / get ─────────────────────────────────────────────────────

  describe('list / get', () => {
    it('get returns null for unknown id', () => {
      expect(approvalService.get('nope')).toBeNull();
    });

    it('list() returns all rows newest-first', async () => {
      const first = approvalService.create({ kind: 'cli_permission' });
      await new Promise((r) => setTimeout(r, 2));
      const second = approvalService.create({ kind: 'mode_transition' });
      await new Promise((r) => setTimeout(r, 2));
      const third = approvalService.create({ kind: 'failure_report' });

      const all = approvalService.list();
      expect(all.map((i) => i.id)).toEqual([third.id, second.id, first.id]);
    });

    it('list({status}) filters by status', () => {
      const a = approvalService.create({ kind: 'cli_permission' });
      const b = approvalService.create({ kind: 'cli_permission' });
      const c = approvalService.create({ kind: 'cli_permission' });
      approvalService.decide(a.id, 'approve');
      approvalService.decide(b.id, 'reject');
      // c stays pending

      const pending = approvalService.list({ status: 'pending' });
      expect(pending.map((i) => i.id)).toEqual([c.id]);

      const approved = approvalService.list({ status: 'approved' });
      expect(approved.map((i) => i.id)).toEqual([a.id]);

      const rejected = approvalService.list({ status: 'rejected' });
      expect(rejected.map((i) => i.id)).toEqual([b.id]);
    });

    it('list({projectId}) filters by project scope', async () => {
      const p1 = await makeProject('P1');
      const p2 = await makeProject('P2');
      const inP1 = approvalService.create({
        kind: 'cli_permission',
        projectId: p1,
      });
      approvalService.create({ kind: 'cli_permission', projectId: p2 });
      approvalService.create({ kind: 'cli_permission' }); // no project

      const p1Only = approvalService.list({ projectId: p1 });
      expect(p1Only.map((i) => i.id)).toEqual([inP1.id]);
    });

    it('list({status, projectId}) ANDs the filters', async () => {
      const projectId = await makeProject();
      const keep = approvalService.create({
        kind: 'cli_permission',
        projectId,
      });
      approvalService.decide(keep.id, 'approve');
      // Pending row in same project — status filter should drop it.
      approvalService.create({ kind: 'cli_permission', projectId });
      // Approved row in a DIFFERENT project — projectId filter should drop it.
      const other = await makeProject('Other');
      const otherApproved = approvalService.create({
        kind: 'cli_permission',
        projectId: other,
      });
      approvalService.decide(otherApproved.id, 'approve');

      const hits = approvalService.list({
        status: 'approved',
        projectId,
      });
      expect(hits.map((i) => i.id)).toEqual([keep.id]);
    });

    it('list includes expired/superseded rows (audit preservation)', () => {
      const a = approvalService.create({ kind: 'cli_permission' });
      const b = approvalService.create({ kind: 'cli_permission' });
      approvalService.expire(a.id);
      approvalService.supersede(b.id);
      expect(approvalService.list({ status: 'expired' }).map((i) => i.id)).toEqual([
        a.id,
      ]);
      expect(
        approvalService.list({ status: 'superseded' }).map((i) => i.id),
      ).toEqual([b.id]);
    });
  });

  // ── listener isolation ─────────────────────────────────────────────

  describe('listener isolation', () => {
    it('create still returns the item when the "created" listener throws', () => {
      approvalService.on(APPROVAL_CREATED_EVENT, () => {
        throw new Error('created listener exploded');
      });
      const warnSpy = vi
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);

      try {
        const item = approvalService.create({ kind: 'cli_permission' });
        expect(item.id).toMatch(/^[0-9a-f-]{36}$/);
        expect(approvalRepo.get(item.id)).toEqual(item);
        expect(warnSpy).toHaveBeenCalledTimes(1);
        const [marker, payload] = warnSpy.mock.calls[0]!;
        expect(marker).toBe('[rolestra.approvals] listener threw:');
        expect(payload).toMatchObject({
          origin: 'create',
          name: 'Error',
          message: 'created listener exploded',
        });
      } finally {
        warnSpy.mockRestore();
      }
    });

    it('decide still returns the updated item when the "decided" listener throws', () => {
      const item = approvalService.create({ kind: 'cli_permission' });
      approvalService.on(APPROVAL_DECIDED_EVENT, () => {
        throw new Error('decided listener exploded');
      });
      const warnSpy = vi
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);

      try {
        const updated = approvalService.decide(item.id, 'approve', 'ok');
        expect(updated.status).toBe('approved');
        expect(updated.decisionComment).toBe('ok');
        expect(warnSpy).toHaveBeenCalledTimes(1);
        const [marker, payload] = warnSpy.mock.calls[0]!;
        expect(marker).toBe('[rolestra.approvals] listener threw:');
        expect(payload).toMatchObject({
          origin: 'decide',
          name: 'Error',
          message: 'decided listener exploded',
        });
      } finally {
        warnSpy.mockRestore();
      }
    });
  });

  // R12-C2 T10b: rehydrateConsensusTimers describe 블록 통째 삭제 — 옛 SSM
  // DONE sign-off approval 흐름 자체가 새 phase loop 모델로 폐기됨.
});
