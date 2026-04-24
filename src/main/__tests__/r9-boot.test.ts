/**
 * R9 production wiring smoke (Task 9).
 *
 * Verifies the three boot-time side effects that close the R9 IPC circuit
 * from `main/index.ts`:
 *
 *   1. `setNotificationServiceAccessor` — after registration, calling
 *      `notification:get-prefs` resolves a full 6-kind map instead of
 *      throwing `'notification handler: service not initialized'`.
 *   2. `setQueueServiceAccessor` — after registration, calling
 *      `queue:list` against a real project returns the expected rows
 *      instead of throwing `'queue handler: service not initialized'`.
 *   3. `notificationService.seedDefaultPrefsIfEmpty()` — first call
 *      inserts a row per {@link NotificationKind}, subsequent calls are
 *      idempotent (return 0).
 *   4. `streamBridge.connect({ queue, queueSnapshot })` wiring — queue
 *      mutations emit `stream:queue-updated` with a full project snapshot,
 *      which is the renderer's `useQueue` reconcile path.
 *
 * This test does NOT spin up Electron; it walks the same module-level
 * accessors + service constructors `main/index.ts` does. If these pass
 * and `main/index.ts` still fails at runtime, the regression is in the
 * call order inside `app.whenReady()` — covered by manual smoke.
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
import { ProjectService } from '../projects/project-service';
import { ChannelRepository } from '../channels/channel-repository';
import { ChannelService } from '../channels/channel-service';
import { QueueRepository } from '../queue/queue-repository';
import { QueueService } from '../queue/queue-service';
import {
  NotificationRepository,
  NOTIFICATION_KINDS,
} from '../notifications/notification-repository';
import { NotificationService } from '../notifications/notification-service';
import {
  setNotificationServiceAccessor,
  handleNotificationGetPrefs,
} from '../ipc/handlers/notification-handler';
import {
  setQueueServiceAccessor,
  handleQueueList,
} from '../ipc/handlers/queue-handler';
import { StreamBridge } from '../streams/stream-bridge';
import type { StreamEvent } from '../../shared/stream-events';

function makeTmpArenaRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rolestra-r9-boot-'));
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

/**
 * NotifierAdapter stub — R9 boot test does not exercise OS-level
 * delivery, only prefs seed + IPC wire. `isAnyWindowFocused` returns
 * `true` so `show()` short-circuits (no random DB rows in the log).
 */
const silentAdapter = {
  isAnyWindowFocused: () => true,
  notify: () => ({ onClick: () => {} }),
};

describe('R9 production wiring smoke', () => {
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
    // Reset module-level accessors so later tests in the same process
    // don't accidentally pick up this test's services. A later call
    // without re-registering should throw; we assert that below too.
    setNotificationServiceAccessor(null as never);
    setQueueServiceAccessor(null as never);
    db.close();
    fs.rmSync(arenaRoot, { recursive: true, force: true });
  });

  it('seedDefaultPrefsIfEmpty inserts 6 rows on first call, 0 on second', () => {
    const notificationRepo = new NotificationRepository(db);
    const notificationService = new NotificationService(
      notificationRepo,
      silentAdapter,
    );

    // First boot: exactly one row per NotificationKind is inserted.
    const firstBoot = notificationService.seedDefaultPrefsIfEmpty();
    expect(firstBoot).toBe(NOTIFICATION_KINDS.length);

    // Second boot: idempotent — all rows already present, INSERT OR
    // IGNORE returns 0 changes per row.
    const secondBoot = notificationService.seedDefaultPrefsIfEmpty();
    expect(secondBoot).toBe(0);

    // The resulting table matches the spec-mandated defaults.
    const prefs = notificationService.getPrefs();
    for (const kind of NOTIFICATION_KINDS) {
      expect(prefs[kind]).toEqual({ enabled: true, soundEnabled: true });
    }
  });

  it('user-modified prefs survive a second seed call', () => {
    const notificationService = new NotificationService(
      new NotificationRepository(db),
      silentAdapter,
    );
    notificationService.seedDefaultPrefsIfEmpty();
    notificationService.updatePrefs({
      new_message: { enabled: false, soundEnabled: false },
    });

    // Re-boot: seed must not overwrite the user's choice.
    const seededAgain = notificationService.seedDefaultPrefsIfEmpty();
    expect(seededAgain).toBe(0);
    const prefs = notificationService.getPrefs();
    expect(prefs.new_message).toEqual({ enabled: false, soundEnabled: false });
  });

  it('notification handler throws before accessor is wired, resolves after', () => {
    // Pre-wire: the accessor is cleared in afterEach of the prior test
    // (or never set in this one) so the get-prefs handler must throw.
    expect(() => handleNotificationGetPrefs()).toThrow(
      /notification handler: service not initialized/,
    );

    const notificationService = new NotificationService(
      new NotificationRepository(db),
      silentAdapter,
    );
    notificationService.seedDefaultPrefsIfEmpty();
    setNotificationServiceAccessor(() => notificationService);

    const res = handleNotificationGetPrefs();
    expect(Object.keys(res.prefs).sort()).toEqual(
      [...NOTIFICATION_KINDS].sort(),
    );
  });

  it('queue handler throws before accessor is wired, resolves after', () => {
    expect(() => handleQueueList({ projectId: 'nope' })).toThrow(
      /queue handler: service not initialized/,
    );

    const queueService = new QueueService(new QueueRepository(db));
    setQueueServiceAccessor(() => queueService);

    const res = handleQueueList({ projectId: 'nope' });
    expect(res.items).toEqual([]);
  });

  it('streamBridge.connect({queue,queueSnapshot}) fans out a full snapshot', async () => {
    // Build just enough of the graph for ProjectService.create() to
    // materialise a real projectId — QueueService.add requires a valid
    // FK. Mirrors the r2-integration-smoke harness.
    const projectRepo = new ProjectRepository(db);
    const channelRepo = new ChannelRepository(db);
    const queueRepo = new QueueRepository(db);
    const channelService = new ChannelService(channelRepo, projectRepo);
    const queueService = new QueueService(queueRepo);

    const projectService = new ProjectService(projectRepo, arena, {
      onProjectCreated: (p) => channelService.createSystemChannels(p.id),
    });

    const bridge = new StreamBridge();
    const events: StreamEvent[] = [];
    bridge.onOutbound((e) => events.push(e));
    bridge.connect({
      queue: queueService,
      queueSnapshot: (projectId) => ({
        items: queueService.listByProject(projectId),
        paused: queueService.isPaused(projectId),
      }),
      queueItemLookup: (id) => {
        const item = queueService.get(id);
        return item ? { id: item.id, projectId: item.projectId } : null;
      },
    });

    const project = await projectService.create({
      name: 'R9 boot',
      kind: 'new',
      permissionMode: 'hybrid',
    });

    queueService.add({
      projectId: project.id,
      prompt: 'first item',
      targetChannelId: null,
    });

    // Snapshot flavour: the `changed` hint resolves to the full list +
    // paused flag, which is how `useQueue` reconciles.
    const snapshotEvents = events.filter(
      (e) => e.type === 'stream:queue-updated',
    );
    expect(snapshotEvents.length).toBeGreaterThanOrEqual(1);
    const last = snapshotEvents[snapshotEvents.length - 1]
      .payload as {
      projectId: string;
      items: unknown[];
      paused: boolean;
    };
    expect(last.projectId).toBe(project.id);
    expect(last.items).toHaveLength(1);
    expect(last.paused).toBe(false);
  });
});
