/** @type {import('i18next-parser').UserConfig} */
export default {
  locales: ['ko', 'en'],
  defaultNamespace: 'translation',
  output: 'src/renderer/i18n/locales/$LOCALE.json',
  input: ['src/renderer/**/*.{ts,tsx}'],
  sort: true,
  createOldCatalogs: false,
  // Keep keys the parser cannot detect statically.
  //
  // NOTE on regex shape:
  //
  // 1. i18next-parser matches each pattern against the *full* key path, where
  //    the path is `<namespace><namespaceSeparator><dotted-key>`. With the
  //    defaults used here that is `translation:<dotted-key>` — so every
  //    pattern is anchored to `^translation:`.
  //
  // 2. The parser's merge logic walks `source` (the existing catalog on disk)
  //    and when a leaf-or-subtree is *missing* from the freshly-extracted
  //    `target`, it tests whichever node is still in `source` at that depth.
  //    That means for a pruned subtree the regex is tested against the
  //    subtree-root path (e.g. `translation:project.create.sourcePath`), not
  //    the leaves underneath. Patterns therefore accept an optional
  //    `(\..+)?` tail so they match both the subtree root and any descendant
  //    leaf the parser might happen to visit.
  //
  // 3. i18next-parser removes orphan namespaces entirely — regex-based
  //    keepRemoved only protects keys *within* namespaces that contain at
  //    least one statically-detected t() call. For R3 the 15-domain
  //    declaration lives in TypeScript (src/renderer/i18n/keys.ts
  //    `I18N_NAMESPACES`); each Phase populates its domain with real keys
  //    as UI lands.
  keepRemoved: [
    // permissionMode.{auto,autoHint,hybrid,hybridHint,approval,approvalHint}
    // are referenced in ProjectPermissionRadio via a titleKey/hintKey config
    // array — the parser sees the string literals but not as t() call targets.
    /^translation:project\.create\.permissionMode(\..+)?$/,
    // sourcePath.{choose,label} are passed as prop-name strings to
    // ExternalPathPicker (labelKey/chooseLabelKey) from ProjectCreateModal
    // when kind === 'imported'. The parser warns "Key is not a string literal"
    // because the prop name, not the resolved key, is what reaches t().
    /^translation:project\.create\.sourcePath(\..+)?$/,
    // externalPath.{choose,label} — same pattern as sourcePath; passed as
    // labelKey/chooseLabelKey props to ExternalPathPicker when kind ===
    // 'external'. notSelected is statically detectable so it's covered
    // anyway, but including it here is harmless.
    /^translation:project\.create\.externalPath(\..+)?$/,
    // kind.{new,newHint,external,externalHint,imported,importedHint} are
    // declared in a ProjectKindTabs option array as titleKey/hintKey string
    // literals; the parser doesn't follow them back to t() calls.
    /^translation:project\.create\.kind(\..+)?$/,
    // errors.{duplicateSlug,folderMissing,junctionTOCTOU} are selected by a
    // helper that maps server error codes → key strings, then passed through
    // t(key). The parser sees a variable, not a literal, so only the keys
    // that happen to appear in a direct t('...') call survive extraction.
    /^translation:project\.errors(\..+)?$/,
    // approvals.kind.{cli_permission,consensus_decision,failure_report,
    // mode_transition,review_outcome} are accessed via
    // t(`dashboard.approvals.kind.${item.kind}`) in ApprovalsWidget.
    /^translation:dashboard\.approvals\.kind(\..+)?$/,
    // approvals.count is the pluralised base key; i18next resolves
    // count_one / count_other from it but the parser only emits the suffixed
    // variants. Keep the singular for catalogue completeness.
    /^translation:dashboard\.approvals\.count$/,
    // shell.topbar.subtitle is a reserved fallback — ShellTopBar renders it
    // when no activeProjectName is set and no explicit subtitle prop is
    // passed. App.tsx doesn't currently wire it, but the component contract
    // keeps the slot available for future screens.
    /^translation:shell\.topbar\.subtitle$/,
    // app.mainPlaceholder is retained as the canonical R3 → R4 migration
    // negative-assertion target referenced by App.test.tsx line 188
    // ("does NOT render the app.mainPlaceholder text anywhere"). Keeping
    // it in the catalogue lets the regression test use a real key instead
    // of a hardcoded literal.
    /^translation:app(\..+)?$/,
    // R5-Task10 channel CRUD modals use a `mapErrorToI18nKey(reason)` helper
    // that returns a key *variable*, which the parser cannot statically resolve.
    // The keys themselves are literal returns so they are safe to keep in sync
    // with the code — adding them under keepRemoved preserves the catalogue.
    /^translation:messenger\.channelCreate\.errors(\..+)?$/,
    /^translation:messenger\.channelRename\.errors(\..+)?$/,
    /^translation:messenger\.channelDelete\.errors(\..+)?$/,
    // R5-Task11 StartDmButton `mapErrorToI18nKey` — same variable-key pattern.
    /^translation:messenger\.startDm\.errors(\..+)?$/,
    // R6-Task11 meeting.state.<SSM> — composed via
    // `t('meeting.state.${ssmState}')` in MeetingBanner / MinutesComposer.
    // The 12 SSM state names are variable-keyed so the parser cannot
    // resolve them statically.
    /^translation:meeting\.state(\..+)?$/,
    /^translation:meeting\.banner\.state(\..+)?$/,
    // R6-Task11 meeting.error.<kind> — same variable-keyed pattern when
    // rendering a failed-meeting banner via `t('meeting.error.${kind}')`.
    /^translation:meeting\.error(\..+)?$/,
    // R6-Task11 meeting.minutes.* — MinutesComposer reads these through
    // an injected translator; keep the full subtree intact so the
    // parser does not prune unseen header labels.
    /^translation:meeting\.minutes(\..+)?$/,
    /^translation:meeting\.notification(\..+)?$/,
  ],
  failOnWarnings: false,
};
