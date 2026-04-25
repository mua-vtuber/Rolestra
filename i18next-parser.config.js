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
    // R7-Task5 ApprovalBlock / RejectDialog / ConditionalDialog
    // `mapErrorToI18nKey(reason)` returns a variable key — parser cannot
    // resolve statically. Keep the whole errors subtree in the catalogue.
    /^translation:messenger\.approval\.errors(\..+)?$/,
    // R7-Task12 — `approval.systemMessage.*` mirrors the Korean fixed
    // labels emitted by the main-process ApprovalSystemMessageInjector.
    // No renderer-side consumer today; reserved so renderer refactors can
    // switch from hardcoded prefixes to i18n lookups without breaking the
    // catalogue diff. Anchored to the `approval.*` namespace via
    // `approval.kind.*` static `t()` calls in ApprovalInboxView (parser's
    // orphan-namespace pruning only fires when NO static key survives in
    // the whole top-level namespace).
    /^translation:approval\.systemMessage(\..+)?$/,
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
    // R8-Task11 member.status.<WorkStatus> — referenced via
    // `t(WORK_STATUS_I18N_KEY[status])` in WorkStatusDot, where the key
    // table is composed at module load. The parser sees the constant
    // accessor, not the string literal, so the 4 status keys would be
    // pruned without this anchor.
    /^translation:member\.status(\..+)?$/,
    // R8-Task11 member.avatarPicker.* — the picker labels include
    // upload/upload-error templates with interpolation that the parser
    // does pick up, but we keep the full subtree to guard the catalogue
    // against partial-extraction prunes (some keys are referenced from
    // disabled-button text branches the parser may skip).
    /^translation:member\.avatarPicker(\..+)?$/,
    // R8-Task11 member.warmup.* — placeholder keys for future inline
    // warmup status surfaces (notification text in R10). Anchor exists
    // so populating these now does not get pruned by a parser pass
    // before they have a static `t()` callsite.
    /^translation:member\.warmup(\..+)?$/,
    // R8-Task11 profile.editor.* — labels referenced via constant prop
    // names (fields.role/personality/...) that the parser cannot resolve
    // from a single t() inspection. Same shape as project.create.kind.*
    // anchor above.
    /^translation:profile\.editor(\..+)?$/,
    // R8-Task11 profile.popover.* — actions/errors/fields are accessed
    // via static keys but the parser sees aggregate `t('profile.popover.actions.X')`
    // patterns that vary by branch. Anchored so the full subtree survives.
    /^translation:profile\.popover(\..+)?$/,
    // R8-Task9/Task11 meeting.turnSkipped — interpolation key consumed
    // by SystemMessage when meta.turnSkipped is present. The parser sees
    // it as a static key but the anchor preserves it across reorderings.
    /^translation:meeting\.turnSkipped$/,
    // R9-Task11 notification.* — main-process emits OS toast copy via the
    // `notification-labels.ts` dictionary; i18next is deliberately NOT
    // imported in the main bundle (Decision Log D8). The keys here
    // mirror the dictionary so the renderer can look up the same copy
    // via t() without drifting from what the OS actually shows. No
    // renderer callsite statically references these, so the full subtree
    // is anchored to survive parser prune.
    /^translation:notification(\..+)?$/,
    // R9-Task11 circuitBreaker.tripwire.<reason>.* — AutonomyConfirmDialog
    // renders the 4 tripwire limits via `t(\`circuitBreaker.tripwire.${key}.limit\`)`,
    // a template-string key the parser cannot statically resolve. The
    // `.title` / `.body` / `.reason` leaves are consumed by future
    // surfaces (R10 ApprovalInbox breaker row, autonomy.downgrade.reason
    // interpolation) — keep the full subtree.
    /^translation:circuitBreaker(\..+)?$/,
    // R9-Task11 autonomy.mode.* / autonomy.trace.* / autonomy.downgrade.*
    // — mode / tooltip variants are statically detected (6 leaves), but
    // trace/downgrade/generalMeetingDone are composed server-side in
    // main-process side-effects and main-process notification dictionaries.
    // Anchor the whole subtree so the parser does not prune them between
    // R9 and R10.
    /^translation:autonomy(\..+)?$/,
    // R9-Task11 queue.toast.* / queue.recovery.* — consumed by future
    // toast surfaces (R10) and the queue recovery banner. The panel
    // leaves (queue.panel.* + queue.status.*) are statically detected
    // but pluralization introduces `title_one`/`title_other` only; the
    // singular `title` base is kept for catalogue completeness. Anchor
    // the top namespace so new sub-surfaces do not require parser edits.
    /^translation:queue(\..+)?$/,
    // R9-Task11 settings.notifications.kind.<NotificationKind> — the
    // rendered kind → i18n-key map in NotificationPrefsView is branchy
    // (if/if chain) so the parser catches the leaves, but we anchor the
    // full settings subtree because R10 will populate provider / theme /
    // memory sections that land in the same catalogue pass.
    /^translation:settings(\..+)?$/,
    // R10-Task8 error.boundary.* / error.toast.* — ErrorBoundary fallback
    // and the toast viewport pull localized title/description/retry/dismiss.
    // The boundary itself uses static t() literals so the parser would
    // detect them, but anchor the whole `error.*` namespace so future
    // categorized error keys (network, permission, …) populate cleanly.
    /^translation:error(\..+)?$/,
  ],
  failOnWarnings: false,
};
