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
  //    least one statically-detected t() call.
  //
  //    2026-09 chat-first pivot: the work-automation surfaces (approvals,
  //    projects, dashboard, meetings/consensus, autonomy/circuit-breaker,
  //    queue, onboarding, LLM cost, permission flags) were removed from
  //    src/renderer/ entirely. Every anchor below was re-verified against
  //    the current source tree (grepped for both static and dynamic t()
  //    usage, plus the component files the old comments named) before
  //    this pass — anchors for namespaces with zero remaining consumers
  //    were dropped so they stop masking real orphan keys.
  keepRemoved: [
    // app.startupDiagnostics.settingsCorruption.{invalidJson,nonObject,
    // readError} — App.tsx composes `reasonKey` via a 3-branch ternary
    // then calls `t(reasonKey, { backupPath })`; the parser sees the
    // variable, not the literal. `.noBackup` is a separate, directly
    // called `t('app.startupDiagnostics.settingsCorruption.noBackup')`
    // and needs no anchor.
    /^translation:app\.startupDiagnostics\.settingsCorruption(\..+)?$/,
    // messenger.channelDelete.errors.* — ChannelDeleteConfirm.tsx's
    // `mapErrorToI18nKey(err)` returns a key *variable* (name-checked
    // against SystemChannelProtectedError / ChannelNotFoundError), which
    // the parser cannot statically resolve. The literal return values are
    // real keys so keeping them in sync here is safe.
    /^translation:messenger\.channelDelete\.errors(\..+)?$/,
    // R8-Task9/Task11 meeting.turnSkipped — interpolation key consumed
    // by SystemMessage.tsx when meta.turnSkipped is present (still a live
    // chat-room codepath: a member offline for their room turn).
    /^translation:meeting\.turnSkipped$/,
    // R8-Task11 member.status.<WorkStatus> — referenced via
    // `t(WORK_STATUS_I18N_KEY[status])` in WorkStatusDot.tsx, where the key
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
    // R8-Task11 profile.popover.* — actions/errors/fields are accessed
    // via static keys but the parser sees aggregate `t('profile.popover.actions.X')`
    // patterns that vary by branch. Anchored so the full subtree survives.
    /^translation:profile\.popover(\..+)?$/,
    // R9-Task11 settings.notifications.kind.<NotificationKind> — the
    // kind → i18n-key map in NotificationPrefsView is a lookup table
    // (`KIND_LABEL_KEY[kind]`), so the parser sees a variable rather than
    // a t() literal. 2026-10-01 (settings consolidation): this used to
    // anchor the whole `settings` subtree, which kept every retired tab's
    // keys alive. The new settings screens call t() with literal keys
    // (switch per value), so only this lookup table needs an anchor.
    /^translation:settings\.notifications\.kind(\..+)?$/,
    // R10-Task8 error.boundary.* / error.toast.* — ErrorBoundary.tsx's
    // fallback and the toast viewport pull localized title/description/
    // retry/dismiss. The boundary itself uses static t() literals so the
    // parser detects them, but anchor the whole `error.*` namespace so
    // future categorized error keys populate cleanly.
    /^translation:error(\..+)?$/,
    // messenger.ssmBox.* — GeneralVariant.tsx (the SsmBox general-channel
    // opinion-card variant) composes several template keys:
    // `messenger.ssmBox.variants.general.kind.${opinion.kind}`,
    // `...aiVote.status.${vote.status}`, `...aiVote.count.${key}`,
    // `...aiVote.choice.${participant.vote}`,
    // `...aiVote.participantStatus.${participant.status}`,
    // `...aiVote.failure.${participant.error}`.
    /^translation:messenger\.ssmBox(\..+)?$/,
    // messenger.postOpinion.* — PostOpinionModal.tsx's
    // `mapErrorToI18nKey(reason)` returns
    // messenger.postOpinion.errors.{validation,generic} as a key variable.
    /^translation:messenger\.postOpinion(\..+)?$/,
    // C2 (2026-09) — chat-notice.ts's shared observer-notice renderer
    // resolves `t(\`messenger.whisper.errors.${chatError}\`)` for every
    // ChatErrorCode (invalid_response, provider_unavailable, provider_error,
    // timeout, whisper_limit, opinion_registration_failed,
    // recipient_unavailable, participant_alias_collision,
    // consensus_folder_contains_app_data — see src/shared/message-types.ts
    // CHAT_ERROR_CODES). New codes must be added to BOTH catalogs when
    // added there. messenger.whisper.label/replyLabel used to need this
    // anchor too but are now selected via `cond ? t('a') : t('b')` in
    // Message.tsx / SearchResultRow.tsx, which the parser detects
    // statically — no anchor needed for those two.
    /^translation:messenger\.whisper\.errors(\..+)?$/,
    // F1 (2026-09-29, spec 2026-09-29-ai-setup-and-character.md) — the AI
    // add dialog composes `t(\`providerConnect.service.${choice}.name\`)` /
    // `.vendor` (add-ai/ApiSection.tsx) and `.defaultName`
    // (add-ai/use-provider-connect.ts) from `API_SERVICE_CHOICES`
    // (src/shared/api-service-catalog.ts: anthropic/openai/google/other).
    /^translation:providerConnect\.service(\..+)?$/,
    // F1-6 — add-ai/ApiSection.tsx composes
    // `t(\`providerConnect.modelListError.${reason}\`)` from the
    // ModelListFailureReason returned by provider:list-models
    // (auth/network/parse — src/shared/provider-types.ts).
    /^translation:providerConnect\.modelListError(\..+)?$/,
    // C4 (2026-09) — Composer.tsx's `placeholderKey` is
    // `disabledPlaceholderKey ?? (log layout ? 'messenger.composer.placeholderLog'
    // : 'messenger.composer.placeholder')` (2026-10-01 R3-7) and is then
    // passed to `t(placeholderKey)` as a variable, so the parser sees a
    // variable rather than the two literals.
    /^translation:messenger\.composer\.placeholder(Log)?$/,
  ],
  failOnWarnings: false,
};
