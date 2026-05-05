/**
 * OpinionRepository 단위 테스트 — opinion + opinion_vote CRUD (R12-C2 P2-2).
 *
 * 검증:
 *   - insert / get round-trip (snake↔camel 매핑)
 *   - listByMeeting / listByChannel — created_at 오름차순
 *   - meetingId NULL 입력 (일반 채널 [##]) 도 listByChannel 로 조회
 *   - updateStatus — 갱신 row 있으면 true / 없으면 false
 *   - countDistinctLabelsByAuthor — distinct authorLabel count
 *   - insertVote / listVotesByOpinion (roundKind 필터)
 *   - listVotesByMeeting (roundKind / round 필터)
 *
 * 기존 meeting-service.test.ts 와 동일 setup 패턴: ArenaRoot 임시 디렉토리 +
 * fresh on-disk SQLite + 마이그레이션 + provider/project/channel/meeting FK seed.
 */

import Database from 'better-sqlite3';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ArenaRootService,
  type ArenaRootConfigAccessor,
} from '../../arena/arena-root-service';
import { runMigrations } from '../../database/migrator';
import { migrations } from '../../database/migrations/index';
import {
  insertChannel,
  insertProject,
  insertProvider,
  NOW,
} from '../../database/__tests__/_helpers';
import { MeetingRepository } from '../meeting-repository';
import { MeetingService } from '../meeting-service';
import type { Opinion, OpinionVote } from '../../../shared/opinion-types';
import { OpinionRepository } from '../opinion-repository';

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

function makeOpinion(
  id: string,
  overrides: Partial<Opinion> = {},
): Opinion {
  return {
    id,
    parentId: null,
    meetingId: null,
    channelId: 'ch-1',
    kind: 'root',
    authorProviderId: 'pv-codex',
    authorLabel: 'codex_1',
    title: `op-${id}`,
    content: `content-${id}`,
    rationale: `r-${id}`,
    status: 'pending',
    exclusionReason: null,
    round: 0,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeVote(
  id: string,
  targetId: string,
  overrides: Partial<OpinionVote> = {},
): OpinionVote {
  return {
    id,
    targetId,
    voterProviderId: 'pv-claude',
    vote: 'agree',
    comment: null,
    round: 0,
    roundKind: 'quick_vote',
    createdAt: NOW,
    ...overrides,
  };
}

describe('OpinionRepository', () => {
  let arenaRoot: string;
  let db: Database.Database;
  let repo: OpinionRepository;
  let meetingId: string;
  const channelId = 'ch-1';

  beforeEach(async () => {
    arenaRoot = makeTmpDir('rolestra-opinion-repo-');
    const arenaSvc = new ArenaRootService(createConfigStub(arenaRoot));
    await arenaSvc.ensure();
    db = new Database(arenaSvc.dbPath());
    db.pragma('foreign_keys = ON');
    runMigrations(db, migrations);

    // FK seeds — provider / project / channel / meeting.
    insertProvider(db, 'pv-codex');
    insertProvider(db, 'pv-claude');
    insertProvider(db, 'pv-gemini');
    insertProject(db, 'p-1');
    insertChannel(db, channelId, 'p-1');
    const meeting = new MeetingService(new MeetingRepository(db)).start({
      channelId,
      topic: 'opinion repo test',
    });
    meetingId = meeting.id;

    repo = new OpinionRepository(db);
  });

  afterEach(() => {
    db.close();
    cleanupDir(arenaRoot);
  });

  // ── insert + get ────────────────────────────────────────────────

  it('insert + get round-trips snake↔camel mapping faithfully', () => {
    const op = makeOpinion('op-1', { meetingId, round: 3 });
    repo.insert(op);
    expect(repo.get('op-1')).toEqual(op);
  });

  it('get returns null for unknown id', () => {
    expect(repo.get('does-not-exist')).toBeNull();
  });

  it('insert allows meeting_id NULL (general channel [##] card)', () => {
    const op = makeOpinion('op-general', {
      meetingId: null,
      kind: 'self-raised',
    });
    repo.insert(op);
    const got = repo.get('op-general');
    expect(got?.meetingId).toBeNull();
    expect(got?.kind).toBe('self-raised');
  });

  // ── listByMeeting / listByChannel ───────────────────────────────

  it('listByMeeting returns rows in created_at ASC order', () => {
    repo.insert(makeOpinion('a', { meetingId, createdAt: NOW + 3 }));
    repo.insert(makeOpinion('b', { meetingId, createdAt: NOW + 1 }));
    repo.insert(makeOpinion('c', { meetingId, createdAt: NOW + 2 }));
    const rows = repo.listByMeeting(meetingId);
    expect(rows.map((r) => r.id)).toEqual(['b', 'c', 'a']);
  });

  it('listByChannel returns ALL rows (meeting + general)', () => {
    repo.insert(makeOpinion('m1', { meetingId, createdAt: NOW + 1 }));
    repo.insert(
      makeOpinion('g1', {
        meetingId: null,
        kind: 'user-raised',
        createdAt: NOW + 2,
      }),
    );
    const rows = repo.listByChannel(channelId);
    expect(rows.map((r) => r.id).sort()).toEqual(['g1', 'm1']);
  });

  // ── updateStatus ────────────────────────────────────────────────

  it('updateStatus returns true and persists status + exclusion_reason + updated_at', () => {
    repo.insert(makeOpinion('a', { meetingId }));
    const ok = repo.updateStatus('a', 'rejected', '중복 의견', NOW + 100);
    expect(ok).toBe(true);
    const got = repo.get('a');
    expect(got?.status).toBe('rejected');
    expect(got?.exclusionReason).toBe('중복 의견');
    expect(got?.updatedAt).toBe(NOW + 100);
  });

  it('updateStatus returns false when id is unknown', () => {
    expect(repo.updateStatus('nope', 'agreed', null, NOW)).toBe(false);
  });

  // ── countDistinctLabelsByAuthor ─────────────────────────────────

  it('countDistinctLabelsByAuthor counts unique labels for the same provider', () => {
    repo.insert(
      makeOpinion('a', { meetingId, authorLabel: 'codex_1', createdAt: NOW }),
    );
    repo.insert(
      makeOpinion('b', { meetingId, authorLabel: 'codex_1', createdAt: NOW + 1 }),
    );
    repo.insert(
      makeOpinion('c', { meetingId, authorLabel: 'codex_2', createdAt: NOW + 2 }),
    );
    repo.insert(
      makeOpinion('d', {
        meetingId,
        authorProviderId: 'pv-claude',
        authorLabel: 'claude_1',
        createdAt: NOW + 3,
      }),
    );
    expect(repo.countDistinctLabelsByAuthor(meetingId, 'pv-codex')).toBe(2);
    expect(repo.countDistinctLabelsByAuthor(meetingId, 'pv-claude')).toBe(1);
    expect(repo.countDistinctLabelsByAuthor(meetingId, 'pv-gemini')).toBe(0);
  });

  // ── insertVote + listVotesByOpinion ─────────────────────────────

  it('insertVote + listVotesByOpinion round-trip (no round_kind filter)', () => {
    repo.insert(makeOpinion('op', { meetingId }));
    const v1 = makeVote('v1', 'op', { vote: 'agree', roundKind: 'quick_vote' });
    const v2 = makeVote('v2', 'op', {
      vote: 'oppose',
      roundKind: 'free_discussion',
      voterProviderId: 'pv-gemini',
      createdAt: NOW + 1,
    });
    repo.insertVote(v1);
    repo.insertVote(v2);
    expect(repo.listVotesByOpinion('op')).toEqual([v1, v2]);
  });

  it('listVotesByOpinion filters by roundKind', () => {
    repo.insert(makeOpinion('op', { meetingId }));
    repo.insertVote(makeVote('v1', 'op', { roundKind: 'quick_vote' }));
    repo.insertVote(
      makeVote('v2', 'op', { roundKind: 'free_discussion', createdAt: NOW + 1 }),
    );
    expect(repo.listVotesByOpinion('op', 'quick_vote').map((v) => v.id)).toEqual(
      ['v1'],
    );
    expect(
      repo.listVotesByOpinion('op', 'free_discussion').map((v) => v.id),
    ).toEqual(['v2']);
  });

  // ── listVotesByMeeting ──────────────────────────────────────────

  it('listVotesByMeeting joins through opinion → meeting + filters by round/roundKind', () => {
    repo.insert(makeOpinion('op-a', { meetingId, createdAt: NOW }));
    repo.insert(makeOpinion('op-b', { meetingId, createdAt: NOW + 1 }));
    repo.insertVote(makeVote('v1', 'op-a', { round: 0, roundKind: 'quick_vote' }));
    repo.insertVote(
      makeVote('v2', 'op-b', {
        round: 1,
        roundKind: 'free_discussion',
        createdAt: NOW + 2,
      }),
    );
    expect(repo.listVotesByMeeting(meetingId).map((v) => v.id).sort()).toEqual(
      ['v1', 'v2'],
    );
    expect(
      repo
        .listVotesByMeeting(meetingId, { roundKind: 'free_discussion' })
        .map((v) => v.id),
    ).toEqual(['v2']);
    expect(
      repo.listVotesByMeeting(meetingId, { round: 0 }).map((v) => v.id),
    ).toEqual(['v1']);
  });
});
