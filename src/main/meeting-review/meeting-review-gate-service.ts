import { randomUUID } from 'node:crypto';
import type {
  MeetingReviewGate,
  MeetingReviewGateKind,
  MeetingReviewGateStatus,
  MeetingReviewListRequest,
} from '../../shared/meeting-review-types';
import type { ChannelRole } from '../../shared/channel-role-types';
import type { MeetingReviewGateRepository } from './meeting-review-gate-repository';

export class MeetingReviewGateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MeetingReviewGateError';
  }
}

export class MeetingReviewGateNotFoundError extends MeetingReviewGateError {
  constructor(id: string) {
    super(`MeetingReviewGate not found: ${id}`);
    this.name = 'MeetingReviewGateNotFoundError';
  }
}

export class MeetingReviewGateNotPendingError extends MeetingReviewGateError {
  constructor(id: string, status: MeetingReviewGateStatus) {
    super(`MeetingReviewGate ${id} is not pending (status=${status})`);
    this.name = 'MeetingReviewGateNotPendingError';
  }
}

export interface CreateMeetingReviewGateInput {
  projectId: string;
  meetingId: string;
  sourceChannelId: string;
  targetChannelId: string | null;
  targetRole: ChannelRole;
  kind: MeetingReviewGateKind;
  title: string;
  documentPath: string;
  documentBodySnapshot: string;
  payloadJson?: string | null;
}

export class MeetingReviewGateService {
  constructor(
    private readonly repo: MeetingReviewGateRepository,
    private readonly now: () => number = Date.now,
  ) {}

  withTransaction<T>(fn: () => T): T {
    return this.repo.withTransaction(fn);
  }

  createPending(input: CreateMeetingReviewGateInput): MeetingReviewGate {
    const gate: MeetingReviewGate = {
      id: randomUUID(),
      projectId: input.projectId,
      meetingId: input.meetingId,
      sourceChannelId: input.sourceChannelId,
      targetChannelId: input.targetChannelId,
      targetRole: input.targetRole,
      kind: input.kind,
      status: 'pending',
      title: input.title,
      documentPath: input.documentPath,
      documentBodySnapshot: input.documentBodySnapshot,
      userNote: null,
      payloadJson: input.payloadJson ?? null,
      createdAt: this.now(),
      decidedAt: null,
    };
    this.repo.insert(gate);
    return gate;
  }

  get(id: string): MeetingReviewGate {
    const gate = this.repo.findById(id);
    if (gate === null) throw new MeetingReviewGateNotFoundError(id);
    return gate;
  }

  list(input: MeetingReviewListRequest = {}): MeetingReviewGate[] {
    return this.repo.list(input);
  }

  decide(input: {
    id: string;
    status: Exclude<MeetingReviewGateStatus, 'pending'>;
    userNote: string | null;
  }): MeetingReviewGate {
    const before = this.get(input.id);
    if (before.status !== 'pending') {
      throw new MeetingReviewGateNotPendingError(input.id, before.status);
    }
    const updated = this.repo.updateDecision({
      id: input.id,
      status: input.status,
      userNote: input.userNote,
      decidedAt: this.now(),
    });
    if (updated === null) {
      const current = this.repo.findById(input.id);
      if (current === null) throw new MeetingReviewGateNotFoundError(input.id);
      if (current.status !== 'pending') {
        throw new MeetingReviewGateNotPendingError(input.id, current.status);
      }
      throw new MeetingReviewGateError(
        `MeetingReviewGate ${input.id} decision update did not change a row`,
      );
    }
    return updated;
  }
}
