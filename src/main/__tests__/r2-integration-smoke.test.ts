/**
 * R2 integration smoke (Task 21).
 *
 * Walks the full v3 Main stack end-to-end in one test:
 *   1. tmp ArenaRoot materialised (6 canonical subdirs).
 *   2. Migrations 001..011 applied against a fresh SQLite file under it.
 *   3. ProjectService.create('new') + onProjectCreated hook → the three
 *      system channels (`system_general` / `system_approval` /
 *      `system_minutes`) are auto-created.
 *   4. MessageService.append → StreamBridge outbound hook fires with a
 *      `stream:channel-message` carrying the inserted Message.
 *   5. ApprovalService.create → StreamBridge `stream:approval-created`;
 *      decide('approve') → `stream:approval-decided` with status='approved'.
 *   6. QueueService add → listByProject → cancel (pending→cancelled) →
 *      remove() still rejects (non-removable status).
 *   7. ProjectService.create({kind:'external', permissionMode:'auto'})
 *      → ExternalAutoForbiddenError.
 *   8. PermissionService.validateAccess: consensus path OK, /etc/passwd
 *      rejected even with the new project active.
 *   9. ConsensusFolderService.writeDocument → file exists, no stale
 *      `.tmp` left behind.
 *
 * The smoke is deliberately coarse — per-service contracts are covered
 * by their dedicated suites. Here we verify the wiring holds.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { runMigrations } from '../database/migrator';
import { migrations } from '../database/migrations';
import {
  ArenaRootService,
  type ArenaRootConfigAccessor,
} from '../arena/arena-root-service';
import { ProjectRepository } from '../projects/project-repository';
import {
  ProjectService,
  ExternalAutoForbiddenError,
} from '../projects/project-service';
import { ChannelRepository } from '../channels/channel-repository';
import { ChannelService } from '../channels/channel-service';
import { MessageRepository } from '../channels/message-repository';
import { MessageService } from '../channels/message-service';
import { ApprovalRepository } from '../approvals/approval-repository';
import { ApprovalService } from '../approvals/approval-service';
import { QueueRepository } from '../queue/queue-repository';
import { QueueService, QueueError } from '../queue/queue-service';
import { PermissionService } from '../files/permission-service';
import { ConsensusFolderService } from '../consensus/consensus-folder-service';
import { StreamBridge } from '../streams/stream-bridge';
import type { StreamEvent } from '../../shared/stream-events';

function makeTmpArenaRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rolestra-r2-smoke-'));
  return root;
}

function makeConfig(arenaRoot: string): ArenaRootConfigAccessor {
  const state = { arenaRoot };
  return {
    getSettings: () => state,
    updateSettings: (patch) => {
      if (patch.arenaRoot !== undefined) state.arenaRoot = patch.arenaRoot;
    },
  };
}

function seedProvider(db: Database.Database, id: string): void {
  const now = Date.now();
  db.prepare(
    `INSERT INTO providers (id, display_name, kind, config_json, created_at, updated_at)
     VALUES (?, ?, 'api', '{}', ?, ?)`,
  ).run(id, `Provider ${id}`, now, now);
}

describe('R2 integration smoke', () => {
  let arenaRoot: string;
  let arena: ArenaRootService;
  let db: Database.Database;

  beforeEach(async () => {
    arenaRoot = makeTmpArenaRoot();
    arena = new ArenaRootService(makeConfig(arenaRoot));
    await arena.ensure();

    db = new Database(arena.dbPath());
    db.pragma('foreign_keys = ON');
    runMigrations(db, migrations);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(arenaRoot, { recursive: true, force: true });
  });

  it('walks the full service graph via StreamBridge', async () => {
    // ── Assemble the full service graph ────────────────────────────
    const projectRepo = new ProjectRepository(db);
    const channelRepo = new ChannelRepository(db);
    const messageRepo = new MessageRepository(db);
    const approvalRepo = new ApprovalRepository(db);
    const queueRepo = new QueueRepository(db);

    const channelService = new ChannelService(channelRepo, projectRepo);
    const messageService = new MessageService(messageRepo);
    const approvalService = new ApprovalService(approvalRepo);
    const queueService = new QueueService(queueRepo);

    const projectService = new ProjectService(projectRepo, arena, {
      onProjectCreated: (p) => {
        channelService.createSystemChannels(p.id);
      },
    });

    const bridge = new StreamBridge();
    const events: StreamEvent[] = [];
    bridge.onOutbound((e) => events.push(e));
    bridge.connect({
      messages: messageService,
      approvals: approvalService,
      queue: queueService,
      queueItemLookup: (id) => {
        const row = queueRepo.get(id);
        return row ? { id: row.id, projectId: row.projectId } : null;
      },
      queueSnapshot: (projectId) => ({
        items: queueService.listByProject(projectId),
        paused: queueService.isPaused(projectId),
      }),
    });

    seedProvider(db, 'pr1');

    // ── 1. Project create auto-materialises the 3 system channels ──
    const project = await projectService.create({
      name: 'Smoke',
      kind: 'new',
      permissionMode: 'hybrid',
      initialMemberProviderIds: ['pr1'],
    });
    expect(project.slug.length).toBeGreaterThan(0);

    const channels = channelService.listByProject(project.id);
    const channelKinds = channels.map((c) => c.kind).sort();
    expect(channelKinds).toEqual([
      'system_approval',
      'system_general',
      'system_minutes',
    ]);

    const generalId = channels.find((c) => c.kind === 'system_general')!.id;

    // ── 2. Message append fans out through StreamBridge ─────────────
    messageService.append({
      channelId: generalId,
      meetingId: null,
      authorId: 'pr1',
      authorKind: 'member',
      role: 'assistant',
      content: 'Smoke test message',
      meta: null,
    });

    const msgEvents = events.filter((e) => e.type === 'stream:channel-message');
    expect(msgEvents.length).toBeGreaterThanOrEqual(1);

    // ── 3. Approval create + decide → bridge emits both events ──────
    const approval = approvalService.create({
      kind: 'cli_permission',
      projectId: project.id,
      channelId: generalId,
      meetingId: null,
      requesterId: 'pr1',
      payload: { summary: 'test' },
    });
    const decided = approvalService.decide(approval.id, 'approve');
    expect(decided.status).toBe('approved');

    const approvalEventTypes = events
      .filter(
        (e) =>
          e.type === 'stream:approval-created' ||
          e.type === 'stream:approval-decided',
      )
      .map((e) => e.type);
    expect(approvalEventTypes).toEqual([
      'stream:approval-created',
      'stream:approval-decided',
    ]);

    // ── 4. Queue: add → list → cancel → remove rejection ────────────
    const queueItem = queueService.add({
      projectId: project.id,
      prompt: 'run tests',
      targetChannelId: null,
    });
    expect(queueItem.status).toBe('pending');
    expect(queueService.listByProject(project.id)).toHaveLength(1);

    queueService.cancel(queueItem.id);
    const afterCancel = queueService.get(queueItem.id);
    expect(afterCancel?.status).toBe('cancelled');

    // Cancelled rows are not removable — audit preservation.
    expect(() => queueService.remove(queueItem.id)).toThrow(QueueError);

    // ── 5. Queue snapshot fans out as stream:queue-updated ─────────
    const queueEvents = events.filter((e) => e.type === 'stream:queue-updated');
    expect(queueEvents.length).toBeGreaterThanOrEqual(1);

    // ── 6. external + auto is rejected (spec §7.3 CA-1) ─────────────
    await expect(
      projectService.create({
        name: 'Forbidden',
        kind: 'external',
        externalPath: arenaRoot,
        permissionMode: 'auto',
      }),
    ).rejects.toThrow(ExternalAutoForbiddenError);

    // ── 7. PermissionService path-guard: consensus OK, /etc/passwd no ─
    const permission = new PermissionService(arena, {
      get: (id: string) => projectRepo.get(id),
    });
    const consensusFile = path.join(arena.consensusPath(), 'documents', 'x.md');
    expect(() => permission.validateAccess(consensusFile, project.id)).not.toThrow();
    expect(() =>
      permission.validateAccess('/etc/passwd', project.id),
    ).toThrow();

    // ── 8. Consensus folder: atomic write; no .tmp residue ─────────
    const consensus = new ConsensusFolderService(arena.consensusPath());
    await consensus.writeDocument('smoke.md', '# Smoke');
    const absoluteDoc = path.join(
      arena.consensusPath(),
      'documents',
      'smoke.md',
    );
    expect(fs.existsSync(absoluteDoc)).toBe(true);
    expect(fs.readFileSync(absoluteDoc, 'utf8')).toContain('# Smoke');
    const tmpSiblings = fs
      .readdirSync(path.dirname(absoluteDoc))
      .filter((n) => n.includes('.tmp.'));
    expect(tmpSiblings).toEqual([]);
  });
});
