/**
 * OpinionService 단위 테스트 — gather / tally / quickVote / freeDiscussionRound
 * (R12-C2 P2-2). spec §11.18.2~§11.18.5 acceptance + edge cases.
 *
 * 검증:
 *   - gather: opinions 배열 → opinion row N 개 (kind='root', status='pending')
 *   - gather: 빈 opinions 응답도 허용 (insert 0)
 *   - tally: 화면 ID 부여 (ITEM_001 / ITEM_001_01 / ITEM_001_01_01) + screen↔UUID 매핑
 *   - quickVote: 만장일치 → status='agreed' 즉시 갱신 + agreed[] 포함
 *   - quickVote: 비만장일치 (agree + oppose) → status='pending' 유지 + unresolved[]
 *   - quickVote: 한 표도 못 받은 root → unresolved[]
 *   - quickVote: 잘못된 화면 ID → UnknownScreenIdError
 *   - freeDiscussionRound: votes 만장일치 → opinion.status='agreed' + agreed=true
 *   - freeDiscussionRound: additions kind='revise'/'block'/'addition' 자식 insert
 *   - freeDiscussionRound: 깊이 cap 3 강제 — depth 2 부모에 추가 → OpinionDepthCapError
 *   - freeDiscussionRound: 잘못된 화면 ID → UnknownScreenIdError
 *   - freeDiscussionRound: 잘못된 opinionId / 다른 회의 opinionId → OpinionNotFoundError
 *   - nextLabelHint: distinct authorLabel 개수 + 1
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
} from '../../database/__tests__/_helpers';
import { MeetingRepository } from '../meeting-repository';
import { MeetingService } from '../meeting-service';
import { OpinionRepository } from '../opinion-repository';
import {
  OpinionDepthCapError,
  OpinionNotFoundError,
  OpinionService,
  UnknownScreenIdError,
} from '../opinion-service';

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

describe('OpinionService', () => {
  let arenaRoot: string;
  let db: Database.Database;
  let svc: OpinionService;
  let repo: OpinionRepository;
  let meetingId: string;
  const channelId = 'ch-1';

  beforeEach(async () => {
    arenaRoot = makeTmpDir('rolestra-opinion-svc-');
    const arenaSvc = new ArenaRootService(createConfigStub(arenaRoot));
    await arenaSvc.ensure();
    db = new Database(arenaSvc.dbPath());
    db.pragma('foreign_keys = ON');
    runMigrations(db, migrations);

    insertProvider(db, 'pv-codex');
    insertProvider(db, 'pv-claude');
    insertProvider(db, 'pv-gemini');
    insertProject(db, 'p-1');
    insertChannel(db, channelId, 'p-1');
    const meeting = new MeetingService(new MeetingRepository(db)).start({
      channelId,
      topic: 'opinion service test',
    });
    meetingId = meeting.id;

    repo = new OpinionRepository(db);
    svc = new OpinionService(repo);
  });

  afterEach(() => {
    db.close();
    cleanupDir(arenaRoot);
  });

  // ── gather ──────────────────────────────────────────────────────

  describe('gather', () => {
    it('inserts one opinion row per opinions[] entry per response', () => {
      const result = svc.gather({
        meetingId,
        channelId,
        round: 0,
        responses: [
          {
            providerId: 'pv-codex',
            payload: {
              name: 'Codex',
              label: 'codex_1',
              opinions: [
                { title: 'X 하자', content: 'X 본문', rationale: 'X 근거' },
                { title: 'Y 하자', content: 'Y 본문', rationale: 'Y 근거' },
              ],
            },
          },
          {
            providerId: 'pv-claude',
            payload: {
              name: 'Claude',
              label: 'claude_1',
              opinions: [
                { title: 'Z 하자', content: 'Z 본문', rationale: 'Z 근거' },
              ],
            },
          },
        ],
      });
      expect(result.inserted).toHaveLength(3);
      expect(result.inserted.every((o) => o.kind === 'root')).toBe(true);
      expect(result.inserted.every((o) => o.status === 'pending')).toBe(true);
      expect(result.inserted.every((o) => o.parentId === null)).toBe(true);
      expect(result.inserted.every((o) => o.meetingId === meetingId)).toBe(true);
      // author_label / author_provider_id 정확히 매핑.
      const codexOpinions = result.inserted.filter(
        (o) => o.authorProviderId === 'pv-codex',
      );
      expect(codexOpinions).toHaveLength(2);
      expect(codexOpinions.every((o) => o.authorLabel === 'codex_1')).toBe(true);
      // DB 에 정확히 persist.
      expect(repo.listByMeeting(meetingId)).toHaveLength(3);
    });

    it('accepts an empty opinions array (provider chose not to propose)', () => {
      const result = svc.gather({
        meetingId,
        channelId,
        round: 0,
        responses: [
          {
            providerId: 'pv-codex',
            payload: { name: 'Codex', label: 'codex_1', opinions: [] },
          },
        ],
      });
      expect(result.inserted).toHaveLength(0);
      expect(repo.listByMeeting(meetingId)).toHaveLength(0);
    });

    it('content can be long — no truncate (spec §11.18.2 explicit)', () => {
      const longContent = 'x'.repeat(50_000);
      const result = svc.gather({
        meetingId,
        channelId,
        round: 0,
        responses: [
          {
            providerId: 'pv-codex',
            payload: {
              name: 'Codex',
              label: 'codex_1',
              opinions: [
                { title: '긴 의견', content: longContent, rationale: '근거' },
              ],
            },
          },
        ],
      });
      expect(result.inserted[0].content).toBe(longContent);
    });
  });

  // ── tally ──────────────────────────────────────────────────────

  describe('tally', () => {
    it('assigns ITEM_001 / ITEM_002 to roots in created_at order', () => {
      svc.gather({
        meetingId,
        channelId,
        round: 0,
        responses: [
          {
            providerId: 'pv-codex',
            payload: {
              name: 'Codex',
              label: 'codex_1',
              opinions: [
                { title: 'A', content: 'A', rationale: 'r' },
                { title: 'B', content: 'B', rationale: 'r' },
              ],
            },
          },
        ],
      });
      const result = svc.tally(meetingId);
      expect(result.rootCount).toBe(2);
      expect(result.totalCount).toBe(2);
      expect(result.tree[0].screenId).toBe('ITEM_001');
      expect(result.tree[1].screenId).toBe('ITEM_002');
      expect(Object.keys(result.screenToUuid).sort()).toEqual([
        'ITEM_001',
        'ITEM_002',
      ]);
    });

    it('produces empty tree when meeting has no opinions yet', () => {
      const result = svc.tally(meetingId);
      expect(result.rootCount).toBe(0);
      expect(result.totalCount).toBe(0);
      expect(result.tree).toEqual([]);
    });
  });

  // ── quickVote ──────────────────────────────────────────────────

  describe('quickVote', () => {
    function seedTwoRoots(): { ids: string[]; screen: Record<string, string> } {
      const gathered = svc.gather({
        meetingId,
        channelId,
        round: 0,
        responses: [
          {
            providerId: 'pv-codex',
            payload: {
              name: 'Codex',
              label: 'codex_1',
              opinions: [
                { title: 'X', content: 'X', rationale: 'r' },
                { title: 'Y', content: 'Y', rationale: 'r' },
              ],
            },
          },
        ],
      });
      const tally = svc.tally(meetingId);
      return {
        ids: gathered.inserted.map((o) => o.id),
        screen: tally.screenToUuid,
      };
    }

    it('marks ITEM unanimous (all agree) → status=agreed; mixed → unresolved', () => {
      const { ids } = seedTwoRoots();
      const result = svc.quickVote({
        meetingId,
        round: 1,
        responses: [
          {
            providerId: 'pv-claude',
            payload: {
              name: 'Claude',
              label: 'claude_1',
              quick_votes: [
                { target_id: 'ITEM_001', vote: 'agree' },
                { target_id: 'ITEM_002', vote: 'oppose', comment: '비용 큼' },
              ],
            },
          },
          {
            providerId: 'pv-gemini',
            payload: {
              name: 'Gemini',
              label: 'gemini_1',
              quick_votes: [
                { target_id: 'ITEM_001', vote: 'agree' },
                { target_id: 'ITEM_002', vote: 'agree' },
              ],
            },
          },
        ],
      });
      expect(result.agreed).toEqual([ids[0]]); // ITEM_001 unanimous
      expect(result.unresolved).toEqual([ids[1]]); // ITEM_002 mixed
      expect(result.votesInserted).toBe(4);

      // DB 반영 확인.
      expect(repo.get(ids[0])?.status).toBe('agreed');
      expect(repo.get(ids[1])?.status).toBe('pending');
    });

    it('treats a root with zero votes as unresolved (no silent agreed)', () => {
      const { ids } = seedTwoRoots();
      const result = svc.quickVote({
        meetingId,
        round: 1,
        responses: [
          {
            providerId: 'pv-claude',
            payload: {
              name: 'Claude',
              label: 'claude_1',
              quick_votes: [{ target_id: 'ITEM_001', vote: 'agree' }],
            },
          },
        ],
      });
      // ITEM_002 received 0 votes — must be unresolved, not agreed.
      expect(result.agreed).toEqual([ids[0]]);
      expect(result.unresolved).toEqual([ids[1]]);
    });

    it('throws UnknownScreenIdError when target_id is not in the tally map', () => {
      seedTwoRoots();
      expect(() =>
        svc.quickVote({
          meetingId,
          round: 1,
          responses: [
            {
              providerId: 'pv-claude',
              payload: {
                name: 'Claude',
                label: 'claude_1',
                quick_votes: [{ target_id: 'ITEM_999', vote: 'agree' }],
              },
            },
          ],
        }),
      ).toThrow(UnknownScreenIdError);
    });

    it('inserts opinion_vote rows with roundKind=quick_vote and the given round number', () => {
      seedTwoRoots();
      svc.quickVote({
        meetingId,
        round: 7,
        responses: [
          {
            providerId: 'pv-claude',
            payload: {
              name: 'Claude',
              label: 'claude_1',
              quick_votes: [{ target_id: 'ITEM_001', vote: 'agree' }],
            },
          },
        ],
      });
      const votes = repo.listVotesByMeeting(meetingId);
      expect(votes).toHaveLength(1);
      expect(votes[0].roundKind).toBe('quick_vote');
      expect(votes[0].round).toBe(7);
      expect(votes[0].voterProviderId).toBe('pv-claude');
    });
  });

  // ── freeDiscussionRound ────────────────────────────────────────

  describe('freeDiscussionRound', () => {
    function seedOneRoot(): { rootId: string; screen: Record<string, string> } {
      const gathered = svc.gather({
        meetingId,
        channelId,
        round: 0,
        responses: [
          {
            providerId: 'pv-codex',
            payload: {
              name: 'Codex',
              label: 'codex_1',
              opinions: [
                { title: 'X', content: 'X 본문', rationale: 'r' },
              ],
            },
          },
        ],
      });
      const tally = svc.tally(meetingId);
      return { rootId: gathered.inserted[0].id, screen: tally.screenToUuid };
    }

    it('inserts addition (kind=revise) as a child opinion under parent', () => {
      const { rootId } = seedOneRoot();
      const result = svc.freeDiscussionRound({
        meetingId,
        opinionId: rootId,
        round: 2,
        responses: [
          {
            providerId: 'pv-claude',
            payload: {
              name: 'Claude',
              label: 'claude_2',
              votes: [],
              additions: [
                {
                  parent_id: 'ITEM_001',
                  kind: 'revise',
                  title: 'X-수정',
                  content: 'X 더 좋은 방향',
                  rationale: '근거',
                },
              ],
            },
          },
        ],
      });
      expect(result.additions).toHaveLength(1);
      expect(result.additions[0].kind).toBe('revise');
      expect(result.additions[0].parentId).toBe(rootId);
      expect(result.additions[0].round).toBe(2);
      expect(result.agreed).toBe(false); // no votes on parent → not agreed

      const all = repo.listByMeeting(meetingId);
      expect(all).toHaveLength(2);
      // tally re-build assigns child screen ID.
      const tally = svc.tally(meetingId);
      expect(tally.tree[0].children[0].screenId).toBe('ITEM_001_01');
    });

    it('marks parent agreed when round votes are unanimous agree', () => {
      const { rootId } = seedOneRoot();
      const result = svc.freeDiscussionRound({
        meetingId,
        opinionId: rootId,
        round: 2,
        responses: [
          {
            providerId: 'pv-claude',
            payload: {
              name: 'Claude',
              label: 'claude_2',
              votes: [{ target_id: 'ITEM_001', vote: 'agree' }],
              additions: [],
            },
          },
          {
            providerId: 'pv-gemini',
            payload: {
              name: 'Gemini',
              label: 'gemini_2',
              votes: [{ target_id: 'ITEM_001', vote: 'agree' }],
              additions: [],
            },
          },
        ],
      });
      expect(result.agreed).toBe(true);
      expect(repo.get(rootId)?.status).toBe('agreed');
      expect(result.votesInserted).toBe(2);
    });

    it('does NOT mark agreed when round votes mix oppose / abstain', () => {
      const { rootId } = seedOneRoot();
      const result = svc.freeDiscussionRound({
        meetingId,
        opinionId: rootId,
        round: 2,
        responses: [
          {
            providerId: 'pv-claude',
            payload: {
              name: 'Claude',
              label: 'claude_2',
              votes: [{ target_id: 'ITEM_001', vote: 'agree' }],
              additions: [],
            },
          },
          {
            providerId: 'pv-gemini',
            payload: {
              name: 'Gemini',
              label: 'gemini_2',
              votes: [{ target_id: 'ITEM_001', vote: 'oppose' }],
              additions: [],
            },
          },
        ],
      });
      expect(result.agreed).toBe(false);
      expect(repo.get(rootId)?.status).toBe('pending');
    });

    it('throws OpinionDepthCapError when adding under a depth-2 (grandchild) parent', () => {
      const { rootId } = seedOneRoot();
      // Build child + grandchild first.
      svc.freeDiscussionRound({
        meetingId,
        opinionId: rootId,
        round: 1,
        responses: [
          {
            providerId: 'pv-claude',
            payload: {
              name: 'Claude',
              label: 'claude_2',
              votes: [],
              additions: [
                {
                  parent_id: 'ITEM_001',
                  kind: 'revise',
                  title: 'child',
                  content: 'c',
                  rationale: 'r',
                },
              ],
            },
          },
        ],
      });
      const child = svc.tally(meetingId).tree[0].children[0];
      svc.freeDiscussionRound({
        meetingId,
        opinionId: child.opinion.id,
        round: 2,
        responses: [
          {
            providerId: 'pv-claude',
            payload: {
              name: 'Claude',
              label: 'claude_3',
              votes: [],
              additions: [
                {
                  parent_id: child.screenId, // ITEM_001_01
                  kind: 'addition',
                  title: 'gc',
                  content: 'gc',
                  rationale: 'r',
                },
              ],
            },
          },
        ],
      });
      const grandchild = svc.tally(meetingId).tree[0].children[0].children[0];
      // Now adding under grandchild (depth 2) should throw — cap reached.
      expect(() =>
        svc.freeDiscussionRound({
          meetingId,
          opinionId: grandchild.opinion.id,
          round: 3,
          responses: [
            {
              providerId: 'pv-claude',
              payload: {
                name: 'Claude',
                label: 'claude_4',
                votes: [],
                additions: [
                  {
                    parent_id: grandchild.screenId, // ITEM_001_01_01
                    kind: 'addition',
                    title: 'too deep',
                    content: 'd',
                    rationale: 'r',
                  },
                ],
              },
            },
          ],
        }),
      ).toThrow(OpinionDepthCapError);
    });

    it('throws UnknownScreenIdError when addition.parent_id is unknown', () => {
      const { rootId } = seedOneRoot();
      expect(() =>
        svc.freeDiscussionRound({
          meetingId,
          opinionId: rootId,
          round: 2,
          responses: [
            {
              providerId: 'pv-claude',
              payload: {
                name: 'Claude',
                label: 'claude_2',
                votes: [],
                additions: [
                  {
                    parent_id: 'ITEM_999',
                    kind: 'revise',
                    title: 't',
                    content: 'c',
                    rationale: 'r',
                  },
                ],
              },
            },
          ],
        }),
      ).toThrow(UnknownScreenIdError);
    });

    it('throws OpinionNotFoundError when opinionId is unknown or belongs to another meeting', () => {
      seedOneRoot();
      expect(() =>
        svc.freeDiscussionRound({
          meetingId,
          opinionId: 'no-such-uuid',
          round: 1,
          responses: [],
        }),
      ).toThrow(OpinionNotFoundError);
    });
  });

  // ── nextLabelHint ──────────────────────────────────────────────

  describe('nextLabelHint', () => {
    it('returns 1 when no opinions by this provider exist', () => {
      expect(svc.nextLabelHint(meetingId, 'pv-codex')).toBe(1);
    });

    it('returns distinct authorLabel count + 1', () => {
      svc.gather({
        meetingId,
        channelId,
        round: 0,
        responses: [
          {
            providerId: 'pv-codex',
            payload: {
              name: 'Codex',
              label: 'codex_1',
              opinions: [{ title: 'a', content: 'a', rationale: 'r' }],
            },
          },
        ],
      });
      // 1 distinct label so far → next = 2
      expect(svc.nextLabelHint(meetingId, 'pv-codex')).toBe(2);

      // Same label re-used → still distinct=1.
      svc.gather({
        meetingId,
        channelId,
        round: 1,
        responses: [
          {
            providerId: 'pv-codex',
            payload: {
              name: 'Codex',
              label: 'codex_1',
              opinions: [{ title: 'b', content: 'b', rationale: 'r' }],
            },
          },
        ],
      });
      expect(svc.nextLabelHint(meetingId, 'pv-codex')).toBe(2);

      // New label → distinct=2 → next=3.
      svc.gather({
        meetingId,
        channelId,
        round: 2,
        responses: [
          {
            providerId: 'pv-codex',
            payload: {
              name: 'Codex',
              label: 'codex_2',
              opinions: [{ title: 'c', content: 'c', rationale: 'r' }],
            },
          },
        ],
      });
      expect(svc.nextLabelHint(meetingId, 'pv-codex')).toBe(3);
    });
  });
});
