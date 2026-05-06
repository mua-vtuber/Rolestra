/**
 * RunStepService — R12-C2 P2 회의 turn *진행 일지* 본체 (T12).
 *
 * 회의 안 모든 turn 의 의도 / 입력 / 출력 / 사이드이펙트 / 분류 결과를
 * 영속 저장한다. 회의록 (`minutes.md` — 모더레이터, 의견 단위) 과 별개:
 * RunStep = *시스템 단계 단위* 누적, 회의록 = *사람 결정 단위* 정리.
 *
 * 책임 (spec §11.19.4):
 *   - {@link appendForTurn}    한 turn 의 RunStep row 들 atomic insert (transaction
 *                              묶음 — 부분 실패 시 better-sqlite3 가 자동 rollback)
 *   - {@link listByMeeting}    회의 turn-by-turn replay 용 list
 *   - {@link listByChannel}    채널 진행률 + 시간순 list
 *   - {@link listByTurn}       한 turn 의 step 흐름 확인용 list
 *
 * append-only 정책:
 *   본 service 는 update / delete *공개 메서드를 노출 안 한다*. RunStep row
 *   는 한 번 insert 되면 영속 — 회의 종료 / 재시작 / 직원 삭제 후에도 보존
 *   (감사 무결성). 직원 삭제 시 actor_id 만 SET NULL — row 자체는 유지.
 *
 * truncate 금지 (spec §11.19.4):
 *   inputJson / outputJson 은 caller 가 넘긴 문자열 *그대로* 저장. 길이
 *   제한 / 잘라내기 *없음*. SQLite row 1GB 한계까지 안전 — 그 이상은
 *   underlying SqliteError 가 throw 되어 caller 에 전파.
 *
 * caller 책임:
 *   - inputJson / outputJson 은 *유효 JSON 문자열* (caller 가 JSON.stringify 통과 보장)
 *   - actorKind 와 actorId 의 정합 (예: actorKind='user' 면 actorId=null)
 *   - turnIndex / round 의 단조 증가 — service 는 검증 X (caller orchestrator 책임)
 *
 * 본격 wire = T13 (MeetingOrchestrator 재배선). 본 T12 는 *skeleton* — IPC
 * `meeting:list-run-steps` 로 영속 동작 검증 가능.
 *
 * spec docs/superpowers/specs/2026-05-01-rolestra-channel-roles-design.md
 *  §11.19  A. RunStep 영속 기록부 (cross-cutting)
 */

import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { NewRunStep, RunStep } from '../../../shared/run-step-types';
import type { RunStepRepository } from './run-step-repository';

/**
 * RunStepService 가 발사하는 이벤트 시그니처. R12-C2 T19 wire (StreamBridge
 * 가 본 이벤트 구독 → `stream:dashboard-progress-changed` invalidate 신호
 * 변환).
 *
 * `'appended'` 페이로드 = 영속된 RunStep row 그대로. 한 transaction 안에서
 * 여러 row 가 insert 되면 `appendForTurn` 이 row 별로 *순차적으로* emit —
 * subscriber 는 row 단위로 받는다 (단, transaction 자체는 atomic — 모든
 * row commit 후에야 emit 호출 시작).
 */
export interface RunStepServiceEvents {
  appended: (step: RunStep) => void;
}

// ── Error hierarchy ────────────────────────────────────────────────────

/** Base — caller 가 `e instanceof RunStepError` 로 도메인 분기. */
export class RunStepError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RunStepError';
  }
}

/**
 * NextStep 분류 결과 (`nextStepCard`) 가 `stepKind='next_step_classify'`
 * 외의 step 에 들어왔을 때. spec §11.19.2 — 다른 step 에서는 NULL 만 허용.
 *
 * silent fallback 금지 (CLAUDE.md): caller 가 잘못 채워 넘기면 즉시 throw —
 * NULL 로 덮어쓰지 않는다 (디버깅 용이).
 */
export class RunStepNextStepCardMisuseError extends RunStepError {
  constructor(stepKind: string) {
    super(
      `RunStepService: nextStepCard is reserved for stepKind='next_step_classify' ` +
        `but received stepKind='${stepKind}' — caller must pass nextStepCard=null`,
    );
    this.name = 'RunStepNextStepCardMisuseError';
  }
}

/**
 * actorKind 와 actorId 의 정합이 깨졌을 때:
 *   - `actorKind='employee'` 인데 `actorId=null`        → 누구 발언인지 추적 불가
 *   - `actorKind='system'` / `'moderator'` / `'user'`인데 `actorId !== null`
 *                                                       → provider FK 의미 모호
 *
 * silent fallback 금지: caller 의 잘못된 입력은 즉시 throw — RunStep row 무결성
 * 보장.
 */
export class RunStepActorMismatchError extends RunStepError {
  constructor(actorKind: string, actorIdState: 'null' | 'set') {
    super(
      `RunStepService: actorKind='${actorKind}' is incompatible with ` +
        `actorId being ${actorIdState} — employee requires actorId, ` +
        `system/moderator/user require actorId=null`,
    );
    this.name = 'RunStepActorMismatchError';
  }
}

// ── Service ────────────────────────────────────────────────────────────

export class RunStepService extends EventEmitter {
  constructor(private readonly repo: RunStepRepository) {
    super();
    // R12-C2 T19: subscribe 폭발 방지. dashboard 가 1 곳, 추후 H1 위젯 +
    // observability sink 추가해도 기본 10 으로 충분 — 본 cap 은 EventEmitter
    // 의 메모리누수 경고가 아니라 *코드 SSoT* 으로 둔다.
    this.setMaxListeners(20);
  }

  /**
   * 한 turn 의 RunStep row 들을 atomic 하게 insert. caller 는 `NewRunStep`
   * (id / createdAt 제외) 배열을 넘기고, service 가 UUID v4 + Unix epoch ms
   * 를 채운 뒤 single transaction 으로 모두 insert.
   *
   * 부분 실패 시 (예: 마지막 row 의 FK 위반) better-sqlite3 가 자동 rollback —
   * 같은 turn 의 row 들이 *반쪽* 으로 영속될 일 없음.
   *
   * 빈 배열은 no-op (transaction 시작 X) — caller 의 무해한 호출.
   *
   * R12-C2 T19: transaction commit 성공 후 row 별로 `'appended'` emit —
   * StreamBridge 가 구독 → `stream:dashboard-progress-changed` 변환.
   * emit 은 transaction 밖 (commit 직후) — listener throw 가 영속에 영향 X.
   *
   * @returns insert 된 RunStep 배열 (id / createdAt 채워진 상태).
   */
  appendForTurn(steps: ReadonlyArray<NewRunStep>): RunStep[] {
    if (steps.length === 0) return [];

    for (const step of steps) {
      this.assertValid(step);
    }

    const now = Date.now();
    const completed: RunStep[] = steps.map((step) => ({
      ...step,
      id: randomUUID(),
      createdAt: now,
    }));

    this.repo.withTransaction(() => {
      for (const step of completed) {
        this.repo.insert(step);
      }
    });

    // commit 후 `'appended'` 발사. listener throw 는 isolate — 한 listener 의
    // 실패가 다른 listener 또는 caller 흐름을 깨뜨리지 않는다 (StreamBridge
    // 자체가 outbound listener throw 를 isolate 하지만, 본 service 도 한 번 더
    // 방어).
    for (const step of completed) {
      try {
        this.emit('appended', step);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // TODO R2-log: swap for structured logger (src/main/log/)
        console.warn(
          '[rolestra.run-step] appended listener threw:',
          {
            stepId: step.id,
            stepKind: step.stepKind,
            name: err instanceof Error ? err.name : undefined,
            message,
          },
        );
      }
    }

    return completed;
  }

  // ── typed EventEmitter overloads (member-profile-service 패턴) ──────

  on<E extends keyof RunStepServiceEvents>(
    event: E,
    listener: RunStepServiceEvents[E],
  ): this;
  on(event: string | symbol, listener: (...args: unknown[]) => void): this;
  on(event: string | symbol, listener: (...args: unknown[]) => void): this {
    return super.on(event, listener);
  }

  off<E extends keyof RunStepServiceEvents>(
    event: E,
    listener: RunStepServiceEvents[E],
  ): this;
  off(event: string | symbol, listener: (...args: unknown[]) => void): this;
  off(event: string | symbol, listener: (...args: unknown[]) => void): this {
    return super.off(event, listener);
  }

  emit<E extends keyof RunStepServiceEvents>(
    event: E,
    ...args: Parameters<RunStepServiceEvents[E]>
  ): boolean;
  emit(event: string | symbol, ...args: unknown[]): boolean;
  emit(event: string | symbol, ...args: unknown[]): boolean {
    return super.emit(event, ...args);
  }

  /**
   * 단일 RunStep row append — 편의 메서드. 한 step 만 영속할 때
   * appendForTurn([step]) 대신 사용. 내부적으로 같은 atomic 보장.
   */
  appendOne(step: NewRunStep): RunStep {
    const [persisted] = this.appendForTurn([step]);
    if (!persisted) {
      // appendForTurn 이 [] 를 돌려주는 경우는 빈 입력뿐 — 이 분기는 도달 X.
      throw new RunStepError(
        'RunStepService.appendOne: appendForTurn returned empty result for non-empty input',
      );
    }
    return persisted;
  }

  /** 회의 turn-by-turn replay 용 list — repository 위임. */
  listByMeeting(meetingId: string): RunStep[] {
    return this.repo.listByMeeting(meetingId);
  }

  /** 채널 진행률 + 시간순 list — repository 위임. */
  listByChannel(channelId: string): RunStep[] {
    return this.repo.listByChannel(channelId);
  }

  /** 한 turn 의 step 흐름 list — repository 위임. */
  listByTurn(meetingId: string, turnIndex: number): RunStep[] {
    return this.repo.listByTurn(meetingId, turnIndex);
  }

  // ── private ────────────────────────────────────────────────────────

  /**
   * caller 입력의 도메인 정합 검증. silent fallback 금지 — 잘못된 입력은
   * 즉시 throw 하여 회의 진행 일지의 무결성을 보장.
   */
  private assertValid(step: NewRunStep): void {
    if (step.stepKind !== 'next_step_classify' && step.nextStepCard !== null) {
      throw new RunStepNextStepCardMisuseError(step.stepKind);
    }

    if (step.actorKind === 'employee' && step.actorId === null) {
      throw new RunStepActorMismatchError('employee', 'null');
    }
    if (step.actorKind !== 'employee' && step.actorId !== null) {
      throw new RunStepActorMismatchError(step.actorKind, 'set');
    }
  }
}
