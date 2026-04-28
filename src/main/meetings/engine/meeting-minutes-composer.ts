/**
 * MeetingMinutesComposer — builds the markdown body posted to the
 * `#회의록` system channel when an SSM reaches DONE or FAILED.
 *
 * R6 D3 (spec §10 R6 Decision Log): the R6 minutes format is **메타
 * 헤더 + 합의본 원문** — a pure assembly of the snapshot fields. No LLM
 * round-trip is involved; LLM-based summarisation lands in R10.
 *
 * Layout (happy path, `SSM.state === 'DONE'`):
 *   ## 회의 #<shortId>
 *
 *   **참여자**: <AI 1>, <AI 2>, …
 *   **주제**: <topic>
 *   **SSM 최종 상태**: DONE
 *   **경과 시간**: <분>분
 *   **투표**: ✓ <yes> · ✗ <no> · · <pending>
 *
 *   ---
 *
 *   <proposal 본문>
 *
 *   ---
 *
 *   _회의 종료: <YYYY-MM-DD HH:mm>_
 *
 * FAILED path adds a `**종료 사유**` line and omits the proposal section
 * if there is none (falls back to `_합의본 없음_`).
 *
 * The composer is a **pure function** — no DB, no filesystem, no network.
 * Callers pass everything it needs; the orchestrator owns the wiring to
 * `messageService.append`.
 */

import {
  getNotificationLocale,
  type NotificationLocale,
} from '../../notifications/notification-labels';
import type { VoteRecord } from '../../../shared/consensus-types';
import type { Participant } from '../../../shared/engine-types';
import type { SessionSnapshot, SessionState } from '../../../shared/session-state-types';

/** Short id prefix length — first segment of a UUID for display. */
const SHORT_ID_LENGTH = 8;

/** Milliseconds in one minute — used for elapsed-time rounding. */
const MS_PER_MINUTE = 60_000;

/** Cap for the failure-reason paragraph to keep minutes readable. */
const FAILURE_REASON_MAX = 240;

/**
 * F5-T5: same locale union as NotificationDictionary. The minutes channel
 * is a main-process side-effect (composeMinutes runs inside the orchestrator
 * after the SSM reaches DONE/FAILED), and the v3 design forbids importing
 * `i18next` from main — so locale-aware default labels piggy-back on the
 * already-globally-tracked notification locale.
 */
export type MinutesLocale = NotificationLocale;

export interface MinutesComposeInput {
  /** Meeting row id — short form appears in the header title. */
  meetingId: string;
  /** Free-form meeting topic supplied by the user. */
  topic: string;
  /** SSM participants, used to render the 참여자 line. The 'user' sentinel
   *  is filtered out automatically (minutes only list AI participants). */
  participants: readonly Participant[];
  /** Final SSM snapshot — source of state/proposal/votes. */
  snapshot: SessionSnapshot;
  /** Epoch ms at which the meeting started (for elapsed-time calc). */
  startedAt: number;
  /** Epoch ms the meeting ended (defaults to `Date.now()` when omitted). */
  endedAt?: number;
  /**
   * Optional i18n translator. When present the composer calls `t(key)`
   * for every static label; the default labels resolve through the
   * locale-aware {@link MinutesDictionary} (F5-T5) and override only
   * when `t` returns a non-key value.
   */
  t?: MinutesTranslator;
  /**
   * Locale for default labels when `t` is missing or returns the key
   * verbatim. Defaults to {@link getNotificationLocale}, so the minutes
   * channel matches the active OS-notification language without an
   * extra setting.
   */
  locale?: MinutesLocale;
}

/**
 * Subset of the i18next `t` contract we rely on. Callers typically pass
 * a bound i18next instance directly; tests pass a map-backed stub.
 */
export type MinutesTranslator = (key: string) => string;

/**
 * Static label dictionary mirrored to ko/en — same shape as
 * NotificationDictionary so a future refactor can collapse the two.
 * Keys mirror the renderer's `meeting.minutes.*` namespace.
 */
interface MinutesDictionary {
  header: {
    titlePrefix: string;
    participants: string;
    topic: string;
    ssmFinal: string;
    elapsed: string;
    elapsedUnit: string;
    votes: string;
    minutesFooter: string;
  };
  failed: {
    reason: string;
    noConsensus: string;
    unknown: string;
    /** `{{previous}}` interpolation placeholder. */
    previousState: string;
  };
}

const KO: MinutesDictionary = {
  header: {
    titlePrefix: '회의',
    participants: '참여자',
    topic: '주제',
    ssmFinal: 'SSM 최종 상태',
    elapsed: '경과 시간',
    elapsedUnit: '분',
    votes: '투표',
    minutesFooter: '회의 종료',
  },
  failed: {
    reason: '종료 사유',
    noConsensus: '합의본 없음',
    unknown: '사유 불명 — 이전 상태 기록 없음',
    previousState: '이전 상태 {{previous}}에서 종료',
  },
};

const EN: MinutesDictionary = {
  header: {
    titlePrefix: 'Meeting',
    participants: 'Participants',
    topic: 'Topic',
    ssmFinal: 'SSM final state',
    elapsed: 'Elapsed',
    elapsedUnit: 'min',
    votes: 'Votes',
    minutesFooter: 'Meeting ended',
  },
  failed: {
    reason: 'Failure reason',
    noConsensus: 'No consensus body',
    unknown: 'Unknown reason — no previous-state record',
    previousState: 'Ended in previous state {{previous}}',
  },
};

const DICTIONARIES: Record<MinutesLocale, MinutesDictionary> = { ko: KO, en: EN };

/**
 * Resolves a flat key (`'header.titlePrefix'`, `'failed.unknown'`) against
 * the dictionary for the supplied locale. Mirrors the
 * NotificationDictionary lookup helper. Unknown keys return the literal
 * key so missing-key bugs surface in the minutes body rather than a blank.
 */
function lookupLabel(locale: MinutesLocale, key: string): string {
  const dict = DICTIONARIES[locale] ?? DICTIONARIES.ko;
  const segments = key.split('.');
  let node: unknown = dict;
  for (const seg of segments) {
    if (node === null || typeof node !== 'object') return key;
    node = (node as Record<string, unknown>)[seg];
  }
  return typeof node === 'string' ? node : key;
}

/** Same `{{name}}` interpolation as i18next — keeps the contract local. */
function interpolate(
  template: string,
  vars: Record<string, string | number>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => {
    const value = vars[name];
    return value === undefined ? '' : String(value);
  });
}

/**
 * Maps the legacy flat `meeting.minutes.*` keys (used by callers that
 * pass an i18next-bound `t`) onto the {@link MinutesDictionary} shape.
 * The orchestrator threads its own `t`; tests rely on the default
 * dictionary path. Both stay in sync through this mapping.
 */
function legacyKeyToDict(key: string): string | null {
  const PREFIX = 'meeting.minutes.';
  if (!key.startsWith(PREFIX)) return null;
  return key.slice(PREFIX.length);
}

/**
 * Compose the markdown minutes body for the given terminal snapshot.
 * Idempotent — the same inputs always produce the same string.
 */
export function composeMinutes(input: MinutesComposeInput): string {
  const locale = input.locale ?? getNotificationLocale();
  const translate = createTranslator(input.t, locale);
  const endedAt = input.endedAt ?? Date.now();
  const elapsedMinutes = computeElapsedMinutes(input.startedAt, endedAt);
  const voteTally = tallyVotes(input.snapshot.votes ?? []);
  const aiParticipants = input.participants.filter((p) => p.id !== 'user');

  const lines: string[] = [];

  // ── Title ────────────────────────────────────────────────────────
  lines.push(
    `## ${translate('meeting.minutes.header.titlePrefix')} #${shortId(input.meetingId)}`,
  );
  lines.push('');

  // ── Meta block ───────────────────────────────────────────────────
  lines.push(
    `**${translate('meeting.minutes.header.participants')}**: ${formatParticipants(aiParticipants)}`,
  );
  lines.push(
    `**${translate('meeting.minutes.header.topic')}**: ${input.topic.trim() || '-'}`,
  );
  lines.push(
    `**${translate('meeting.minutes.header.ssmFinal')}**: ${input.snapshot.state}`,
  );
  lines.push(
    `**${translate('meeting.minutes.header.elapsed')}**: ${elapsedMinutes}${translate('meeting.minutes.header.elapsedUnit')}`,
  );
  lines.push(
    `**${translate('meeting.minutes.header.votes')}**: ${formatVoteTally(voteTally)}`,
  );

  // FAILED path: add the failure-reason line above the divider so readers
  // see WHY before they see the proposal gap.
  if (input.snapshot.state === 'FAILED') {
    lines.push(
      `**${translate('meeting.minutes.failed.reason')}**: ${formatFailureReason(input.snapshot, locale)}`,
    );
  }

  lines.push('');
  lines.push('---');
  lines.push('');

  // ── Body (proposal / fallback) ───────────────────────────────────
  const proposal = (input.snapshot.proposal ?? '').trim();
  if (proposal.length > 0) {
    lines.push(proposal);
  } else {
    lines.push(`_${translate('meeting.minutes.failed.noConsensus')}_`);
  }

  lines.push('');
  lines.push('---');
  lines.push('');

  // ── Footer ───────────────────────────────────────────────────────
  lines.push(
    `_${translate('meeting.minutes.header.minutesFooter')}: ${formatLocalDateTime(endedAt)}_`,
  );

  return lines.join('\n');
}

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Wraps an optional i18next-bound `t` so the composer always has a label
 * to render. The fallback walks the locale-aware {@link MinutesDictionary}
 * — same key shape as the renderer's `meeting.minutes.*` namespace.
 */
function createTranslator(
  t: MinutesTranslator | undefined,
  locale: MinutesLocale,
): MinutesTranslator {
  const resolveDefault = (key: string): string => {
    const dictKey = legacyKeyToDict(key);
    if (dictKey === null) return key;
    return lookupLabel(locale, dictKey);
  };
  if (!t) return resolveDefault;
  return (key) => {
    const value = t(key);
    // i18next returns the key verbatim when no entry exists — fall back
    // to the locale dictionary so the minutes body is never littered
    // with raw keys like `meeting.minutes.header.topic`.
    if (value === key) return resolveDefault(key);
    return value;
  };
}

function shortId(id: string): string {
  const clean = id.replace(/[^a-zA-Z0-9]/g, '');
  if (clean.length === 0) return id;
  return clean.slice(0, SHORT_ID_LENGTH);
}

function formatParticipants(participants: readonly Participant[]): string {
  if (participants.length === 0) return '-';
  return participants.map((p) => p.displayName).join(', ');
}

function computeElapsedMinutes(startedAt: number, endedAt: number): number {
  const delta = Math.max(0, endedAt - startedAt);
  return Math.round(delta / MS_PER_MINUTE);
}

interface VoteTally {
  yes: number;
  no: number;
  pending: number;
}

function tallyVotes(votes: readonly VoteRecord[]): VoteTally {
  let yes = 0;
  let no = 0;
  let pending = 0;
  for (const v of votes) {
    switch (v.vote) {
      case 'agree':
        yes += 1;
        break;
      case 'disagree':
      case 'block':
        no += 1;
        break;
      case 'abstain':
      default:
        pending += 1;
        break;
    }
  }
  return { yes, no, pending };
}

function formatVoteTally(tally: VoteTally): string {
  return `✓ ${tally.yes} · ✗ ${tally.no} · · ${tally.pending}`;
}

function formatFailureReason(
  snapshot: SessionSnapshot,
  locale: MinutesLocale,
): string {
  const previous: SessionState | 'UNKNOWN' = snapshot.previousState ?? 'UNKNOWN';
  if (previous === 'UNKNOWN') {
    return lookupLabel(locale, 'failed.unknown');
  }
  const reason = interpolate(lookupLabel(locale, 'failed.previousState'), {
    previous,
  });
  return reason.length > FAILURE_REASON_MAX
    ? reason.slice(0, FAILURE_REASON_MAX) + '…'
    : reason;
}

function formatLocalDateTime(ms: number): string {
  // A stable, locale-independent timestamp — the v2 orchestrator uses
  // `toLocaleString` which varies by Node/Electron build, producing
  // test-fragile strings. We pick ISO-like `YYYY-MM-DD HH:mm` in the
  // user's local timezone so minutes read naturally without being
  // hostile to unit tests.
  const d = new Date(ms);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}
