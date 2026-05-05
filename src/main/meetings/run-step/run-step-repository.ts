/**
 * RunStepRepository — `run_step` 테이블 thin data-access layer (R12-C2 P2 T12).
 *
 * 책임:
 *   - SQL snake_case 컬럼 ↔ shared camelCase {@link RunStep} 매핑.
 *   - append-only insert / list 만 노출. update / delete *공개 메서드 없음* —
 *     spec §11.19.4 의 append-only 정책을 코드 레이어에서 강제.
 *   - {@link withTransaction} 으로 caller (RunStepService) 가 한 turn 의 row
 *     들을 atomic 하게 묶을 수 있게 함.
 *
 * 비즈니스 규칙 0 — 모든 검증 (필수 필드 / inputJson 유효 JSON 여부 등) 은
 * RunStepService 가 책임.
 *
 * spec docs/superpowers/specs/2026-05-01-rolestra-channel-roles-design.md
 *  - §11.19  A. RunStep 영속 기록부
 *  - migration 020-run-step.ts (FK 정책 / CHECK 제약 / 인덱스)
 */

import type Database from 'better-sqlite3';
import type {
  NextStepCard,
  RunStep,
  RunStepActorKind,
  RunStepKind,
} from '../../../shared/run-step-types';

interface RunStepRow {
  id: string;
  meeting_id: string;
  channel_id: string;
  round: number;
  turn_index: number;
  actor_kind: RunStepActorKind;
  actor_id: string | null;
  step_kind: RunStepKind;
  input_json: string;
  output_json: string;
  next_step_card: NextStepCard | null;
  side_effect_summary: string | null;
  duration_ms: number;
  created_at: number;
}

function rowToRunStep(row: RunStepRow): RunStep {
  return {
    id: row.id,
    meetingId: row.meeting_id,
    channelId: row.channel_id,
    round: row.round,
    turnIndex: row.turn_index,
    actorKind: row.actor_kind,
    actorId: row.actor_id,
    stepKind: row.step_kind,
    inputJson: row.input_json,
    outputJson: row.output_json,
    nextStepCard: row.next_step_card,
    sideEffectSummary: row.side_effect_summary,
    durationMs: row.duration_ms,
    createdAt: row.created_at,
  };
}

export class RunStepRepository {
  constructor(private readonly db: Database.Database) {}

  /**
   * caller 가 넘긴 fn 을 단일 SQLite transaction 으로 감싼다 — fn 안에서
   * 발생한 모든 SQL 쓰기는 atomic. 부분 실패 시 better-sqlite3 가 자동
   * rollback. 중첩 호출은 better-sqlite3 가 SAVEPOINT 로 처리.
   *
   * RunStepService.appendForTurn 이 한 turn 안 row 들을 묶을 때 사용.
   */
  withTransaction<T>(fn: () => T): T {
    const txn = this.db.transaction(fn);
    return txn();
  }

  /**
   * 단일 RunStep row insert. caller (RunStepService) 가 `id` (UUID) /
   * `createdAt` (= now) 모두 채워서 넘긴다.
   *
   * SqliteError (FK / CHECK 위반) 는 그대로 throw — service 가 도메인
   * 에러로 변환할지 결정한다.
   */
  insert(step: RunStep): void {
    this.db
      .prepare(
        `INSERT INTO run_step (
           id, meeting_id, channel_id, round, turn_index,
           actor_kind, actor_id, step_kind,
           input_json, output_json, next_step_card,
           side_effect_summary, duration_ms, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        step.id,
        step.meetingId,
        step.channelId,
        step.round,
        step.turnIndex,
        step.actorKind,
        step.actorId,
        step.stepKind,
        step.inputJson,
        step.outputJson,
        step.nextStepCard,
        step.sideEffectSummary,
        step.durationMs,
        step.createdAt,
      );
  }

  /**
   * meetingId 의 모든 RunStep — turn_index 오름차순, 같은 turn_index 안에서
   * created_at 오름차순. 회의 turn-by-turn replay 용.
   */
  listByMeeting(meetingId: string): RunStep[] {
    const rows = this.db
      .prepare(
        `SELECT id, meeting_id, channel_id, round, turn_index,
                actor_kind, actor_id, step_kind,
                input_json, output_json, next_step_card,
                side_effect_summary, duration_ms, created_at
         FROM run_step
         WHERE meeting_id = ?
         ORDER BY turn_index ASC, created_at ASC, id ASC`,
      )
      .all(meetingId) as RunStepRow[];
    return rows.map(rowToRunStep);
  }

  /**
   * channelId 의 모든 RunStep — created_at 오름차순. 채널 진행률 + 시간순
   * 조회용. 같은 채널 안 다수 회의 row 가 시간순으로 섞임.
   */
  listByChannel(channelId: string): RunStep[] {
    const rows = this.db
      .prepare(
        `SELECT id, meeting_id, channel_id, round, turn_index,
                actor_kind, actor_id, step_kind,
                input_json, output_json, next_step_card,
                side_effect_summary, duration_ms, created_at
         FROM run_step
         WHERE channel_id = ?
         ORDER BY created_at ASC, id ASC`,
      )
      .all(channelId) as RunStepRow[];
    return rows.map(rowToRunStep);
  }

  /**
   * meetingId + turn_index 의 모든 RunStep — 같은 turn 안 row 들 created_at
   * 오름차순. 디버깅 / 회귀 분석 시 한 turn 의 step 흐름 확인.
   */
  listByTurn(meetingId: string, turnIndex: number): RunStep[] {
    const rows = this.db
      .prepare(
        `SELECT id, meeting_id, channel_id, round, turn_index,
                actor_kind, actor_id, step_kind,
                input_json, output_json, next_step_card,
                side_effect_summary, duration_ms, created_at
         FROM run_step
         WHERE meeting_id = ? AND turn_index = ?
         ORDER BY created_at ASC, id ASC`,
      )
      .all(meetingId, turnIndex) as RunStepRow[];
    return rows.map(rowToRunStep);
  }
}
