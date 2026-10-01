/**
 * Case-insensitive display-name uniqueness check (F2-3, spec
 * `docs/specs/2026-09-29-ai-setup-and-character.md`).
 *
 * Chat-room participants are told apart by the speaker name printed in the
 * model's own input — two registered AIs sharing a display name (even in
 * different casing, e.g. "Ada" vs "ADA") would make every transcript
 * ambiguous about who said what. Both `provider:add` and `member:rename`
 * enforce this rule against the SAME registry snapshot so a rename cannot
 * create a collision `provider:add` would have refused, and vice versa.
 *
 * Kept in its own module (rather than inlined in provider-handler.ts) so
 * member-handler.ts can import it without an import cycle.
 */

import type { IpcCausedError } from '../../shared/ipc-error';
import { providerRegistry } from './registry';

/**
 * Structured error so callers/tests can discriminate without string-matching
 * a message. `ipcCause` lets the renderer name the cause after the error
 * crosses IPC (QA High-1).
 */
export class DuplicateDisplayNameError extends Error implements IpcCausedError {
  readonly ipcCause = 'duplicate-display-name' as const;

  constructor(public readonly displayName: string) {
    super(`Display name already in use: ${displayName}`);
    this.name = 'DuplicateDisplayNameError';
  }
}

/**
 * Throws {@link DuplicateDisplayNameError} when `displayName` (compared
 * case-insensitively) already belongs to a REGISTERED provider other than
 * `excludeProviderId`.
 *
 * `excludeProviderId` lets a rename compare against every OTHER provider
 * without tripping on the provider's own current name (renaming "Ada" to
 * "ada" — same name, different case — is not a collision with itself).
 * `provider:add` (a brand-new id) passes `undefined`.
 */
export function assertDisplayNameAvailable(
  displayName: string,
  excludeProviderId?: string,
): void {
  const normalized = displayName.toLowerCase();
  const collision = providerRegistry
    .listAll()
    .some((provider) =>
      provider.id !== excludeProviderId &&
      provider.displayName.toLowerCase() === normalized,
    );
  if (collision) throw new DuplicateDisplayNameError(displayName);
}
