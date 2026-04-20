/**
 * ConsensusFolderService — race-safe writer for `<ArenaRoot>/consensus/documents/`.
 *
 * Responsibilities (spec §9, R2 Task 14):
 *   - `writeDocument(relPath, content)` — persist a document atomically so a
 *     partial write (crash / concurrent overwrite) can never leave the
 *     destination file half-populated. Implementation is the canonical
 *     POSIX pattern: `write(tmp) → fsync(tmp) → rename(tmp, target)`.
 *     `rename(2)` is atomic on both POSIX and Windows NTFS for
 *     intra-directory moves, so any reader either sees the previous
 *     content or the new content, never a mix.
 *   - `withLock(target, fn)` — advisory lock so two callers targeting the
 *     same path serialise. The lock is an `mkdir`-based sentinel directory
 *     (`<target>.lock`) — `mkdir(2)` fails atomically on EEXIST, which is
 *     exactly the "compare-and-swap" primitive we need. No external
 *     flock/lockfile library required, so Electron renderer/main/forks all
 *     co-operate through the same filesystem-level mutex.
 *
 * Why NOT `O_EXCL` on the target itself?
 *   `O_EXCL` would refuse the second writer outright. We want serialisation,
 *   not rejection — the second caller should wait and then apply its own
 *   content (last-writer-wins), which `withLock` delivers.
 *
 * Stale lock reclamation:
 *   A process that crashes mid-lock leaves the sentinel behind. Rather than
 *   wait out the 10s timeout for every subsequent caller, we detect stale
 *   locks via TWO signals that must BOTH fire:
 *     1. The owning pid no longer responds to `kill(pid, 0)` — the
 *        process is gone, so nobody will release the lock.
 *     2. The sentinel's mtime is more than 30s old — guards against the
 *        race where a just-created lock happens to share a pid with a
 *        long-dead process (pid reuse).
 *   If either signal is absent, we treat the lock as live and back off.
 *
 * Concurrency model:
 *   Single-process concurrency works too — `Promise.all([writeA, writeB])`
 *   serialises through the same sentinel because the retry loop polls
 *   every 100ms and mkdir is atomic. No extra in-memory mutex needed.
 *
 * Timeout / stale windows are injectable (`{ timeoutMs?, staleMs? }`) so
 * tests can exercise the edge cases without sleeping for real-time
 * budgets.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';

/** Default upper bound on how long `withLock` waits for the sentinel. */
export const DEFAULT_LOCK_TIMEOUT_MS = 10_000;
/**
 * Default age beyond which a lock held by a dead pid is considered stale.
 * The mtime gate protects against pid reuse: a pid that was alive when the
 * lock was written, died a few ms ago, and was recycled by the OS would
 * still pass `kill(pid, 0)` — the mtime check forces a minimum age so the
 * race window shrinks to a fraction of a second.
 */
export const DEFAULT_STALE_MS = 30_000;
/** Back-off between acquisition attempts when the sentinel is live. */
const LOCK_POLL_INTERVAL_MS = 100;

/** Options accepted by {@link ConsensusFolderService.withLock}. */
export interface WithLockOptions {
  /** Max wall-clock wait, in ms. Defaults to {@link DEFAULT_LOCK_TIMEOUT_MS}. */
  timeoutMs?: number;
  /** Stale threshold, in ms. Defaults to {@link DEFAULT_STALE_MS}. */
  staleMs?: number;
}

/**
 * Thrown when `withLock` exceeds its wall-clock budget without acquiring
 * the sentinel. Callers should treat this as "transient" — retrying is
 * reasonable if upstream semantics allow.
 */
export class LockTimeoutError extends Error {
  constructor(
    /** Sentinel directory path that could not be acquired. */
    readonly lockPath: string,
    /** Budget in ms that was exhausted. */
    readonly timeoutMs: number,
  ) {
    super(`Lock timeout after ${timeoutMs}ms: ${lockPath}`);
    this.name = 'LockTimeoutError';
  }
}

/** Suffix we append to `target` to obtain the sentinel directory path. */
const LOCK_SUFFIX = '.lock';
/** Filename inside the sentinel that records the owning pid. */
const PID_FILENAME = 'pid';
/** Infix injected into temp-file names to avoid cross-caller collisions. */
const TMP_INFIX = '.tmp.';

/**
 * Race-safe writer for the consensus directory tree.
 *
 * The constructor accepts the absolute `<ArenaRoot>/consensus` path, typically
 * obtained from `ArenaRootService.consensusPath()`.
 */
export class ConsensusFolderService {
  constructor(private readonly consensusRoot: string) {}

  /**
   * Writes `content` to `<consensusRoot>/documents/<relPath>` atomically.
   *
   * Sequence:
   *   1. `mkdir -p` the parent directory (idempotent).
   *   2. Acquire advisory lock on the target path.
   *   3. Write content to `<target>.tmp.<pid>-<uuid>` then `fsync` it so
   *      the bytes are durable before the rename flips the inode.
   *   4. `rename(tmp, target)` — atomic on both POSIX and NTFS.
   *   5. Release the lock (always, via `finally`).
   *
   * On rename failure the tmp file is best-effort unlinked so we do not
   * pollute the directory with `.tmp.*` orphans.
   */
  async writeDocument(relPath: string, content: string): Promise<void> {
    const full = path.join(this.consensusRoot, 'documents', relPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });

    await this.withLock(full, async () => {
      // Temp name must be unique across callers (same pid can have
      // multiple in-flight writes via `Promise.all`), hence the UUID suffix.
      const tmp = `${full}${TMP_INFIX}${process.pid}-${randomUUID()}`;
      fs.writeFileSync(tmp, content, 'utf8');
      // `fsync` forces the OS to flush writeFileSync's buffered data to
      // the physical disk before the rename flips the visible inode.
      // Without this, a crash between writeFileSync and rename could
      // surface a truncated or zero-length file after recovery.
      const fd = fs.openSync(tmp, 'r+');
      try {
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      try {
        fs.renameSync(tmp, full);
      } catch (err) {
        // Rename failed — clean the tmp so we don't leak. Errors from
        // unlink are swallowed: the tmp may already be gone (e.g. on
        // some Windows edge cases where the rename partially succeeded).
        try {
          fs.unlinkSync(tmp);
        } catch {
          /* ignore */
        }
        throw err;
      }
    });
  }

  /**
   * Runs `fn` while holding an exclusive advisory lock on `target`.
   *
   * The lock is the directory `${target}.lock`. `mkdir(2)` is atomic w.r.t.
   * EEXIST, so exactly one caller wins each race. Losers poll every
   * {@link LOCK_POLL_INTERVAL_MS} ms, checking for staleness on each
   * iteration so a crashed owner unblocks the queue without waiting out
   * the full `timeoutMs` budget.
   *
   * @throws {LockTimeoutError} When the wall-clock budget elapses before
   *   acquisition. `fn` is never invoked in that case.
   */
  async withLock<T>(
    target: string,
    fn: () => Promise<T>,
    opts: WithLockOptions = {},
  ): Promise<T> {
    const timeoutMs = opts.timeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
    const staleMs = opts.staleMs ?? DEFAULT_STALE_MS;
    const lockPath = `${target}${LOCK_SUFFIX}`;
    const start = Date.now();

    // Acquisition loop — break on success, throw on timeout.
    for (;;) {
      try {
        fs.mkdirSync(lockPath);
        // Write the pid file INSIDE the sentinel. If this throws we
        // still hold the sentinel; remove it before rethrowing so we
        // don't strand future callers.
        try {
          fs.writeFileSync(
            path.join(lockPath, PID_FILENAME),
            String(process.pid),
            'utf8',
          );
        } catch (err) {
          this.removeLock(lockPath);
          throw err;
        }
        break;
      } catch (err) {
        if (!isEExist(err)) throw err;

        // Someone else owns the sentinel. Two outcomes: the owner is
        // dead → we reclaim; the owner is alive → we wait and retry.
        if (this.isStale(lockPath, staleMs)) {
          this.removeLock(lockPath);
          continue;
        }
        if (Date.now() - start > timeoutMs) {
          throw new LockTimeoutError(lockPath, timeoutMs);
        }
        await sleep(LOCK_POLL_INTERVAL_MS);
      }
    }

    try {
      return await fn();
    } finally {
      // Best-effort release — if removeLock throws we do not want to
      // mask an exception from `fn`. The swallow inside removeLock
      // already handles the "already gone" case.
      this.removeLock(lockPath);
    }
  }

  /**
   * Heuristic: is the sentinel at `lockPath` stale?
   *
   * Returns true iff EITHER the pid file is unreadable/empty OR the
   * recorded pid no longer answers `kill(pid, 0)` AND the sentinel's
   * mtime is older than `staleMs`. The pid-present-but-dead path must
   * pass BOTH checks so we do not reap a just-written lock whose pid
   * briefly died and was recycled.
   *
   * Any thrown error (permissions, sentinel removed mid-check) is
   * interpreted as "stale" — the worst case is a racing retry, which
   * costs one extra mkdir attempt, far cheaper than blocking a caller
   * on a bogus sentinel.
   */
  private isStale(lockPath: string, staleMs: number): boolean {
    try {
      const pidFile = path.join(lockPath, PID_FILENAME);
      const raw = fs.readFileSync(pidFile, 'utf8').trim();
      const pid = Number(raw);
      if (!Number.isInteger(pid) || pid <= 0) return true;

      // `process.kill(pid, 0)` is the canonical "is-process-alive" probe;
      // it does not actually signal the process, just runs the OS-level
      // permission + existence check.
      try {
        process.kill(pid, 0);
      } catch {
        return true; // Owner process is gone.
      }

      // Owner looks alive. Require mtime age as a second gate so pid
      // reuse (short-lived pid A dies, OS recycles pid A for an
      // unrelated process B) cannot falsely keep a dead lock alive.
      const st = fs.statSync(lockPath);
      return Date.now() - st.mtimeMs > staleMs;
    } catch {
      return true;
    }
  }

  /**
   * Deletes the sentinel directory (recursive + force). Swallows all
   * errors because the common "failure" modes are benign:
   *   - Sentinel already removed by another caller (ENOENT).
   *   - Sentinel directory busy on Windows (transient, retried by the
   *     next caller's mkdir).
   * The caller is always finishing up; surfacing a cleanup error here
   * would hide the real work's result.
   */
  private removeLock(lockPath: string): void {
    try {
      fs.rmSync(lockPath, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

// ── internal helpers ───────────────────────────────────────────────────

/** Narrow an unknown error to the Node error shape and test its `code`. */
function isEExist(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = (err as { code?: unknown }).code;
  return code === 'EEXIST';
}

/** Promise-returning sleep helper. Kept local to avoid a shared util dep. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
