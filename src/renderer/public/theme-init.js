/* global localStorage, document, window */
// Prevent FOUC (flash-of-unstyled-content) by reading the persisted
// theme BEFORE React mounts. Mirrors src/renderer/theme/theme-store.ts:
// storage key 'rolestra.theme.v1', store version 1 (any other version
// is reset to the defaults by the store), brightness 'system' follows
// prefers-color-scheme. Without a usable value the <html> defaults
// (tactical + dark, the store defaults) stay in place.
(function () {
  try {
    var raw = localStorage.getItem('rolestra.theme.v1');
    if (!raw) return;
    var parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== 1 || !parsed.state) return;
    var themeKey = parsed.state.themeKey;
    var mode = parsed.state.mode;
    if (themeKey === 'tactical' || themeKey === 'retro') {
      document.documentElement.dataset.theme = themeKey;
    }
    if (mode === 'system' && typeof window.matchMedia === 'function') {
      mode = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    if (mode === 'light' || mode === 'dark') {
      document.documentElement.dataset.mode = mode;
    }
  } catch {
    /* keep the <html> defaults; ThemeProvider applies the real store state on mount */
  }
})();
