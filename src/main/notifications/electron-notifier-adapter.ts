/**
 * ElectronNotifierAdapter — production {@link NotifierAdapter} backed by
 * Electron's native `Notification` and `BrowserWindow` APIs.
 *
 * Why a dedicated adapter file:
 *   {@link NotificationService} must be importable from Node-only test
 *   environments (vitest + better-sqlite3, no Electron runtime). That
 *   means the service cannot `import { Notification } from 'electron'`
 *   at module scope — doing so would pull the `electron` binding into
 *   every test process and explode. This file quarantines the Electron
 *   import so only the production wiring code (main-process bootstrap)
 *   ever loads it.
 *
 * Focus detection:
 *   `isAnyWindowFocused()` walks `BrowserWindow.getAllWindows()` and
 *   returns true iff at least one non-destroyed window reports focus.
 *   When the app has no windows (e.g. during startup or after the last
 *   window closed) we treat it as "not focused" so notifications can
 *   still fire — matches the UX where a tray-only app still needs OS
 *   toasts.
 *
 * Click semantics:
 *   Electron's `Notification.on('click', …)` fires zero or one time per
 *   notification (user clicks once). Our {@link NotifierHandle.onClick}
 *   contract says "multiple registrations fire on click"; we forward
 *   every registered callback into Electron's handler so the service
 *   can wire a single callback today and future fan-out tomorrow.
 */

import { app, BrowserWindow, Notification } from 'electron';
import type { NotifierAdapter, NotifierHandle } from './notification-service';

export class ElectronNotifierAdapter implements NotifierAdapter {
  /**
   * Returns true iff at least one non-destroyed, VISIBLE BrowserWindow
   * is currently focused. The visibility gate (R10-Task10) closes a
   * macOS edge case where a hidden window can still report focus
   * after the user cmd-tabbed to another app — without it the
   * NotificationService would suppress every toast even though the
   * user clearly is not looking at our renderer.
   */
  isAnyWindowFocused(): boolean {
    const windows = BrowserWindow.getAllWindows();
    if (windows.length === 0) return false;
    return windows.some(
      (w) => !w.isDestroyed() && w.isFocused() && w.isVisible(),
    );
  }

  /**
   * R10-Task10 (R9 Known Concern #5): macOS dock visibility signal.
   * Returns `true` on non-darwin platforms (no dock concept), and on
   * darwin when `app.dock.isVisible()` confirms the dock icon is up.
   * Defensive default of `true` mirrors the spec's "treat as visible
   * when in doubt" rule — we would rather err on the side of
   * suppressing duplicate toasts than spam the user.
   */
  isDockVisible(): boolean {
    if (process.platform !== 'darwin') return true;
    // Electron's `app.dock` is only present on macOS; the optional-chain
    // call is defensive against the build-time type erroring on other
    // platforms even when this branch is unreachable there.
    const dock = (app as typeof app & { dock?: { isVisible?: () => boolean } }).dock;
    return dock?.isVisible?.() ?? true;
  }

  notify(title: string, body: string): NotifierHandle {
    const notification = new Notification({ title, body });

    // Collect callbacks so multiple onClick() calls all fire on the
    // single Electron click event. We register one Electron listener
    // that fans out into the array — simpler than juggling add/remove
    // on the native handle.
    const callbacks: Array<() => void> = [];
    notification.on('click', () => {
      for (const cb of callbacks) {
        // Guard each callback so a throwing one doesn't prevent later
        // callbacks from running. Service-level emit isolation is still
        // handled in NotificationService.handleClick; this is just the
        // fan-out safety net.
        try {
          cb();
        } catch (err) {
          const errMessage = err instanceof Error ? err.message : String(err);
          // TODO R2-log: swap for structured logger (src/main/log/)
          console.warn(
            '[rolestra.notifications] click callback threw:',
            { name: err instanceof Error ? err.name : undefined, message: errMessage },
          );
        }
      }
    });

    notification.show();

    return {
      onClick(cb: () => void): void {
        callbacks.push(cb);
      },
    };
  }
}
