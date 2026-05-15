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

function parsePayload(
  check: PlanningDesignCheckRecord,
): PlanningDesignCheckPayloadContext {
  if (check.payloadJson === null) return {};
  try {
    const parsed = JSON.parse(check.payloadJson) as unknown;
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as PlanningDesignCheckPayloadContext)
      : {};
  } catch {
    return {};
  }
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
      return '사용자 판단에 따라 구현으로 보냈습니다.';
    case 'request_design_revision':
      return '사용자 판단에 따라 디자인에 다시 수정 요청했습니다.';
    case 'stop':
      return '사용자 판단에 따라 진행을 중지했습니다.';
    case null:
      return '사용자 판단이 저장되었습니다.';
    default: {
      const _exhaustive: never = check.userDecision;
      return _exhaustive;
    }
  }
}

function archiveUserDecisionMessage(check: PlanningDesignCheckRecord): string {
  const lines: string[] = [];
  lines.push('# 사용자 판단 필요');
  lines.push('');
  lines.push(`결정: ${userDecisionLabel(check.userDecision)}`);
  if (check.userDecisionNote !== null) {
    lines.push('');
    lines.push('## 사용자 판단 의견');
    lines.push(check.userDecisionNote);
  }
  if (check.userDecisionDispatchId !== null) {
    lines.push(`인계 ID: ${check.userDecisionDispatchId}`);
  }
  lines.push('');
  lines.push('## 기획 검수 의견');
  lines.push(check.reason ?? '(기록 없음)');
  if (check.revisionDirection !== null) {
    lines.push('');
    lines.push('## 수정 방향');
    lines.push(check.revisionDirection);
  }
  return lines.join('\n');
}

function userDecisionLabel(
  decision: PlanningDesignCheckUserDecision | null,
): string {
  switch (decision) {
    case 'send_to_implementation':
      return '구현으로 보내기';
    case 'request_design_revision':
      return '디자인에 다시 수정 요청하기';
    case 'stop':
      return '진행 중지';
    case null:
      return '(미정)';
    default: {
      const _exhaustive: never = decision;
      return _exhaustive;
    }
  }
}
