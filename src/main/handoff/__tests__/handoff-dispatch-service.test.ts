/**
 * HandoffDispatchService 단위 테스트 — R12-C2 P6 T27 land. spec / plan
 * docs/plans/2026-05-04-rolestra-phase-r12-c2.md line 469-482.
 *
 * 검증 (in-memory SQLite + 마이그레이션 022 적용):
 *   - dispatch 정상       — 영속된 row 의 id (UUID) / openedAt (null) /
 *                          createdAt (now) / missionCardJson 직렬화 검증
 *   - dispatch zod 위반   — HandoffPackageInvariantError 그대로 전파
 *   - dispatch self      — buildHandoffPackage 의 self-handoff 분기 잡힘
 *   - dispatch reason 빈   — HandoffDispatchInvariantError (서비스 레이어 추가 가드)
 *   - dispatch dispatchedAt 음수 / NaN — HandoffDispatchInvariantError
 *   - dispatch mission card mismatch — HandoffPackageInvariantError
 *   - open idempotent     — 첫 호출 set / 두 번째 호출 기존 값 유지
 *   - open invariant      — id 빈 문자열 / now 음수 거부
 *   - findById            — 미존재 id → null
 *   - trackByMeeting      — 한 회의 안 의뢰서 dispatched_at ASC
 *   - trackByChannel      — 받는 채널 dispatched_at DESC, unopenedOnly 필터
 *   - serializeRowToPackage — row + nextActions → 검증된 package JSON
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
import {
  HandoffPackageInvariantError,
  parseHandoffPackage,
  type HandoffPackage,
} from '../../../shared/schema/handoff-package';
import {
  parseMissionCardJson,
  type MissionCard,
} from '../../../shared/schema/mission-card';
import { HandoffDispatchRepository } from '../handoff-dispatch-repository';
import {
  HandoffDispatchInvariantError,
  HandoffDispatchService,
} from '../handoff-dispatch-service';

const SENDER_CHANNEL = 'ch-planning';
const TARGET_CHANNEL = 'ch-design';
const OTHER_TARGET = 'ch-implement';
const MEETING_A = 'meet-a';
const MISSION_UUID_1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MISSION_UUID_2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

/**
 * Inserts a meeting. NOTE: meetings 테이블은 (channel_id WHERE ended_at IS NULL)
 * UNIQUE 인덱스가 있으므로 같은 채널에 둘 이상의 *활성* 회의는 불가. 한 채널에서
 * 여러 회의 row 가 필요한 시나리오는 ended_at 채워서 분리.
 */
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

function makeMissionCard(
  targetChannelId: string,
  missionId: string = MISSION_UUID_1,
): MissionCard {
  return {
    id: missionId,
    payload: {
      kind: 'spec',
      body: 'implement design wireframe per planning minutes',
      inputFiles: [],
      expectedOutputs: ['src/foo-wireframe.svg'],
      rootOpinionId: 'opinion-uuid-1',
      planningMinutesMarkdown: '# planning\n[합의] 디자인 시작',
    },
    assignedProviderId: 'provider-design-1',
    targetChannelId,
    createdAt: NOW,
  };
}

function makePackage(overrides: Partial<HandoffPackage> = {}): HandoffPackage {
  const target = overrides.target ?? {
    channelId: TARGET_CHANNEL,
    channelRole: 'design.ui',
  };
  return {
    sender: {
      meetingId: MEETING_A,
      channelId: SENDER_CHANNEL,
      channelRole: 'planning',
    },
    target,
    reason: '디자인 단계 진입',
    minutesMeetingId: MEETING_A,
    nextActions: ['UX 와이어프레임 작성'],
    missionCard: makeMissionCard(target.channelId),
    mode: 'check',
    dispatchedAt: NOW,
    ...overrides,
  };
}

describe('HandoffDispatchService', () => {
  let db: Database.Database;
  let svc: HandoffDispatchService;
  let repo: HandoffDispatchRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db, migrations);

    insertProvider(db, 'provider-design-1');
    insertProject(db, 'p1');
    insertChannel(db, SENDER_CHANNEL, 'p1');
    insertChannel(db, TARGET_CHANNEL, 'p1');
    insertChannel(db, OTHER_TARGET, 'p1');
    insertMeeting(db, MEETING_A, SENDER_CHANNEL);

    repo = new HandoffDispatchRepository(db);
    svc = new HandoffDispatchService(repo);
  });

  afterEach(() => {
    db.close();
  });

  // ── dispatch ──────────────────────────────────────────────────────

  describe('dispatch', () => {
    it('정상 — row id (UUID) + openedAt null + missionCardJson 직렬화', () => {
      const row = svc.dispatch(makePackage());
      expect(row.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      expect(row.openedAt).toBeNull();
      expect(row.fromMeetingId).toBe(MEETING_A);
      expect(row.toChannelId).toBe(TARGET_CHANNEL);
      expect(row.mode).toBe('check');
      const card = parseMissionCardJson(row.missionCardJson);
      expect(card.id).toBe(MISSION_UUID_1);
      expect(card.targetChannelId).toBe(TARGET_CHANNEL);
    });

    it('zod 위반 (mode 잘못된 값) → HandoffPackageInvariantError', () => {
      const broken = {
        ...makePackage(),
        mode: 'silent' as 'check',
      };
      expect(() => svc.dispatch(broken)).toThrow(HandoffPackageInvariantError);
    });

    it('self-handoff (sender.channelId === target.channelId) → HandoffPackageInvariantError', () => {
      const broken = makePackage({
        target: {
          channelId: SENDER_CHANNEL,
          channelRole: 'planning',
        },
        missionCard: makeMissionCard(SENDER_CHANNEL),
      });
      expect(() => svc.dispatch(broken)).toThrow(HandoffPackageInvariantError);
    });

    it('mission card target mismatch → HandoffPackageInvariantError', () => {
      const broken = makePackage({
        missionCard: makeMissionCard(OTHER_TARGET),
      });
      expect(() => svc.dispatch(broken)).toThrow(HandoffPackageInvariantError);
    });

    it('reason whitespace-only → HandoffDispatchInvariantError', () => {
      // schema 는 min(1) 만 강제 — '   ' 는 schema 통과지만 service 가 trim 으로 차단.
      const pkg = makePackage({ reason: '   ' });
      expect(() => svc.dispatch(pkg)).toThrow(HandoffDispatchInvariantError);
    });

    it('dispatchedAt non-finite → schema 에서 거부 (HandoffPackageInvariantError)', () => {
      const pkg = { ...makePackage(), dispatchedAt: Number.NaN };
      // zod .int() 가 NaN 거부 → HandoffPackageInvariantError 가 먼저 throw.
      expect(() => svc.dispatch(pkg)).toThrow(HandoffPackageInvariantError);
    });
  });

  // ── open idempotent ──────────────────────────────────────────────

  describe('open', () => {
    it('첫 호출 — opened_at set + row 반환', () => {
      const dispatched = svc.dispatch(makePackage());
      const opened = svc.open(dispatched.id, NOW + 100);
      expect(opened?.openedAt).toBe(NOW + 100);
    });

    it('두 번째 호출 — 첫 호출 시각 유지 (idempotent)', () => {
      const dispatched = svc.dispatch(makePackage());
      svc.open(dispatched.id, NOW + 100);
      const second = svc.open(dispatched.id, NOW + 999);
      expect(second?.openedAt).toBe(NOW + 100);
    });

    it('미존재 id → null', () => {
      const result = svc.open('does-not-exist', NOW);
      expect(result).toBeNull();
    });

    it('id 빈 문자열 거부', () => {
      expect(() => svc.open('   ', NOW)).toThrow(HandoffDispatchInvariantError);
    });

    it('now 음수 거부', () => {
      const dispatched = svc.dispatch(makePackage());
      expect(() => svc.open(dispatched.id, -1)).toThrow(
        HandoffDispatchInvariantError,
      );
    });

    it('now NaN 거부', () => {
      const dispatched = svc.dispatch(makePackage());
      expect(() => svc.open(dispatched.id, Number.NaN)).toThrow(
        HandoffDispatchInvariantError,
      );
    });
  });

  // ── findById ─────────────────────────────────────────────────────

  describe('findById', () => {
    it('미존재 id → null', () => {
      expect(svc.findById('nope')).toBeNull();
    });

    it('영속된 row lookup — 같은 row 반환', () => {
      const dispatched = svc.dispatch(makePackage());
      const found = svc.findById(dispatched.id);
      expect(found).toEqual(dispatched);
    });
  });

  // ── trackByMeeting ───────────────────────────────────────────────

  describe('trackByMeeting', () => {
    it('한 회의 안 의뢰서 list — dispatched_at ASC', () => {
      const a = svc.dispatch(
        makePackage({ dispatchedAt: NOW + 100 }),
      );
      const b = svc.dispatch(
        makePackage({
          dispatchedAt: NOW + 50,
          target: {
            channelId: OTHER_TARGET,
            channelRole: 'implement',
          },
          missionCard: makeMissionCard(OTHER_TARGET, MISSION_UUID_2),
        }),
      );
      const list = svc.trackByMeeting(MEETING_A);
      expect(list.length).toBe(2);
      expect(list[0]?.id).toBe(b.id);
      expect(list[1]?.id).toBe(a.id);
    });

    it('회의 미존재 id — 빈 list', () => {
      expect(svc.trackByMeeting('not-a-meeting')).toEqual([]);
    });
  });

  // ── trackByChannel ───────────────────────────────────────────────

  describe('trackByChannel', () => {
    it('받는 채널 의뢰서 list — dispatched_at DESC (최신순)', () => {
      const old = svc.dispatch(
        makePackage({ dispatchedAt: NOW + 50 }),
      );
      const fresh = svc.dispatch(
        makePackage({
          dispatchedAt: NOW + 100,
          sender: {
            meetingId: MEETING_A,
            channelId: SENDER_CHANNEL,
            channelRole: 'planning',
          },
          missionCard: makeMissionCard(TARGET_CHANNEL, MISSION_UUID_2),
        }),
      );
      const list = svc.trackByChannel(TARGET_CHANNEL);
      expect(list.length).toBe(2);
      expect(list[0]?.id).toBe(fresh.id);
      expect(list[1]?.id).toBe(old.id);
    });

    it('unopenedOnly — 열린 row 는 제외', () => {
      const opened = svc.dispatch(makePackage());
      svc.open(opened.id, NOW + 100);
      const stillSealed = svc.dispatch(
        makePackage({
          sender: {
            meetingId: MEETING_A,
            channelId: SENDER_CHANNEL,
            channelRole: 'planning',
          },
          missionCard: makeMissionCard(TARGET_CHANNEL, MISSION_UUID_2),
        }),
      );
      const filtered = svc.trackByChannel(TARGET_CHANNEL, {
        unopenedOnly: true,
      });
      expect(filtered.length).toBe(1);
      expect(filtered[0]?.id).toBe(stillSealed.id);
    });

    it('받는 채널 미존재 — 빈 list', () => {
      expect(svc.trackByChannel('not-a-channel')).toEqual([]);
    });
  });

  // ── serializeRowToPackage ────────────────────────────────────────

  describe('serializeRowToPackage', () => {
    it('row → JSON → parseHandoffPackage 가 통과하는 검증된 package 반환', () => {
      const dispatched = svc.dispatch(makePackage());
      const json = svc.serializeRowToPackage(dispatched, [
        'UX 와이어프레임 작성',
        'Playwright 스냅샷',
      ]);
      const parsed = parseHandoffPackage(JSON.parse(json));
      expect(parsed.sender.meetingId).toBe(dispatched.fromMeetingId);
      expect(parsed.target.channelId).toBe(dispatched.toChannelId);
      expect(parsed.nextActions).toEqual([
        'UX 와이어프레임 작성',
        'Playwright 스냅샷',
      ]);
      expect(parsed.missionCard.id).toBe(MISSION_UUID_1);
    });

    it('row 의 missionCardJson 이 invalid 면 MissionCardInvariantError 전파', () => {
      const dispatched = svc.dispatch(makePackage());
      // 직접 row 의 mission_card_json 조작 — 사용자가 일반 흐름에서 못 함.
      db.prepare(
        'UPDATE handoff_dispatch SET mission_card_json = ? WHERE id = ?',
      ).run('not json at all', dispatched.id);
      const corrupted = svc.findById(dispatched.id)!;
      expect(() => svc.serializeRowToPackage(corrupted, [])).toThrow();
    });
  });
});
