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
  IDEA_USER_NOT_PICKED_REASON,
  IDEA_USER_OPINION_AUTHOR_LABEL,
  IdeaPickValidationError,
  OpinionDepthCapError,
  OpinionNotFoundError,
  OpinionService,
  PostFromGeneralValidationError,
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

  // ── finalizeIdeaSelection (T15 — spec §5.1) ─────────────────────────

  describe('finalizeIdeaSelection', () => {
    function gatherThree(): {
      ids: string[];
      screen: Record<string, string>;
    } {
      const r = svc.gather({
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
                { title: 'A 하자', content: 'A 본문', rationale: 'A 근거' },
                { title: 'B 하자', content: 'B 본문', rationale: 'B 근거' },
              ],
            },
          },
          {
            providerId: 'pv-claude',
            payload: {
              name: 'Claude',
              label: 'claude_1',
              opinions: [
                { title: 'C 하자', content: 'C 본문', rationale: 'C 근거' },
              ],
            },
          },
        ],
      });
      const tally = svc.tally(meetingId);
      return {
        ids: r.inserted.map((o) => o.id),
        screen: tally.screenToUuid,
      };
    }

    it('selected → status=agreed, unselected → status=excluded with user_not_picked reason', () => {
      gatherThree();

      const result = svc.finalizeIdeaSelection({
        meetingId,
        selectedScreenIds: ['ITEM_001', 'ITEM_003'],
        userComment: undefined,
      });

      expect(result.agreedIds).toHaveLength(2);
      expect(result.excludedIds).toHaveLength(1);
      expect(result.userOpinion).toBeNull();

      // DB 갱신 검증.
      const all = repo.listByMeeting(meetingId);
      const byScreen = svc.tally(meetingId);
      const agreedSet = new Set(result.agreedIds);
      const excludedSet = new Set(result.excludedIds);
      for (const op of all) {
        if (agreedSet.has(op.id)) {
          expect(op.status).toBe('agreed');
          expect(op.exclusionReason).toBeNull();
        } else if (excludedSet.has(op.id)) {
          expect(op.status).toBe('excluded');
          expect(op.exclusionReason).toBe(IDEA_USER_NOT_PICKED_REASON);
        }
      }
      // 화면 ID 매핑이 안정적 — ITEM_002 가 미선택 set 에 들어감.
      expect(excludedSet.has(byScreen.screenToUuid['ITEM_002']!)).toBe(true);
    });

    it('userComment alone (zero picks) inserts a user-raised opinion as agreed and excludes all root cards', () => {
      gatherThree();

      const result = svc.finalizeIdeaSelection({
        meetingId,
        selectedScreenIds: [],
        userComment: '카드 다 별로예요 — 다음 회의에서 다시 해주세요.',
      });

      expect(result.agreedIds).toHaveLength(0);
      expect(result.excludedIds).toHaveLength(3);
      expect(result.userOpinion).not.toBeNull();
      expect(result.userOpinion!.kind).toBe('user-raised');
      expect(result.userOpinion!.authorProviderId).toBeNull();
      expect(result.userOpinion!.authorLabel).toBe(
        IDEA_USER_OPINION_AUTHOR_LABEL,
      );
      expect(result.userOpinion!.status).toBe('agreed');
      expect(result.userOpinion!.parentId).toBeNull();
      expect(result.userOpinion!.content).toContain('카드 다 별로예요');

      // DB persist 확인 — opinion row 4 개 (gather 3 + user comment 1).
      expect(repo.listByMeeting(meetingId)).toHaveLength(4);
    });

    it('combination — selected cards + user comment work together', () => {
      gatherThree();

      const result = svc.finalizeIdeaSelection({
        meetingId,
        selectedScreenIds: ['ITEM_002'],
        userComment: 'ITEM_001 은 다음 분기에 다시 검토',
      });

      expect(result.agreedIds).toHaveLength(1);
      expect(result.excludedIds).toHaveLength(2);
      expect(result.userOpinion).not.toBeNull();
      expect(result.userOpinion!.title).toContain('ITEM_001');
    });

    it('throws IdeaPickValidationError on 0 picks + 0 (or whitespace) comment', () => {
      gatherThree();

      expect(() =>
        svc.finalizeIdeaSelection({
          meetingId,
          selectedScreenIds: [],
          userComment: undefined,
        }),
      ).toThrow(IdeaPickValidationError);

      expect(() =>
        svc.finalizeIdeaSelection({
          meetingId,
          selectedScreenIds: [],
          userComment: '   \n\t  ',
        }),
      ).toThrow(IdeaPickValidationError);

      // DB 변동 없음 — 위 두 throw 후 status='pending' 유지.
      const rows = repo.listByMeeting(meetingId);
      expect(rows).toHaveLength(3);
      expect(rows.every((o) => o.status === 'pending')).toBe(true);
    });

    it('throws UnknownScreenIdError on alien screen id (e.g. ITEM_999)', () => {
      gatherThree();

      expect(() =>
        svc.finalizeIdeaSelection({
          meetingId,
          selectedScreenIds: ['ITEM_999'],
          userComment: 'whatever',
        }),
      ).toThrow(UnknownScreenIdError);

      // DB 변동 없음.
      const rows = repo.listByMeeting(meetingId);
      expect(rows.every((o) => o.status === 'pending')).toBe(true);
    });

    it('long user comment derives an 80-char title (truncate with ellipsis)', () => {
      gatherThree();
      const longLine = 'a'.repeat(100); // 100 chars on the first line.

      const result = svc.finalizeIdeaSelection({
        meetingId,
        selectedScreenIds: [],
        userComment: longLine,
      });

      expect(result.userOpinion!.title).toHaveLength(80);
      expect(result.userOpinion!.title!.endsWith('...')).toBe(true);
      expect(result.userOpinion!.content).toBe(longLine); // 본문은 truncate 없음.
    });

    it('multiline comment derives the first line as title', () => {
      gatherThree();

      const result = svc.finalizeIdeaSelection({
        meetingId,
        selectedScreenIds: [],
        userComment: '제목 줄\n둘째 줄 본문\n셋째 줄',
      });

      expect(result.userOpinion!.title).toBe('제목 줄');
      expect(result.userOpinion!.content).toContain('둘째 줄 본문');
    });

    it('idempotent-ish — calling on a meeting with 0 root cards but userComment ≥ 1 throws (no channelId derive)', () => {
      // gather 안 한 빈 회의 — finalizeIdeaSelection 가 channelId 추정 못 해서
      // OpinionError throw (silent fallback 금지). caller (orchestrator) 가
      // gather 직후 호출 보장.
      expect(() =>
        svc.finalizeIdeaSelection({
          meetingId,
          selectedScreenIds: [],
          userComment: 'hello',
        }),
      ).toThrow(/0 opinion rows/);
    });
  });

  // ── postFromGeneralChannel (T20 — spec §4 일반 부서 새 정의) ─────────

  describe('postFromGeneralChannel', () => {
    it('user-raised — authorProviderId=null 이면 kind="user-raised" + label "user_1"', () => {
      const result = svc.postFromGeneralChannel({
        channelId,
        authorProviderId: null,
        parts: [{ title: '오늘 의견', content: '오늘 의견 본문' }],
      });
      expect(result.inserted).toHaveLength(1);
      const opinion = result.inserted[0]!;
      expect(opinion.kind).toBe('user-raised');
      expect(opinion.authorProviderId).toBeNull();
      expect(opinion.authorLabel).toBe('user_1');
      expect(opinion.meetingId).toBeNull();
      expect(opinion.parentId).toBeNull();
      expect(opinion.status).toBe('pending');
      expect(opinion.round).toBe(0);
      expect(opinion.title).toBe('오늘 의견');
      expect(opinion.content).toBe('오늘 의견 본문');
      expect(opinion.rationale).toBeNull();
      // DB persist 확인.
      expect(repo.listByChannel(channelId)).toHaveLength(1);
    });

    it('self-raised — authorProviderId 있으면 kind="self-raised" + provider 별 카운터', () => {
      const result = svc.postFromGeneralChannel({
        channelId,
        authorProviderId: 'pv-codex',
        parts: [
          { title: null, content: 'codex 의견 1' },
          { title: null, content: 'codex 의견 2' },
        ],
      });
      expect(result.inserted).toHaveLength(2);
      expect(result.inserted.every((o) => o.kind === 'self-raised')).toBe(true);
      expect(result.inserted.every((o) => o.authorProviderId === 'pv-codex')).toBe(true);
      expect(result.inserted.map((o) => o.authorLabel)).toEqual([
        'pv-codex_1',
        'pv-codex_2',
      ]);
    });

    it('title=null 이면 content 첫 줄에서 derive', () => {
      const result = svc.postFromGeneralChannel({
        channelId,
        authorProviderId: null,
        parts: [{ title: null, content: '첫 줄 제목\n둘째 줄 본문' }],
      });
      expect(result.inserted[0]!.title).toBe('첫 줄 제목');
    });

    it('title=null + 80 자 초과 첫 줄 → 80 자 cut + 말줄임', () => {
      const longLine = 'x'.repeat(120);
      const result = svc.postFromGeneralChannel({
        channelId,
        authorProviderId: null,
        parts: [{ title: null, content: longLine }],
      });
      // 77 chars + '...' = 80 chars
      expect(result.inserted[0]!.title).toMatch(/^x{77}\.\.\.$/);
    });

    it('multiple parts — author 별 카운터 base 가 기존 row 기반', () => {
      // 첫 번째 batch.
      svc.postFromGeneralChannel({
        channelId,
        authorProviderId: null,
        parts: [{ title: null, content: 'first' }],
      });
      // 두 번째 batch — base = 1 → 새 라벨 user_2 / user_3.
      const result2 = svc.postFromGeneralChannel({
        channelId,
        authorProviderId: null,
        parts: [
          { title: null, content: 'second' },
          { title: null, content: 'third' },
        ],
      });
      expect(result2.inserted.map((o) => o.authorLabel)).toEqual([
        'user_2',
        'user_3',
      ]);
    });

    it('서로 다른 author 의 카운터는 독립', () => {
      svc.postFromGeneralChannel({
        channelId,
        authorProviderId: null,
        parts: [{ title: null, content: 'user 1' }],
      });
      const codexResult = svc.postFromGeneralChannel({
        channelId,
        authorProviderId: 'pv-codex',
        parts: [{ title: null, content: 'codex 1' }],
      });
      expect(codexResult.inserted[0]!.authorLabel).toBe('pv-codex_1');
      const userResult = svc.postFromGeneralChannel({
        channelId,
        authorProviderId: null,
        parts: [{ title: null, content: 'user 2' }],
      });
      expect(userResult.inserted[0]!.authorLabel).toBe('user_2');
    });

    it('parts 빈 배열 → PostFromGeneralValidationError', () => {
      expect(() =>
        svc.postFromGeneralChannel({
          channelId,
          authorProviderId: null,
          parts: [],
        }),
      ).toThrow(PostFromGeneralValidationError);
    });

    it('빈 content (whitespace only) → PostFromGeneralValidationError', () => {
      expect(() =>
        svc.postFromGeneralChannel({
          channelId,
          authorProviderId: null,
          parts: [{ title: 'ok', content: '   \t\n  ' }],
        }),
      ).toThrow(PostFromGeneralValidationError);
    });

    it('content 앞뒤 whitespace trim — 저장 시점에 정리', () => {
      const result = svc.postFromGeneralChannel({
        channelId,
        authorProviderId: null,
        parts: [{ title: null, content: '   padded body   ' }],
      });
      expect(result.inserted[0]!.content).toBe('padded body');
    });

    it('회의록과 일반 카드 같은 author 면 카운터 합산 (label 표시 식별자라 분리 X)', () => {
      // 회의 카드 추가 (gather).
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
                { title: '회의 의견', content: '회의 본문', rationale: '근거' },
              ],
            },
          },
        ],
      });
      // 일반 카드 추가 — 같은 채널 + 같은 author → label='pv-codex_2' (회의 1 + 일반 1)
      const result = svc.postFromGeneralChannel({
        channelId,
        authorProviderId: 'pv-codex',
        parts: [{ title: null, content: '잡담 의견' }],
      });
      expect(result.inserted[0]!.authorLabel).toBe('pv-codex_2');
    });
  });
});
