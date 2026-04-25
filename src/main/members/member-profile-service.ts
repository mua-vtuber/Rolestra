/**
 * MemberProfileService — CRUD + 4-state work-status machine for member
 * profiles (spec §7.1, §7.2; R2 Task 9).
 *
 * Responsibilities:
 *   - Read/write `member_profiles` rows with a tight patch whitelist
 *     (`role` / `personality` / `expertise` / `avatarKind` / `avatarData`).
 *     `statusOverride` is deliberately NOT patchable through
 *     {@link updateProfile} — it flows exclusively through
 *     {@link setStatus} so a routine profile edit cannot accidentally
 *     trample the user's manual "leave work" toggle.
 *   - Compose a `MemberView` that fuses the DB row with the provider's
 *     `displayName` / legacy `persona` (from `providers`) and the runtime
 *     {@link WorkStatus}.
 *   - Drive the work-status machine: manual override beats everything
 *     else; otherwise the runtime map decides.
 *   - Drive `reconnect` — warmup the provider via the injected
 *     {@link MemberProviderLookup} and update the runtime map on success or
 *     failure. Concurrent `reconnect` calls for the same providerId are
 *     coalesced onto a single in-flight probe (see {@link MemberProfileService.reconnect}).
 *   - Provide {@link MemberProfileService.forget} for provider-deletion
 *     cleanup (Task 18 IPC layer wires this on provider delete).
 *
 * Provider dependency (structural):
 *   The service intentionally depends on a narrow {@link MemberProviderLookup}
 *   interface rather than the production `ProviderRegistry`. This mirrors
 *   the `ProjectLookup` pattern from Task 6 and keeps tests simple — they
 *   pass a stub with a `get()` and `warmup()` implementation without
 *   pulling the whole provider tree. Task 18's IPC wiring injects the
 *   real adapter.
 *
 *   The interface is named `MemberProviderLookup` (not plain `ProviderLookup`)
 *   to avoid a name clash with the differently-shaped `ProviderLookup`
 *   exported from `src/main/files/cli-permission-bridge.ts`.
 *
 * Runtime vs. persisted state:
 *   The runtime status map (`Map<providerId, WorkStatus>`) lives in the
 *   service instance — it is LOST on app restart by design. The persisted
 *   `status_override='offline-manual'` survives restarts; all other
 *   values are re-derived at runtime (spec §7.2 "앱 시작 시 모든
 *   provider에 대해 warmup 병렬 실행").
 *
 * The runtime map is never read directly by callers; {@link getWorkStatus}
 * is the only public read path and it always consults the persisted
 * override first.
 */

import { EventEmitter } from 'node:events';
import {
  AUTONOMY_TIMEOUT_OFFLINE_MANUAL_MS,
  type AvatarKind,
  type MemberProfile,
  type MemberView,
  type WorkStatus,
} from '../../shared/member-profile-types';
import type { StreamMemberStatusChangedPayload } from '../../shared/stream-events';
import { MemberProfileRepository } from './member-profile-repository';
import { buildEffectivePersona } from './persona-builder';

// ── Error hierarchy ────────────────────────────────────────────────────

/** Base class — `catch (e instanceof MemberError)` for discrimination. */
export class MemberError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MemberError';
  }
}

/**
 * Raised when a method requires the provider to exist in the registry
 * (e.g. {@link MemberProfileService.getView} needs `displayName`) but the
 * lookup returned `null`. Callers recover by creating the provider first.
 */
export class ProviderNotFoundError extends MemberError {
  constructor(providerId: string) {
    super(`provider not found: ${providerId}`);
    this.name = 'ProviderNotFoundError';
  }
}

// ── Injected ports ────────────────────────────────────────────────────

/**
 * Narrow structural port the service needs from the provider layer. The
 * production IPC wiring (Task 18) adapts `ProviderRegistry` to this
 * shape; tests pass a stub. The service MUST NOT reach past this
 * interface.
 */
export interface MemberProviderLookup {
  /**
   * Return the minimal provider shape the member layer cares about, or
   * `null` when `providerId` is unknown. Keep this object shape stable
   * — the service maps `displayName` / `persona` into {@link MemberView}.
   */
  get(providerId: string): {
    id: string;
    displayName: string;
    persona: string;
  } | null;

  /**
   * Probe the provider. Resolves on reachability, rejects on failure.
   * The service treats ANY rejection as "offline-connection" regardless
   * of the underlying cause — we deliberately do not discriminate
   * network errors from auth errors at this layer; the UI surfaces a
   * single "점검 필요" label either way.
   */
  warmup(providerId: string): Promise<void>;
}

// ── Patch shapes ──────────────────────────────────────────────────────

/**
 * Subset of {@link MemberProfile} that {@link MemberProfileService.updateProfile}
 * accepts. `providerId`, `statusOverride`, and `updatedAt` are deliberately
 * omitted — the service owns those columns.
 */
export interface MemberProfilePatch {
  role?: string;
  personality?: string;
  expertise?: string;
  avatarKind?: AvatarKind;
  avatarData?: string | null;
}

/**
 * Target value for {@link MemberProfileService.setStatus}. `'online'`
 * clears the override (restores runtime-controlled status); `'offline-manual'`
 * persists the manual "leave work" toggle.
 */
export type SetStatusTarget = 'online' | 'offline-manual';

// ── Service ────────────────────────────────────────────────────────────

/**
 * Default runtime status for a member the service has never probed.
 *
 * Spec §7.2: until `warmup()` succeeds at least once, a member is
 * considered unreachable. This mirrors the app-startup behaviour where
 * every provider begins offline until the boot-time warmup pass marks it
 * otherwise.
 */
const DEFAULT_RUNTIME_STATUS: WorkStatus = 'offline-connection';

/**
 * Tunable options passed into {@link MemberProfileService} for the R9
 * offline-manual timeout behaviour (spec §7.2, R9-Task10).
 *
 * Both fields are optional — the production wiring never sets them.
 * Tests override them to (a) shrink the 60-minute default for speed,
 * (b) inject a deterministic `now()` clock so the assertion does not
 * depend on real time.
 */
export interface MemberProfileServiceOptions {
  /**
   * How long a persisted `status_override='offline-manual'` survives
   * before {@link MemberProfileService.getWorkStatus} auto-clears it
   * and falls back to the runtime status.
   *
   * Defaults to {@link AUTONOMY_TIMEOUT_OFFLINE_MANUAL_MS} (60 min).
   * The reference point is `member_profiles.updated_at` — the column
   * is bumped by `setStatusOverride()` (setStatus path) and also by
   * `upsert()` (routine profile edits). A profile edit therefore
   * resets the countdown; this is an acceptable minor imperfection
   * relative to adding a dedicated `status_override_at` column (spec
   * "신규 마이그레이션 0건" constraint, R9 plan).
   */
  offlineManualTimeoutMs?: number;
  /**
   * Inject a deterministic clock. Defaults to {@link Date.now}. Tests
   * pass `() => fixedTimestamp` so the expiry check is predictable
   * without fake timers (which tangle with better-sqlite3).
   */
  now?: () => number;
}

/**
 * Event name emitted by {@link MemberProfileService} whenever a member's
 * runtime status OR persisted profile metadata changes (R10-Task10).
 *
 * Wired to the renderer via `StreamBridge.connect({members})` →
 * `stream:member-status-changed` (spec §6, plan R10 D9). The payload
 * shape mirrors {@link StreamMemberStatusChangedPayload} so the bridge
 * can forward it verbatim with no adapter logic.
 *
 * D9 coexistence: the existing R8 mutation-after-invalidation pattern
 * (renderer surfaces calling `notifyChannelsChanged()` post-mutation)
 * keeps working as a fallback. The stream is an ADDITIVE layer — when
 * the bridge is offline (e.g. unit tests without a renderer) consumers
 * still see fresh data via their next mount-fetch + invalidation.
 */
export const MEMBER_STATUS_CHANGED_EVENT = 'status-changed' as const;

/**
 * Strongly-typed event map for {@link MemberProfileService}. A separate
 * symbol keeps the listener signature pinned to {@link StreamMemberStatusChangedPayload}
 * so a future event addition cannot accidentally widen the surface to
 * `unknown`.
 */
export interface MemberProfileServiceEvents {
  'status-changed': (payload: StreamMemberStatusChangedPayload) => void;
}

/**
 * Causes that label why a `'status-changed'` event was emitted. Mirrors
 * the `cause` field on {@link StreamMemberStatusChangedPayload}; kept as
 * a private alias so the service does not import the renderer-facing
 * type for every internal call site.
 */
type StatusChangeCause = StreamMemberStatusChangedPayload['cause'];

export class MemberProfileService extends EventEmitter {
  /**
   * In-memory runtime status per provider. Keyed by `providerId`. Absent
   * keys resolve to {@link DEFAULT_RUNTIME_STATUS} via
   * {@link getWorkStatus}.
   */
  private readonly runtimeStatus = new Map<string, WorkStatus>();

  /**
   * In-flight {@link reconnect} probes per provider. Used to coalesce
   * concurrent `reconnect(providerId)` calls onto a single underlying
   * {@link MemberProviderLookup.warmup} invocation so we do not:
   *   - issue redundant network probes,
   *   - race on the runtime status map (last-write-wins),
   *   - return divergent {@link WorkStatus} values to concurrent callers.
   *
   * Entry is inserted by the first caller; subsequent concurrent callers
   * receive the same `Promise<WorkStatus>`. The entry is removed in a
   * `finally` block so the next `reconnect(providerId)` issued AFTER the
   * in-flight probe settles starts a fresh probe.
   */
  private readonly reconnectInFlight = new Map<string, Promise<WorkStatus>>();

  /**
   * Resolved offline-manual timeout window in ms. `0` disables the
   * auto-clear path entirely (tests use this when the timeout must not
   * fire). Frozen at construction so a mid-run override cannot bend
   * behaviour.
   */
  private readonly offlineManualTimeoutMs: number;

  /** Injected clock — see {@link MemberProfileServiceOptions.now}. */
  private readonly now: () => number;

  constructor(
    private readonly repo: MemberProfileRepository,
    private readonly providers: MemberProviderLookup,
    options: MemberProfileServiceOptions = {},
  ) {
    super();
    this.offlineManualTimeoutMs =
      options.offlineManualTimeoutMs ?? AUTONOMY_TIMEOUT_OFFLINE_MANUAL_MS;
    this.now = options.now ?? Date.now;
  }

  /**
   * Centralised emitter for the `'status-changed'` event. Builds the
   * full {@link StreamMemberStatusChangedPayload} (providerId + member +
   * status + cause) so subscribers — including the StreamBridge that
   * forwards verbatim — never have to re-derive {@link MemberView}.
   *
   * If the provider is no longer registered (deletion mid-flight) we
   * skip emitting: the renderer surface that just heard about the
   * deletion already knows to drop the row, and a payload without a
   * MemberView would fail the bridge's shape validation. Emit
   * exceptions are isolated so a buggy listener cannot break the
   * caller (mirrors the MessageService / NotificationService pattern).
   */
  private emitStatusChanged(
    providerId: string,
    cause: StatusChangeCause,
  ): void {
    const providerMeta = this.providers.get(providerId);
    if (!providerMeta) return;
    const profile = this.getProfile(providerId);
    const status = this.getWorkStatus(providerId);
    const payload: StreamMemberStatusChangedPayload = {
      providerId,
      member: {
        ...profile,
        displayName: providerMeta.displayName,
        persona: providerMeta.persona,
        workStatus: status,
      },
      status,
      cause,
    };
    try {
      this.emit(MEMBER_STATUS_CHANGED_EVENT, payload);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // TODO R2-log: swap for structured logger (src/main/log/)
      console.warn('[rolestra.members] status-changed listener threw:', {
        providerId,
        cause,
        name: err instanceof Error ? err.name : undefined,
        message,
      });
    }
  }

  // ── typed EventEmitter overloads ───────────────────────────────────

  on<E extends keyof MemberProfileServiceEvents>(
    event: E,
    listener: MemberProfileServiceEvents[E],
  ): this;
  on(event: string | symbol, listener: (...args: unknown[]) => void): this;
  on(event: string | symbol, listener: (...args: unknown[]) => void): this {
    return super.on(event, listener);
  }

  off<E extends keyof MemberProfileServiceEvents>(
    event: E,
    listener: MemberProfileServiceEvents[E],
  ): this;
  off(event: string | symbol, listener: (...args: unknown[]) => void): this;
  off(event: string | symbol, listener: (...args: unknown[]) => void): this {
    return super.off(event, listener);
  }

  emit<E extends keyof MemberProfileServiceEvents>(
    event: E,
    ...args: Parameters<MemberProfileServiceEvents[E]>
  ): boolean;
  emit(event: string | symbol, ...args: unknown[]): boolean;
  emit(event: string | symbol, ...args: unknown[]): boolean {
    return super.emit(event, ...args);
  }

  /**
   * Returns the persisted profile for `providerId`. If no row exists, a
   * default-populated object is returned WITHOUT inserting — insertion is
   * the exclusive job of {@link updateProfile} / {@link setStatus}.
   *
   * We do not call the provider lookup here (no `displayName`) — that
   * belongs to {@link getView}.
   */
  getProfile(providerId: string): MemberProfile {
    const row = this.repo.get(providerId);
    if (row) return row;
    return this.defaultProfile(providerId);
  }

  /**
   * Returns the runtime-fused view of the member: persisted profile fields
   * + provider `displayName` / legacy `persona` + computed
   * {@link WorkStatus}. Throws {@link ProviderNotFoundError} when the
   * provider does not exist — `displayName` has no sensible default.
   */
  getView(providerId: string): MemberView {
    const providerMeta = this.providers.get(providerId);
    if (!providerMeta) throw new ProviderNotFoundError(providerId);
    const profile = this.getProfile(providerId);
    return {
      ...profile,
      displayName: providerMeta.displayName,
      persona: providerMeta.persona,
      workStatus: this.getWorkStatus(providerId),
    };
  }

  /**
   * Apply the whitelisted `patch` to the member profile. Upserts the row —
   * a missing provider profile is materialised with the schema defaults
   * before the patch is merged.
   *
   * `updatedAt` is always bumped to `Date.now()` so UI consumers can drive
   * "edited at" indicators. The FK constraint surfaces an unknown
   * `providerId` as a SqliteError (`SQLITE_CONSTRAINT_FOREIGNKEY`) — we
   * let it bubble so callers see the raw cause instead of masking it.
   */
  updateProfile(providerId: string, patch: MemberProfilePatch): MemberProfile {
    const current = this.getProfile(providerId);
    const next: MemberProfile = {
      providerId,
      role:        patch.role        ?? current.role,
      personality: patch.personality ?? current.personality,
      expertise:   patch.expertise   ?? current.expertise,
      avatarKind:  patch.avatarKind  ?? current.avatarKind,
      // `avatarData` admits `null` meaningfully ("unset the custom
      // avatar"). Using `??` here would collapse `null` to the previous
      // value — use a strict undefined check so `null` is preserved.
      avatarData:  patch.avatarData === undefined ? current.avatarData : patch.avatarData,
      // Status override is deliberately NOT patchable through this method
      // (see module header). Carry the existing value forward untouched.
      statusOverride: current.statusOverride,
      updatedAt: this.now(),
    };
    this.repo.upsert(next);
    // R10-Task10: notify subscribers (StreamBridge → renderer reducer).
    // `cause: 'profile'` lets the UI distinguish a metadata edit from a
    // runtime status flip — the avatar / role row may need to re-render
    // even when workStatus is unchanged.
    this.emitStatusChanged(providerId, 'profile');
    return next;
  }

  /**
   * Toggle the manual work status.
   *   - `target='offline-manual'` → persist `statusOverride='offline-manual'`.
   *     Survives app restart (spec §7.2).
   *   - `target='online'`         → clear BOTH the manual override AND the
   *     runtime status entry. After this call {@link getWorkStatus}
   *     reverts to the {@link DEFAULT_RUNTIME_STATUS} default (`'offline-connection'`)
   *     until {@link reconnect} probes the provider again. Rationale: a
   *     stale runtime value (e.g. `'online'` from ten minutes ago) is a
   *     lie once the user has signalled intent to "come back to work" —
   *     we would rather report "unknown / unreachable" honestly than
   *     display a cached truth. We deliberately do NOT auto-trigger
   *     `reconnect` here: this method is synchronous and adding an async
   *     side-effect would surprise callers and tests. Callers who want
   *     immediate reachability feedback should call {@link reconnect}
   *     right after.
   *
   * Returns the updated profile so the caller can push it straight to UI.
   */
  setStatus(providerId: string, target: SetStatusTarget): MemberProfile {
    const nextOverride = target === 'offline-manual' ? 'offline-manual' : null;
    const now = this.now();
    this.repo.setStatusOverride(providerId, nextOverride, now);
    if (target === 'online') {
      // Drop any stale runtime value so getWorkStatus falls through to the
      // honest default instead of reporting a cached 'online'/'connecting'.
      this.runtimeStatus.delete(providerId);
    }
    // R10-Task10: emit AFTER the override + runtime mutation lands so
    // subscribers see the post-toggle state (manual → offline-manual,
    // online → cleared override + default runtime).
    this.emitStatusChanged(providerId, 'status');
    return this.getProfile(providerId);
  }

  /**
   * Probe the provider to refresh its runtime status.
   *
   * Concurrency: concurrent calls to `reconnect(providerId)` for the same
   * providerId are COALESCED onto a single in-flight probe (see
   * {@link reconnectInFlight}). The second caller does NOT start another
   * `warmup`; it receives the same `Promise<WorkStatus>` as the first.
   * This guarantees exactly one {@link MemberProviderLookup.warmup} call
   * per probe cycle and eliminates a last-write-wins race on the runtime
   * status map. Different providerIds do not coalesce — they run in
   * parallel as usual.
   *
   * Flow (first caller):
   *   1. Mark runtime status `'connecting'` so concurrent reads see the
   *      in-flight state.
   *   2. Await `provider.warmup()`.
   *      - Resolve ⇒ runtime status `'online'`.
   *      - Reject  ⇒ runtime status `'offline-connection'`. The original
   *        rejection cause is discarded intentionally (see
   *        {@link MemberProviderLookup.warmup}).
   *   3. Return the computed {@link WorkStatus} — which still considers
   *      a persisted `'offline-manual'` override. A user who toggled
   *      "leave work" mid-reconnect stays offline-manual in the UI
   *      regardless of warmup outcome. This is deliberate: manual intent
   *      wins.
   *   4. Regardless of success/failure, remove the in-flight entry so a
   *      future call issues a fresh probe.
   */
  reconnect(providerId: string): Promise<WorkStatus> {
    const existing = this.reconnectInFlight.get(providerId);
    if (existing) return existing;

    const pending = this.runProbe(providerId).finally(() => {
      this.reconnectInFlight.delete(providerId);
    });
    this.reconnectInFlight.set(providerId, pending);
    return pending;
  }

  /**
   * Drop all in-memory state tied to `providerId`. Intended to be called
   * by the Task 18 IPC layer immediately AFTER a provider is deleted from
   * the registry, so:
   *   - a stale runtime `WorkStatus` cannot surface from a later lookup,
   *   - a concurrent in-flight `reconnect` promise stops being shared
   *     with new callers (the promise itself still runs to completion —
   *     we cannot abort `warmup` — but its result will not be returned
   *     by a subsequent `reconnect` for a re-created provider with the
   *     same id).
   *
   * Persisted rows are NOT touched here — row deletion is the provider
   * registry's job via FK `ON DELETE CASCADE`.
   */
  forget(providerId: string): void {
    this.runtimeStatus.delete(providerId);
    this.reconnectInFlight.delete(providerId);
  }

  /**
   * Internal worker for {@link reconnect}. Performs the actual warmup +
   * runtime-map updates. Extracted so {@link reconnect} can wrap it in
   * the coalescing `Map` without duplicating the probe logic.
   */
  private async runProbe(providerId: string): Promise<WorkStatus> {
    this.runtimeStatus.set(providerId, 'connecting');
    // R10-Task10: emit the in-flight 'connecting' tick so the renderer
    // can render an immediate spinner — a slow warmup otherwise waits
    // out the full timeout before any status change is visible.
    this.emitStatusChanged(providerId, 'warmup');
    try {
      await this.providers.warmup(providerId);
      this.runtimeStatus.set(providerId, 'online');
    } catch {
      this.runtimeStatus.set(providerId, 'offline-connection');
    }
    // Terminal status — emit again so subscribers transition off the
    // 'connecting' spinner regardless of outcome.
    this.emitStatusChanged(providerId, 'warmup');
    return this.getWorkStatus(providerId);
  }

  /**
   * Compute the effective {@link WorkStatus} for a member.
   *
   * Decision tree (spec §7.2 + R9-Task10):
   *   1. If `statusOverride === 'offline-manual'`:
   *      1a. If the override's age (now - row.updatedAt) exceeds
   *          {@link offlineManualTimeoutMs}, the override has expired.
   *          Clear the persisted override (side-effect write) and fall
   *          through to step 2. Surfaces this as the user "coming back"
   *          automatically after an hour of inactivity.
   *      1b. Otherwise ⇒ `'offline-manual'`. The user's manual toggle
   *          wins over every runtime signal during the window.
   *   2. Return the runtime map value for `providerId`, falling back to
   *      {@link DEFAULT_RUNTIME_STATUS} when the map has no entry
   *      (never probed).
   *
   * The auto-clear path writes through {@link MemberProfileRepository.setStatusOverride}
   * (not a full `upsert`) so routine profile fields are untouched. A
   * `timeoutMs=0` option disables the auto-clear entirely so tests can
   * assert the pre-R9 behaviour without poking at real timestamps.
   */
  getWorkStatus(providerId: string): WorkStatus {
    const profile = this.repo.get(providerId);
    let didAutoClear = false;
    if (profile && profile.statusOverride === 'offline-manual') {
      if (this.isOfflineManualExpired(profile)) {
        // Side-effect: clear the persisted override so the next call
        // (and every renderer surface reading via IPC) sees the natural
        // runtime status instead of the stale manual flag. We reuse
        // setStatusOverride rather than setStatus('online') to avoid the
        // runtime-map clear — the runtime status already reflects the
        // latest warmup outcome and we want to surface that truth, not
        // the 'offline-connection' default.
        this.repo.setStatusOverride(providerId, null, this.now());
        didAutoClear = true;
      } else {
        return 'offline-manual';
      }
    }
    const result = this.runtimeStatus.get(providerId) ?? DEFAULT_RUNTIME_STATUS;
    // R10-Task10: surface the auto-clear as a `'status'` event so any
    // renderer surface (PeopleWidget badge / MemberRow) sees the user
    // automatically "come back from leave" without an explicit refetch.
    // Emit AFTER deriving `result` to avoid re-entering getWorkStatus
    // through the emitter (emitStatusChanged calls getWorkStatus too).
    if (didAutoClear) {
      this.emitStatusChanged(providerId, 'status');
    }
    return result;
  }

  /**
   * Whether the persisted `offline-manual` override should be treated as
   * expired. Isolated for readability and so a future R10 feature (UI
   * surface showing "will expire at ...") can reuse the predicate.
   *
   * Returns `false` when {@link offlineManualTimeoutMs} is `0` — callers
   * (tests) use that to opt out of the auto-clear path entirely. Any
   * positive value means "check the age".
   */
  private isOfflineManualExpired(profile: MemberProfile): boolean {
    if (this.offlineManualTimeoutMs <= 0) return false;
    return this.now() - profile.updatedAt > this.offlineManualTimeoutMs;
  }

  /**
   * Build the structured v3 persona string for a member. Convenience
   * wrapper over {@link buildEffectivePersona} that sources the fields
   * from the profile + provider lookup. Throws {@link ProviderNotFoundError}
   * for the same reason {@link getView} does.
   */
  buildPersona(providerId: string): string {
    const providerMeta = this.providers.get(providerId);
    if (!providerMeta) throw new ProviderNotFoundError(providerId);
    const profile = this.getProfile(providerId);
    return buildEffectivePersona({
      displayName: providerMeta.displayName,
      role: profile.role,
      personality: profile.personality,
      expertise: profile.expertise,
      legacyPersona: providerMeta.persona,
    });
  }

  // ── Internals ────────────────────────────────────────────────────────

  /**
   * Construct the default-populated profile returned when no row exists
   * for `providerId`. Centralised so the defaults stay in one place if
   * the schema changes.
   */
  private defaultProfile(providerId: string): MemberProfile {
    return {
      providerId,
      role: '',
      personality: '',
      expertise: '',
      avatarKind: 'default',
      avatarData: null,
      statusOverride: null,
      updatedAt: 0,
    };
  }
}
