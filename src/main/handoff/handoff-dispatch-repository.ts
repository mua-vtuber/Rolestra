/**
 * HandoffDispatchRepository — `handoff_dispatch` 테이블 thin data-access layer.
 * R12-C2 P6 T27 land.
 *
 * 책임:
 *   - SQL snake_case 컬럼 ↔ main process camelCase {@link HandoffDispatchRow}
 *     매핑.
 *   - insert / findById / list / markOpened 만 노출. update / delete *공개
 *     메서드 없음* — 인계 row 는 한 번 영속되면 보존 (audit trail). markOpened
 *     은 opened_at NULL → epoch 1 회 update 만 허용 (idempotent).
 *   - {@link withTransaction} 으로 caller (HandoffDispatchService) 가 향후
 *     multi-row 동작 (예: bulk dispatch — R13+ 복수 부서 인계) 시 atomic 보장.
 *
 * 비즈니스 규칙 0 — 모든 검증 (필수 필드 / mission card 직렬화 형식 / mode 값
 * 등) 은 HandoffDispatchService + zod schema 가 책임.
 *
 * spec docs/specs/2026-05-01-rolestra-channel-roles-design.md
 *  - §11.22.3  handoff_dispatch 데이터 source
 *  - migration 022-handoff-dispatch.ts (FK 정책 / CHECK 제약 / 인덱스)
 */

import type Database from 'better-sqlite3';
import type { HandoffMode } from '../../shared/channel-role-types';
import type { HandoffDispatchRow } from './handoff-dispatch-types';

interface HandoffDispatchRowSql {
  id: string;
  from_meeting_id: string;
  from_channel_id: string;
  to_channel_id: string;
  reason: string;
  minutes_id: string | null;
  mission_card_json: string;
  mode: HandoffMode;
  dispatched_at: number;
  opened_at: number | null;
  created_at: number;
}

function rowToHandoffDispatch(row: HandoffDispatchRowSql): HandoffDispatchRow {
  return {
    id: row.id,
    fromMeetingId: row.from_meeting_id,
    fromChannelId: row.from_channel_id,
    toChannelId: row.to_channel_id,
    reason: row.reason,
    minutesId: row.minutes_id,
    missionCardJson: row.mission_card_json,
    mode: row.mode,
    dispatchedAt: row.dispatched_at,
    openedAt: row.opened_at,
    createdAt: row.created_at,
  };
}

const COLUMNS_SELECT = `
  id, from_meeting_id, from_channel_id, to_channel_id, reason, minutes_id,
  mission_card_json, mode, dispatched_at, opened_at, created_at
`;

export class HandoffDispatchRepository {
  constructor(private readonly db: Database.Database) {}

  /**
   * caller 가 넘긴 fn 을 단일 SQLite transaction 으로 감싼다 — fn 안에서 발생한
   * 모든 SQL 쓰기는 atomic. better-sqlite3 가 nested 호출 시 SAVEPOINT 처리.
   */
  withTransaction<T>(fn: () => T): T {
    const txn = this.db.transaction(fn);
    return txn();
  }

  /**
   * 단일 handoff_dispatch row insert. caller (HandoffDispatchService) 가
   * `id` (UUID) / `openedAt = null` / `createdAt = now` 모두 채워서 넘긴다.
   *
   * SqliteError (FK / CHECK 위반 — 예: mode 가 'check'/'auto' 아님) 는 그대로
   * throw. service 가 도메인 에러로 변환할지 결정.
   */
  insert(row: HandoffDispatchRow): void {
    this.db
      .prepare(
        `INSERT INTO handoff_dispatch (
           id, from_meeting_id, from_channel_id, to_channel_id, reason,
           minutes_id, mission_card_json, mode,
           dispatched_at, opened_at, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        row.fromMeetingId,
        row.fromChannelId,
        row.toChannelId,
        row.reason,
        row.minutesId,
        row.missionCardJson,
        row.mode,
        row.dispatchedAt,
        row.openedAt,
        row.createdAt,
      );
  }

  /** id 로 단일 row lookup. 없으면 null. */
  findById(id: string): HandoffDispatchRow | null {
    const row = this.db
      .prepare(`SELECT ${COLUMNS_SELECT} FROM handoff_dispatch WHERE id = ?`)
      .get(id) as HandoffDispatchRowSql | undefined;
    return row ? rowToHandoffDispatch(row) : null;
  }

  /**
   * 받는 채널 (`to_channel_id`) 의 모든 의뢰서 — dispatched_at 내림차순 (최신순).
   * 받는 부서 채널 entry 시 H2 첫 surface candidate list lookup.
   */
  listByToChannel(toChannelId: string): HandoffDispatchRow[] {
    const rows = this.db
      .prepare(
        `SELECT ${COLUMNS_SELECT}
         FROM handoff_dispatch
         WHERE to_channel_id = ?
         ORDER BY dispatched_at DESC, id ASC`,
      )
      .all(toChannelId) as HandoffDispatchRowSql[];
    return rows.map(rowToHandoffDispatch);
  }

  /**
   * 받는 채널의 *미열람* (opened_at IS NULL) 의뢰서만. H2 첫 surface 시 사용자가
   * 아직 열어보지 않은 의뢰서 단 1 건 (= 가장 최근 미열람) 노출용.
   */
  listUnopenedByToChannel(toChannelId: string): HandoffDispatchRow[] {
    const rows = this.db
      .prepare(
        `SELECT ${COLUMNS_SELECT}
         FROM handoff_dispatch
         WHERE to_channel_id = ? AND opened_at IS NULL
         ORDER BY dispatched_at DESC, id ASC`,
      )
      .all(toChannelId) as HandoffDispatchRowSql[];
    return rows.map(rowToHandoffDispatch);
  }

  /**
   * 보낸 회의 (`from_meeting_id`) 의 모든 의뢰서 — 한 회의가 여러 부서로 동시
   * 인계할 가능성 (R13+) 대비. 현재 R12-C2 시점은 회의 1 → 의뢰서 0 또는 1 건.
   */
  listByFromMeeting(fromMeetingId: string): HandoffDispatchRow[] {
    const rows = this.db
      .prepare(
        `SELECT ${COLUMNS_SELECT}
         FROM handoff_dispatch
         WHERE from_meeting_id = ?
         ORDER BY dispatched_at ASC, id ASC`,
      )
      .all(fromMeetingId) as HandoffDispatchRowSql[];
    return rows.map(rowToHandoffDispatch);
  }

  /**
   * `opened_at` 이 NULL 일 때만 epoch 으로 update. 이미 set 이면 0 row 영향 →
   * service.open 이 idempotent 보장 시 사용.
   *
   * @returns true = 첫 열람으로 update 성공, false = 이미 열람된 row (no-op)
   *          또는 id 미존재.
   */
  markOpened(id: string, openedAt: number): boolean {
    const result = this.db
      .prepare(
        `UPDATE handoff_dispatch
         SET opened_at = ?
         WHERE id = ? AND opened_at IS NULL`,
      )
      .run(openedAt, id);
    return result.changes > 0;
  }
}
