/** @type {import('i18next-parser').UserConfig} */
export default {
  locales: ['ko', 'en'],
  defaultNamespace: 'translation',
  output: 'src/renderer/i18n/locales/$LOCALE.json',
  input: ['src/renderer/**/*.{ts,tsx}'],
  sort: true,
  createOldCatalogs: false,
  // Keep keys the parser cannot detect statically.
  // NOTE: i18next-parser removes orphan namespaces entirely — regex-based
  // keepRemoved only protects keys *within* namespaces that contain at least
  // one statically-detected t() call. For R3, the 15-domain declaration lives
  // in TypeScript (src/renderer/i18n/keys.ts `I18N_NAMESPACES`); each Phase
  // populates its domain with real keys as UI lands.
  keepRemoved: [],
  failOnWarnings: false,
};
