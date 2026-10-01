/**
 * Opaque participant aliases (spec 2026-09-29 §C).
 *
 * Every model-facing reference to another AI participant is its display name
 * plus this alias — never the provider id. Old installs registered providers
 * with ids such as `claude` / `codex` / `gemini`, so a raw id would tell the
 * other AIs which company, model or CLI a participant is even after the user
 * renamed it.
 *
 * The alias is a hash prefix of (namespace, channel id, provider id):
 *   - deterministic, so it is the same on every turn, in every CLI session and
 *     after an app restart (nothing is stored; no DB change);
 *   - different per room, so one alias cannot be carried between rooms;
 *   - not derivable from the provider kind or name by a model, because the
 *     channel id (a random UUID) is never part of any model input.
 *
 * This module is the only place that derives an alias. Model output that
 * addresses a participant is mapped back with {@link participantAliasMap}.
 */
import { createHash } from 'node:crypto';

/** Bumping this rotates every alias (and therefore needs a CLI session rebuild). */
const PARTICIPANT_ALIAS_NAMESPACE = 'rolestra-participant-alias-v1';
const PARTICIPANT_ALIAS_PREFIX = 'p-';
/** 12 hex digits = 48 bits; collisions inside one room are still checked. */
const PARTICIPANT_ALIAS_HEX_LENGTH = 12;

/** Two participants of one room produced the same alias (never silently merged). */
export class ParticipantAliasCollisionError extends Error {
  constructor(channelId: string, alias: string) {
    super(`Participant alias collision in channel ${channelId}: ${alias}`);
    this.name = 'ParticipantAliasCollisionError';
  }
}

export function participantAlias(channelId: string, providerId: string): string {
  if (!channelId.trim()) throw new Error('Participant alias requires a channel id');
  if (!providerId.trim()) throw new Error('Participant alias requires a provider id');
  const digest = createHash('sha256')
    .update(`${PARTICIPANT_ALIAS_NAMESPACE}\0${channelId}\0${providerId}`)
    .digest('hex');
  return `${PARTICIPANT_ALIAS_PREFIX}${digest.slice(0, PARTICIPANT_ALIAS_HEX_LENGTH)}`;
}

/**
 * alias → provider id for the given participants of one room.
 *
 * `aliasOf` is always {@link participantAlias} in the app; the parameter only
 * lets a test force the (otherwise astronomically rare) collision path.
 *
 * @throws {ParticipantAliasCollisionError} when two participants share an alias.
 */
export function participantAliasMap(
  channelId: string,
  providerIds: readonly string[],
  aliasOf: (channelId: string, providerId: string) => string = participantAlias,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const providerId of providerIds) {
    const alias = aliasOf(channelId, providerId);
    const existing = map.get(alias);
    if (existing !== undefined && existing !== providerId) {
      throw new ParticipantAliasCollisionError(channelId, alias);
    }
    map.set(alias, providerId);
  }
  return map;
}
