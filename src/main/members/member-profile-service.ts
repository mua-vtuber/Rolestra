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
 *     {@link ProviderLookup} and update the runtime map on success or
 *     failure.
 *
 * Provider dependency (structural):
 *   The service intentionally depends on a narrow {@link ProviderLookup}
 *   interface rather than the production `ProviderRegistry`. This mirrors
 *   the `ProjectLookup` pattern from Task 6 and keeps tests simple — they
 *   pass a stub with a `get()` and `warmup()` implementation without
 *   pulling the whole provider tree. Task 18's IPC wiring injects the
 *   real adapter.
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

import type {
  AvatarKind,
  MemberProfile,
  MemberView,
  WorkStatus,
} from '../../shared/member-profile-types';
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
export interface ProviderLookup {
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

export class MemberProfileService {
  /**
   * In-memory runtime status per provider. Keyed by `providerId`. Absent
   * keys resolve to {@link DEFAULT_RUNTIME_STATUS} via
   * {@link getWorkStatus}.
   */
  private readonly runtimeStatus = new Map<string, WorkStatus>();

  constructor(
    private readonly repo: MemberProfileRepository,
    private readonly providers: ProviderLookup,
  ) {}

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
      updatedAt: Date.now(),
    };
    this.repo.upsert(next);
    return next;
  }

  /**
   * Toggle the manual work status.
   *   - `target='offline-manual'` → persist `statusOverride='offline-manual'`.
   *     Survives app restart (spec §7.2).
   *   - `target='online'`         → clear the override. Runtime status
   *     takes over immediately; callers typically follow up with
   *     {@link reconnect} to actually bring the member online.
   *
   * Returns the updated profile so the caller can push it straight to UI.
   */
  setStatus(providerId: string, target: SetStatusTarget): MemberProfile {
    const nextOverride = target === 'offline-manual' ? 'offline-manual' : null;
    const now = Date.now();
    this.repo.setStatusOverride(providerId, nextOverride, now);
    return this.getProfile(providerId);
  }

  /**
   * Probe the provider to refresh its runtime status.
   *
   * Flow:
   *   1. Mark runtime status `'connecting'` so concurrent reads see the
   *      in-flight state.
   *   2. Await `provider.warmup()`.
   *      - Resolve ⇒ runtime status `'online'`.
   *      - Reject  ⇒ runtime status `'offline-connection'`. The original
   *        rejection cause is discarded intentionally (see
   *        {@link ProviderLookup.warmup}).
   *   3. Return the computed {@link WorkStatus} — which still considers
   *      a persisted `'offline-manual'` override. A user who toggled
   *      "leave work" mid-reconnect stays offline-manual in the UI
   *      regardless of warmup outcome. This is deliberate: manual intent
   *      wins.
   */
  async reconnect(providerId: string): Promise<WorkStatus> {
    this.runtimeStatus.set(providerId, 'connecting');
    try {
      await this.providers.warmup(providerId);
      this.runtimeStatus.set(providerId, 'online');
    } catch {
      this.runtimeStatus.set(providerId, 'offline-connection');
    }
    return this.getWorkStatus(providerId);
  }

  /**
   * Compute the effective {@link WorkStatus} for a member.
   *
   * Decision tree (spec §7.2):
   *   1. If `statusOverride === 'offline-manual'` ⇒ `'offline-manual'`.
   *      The user's manual toggle wins over every runtime signal.
   *   2. Otherwise, return the runtime map value for `providerId`, falling
   *      back to {@link DEFAULT_RUNTIME_STATUS} when the map has no entry
   *      (never probed).
   */
  getWorkStatus(providerId: string): WorkStatus {
    const profile = this.repo.get(providerId);
    if (profile && profile.statusOverride === 'offline-manual') {
      return 'offline-manual';
    }
    return this.runtimeStatus.get(providerId) ?? DEFAULT_RUNTIME_STATUS;
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
