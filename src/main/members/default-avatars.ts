/**
 * Default avatar catalogue — 8-entry palette used when a member has
 * `avatarKind='default'`.
 *
 * Each entry pairs a semantic `key` (stored in `member_profiles.avatar_data`
 * when `avatarKind='default'`) with a colour swatch and an emoji glyph. The
 * renderer uses the tuple to render a coloured bubble with the emoji inside.
 *
 * Semantics:
 *   - `key`  — stable identifier persisted in `avatar_data`. Never rename an
 *              existing key; add new ones instead (old profiles reference the
 *              key verbatim).
 *   - `color`— hex triplet consumed by the renderer.
 *   - `emoji`— Unicode glyph rendered inside the bubble.
 *
 * The list is `as const` so callers get a literal-typed tuple instead of a
 * loose array — consumers can discriminate on `key` without string widening.
 *
 * Spec §7.1 "기본 아바타 풀(8개)" — the count is load-bearing: the member
 * profile test asserts the catalogue length to catch accidental additions or
 * removals that would break the UI picker layout.
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
