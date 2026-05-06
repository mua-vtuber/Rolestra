/**
 * RunStepService 단위 테스트 — appendForTurn / appendOne / list* / 검증 (R12-C2
 * P2 T12). spec §11.19 acceptance + edge cases.
 *
 * 검증:
 *  - appendForTurn 기본       다수 row 한 turn 묶음 insert + UUID/createdAt 자동
 *  - appendForTurn empty      no-op (transaction 시작 X 도 무해)
 *  - appendForTurn atomic     부분 FK 위반 시 같은 turn 모든 row rollback
 *  - appendForTurn truncate    50KB JSON content 가 byte-perfect 보존
 *  - assertValid nextStepCard  next_step_classify 외 step 에서 nextStepCard !== null → throw
 *  - assertValid actor          employee + actorId=null / non-employee + actorId set → throw
 *  - listByMeeting 정렬         turn_index ASC, 같은 turn 안 created_at ASC
 *  - listByChannel 정렬         created_at ASC
 *  - listByTurn                 한 turn 의 step 흐름만 반환
 *  - append-only 정책           서비스에 update / delete 메서드 부재 (TS 타입 레벨 검증)
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
import { runMigrations } from '../../../database/migrator';
import { migrations } from '../../../database/migrations/index';
import {
  insertChannel,
  insertProject,
  insertProvider,
} from '../../../database/__tests__/_helpers';
import { MeetingRepository } from '../../meeting-repository';
import { MeetingService } from '../../meeting-service';
import type { NewRunStep } from '../../../../shared/run-step-types';
import { RunStepRepository } from '../run-step-repository';
import {
  RunStepActorMismatchError,
  RunStepNextStepCardMisuseError,
  RunStepService,
} from '../run-step-service';

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

describe('RunStepService', () => {
  let arenaRoot: string;
  let db: Database.Database;
  let svc: RunStepService;
  let repo: RunStepRepository;
  let meetingId: string;
  const channelId = 'ch-1';
  const otherChannelId = 'ch-2';
  const providerId = 'pv-codex';

  beforeEach(async () => {
    arenaRoot = makeTmpDir('rolestra-run-step-svc-');
    const arenaSvc = new ArenaRootService(createConfigStub(arenaRoot));
    await arenaSvc.ensure();
    db = new Database(arenaSvc.dbPath());
    db.pragma('foreign_keys = ON');
    runMigrations(db, migrations);

    insertProvider(db, providerId);
    insertProject(db, 'p-1');
    insertChannel(db, channelId, 'p-1');
    insertChannel(db, otherChannelId, 'p-1');
    const meeting = new MeetingService(new MeetingRepository(db)).start({
      channelId,
      topic: 'run step service test',
    });
    meetingId = meeting.id;

    repo = new RunStepRepository(db);
    svc = new RunStepService(repo);
  });

  afterEach(() => {
    db.close();
    cleanupDir(arenaRoot);
  });

  function makeStep(overrides: Partial<NewRunStep> = {}): NewRunStep {
    return {
      meetingId,
      channelId,
      round: 0,
      turnIndex: 0,
      actorKind: 'employee',
      actorId: providerId,
      stepKind: 'opinion_gather',
      inputJson: JSON.stringify({ prompt: 'test' }),
      outputJson: JSON.stringify({ opinions: [] }),
      nextStepCard: null,
      sideEffectSummary: null,
      durationMs: 100,
      ...overrides,
    };
  }

  // ── appendForTurn ───────────────────────────────────────────────────

  describe('appendForTurn', () => {
    it('inserts multiple rows in single turn — UUID/createdAt auto-filled', () => {
      const step1 = makeStep({ stepKind: 'opinion_gather' });
      const step2 = makeStep({
        stepKind: 'next_step_classify',
        actorKind: 'system',
        actorId: null,
        nextStepCard: 'wait',
      });

      const persisted = svc.appendForTurn([step1, step2]);

      expect(persisted).toHaveLength(2);
      expect(persisted[0]?.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(persisted[1]?.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(persisted[0]?.id).not.toBe(persisted[1]?.id);
      expect(persisted[0]?.createdAt).toBeGreaterThan(0);
      expect(persisted[0]?.createdAt).toBe(persisted[1]?.createdAt);

      const fetched = svc.listByTurn(meetingId, 0);
      expect(fetched).toHaveLength(2);
      expect(fetched.map((s) => s.stepKind).sort()).toEqual([
        'next_step_classify',
        'opinion_gather',
      ]);
    });

    it('empty input is no-op (returns empty array)', () => {
      const result = svc.appendForTurn([]);
      expect(result).toEqual([]);
      expect(svc.listByMeeting(meetingId)).toEqual([]);
    });

    it('rolls back ALL rows when any insert fails (atomic write)', () => {
      const goodStep = makeStep({ turnIndex: 5 });
      // FK violation — meeting_id references non-existent meeting.
      const badStep = makeStep({
        meetingId: 'meeting-does-not-exist',
        turnIndex: 5,
      });

      expect(() => svc.appendForTurn([goodStep, badStep])).toThrow();

      // 첫 row 도 영속되면 안 됨 — atomic 보장.
      expect(svc.listByMeeting(meetingId)).toEqual([]);
    });

    it('preserves large inputJson/outputJson byte-for-byte (truncate 금지)', () => {
      // 50KB JSON 본문 — spec §11.19.4 truncate 금지 검증.
      const bigPayload = JSON.stringify({
        chunks: Array.from({ length: 1000 }, (_, i) => ({
          index: i,
          text: 'a'.repeat(48),
        })),
      });
      expect(bigPayload.length).toBeGreaterThan(40_000);

      const step = makeStep({
        inputJson: bigPayload,
        outputJson: bigPayload,
      });
      const [persisted] = svc.appendForTurn([step]);
      expect(persisted).toBeDefined();

      const fetched = svc.listByMeeting(meetingId);
      expect(fetched).toHaveLength(1);
      expect(fetched[0]?.inputJson).toBe(bigPayload);
      expect(fetched[0]?.outputJson).toBe(bigPayload);
    });
  });

  // ── appendOne ───────────────────────────────────────────────────────

  describe('appendOne', () => {
    it('inserts a single row and returns it with id/createdAt', () => {
      const persisted = svc.appendOne(makeStep());
      expect(persisted.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(persisted.createdAt).toBeGreaterThan(0);
      expect(svc.listByMeeting(meetingId)).toHaveLength(1);
    });
  });

  // ── assertValid (silent fallback 금지) ──────────────────────────────

  describe('assertValid', () => {
    it('throws RunStepNextStepCardMisuseError when nextStepCard set on non-classify step', () => {
      const step = makeStep({
        stepKind: 'opinion_gather',
        nextStepCard: 'wait',
      });
      expect(() => svc.appendForTurn([step])).toThrow(
        RunStepNextStepCardMisuseError,
      );
      expect(svc.listByMeeting(meetingId)).toEqual([]);
    });

    it('allows nextStepCard=null on any step', () => {
      const step = makeStep({
        stepKind: 'tool_invoke',
        nextStepCard: null,
      });
      expect(() => svc.appendForTurn([step])).not.toThrow();
    });

    it('throws RunStepActorMismatchError when employee has null actorId', () => {
      const step = makeStep({ actorKind: 'employee', actorId: null });
      expect(() => svc.appendForTurn([step])).toThrow(
        RunStepActorMismatchError,
      );
    });

    it('throws RunStepActorMismatchError when system has non-null actorId', () => {
      const step = makeStep({
        actorKind: 'system',
        actorId: providerId,
        stepKind: 'opinion_tally',
      });
      expect(() => svc.appendForTurn([step])).toThrow(
        RunStepActorMismatchError,
      );
    });

    it('throws RunStepActorMismatchError when moderator has non-null actorId', () => {
      const step = makeStep({
        actorKind: 'moderator',
        actorId: providerId,
        stepKind: 'minutes_compose',
      });
      expect(() => svc.appendForTurn([step])).toThrow(
        RunStepActorMismatchError,
      );
    });

    it('throws RunStepActorMismatchError when user has non-null actorId', () => {
      const step = makeStep({
        actorKind: 'user',
        actorId: providerId,
        stepKind: 'approval_request',
      });
      expect(() => svc.appendForTurn([step])).toThrow(
        RunStepActorMismatchError,
      );
    });
  });

  // ── list* 정렬 ──────────────────────────────────────────────────────

  describe('list ordering', () => {
    it('listByMeeting orders by turn_index ASC, created_at ASC', () => {
      // turn 1 의 두 step 을 먼저 → 같은 createdAt 이지만 같은 turn_index 안
      // 순서 (a, b) 보장.
      svc.appendForTurn([
        makeStep({ turnIndex: 1, stepKind: 'opinion_gather' }),
        makeStep({ turnIndex: 1, stepKind: 'opinion_tally' }),
      ]);
      // turn 0 의 한 step → turnIndex 가 더 작으므로 list 의 첫 번째.
      svc.appendForTurn([makeStep({ turnIndex: 0, stepKind: 'free_discussion' })]);

      const all = svc.listByMeeting(meetingId);
      expect(all.map((s) => s.turnIndex)).toEqual([0, 1, 1]);
      // 첫 row = turn 0 의 free_discussion.
      expect(all[0]?.stepKind).toBe('free_discussion');
    });

    it('listByChannel orders by created_at ASC across meetings', () => {
      svc.appendForTurn([makeStep({ turnIndex: 0 })]);
      svc.appendForTurn([makeStep({ turnIndex: 1 })]);

      const byChannel = svc.listByChannel(channelId);
      expect(byChannel).toHaveLength(2);
      expect(byChannel[0]?.turnIndex).toBe(0);
      expect(byChannel[1]?.turnIndex).toBe(1);
    });

    it('listByChannel filters by channelId — other channel rows excluded', () => {
      svc.appendForTurn([makeStep({ channelId })]);
      // ch-2 는 별도 회의 없이 row 직접 영속 불가 — meeting FK 가 ch-1 회의를
      // 가리키므로 channel_id 만 다르게 넣어도 FK 자체는 통과 (channel_id FK
      // 만 검증). 실제 흐름에서는 회의가 채널마다 별도지만 본 테스트는
      // listByChannel 이 channelId 필터를 *적용* 하는지만 검증.
      svc.appendForTurn([makeStep({ channelId: otherChannelId })]);

      expect(svc.listByChannel(channelId)).toHaveLength(1);
      expect(svc.listByChannel(otherChannelId)).toHaveLength(1);
    });

    it('listByTurn returns only steps for that turn_index', () => {
      svc.appendForTurn([
        makeStep({ turnIndex: 0 }),
        makeStep({ turnIndex: 0, stepKind: 'opinion_tally' }),
      ]);
      svc.appendForTurn([makeStep({ turnIndex: 1, stepKind: 'free_discussion' })]);

      expect(svc.listByTurn(meetingId, 0)).toHaveLength(2);
      expect(svc.listByTurn(meetingId, 1)).toHaveLength(1);
      expect(svc.listByTurn(meetingId, 99)).toEqual([]);
    });
  });

  // ── append-only 정책 (TypeScript 타입 레벨) ─────────────────────────

  describe('append-only policy', () => {
    it('service does not expose update or delete methods', () => {
      // TypeScript 가 컴파일 시점에 update/delete 메서드 부재를 검증한다.
      // 런타임에서는 prototype 도 update/delete property 가 없어야 한다.
      const proto = Object.getPrototypeOf(svc);
      const methodNames = Object.getOwnPropertyNames(proto);
      const forbidden = methodNames.filter(
        (name) =>
          name.toLowerCase().includes('update') ||
          name.toLowerCase().includes('delete'),
      );
      expect(forbidden).toEqual([]);
    });
  });

  // ── 'appended' 이벤트 (R12-C2 T19) ──────────────────────────────────

  describe('appended event', () => {
    it('emits appended after each persisted row in append order', () => {
      const received: Array<{ id: string; stepKind: string }> = [];
      svc.on('appended', (step) => {
        received.push({ id: step.id, stepKind: step.stepKind });
      });

      const persisted = svc.appendForTurn([
        makeStep({ stepKind: 'opinion_gather', turnIndex: 0 }),
        makeStep({
          stepKind: 'next_step_classify',
          turnIndex: 0,
          actorKind: 'system',
          actorId: null,
          nextStepCard: 'continue',
        }),
      ]);

      expect(received).toHaveLength(2);
      expect(received[0]?.id).toBe(persisted[0]?.id);
      expect(received[0]?.stepKind).toBe('opinion_gather');
      expect(received[1]?.id).toBe(persisted[1]?.id);
      expect(received[1]?.stepKind).toBe('next_step_classify');
    });

    it('does not emit appended for empty input', () => {
      let count = 0;
      svc.on('appended', () => {
        count += 1;
      });
      svc.appendForTurn([]);
      expect(count).toBe(0);
    });

    it('does not emit appended when transaction rolls back (atomic)', () => {
      let count = 0;
      svc.on('appended', () => {
        count += 1;
      });

      const goodStep = makeStep({ turnIndex: 7 });
      const badStep = makeStep({
        meetingId: 'meeting-does-not-exist',
        turnIndex: 7,
      });
      expect(() => svc.appendForTurn([goodStep, badStep])).toThrow();

      // emit 은 commit *후* 호출 — rollback 이면 0 회.
      expect(count).toBe(0);
    });

    it('isolates listener throws — caller still receives persisted rows', () => {
      svc.on('appended', () => {
        throw new Error('listener boom');
      });

      const persisted = svc.appendForTurn([makeStep({ turnIndex: 9 })]);
      expect(persisted).toHaveLength(1);
      // listener throw 가 영속을 깨지 않음.
      expect(svc.listByMeeting(meetingId)).toHaveLength(1);
    });
  });
});
