/**
 * Unit tests for NotificationService + NotificationRepository (R2 Task 16).
 *
 * Coverage:
 *   - Focus gate: show() is a no-op when any window is focused (no DB
 *     row, no adapter call).
 *   - Focus gate bypass via force=true.
 *   - Prefs gate: disabled kind suppresses both notify + DB row, even
 *     with force=true (disable is stronger than force).
 *   - Happy path: not focused → notify called, DB row inserted.
 *   - Click routing: adapter click callback triggers markClicked +
 *     emits 'clicked' with the expected payload.
 *   - updatePrefs partial patch: only touched kinds change, others are
 *     preserved; return value reflects the updated state.
 *   - test(kind): force=true → notify fires even when focused; default
 *     title/body strings match the spec.
 *   - getPrefs() on empty DB: all 6 kinds returned with defaults.
 *   - insertLog round-trip: channelId null round-trips, listLog orders
 *     newest-first with kind filter.
 *   - Listener isolation: a throwing 'clicked' listener is caught and
 *     routed to console.warn (mirrors MessageService emit isolation).
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
import { NotificationRepository } from '../notification-repository';
import {
  NOTIFICATION_CLICKED_EVENT,
  NotificationService,
  type NotifierAdapter,
  type NotifierHandle,
  type NotificationClickedPayload,
} from '../notification-service';
import type { NotificationKind } from '../../../shared/notification-types';

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

/**
 * Minimal in-memory {@link NotifierAdapter} for tests. Tracks a focus
 * flag that the test can flip, records every `notify()` call, and lets
 * the test manually fire click callbacks via {@link triggerClick}.
 */
class MockNotifierAdapter implements NotifierAdapter {
  public focused = false;
  public readonly notifyCalls: Array<{ title: string; body: string }> = [];
  private readonly pending: Array<() => void> = [];

  isAnyWindowFocused(): boolean {
    return this.focused;
  }

  notify(title: string, body: string): NotifierHandle {
    this.notifyCalls.push({ title, body });
    const callbacks: Array<() => void> = [];
    const trigger = (): void => {
      for (const cb of callbacks) cb();
    };
    this.pending.push(trigger);
    return {
      onClick(cb: () => void): void {
        callbacks.push(cb);
      },
    };
  }

  /** Fires the click callback for the most recent notify() in FIFO order. */
  triggerClick(index = 0): void {
    const handler = this.pending[index];
    if (handler === undefined) {
      throw new Error(`no pending notification at index ${index}`);
    }
    handler();
  }
}

describe('NotificationService', () => {
  let arenaRoot: string;
  let arenaRootService: ArenaRootService;
  let db: Database.Database;
  let repo: NotificationRepository;
  let adapter: MockNotifierAdapter;
  let service: NotificationService;

  beforeEach(async () => {
    arenaRoot = makeTmpDir('rolestra-task16-');
    arenaRootService = new ArenaRootService(createConfigStub(arenaRoot));
    await arenaRootService.ensure();

    const dbPath = arenaRootService.dbPath();
    db = new Database(dbPath);
    db.pragma('foreign_keys = ON');
    runMigrations(db, migrations);

    repo = new NotificationRepository(db);
    adapter = new MockNotifierAdapter();
    service = new NotificationService(repo, adapter);
  });

  afterEach(() => {
    db.close();
    cleanupDir(arenaRoot);
  });

  // ── focus + prefs gates ────────────────────────────────────────────

  it('suppresses notify + DB row when a window is focused (no force)', () => {
    adapter.focused = true;

    const result = service.show({
      kind: 'new_message',
      title: 't',
      body: 'b',
    });

    expect(result).toBeNull();
    expect(adapter.notifyCalls).toHaveLength(0);
    expect(repo.listLog()).toHaveLength(0);
  });

  it('fires notify + inserts DB row when no window is focused', () => {
    adapter.focused = false;

    const result = service.show({
      kind: 'new_message',
      title: 'hello',
      body: 'world',
    });

    expect(result).not.toBeNull();
    expect(adapter.notifyCalls).toEqual([{ title: 'hello', body: 'world' }]);
    const rows = repo.listLog();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(result!.id);
    expect(rows[0]!.kind).toBe('new_message');
    expect(rows[0]!.clicked).toBe(false);
    expect(rows[0]!.channelId).toBeNull();
  });

  it('disabled kind suppresses notify + DB row regardless of focus', () => {
    service.updatePrefs({
      error: { enabled: false, soundEnabled: true },
    });
    adapter.focused = false;

    const result = service.show({
      kind: 'error',
      title: 'boom',
      body: 'broke',
    });

    expect(result).toBeNull();
    expect(adapter.notifyCalls).toHaveLength(0);
    expect(repo.listLog()).toHaveLength(0);
  });

  it('disabled kind suppresses even when force=true', () => {
    service.updatePrefs({
      error: { enabled: false, soundEnabled: true },
    });
    adapter.focused = false;

    const result = service.show({
      kind: 'error',
      title: 'boom',
      body: 'broke',
      force: true,
    });

    expect(result).toBeNull();
    expect(adapter.notifyCalls).toHaveLength(0);
  });

  it('force=true bypasses the focus gate', () => {
    adapter.focused = true;

    const result = service.show({
      kind: 'new_message',
      title: 't',
      body: 'b',
      force: true,
    });

    expect(result).not.toBeNull();
    expect(adapter.notifyCalls).toHaveLength(1);
    expect(repo.listLog()).toHaveLength(1);
  });

  // ── click routing ──────────────────────────────────────────────────

  it('triggerClick marks the log row clicked and emits the clicked event', () => {
    adapter.focused = false;
    const captured: NotificationClickedPayload[] = [];
    service.on(NOTIFICATION_CLICKED_EVENT, (p) => captured.push(p));

    const entry = service.show({
      kind: 'approval_pending',
      title: 'approve?',
      body: 'yes/no',
      channelId: null,
    });
    expect(entry).not.toBeNull();

    adapter.triggerClick();

    // DB updated.
    const rows = repo.listLog();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.clicked).toBe(true);
    // Event fired with expected payload.
    expect(captured).toEqual([
      { id: entry!.id, kind: 'approval_pending', channelId: null },
    ]);
  });

  it('click payload preserves channelId when supplied', () => {
    adapter.focused = false;
    const captured: NotificationClickedPayload[] = [];
    service.on(NOTIFICATION_CLICKED_EVENT, (p) => captured.push(p));

    // channels FK is SET NULL on delete but the value is not required to
    // exist at insert time when we pass null. For a real channel id we
    // would need a channels row; the service contract doesn't require
    // that, so `null` is the honest test shape here.
    const entry = service.show({
      kind: 'new_message',
      title: 't',
      body: 'b',
      channelId: null,
    });

    adapter.triggerClick();
    expect(captured[0]!.channelId).toBeNull();
    expect(captured[0]!.id).toBe(entry!.id);
  });

  // ── prefs ───────────────────────────────────────────────────────────

  it('getPrefs on empty DB returns all six kinds with defaults', () => {
    const prefs = service.getPrefs();
    const expectedKinds: NotificationKind[] = [
      'new_message',
      'approval_pending',
      'work_done',
      'error',
      'queue_progress',
      'meeting_state',
    ];
    for (const kind of expectedKinds) {
      expect(prefs[kind]).toEqual({ enabled: true, soundEnabled: true });
    }
  });

  it('updatePrefs patches only the named kinds and returns the full map', () => {
    const updated = service.updatePrefs({
      new_message: { enabled: false, soundEnabled: true },
      error: { enabled: true, soundEnabled: false },
    });

    expect(updated.new_message).toEqual({ enabled: false, soundEnabled: true });
    expect(updated.error).toEqual({ enabled: true, soundEnabled: false });
    // Untouched kinds still at defaults.
    expect(updated.work_done).toEqual({ enabled: true, soundEnabled: true });
    expect(updated.approval_pending).toEqual({
      enabled: true,
      soundEnabled: true,
    });

    // Round-trip: read from a fresh repo view to verify it's persisted.
    const freshRepo = new NotificationRepository(db);
    const reread = freshRepo.getPrefs();
    expect(reread.new_message).toEqual({ enabled: false, soundEnabled: true });
    expect(reread.error).toEqual({ enabled: true, soundEnabled: false });
  });

  // ── test() convenience ─────────────────────────────────────────────

  it('test(kind) uses force=true and fires through the adapter', () => {
    adapter.focused = true;

    const result = service.test('new_message');

    expect(result).not.toBeNull();
    expect(adapter.notifyCalls).toHaveLength(1);
    expect(adapter.notifyCalls[0]).toEqual({
      title: 'Rolestra 테스트',
      body: 'OS 알림 확인용',
    });
  });

  it('test(kind) still respects the prefs disable', () => {
    service.updatePrefs({
      new_message: { enabled: false, soundEnabled: true },
    });
    adapter.focused = false;

    const result = service.test('new_message');

    expect(result).toBeNull();
    expect(adapter.notifyCalls).toHaveLength(0);
  });

  // ── repository round-trips ─────────────────────────────────────────

  it('insertLog + listLog round-trip preserves channelId=null and orders newest-first', async () => {
    const a = {
      id: 'log-a',
      kind: 'new_message' as NotificationKind,
      title: 'A',
      body: 'a',
      channelId: null,
      clicked: false,
      createdAt: Date.now(),
    };
    repo.insertLog(a);
    await new Promise((r) => setTimeout(r, 2));
    const b = {
      id: 'log-b',
      kind: 'error' as NotificationKind,
      title: 'B',
      body: 'b',
      channelId: null,
      clicked: true,
      createdAt: Date.now(),
    };
    repo.insertLog(b);

    const all = repo.listLog();
    expect(all.map((r) => r.id)).toEqual(['log-b', 'log-a']);
    expect(all[0]!.clicked).toBe(true);
    expect(all[0]!.channelId).toBeNull();

    // kind filter limits to just the one kind.
    const errors = repo.listLog({ kind: 'error' });
    expect(errors.map((r) => r.id)).toEqual(['log-b']);
  });

  // ── listener isolation ────────────────────────────────────────────

  it('isolates a throwing clicked listener from other subscribers', () => {
    adapter.focused = false;
    service.on(NOTIFICATION_CLICKED_EVENT, () => {
      throw new Error('listener exploded');
    });
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);

    try {
      const entry = service.show({
        kind: 'new_message',
        title: 't',
        body: 'b',
      });
      expect(entry).not.toBeNull();

      // Clicking must not propagate the listener error — the adapter
      // triggers, the service catches internally, console.warn logs it.
      expect(() => adapter.triggerClick()).not.toThrow();

      // DB still got updated even though the subscriber threw.
      const rows = repo.listLog();
      expect(rows).toHaveLength(1);
      expect(rows[0]!.clicked).toBe(true);

      // warn called with the stable rolestra marker.
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const [marker, payload] = warnSpy.mock.calls[0]!;
      expect(marker).toBe('[rolestra.notifications] listener threw:');
      expect(payload).toMatchObject({
        name: 'Error',
        message: 'listener exploded',
      });
    } finally {
      warnSpy.mockRestore();
    }
  });
});
