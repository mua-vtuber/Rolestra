/**
 * RunStepAggregator 단위 테스트 — H1 dashboard 진행률 패널 데이터 source
 * (R12-C2 P3 T19). spec §11.21 acceptance.
 *
 * 검증 매트릭스:
 *   - status 4 종 결정 (idle / in-meeting / handoff-pending / done)
 *   - role=null 채널 제외 (system / DM / legacy user)
 *   - step_kind 분포 (10 enum 모두 포함, 0 디폴트 명시)
 *   - currentRound = MAX(round) of activeMeeting's RunStep rows
 *   - maxRounds = channels.max_rounds 그대로 (NULL 보존)
 *   - 정렬: ALL_ROLE_IDS 카탈로그 순서 + 같은 role 안 channels.created_at ASC
 *   - 비어 있는 프로젝트 (departments=[]) safe
 */

import Database from 'better-sqlite3';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ArenaRootService,
  type ArenaRootConfigAccessor,
} from '../../../arena/arena-root-service';
import { ChannelRepository } from '../../../channels/channel-repository';
import { runMigrations } from '../../../database/migrator';
import { migrations } from '../../../database/migrations/index';
import {
  insertChannel,
  insertProject,
  insertProvider,
} from '../../../database/__tests__/_helpers';
import { MeetingRepository } from '../../meeting-repository';
import { MeetingService } from '../../meeting-service';
import { OpinionRepository } from '../../opinion-repository';
import { OpinionService } from '../../opinion-service';
import { RunStepRepository } from '../run-step-repository';
import { RunStepService } from '../run-step-service';
import { RunStepAggregator } from '../run-step-aggregator';
import type { NewRunStep } from '../../../../shared/run-step-types';
import type { RoleId } from '../../../../shared/role-types';

function makeTmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
function cleanupDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}
function createConfigStub(arenaRoot: string): ArenaRootConfigAccessor {
  const state = { arenaRoot };
  return {
    getSettings: () => state,
    updateSettings: (patch: { arenaRoot?: string }) => {
      if (patch.arenaRoot !== undefined) state.arenaRoot = patch.arenaRoot;
    },
  };
}

/**
 * insertChannel 의 역할(role) / max_rounds 미지원 — migration 018+019 가
 * 컬럼은 추가했지만 insertChannel helper 는 role=NULL / max_rounds=NULL 로
 * 만든다. aggregator 테스트는 role 매핑이 필수라 직접 ALTER 한다.
 */
function setChannelRole(
  db: Database.Database,
  channelId: string,
  role: RoleId | null,
  maxRounds: number | null,
): void {
  db.prepare('UPDATE channels SET role = ?, max_rounds = ? WHERE id = ?').run(
    role,
    maxRounds,
    channelId,
  );
}

describe('RunStepAggregator', () => {
  let arenaRoot: string;
  let db: Database.Database;
  let channelRepo: ChannelRepository;
  let meetingRepo: MeetingRepository;
  let meetingService: MeetingService;
  let runStepRepo: RunStepRepository;
  let runStepService: RunStepService;
  let opinionRepo: OpinionRepository;
  let opinionService: OpinionService;
  let aggregator: RunStepAggregator;

  const projectId = 'p-1';
  const otherProjectId = 'p-other';
  const providerId = 'pv-codex';

  beforeEach(async () => {
    arenaRoot = makeTmpDir('rolestra-run-step-agg-');
    const arenaSvc = new ArenaRootService(createConfigStub(arenaRoot));
    await arenaSvc.ensure();
    db = new Database(arenaSvc.dbPath());
    db.pragma('foreign_keys = ON');
    runMigrations(db, migrations);

    insertProvider(db, providerId);
    insertProject(db, projectId);
    insertProject(db, otherProjectId);

    channelRepo = new ChannelRepository(db);
    meetingRepo = new MeetingRepository(db);
    meetingService = new MeetingService(meetingRepo);
    runStepRepo = new RunStepRepository(db);
    runStepService = new RunStepService(runStepRepo);
    opinionRepo = new OpinionRepository(db);
    opinionService = new OpinionService(opinionRepo);
    aggregator = new RunStepAggregator(
      channelRepo,
      meetingRepo,
      runStepRepo,
      opinionRepo,
    );
  });

  afterEach(() => {
    db.close();
    cleanupDir(arenaRoot);
  });

  function makeStep(overrides: Partial<NewRunStep>): NewRunStep {
    return {
      meetingId: 'override-me',
      channelId: 'override-me',
      round: 0,
      turnIndex: 0,
      actorKind: 'employee',
      actorId: providerId,
      stepKind: 'opinion_gather',
      inputJson: '{}',
      outputJson: '{}',
      nextStepCard: null,
      sideEffectSummary: null,
      durationMs: 100,
      ...overrides,
    };
  }

  // ── empty project ─────────────────────────────────────────────────────

  it('returns empty departments + current timestamp for project with no channels', () => {
    const before = Date.now();
    const snap = aggregator.getProgressSnapshot(projectId);
    expect(snap.projectId).toBe(projectId);
    expect(snap.departments).toEqual([]);
    expect(snap.generatedAt).toBeGreaterThanOrEqual(before);
  });

  it('returns empty departments for unknown projectId (silent fallback OK — domain valid)', () => {
    const snap = aggregator.getProgressSnapshot('does-not-exist');
    expect(snap.departments).toEqual([]);
  });

  // ── role=null 채널 제외 ────────────────────────────────────────────────

  it('excludes channels with role=null (system / legacy user)', () => {
    insertChannel(db, 'ch-system', projectId, 'system_general');
    insertChannel(db, 'ch-legacy', projectId, 'user');
    // role=null 두 채널 모두 → snapshot 에 0 row.
    const snap = aggregator.getProgressSnapshot(projectId);
    expect(snap.departments).toEqual([]);
  });

  // ── status 4 종 결정 ──────────────────────────────────────────────────

  describe('status mapping', () => {
    it('status=idle when no active meeting + no RunStep rows', () => {
      insertChannel(db, 'ch-idea', projectId, 'user');
      setChannelRole(db, 'ch-idea', 'idea', 5);

      const snap = aggregator.getProgressSnapshot(projectId);
      expect(snap.departments).toHaveLength(1);
      const dept = snap.departments[0];
      expect(dept?.role).toBe('idea');
      expect(dept?.status).toBe('idle');
      expect(dept?.activeMeetingId).toBeNull();
      expect(dept?.currentRound).toBeNull();
      expect(dept?.maxRounds).toBe(5);
      expect(dept?.totalSteps).toBe(0);
      // 회의 부서는 cardCount=null (잡담 surface 아님).
      expect(dept?.cardCount).toBeNull();
    });

    it('status=in-meeting when active meeting in non-handoff phase', () => {
      insertChannel(db, 'ch-plan', projectId, 'user');
      setChannelRole(db, 'ch-plan', 'planning', 5);
      const meeting = meetingService.start({
        channelId: 'ch-plan',
        topic: 'planning meeting',
      });
      // state defaults to 'gather' on start (T10a 새 phase loop).
      runStepService.appendOne(
        makeStep({
          meetingId: meeting.id,
          channelId: 'ch-plan',
          round: 1,
          stepKind: 'opinion_gather',
        }),
      );

      const snap = aggregator.getProgressSnapshot(projectId);
      const dept = snap.departments[0];
      expect(dept?.status).toBe('in-meeting');
      expect(dept?.activeMeetingId).toBe(meeting.id);
      expect(dept?.currentRound).toBe(1);
    });

    it('status=handoff-pending when active meeting state=handoff', () => {
      insertChannel(db, 'ch-design', projectId, 'user');
      setChannelRole(db, 'ch-design', 'design.ui', 3);
      const meeting = meetingService.start({
        channelId: 'ch-design',
        topic: 'design meeting',
      });
      // 회의 phase 를 'handoff' 로 직접 transition (테스트 우회).
      meetingRepo.updateState(meeting.id, 'handoff', null);

      const snap = aggregator.getProgressSnapshot(projectId);
      const dept = snap.departments[0];
      expect(dept?.status).toBe('handoff-pending');
      expect(dept?.activeMeetingId).toBe(meeting.id);
    });

    it('status=done when no active meeting but past RunStep rows exist', () => {
      insertChannel(db, 'ch-impl', projectId, 'user');
      setChannelRole(db, 'ch-impl', 'implement', null);

      // 회의 시작 → step 영속 → 회의 종료 (ended_at) → 활성 회의 없음.
      const meeting = meetingService.start({
        channelId: 'ch-impl',
        topic: 'impl meeting',
      });
      runStepService.appendOne(
        makeStep({
          meetingId: meeting.id,
          channelId: 'ch-impl',
          round: 1,
          stepKind: 'minutes_compose',
          actorKind: 'moderator',
          actorId: null,
        }),
      );
      meetingRepo.finish(meeting.id, Date.now(), 'accepted', null);

      const snap = aggregator.getProgressSnapshot(projectId);
      const dept = snap.departments[0];
      expect(dept?.status).toBe('done');
      expect(dept?.activeMeetingId).toBeNull();
      expect(dept?.currentRound).toBeNull();
      expect(dept?.totalSteps).toBe(1);
    });
  });

  // ── step_kind 분포 ────────────────────────────────────────────────────

  it('aggregates step_kind counts with 0 default for absent kinds', () => {
    insertChannel(db, 'ch-rev', projectId, 'user');
    setChannelRole(db, 'ch-rev', 'review', 5);
    const meeting = meetingService.start({
      channelId: 'ch-rev',
      topic: 'review meeting',
    });
    runStepService.appendForTurn([
      makeStep({
        meetingId: meeting.id,
        channelId: 'ch-rev',
        round: 1,
        stepKind: 'opinion_gather',
      }),
      makeStep({
        meetingId: meeting.id,
        channelId: 'ch-rev',
        round: 1,
        stepKind: 'opinion_gather',
      }),
      makeStep({
        meetingId: meeting.id,
        channelId: 'ch-rev',
        round: 1,
        stepKind: 'opinion_tally',
        actorKind: 'system',
        actorId: null,
      }),
    ]);

    const snap = aggregator.getProgressSnapshot(projectId);
    const counts = snap.departments[0]?.stepKindCounts;
    expect(counts).toBeDefined();
    expect(counts?.opinion_gather).toBe(2);
    expect(counts?.opinion_tally).toBe(1);
    // 미발생 8 종은 0 명시 (sparse 회피).
    expect(counts?.quick_vote).toBe(0);
    expect(counts?.free_discussion).toBe(0);
    expect(counts?.minutes_compose).toBe(0);
    expect(counts?.next_step_classify).toBe(0);
    expect(counts?.handoff_dispatch).toBe(0);
    expect(counts?.tool_invoke).toBe(0);
    expect(counts?.approval_request).toBe(0);
    expect(counts?.inspector_check).toBe(0);
    expect(snap.departments[0]?.totalSteps).toBe(3);
  });

  // ── currentRound = MAX(round) ──────────────────────────────────────────

  it('currentRound = MAX(round) of active meeting RunStep rows', () => {
    insertChannel(db, 'ch-aud', projectId, 'user');
    setChannelRole(db, 'ch-aud', 'audit', 10);
    const meeting = meetingService.start({
      channelId: 'ch-aud',
      topic: 'audit meeting',
    });
    runStepService.appendForTurn([
      makeStep({
        meetingId: meeting.id,
        channelId: 'ch-aud',
        round: 1,
        turnIndex: 0,
      }),
      makeStep({
        meetingId: meeting.id,
        channelId: 'ch-aud',
        round: 2,
        turnIndex: 1,
      }),
      makeStep({
        meetingId: meeting.id,
        channelId: 'ch-aud',
        round: 3,
        turnIndex: 2,
      }),
    ]);

    const snap = aggregator.getProgressSnapshot(projectId);
    expect(snap.departments[0]?.currentRound).toBe(3);
  });

  it('currentRound=null when active meeting exists but RunStep rows still 0', () => {
    // T22 — 일반 채널 (role='general') 은 회의 X invariant 라 본 시나리오는
    // 다른 회의 부서 (idea) 로 검증. maxRounds=null = 무제한 옵션.
    insertChannel(db, 'ch-idea-fresh', projectId, 'user');
    setChannelRole(db, 'ch-idea-fresh', 'idea', null);
    const meeting = meetingService.start({
      channelId: 'ch-idea-fresh',
      topic: 'idea meeting',
    });
    void meeting;

    const snap = aggregator.getProgressSnapshot(projectId);
    expect(snap.departments[0]?.status).toBe('in-meeting');
    expect(snap.departments[0]?.currentRound).toBeNull();
    expect(snap.departments[0]?.maxRounds).toBeNull();
  });

  // ── 일반 채널 (T22 옵션 C) ────────────────────────────────────────────
  //
  // 일반 채널 = `user role='general'` 잡담방. 회의 X — RunStep 안 적고
  // opinion 카드 카운트만 surface. 전역 #일반 (system_general, projectId
  // NULL) 은 listByProject 가 애초 안 돌려주므로 본 surface 도달 X.
  //
  // 데이터 source:
  //   - opinionService.postFromGeneralChannel (T20 wired) 또는 직접
  //     opinionRepo.insert
  //   - status='chatting' 고정 / activeMeetingId / currentRound = null
  //   - totalSteps=0 / stepKindCounts 모두 0 / cardCount=의견 수

  describe('general channel (T22 option C)', () => {
    it('status=chatting + cardCount=0 when no opinions yet', () => {
      insertChannel(db, 'ch-chat', projectId, 'user');
      setChannelRole(db, 'ch-chat', 'general', null);

      const snap = aggregator.getProgressSnapshot(projectId);
      expect(snap.departments).toHaveLength(1);
      const dept = snap.departments[0];
      expect(dept?.role).toBe('general');
      expect(dept?.status).toBe('chatting');
      expect(dept?.activeMeetingId).toBeNull();
      expect(dept?.currentRound).toBeNull();
      expect(dept?.totalSteps).toBe(0);
      expect(dept?.cardCount).toBe(0);
      // RunStep 안 적으니 모든 step_kind 0.
      expect(dept?.stepKindCounts.opinion_gather).toBe(0);
    });

    it('cardCount tracks opinion rows posted via postFromGeneralChannel', () => {
      insertChannel(db, 'ch-chat', projectId, 'user');
      setChannelRole(db, 'ch-chat', 'general', null);

      // 사용자 1 카드 + 직원 [##본문] 카드 1 → 의견 2 row.
      opinionService.postFromGeneralChannel({
        channelId: 'ch-chat',
        authorProviderId: null,
        parts: [{ title: null, content: '잡담 의견 1' }],
      });
      opinionService.postFromGeneralChannel({
        channelId: 'ch-chat',
        authorProviderId: providerId,
        parts: [{ title: '아이디어', content: '직원 카드 본문' }],
      });

      const snap = aggregator.getProgressSnapshot(projectId);
      expect(snap.departments[0]?.cardCount).toBe(2);
    });

    it('does not append RunStep rows for general channel even if active meeting somehow exists', () => {
      // 일반 채널 회의는 차단되어야 하지만, 만에 하나 RunStep row 가 있더라도
      // aggregator 는 status='chatting' / totalSteps=0 으로 surface (회의
      // 정체성 무시 — 옵션 C 의 invariant).
      insertChannel(db, 'ch-chat', projectId, 'user');
      setChannelRole(db, 'ch-chat', 'general', null);

      const snap = aggregator.getProgressSnapshot(projectId);
      expect(snap.departments[0]?.status).toBe('chatting');
      expect(snap.departments[0]?.totalSteps).toBe(0);
    });

    it('isolates cardCount per channel (two general channels in same project)', () => {
      insertChannel(db, 'ch-chat-a', projectId, 'user', 'chat-a');
      setChannelRole(db, 'ch-chat-a', 'general', null);
      insertChannel(db, 'ch-chat-b', projectId, 'user', 'chat-b');
      setChannelRole(db, 'ch-chat-b', 'general', null);

      opinionService.postFromGeneralChannel({
        channelId: 'ch-chat-a',
        authorProviderId: null,
        parts: [{ title: null, content: 'A 카드' }],
      });
      opinionService.postFromGeneralChannel({
        channelId: 'ch-chat-b',
        authorProviderId: null,
        parts: [{ title: null, content: 'B 카드 1' }],
      });
      opinionService.postFromGeneralChannel({
        channelId: 'ch-chat-b',
        authorProviderId: null,
        parts: [{ title: null, content: 'B 카드 2' }],
      });

      const snap = aggregator.getProgressSnapshot(projectId);
      const a = snap.departments.find((d) => d.channelId === 'ch-chat-a');
      const b = snap.departments.find((d) => d.channelId === 'ch-chat-b');
      expect(a?.cardCount).toBe(1);
      expect(b?.cardCount).toBe(2);
    });
  });

  // ── 정렬 ──────────────────────────────────────────────────────────────

  it('sorts by ALL_ROLE_IDS catalog order', () => {
    // 카탈로그 순서: idea / planning / design.ui / design.ux / design.character /
    // design.background / implement / review / audit / general.
    // 일부러 역순 입력해도 결과는 카탈로그 순서.
    insertChannel(db, 'ch-general', projectId, 'user');
    setChannelRole(db, 'ch-general', 'general', null);
    insertChannel(db, 'ch-implement', projectId, 'user');
    setChannelRole(db, 'ch-implement', 'implement', null);
    insertChannel(db, 'ch-idea', projectId, 'user');
    setChannelRole(db, 'ch-idea', 'idea', null);
    insertChannel(db, 'ch-planning', projectId, 'user');
    setChannelRole(db, 'ch-planning', 'planning', null);

    const snap = aggregator.getProgressSnapshot(projectId);
    expect(snap.departments.map((d) => d.role)).toEqual([
      'idea',
      'planning',
      'implement',
      'general',
    ]);
  });

  it('keeps multiple channels of same role in created_at ASC order', () => {
    // 같은 'idea' role 두 개 — listByProject 가 created_at ASC 로 돌려주므로
    // (insertChannel 이 모두 NOW = 1_700_000_000_000 사용) 삽입 순서 = id 순서.
    insertChannel(db, 'ch-idea-1', projectId, 'user', 'idea-1');
    setChannelRole(db, 'ch-idea-1', 'idea', null);
    insertChannel(db, 'ch-idea-2', projectId, 'user', 'idea-2');
    setChannelRole(db, 'ch-idea-2', 'idea', null);

    const snap = aggregator.getProgressSnapshot(projectId);
    expect(snap.departments.map((d) => d.channelId)).toEqual([
      'ch-idea-1',
      'ch-idea-2',
    ]);
  });

  // ── 프로젝트 격리 ──────────────────────────────────────────────────────

  it('does not leak channels from other projects', () => {
    insertChannel(db, 'ch-a', projectId, 'user');
    setChannelRole(db, 'ch-a', 'idea', null);
    insertChannel(db, 'ch-b', otherProjectId, 'user');
    setChannelRole(db, 'ch-b', 'planning', null);

    const snapA = aggregator.getProgressSnapshot(projectId);
    expect(snapA.departments).toHaveLength(1);
    expect(snapA.departments[0]?.channelId).toBe('ch-a');

    const snapB = aggregator.getProgressSnapshot(otherProjectId);
    expect(snapB.departments).toHaveLength(1);
    expect(snapB.departments[0]?.channelId).toBe('ch-b');
  });
});
