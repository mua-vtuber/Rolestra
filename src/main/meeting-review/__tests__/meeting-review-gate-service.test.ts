/**
 * MeetingReviewGateService 단위 테스트 — R12-C2 P6.
 *
 * 본 service (`meeting-review-gate-service.ts`) 는 도메인 invariant 강제:
 *   - createPending — randomUUID + status='pending' + now() 주입
 *   - get — 미존재 시 NotFoundError throw
 *   - decide — pending 만 갱신 가능 (NotPendingError) + race condition handling
 *
 * 검증 항목:
 *   - createPending happy path — id (UUID v4) + status='pending' + createdAt=now() +
 *     decidedAt=null + userNote=null + payloadJson 기본값 null + repo.insert 1 회 호출
 *   - createPending — payloadJson 명시 시 그대로 보존
 *   - createPending — UUID 매 호출마다 다르고 v4 패턴
 *   - get — 존재 시 row 반환 / 미존재 시 MeetingReviewGateNotFoundError
 *   - list — repo.list 위임 + 인자 그대로 전달
 *   - decide happy path — pending → approved/decided_at 갱신 + repo.updateDecision 1회
 *   - decide — id 미존재 (get 단계) → NotFoundError
 *   - decide — 이미 decided 된 상태 → NotPendingError (pre-check)
 *   - decide — race: get 통과 후 updateDecision null 반환 / 다른 process 가 status
 *     바꾼 케이스 → NotPendingError 또는 NotFoundError
 *   - decide — race: update null + post-check 도 pending → MeetingReviewGateError generic
 *   - withTransaction — repo.withTransaction 위임
 *
 * 패턴: mock repository (no DB) + injected now() — repository 단위는 별도
 *       meeting-review-gate-repository.test.ts 가 cover.
 */

import { describe, expect, it, vi } from 'vitest';
import type {
  MeetingReviewGate,
  MeetingReviewGateStatus,
} from '../../../shared/meeting-review-types';
import type { MeetingReviewGateRepository } from '../meeting-review-gate-repository';
import {
  CreateMeetingReviewGateInput,
  MeetingReviewGateError,
  MeetingReviewGateNotFoundError,
  MeetingReviewGateNotPendingError,
  MeetingReviewGateService,
} from '../meeting-review-gate-service';

const FIXED_NOW = 1_700_000_000_000;

function makeInput(
  overrides: Partial<CreateMeetingReviewGateInput> = {},
): CreateMeetingReviewGateInput {
  return {
    projectId: 'p-1',
    meetingId: 'meet-1',
    sourceChannelId: 'ch-planning',
    targetChannelId: 'ch-design',
    targetRole: 'design.ui',
    kind: 'planning_minutes',
    title: '기획 회의록',
    documentPath: '/arena/consensus/meetings/meet-1/minutes.md',
    documentBodySnapshot: '# 본문',
    ...overrides,
  };
}

function makeGate(
  overrides: Partial<MeetingReviewGate> = {},
): MeetingReviewGate {
  return {
    id: 'gate-1',
    projectId: 'p-1',
    meetingId: 'meet-1',
    sourceChannelId: 'ch-planning',
    targetChannelId: 'ch-design',
    targetRole: 'design.ui',
    kind: 'planning_minutes',
    status: 'pending',
    title: '기획 회의록',
    documentPath: '/arena/consensus/meetings/meet-1/minutes.md',
    documentBodySnapshot: '# 본문',
    userNote: null,
    payloadJson: null,
    createdAt: FIXED_NOW,
    decidedAt: null,
    ...overrides,
  };
}

interface MockRepo {
  insert: ReturnType<typeof vi.fn>;
  findById: ReturnType<typeof vi.fn>;
  list: ReturnType<typeof vi.fn>;
  updateDecision: ReturnType<typeof vi.fn>;
  withTransaction: ReturnType<typeof vi.fn>;
}

function makeMockRepo(): MockRepo {
  return {
    insert: vi.fn(),
    findById: vi.fn(),
    list: vi.fn(),
    updateDecision: vi.fn(),
    withTransaction: vi.fn(<T>(fn: () => T): T => fn()),
  };
}

function makeService(
  repo: MockRepo,
  now: () => number = () => FIXED_NOW,
): MeetingReviewGateService {
  return new MeetingReviewGateService(
    repo as unknown as MeetingReviewGateRepository,
    now,
  );
}

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('MeetingReviewGateService', () => {
  // ── createPending ────────────────────────────────────────────────

  describe('createPending', () => {
    it('happy path — id (UUID v4) + status pending + createdAt now + payloadJson null', () => {
      const repo = makeMockRepo();
      const svc = makeService(repo, () => FIXED_NOW + 5);

      const gate = svc.createPending(makeInput());

      expect(gate.id).toMatch(UUID_V4_PATTERN);
      expect(gate.status).toBe('pending');
      expect(gate.createdAt).toBe(FIXED_NOW + 5);
      expect(gate.decidedAt).toBeNull();
      expect(gate.userNote).toBeNull();
      expect(gate.payloadJson).toBeNull();
      expect(repo.insert).toHaveBeenCalledTimes(1);
      expect(repo.insert).toHaveBeenCalledWith(gate);
    });

    it('preserves payloadJson when caller provides it', () => {
      const repo = makeMockRepo();
      const svc = makeService(repo);
      const gate = svc.createPending(
        makeInput({ payloadJson: '{"foo":"bar"}' }),
      );
      expect(gate.payloadJson).toBe('{"foo":"bar"}');
    });

    it('generates a fresh UUID on every call', () => {
      const repo = makeMockRepo();
      const svc = makeService(repo);
      const a = svc.createPending(makeInput());
      const b = svc.createPending(makeInput());
      expect(a.id).not.toBe(b.id);
      expect(a.id).toMatch(UUID_V4_PATTERN);
      expect(b.id).toMatch(UUID_V4_PATTERN);
    });

    it('allows targetChannelId null (general handoff target)', () => {
      const repo = makeMockRepo();
      const svc = makeService(repo);
      const gate = svc.createPending(makeInput({ targetChannelId: null }));
      expect(gate.targetChannelId).toBeNull();
    });
  });

  // ── get ───────────────────────────────────────────────────────────

  describe('get', () => {
    it('returns gate when repo finds it', () => {
      const repo = makeMockRepo();
      const gate = makeGate();
      repo.findById.mockReturnValue(gate);
      const svc = makeService(repo);
      expect(svc.get('gate-1')).toBe(gate);
      expect(repo.findById).toHaveBeenCalledWith('gate-1');
    });

    it('throws MeetingReviewGateNotFoundError when repo returns null', () => {
      const repo = makeMockRepo();
      repo.findById.mockReturnValue(null);
      const svc = makeService(repo);
      expect(() => svc.get('missing')).toThrow(MeetingReviewGateNotFoundError);
      expect(() => svc.get('missing')).toThrow(/missing/);
    });
  });

  // ── list ─────────────────────────────────────────────────────────

  describe('list', () => {
    it('delegates to repo.list with same args', () => {
      const repo = makeMockRepo();
      const result = [makeGate(), makeGate({ id: 'gate-2' })];
      repo.list.mockReturnValue(result);
      const svc = makeService(repo);
      expect(svc.list({ projectId: 'p-1', status: 'pending' })).toBe(result);
      expect(repo.list).toHaveBeenCalledWith({
        projectId: 'p-1',
        status: 'pending',
      });
    });

    it('forwards default {} when caller passes no args', () => {
      const repo = makeMockRepo();
      repo.list.mockReturnValue([]);
      const svc = makeService(repo);
      svc.list();
      expect(repo.list).toHaveBeenCalledWith({});
    });
  });

  // ── decide ───────────────────────────────────────────────────────

  describe('decide', () => {
    it('happy path — pending → approved + repo.updateDecision called once with now()', () => {
      const repo = makeMockRepo();
      const pending = makeGate({ status: 'pending' });
      const approved = makeGate({
        status: 'approved',
        userNote: 'OK',
        decidedAt: FIXED_NOW + 7,
      });
      repo.findById.mockReturnValue(pending);
      repo.updateDecision.mockReturnValue(approved);
      const svc = makeService(repo, () => FIXED_NOW + 7);

      const result = svc.decide({
        id: 'gate-1',
        status: 'approved',
        userNote: 'OK',
      });

      expect(result).toBe(approved);
      expect(repo.updateDecision).toHaveBeenCalledTimes(1);
      expect(repo.updateDecision).toHaveBeenCalledWith({
        id: 'gate-1',
        status: 'approved',
        userNote: 'OK',
        decidedAt: FIXED_NOW + 7,
      });
    });

    it('throws NotFoundError when id missing (get pre-check)', () => {
      const repo = makeMockRepo();
      repo.findById.mockReturnValue(null);
      const svc = makeService(repo);
      expect(() =>
        svc.decide({ id: 'missing', status: 'approved', userNote: null }),
      ).toThrow(MeetingReviewGateNotFoundError);
      expect(repo.updateDecision).not.toHaveBeenCalled();
    });

    it('throws NotPendingError when row already decided (pre-check)', () => {
      const repo = makeMockRepo();
      repo.findById.mockReturnValue(
        makeGate({ status: 'approved', decidedAt: FIXED_NOW }),
      );
      const svc = makeService(repo);
      expect(() =>
        svc.decide({ id: 'gate-1', status: 'stopped', userNote: null }),
      ).toThrow(MeetingReviewGateNotPendingError);
      expect(repo.updateDecision).not.toHaveBeenCalled();
    });

    it('race — update returns null + post-check shows row already decided → NotPendingError', () => {
      const repo = makeMockRepo();
      // 첫 findById = pending (pre-check 통과), 두 번째 = approved (race re-check).
      repo.findById
        .mockReturnValueOnce(makeGate({ status: 'pending' }))
        .mockReturnValueOnce(
          makeGate({ status: 'approved', decidedAt: FIXED_NOW }),
        );
      repo.updateDecision.mockReturnValue(null);
      const svc = makeService(repo);

      expect(() =>
        svc.decide({
          id: 'gate-1',
          status: 'revision_requested',
          userNote: null,
        }),
      ).toThrow(MeetingReviewGateNotPendingError);
    });

    it('race — update returns null + row vanished → NotFoundError', () => {
      const repo = makeMockRepo();
      repo.findById
        .mockReturnValueOnce(makeGate({ status: 'pending' }))
        .mockReturnValueOnce(null);
      repo.updateDecision.mockReturnValue(null);
      const svc = makeService(repo);

      expect(() =>
        svc.decide({
          id: 'gate-1',
          status: 'stopped',
          userNote: null,
        }),
      ).toThrow(MeetingReviewGateNotFoundError);
    });

    it('race — update returns null but pre/post-check both still pending → generic MeetingReviewGateError', () => {
      // 거의 발생하지 않는 path 지만 service 가 silent fallback 대신 explicit throw 하는 것 확인.
      const repo = makeMockRepo();
      repo.findById
        .mockReturnValueOnce(makeGate({ status: 'pending' }))
        .mockReturnValueOnce(makeGate({ status: 'pending' }));
      repo.updateDecision.mockReturnValue(null);
      const svc = makeService(repo);

      let caught: unknown;
      try {
        svc.decide({
          id: 'gate-1',
          status: 'approved',
          userNote: null,
        });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(MeetingReviewGateError);
      // 더 구체적인 두 sub-class 가 아니어야 generic case 임을 확인.
      expect(caught).not.toBeInstanceOf(MeetingReviewGateNotPendingError);
      expect(caught).not.toBeInstanceOf(MeetingReviewGateNotFoundError);
    });

    it('passes userNote through verbatim (null + string)', () => {
      const repo = makeMockRepo();
      repo.findById.mockReturnValue(makeGate({ status: 'pending' }));
      repo.updateDecision.mockImplementation((args) =>
        makeGate({
          status: args.status as MeetingReviewGateStatus,
          userNote: args.userNote,
          decidedAt: args.decidedAt,
        }),
      );
      const svc = makeService(repo);

      const a = svc.decide({
        id: 'gate-1',
        status: 'stopped',
        userNote: null,
      });
      expect(a.userNote).toBeNull();

      // 새 가짜 row 로 두 번째 호출 setup (실제 svc 는 stateless).
      repo.findById.mockReturnValue(makeGate({ status: 'pending' }));
      const b = svc.decide({
        id: 'gate-1',
        status: 'restart_requested',
        userNote: '재설계 요청',
      });
      expect(b.userNote).toBe('재설계 요청');
    });
  });

  // ── withTransaction ──────────────────────────────────────────────

  describe('withTransaction', () => {
    it('delegates to repo.withTransaction and returns its result', () => {
      const repo = makeMockRepo();
      repo.withTransaction.mockImplementation(<T>(fn: () => T): T => fn());
      const svc = makeService(repo);
      const result = svc.withTransaction(() => 'ok');
      expect(result).toBe('ok');
      expect(repo.withTransaction).toHaveBeenCalledTimes(1);
    });
  });
});
