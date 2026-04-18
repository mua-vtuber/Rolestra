/** @type {import('i18next-parser').UserConfig} */
export default {
  locales: ['ko', 'en'],
  defaultNamespace: 'translation',
  output: 'src/renderer/i18n/locales/$LOCALE.json',
  input: ['src/renderer/**/*.{ts,tsx}'],
  sort: true,
  createOldCatalogs: false,
  // Keep dynamic keys that the parser cannot detect statically (regex patterns).
  // NOTE: i18next-parser tests `fullKeyPrefix + key` where fullKeyPrefix includes
  // the namespace prefix (e.g. "translation:"). Patterns must NOT use ^ anchor
  // so they match regardless of the namespace prefix.
  keepRemoved: [
    // consensus vote types — t(`consensus.${v.vote}`)
    /consensus\.(agree|disagree|block|abstain)$/,
    // consensus block reasons — t(`consensus.blockReason${camelCase}`)
    /consensus\.blockReason/,
    // provider status — t(`provider.status.${status}`)
    /provider\.status/,
    // provider type — t(`provider.type.${type}`)
    /provider\.type/,
    // session state — t(`session.state.${state}`)
    /session\.state/,
    // session mode transition judgment — t(`session.modeTransition.judgment.${j}`)
    /session\.modeTransition\.judgment/,
    // session mode transition reason — t(`session.modeTransition.reason.${reason}`)
    /session\.modeTransition\.reason/,
    // tailscale backend state — t(`remote.tailscaleState${backendState}`)
    /remote\.tailscaleState/,
    // diff operations — t(`diff.op.${operation}`)
    /diff\.op/,
    // memory topics — t(`memory.topic.${tp}`)
    /memory\.topic/,
    // nav items — used via dynamic labelKey
    /nav\.(chat|settings)$/,
  ],
  failOnWarnings: false,
};
