import type {
  MeetingReviewDecision,
  MeetingReviewGate,
  MeetingReviewGateStatus,
} from '../../../shared/meeting-review-types';
import type { IpcRequest, IpcResponse } from '../../../shared/ipc-types';
import type { MessageService } from '../../channels/message-service';
import type { ChannelService } from '../../channels/channel-service';
import type { HandoffDispatchService } from '../../handoff/handoff-dispatch-service';
import type { StreamBridge } from '../../streams/stream-bridge';
import {
  MeetingReviewGateNotPendingError,
  type MeetingReviewGateService,
} from '../../meeting-review/meeting-review-gate-service';
import { parseHandoffPackage } from '../../../shared/schema/handoff-package';
import { resolveNotificationLabel } from '../../notifications/notification-labels';

let reviewAccessor: (() => MeetingReviewGateService) | null = null;
let dispatchAccessor: (() => HandoffDispatchService) | null = null;
let streamAccessor: (() => StreamBridge) | null = null;
let messageAccessor: (() => MessageService) | null = null;
let channelAccessor: (() => ChannelService) | null = null;

export function setMeetingReviewGateServiceAccessor(
  fn: () => MeetingReviewGateService,
): void {
  reviewAccessor = fn;
}

export function setMeetingReviewDispatchServiceAccessor(
  fn: () => HandoffDispatchService,
): void {
  dispatchAccessor = fn;
}

export function setMeetingReviewStreamBridgeAccessor(fn: () => StreamBridge): void {
  streamAccessor = fn;
}

export function setMeetingReviewMessageServiceAccessor(
  fn: () => MessageService,
): void {
  messageAccessor = fn;
}

export function setMeetingReviewChannelServiceAccessor(
  fn: () => ChannelService,
): void {
  channelAccessor = fn;
}

function getReviewService(): MeetingReviewGateService {
  if (reviewAccessor === null) {
    throw new Error('[meeting-review] service accessor not initialized');
  }
  return reviewAccessor();
}

function getDispatchService(): HandoffDispatchService {
  if (dispatchAccessor === null) {
    throw new Error('[meeting-review] dispatch accessor not initialized');
  }
  return dispatchAccessor();
}

function getStreamBridge(): StreamBridge {
  if (streamAccessor === null) {
    throw new Error('[meeting-review] stream accessor not initialized');
  }
  return streamAccessor();
}

function getMessageService(): MessageService {
  if (messageAccessor === null) {
    throw new Error('[meeting-review] message accessor not initialized');
  }
  return messageAccessor();
}

function getChannelService(): ChannelService {
  if (channelAccessor === null) {
    throw new Error('[meeting-review] channel accessor not initialized');
  }
  return channelAccessor();
}

export function handleMeetingReviewList(
  data: IpcRequest<'meeting-review:list'>,
): IpcResponse<'meeting-review:list'> {
  return { items: getReviewService().list(data) };
}

export function handleMeetingReviewGet(
  data: IpcRequest<'meeting-review:get'>,
): IpcResponse<'meeting-review:get'> {
  return { item: getReviewService().get(data.reviewId) };
}

export function handleMeetingReviewDecide(
  data: IpcRequest<'meeting-review:decide'>,
): IpcResponse<'meeting-review:decide'> {
  const reviewService = getReviewService();
  const userNote = normalizeNote(data.userNote);
  const status = statusForDecision(data.decision);

  let dispatchRowId: string | null = null;
  let review: MeetingReviewGate;
  if (data.decision === 'approve') {
    const result = reviewService.withTransaction(() => {
      const before = reviewService.get(data.reviewId);
      if (before.status !== 'pending') {
        throw new MeetingReviewGateNotPendingError(data.reviewId, before.status);
      }
      const pkg = parsePayloadHandoffPackage(before);
      const nextReview = reviewService.decide({
        id: data.reviewId,
        status,
        userNote,
      });
      const row = getDispatchService().dispatch(pkg);
      return { pkg, review: nextReview, row };
    });

    review = result.review;
    const row = result.row;
    dispatchRowId = row.id;
    try {
      getStreamBridge().emitHandoffDispatched({
        meetingId: review.meetingId,
        dispatchRowId: row.id,
        senderChannelId: result.pkg.sender.channelId,
        targetChannelId: result.pkg.target.channelId,
        mode: result.pkg.mode,
        dispatchedAt: row.dispatchedAt,
      });
    } catch (err) {
      console.warn(
        '[meeting-review:decide] emitHandoffDispatched threw',
        err instanceof Error ? err.message : String(err),
      );
    }
  } else {
    const before = reviewService.get(data.reviewId);
    if (before.status !== 'pending') {
      throw new MeetingReviewGateNotPendingError(data.reviewId, before.status);
    }
    review = reviewService.decide({
      id: data.reviewId,
      status,
      userNote,
    });
  }

  appendDecisionRecords(review, data.decision, dispatchRowId);

  return {
    review,
    dispatchRowId,
    followUpRequired:
      data.decision === 'revise' || data.decision === 'restart',
  };
}

function statusForDecision(
  decision: MeetingReviewDecision,
): Exclude<MeetingReviewGateStatus, 'pending'> {
  switch (decision) {
    case 'approve':
      return 'approved';
    case 'revise':
      return 'revision_requested';
    case 'restart':
      return 'restart_requested';
    case 'stop':
      return 'stopped';
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

function parsePayloadHandoffPackage(review: MeetingReviewGate) {
  if (review.payloadJson === null) {
    throw new Error(
      `[meeting-review:decide] review ${review.id} has no handoff payload`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(review.payloadJson) as unknown;
  } catch (err) {
    throw new Error(
      `[meeting-review:decide] review ${review.id} payload JSON parse failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('handoffPackage' in parsed)
  ) {
    throw new Error(
      `[meeting-review:decide] review ${review.id} payload missing handoffPackage`,
    );
  }
  return parseHandoffPackage(
    (parsed as { handoffPackage: unknown }).handoffPackage,
  );
}

function appendDecisionRecords(
  review: MeetingReviewGate,
  decision: MeetingReviewDecision,
  dispatchRowId: string | null,
): void {
  const sourceContent = sourceDecisionMessage(decision, dispatchRowId);
  try {
    getMessageService().append({
      channelId: review.sourceChannelId,
      meetingId: review.meetingId,
      authorId: 'system',
      authorKind: 'system',
      role: 'system',
      content: sourceContent,
      meta: {
        reviewGate: {
          id: review.id,
          kind: review.kind,
          status: review.status,
          sourceChannelId: review.sourceChannelId,
          targetChannelId: review.targetChannelId,
          targetRole: review.targetRole,
        },
        ...(dispatchRowId !== null ? { dispatchRowId } : {}),
      },
    });
  } catch (err) {
    console.warn(
      '[meeting-review:decide] source decision message append failed',
      err instanceof Error ? err.message : String(err),
    );
  }

  const minutesChannel = getChannelService()
    .listByProject(review.projectId)
    .find((channel) => channel.kind === 'system_minutes');
  if (minutesChannel === undefined) return;

  try {
    getMessageService().append({
      channelId: minutesChannel.id,
      meetingId: review.meetingId,
      authorId: 'system',
      authorKind: 'system',
      role: 'system',
      content: archiveDecisionMessage(review, decision, dispatchRowId),
      meta: {
        reviewGate: {
          id: review.id,
          kind: review.kind,
          status: review.status,
          sourceChannelId: review.sourceChannelId,
          targetChannelId: review.targetChannelId,
          targetRole: review.targetRole,
        },
        ...(dispatchRowId !== null ? { dispatchRowId } : {}),
      },
    });
  } catch (err) {
    console.warn(
      '[meeting-review:decide] minutes archive append failed',
      err instanceof Error ? err.message : String(err),
    );
  }
}

function sourceDecisionMessage(
  decision: MeetingReviewDecision,
  dispatchRowId: string | null,
): string {
  if (decision === 'approve') {
    return dispatchRowId === null
      ? resolveNotificationLabel('meetingReview.decisionMessage.approveWithoutDispatch')
      : resolveNotificationLabel('meetingReview.decisionMessage.approveWithDispatch');
  }
  if (decision === 'stop') {
    return resolveNotificationLabel('meetingReview.decisionMessage.stop');
  }
  if (decision === 'revise') {
    return resolveNotificationLabel('meetingReview.decisionMessage.revise');
  }
  return resolveNotificationLabel('meetingReview.decisionMessage.restart');
}

function archiveDecisionMessage(
  review: MeetingReviewGate,
  decision: MeetingReviewDecision,
  dispatchRowId: string | null,
): string {
  const lines: string[] = [];
  lines.push(`# ${review.title}`);
  lines.push('');
  lines.push(
    resolveNotificationLabel('meetingReview.archiveHeader.status', {
      value: statusLabel(review.status),
    }),
  );
  lines.push(
    resolveNotificationLabel('meetingReview.archiveHeader.document', {
      value: review.documentPath,
    }),
  );
  if (review.targetRole !== null) {
    lines.push(
      resolveNotificationLabel('meetingReview.archiveHeader.targetRole', {
        value: review.targetRole,
      }),
    );
  }
  if (dispatchRowId !== null) {
    lines.push(
      resolveNotificationLabel('meetingReview.archiveHeader.dispatchId', {
        value: dispatchRowId,
      }),
    );
  }
  lines.push(
    resolveNotificationLabel('meetingReview.archiveHeader.decision', {
      value: decisionLabel(decision),
    }),
  );
  if (review.userNote !== null) {
    lines.push('');
    lines.push(resolveNotificationLabel('meetingReview.archiveHeader.userNoteSection'));
    lines.push(review.userNote);
  }
  lines.push('');
  lines.push(resolveNotificationLabel('meetingReview.archiveHeader.minutesBodySection'));
  lines.push(review.documentBodySnapshot);
  return lines.join('\n');
}

function decisionLabel(decision: MeetingReviewDecision): string {
  switch (decision) {
    case 'approve':
      return resolveNotificationLabel('meetingReview.decisionLabel.approve');
    case 'revise':
      return resolveNotificationLabel('meetingReview.decisionLabel.revise');
    case 'restart':
      return resolveNotificationLabel('meetingReview.decisionLabel.restart');
    case 'stop':
      return resolveNotificationLabel('meetingReview.decisionLabel.stop');
    default: {
      const _exhaustive: never = decision;
      return _exhaustive;
    }
  }
}

function statusLabel(status: MeetingReviewGateStatus): string {
  switch (status) {
    case 'pending':
      return resolveNotificationLabel('meetingReview.statusLabel.pending');
    case 'approved':
      return resolveNotificationLabel('meetingReview.statusLabel.approved');
    case 'revision_requested':
      return resolveNotificationLabel('meetingReview.statusLabel.revision_requested');
    case 'restart_requested':
      return resolveNotificationLabel('meetingReview.statusLabel.restart_requested');
    case 'stopped':
      return resolveNotificationLabel('meetingReview.statusLabel.stopped');
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}
