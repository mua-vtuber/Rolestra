/**
 * NotificationService — OS-level notifications with focus gating, per-kind
 * preferences, DB audit log, and a pluggable {@link NotifierAdapter}.
 *
 * Responsibilities (R2 Task 16):
 *   - `show({kind, title, body, channelId?, force?})` — gates on prefs
 *     + focus, emits the OS notification through the adapter, records a
 *     row in `notification_log`, and wires the click callback so a later
 *     user click updates `clicked=1` and emits `'clicked'` on the service
 *     for the renderer to route (e.g. navigate to the channel).
 *   - `getPrefs()` / `updatePrefs(patch)` — delegate to the repository.
 *   - `test(kind)` — one-shot that bypasses the focus check via `force`
 *     so a user can verify OS-level delivery from the settings UI.
 *
 * Gating order inside `show()`:
 *   (1) prefs[kind].enabled === false → skip (no DB row, no OS notify).
 *   (2) !force && adapter.isAnyWindowFocused() → skip (same — user is
 *       already looking, OS toast would be noise).
 *   (3) otherwise: insert a log row (pre-click), hand the row to the
 *       adapter, wire up the click callback.
 *
 * Step ordering in (3): insert FIRST, notify SECOND. If the OS-level
 * notify fails we would rather have a phantom `clicked=0` audit row than
 * lose the emission entirely — the renderer can audit "why didn't I see
 * this" by walking the log. The row must exist BEFORE the OS call so the
 * adapter's click callback (which can fire before `show()` even returns
 * on some platforms) always has a row to update.
 *
 * Adapter contract — {@link NotifierAdapter}:
 *   The service is pure business logic; it never imports `electron`.
 *   {@link ElectronNotifierAdapter} (sibling file) wires real
 *   BrowserWindow focus detection + native Notification. Tests inject a
 *   MockNotifierAdapter with a focus flag + captured notify calls.
 *
 * Event emission — `'clicked'`:
 *   Mirrors the emit-isolation pattern from MessageService (Task 11):
 *   listener throws are caught and routed to console.warn with a stable
 *   `[rolestra.notifications]` prefix, so a buggy subscriber never breaks
 *   a click callback chain. See comment inside {@link fireClicked} for
 *   full rationale.
 *
 * What this service intentionally does NOT do:
 *   - Throttling / deduping — future work (spec §7 polish list).
 *   - Sound playback — `soundEnabled` is stored in prefs but the actual
 *     sound is an OS concern; the adapter passes title/body only.
 *   - Pruning — `notification_log` grows unbounded; a later task will
 *     add a retention job. Callers should treat `listLog` as "recent
 *     notifications", not "full history".
 */

import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type {
  NotificationKind,
  NotificationLogEntry,
  NotificationPrefs,
} from '../../shared/notification-types';
import { NotificationRepository } from './notification-repository';

// ── Adapter contract ───────────────────────────────────────────────────

/**
 * Abstraction over the real Electron Notification + BrowserWindow APIs.
 * Implementations (production vs. test) live in their own files so this
 * module stays `electron`-free and is safe to import from Node-only test
 * environments.
 */
export interface NotifierAdapter {
  /**
   * Returns true iff ANY renderer window is currently focused. Used by
   * the service to suppress OS toasts when the user is already looking
   * at the app (they would see the in-app update anyway).
   */
  isAnyWindowFocused(): boolean;

  /**
   * Fires an OS notification with the given title/body. The returned
   * handle lets the caller subscribe to the user's click — exactly once
   * per notification. Multiple `onClick` registrations are allowed; each
   * callback fires on click.
   */
  notify(title: string, body: string): NotifierHandle;
}

/** Handle returned by {@link NotifierAdapter.notify}. */
export interface NotifierHandle {
  /** Register a callback to fire when the user clicks the notification. */
  onClick(cb: () => void): void;
}

// ── Input shapes ──────────────────────────────────────────────────────

export interface ShowNotificationInput {
  kind: NotificationKind;
  title: string;
  body: string;
  /** Optional channel context — routed to `'clicked'` listeners on click. */
  channelId?: string | null;
  /**
   * Skip the "is any window focused" gate. Used by {@link NotificationService.test}
   * so users can verify OS-level delivery from the settings UI. The prefs
   * gate is still enforced (`enabled=false` always skips).
   */
  force?: boolean;
}

// ── Event typing ──────────────────────────────────────────────────────

/** Event name emitted when the user clicks a previously-shown notification. */
export const NOTIFICATION_CLICKED_EVENT = 'clicked' as const;

/** Payload for the `'clicked'` event. */
export interface NotificationClickedPayload {
  id: string;
  kind: NotificationKind;
  channelId: string | null;
}

export interface NotificationServiceEvents {
  clicked: (payload: NotificationClickedPayload) => void;
}

// ── Service ────────────────────────────────────────────────────────────

export class NotificationService extends EventEmitter {
  constructor(
    private readonly repo: NotificationRepository,
    private readonly adapter: NotifierAdapter,
  ) {
    super();
  }

  /**
   * Shows an OS notification after applying the prefs + focus gates.
   * Returns the inserted {@link NotificationLogEntry} when the
   * notification actually fires, or `null` when a gate suppressed it.
   *
   * The `null`-on-gate return lets callers distinguish "silently skipped"
   * from "suppressed by policy" without re-querying prefs.
   */
  show(input: ShowNotificationInput): NotificationLogEntry | null {
    // (1) Prefs gate. Always skip when the kind is disabled, even when
    //     the caller passed `force=true` — `force` only bypasses the
    //     focus check, not the user's explicit disable toggle.
    const prefs = this.repo.getPrefs();
    if (prefs[input.kind].enabled === false) {
      return null;
    }

    // (2) Focus gate. When a renderer window is already focused, skip —
    //     the in-app UI is the primary surface. `force=true` (test button)
    //     bypasses this so the user can verify OS delivery.
    if (!input.force && this.adapter.isAnyWindowFocused()) {
      return null;
    }

    // (3) Fire: insert log row FIRST (see file header for ordering
    //     rationale), then hand off to the adapter, then wire the click.
    const entry: NotificationLogEntry = {
      id: randomUUID(),
      kind: input.kind,
      title: input.title,
      body: input.body,
      channelId: input.channelId ?? null,
      clicked: false,
      createdAt: Date.now(),
    };
    this.repo.insertLog(entry);

    const handle = this.adapter.notify(input.title, input.body);
    handle.onClick(() => this.handleClick(entry));
    return entry;
  }

  /**
   * Returns the complete per-kind preferences map. Missing kinds (first
   * boot) are lazily inserted with defaults by the repository.
   */
  getPrefs(): NotificationPrefs {
    return this.repo.getPrefs();
  }

  /**
   * Applies a partial patch to the preferences. Returns the complete
   * map AFTER the update so callers never have to stitch state.
   */
  updatePrefs(patch: Partial<NotificationPrefs>): NotificationPrefs {
    return this.repo.updatePrefs(patch);
  }

  /**
   * Convenience: fire a diagnostic notification for the given kind with a
   * stable title/body so a user in the settings UI can confirm OS-level
   * delivery without waiting for a real event. Always passes `force=true`
   * to bypass the focus check; the prefs gate still applies, so disabling
   * the kind suppresses even the test fire (consistent with real delivery).
   */
  test(kind: NotificationKind): NotificationLogEntry | null {
    return this.show({
      kind,
      title: 'Rolestra 테스트',
      body: 'OS 알림 확인용',
      force: true,
    });
  }

  /**
   * Click handler wired onto every notification fired through the
   * adapter. Updates `clicked=1` in the log, then broadcasts a
   * {@link NotificationClickedPayload} to subscribers.
   *
   * Listener emit is guarded the same way MessageService handles it
   * (Task 11): a throwing subscriber is console.warn'd with a stable
   * rolestra marker so the failure is still observable but does not
   * break other subscribers or the DB update.
   */
  private handleClick(entry: NotificationLogEntry): void {
    this.repo.markClicked(entry.id);
    const payload: NotificationClickedPayload = {
      id: entry.id,
      kind: entry.kind,
      channelId: entry.channelId,
    };
    try {
      this.emit(NOTIFICATION_CLICKED_EVENT, payload);
    } catch (err) {
      const errMessage = err instanceof Error ? err.message : String(err);
      // TODO R2-log: swap for structured logger (src/main/log/)
      console.warn('[rolestra.notifications] listener threw:', {
        name: err instanceof Error ? err.name : undefined,
        message: errMessage,
      });
    }
  }

  // ── typed EventEmitter overloads ───────────────────────────────────

  on<E extends keyof NotificationServiceEvents>(
    event: E,
    listener: NotificationServiceEvents[E],
  ): this;
  on(event: string | symbol, listener: (...args: unknown[]) => void): this;
  on(
    event: string | symbol,
    listener: (...args: unknown[]) => void,
  ): this {
    return super.on(event, listener);
  }

  off<E extends keyof NotificationServiceEvents>(
    event: E,
    listener: NotificationServiceEvents[E],
  ): this;
  off(event: string | symbol, listener: (...args: unknown[]) => void): this;
  off(
    event: string | symbol,
    listener: (...args: unknown[]) => void,
  ): this {
    return super.off(event, listener);
  }

  emit<E extends keyof NotificationServiceEvents>(
    event: E,
    ...args: Parameters<NotificationServiceEvents[E]>
  ): boolean;
  emit(event: string | symbol, ...args: unknown[]): boolean;
  emit(event: string | symbol, ...args: unknown[]): boolean {
    return super.emit(event, ...args);
  }
}
