/**
 * OpinionService 단위 테스트 — 일반 채널 [##] 카드 + light vote (R12-C2 P4
 * T20/T21). spec §4 일반 부서 새 정의 + §11.13 general row acceptance.
 *
 * D1 (2026-09-28): gather / tally / quickVote / freeDiscussionRound /
 * finalizeIdeaSelection / requestMoreIdeas / nextLabelHint / screenToUuid
 * 는 옛 "5 단계 회의" 모델 메서드로, chat-first pivot 이후 대응하는 IPC
 * 채널이 하나도 없다(router.ts / ipc-types.ts 확인 — 호출부 0 건). 그
 * describe 블록들(29 건)을 함께 제거했다. 회의 카드(kind='root') 가 일반
 * 카드 목록/카운터에서 제외되는지 검증하던 세 테스트는 `svc.gather()`
 * 대신 `repo.insert()` 로 회의 카드를 직접 만들도록 고쳐 그대로 남겼다
 * (검증 목적은 동일 — 아래 `insertMeetingOpinion` 헬퍼).
 *
 * 검증:
 *   - postFromGeneralChannel: [##] 파싱 결과 → user-raised/self-raised 카드
 *   - postFromGeneralChannel: 채널+author 별 label 카운터, title derive
 *   - listGeneralCards: 회의 카드(kind=root) 제외, 정렬, light vote 카운터
 *   - toggleLightVote: insert/remove/replace 3 갈래 + 회의 카드 차단
 */

import Database from 'better-sqlite3';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
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
import type { Opinion } from '../../../shared/opinion-types';
import { OpinionRepository } from '../opinion-repository';
import {
  LightVoteTargetError,
  OpinionNotFoundError,
  OpinionService,
  PostFromGeneralValidationError,
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
    meetingId = 'legacy-meeting';
    db.prepare(`INSERT INTO meetings (id, channel_id, state, started_at)
      VALUES (?, ?, 'discussing', ?)`).run(meetingId, channelId, Date.now());

    repo = new OpinionRepository(db);
    svc = new OpinionService(repo);
  });

  afterEach(() => {
    db.close();
    cleanupDir(arenaRoot);
  });

  /**
   * D1: 회의 카드(kind='root') 를 repo 에 직접 insert 한다. `svc.gather()`
   * 가 제거되기 전에는 그 메서드로 만들었지만, 지금은 이 헬퍼가 같은
   * 모양의 row 를 만든다 — listGeneralCards/toggleLightVote 가 회의 카드를
   * 제외/차단하는지 검증하는 목적은 그대로다.
   */
  function insertMeetingOpinion(overrides: Partial<Opinion> = {}): Opinion {
    const now = Date.now();
    const opinion: Opinion = {
      id: randomUUID(),
      parentId: null,
      meetingId,
      channelId,
      kind: 'root',
      authorProviderId: 'pv-codex',
      authorLabel: 'codex_1',
      title: '회의 의견',
      content: '회의 본문',
      rationale: '근거',
      status: 'pending',
      exclusionReason: null,
      round: 0,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
    repo.insert(opinion);
    return opinion;
  }

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
      // 회의 카드 추가.
      insertMeetingOpinion({ authorProviderId: 'pv-codex', authorLabel: 'codex_1' });
      // 일반 카드 추가 — 같은 채널 + 같은 author → label='pv-codex_2' (회의 1 + 일반 1)
      const result = svc.postFromGeneralChannel({
        channelId,
        authorProviderId: 'pv-codex',
        parts: [{ title: null, content: '잡담 의견' }],
      });
      expect(result.inserted[0]!.authorLabel).toBe('pv-codex_2');
    });
  });

  // T21 — listGeneralCards + toggleLightVote. spec §11.13 general row.
  describe('listGeneralCards (T21)', () => {
    it('빈 채널 → cards 0 건', () => {
      const result = svc.listGeneralCards(channelId);
      expect(result.channelId).toBe(channelId);
      expect(result.cards).toEqual([]);
    });

    it('user-raised + self-raised 카드만 반환 — 회의 카드 (kind=root) 는 제외', () => {
      // 일반 카드 2 건.
      svc.postFromGeneralChannel({
        channelId,
        authorProviderId: null,
        parts: [{ title: 'user', content: 'user body' }],
      });
      svc.postFromGeneralChannel({
        channelId,
        authorProviderId: 'pv-codex',
        parts: [{ title: 'staff', content: 'staff body' }],
      });
      // 회의 카드 (kind='root') — listGeneralCards 결과에서 빠져야 함.
      insertMeetingOpinion({ authorProviderId: 'pv-claude', authorLabel: 'claude_1' });

      const result = svc.listGeneralCards(channelId);
      expect(result.cards.length).toBe(2);
      const kinds = result.cards.map((c) => c.opinion.kind).sort();
      expect(kinds).toEqual(['self-raised', 'user-raised']);
    });

    it('카드 정렬 = createdAt 오름차순 안정', () => {
      svc.postFromGeneralChannel({
        channelId,
        authorProviderId: null,
        parts: [{ title: 'first', content: 'first body' }],
      });
      svc.postFromGeneralChannel({
        channelId,
        authorProviderId: null,
        parts: [{ title: 'second', content: 'second body' }],
      });
      const result = svc.listGeneralCards(channelId);
      expect(result.cards.map((c) => c.opinion.title)).toEqual([
        'first',
        'second',
      ]);
    });

    it('초기 카드 light vote 카운터 = 0 / 0, userVote = null', () => {
      svc.postFromGeneralChannel({
        channelId,
        authorProviderId: null,
        parts: [{ title: 'card', content: 'card body' }],
      });
      const result = svc.listGeneralCards(channelId);
      expect(result.cards[0]!.agreeCount).toBe(0);
      expect(result.cards[0]!.opposeCount).toBe(0);
      expect(result.cards[0]!.userVote).toBe(null);
    });
  });

  describe('toggleLightVote (T21)', () => {
    let cardId: string;

    beforeEach(() => {
      const r = svc.postFromGeneralChannel({
        channelId,
        authorProviderId: null,
        parts: [{ title: 't', content: 'body' }],
      });
      cardId = r.inserted[0]!.id;
    });

    it('처음 vote → effect=inserted + userVote 갱신 + agree 카운터 1', () => {
      const r = svc.toggleLightVote({ opinionId: cardId, vote: 'agree' });
      expect(r.effect).toBe('inserted');
      expect(r.userVote).toBe('agree');
      expect(r.agreeCount).toBe(1);
      expect(r.opposeCount).toBe(0);
    });

    it('같은 vote 재요청 → effect=removed + userVote=null + 카운터 0', () => {
      svc.toggleLightVote({ opinionId: cardId, vote: 'agree' });
      const r = svc.toggleLightVote({ opinionId: cardId, vote: 'agree' });
      expect(r.effect).toBe('removed');
      expect(r.userVote).toBe(null);
      expect(r.agreeCount).toBe(0);
      expect(r.opposeCount).toBe(0);
    });

    it('반대 vote → effect=replaced + userVote 갱신 + 카운터 교차', () => {
      svc.toggleLightVote({ opinionId: cardId, vote: 'agree' });
      const r = svc.toggleLightVote({ opinionId: cardId, vote: 'oppose' });
      expect(r.effect).toBe('replaced');
      expect(r.userVote).toBe('oppose');
      expect(r.agreeCount).toBe(0);
      expect(r.opposeCount).toBe(1);
    });

    it('listGeneralCards 가 토글 결과 반영 (DB 진실원천)', () => {
      svc.toggleLightVote({ opinionId: cardId, vote: 'agree' });
      const result = svc.listGeneralCards(channelId);
      expect(result.cards[0]!.agreeCount).toBe(1);
      expect(result.cards[0]!.userVote).toBe('agree');
    });

    it('알 수 없는 opinionId → OpinionNotFoundError', () => {
      expect(() =>
        svc.toggleLightVote({
          opinionId: '00000000-0000-0000-0000-000000000000',
          vote: 'agree',
        }),
      ).toThrow(OpinionNotFoundError);
    });

    it('회의 카드 (kind=root) 대상 → LightVoteTargetError', () => {
      const meetingCard = insertMeetingOpinion();
      expect(() =>
        svc.toggleLightVote({ opinionId: meetingCard.id, vote: 'agree' }),
      ).toThrow(LightVoteTargetError);
    });

    it('사용자 voter 1 인 invariant — 같은 카드에 row 1 건 미만 유지 (DB 검증)', () => {
      svc.toggleLightVote({ opinionId: cardId, vote: 'agree' });
      svc.toggleLightVote({ opinionId: cardId, vote: 'oppose' });
      svc.toggleLightVote({ opinionId: cardId, vote: 'oppose' });
      // 마지막 = removed → DB 안 voter NULL 의 light vote 0 건
      const userVote = repo.findUserLightVote(cardId);
      expect(userVote).toBe(null);
    });
  });
});
