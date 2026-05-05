/**
 * MeetingTurnExecutor — R12-C2 T10a 통째 재작성.
 *
 * 옛 모델: `executeTurn(speaker)` 단일 method 가 SSM state 별 format
 * instruction (`getFormatInstruction`) + parser (`parseOutputByState`)
 * 로 분기, 자유 markdown 본문 파싱.
 *
 * 새 모델: phase 별 *3 method* — 각 method 가 phase 전용 prompt 양식 + zod
 * schema parse + 1 회 재요청 + 2 회 실패 시 skip 분기를 갖춘다 (spec
 * §11.18.7). 옛 worker-mode / consensus-decision 분기 통째 폐기.
 *
 *   - {@link requestOpinionGather}    step 1 의견 제시
 *   - {@link requestQuickVote}        step 2.5 일괄 동의 투표
 *   - {@link requestFreeDiscussion}   step 3 자유 토론 (의견 1 건씩)
 *
 * 보존된 표면:
 *   - work-status gate (spec §7.2) — speaker.status !== 'online' → skip +
 *     emitMeetingTurnSkipped + system marker 메시지 persist
 *   - provider lookup + AbortController + signal 전파
 *   - stream emit 5 종 (turn-start / turn-token / turn-done / error /
 *     turn-skipped)
 *   - persona = `MemberProfileService.buildPersona(speakerId)` +
 *     `buildPermissionRules(...)`
 *   - CLI permission prompt (CLI provider 한정, `approvalCliAdapter`)
 *   - assistant 응답 messageService.append (raw JSON 본문 그대로 저장 —
 *     디스플레이 변환은 renderer 책임)
 *   - circuitBreaker.recordError (turn 단위 분류)
 *
 * 폐기:
 *   - SSM state 별 format instruction / `MessageFormatter` / `parseOutputByState`
 *   - `AppToolProvider` (옛 작업 모드 도구)
 *   - worker-summary 파일 관리 (`lastWorkerSummaryFileName` /
 *     `WORK_SUMMARY_PREFIX` / `WORKER_PERMISSION_REQUEST_INSTRUCTION`)
 *   - `lastTurnResult` 누적 / `workerPermissionInstructionSentForId`
 *   - `recordModeJudgment` 호출 / deepDebate 분기 / `setRoundSetting`
 *
 * 발화 ID (label) 정책 (spec §11.18.1):
 *   - orchestrator 가 매 turn 직전 `session.nextLabel(provider.id)` 으로
 *     suggestedLabel 을 발급, turn-executor 의 ctx 로 넘긴다.
 *   - turn-executor 는 prompt hint 로만 동봉 — 직원 응답의 `label` 필드를
 *     그대로 신뢰 (validation 은 schema 만, label 값 자체는 임의 문자열).
 *   - schema fail 로 skip 된 turn 도 카운터는 이미 증가 (orchestrator 가
 *     turn 호출 *전* nextLabel 호출). 직원이 응답 안 했어도 다음 round 에서
 *     `codex_3` 으로 진입 가능 — spec §11.18.1 = "발화 시도" 단위 카운터.
 *
 * spec docs/superpowers/specs/2026-05-01-rolestra-channel-roles-design.md
 *   - §5     D-B 흐름 (의견 트리 + 깊이 cap 3 + 발화 ID 카운터)
 *   - §11.18 직원 응답 JSON schema 4 종 + retry/skip 흐름
 */

import { randomUUID } from 'node:crypto';
import type { ZodType } from 'zod';
import type { Participant } from '../../../shared/engine-types';
import type {
  CliProviderConfig,
  Message as ProviderMessage,
} from '../../../shared/provider-types';
import {
  PHASE_RESPONSE_SCHEMAS,
  type MeetingTurnResult,
  type Step1OpinionGatherSchemaType,
  type Step25QuickVoteSchemaType,
  type Step3FreeDiscussionSchemaType,
} from '../../../shared/meeting-flow-types';
import { buildPermissionRules } from '../../members/persona-permission-rules';
import { tryGetLogger } from '../../log/logger-accessor';
import type { BaseProvider } from '../../providers/provider-interface';
import { CliProvider } from '../../providers/cli/cli-provider';
import type { ParsedCliPermissionRequest } from '../../providers/cli/cli-permission-parser';
import type { StreamBridge } from '../../streams/stream-bridge';
import type { MessageService } from '../../channels/message-service';
import type { ArenaRootService } from '../../arena/arena-root-service';
import type { providerRegistry } from '../../providers/registry';
import type { ApprovalCliAdapter } from '../../approvals/approval-cli-adapter';
import type { MeetingSession } from './meeting-session';
import type { CircuitBreaker } from '../../queue/circuit-breaker';

/** Alias for the registry's instance type — the concrete class is not
 *  exported, so callers reach it via the singleton or through DI. */
type ProviderRegistry = typeof providerRegistry;

/**
 * R9-Task6 error categories fed to CircuitBreaker.recordError. Tightly
 * enumerated so free-form strings never explode the `same_error` streak
 * counter (spec §12 boundary: `recordError(cat)` must accept an enum
 * only — a random error.message would let an attacker force a reset by
 * perturbing the text).
 */
type TurnErrorCategory =
  | 'cli_spawn_failed'
  | 'provider_stream_failed'
  | 'turn_error';

function classifyTurnError(err: unknown): TurnErrorCategory {
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();
  if (
    lower.includes('spawn') ||
    lower.includes('enoent') ||
    lower.includes('not found')
  ) {
    return 'cli_spawn_failed';
  }
  if (lower.includes('stream') || lower.includes('token')) {
    return 'provider_stream_failed';
  }
  return 'turn_error';
}

/**
 * Deps injected into the constructor — all mandatory.
 *
 * `circuitBreaker` 는 옵셔널 (R6/R7 smoke 테스트가 autonomy 미설치 모드).
 */
export interface MeetingTurnExecutorDeps {
  session: MeetingSession;
  streamBridge: StreamBridge;
  messageService: MessageService;
  arenaRootService: ArenaRootService;
  providerRegistry: ProviderRegistry;
  /** Shared set across all turns of the meeting — tracks which CLI
   *  providers already consumed their persona prompt this meeting. */
  personaPrimedParticipants: Set<string>;
  /** CLI permission prompts go through ApprovalService via this adapter. */
  approvalCliAdapter: ApprovalCliAdapter;
  /** work-status gate + persona Identity block. */
  memberProfileService: import('../../members/member-profile-service').MemberProfileService;
  /** R9-Task6 same_error tripwire. Optional. */
  circuitBreaker?: CircuitBreaker;
}

// ── Phase context shapes — orchestrator 가 turn-executor 에 넘기는 추가 정보 ─

export interface OpinionGatherCtx {
  /** orchestrator 가 발급한 발화 ID hint (`<providerId>_<n>`). prompt 안 안내. */
  suggestedLabel: string;
}

export interface QuickVoteCtx {
  suggestedLabel: string;
  /**
   * step 2 결과 — 의견 list markdown. 화면 ID + 본문 + 근거 + 발의자 label
   * 통째 동봉. orchestrator 가 OpinionService.tally + caller-side renderer 로
   * 미리 빌드.
   */
  opinionsMarkdown: string;
}

export interface FreeDiscussionCtx {
  suggestedLabel: string;
  /** 진행 중 root 의견 markdown — 화면 ID / 제목 / 본문 / 근거. */
  currentOpinionMarkdown: string;
  /** 자식 의견 list markdown (없으면 "(자식 의견 없음)"). depth cap 안내 동봉. */
  childrenMarkdown: string;
  /**
   * 깊이 cap 도달 의견의 화면 ID list — 직원이 그 의견에 자식 추가 시
   * `OpinionDepthCapError` 를 throw 하므로, prompt 단계에서 미리 안내.
   */
  depthCapReachedScreenIds: string[];
}

// ── Service ────────────────────────────────────────────────────────────

export class MeetingTurnExecutor {
  private readonly session: MeetingSession;
  private readonly streamBridge: StreamBridge;
  private readonly messageService: MessageService;
  private readonly arenaRootService: ArenaRootService;
  private readonly providerRegistry: ProviderRegistry;
  private readonly personaPrimedParticipants: Set<string>;
  private readonly approvalCliAdapter: ApprovalCliAdapter;
  private readonly memberProfileService: MeetingTurnExecutorDeps['memberProfileService'];
  private readonly circuitBreaker?: CircuitBreaker;

  private abortController: AbortController | null = null;

  constructor(deps: MeetingTurnExecutorDeps) {
    this.session = deps.session;
    this.streamBridge = deps.streamBridge;
    this.messageService = deps.messageService;
    this.arenaRootService = deps.arenaRootService;
    this.providerRegistry = deps.providerRegistry;
    this.personaPrimedParticipants = deps.personaPrimedParticipants;
    this.approvalCliAdapter = deps.approvalCliAdapter;
    this.memberProfileService = deps.memberProfileService;
    this.circuitBreaker = deps.circuitBreaker;
  }

  /** Abort the currently in-flight provider request, if any. */
  abort(): void {
    this.abortController?.abort();
  }

  // ── Phase 별 turn 호출 ─────────────────────────────────────────────

  async requestOpinionGather(
    speaker: Participant,
    ctx: OpinionGatherCtx,
  ): Promise<MeetingTurnResult<Step1OpinionGatherSchemaType>> {
    return this.runPhaseTurn({
      phase: 'gather',
      speaker,
      schema: PHASE_RESPONSE_SCHEMAS.gather,
      buildPromptBody: () => buildGatherPromptBody(speaker, ctx),
    });
  }

  async requestQuickVote(
    speaker: Participant,
    ctx: QuickVoteCtx,
  ): Promise<MeetingTurnResult<Step25QuickVoteSchemaType>> {
    return this.runPhaseTurn({
      phase: 'quick_vote',
      speaker,
      schema: PHASE_RESPONSE_SCHEMAS.quick_vote,
      buildPromptBody: () => buildQuickVotePromptBody(speaker, ctx),
    });
  }

  async requestFreeDiscussion(
    speaker: Participant,
    ctx: FreeDiscussionCtx,
  ): Promise<MeetingTurnResult<Step3FreeDiscussionSchemaType>> {
    return this.runPhaseTurn({
      phase: 'free_discussion',
      speaker,
      schema: PHASE_RESPONSE_SCHEMAS.free_discussion,
      buildPromptBody: () => buildFreeDiscussionPromptBody(speaker, ctx),
    });
  }

  // ── 공통 phase turn 흐름 ──────────────────────────────────────────

  private async runPhaseTurn<T>(args: {
    phase: 'gather' | 'quick_vote' | 'free_discussion';
    speaker: Participant;
    schema: ZodType<T>;
    buildPromptBody: () => string;
  }): Promise<MeetingTurnResult<T>> {
    const { phase, speaker, schema, buildPromptBody } = args;

    // (1) abort 가드 — orchestrator 가 phase loop 진입 직전에도 가드하지만,
    // race-condition 방지로 turn 진입 직후 다시 검사.
    if (this.session.aborted) {
      return { kind: 'skipped', providerId: speaker.id, reason: 'aborted' };
    }

    // (2) work-status gate (spec §7.2). speaker !== 'online' → skip + persist
    // marker. 본 marker 는 채널 transcript 가 회의 종료 후에도 skip 사실을
    // 보존할 수 있도록 — 옛 모델 그대로.
    {
      const status = this.memberProfileService.getWorkStatus(speaker.id);
      if (status !== 'online') {
        this.streamBridge.emitMeetingTurnSkipped({
          meetingId: this.session.meetingId,
          channelId: this.session.channelId,
          participantId: speaker.id,
          participantName: speaker.displayName,
          reason: status,
          skipId: randomUUID(),
        });
        tryGetLogger()?.info({
          component: 'meeting',
          action: 'turn-skipped',
          result: 'success',
          participantId: speaker.id,
          metadata: {
            meetingId: this.session.meetingId,
            channelId: this.session.channelId,
            phase,
            participantName: speaker.displayName,
            reason: status,
          },
        });
        try {
          this.messageService.append({
            channelId: this.session.channelId,
            meetingId: this.session.meetingId,
            authorId: speaker.id,
            authorKind: 'system',
            role: 'system',
            content: `meeting.turnSkipped|${speaker.displayName}|${status}`,
            meta: {
              turnSkipped: {
                participantId: speaker.id,
                participantName: speaker.displayName,
                reason: status,
              },
            },
          });
        } catch (e) {
          console.warn(
            '[meeting-turn-executor] failed to persist turn-skipped marker',
            e instanceof Error ? e.message : String(e),
          );
        }
        return {
          kind: 'skipped',
          providerId: speaker.id,
          reason: 'work-status-gate',
        };
      }
    }

    // (3) provider lookup
    const provider = this.providerRegistry.get(speaker.id);
    if (!provider) {
      const errorMsg = `Provider not found: ${speaker.id}`;
      this.streamBridge.emitMeetingError({
        meetingId: this.session.meetingId,
        channelId: this.session.channelId,
        error: errorMsg,
        fatal: false,
        speakerId: speaker.id,
      });
      tryGetLogger()?.error({
        component: 'meeting',
        action: 'turn-error',
        result: 'failure',
        participantId: speaker.id,
        error: { code: 'ProviderNotFound', message: errorMsg },
        metadata: {
          meetingId: this.session.meetingId,
          channelId: this.session.channelId,
          phase,
        },
      });
      return {
        kind: 'skipped',
        providerId: speaker.id,
        reason: 'provider-error',
      };
    }

    // (4) 1차 시도 → 실패 시 1회 재요청. 두 번 모두 schema 부합 안 함 →
    // skipped:'invalid-schema'. provider 호출 실패 → skipped:'provider-error'.
    let lastInvalidRaw: string | null = null;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const promptBody =
        attempt === 1
          ? buildPromptBody()
          : buildRetryPromptBody(buildPromptBody(), lastInvalidRaw);
      const callResult = await this.callProviderOnce({
        provider,
        speaker,
        promptBody,
        phase,
      });
      if (callResult.kind === 'provider-error') {
        return {
          kind: 'skipped',
          providerId: speaker.id,
          reason: 'provider-error',
        };
      }
      // (5) raw text → JSON 추출 → schema parse
      const raw = callResult.fullContent;
      const extracted = extractJsonObject(raw);
      const parsed = extracted === null ? null : safeParse(schema, extracted);

      if (parsed !== null) {
        // (6) 성공 — assistant 메시지 persist + emit turn-done.
        const persisted = this.persistAssistantMessage({
          speaker,
          messageId: callResult.messageId,
          rawContent: raw,
        });
        if (!persisted) {
          // FK / disk-full 등 fatal — 회의 자체 abort.
          this.session.abort();
          return {
            kind: 'skipped',
            providerId: speaker.id,
            reason: 'provider-error',
          };
        }
        this.streamBridge.emitMeetingTurnDone({
          meetingId: this.session.meetingId,
          channelId: this.session.channelId,
          messageId: callResult.messageId,
          totalTokens: callResult.outputTokens ?? callResult.tokenSequence,
        });
        tryGetLogger()?.info({
          component: 'meeting',
          action: 'turn-done',
          result: 'success',
          participantId: speaker.id,
          metadata: {
            meetingId: this.session.meetingId,
            channelId: this.session.channelId,
            phase,
            messageId: callResult.messageId,
            participantName: speaker.displayName,
            attempt,
            contentLength: raw.length,
          },
        });
        this.personaPrimedParticipants.add(speaker.id);
        return {
          kind: 'ok',
          providerId: speaker.id,
          payload: parsed,
          messageId: callResult.messageId,
        };
      }

      // schema 부합 안 함. raw 보존 + 다음 시도 (attempt 2).
      lastInvalidRaw = raw;
      tryGetLogger()?.warn({
        component: 'meeting',
        action: 'turn-invalid-schema',
        result: 'failure',
        participantId: speaker.id,
        metadata: {
          meetingId: this.session.meetingId,
          channelId: this.session.channelId,
          phase,
          attempt,
          rawLength: raw.length,
        },
      });
    }

    // 두 번 모두 실패 — skip + emit error (non-fatal).
    this.streamBridge.emitMeetingError({
      meetingId: this.session.meetingId,
      channelId: this.session.channelId,
      error: `phase=${phase} schema invalid after 2 attempts`,
      fatal: false,
      speakerId: speaker.id,
    });
    return {
      kind: 'skipped',
      providerId: speaker.id,
      reason: 'invalid-schema',
    };
  }

  /**
   * 단발 provider 호출 — token streaming + persona/permission 동봉.
   * 응답 raw text + messageId + token 카운트 반환. 호출 자체가 throw 하면
   * provider-error 분기.
   */
  private async callProviderOnce(args: {
    provider: BaseProvider;
    speaker: Participant;
    promptBody: string;
    phase: 'gather' | 'quick_vote' | 'free_discussion';
  }): Promise<
    | {
        kind: 'ok';
        messageId: string;
        fullContent: string;
        tokenSequence: number;
        outputTokens: number | null;
      }
    | { kind: 'provider-error' }
  > {
    const { provider, speaker, promptBody, phase } = args;
    const messageId = randomUUID();
    const turnStartedAt = Date.now();
    let fullContent = '';

    this.streamBridge.emitMeetingTurnStart({
      meetingId: this.session.meetingId,
      channelId: this.session.channelId,
      speakerId: speaker.id,
      messageId,
    });
    tryGetLogger()?.info({
      component: 'meeting',
      action: 'turn-start',
      result: 'success',
      participantId: speaker.id,
      metadata: {
        meetingId: this.session.meetingId,
        channelId: this.session.channelId,
        phase,
        messageId,
        participantName: speaker.displayName,
        providerType: provider.type,
      },
    });

    this.abortController = new AbortController();
    const { signal } = this.abortController;

    try {
      // history = session 의 누적 메시지 + 본 turn 의 phase prompt body.
      // phase prompt body 는 system 메시지로 history 마지막에 push (직원이 이번
      // 단계 양식을 즉시 보도록).
      const history = this.session.getMessagesForProvider(speaker.id);
      const messages: ProviderMessage[] = [
        ...history,
        { role: 'system', content: promptBody },
      ];

      let persona = '';
      if (this.shouldIncludePersona(provider, speaker.id)) {
        const permissionRules = buildPermissionRules({
          permission: null,
          projectFolder: this.session.ssmCtx.projectPath || null,
          arenaFolder: this.arenaRootService.getPath(),
        });
        const v3Identity = this.memberProfileService.buildPersona(speaker.id);
        persona = `${v3Identity}${permissionRules}`;
      }

      if (provider instanceof CliProvider) {
        this.wireCliPermissionCallback(provider, speaker);
      }

      let sequence = 0;
      try {
        for await (const token of provider.streamCompletion(
          messages,
          persona,
          undefined,
          signal,
        )) {
          if (this.session.aborted) break;
          fullContent += token;
          this.streamBridge.emitMeetingTurnToken({
            meetingId: this.session.meetingId,
            channelId: this.session.channelId,
            messageId,
            token,
            cumulative: fullContent,
            sequence: sequence++,
          });
        }
      } finally {
        if (provider instanceof CliProvider) {
          provider.setPermissionRequestCallback(null);
        }
      }

      const providerUsage = provider.consumeLastTokenUsage();
      return {
        kind: 'ok',
        messageId,
        fullContent,
        tokenSequence: sequence,
        outputTokens: providerUsage?.outputTokens ?? null,
      };
    } catch (err) {
      if (signal.aborted) {
        // 사용자 abort — 통제 신호로 분류, circuit breaker 손대지 않음.
        return { kind: 'provider-error' };
      }
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      const errorCategory = classifyTurnError(err);
      this.streamBridge.emitMeetingError({
        meetingId: this.session.meetingId,
        channelId: this.session.channelId,
        error: errorMsg,
        fatal: false,
        messageId,
        speakerId: speaker.id,
      });
      tryGetLogger()?.error({
        component: 'meeting',
        action: 'turn-error',
        result: 'failure',
        participantId: speaker.id,
        latencyMs: Date.now() - turnStartedAt,
        error: { code: errorCategory, message: errorMsg },
        metadata: {
          meetingId: this.session.meetingId,
          channelId: this.session.channelId,
          phase,
          messageId,
          participantName: speaker.displayName,
          partialContentLength: fullContent.length,
        },
      });
      this.circuitBreaker?.recordError(errorCategory);
      return { kind: 'provider-error' };
    } finally {
      this.abortController = null;
    }
  }

  /**
   * raw assistant 응답을 messageService 와 session in-memory 둘 다 push.
   * persist 실패 시 회의 자체를 abort (DB FK / disk-full 같은 fatal).
   */
  private persistAssistantMessage(args: {
    speaker: Participant;
    messageId: string;
    rawContent: string;
  }): boolean {
    const { speaker, messageId, rawContent } = args;
    // session in-memory — 다음 turn prompt history 에 자연 포함.
    this.session.createMessage({
      id: messageId,
      participantId: speaker.id,
      participantName: speaker.displayName,
      role: 'assistant',
      content: rawContent,
    });
    try {
      this.messageService.append({
        channelId: this.session.channelId,
        meetingId: this.session.meetingId,
        authorId: speaker.providerId ?? speaker.id,
        authorKind: 'member',
        role: 'assistant',
        content: rawContent,
        meta: null,
      });
      return true;
    } catch (dbErr) {
      const dbErrCode =
        dbErr instanceof Error
          ? (dbErr as { code?: string }).code ?? 'unknown'
          : 'unknown';
      this.streamBridge.emitMeetingError({
        meetingId: this.session.meetingId,
        channelId: this.session.channelId,
        error:
          dbErr instanceof Error
            ? `DB persist failed: ${dbErr.message}`
            : 'DB persist failed',
        fatal: true,
        messageId,
        speakerId: speaker.id,
      });
      tryGetLogger()?.error({
        component: 'meeting',
        action: 'turn-error',
        result: 'failure',
        participantId: speaker.id,
        error: { code: 'db_persist', message: dbErrCode },
        metadata: {
          meetingId: this.session.meetingId,
          channelId: this.session.channelId,
          messageId,
          participantName: speaker.displayName,
          phase: 'persist',
        },
      });
      return false;
    }
  }

  // ── Persona / CLI permission helpers ────────────────────────────────

  private shouldIncludePersona(
    provider: { type: string; config: unknown },
    participantId: string,
  ): boolean {
    if (provider.type !== 'cli') return true;
    const config = provider.config;
    const command = isCliProviderConfig(config)
      ? config.command.toLowerCase()
      : '';
    const isClaudeCli = command.includes('claude');
    if (!isClaudeCli) return true;
    return !this.personaPrimedParticipants.has(participantId);
  }

  private wireCliPermissionCallback(
    provider: CliProvider,
    speaker: Participant,
  ): void {
    provider.setPermissionRequestCallback(
      async (
        participantId: string,
        req: ParsedCliPermissionRequest,
      ): Promise<boolean> => {
        return this.approvalCliAdapter.createCliPermissionApproval({
          meetingId: this.session.meetingId,
          channelId: this.session.channelId,
          projectId: this.session.projectId,
          participantId,
          participantName: speaker.displayName,
          request: req,
        });
      },
    );
  }
}

// ── Prompt builders (spec §11.18.2 / .4 / .5) ───────────────────────────

/**
 * step 1 의견 제시 prompt body. session 의 첫 system 메시지 (회의 주제) 가 이미
 * provider history 안에 있으므로 본 prompt 는 *현재 단계 양식* 만 안내.
 */
function buildGatherPromptBody(
  speaker: Participant,
  ctx: OpinionGatherCtx,
): string {
  const lines: string[] = [];
  lines.push('[현재 단계: step 1 — 의견 제시]');
  lines.push(
    '회의 주제는 이전 system 메시지에 있습니다. 본 단계에서 본인의 의견을 제시하세요.',
  );
  lines.push('');
  lines.push(
    '응답은 *JSON 한 객체만* — markdown code fence 사용 금지, JSON 외 본문 금지.',
  );
  lines.push('');
  lines.push('```json (스키마 — 그대로 따르기)');
  lines.push('{');
  lines.push(`  "name": "${escapeForPrompt(speaker.displayName)}",`);
  lines.push(`  "label": "${escapeForPrompt(ctx.suggestedLabel)}",`);
  lines.push('  "opinions": [');
  lines.push('    {');
  lines.push('      "title": "<짧은 제목>",');
  lines.push('      "content": "<본문 — 통째 / truncate 금지>",');
  lines.push('      "rationale": "<근거 / 이유>"');
  lines.push('    }');
  lines.push('  ]');
  lines.push('}');
  lines.push('```');
  lines.push('');
  lines.push(
    '`opinions` 배열 길이 ≥ 0. 의견 없으면 빈 배열로 응답 가능 (`"opinions": []`).',
  );
  lines.push('본문 / 근거 통째 보존 — 요약 / 축약 금지.');
  return lines.join('\n');
}

function buildQuickVotePromptBody(
  speaker: Participant,
  ctx: QuickVoteCtx,
): string {
  const lines: string[] = [];
  lines.push('[현재 단계: step 2.5 — 일괄 동의 투표]');
  lines.push('');
  lines.push('직원들이 제시한 의견 list:');
  lines.push('');
  lines.push(ctx.opinionsMarkdown.trim() || '(의견 없음)');
  lines.push('');
  lines.push(
    '각 의견에 대해 동의 / 반대 / 보류 중 하나로 투표하세요. 응답은 *JSON 한 객체만*.',
  );
  lines.push('');
  lines.push('```json (스키마 — 그대로 따르기)');
  lines.push('{');
  lines.push(`  "name": "${escapeForPrompt(speaker.displayName)}",`);
  lines.push(`  "label": "${escapeForPrompt(ctx.suggestedLabel)}",`);
  lines.push('  "quick_votes": [');
  lines.push('    {');
  lines.push('      "target_id": "<화면 ID 예: ITEM_001>",');
  lines.push('      "vote": "agree" | "oppose" | "abstain",');
  lines.push('      "comment": "<선택 — 동의해도 코멘트 가능>"');
  lines.push('    }');
  lines.push('  ]');
  lines.push('}');
  lines.push('```');
  lines.push('');
  lines.push('`quick_votes` 배열 길이 ≥ 1 (모든 의견에 표명 권장).');
  return lines.join('\n');
}

function buildFreeDiscussionPromptBody(
  speaker: Participant,
  ctx: FreeDiscussionCtx,
): string {
  const lines: string[] = [];
  lines.push('[현재 단계: step 3 — 자유 토론]');
  lines.push('');
  lines.push('진행 중 의견:');
  lines.push(ctx.currentOpinionMarkdown.trim());
  lines.push('');
  lines.push('자식 의견 (수정 / 반대 / 보강):');
  lines.push(ctx.childrenMarkdown.trim() || '(자식 의견 없음)');
  lines.push('');
  if (ctx.depthCapReachedScreenIds.length > 0) {
    lines.push(
      '⚠ 다음 의견은 깊이 cap 도달 — 자식 추가 불가 (parent_id 로 지정 시 거부됩니다):',
    );
    for (const id of ctx.depthCapReachedScreenIds) {
      lines.push(`  - ${id}`);
    }
    lines.push('');
  }
  lines.push(
    '이 의견 (또는 자식) 에 대해 동의 / 반대 / 보류 표명, 또는 수정안 / 반대안 / 보강안 제시.',
  );
  lines.push(
    '한 응답 안에 votes (기존 의견 표명) + additions (새 자식 의견) 둘 다 가능하지만, *둘 합쳐 최소 1 항목*.',
  );
  lines.push('');
  lines.push('```json (스키마 — 그대로 따르기)');
  lines.push('{');
  lines.push(`  "name": "${escapeForPrompt(speaker.displayName)}",`);
  lines.push(`  "label": "${escapeForPrompt(ctx.suggestedLabel)}",`);
  lines.push('  "votes": [');
  lines.push('    {');
  lines.push('      "target_id": "<화면 ID>",');
  lines.push('      "vote": "agree" | "oppose" | "abstain",');
  lines.push('      "comment": "<선택>"');
  lines.push('    }');
  lines.push('  ],');
  lines.push('  "additions": [');
  lines.push('    {');
  lines.push('      "parent_id": "<자식이 매달릴 부모 화면 ID>",');
  lines.push('      "kind": "revise" | "block" | "addition",');
  lines.push('      "title": "<제목>",');
  lines.push('      "content": "<본문 — 통째>",');
  lines.push('      "rationale": "<근거>"');
  lines.push('    }');
  lines.push('  ]');
  lines.push('}');
  lines.push('```');
  return lines.join('\n');
}

/**
 * 1 회 재요청 prompt — 직전 응답 raw + "schema 부합 안 함" 안내 + 양식 재동봉.
 * orchestrator 의 retry 결정 기준은 caller 가 schema parse 실패를 감지했다는
 * 사실이라, 본 함수는 "왜 실패했는지" 의 구체값은 안 받음 (zod issue list 는
 * 디버그용이라 직원에게 전달해도 의미 X — schema 양식 자체를 다시 강조).
 */
function buildRetryPromptBody(
  baseBody: string,
  lastInvalidRaw: string | null,
): string {
  const lines: string[] = [];
  lines.push(
    '[재요청] 직전 응답이 schema 부합 안 했습니다. 양식을 정확히 따라 다시 응답하세요.',
  );
  if (lastInvalidRaw) {
    const trimmed = lastInvalidRaw.trim();
    const preview =
      trimmed.length > 400 ? `${trimmed.slice(0, 400)}…(생략)` : trimmed;
    lines.push('');
    lines.push('직전 응답 (참고):');
    lines.push('```');
    lines.push(preview);
    lines.push('```');
  }
  lines.push('');
  lines.push(baseBody);
  return lines.join('\n');
}

// ── JSON 추출 + zod parse helpers ───────────────────────────────────────

/**
 * raw 문자열에서 JSON 객체 추출. 우선 raw 전체를 JSON.parse 시도 → 실패 시
 * 마지막 `{ ... }` 블록만 잘라 재시도. 둘 다 실패 시 null.
 *
 * 옛 message-formatter 의 `extractLastJsonObject` 와 동일한 기조 — code fence
 * 안 / 양 끝 markdown 잡설 / trailing 텍스트 모두 견인.
 */
function extractJsonObject(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // 1차 — 통째 시도
  const direct = tryJsonParse(trimmed);
  if (direct !== null) return direct;

  // 2차 — 마지막 `{...}` 블록 추출. 깊이 카운터로 외곽 객체 1 개만.
  const lastBlock = extractLastBraceBlock(trimmed);
  if (lastBlock === null) return null;
  return tryJsonParse(lastBlock);
}

function tryJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * 깊이 카운터로 마지막 외곽 `{...}` 블록 추출. string literal 안의 `{` `}` 는
 * 카운트 X — 단순 escape-aware scanner. 실패 시 null.
 */
function extractLastBraceBlock(text: string): string | null {
  let lastOpen = -1;
  let depth = 0;
  let inString = false;
  let stringChar = '';
  let escaped = false;
  let candidateStart = -1;
  let candidateEnd = -1;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === stringChar) {
        inString = false;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      stringChar = ch;
      continue;
    }
    if (ch === '{') {
      if (depth === 0) lastOpen = i;
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0 && lastOpen >= 0) {
        candidateStart = lastOpen;
        candidateEnd = i;
      }
    }
  }
  if (candidateStart < 0 || candidateEnd < 0) return null;
  return text.slice(candidateStart, candidateEnd + 1);
}

function safeParse<T>(schema: ZodType<T>, value: unknown): T | null {
  const result = schema.safeParse(value);
  return result.success ? result.data : null;
}

// ── 잡유틸 ─────────────────────────────────────────────────────────────

/**
 * prompt 안 string literal 에 들어가는 사용자 입력 / displayName / label 의
 * `"` 와 `\` 를 escape — JSON-like 양식 안에서 깨지지 않도록.
 */
function escapeForPrompt(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function isCliProviderConfig(config: unknown): config is CliProviderConfig {
  return (
    typeof config === 'object' &&
    config !== null &&
    'command' in config &&
    typeof (config as Record<string, unknown>).command === 'string'
  );
}

// Unused-re-export guard: silence strict builds that dead-letter an
// interface we expose purely as a documentation touchpoint.
export type { ProviderMessage as _ProviderMessage };
