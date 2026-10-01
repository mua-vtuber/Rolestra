import type { MessageViewer } from '../../shared/message-types';

export const PUBLIC_MESSAGE_VIEWER: MessageViewer = { kind: 'public' };

interface SqlPolicy { predicate: string; params: string[] }

/**
 * Stored system rows are written for the human observer only. No
 * model-facing viewer receives them: CLI initial, delta and recovery input,
 * API history, vote context and model search all read through
 * {@link messageVisibilitySql}, so the filter runs in SQL before LIMIT,
 * cursors and search snippets.
 *
 * - Chat notices — failures (`meta.chatError`) and silences
 *   (`meta.chatSilence`, `OBSERVER_NOTICE_META_KEYS`). Hiding silence keeps a
 *   whisper-only turn indistinguishable from a silent one for third AIs.
 * - Legacy pre-pivot system rows (spec 2026-09-29 §C). They were never chat
 *   content: the old responder's `응답 실패: <error>` lines carry provider
 *   error text (command paths, model names), and meeting notices such as
 *   `meeting.turnSkipped|<name>|<reason>` carry old registration names. In
 *   the general channel every AI would read another AI's failure line, which
 *   tells it what that participant runs on.
 *
 * Model-facing turn hints are never stored; callers add them per call.
 */
function storedSystemRowSql(alias: string): string {
  return `(${alias}.role = 'system')`;
}

/**
 * A stored system row reached a model-input builder although the viewer SQL
 * above excludes it. The builders (API history, CLI input, vote context)
 * refuse it instead of passing it on: if the filter ever regressed, old
 * failure text with command paths and model names would otherwise reach a
 * model without anyone noticing. Carries identifiers only, never content.
 */
export class SystemRowInModelInputError extends Error {
  constructor(readonly channelId: string, readonly messageId: string | null) {
    super(`Stored system row ${messageId ?? '(no id)'} reached model input in channel ${channelId}; ` +
      'the message visibility filter must exclude it');
    this.name = 'SystemRowInModelInputError';
  }
}

/**
 * Who may know a row exists: everyone for public rows, only the two AI
 * participants for a whisper. Checkpoint cursors are validated with this
 * alone, so a cursor saved on a system row (before system rows left model input)
 * still resumes its session instead of rebuilding it.
 */
export function messageAudienceSql(
  alias: string,
  viewer: MessageViewer = PUBLIC_MESSAGE_VIEWER,
): SqlPolicy {
  if (viewer.kind === 'observer') return { predicate: '1 = 1', params: [] };
  if (viewer.kind === 'public') {
    return { predicate: `${alias}.visibility = 'public'`, params: [] };
  }
  if (!viewer.providerId) throw new Error('Provider viewer requires an id');
  return {
    predicate: `(${alias}.visibility = 'public' OR (` +
      `${alias}.visibility = 'whisper' AND (` +
      `${alias}.author_id = ? OR ${alias}.whisper_recipient_id = ?)))`,
    params: [viewer.providerId, viewer.providerId],
  };
}

/** Build the same SQL policy for paging, search, and CLI recovery. */
export function messageVisibilitySql(
  alias: string,
  viewer: MessageViewer = PUBLIC_MESSAGE_VIEWER,
): SqlPolicy {
  const audience = messageAudienceSql(alias, viewer);
  if (viewer.kind === 'observer') return audience;
  return {
    predicate: `(${audience.predicate} AND NOT ${storedSystemRowSql(alias)})`,
    params: audience.params,
  };
}
