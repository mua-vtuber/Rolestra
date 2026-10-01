import type { ChannelKind } from '../../shared/channel-types';

/** Base class — lets callers `catch (e instanceof ChannelError)` discriminate. */
export class ChannelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChannelError';
  }
}

/** UNIQUE(project_id, name) violation for non-DM channels. */
export class DuplicateChannelNameError extends ChannelError {
  constructor(projectId: string | null, name: string) {
    super(
      `channel name "${name}" already exists in ${
        projectId === null ? 'DM scope' : `project ${projectId}`
      }`,
    );
    this.name = 'DuplicateChannelNameError';
  }
}

/**
 * Raised when a caller tries to delete or rename a system channel
 * (`kind` starting with `system_`). System channels are part of the
 * default project layout and can only be modified via migrations.
 */
export class SystemChannelProtectedError extends ChannelError {
  constructor(channelId: string, kind: ChannelKind, op: 'delete' | 'rename') {
    super(
      `cannot ${op} system channel (id=${channelId}, kind=${kind}): ` +
        `system channels are locked as part of the default project layout`,
    );
    this.name = 'SystemChannelProtectedError';
  }
}

/**
 * Raised by `createDm(providerId)` when a DM already exists for the
 * provider. Enforced at the SQL layer by `idx_dm_unique_per_provider`
 * so this class is the translation of that partial-unique violation.
 */
export class DuplicateDmError extends ChannelError {
  constructor(providerId: string) {
    super(
      `DM channel for provider "${providerId}" already exists (one DM per provider)`,
    );
    this.name = 'DuplicateDmError';
  }
}

/**
 * Raised when `addMember` on a non-DM channel is called with a
 * `(project_id, provider_id)` pair that does not exist in
 * `project_members`. Triggered by the composite FK defined in
 * migration 003-channels.
 */
export class ChannelMemberFkError extends ChannelError {
  constructor(projectId: string, providerId: string) {
    super(
      `channel member (${providerId}) is not a member of project ${projectId} ` +
        `— add them to project_members first`,
    );
    this.name = 'ChannelMemberFkError';
  }
}

/** Raised when a channel id is not found. */
export class ChannelNotFoundError extends ChannelError {
  constructor(id: string) {
    super(`channel not found: ${id}`);
    this.name = 'ChannelNotFoundError';
  }
}

/**
 * R12-C2 T37 — Raised by `ChannelService.reorderMembers` when the given
 * order is not exactly the channel's current membership. The message
 * names both sides of the mismatch so the caller can tell a stale UI
 * list apart from a typo'd provider id; a partial write would leave the
 * stored speaking order silently disagreeing with what the user sees.
 */
export class ChannelMemberOrderMismatchError extends ChannelError {
  constructor(
    channelId: string,
    missing: readonly string[],
    unexpected: readonly string[],
  ) {
    super(
      `member order for channel ${channelId} does not match its membership ` +
        `(missing: ${missing.length === 0 ? 'none' : missing.join(', ')}; ` +
        `unexpected: ${unexpected.length === 0 ? 'none' : unexpected.join(', ')})`,
    );
    this.name = 'ChannelMemberOrderMismatchError';
  }
}
