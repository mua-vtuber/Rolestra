/**
 * Default avatar catalogue — 8-entry palette used when a member has
 * `avatarKind='default'` (spec §7.1).
 *
 * Lives in `shared/` (not `main/`) because BOTH layers need the tuple:
 *
 *   - Main (`src/main/ipc/handlers/member-handler.ts`) iterates `key` + a
 *     human label for the `member:list-avatars` IPC response.
 *   - Renderer (`src/renderer/components/members/Avatar.tsx` — R8-Task2)
 *     renders the `color` swatch + `emoji` glyph inline (no IPC round-trip
 *     per render).
 *
 * Without the shared mirror the renderer would need a per-render IPC
 * call OR a separate hard-coded copy that drifts from the main one. We
 * pick the cheaper option — single source of truth in `shared/`.
 *
 * Semantics:
 *   - `key`  — stable identifier persisted in `member_profiles.avatar_data`.
 *              Never rename an existing key; add new ones instead (old
 *              profiles reference the key verbatim).
 *   - `color`— hex triplet consumed by the renderer (inline `style.background`).
 *   - `emoji`— Unicode glyph rendered inside the bubble.
 *
 * The list is `as const` so callers get a literal-typed tuple instead of a
 * loose array — consumers can discriminate on `key` without string widening.
 *
 * Spec §7.1 "기본 아바타 풀(8개)" — the count is load-bearing: the member
 * profile test asserts the catalogue length to catch accidental additions
 * or removals that would break the UI picker layout.
 */
export const DEFAULT_AVATARS = [
  { key: 'blue-dev',       color: '#3b82f6', emoji: '🧑‍💻' },
  { key: 'green-design',   color: '#10b981', emoji: '🎨' },
  { key: 'purple-science', color: '#8b5cf6', emoji: '🔬' },
  { key: 'amber-writer',   color: '#f59e0b', emoji: '✍️' },
  { key: 'rose-mentor',    color: '#ef4444', emoji: '🧑‍🏫' },
  { key: 'cyan-analyst',   color: '#06b6d4', emoji: '📊' },
  { key: 'slate-ops',      color: '#64748b', emoji: '⚙️' },
  { key: 'pink-product',   color: '#ec4899', emoji: '💡' },
] as const;

/** Literal union of the keys exposed by {@link DEFAULT_AVATARS}. */
export type DefaultAvatarKey = (typeof DEFAULT_AVATARS)[number]['key'];

/**
 * Lookup helper — returns the catalogue entry for `key`, or `null` when the
 * key is unknown (e.g. a stale value persisted before a key was renamed in
 * a prior life of this catalogue — should not happen given the no-rename
 * rule, but the renderer must degrade gracefully rather than crash).
 */
export function findDefaultAvatar(
  key: string,
): (typeof DEFAULT_AVATARS)[number] | null {
  return DEFAULT_AVATARS.find((a) => a.key === key) ?? null;
}
