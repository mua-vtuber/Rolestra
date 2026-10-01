/**
 * Settings tab keys and their URL-hash route (`#settings/<tab>`).
 *
 * Spec 2026-10-01-messenger-redesign.md R5-1: exactly three tabs — general
 * (language / theme / brightness / conversation-log folder / notifications),
 * ai (registered AIs, add, edit, keys) and about. The hash is the deep-link
 * contract: other screens (the empty chat guidance) open a tab with
 * {@link requestSettingsTab} before switching the app view to settings.
 */

export const SETTINGS_TAB_KEYS = ['general', 'ai', 'about'] as const;

export type SettingsTabKey = (typeof SETTINGS_TAB_KEYS)[number];

export const DEFAULT_SETTINGS_TAB: SettingsTabKey = 'general';

const HASH_PREFIX = '#settings/';

export function isSettingsTabKey(value: string): value is SettingsTabKey {
  return (SETTINGS_TAB_KEYS as readonly string[]).includes(value);
}

/** True when the current hash points into settings at all. */
export function isSettingsHash(hash: string): boolean {
  return hash.startsWith(HASH_PREFIX);
}

/**
 * The tab the current hash asks for. A hash outside settings, or one naming
 * a tab that no longer exists (a pre-2026-10 link such as `#settings/members`),
 * opens the default tab.
 */
export function readSettingsTabFromHash(hash: string): SettingsTabKey {
  if (!isSettingsHash(hash)) return DEFAULT_SETTINGS_TAB;
  const key = hash.slice(HASH_PREFIX.length);
  return isSettingsTabKey(key) ? key : DEFAULT_SETTINGS_TAB;
}

export function settingsTabHash(key: SettingsTabKey): string {
  return `${HASH_PREFIX}${key}`;
}

/**
 * Points the settings route at `key` without adding a history entry and
 * notifies a mounted settings screen (replaceState alone fires no
 * `hashchange`). A settings screen mounted afterwards reads the hash itself.
 */
export function requestSettingsTab(key: SettingsTabKey): void {
  const next = settingsTabHash(key);
  if (window.location.hash === next) return;
  window.history.replaceState(null, '', next);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}
