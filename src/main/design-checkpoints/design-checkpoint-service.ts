import { randomUUID } from 'node:crypto';
import type {
  DesignCheckpoint,
  DesignCheckpointDecision,
  DesignCheckpointStatus,
} from '../../shared/design-checkpoint-types';
import type { DesignCheckpointRepository } from './design-checkpoint-repository';

export class DesignCheckpointError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DesignCheckpointError';
  }
}

export class DesignCheckpointNotFoundError extends DesignCheckpointError {
  constructor(id: string) {
    super(`DesignCheckpoint not found: ${id}`);
    this.name = 'DesignCheckpointNotFoundError';
  }
}

export class DesignCheckpointNotPendingError extends DesignCheckpointError {
  constructor(id: string, status: DesignCheckpointStatus) {
    super(`DesignCheckpoint ${id} is not pending (status=${status})`);
    this.name = 'DesignCheckpointNotPendingError';
  }
}

export class DesignCheckpointNoteRequiredError extends DesignCheckpointError {
  constructor() {
    super('DesignCheckpoint revision note must not be empty');
    this.name = 'DesignCheckpointNoteRequiredError';
  }
}

export interface CreateWireframeCheckpointInput {
  projectId: string;
  meetingId: string;
  channelId: string;
  title: string;
  documentPath: string;
  documentBodySnapshot: string;
  payloadJson?: string | null;
}

export interface CreatedWireframeCheckpoint {
  checkpoint: DesignCheckpoint;
  shouldShowNotice: boolean;
}

export class DesignCheckpointService {
  constructor(
    private readonly repo: DesignCheckpointRepository,
    private readonly now: () => number = Date.now,
  ) {}

  withTransaction<T>(fn: () => T): T {
    return this.repo.withTransaction(fn);
  }

  createWireframeCheckpoint(
    input: CreateWireframeCheckpointInput,
  ): CreatedWireframeCheckpoint {
    const createdAt = this.now();
    const autoSkip = this.repo.isWireframeAutoSkipEnabled(input.projectId);
    const checkpoint: DesignCheckpoint = {
      id: randomUUID(),
      projectId: input.projectId,
      meetingId: input.meetingId,
      channelId: input.channelId,
      kind: 'wireframe',
      status: autoSkip ? 'auto_skipped' : 'pending',
      title: input.title,
      documentPath: input.documentPath,
      documentBodySnapshot: input.documentBodySnapshot,
      userNote: null,
      payloadJson: input.payloadJson ?? null,
      createdAt,
      decidedAt: autoSkip ? createdAt : null,
    };
    this.repo.insert(checkpoint);
    return {
      checkpoint,
      shouldShowNotice: !autoSkip,
    };
  }

  get(id: string): DesignCheckpoint {
    const checkpoint = this.repo.findById(id);
    if (checkpoint === null) throw new DesignCheckpointNotFoundError(id);
    return checkpoint;
  }

  listForDesignCheckRequest(input: {
    projectId: string;
    meetingId: string;
  }): DesignCheckpoint[] {
    return this.repo.listByMeeting({
      projectId: input.projectId,
      meetingId: input.meetingId,
      kind: 'wireframe',
    });
  }

  decide(input: {
    id: string;
    decision: DesignCheckpointDecision;
    note?: string;
  }): DesignCheckpoint {
    const note = normalizeNote(input.note);
    if (input.decision === 'request_revision' && note === null) {
      throw new DesignCheckpointNoteRequiredError();
    }
    const status = statusForDecision(input.decision);
    return this.repo.withTransaction(() => {
      const before = this.get(input.id);
      if (before.status !== 'pending') {
        throw new DesignCheckpointNotPendingError(input.id, before.status);
      }
      if (input.decision === 'auto_skip') {
        this.repo.setWireframeAutoSkip({
          projectId: before.projectId,
          enabled: true,
          updatedAt: this.now(),
        });
      }
      const decidedAt = this.now();
      const updated = this.repo.updateDecision({
        id: input.id,
        status,
        userNote: input.decision === 'request_revision' ? note : null,
        decidedAt,
      });
      if (updated === null) {
        const current = this.repo.findById(input.id);
        if (current === null) throw new DesignCheckpointNotFoundError(input.id);
        if (current.status !== 'pending') {
          throw new DesignCheckpointNotPendingError(input.id, current.status);
        }
        throw new DesignCheckpointError(
          `DesignCheckpoint ${input.id} decision update did not change a row`,
        );
      }
      return updated;
    });
  }

  isWireframeAutoSkipEnabled(projectId: string): boolean {
    return this.repo.isWireframeAutoSkipEnabled(projectId);
  }
}

function statusForDecision(
  decision: DesignCheckpointDecision,
): Exclude<DesignCheckpointStatus, 'pending'> {
  switch (decision) {
    case 'continue':
      return 'continued';
    case 'request_revision':
      return 'revision_requested';
    case 'auto_skip':
      return 'auto_skipped';
    default: {
      const _exhaustive: never = decision;
      return _exhaustive;
    }
  }
}

function normalizeNote(raw: string | undefined): string | null {
  const trimmed = (raw ?? '').trim();
  return trimmed.length === 0 ? null : trimmed;
}
