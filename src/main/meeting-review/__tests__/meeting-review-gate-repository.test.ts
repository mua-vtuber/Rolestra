/**
 * MeetingReviewGateRepository 단위 테스트 — R12-C2 P6 (migration 024).
 *
 * 본 repo (`meeting-review-gate-repository.ts`) 가 직접 invariant 를 보호하는지
 * verify. handler-level (meeting-review-handler.test.ts) 는 service 를 통한
 * 호출만 cover — repository 의 schema 강제 / FK / CHECK / UNIQUE / WHERE
 * status='pending' guard / ORDER BY / NULL 허용은 본 파일이 SSoT.
 *
 * 검증 항목:
 *   - insert + findById round-trip (snake↔camel 매핑)
 *   - findById 미존재 → null
 *   - kind CHECK 위반 throw
 *   - status CHECK 위반 throw
 *   - project_id FK 위반 throw / meeting_id FK 위반 throw / source_channel FK 위반 throw
 *   - target_channel_id NULL 허용 + user_note NULL / payload_json NULL / decided_at NULL 허용
 *   - list — 필터 없으면 전체, projectId / status / kind 각각 필터
 *   - list — ORDER BY created_at DESC, id ASC
 *   - updateDecision — pending row 갱신 시 row 반환 + status/user_note/decided_at 영속
 *   - updateDecision — 이미 종결된 row 는 null 반환 (status='pending' guard)
 *   - updateDecision — 미존재 id → null
 *   - withTransaction — fn 안 throw 시 insert rollback
 *
 * 패턴: in-memory sqlite (`:memory:`) + migrations 014~024.
 */

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../database/migrator';
import { migrations } from '../../database/migrations/index';
import {
  insertChannel,
  insertProject,
  insertProvider,
  NOW,
} from '../../database/__tests__/_helpers';
import type {
  MeetingReviewGate,
  MeetingReviewGateStatus,
} from '../../../shared/meeting-review-types';
import { MeetingReviewGateRepository } from '../meeting-review-gate-repository';

const PROJECT_ID = 'p-1';
const MEETING_ID = 'meet-1';
const SOURCE_CHANNEL = 'ch-planning';
const TARGET_CHANNEL = 'ch-design';

function insertMeeting(
  db: Database.Database,
  id: string,
  channelId: string,
): void {
  db.prepare(
    `INSERT INTO meetings (id, channel_id, state, started_at)
     VALUES (?, ?, 'running', ?)`,
  ).run(id, channelId, NOW);
}

function makeGate(
  id: string,
  overrides: Partial<MeetingReviewGate> = {},
): MeetingReviewGate {
  return {
    id,
    projectId: PROJECT_ID,
    meetingId: MEETING_ID,
    sourceChannelId: SOURCE_CHANNEL,
    targetChannelId: TARGET_CHANNEL,
    targetRole: 'design.ui',
    kind: 'planning_minutes',
    status: 'pending',
    title: `기획 회의록 ${id}`,
    documentPath: `/arena/consensus/meetings/${MEETING_ID}/minutes.md`,
    documentBodySnapshot: '# 회의록 본문\n[합의] 디자인 시작',
    userNote: null,
    payloadJson: null,
    createdAt: NOW,
    decidedAt: null,
    ...overrides,
  };
}

describe('MeetingReviewGateRepository', () => {
  let db: Database.Database;
  let repo: MeetingReviewGateRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db, migrations);

    insertProvider(db, 'pv-1');
    insertProject(db, PROJECT_ID);
    insertChannel(db, SOURCE_CHANNEL, PROJECT_ID);
    insertChannel(db, TARGET_CHANNEL, PROJECT_ID);
    insertMeeting(db, MEETING_ID, SOURCE_CHANNEL);

    repo = new MeetingReviewGateRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  // ── insert + findById ─────────────────────────────────────────────

  it('insert + findById round-trips snake↔camel mapping faithfully', () => {
    const gate = makeGate('g-1', {
      userNote: '검토 의견',
      payloadJson: '{"foo":"bar"}',
      decidedAt: NOW + 50,
      status: 'approved',
    });
    repo.insert(gate);
    expect(repo.findById('g-1')).toEqual(gate);
  });

  it('findById returns null for unknown id', () => {
    expect(repo.findById('does-not-exist')).toBeNull();
  });

  // ── NULL 허용 컬럼 ────────────────────────────────────────────────

  it('insert allows target_channel_id / user_note / payload_json / decided_at as NULL', () => {
    const gate = makeGate('g-nullable', {
      targetChannelId: null,
      targetRole: null,
      userNote: null,
      payloadJson: null,
      decidedAt: null,
    });
    repo.insert(gate);
    const got = repo.findById('g-nullable');
    expect(got?.targetChannelId).toBeNull();
    expect(got?.targetRole).toBeNull();
    expect(got?.userNote).toBeNull();
    expect(got?.payloadJson).toBeNull();
    expect(got?.decidedAt).toBeNull();
  });

  // ── CHECK enum 위반 ───────────────────────────────────────────────

  it('insert rejects unknown kind (CHECK constraint)', () => {
    const broken = makeGate('g-bad-kind', {
      // production 타입은 'planning_minutes' 만 허용하지만 SQL CHECK 도 직접 검증.
      kind: 'design_review' as 'planning_minutes',
    });
    expect(() => repo.insert(broken)).toThrow(/CHECK/i);
  });

  it('insert rejects unknown status (CHECK constraint)', () => {
    const broken = makeGate('g-bad-status', {
      status: 'finalized' as MeetingReviewGateStatus,
    });
    expect(() => repo.insert(broken)).toThrow(/CHECK/i);
  });

  // ── FK 위반 ──────────────────────────────────────────────────────

  it('insert rejects unknown project_id (FK CASCADE)', () => {
    const broken = makeGate('g-fk-project', { projectId: 'p-missing' });
    expect(() => repo.insert(broken)).toThrow(/FOREIGN KEY/i);
  });

  it('insert rejects unknown meeting_id (FK CASCADE)', () => {
    const broken = makeGate('g-fk-meeting', { meetingId: 'meet-missing' });
    expect(() => repo.insert(broken)).toThrow(/FOREIGN KEY/i);
  });

  it('insert rejects unknown source_channel_id (FK CASCADE)', () => {
    const broken = makeGate('g-fk-source', {
      sourceChannelId: 'ch-missing',
    });
    expect(() => repo.insert(broken)).toThrow(/FOREIGN KEY/i);
  });

  it('insert rejects unknown target_channel_id when not NULL (FK SET NULL only applies on delete)', () => {
    const broken = makeGate('g-fk-target', {
      targetChannelId: 'ch-missing',
    });
    expect(() => repo.insert(broken)).toThrow(/FOREIGN KEY/i);
  });

  // ── FK CASCADE (project / meeting / source) + SET NULL (target) ──

  it('deleting project CASCADEs the gate row', () => {
    repo.insert(makeGate('g-cascade-1'));
    db.prepare('DELETE FROM projects WHERE id = ?').run(PROJECT_ID);
    expect(repo.findById('g-cascade-1')).toBeNull();
  });

  it('deleting target channel SET NULLs target_channel_id (gate row stays)', () => {
    repo.insert(makeGate('g-set-null'));
    db.prepare('DELETE FROM channels WHERE id = ?').run(TARGET_CHANNEL);
    const got = repo.findById('g-set-null');
    expect(got).not.toBeNull();
    expect(got?.targetChannelId).toBeNull();
  });

  // ── list — 필터 ──────────────────────────────────────────────────

  it('list with no filter returns ALL rows', () => {
    repo.insert(makeGate('g-1', { createdAt: NOW + 1 }));
    repo.insert(makeGate('g-2', { createdAt: NOW + 2 }));
    expect(repo.list().map((r) => r.id).sort()).toEqual(['g-1', 'g-2']);
  });

  it('list filters by projectId', () => {
    insertProject(db, 'p-2');
    insertChannel(db, 'ch-other', 'p-2');
    insertMeeting(db, 'meet-2', 'ch-other');

    repo.insert(makeGate('g-1', { projectId: PROJECT_ID }));
    repo.insert(
      makeGate('g-2', {
        projectId: 'p-2',
        meetingId: 'meet-2',
        sourceChannelId: 'ch-other',
        targetChannelId: null,
      }),
    );
    const rows = repo.list({ projectId: 'p-2' });
    expect(rows.map((r) => r.id)).toEqual(['g-2']);
  });

  it('list filters by status', () => {
    repo.insert(makeGate('g-pending', { status: 'pending' }));
    repo.insert(
      makeGate('g-approved', {
        status: 'approved',
        decidedAt: NOW + 10,
        createdAt: NOW + 1,
      }),
    );
    expect(
      repo.list({ status: 'approved' }).map((r) => r.id),
    ).toEqual(['g-approved']);
    expect(
      repo.list({ status: 'pending' }).map((r) => r.id),
    ).toEqual(['g-pending']);
  });

  it('list ORDER BY created_at DESC, id ASC', () => {
    repo.insert(makeGate('g-a', { createdAt: NOW + 1 }));
    repo.insert(makeGate('g-b', { createdAt: NOW + 3 }));
    repo.insert(makeGate('g-c', { createdAt: NOW + 2 }));
    // 동률 검증: same createdAt 두 row → id ASC
    repo.insert(makeGate('g-tie-b', { createdAt: NOW + 3 }));
    const ids = repo.list().map((r) => r.id);
    // 가장 위 = createdAt 큰 것 → g-b / g-tie-b 동률은 id ASC ('g-b' < 'g-tie-b'),
    // 다음 NOW+2 = g-c, 마지막 NOW+1 = g-a.
    expect(ids).toEqual(['g-b', 'g-tie-b', 'g-c', 'g-a']);
  });

  // ── updateDecision ───────────────────────────────────────────────

  it('updateDecision on pending row persists status / user_note / decided_at', () => {
    repo.insert(makeGate('g-1'));
    const updated = repo.updateDecision({
      id: 'g-1',
      status: 'approved',
      userNote: '문제 없음',
      decidedAt: NOW + 200,
    });
    expect(updated).not.toBeNull();
    expect(updated?.status).toBe('approved');
    expect(updated?.userNote).toBe('문제 없음');
    expect(updated?.decidedAt).toBe(NOW + 200);
  });

  it('updateDecision returns null when row already decided (status != pending)', () => {
    repo.insert(
      makeGate('g-done', { status: 'approved', decidedAt: NOW + 1 }),
    );
    const result = repo.updateDecision({
      id: 'g-done',
      status: 'stopped',
      userNote: null,
      decidedAt: NOW + 99,
    });
    expect(result).toBeNull();
    // 기존 row 는 그대로 — status / decided_at 갱신 안 됨.
    const after = repo.findById('g-done');
    expect(after?.status).toBe('approved');
    expect(after?.decidedAt).toBe(NOW + 1);
  });

  it('updateDecision returns null for unknown id', () => {
    expect(
      repo.updateDecision({
        id: 'nope',
        status: 'approved',
        userNote: null,
        decidedAt: NOW,
      }),
    ).toBeNull();
  });

  it('updateDecision accepts NULL userNote', () => {
    repo.insert(makeGate('g-1'));
    const updated = repo.updateDecision({
      id: 'g-1',
      status: 'revision_requested',
      userNote: null,
      decidedAt: NOW + 5,
    });
    expect(updated?.userNote).toBeNull();
    expect(updated?.status).toBe('revision_requested');
  });

  // ── withTransaction ──────────────────────────────────────────────

  it('withTransaction rolls back insert when fn throws', () => {
    expect(() =>
      repo.withTransaction(() => {
        repo.insert(makeGate('g-tx-1'));
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(repo.findById('g-tx-1')).toBeNull();
  });

  it('withTransaction commits when fn returns normally', () => {
    const result = repo.withTransaction(() => {
      repo.insert(makeGate('g-tx-2'));
      return 'ok';
    });
    expect(result).toBe('ok');
    expect(repo.findById('g-tx-2')).not.toBeNull();
  });
});
