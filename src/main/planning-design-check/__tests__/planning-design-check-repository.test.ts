/**
 * PlanningDesignCheckRepository 단위 테스트 — R12-C2 P6 card review flow.
 *
 * 검증 (in-memory SQLite + 마이그레이션 026 + 027 적용):
 *   - insert / findById round-trip (snake↔camel 매핑 통째)
 *   - listByProject — created_at DESC, id ASC 정렬
 *   - countReturnedToDesign — work_bundle_key 4-tuple 분리 (project / bundle /
 *     status / user_decision) + null/whitespace bundle key → 0
 *   - findByDesignReturnDispatchId — LIMIT 1 + 미존재 → null
 *   - updateResult — status / verdict / reason / revisionDirection / returnCount
 *     / payloadJson / decidedAt 한 번에 갱신 + 미존재 id → null
 *   - setImplementationDispatchId / setDesignReturnDispatchId — partial update +
 *     미존재 id → null
 *   - recordUserDecision — user_decision + note + dispatch + decidedAt 갱신 +
 *     미존재 id → null
 *   - withTransaction — 콜백 throw 시 전체 rollback
 *   - CHECK 위반: status 미정의 값 / verdict 미정의 값 / user_decision 미정의 값
 *     / return_count 음수 모두 throw
 *   - FK CASCADE: project 삭제 시 row 삭제 / meeting 삭제 시 row 삭제 /
 *     design_channel 삭제 시 row 삭제 / planning_channel 삭제 시 row 삭제
 *   - FK SET NULL: implementation_channel 삭제 시 implementationChannelId NULL
 *   - NULL 컬럼 허용 — verdict / user_decision / payload_json / decided_at 등
 *     모두 NULL 로 삽입 가능
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
  PlanningDesignCheckRecord,
  PlanningDesignCheckStatus,
  PlanningDesignCheckUserDecision,
  PlanningDesignCheckVerdict,
} from '../../../shared/planning-design-check-types';
import { PlanningDesignCheckRepository } from '../planning-design-check-repository';

const PROJECT_ID = 'p1';
const MEETING_ID = 'meet-design-1';
const DESIGN_CHANNEL = 'ch-design';
const PLANNING_CHANNEL = 'ch-planning';
const IMPL_CHANNEL = 'ch-implement';

function insertMeeting(
  db: Database.Database,
  id: string,
  channelId: string,
  endedAt: number | null = NOW + 10_000,
): void {
  db.prepare(
    `INSERT INTO meetings (id, channel_id, state, started_at, ended_at)
     VALUES (?, ?, 'ended', ?, ?)`,
  ).run(id, channelId, NOW, endedAt);
}

function makeRecord(
  id: string,
  overrides: Partial<PlanningDesignCheckRecord> = {},
): PlanningDesignCheckRecord {
  return {
    id,
    projectId: PROJECT_ID,
    sourceDesignMeetingId: MEETING_ID,
    designChannelId: DESIGN_CHANNEL,
    designChannelRole: 'design.ui',
    planningChannelId: PLANNING_CHANNEL,
    implementationChannelId: IMPL_CHANNEL,
    requestTitle: `request-${id}`,
    requestBody: `body-${id}`,
    finalDesignMinutesPath: `/arena/consensus/${MEETING_ID}/minutes-2.md`,
    finalDesignMinutesBody: '# final design',
    snapshotDesktopPath: '/arena/snapshots/desktop.png',
    snapshotMobilePath: '/arena/snapshots/mobile.png',
    wireframeCheckpointsJson: '[]',
    wireframeUserNotesJson: '[]',
    workBundleKey: 'planning-minutes:planning-1',
    originalPlanningMinutesId: 'planning-1',
    originalPlanningMinutesPath: '/arena/consensus/planning-1/minutes.md',
    originalPlanningMinutesBody: '# original planning',
    originalPlanningMinutesMissingReason: null,
    returnCount: 0,
    verdict: null,
    status: 'request_created',
    reason: null,
    revisionDirection: null,
    implementationDispatchId: null,
    designReturnDispatchId: null,
    userDecision: null,
    userDecisionNote: null,
    userDecisionDispatchId: null,
    payloadJson: null,
    createdAt: NOW,
    decidedAt: null,
    ...overrides,
  };
}

describe('PlanningDesignCheckRepository', () => {
  let db: Database.Database;
  let repo: PlanningDesignCheckRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db, migrations);

    insertProvider(db, 'provider-design');
    insertProject(db, PROJECT_ID);
    insertChannel(db, DESIGN_CHANNEL, PROJECT_ID);
    insertChannel(db, PLANNING_CHANNEL, PROJECT_ID);
    insertChannel(db, IMPL_CHANNEL, PROJECT_ID);
    insertMeeting(db, MEETING_ID, DESIGN_CHANNEL);

    repo = new PlanningDesignCheckRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  // ── insert / findById round-trip ────────────────────────────────────

  describe('insert + findById', () => {
    it('전체 컬럼 round-trip — snake↔camel 매핑 통째 보존', () => {
      const record = makeRecord('chk-1', {
        verdict: 'aligned',
        status: 'aligned',
        reason: '합의됨',
        revisionDirection: null,
        returnCount: 2,
        payloadJson: '{"foo":"bar"}',
        decidedAt: NOW + 500,
      });
      repo.insert(record);
      const found = repo.findById('chk-1');
      expect(found).toEqual(record);
    });

    it('미존재 id → null', () => {
      expect(repo.findById('nope')).toBeNull();
    });

    it('NULL 컬럼 허용 — verdict / user_decision / payload_json / decided_at 등 NULL', () => {
      const record = makeRecord('chk-null', {
        snapshotDesktopPath: null,
        snapshotMobilePath: null,
        workBundleKey: null,
        originalPlanningMinutesId: null,
        originalPlanningMinutesPath: null,
        originalPlanningMinutesBody: null,
        originalPlanningMinutesMissingReason: '회의록 미생성',
        implementationChannelId: null,
      });
      repo.insert(record);
      const found = repo.findById('chk-null');
      expect(found?.verdict).toBeNull();
      expect(found?.userDecision).toBeNull();
      expect(found?.payloadJson).toBeNull();
      expect(found?.decidedAt).toBeNull();
      expect(found?.workBundleKey).toBeNull();
      expect(found?.implementationChannelId).toBeNull();
    });
  });

  // ── listByProject ───────────────────────────────────────────────────

  describe('listByProject', () => {
    it('createdAt DESC + id ASC tie-break', () => {
      repo.insert(makeRecord('chk-old', { createdAt: NOW + 100 }));
      repo.insert(makeRecord('chk-new-b', { createdAt: NOW + 200 }));
      repo.insert(makeRecord('chk-new-a', { createdAt: NOW + 200 }));
      const list = repo.listByProject(PROJECT_ID);
      expect(list.map((r) => r.id)).toEqual([
        'chk-new-a',
        'chk-new-b',
        'chk-old',
      ]);
    });

    it('다른 projectId 는 제외', () => {
      insertProject(db, 'p2');
      insertChannel(db, 'ch-design-p2', 'p2');
      insertChannel(db, 'ch-planning-p2', 'p2');
      insertMeeting(db, 'meet-p2', 'ch-design-p2');
      repo.insert(makeRecord('chk-mine'));
      repo.insert(
        makeRecord('chk-other', {
          projectId: 'p2',
          sourceDesignMeetingId: 'meet-p2',
          designChannelId: 'ch-design-p2',
          planningChannelId: 'ch-planning-p2',
          implementationChannelId: null,
        }),
      );
      const list = repo.listByProject(PROJECT_ID);
      expect(list.map((r) => r.id)).toEqual(['chk-mine']);
    });

    it('빈 결과 → 빈 list', () => {
      expect(repo.listByProject('nonexistent')).toEqual([]);
    });
  });

  // ── countReturnedToDesign — work_bundle_key 4-tuple lookup ──────────

  describe('countReturnedToDesign', () => {
    it('동일 work_bundle_key 의 returned_to_design 만 카운트', () => {
      repo.insert(
        makeRecord('chk-a', {
          workBundleKey: 'bundle-X',
          status: 'returned_to_design',
        }),
      );
      repo.insert(
        makeRecord('chk-b', {
          workBundleKey: 'bundle-X',
          status: 'aligned',
        }),
      );
      repo.insert(
        makeRecord('chk-c', {
          workBundleKey: 'bundle-Y',
          status: 'returned_to_design',
        }),
      );
      const count = repo.countReturnedToDesign({
        projectId: PROJECT_ID,
        workBundleKey: 'bundle-X',
      });
      expect(count).toBe(1);
    });

    it('user_decision = request_design_revision 도 카운트', () => {
      repo.insert(
        makeRecord('chk-r1', {
          workBundleKey: 'bundle-R',
          status: 'needs_user_decision',
          userDecision: 'request_design_revision',
        }),
      );
      repo.insert(
        makeRecord('chk-r2', {
          workBundleKey: 'bundle-R',
          status: 'returned_to_design',
        }),
      );
      const count = repo.countReturnedToDesign({
        projectId: PROJECT_ID,
        workBundleKey: 'bundle-R',
      });
      expect(count).toBe(2);
    });

    it('workBundleKey null → 0 (silent)', () => {
      repo.insert(
        makeRecord('chk-z', {
          workBundleKey: null,
          status: 'returned_to_design',
        }),
      );
      const count = repo.countReturnedToDesign({
        projectId: PROJECT_ID,
        workBundleKey: null,
      });
      expect(count).toBe(0);
    });

    it('workBundleKey whitespace-only → 0', () => {
      const count = repo.countReturnedToDesign({
        projectId: PROJECT_ID,
        workBundleKey: '   ',
      });
      expect(count).toBe(0);
    });

    it('다른 projectId 는 제외 — 4-tuple 분리', () => {
      insertProject(db, 'p2');
      insertChannel(db, 'ch-design-p2', 'p2');
      insertChannel(db, 'ch-planning-p2', 'p2');
      insertMeeting(db, 'meet-p2', 'ch-design-p2');
      repo.insert(
        makeRecord('chk-mine', {
          workBundleKey: 'bundle-SHARED',
          status: 'returned_to_design',
        }),
      );
      repo.insert(
        makeRecord('chk-other', {
          projectId: 'p2',
          sourceDesignMeetingId: 'meet-p2',
          designChannelId: 'ch-design-p2',
          planningChannelId: 'ch-planning-p2',
          implementationChannelId: null,
          workBundleKey: 'bundle-SHARED',
          status: 'returned_to_design',
        }),
      );
      const count = repo.countReturnedToDesign({
        projectId: PROJECT_ID,
        workBundleKey: 'bundle-SHARED',
      });
      expect(count).toBe(1);
    });
  });

  // ── findByDesignReturnDispatchId ────────────────────────────────────

  describe('findByDesignReturnDispatchId', () => {
    it('영속된 dispatchId lookup', () => {
      repo.insert(
        makeRecord('chk-d1', { designReturnDispatchId: 'dispatch-XYZ' }),
      );
      const found = repo.findByDesignReturnDispatchId('dispatch-XYZ');
      expect(found?.id).toBe('chk-d1');
    });

    it('미존재 dispatchId → null', () => {
      expect(repo.findByDesignReturnDispatchId('does-not-exist')).toBeNull();
    });

    it('LIMIT 1 — 같은 dispatchId 가 둘이면 createdAt DESC 첫 row', () => {
      repo.insert(
        makeRecord('chk-old', {
          designReturnDispatchId: 'dispatch-DUP',
          createdAt: NOW + 100,
        }),
      );
      repo.insert(
        makeRecord('chk-new', {
          designReturnDispatchId: 'dispatch-DUP',
          createdAt: NOW + 200,
        }),
      );
      const found = repo.findByDesignReturnDispatchId('dispatch-DUP');
      expect(found?.id).toBe('chk-new');
    });
  });

  // ── updateResult ────────────────────────────────────────────────────

  describe('updateResult', () => {
    it('전 필드 갱신 + 갱신된 record 반환', () => {
      repo.insert(makeRecord('chk-u1'));
      const updated = repo.updateResult({
        id: 'chk-u1',
        status: 'aligned',
        verdict: 'aligned',
        reason: '검수 통과',
        revisionDirection: null,
        returnCount: 1,
        payloadJson: '{"verdict":"aligned"}',
        decidedAt: NOW + 999,
      });
      expect(updated?.status).toBe('aligned');
      expect(updated?.verdict).toBe('aligned');
      expect(updated?.reason).toBe('검수 통과');
      expect(updated?.returnCount).toBe(1);
      expect(updated?.payloadJson).toBe('{"verdict":"aligned"}');
      expect(updated?.decidedAt).toBe(NOW + 999);
    });

    it('미존재 id → null', () => {
      const updated = repo.updateResult({
        id: 'nope',
        status: 'aligned',
        verdict: 'aligned',
        reason: null,
        revisionDirection: null,
        returnCount: 0,
        payloadJson: null,
        decidedAt: NOW,
      });
      expect(updated).toBeNull();
    });
  });

  // ── setImplementationDispatchId / setDesignReturnDispatchId ─────────

  describe('setImplementationDispatchId', () => {
    it('dispatchId 갱신 + 갱신된 record 반환', () => {
      repo.insert(makeRecord('chk-i1'));
      const updated = repo.setImplementationDispatchId('chk-i1', 'dispatch-IMPL');
      expect(updated?.implementationDispatchId).toBe('dispatch-IMPL');
    });

    it('미존재 id → null', () => {
      expect(
        repo.setImplementationDispatchId('nope', 'dispatch-X'),
      ).toBeNull();
    });
  });

  describe('setDesignReturnDispatchId', () => {
    it('dispatchId 갱신 + 갱신된 record 반환', () => {
      repo.insert(makeRecord('chk-r1'));
      const updated = repo.setDesignReturnDispatchId('chk-r1', 'dispatch-RET');
      expect(updated?.designReturnDispatchId).toBe('dispatch-RET');
    });

    it('미존재 id → null', () => {
      expect(
        repo.setDesignReturnDispatchId('nope', 'dispatch-X'),
      ).toBeNull();
    });
  });

  // ── recordUserDecision ──────────────────────────────────────────────

  describe('recordUserDecision', () => {
    it('user_decision + note + dispatch + decidedAt 갱신', () => {
      repo.insert(
        makeRecord('chk-ud', { status: 'needs_user_decision' }),
      );
      const updated = repo.recordUserDecision({
        id: 'chk-ud',
        userDecision: 'send_to_implementation',
        userDecisionNote: '구현 진행',
        dispatchId: 'dispatch-impl',
        decidedAt: NOW + 1000,
      });
      expect(updated?.userDecision).toBe('send_to_implementation');
      expect(updated?.userDecisionNote).toBe('구현 진행');
      expect(updated?.userDecisionDispatchId).toBe('dispatch-impl');
      expect(updated?.decidedAt).toBe(NOW + 1000);
    });

    it('dispatchId null + note null 허용', () => {
      repo.insert(
        makeRecord('chk-ud2', { status: 'needs_user_decision' }),
      );
      const updated = repo.recordUserDecision({
        id: 'chk-ud2',
        userDecision: 'stop',
        userDecisionNote: null,
        dispatchId: null,
        decidedAt: NOW + 1234,
      });
      expect(updated?.userDecision).toBe('stop');
      expect(updated?.userDecisionNote).toBeNull();
      expect(updated?.userDecisionDispatchId).toBeNull();
    });

    it('미존재 id → null', () => {
      const updated = repo.recordUserDecision({
        id: 'nope',
        userDecision: 'stop',
        userDecisionNote: null,
        dispatchId: null,
        decidedAt: NOW,
      });
      expect(updated).toBeNull();
    });
  });

  // ── withTransaction ─────────────────────────────────────────────────

  describe('withTransaction', () => {
    it('콜백 throw 시 insert rollback', () => {
      expect(() =>
        repo.withTransaction(() => {
          repo.insert(makeRecord('chk-tx-1'));
          repo.insert(makeRecord('chk-tx-2'));
          throw new Error('boom');
        }),
      ).toThrow('boom');
      expect(repo.findById('chk-tx-1')).toBeNull();
      expect(repo.findById('chk-tx-2')).toBeNull();
    });

    it('정상 종료 시 모든 insert 영속', () => {
      repo.withTransaction(() => {
        repo.insert(makeRecord('chk-tx-ok-1'));
        repo.insert(makeRecord('chk-tx-ok-2'));
      });
      expect(repo.findById('chk-tx-ok-1')).not.toBeNull();
      expect(repo.findById('chk-tx-ok-2')).not.toBeNull();
    });
  });

  // ── CHECK 제약 ─────────────────────────────────────────────────────

  describe('CHECK 제약', () => {
    it('status 미정의 값 거부', () => {
      const record = makeRecord('chk-bad-status', {
        status: 'totally-invalid' as PlanningDesignCheckStatus,
      });
      expect(() => repo.insert(record)).toThrow();
    });

    it('verdict 미정의 값 거부', () => {
      const record = makeRecord('chk-bad-verdict', {
        verdict: 'totally-invalid' as PlanningDesignCheckVerdict,
      });
      expect(() => repo.insert(record)).toThrow();
    });

    it('user_decision 미정의 값 거부', () => {
      const record = makeRecord('chk-bad-decision', {
        userDecision: 'totally-invalid' as PlanningDesignCheckUserDecision,
      });
      expect(() => repo.insert(record)).toThrow();
    });

    it('return_count 음수 거부', () => {
      const record = makeRecord('chk-bad-count', { returnCount: -1 });
      expect(() => repo.insert(record)).toThrow();
    });
  });

  // ── FK CASCADE / SET NULL ──────────────────────────────────────────

  describe('FK 동작', () => {
    it('project 삭제 시 row CASCADE', () => {
      repo.insert(makeRecord('chk-fk-prj'));
      db.prepare('DELETE FROM projects WHERE id = ?').run(PROJECT_ID);
      expect(repo.findById('chk-fk-prj')).toBeNull();
    });

    it('source_design_meeting 삭제 시 row CASCADE', () => {
      repo.insert(makeRecord('chk-fk-meet'));
      db.prepare('DELETE FROM meetings WHERE id = ?').run(MEETING_ID);
      expect(repo.findById('chk-fk-meet')).toBeNull();
    });

    it('design_channel 삭제 시 row CASCADE', () => {
      // 회의가 먼저 채널을 참조하므로 회의도 같이 사라짐 → 어느 쪽 CASCADE 든
      // row 가 사라지는 게 invariant.
      repo.insert(makeRecord('chk-fk-design'));
      db.prepare('DELETE FROM channels WHERE id = ?').run(DESIGN_CHANNEL);
      expect(repo.findById('chk-fk-design')).toBeNull();
    });

    it('planning_channel 삭제 시 row CASCADE', () => {
      repo.insert(makeRecord('chk-fk-planning'));
      db.prepare('DELETE FROM channels WHERE id = ?').run(PLANNING_CHANNEL);
      expect(repo.findById('chk-fk-planning')).toBeNull();
    });

    it('implementation_channel 삭제 시 implementationChannelId SET NULL', () => {
      repo.insert(makeRecord('chk-fk-impl'));
      db.prepare('DELETE FROM channels WHERE id = ?').run(IMPL_CHANNEL);
      const found = repo.findById('chk-fk-impl');
      expect(found).not.toBeNull();
      expect(found?.implementationChannelId).toBeNull();
    });
  });
});
