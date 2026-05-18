import type {
  PlanningDesignCheckDecideResponse,
  PlanningDesignCheckPayloadContext,
  PlanningDesignCheckRecord,
  PlanningDesignCheckUserDecision,
} from '../../../shared/planning-design-check-types';
import type { IpcRequest, IpcResponse } from '../../../shared/ipc-types';
import type { ChannelService } from '../../channels/channel-service';
import type { MessageService } from '../../channels/message-service';
import type { HandoffDispatchService } from '../../handoff/handoff-dispatch-service';
import type { ResolvedReceiverChannel } from '../../handoff/handoff-chain-resolver';
import type { PlanningDesignCheckService } from '../../planning-design-check/planning-design-check-service';
import type { StreamBridge } from '../../streams/stream-bridge';
import {
  buildDesignReturnHandoffPackage,
  buildImplementationHandoffPackage,
} from '../../meetings/workflows/planning-design-check-workflow';
import { resolveNotificationLabel } from '../../notifications/notification-labels';

let checkAccessor: (() => PlanningDesignCheckService) | null = null;
let dispatchAccessor: (() => HandoffDispatchService) | null = null;
let streamAccessor: (() => StreamBridge) | null = null;
let messageAccessor: (() => MessageService) | null = null;
let channelAccessor: (() => ChannelService) | null = null;
let missionCardIdFactory: (() => string) | null = null;

export function setPlanningDesignCheckServiceAccessor(
  fn: () => PlanningDesignCheckService,
): void {
  checkAccessor = fn;
}

export function setPlanningDesignCheckDispatchServiceAccessor(
  fn: () => HandoffDispatchService,
): void {
  dispatchAccessor = fn;
}

export function setPlanningDesignCheckStreamBridgeAccessor(
  fn: () => StreamBridge,
): void {
  streamAccessor = fn;
}

export function setPlanningDesignCheckMessageServiceAccessor(
  fn: () => MessageService,
): void {
  messageAccessor = fn;
}

export function setPlanningDesignCheckChannelServiceAccessor(
  fn: () => ChannelService,
): void {
  channelAccessor = fn;
}

export function setPlanningDesignCheckMissionCardIdFactory(
  fn: () => string,
): void {
  missionCardIdFactory = fn;
}

function getCheckService(): PlanningDesignCheckService {
  if (checkAccessor === null) {
    throw new Error('[planning-design-check] service accessor not initialized');
  }
  return checkAccessor();
}

function getDispatchService(): HandoffDispatchService {
  if (dispatchAccessor === null) {
    throw new Error('[planning-design-check] dispatch accessor not initialized');
  }
  return dispatchAccessor();
}

function getStreamBridge(): StreamBridge {
  if (streamAccessor === null) {
    throw new Error('[planning-design-check] stream accessor not initialized');
  }
  return streamAccessor();
}

function getMessageService(): MessageService {
  if (messageAccessor === null) {
    throw new Error('[planning-design-check] message accessor not initialized');
  }
  return messageAccessor();
}

function getChannelService(): ChannelService {
  if (channelAccessor === null) {
    throw new Error('[planning-design-check] channel accessor not initialized');
  }
  return channelAccessor();
}

function nextMissionCardId(): string {
  if (missionCardIdFactory === null) {
    throw new Error('[planning-design-check] mission id factory not initialized');
  }
  return missionCardIdFactory();
}

export function handlePlanningDesignCheckGet(
  data: IpcRequest<'planning-design-check:get'>,
): IpcResponse<'planning-design-check:get'> {
  return { item: getCheckService().get(data.checkId) };
}

export function handlePlanningDesignCheckDecide(
  data: IpcRequest<'planning-design-check:decide'>,
): IpcResponse<'planning-design-check:decide'> {
  const checkService = getCheckService();
  let dispatchRowId: string | null = null;
  const result = checkService.withTransaction<PlanningDesignCheckDecideResponse>(
    () => {
      const before = checkService.get(data.checkId);
      if (before.status !== 'needs_user_decision') {
        throw new Error(
          `[planning-design-check:decide] check ${before.id} is not waiting for user decision`,
        );
      }
      if (before.userDecision !== null) {
        throw new Error(
          `[planning-design-check:decide] check ${before.id} already has user decision`,
        );
      }

      let check = checkService.recordUserDecision({
        id: before.id,
        decision: data.decision,
        userNote: data.userNote,
      });

      if (data.decision === 'send_to_implementation') {
        const receiver = requireReceiver(check, 'implementationReceiver');
        const pkg = buildImplementationHandoffPackage({
          request: check,
          implementationReceiver: receiver,
          missionCardId: nextMissionCardId(),
          generatedAt: Date.now(),
        });
        const row = getDispatchService().dispatch(pkg);
        dispatchRowId = row.id;
        checkService.setImplementationDispatchId(check.id, row.id);
        check = checkService.recordUserDecision({
          id: check.id,
          decision: data.decision,
          userNote: data.userNote,
          dispatchId: row.id,
        });
        return { check, dispatchRowId: row.id };
      }

      if (data.decision === 'request_design_revision') {
        const receiver = requireReceiver(check, 'designReceiver');
        const pkg = buildDesignReturnHandoffPackage({
          request: check,
          designReceiver: receiver,
          missionCardId: nextMissionCardId(),
          generatedAt: Date.now(),
        });
        const row = getDispatchService().dispatch(pkg);
        dispatchRowId = row.id;
        checkService.setDesignReturnDispatchId(check.id, row.id);
        check = checkService.recordUserDecision({
          id: check.id,
          decision: data.decision,
          userNote: data.userNote,
          dispatchId: row.id,
        });
        return { check, dispatchRowId: row.id };
      }

      return { check, dispatchRowId: null };
    },
  );

  emitDispatchIfNeeded(result.check, dispatchRowId);
  appendUserDecisionRecords(result.check);

  return result;
}

function requireReceiver(
  check: PlanningDesignCheckRecord,
  key: 'designReceiver' | 'implementationReceiver',
): ResolvedReceiverChannel {
  const payload = parsePayload(check);
  const receiver = payload[key];
  if (
    receiver === null ||
    receiver === undefined ||
    typeof receiver.channelId !== 'string' ||
    typeof receiver.handoffMode !== 'string' ||
    typeof receiver.assignedProviderId !== 'string'
  ) {
    throw new Error(
      `[planning-design-check:decide] check ${check.id} payload missing ${key}`,
    );
  }
  return {
    channelId: receiver.channelId,
    handoffMode: receiver.handoffMode,
    assignedProviderId: receiver.assignedProviderId,
  };
}

export class PlanningDesignCheckPayloadInvariantError extends Error {
  constructor(message: string) {
    super(`[PlanningDesignCheckPayload] ${message}`);
    this.name = 'PlanningDesignCheckPayloadInvariantError';
  }
}

function parsePayload(
  check: PlanningDesignCheckRecord,
): PlanningDesignCheckPayloadContext {
  if (check.payloadJson === null) return {};
  const snippet =
    check.payloadJson.length > 120
      ? `${check.payloadJson.slice(0, 120)}…`
      : check.payloadJson;
  let parsed: unknown;
  try {
    parsed = JSON.parse(check.payloadJson);
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    throw new PlanningDesignCheckPayloadInvariantError(
      `check ${check.id} column payloadJson is not valid JSON (${cause}) — snippet: ${snippet}`,
    );
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new PlanningDesignCheckPayloadInvariantError(
      `check ${check.id} column payloadJson must be a JSON object (got ${parsed === null ? 'null' : typeof parsed}) — snippet: ${snippet}`,
    );
  }
  return parsed as PlanningDesignCheckPayloadContext;
}

function emitDispatchIfNeeded(
  check: PlanningDesignCheckRecord,
  dispatchRowId: string | null,
): void {
  if (dispatchRowId === null) return;
  const payload = parsePayload(check);
  try {
    getStreamBridge().emitHandoffDispatched({
      meetingId: check.sourceDesignMeetingId,
      dispatchRowId,
      senderChannelId: check.planningChannelId,
      targetChannelId:
        check.userDecision === 'send_to_implementation'
          ? (payload.implementationReceiver?.channelId ??
            check.implementationChannelId ??
            '')
          : check.designChannelId,
      mode:
        check.userDecision === 'send_to_implementation'
          ? (payload.implementationReceiver?.handoffMode ?? 'auto')
          : (payload.designReceiver?.handoffMode ?? 'auto'),
      dispatchedAt: Date.now(),
    });
  } catch (err) {
    console.warn(
      '[planning-design-check:decide] emitHandoffDispatched failed',
      err instanceof Error ? err.message : String(err),
    );
  }
}

function appendUserDecisionRecords(check: PlanningDesignCheckRecord): void {
  const content = userDecisionSourceMessage(check);
  const meta = planningDesignCheckMeta(check);
  try {
    getMessageService().append({
      channelId: check.designChannelId,
      meetingId: check.sourceDesignMeetingId,
      authorId: 'system',
      authorKind: 'system',
      role: 'system',
      content,
      meta,
    });
  } catch (err) {
    console.warn(
      '[planning-design-check:decide] decision message append failed',
      err instanceof Error ? err.message : String(err),
    );
  }

  const minutesChannel = getChannelService()
    .listByProject(check.projectId)
    .find((channel) => channel.kind === 'system_minutes');
  if (minutesChannel === undefined) return;

  try {
    getMessageService().append({
      channelId: minutesChannel.id,
      meetingId: check.sourceDesignMeetingId,
      authorId: 'system',
      authorKind: 'system',
      role: 'system',
      content: archiveUserDecisionMessage(check),
      meta,
    });
  } catch (err) {
    console.warn(
      '[planning-design-check:decide] decision archive append failed',
      err instanceof Error ? err.message : String(err),
    );
  }
}

function planningDesignCheckMeta(check: PlanningDesignCheckRecord) {
  return {
    planningDesignCheck: {
      id: check.id,
      status: check.status,
      verdict: check.verdict,
      returnCount: check.returnCount,
      sourceDesignMeetingId: check.sourceDesignMeetingId,
      designChannelId: check.designChannelId,
      planningChannelId: check.planningChannelId,
      implementationChannelId: check.implementationChannelId,
      title: check.requestTitle,
      reason: check.reason,
      revisionDirection: check.revisionDirection,
      userDecision: check.userDecision,
    },
  };
}

function userDecisionSourceMessage(check: PlanningDesignCheckRecord): string {
  switch (check.userDecision) {
    case 'send_to_implementation':
      return resolveNotificationLabel(
        'planningDesignCheck.decisionMessage.sendToImplementation',
      );
    case 'request_design_revision':
      return resolveNotificationLabel(
        'planningDesignCheck.decisionMessage.requestDesignRevision',
      );
    case 'stop':
      return resolveNotificationLabel('planningDesignCheck.decisionMessage.stop');
    case null:
      return resolveNotificationLabel('planningDesignCheck.decisionMessage.saved');
    default: {
      const _exhaustive: never = check.userDecision;
      return _exhaustive;
    }
  }
}

function archiveUserDecisionMessage(check: PlanningDesignCheckRecord): string {
  const lines: string[] = [];
  lines.push(resolveNotificationLabel('planningDesignCheck.archiveHeader.title'));
  lines.push('');
  lines.push(
    resolveNotificationLabel('planningDesignCheck.archiveHeader.decision', {
      value: userDecisionLabel(check.userDecision),
    }),
  );
  if (check.userDecisionNote !== null) {
    lines.push('');
    lines.push(
      resolveNotificationLabel('planningDesignCheck.archiveHeader.userNoteSection'),
    );
    lines.push(check.userDecisionNote);
  }
  if (check.userDecisionDispatchId !== null) {
    lines.push(
      resolveNotificationLabel('planningDesignCheck.archiveHeader.dispatchId', {
        value: check.userDecisionDispatchId,
      }),
    );
  }
  lines.push('');
  lines.push(
    resolveNotificationLabel('planningDesignCheck.archiveHeader.reasonSection'),
  );
  lines.push(
    check.reason ??
      resolveNotificationLabel('planningDesignCheck.archiveHeader.reasonMissing'),
  );
  if (check.revisionDirection !== null) {
    lines.push('');
    lines.push(
      resolveNotificationLabel(
        'planningDesignCheck.archiveHeader.revisionDirectionSection',
      ),
    );
    lines.push(check.revisionDirection);
  }
  return lines.join('\n');
}

function userDecisionLabel(
  decision: PlanningDesignCheckUserDecision | null,
): string {
  switch (decision) {
    case 'send_to_implementation':
      return resolveNotificationLabel(
        'planningDesignCheck.decisionLabel.send_to_implementation',
      );
    case 'request_design_revision':
      return resolveNotificationLabel(
        'planningDesignCheck.decisionLabel.request_design_revision',
      );
    case 'stop':
      return resolveNotificationLabel('planningDesignCheck.decisionLabel.stop');
    case null:
      return resolveNotificationLabel('planningDesignCheck.decisionLabel.unset');
    default: {
      const _exhaustive: never = decision;
      return _exhaustive;
    }
  }
}
